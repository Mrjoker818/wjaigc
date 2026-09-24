import 'server-only';

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import WebSocket, { WebSocketServer } from 'ws';

import { assertPresenceMember, PresenceMemberError } from './presence-members';
import {
  joinPresence, leavePresence, PresenceConnectionLimitError,
  readPresenceSnapshot, renewPresence, subscribePresence, type PresenceSnapshot,
} from './presence-leases';
import { PRESENCE_SUBPROTOCOL, presenceClientFrameSchema, type PresenceSnapshotFrame } from './presence-schema';
import { consumePresenceTicket } from './presence-tickets';

const TICKET_PROTOCOL = /^wujie-ticket\.([A-Za-z0-9_-]{43})$/u;

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n`);
}

function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin || Array.isArray(origin)) return false;
  const configured = process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim();
  if (configured) {
    try {
      const expected = new URL(
        /^[a-z][a-z\d+.-]*:\/\//iu.test(configured) ? configured : `https://${configured}`,
      );
      return (expected.protocol === 'https:' || expected.protocol === 'http:')
        && !expected.username && !expected.password
        && origin === expected.origin;
    } catch {
      return false;
    }
  }
  if (process.env.NODE_ENV === 'production') return false;
  const host = request.headers.host;
  if (!host || Array.isArray(host)) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:'
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      && parsed.host === host;
  } catch {
    return false;
  }
}

export interface PresenceGateway {
  handlePresenceUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>;
  close(): Promise<void>;
}

