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
import { PresenceConnectionCleanupError } from './presence-connection';

const TICKET_PROTOCOL = /^wujie-ticket\.([A-Za-z0-9_-]{43})$/u;
const UPGRADE_SHUTDOWN_GRACE_MS = 5_000;

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
  const upgrades = new Set<Promise<void>>();
  const pendingSockets = new Set<Duplex>();
  const upgradeControllers = new Set<AbortController>();
  const joinControllers = new Set<AbortController>();
  const upgradeCleanupErrors: unknown[] = [];
  let closing: Promise<void> | null = null;
  let isClosing = false;
  const trackOperation = (pending: Promise<void>): void => {
    operations.add(pending);
    void pending.finally(() => operations.delete(pending));
  };
  interface RoomClient { deliver(snapshot: PresenceSnapshot): void }
  interface Room {
    connections: Set<RoomClient>;
    controller: AbortController;
    ready: Promise<void>;
    unsubscribe: (() => Promise<void>) | null;
    lastBroadcastSequence: number;
    lastBroadcastSignature: string | null;
    refreshing: Promise<void>;
  }
  const rooms = new Map<string, Room>();

  const joinRoom = (projectId: string, connection: RoomClient): { ready: Promise<void>; release: () => Promise<void> } => {
    let room = rooms.get(projectId);
    if (!room) {
      room = {
        connections: new Set<RoomClient>(),
        controller: new AbortController(),
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
          if (created.controller.signal.aborted || rooms.get(projectId) !== created) return;
          const snapshot = await readPresenceSnapshot(projectId, created.controller.signal);
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
        }).catch((error: unknown): void => {
          if (error instanceof PresenceConnectionCleanupError) upgradeCleanupErrors.push(error);
        });
        return created.refreshing;
      }, reconcileIntervalMs, created.controller.signal).then(unsubscribe => { created.unsubscribe = unsubscribe; });
      void created.ready.catch(() => undefined);
    }
    const selected = room;
    selected.connections.add(connection);
    let releasing: Promise<void> | undefined;
    const release = (): Promise<void> => {
      if (releasing) return releasing;
      selected.connections.delete(connection);
      if (selected.connections.size > 0 || rooms.get(projectId) !== selected) {
        releasing = Promise.resolve();
        return releasing;
      }
      rooms.delete(projectId);
      selected.controller.abort();
      releasing = (async (): Promise<void> => {
        const unsubscribe = selected.ready.then(async (): Promise<void> => {
          await selected.unsubscribe?.();
        }, (error: unknown): void => {
          if (error !== selected.controller.signal.reason) throw error;
        });
        const settled = await Promise.allSettled([unsubscribe, selected.refreshing]);
        const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
        if (errors.length > 0) throw new AggregateError(errors, 'Room unsubscribe and refresh failed');
      })();
      void releasing.catch(() => undefined);
      return releasing;
    };
    return { ready: selected.ready, release };
  };

  return {
    handlePresenceUpgrade(request, socket, head): Promise<void> {
      if (isClosing || process.env.WUJIE_PRESENCE_ENABLED !== 'true') {
        rejectUpgrade(socket, 503, 'Service Unavailable');
        return Promise.resolve();
      }
      const controller = new AbortController();
      upgradeControllers.add(controller);
      const pending = (async (): Promise<void> => {
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
          identity = await consumePresenceTicket(match[1], () => isClosing || socket.destroyed, controller.signal);
          if (isClosing || socket.destroyed) {
            rejectUpgrade(socket, 503, 'Service Unavailable');
            return;
          }
          if (identity) await assertPresenceMember(identity.userId, identity.projectId, controller.signal);
        } catch (error) {
          if (error instanceof PresenceConnectionCleanupError) throw error;
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
        if (isClosing || socket.destroyed) {
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
          const roomWaitController = new AbortController();
          const renewController = new AbortController();

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
            roomWaitController.abort();
            renewController.abort();
            clients.delete(client);
            if (heartbeatTimer) clearTimeout(heartbeatTimer);
            heartbeatTimer = null;
            const pending = (cleanupPending ?? Promise.resolve()).then(async () => {
              const owned: Promise<void>[] = [];
              if (releaseRoom) {
                const releaseSubscription = releaseRoom;
                releaseRoom = null;
                owned.push(Promise.resolve().then(releaseSubscription));
              }
              if (joined) {
                joined = false;
                // Leaving needs a fresh owner: the client's renewal signal is
                // already cancelled. Bound SQL while still owning acquisition
                // and the concrete checkout through actual retirement.
                const leaveController = new AbortController();
                const deadline = setTimeout(() => leaveController.abort(), UPGRADE_SHUTDOWN_GRACE_MS);
                deadline.unref();
                owned.push(leavePresence(connectionId, leaveController.signal).finally(() => clearTimeout(deadline)));
              }
              const settled = await Promise.allSettled(owned);
              for (const result of settled) if (result.status === 'rejected') upgradeCleanupErrors.push(result.reason);
            }).catch((error: unknown): void => { upgradeCleanupErrors.push(error); });
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
                if (!joined || !await renewPresence(connectionId, renewController.signal)) {
                  client.close(1008, 'presence unavailable');
                  return;
                }
                if (active && client.readyState === WebSocket.OPEN) armHeartbeatTimeout();
              } catch (error) {
                if (error instanceof PresenceConnectionCleanupError) upgradeCleanupErrors.push(error);
                client.close(1011, 'presence unavailable');
              }
            })());
          });

          const sendSnapshot = async (signal: AbortSignal): Promise<void> => {
            if (!active || client.readyState !== WebSocket.OPEN) return;
            try {
              await assertPresenceMember(identity!.userId, identity!.projectId, signal);
            } catch (error) {
              if (error instanceof PresenceConnectionCleanupError) throw error;
              client.close(error instanceof PresenceMemberError ? 1008 : 1011, 'presence unavailable');
              return;
            }
            const snapshot = await readPresenceSnapshot(identity!.projectId, signal);
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

          const joinController = new AbortController();
          joinControllers.add(joinController);
          trackOperation((async () => {
            try {
              await joinPresence({
                connectionId,
                userId: identity.userId,
                projectId: identity.projectId,
                instanceId,
                maxConnectionsPerUserProject,
              }, joinController.signal);
              joined = true;
              if (!active) { await cleanup(); return; }
              const membership = joinRoom(identity.projectId, roomConnection);
              releaseRoom = membership.release;
              // The physical client's wait is independent of the Room's shared
              // subscription. Its release owner exists before initialization.
              await new Promise<void>((resolve, reject) => {
                const signal = roomWaitController.signal;
                const onAbort = (): void => { reject(signal.reason); };
                signal.addEventListener('abort', onAbort, { once: true });
                void membership.ready.then(() => {
                  signal.removeEventListener('abort', onAbort); resolve();
                }, (error: unknown): void => {
                  signal.removeEventListener('abort', onAbort); reject(error);
                });
                if (signal.aborted) onAbort();
              });
              if (!active) await cleanup();
              else {
                await sendSnapshot(joinController.signal);
                if (active && client.readyState === WebSocket.OPEN) armHeartbeatTimeout();
              }
            } catch (error) {
              if (error instanceof PresenceConnectionCleanupError) upgradeCleanupErrors.push(error);
              client.close(error instanceof PresenceConnectionLimitError || error instanceof PresenceMemberError
                ? 1008 : 1011,
                'presence unavailable');
              await cleanup();
            } finally {
              joinControllers.delete(joinController);
            }
          })());
        });
      })();
      // Own authorization before returning to the HTTP caller. Rejections are
      // still returned to that caller; the settlement tracker itself must not
      // create an unhandled rejected finally() promise during shutdown.
      pendingSockets.add(socket);
      const settled = pending.then(
        (): void => { pendingSockets.delete(socket); upgradeControllers.delete(controller); },
        (error: unknown): void => {
          pendingSockets.delete(socket);
          upgradeControllers.delete(controller);
          if (error instanceof PresenceConnectionCleanupError) upgradeCleanupErrors.push(error);
        },
      );
      upgrades.add(settled);
      void settled.then(() => { upgrades.delete(settled); });
      return pending;
    },
    close(): Promise<void> {
      if (closing) return closing;
      isClosing = true;
      for (const room of rooms.values()) room.controller.abort();
      closing = (async () => {
        const authorizationDeadline = setTimeout(() => {
          for (const controller of upgradeControllers) controller.abort();
          for (const controller of joinControllers) controller.abort();
        }, UPGRADE_SHUTDOWN_GRACE_MS);
        authorizationDeadline.unref();
        try {
        const socketsClosed = [...pendingSockets].map(socket => new Promise<void>(resolve => {
          if (socket.closed) { resolve(); return; }
          socket.once('close', () => resolve());
          socket.destroy();
        }));
        await Promise.all([...socketsClosed, ...[...clients].map(client => new Promise<void>(resolve => {
          if (client.readyState === WebSocket.CLOSED) { resolve(); return; }
          client.once('close', () => resolve());
          client.terminate();
        }))]);
        while (upgrades.size > 0 || operations.size > 0 || cleanups.size > 0) {
          await Promise.all([...upgrades, ...operations, ...cleanups]);
        }
        await new Promise<void>(resolve => webSocketServer.close(() => resolve()));
        if (upgradeCleanupErrors.length > 0) {
          throw new AggregateError(upgradeCleanupErrors, 'Presence authorization shutdown cleanup failed');
        }
        } finally {
          clearTimeout(authorizationDeadline);
        }
      })();
      return closing;
    },
  };
}