export function createPresenceGateway({
  instanceId,
  maxBufferedBytes = 64 * 1024,
  maxConnectionsPerUserProject = 10,
  heartbeatTimeoutMs = 45_000,
  reconcileIntervalMs = 15_000,
}: {
  instanceId: string;
  maxBufferedBytes?: number;
  maxConnectionsPerUserProject?: number;
  heartbeatTimeoutMs?: number;
  reconcileIntervalMs?: number;
}): PresenceGateway {
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    handleProtocols: protocols => protocols.has(PRESENCE_SUBPROTOCOL) ? PRESENCE_SUBPROTOCOL : false,
  });
  const clients = new Set<WebSocket>();
  const cleanups = new Set<Promise<void>>();
  const operations = new Set<Promise<void>>();
  let closing: Promise<void> | null = null;
  let isClosing = false;
  const trackOperation = (pending: Promise<void>): void => {
    operations.add(pending);
    void pending.finally(() => operations.delete(pending));
  };
  interface RoomClient { deliver(snapshot: PresenceSnapshot): void }
  interface Room {
    connections: Set<RoomClient>;
    ready: Promise<void>;
    unsubscribe: (() => Promise<void>) | null;
    lastBroadcastSequence: number;
    lastBroadcastSignature: string | null;
    refreshing: Promise<void>;
  }
  const rooms = new Map<string, Room>();

  const joinRoom = async (projectId: string, connection: RoomClient): Promise<() => Promise<void>> => {
    let room = rooms.get(projectId);
    if (!room) {
      room = {
        connections: new Set<RoomClient>(),
        ready: Promise.resolve(),
        unsubscribe: null,
        lastBroadcastSequence: -1,
        lastBroadcastSignature: null,
        refreshing: Promise.resolve(),
      };
      const created = room;
      rooms.set(projectId, created);
      created.ready = subscribePresence(projectId, () => {
        created.refreshing = created.refreshing.then(async () => {
          const snapshot = await readPresenceSnapshot(projectId);
          if (rooms.get(projectId) !== created || snapshot.sequence < created.lastBroadcastSequence) return;
          // lastSeenAt is sampled in snapshots; heartbeat freshness alone is not a room event.
          const signature = JSON.stringify({
            sequence: snapshot.sequence,
            participants: snapshot.participants.map(({ userId, displayName }) => ({ userId, displayName })),
          });
          if (signature === created.lastBroadcastSignature) return;
          created.lastBroadcastSequence = snapshot.sequence;
          created.lastBroadcastSignature = signature;
          for (const peer of created.connections) peer.deliver(snapshot);
        }).catch(() => undefined);
        return created.refreshing;
      }, reconcileIntervalMs).then(unsubscribe => { created.unsubscribe = unsubscribe; });
    }
    const selected = room;
    selected.connections.add(connection);
    await selected.ready;
    return async () => {
      selected.connections.delete(connection);
      if (selected.connections.size > 0 || rooms.get(projectId) !== selected) return;
      rooms.delete(projectId);
      await selected.unsubscribe?.();
      await selected.refreshing;
    };
  };

  return {
    async handlePresenceUpgrade(request, socket, head): Promise<void> {
      if (isClosing || process.env.WUJIE_PRESENCE_ENABLED !== 'true') {
        rejectUpgrade(socket, 503, 'Service Unavailable');
        return;
      }
      let url: URL;
      try {
        url = new URL(request.url ?? '', 'http://localhost');
      } catch {
        rejectUpgrade(socket, 400, 'Bad Request');
        return;
      }
      if (url.pathname !== '/api/collaboration/presence' || url.search || !originAllowed(request)) {
        rejectUpgrade(socket, 403, 'Forbidden');
        return;
      }
      const protocols = request.headers['sec-websocket-protocol']?.split(',').map(value => value.trim());
      const match = protocols?.length === 2 && protocols[0] === PRESENCE_SUBPROTOCOL
        ? TICKET_PROTOCOL.exec(protocols[1]) : null;
      if (!match) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
      let identity: { userId: string; projectId: string } | null;
      try {
        identity = await consumePresenceTicket(match[1]);
        if (identity) await assertPresenceMember(identity.userId, identity.projectId);
      } catch (error) {
        if (error instanceof PresenceMemberError) {
          rejectUpgrade(socket, 401, 'Unauthorized');
          return;
        }
        rejectUpgrade(socket, 503, 'Service Unavailable');
        return;
      }
      if (!identity) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
      if (isClosing) {
        rejectUpgrade(socket, 503, 'Service Unavailable');
        return;
      }

      webSocketServer.handleUpgrade(request, socket, head, client => {
        clients.add(client);
        const connectionId = randomUUID();
        let joined = false;
        let active = true;
        let releaseRoom: (() => Promise<void>) | null = null;
        let cleanupPending: Promise<void> | null = null;
        let lastHeartbeatAt = 0;
        let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

        const armHeartbeatTimeout = (): void => {
          if (heartbeatTimer) clearTimeout(heartbeatTimer);
          heartbeatTimer = setTimeout(() => {
            if (active && client.readyState === WebSocket.OPEN) {
              client.close(1008, 'heartbeat timeout');
            }
          }, Number.isFinite(heartbeatTimeoutMs) ? Math.max(50, heartbeatTimeoutMs) : 45_000);
          heartbeatTimer.unref?.();
        };

        const sendFrame = (frame: PresenceSnapshotFrame): void => {
          if (!active || client.readyState !== WebSocket.OPEN) return;
          const payload = JSON.stringify(frame);
          if (client.bufferedAmount + Buffer.byteLength(payload) > maxBufferedBytes) {
            client.close(1008, 'slow client');
            return;
          }
          client.send(payload);
        };

        const cleanup = (): Promise<void> => {
          active = false;
          clients.delete(client);
          if (heartbeatTimer) clearTimeout(heartbeatTimer);
          heartbeatTimer = null;
          const pending = (cleanupPending ?? Promise.resolve()).then(async () => {
            if (releaseRoom) {
              const releaseSubscription = releaseRoom;
              releaseRoom = null;
              await releaseSubscription();
            }
            if (joined) {
              joined = false;
              await leavePresence(connectionId);
            }
          }).catch(() => undefined);
          cleanupPending = pending;
          cleanups.add(pending);
          void pending.finally(() => cleanups.delete(pending));
          return pending;
        };
        client.once('close', () => { void cleanup(); });
        client.once('error', () => { client.terminate(); });

        client.on('message', (data, isBinary) => {
          if (isBinary) {
            client.close(1003, 'text frames only');
            return;
          }
          let frame: unknown;
          try {
            frame = JSON.parse(String(data));
          } catch {
            client.close(1003, 'invalid frame');
            return;
          }
          if (!presenceClientFrameSchema.safeParse(frame).success) {
            client.close(1003, 'invalid frame');
            return;
          }
          const now = Date.now();
          if (now - lastHeartbeatAt < 5_000) {
            client.close(1008, 'heartbeat rate');
            return;
          }
          lastHeartbeatAt = now;
          trackOperation((async () => {
            try {
              if (!joined || !await renewPresence(connectionId)) {
                client.close(1008, 'presence unavailable');
                return;
              }
              armHeartbeatTimeout();
            } catch {
              client.close(1011, 'presence unavailable');
            }
          })());
        });

        const sendSnapshot = async (): Promise<void> => {
          if (!active || client.readyState !== WebSocket.OPEN) return;
          try {
            await assertPresenceMember(identity!.userId, identity!.projectId);
          } catch (error) {
            client.close(error instanceof PresenceMemberError ? 1008 : 1011, 'presence unavailable');
            return;
          }
          const snapshot = await readPresenceSnapshot(identity!.projectId);
          if (!active || client.readyState !== WebSocket.OPEN) return;
          roomConnection.deliver(snapshot);
        };

        const roomConnection: RoomClient = {
          deliver(snapshot): void {
            if (!active || client.readyState !== WebSocket.OPEN) return;
            if (!snapshot.participants.some(person => person.userId === identity!.userId)) {
              client.close(1008, 'presence unavailable');
              return;
            }
            sendFrame({ type: 'snapshot', connectionId, ...snapshot });
          },
        };

        trackOperation((async () => {
          try {
            await joinPresence({
              connectionId,
              userId: identity.userId,
              projectId: identity.projectId,
              instanceId,
              maxConnectionsPerUserProject,
            });
            joined = true;
            if (!active) { await cleanup(); return; }
            releaseRoom = await joinRoom(identity.projectId, roomConnection);
            if (!active) await cleanup();
            else {
              await sendSnapshot();
              armHeartbeatTimeout();
            }
          } catch (error) {
            client.close(error instanceof PresenceConnectionLimitError || error instanceof PresenceMemberError
              ? 1008 : 1011,
              'presence unavailable');
            await cleanup();
          }
        })());
      });
    },
    close(): Promise<void> {
      if (closing) return closing;
      isClosing = true;
      closing = (async () => {
        await Promise.all([...clients].map(client => new Promise<void>(resolve => {
          if (client.readyState === WebSocket.CLOSED) { resolve(); return; }
          client.once('close', () => resolve());
          client.terminate();
        })));
        while (operations.size > 0 || cleanups.size > 0) {
          await Promise.all([...operations, ...cleanups]);
        }
        await new Promise<void>(resolve => webSocketServer.close(() => resolve()));
      })();
      return closing;
    },
  };
}
