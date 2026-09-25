import 'server-only';

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { PoolClient } from 'pg';

import WebSocket, { WebSocketServer } from 'ws';
import * as Y from 'yjs';

import { DocumentAccessError, withDocumentEditorRead } from './document-access';
import {
  commitDocumentUpdate, loadDocumentInTransaction, readDocumentUpdatesAfterInTransaction,
} from './document-store';
import { consumeDocumentTicket } from './document-tickets';
import { getPool } from '@/lib/db-client';

const DOCUMENT_PROTOCOL = 'wujie-document-v1';
const TICKET_PROTOCOL = /^wujie-document-ticket\.([A-Za-z0-9_-]{43})$/u;
const MAX_UPDATE_BYTES = 1_048_576;

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
        && !expected.username && !expected.password && origin === expected.origin;
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

function makeFrame(type: 0x11 | 0x12, sequence: number, update?: Uint8Array): Buffer {
  const bytes = Buffer.alloc(9 + (update?.length ?? 0));
  bytes[0] = type;
  bytes.writeBigUInt64BE(BigInt(sequence), 1);
  if (update) Buffer.from(update).copy(bytes, 9);
  return bytes;
}

interface DocumentConnection {
  socket: WebSocket;
  userId: string;
  projectId: string;
  grantGeneration: string;
  lastSequence: number;
  active: boolean;
  pending: Promise<void>;
  pendingOperations: number;
  queuedInboundBytes: number;
  recentFrames: number[];
}

export interface DocumentGateway {
  ready: Promise<void>;
  handleDocumentUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>;
  close(): Promise<void>;
}

export function createDocumentGateway({
  maxBufferedBytes = 5 * 1024 * 1024,
  maxConnectionsPerProject = 20,
  maxPendingOperationsPerConnection = 64,
  maxQueuedBytesPerConnection = 4 * 1024 * 1024,
  maxQueuedBytesGateway = 64 * 1024 * 1024,
  reconcileIntervalMs = 2_000,
}: {
  maxBufferedBytes?: number;
  maxConnectionsPerProject?: number;
  maxPendingOperationsPerConnection?: number;
  maxQueuedBytesPerConnection?: number;
  maxQueuedBytesGateway?: number;
  reconcileIntervalMs?: number;
} = {}): DocumentGateway {
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_UPDATE_BYTES + 1,
    handleProtocols: protocols => protocols.has(DOCUMENT_PROTOCOL) ? DOCUMENT_PROTOCOL : false,
  });
  const connections = new Set<DocumentConnection>();
  const rooms = new Map<string, Set<DocumentConnection>>();
  const operations = new Set<Promise<void>>();
  let closing: Promise<void> | null = null;
  let isClosing = false;
  let listener: PoolClient | null = null;
  let releaseListener: (() => void) | null = null;
  let listenerAttempt: Promise<void> | null = null;
  let listenerRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let queuedInboundBytes = 0;

  function track(pending: Promise<void>): void {
    operations.add(pending);
    void pending.finally(() => operations.delete(pending));
  }

  function send(connection: DocumentConnection, frame: Buffer): void {
    if (!connection.active || connection.socket.readyState !== WebSocket.OPEN) return;
    if (connection.socket.bufferedAmount + frame.length > maxBufferedBytes) {
      connection.socket.close(1008, 'slow client');
      return;
    }
    connection.socket.send(frame);
  }

  async function reconcile(connection: DocumentConnection): Promise<void> {
    if (!connection.active) return;
    await withDocumentEditorRead(
      connection.userId, connection.projectId, connection.grantGeneration,
      async client => {
        const updates = await readDocumentUpdatesAfterInTransaction(
          client, connection.projectId, connection.lastSequence,
        );
        for (const entry of updates) {
          if (!connection.active || entry.sequence <= connection.lastSequence) continue;
          send(connection, makeFrame(0x11, entry.sequence, entry.update));
          connection.lastSequence = entry.sequence;
        }
      },
    );
  }

  function queue(
    connection: DocumentConnection, operation: () => Promise<void>, retainedBytes = 0,
  ): void {
    if (!connection.active || connection.socket.readyState !== WebSocket.OPEN) return;
    if (connection.queuedInboundBytes + retainedBytes > maxQueuedBytesPerConnection
        || queuedInboundBytes + retainedBytes > maxQueuedBytesGateway) {
      connection.socket.close(1008, 'inbound budget');
      return;
    }
    if (connection.pendingOperations >= maxPendingOperationsPerConnection) {
      connection.socket.close(1008, 'operation queue');
      return;
    }
    connection.pendingOperations += 1;
    connection.queuedInboundBytes += retainedBytes;
    queuedInboundBytes += retainedBytes;
    const pending = connection.pending.then(operation).catch(error => {
      if (connection.active) connection.socket.close(
        error instanceof DocumentAccessError ? 1008 : 1011, 'document unavailable',
      );
    }).finally(() => {
      connection.pendingOperations -= 1;
      connection.queuedInboundBytes -= retainedBytes;
      queuedInboundBytes -= retainedBytes;
    });
    connection.pending = pending;
    track(pending);
  }

  function scheduleListenerRetry(): void {
    if (isClosing || listenerRetryTimer) return;
    listenerRetryTimer = setTimeout(() => {
      listenerRetryTimer = null;
      void startNotificationListener();
    }, 1_000);
    listenerRetryTimer.unref?.();
  }

  function startNotificationListener(): Promise<void> {
    if (isClosing || listener) return Promise.resolve();
    if (listenerAttempt) return listenerAttempt;
    const attempt = (async (): Promise<void> => {
      let connected: PoolClient | null = null;
      let released = false;
      const release = (destroy = false): void => {
        if (released || !connected) return;
        released = true;
        connected.release(destroy);
      };
      try {
        connected = await getPool().connect();
        const active = connected;
        active.on('error', () => {
          if (listener === active) {
            listener = null;
            releaseListener = null;
          }
          release(true);
          scheduleListenerRetry();
        });
        active.on('notification', message => {
        let projectId: string | undefined;
        if (message.channel === 'wujie_document_access_changed') {
          projectId = message.payload;
        } else if (message.channel === 'wujie_canvas_document_changed') {
          try {
            const event: unknown = JSON.parse(message.payload ?? '');
            if (event && typeof event === 'object' && 'projectId' in event
                && typeof event.projectId === 'string') projectId = event.projectId;
          } catch { /* Periodic reconciliation recovers malformed or lost notifications. */ }
        }
        if (!projectId || isClosing) return;
        for (const connection of rooms.get(projectId) ?? []) {
          queue(connection, () => reconcile(connection));
        }
        });
        await active.query('LISTEN wujie_canvas_document_changed');
        await active.query('LISTEN wujie_document_access_changed');
        if (isClosing || released) {
          release();
          return;
        }
        listener = active;
        releaseListener = release;
      } catch {
        release(true);
        scheduleListenerRetry();
      }
    })();
    listenerAttempt = attempt.finally(() => { listenerAttempt = null; });
    return listenerAttempt;
  }

  const ready = startNotificationListener();

  const interval = setInterval(() => {
    for (const connection of connections) queue(connection, () => reconcile(connection));
  }, Number.isFinite(reconcileIntervalMs) ? Math.max(50, reconcileIntervalMs) : 2_000);
  interval.unref?.();

  return {
    ready,
    async handleDocumentUpgrade(request, socket, head): Promise<void> {
      if (isClosing || process.env.WUJIE_YJS_ENABLED !== 'true') {
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
      if (url.pathname !== '/api/collaboration/document' || url.search || !originAllowed(request)) {
        rejectUpgrade(socket, 403, 'Forbidden');
        return;
      }
      const protocols = request.headers['sec-websocket-protocol']?.split(',').map(value => value.trim());
      const match = protocols?.length === 2 && protocols[0] === DOCUMENT_PROTOCOL
        ? TICKET_PROTOCOL.exec(protocols[1]) : null;
      if (!match) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
      let identity: Awaited<ReturnType<typeof consumeDocumentTicket>>;
      try {
        identity = await consumeDocumentTicket(match[1]);
      } catch {
        rejectUpgrade(socket, 503, 'Service Unavailable');
        return;
      }
      if (!identity) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
      const room = rooms.get(identity.projectId) ?? new Set<DocumentConnection>();
      if (room.size >= maxConnectionsPerProject) {
        rejectUpgrade(socket, 429, 'Too Many Requests');
        return;
      }
      if (isClosing) {
        rejectUpgrade(socket, 503, 'Service Unavailable');
        return;
      }

      webSocketServer.handleUpgrade(request, socket, head, client => {
        const connection: DocumentConnection = {
          socket: client, userId: identity.userId, projectId: identity.projectId,
          grantGeneration: identity.grantGeneration,
          lastSequence: 0, active: true, pending: Promise.resolve(),
          pendingOperations: 0, queuedInboundBytes: 0, recentFrames: [],
        };
        room.add(connection);
        rooms.set(identity.projectId, room);
        connections.add(connection);
        client.once('close', () => {
          connection.active = false;
          connections.delete(connection);
          room.delete(connection);
          if (room.size === 0 && rooms.get(identity.projectId) === room) rooms.delete(identity.projectId);
        });
        // ws closes oversized incoming frames with 1009 itself. Terminating
        // here would turn that protocol rejection into an opaque 1006 reset.
        client.on('error', () => undefined);

        queue(connection, async () => {
          await withDocumentEditorRead(
            identity.userId, identity.projectId, identity.grantGeneration,
            async readClient => {
              const loaded = await loadDocumentInTransaction(readClient, identity.projectId);
              if (!connection.active) return;
              send(connection, makeFrame(0x11, loaded.sequence, Y.encodeStateAsUpdate(loaded.doc)));
              connection.lastSequence = loaded.sequence;
            },
          );
        });

        client.on('message', (data, isBinary) => {
          if (!isBinary) { client.close(1003, 'binary frames only'); return; }
          const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          if (bytes.length < 2 || bytes.length > MAX_UPDATE_BYTES + 1
              || (bytes[0] !== 0x01 && bytes[0] !== 0x02)) {
            client.close(1003, 'invalid frame');
            return;
          }
          if (bytes[0] === 0x01) {
            try { Y.decodeStateVector(bytes.subarray(1)); } catch {
              client.close(1003, 'invalid state vector');
              return;
            }
          }
          const now = Date.now();
          connection.recentFrames = connection.recentFrames.filter(at => now - at < 1_000);
          if (connection.recentFrames.length >= 30) { client.close(1008, 'frame rate'); return; }
          connection.recentFrames.push(now);
          queue(connection, async () => {
            if (!connection.active) return;
            if (bytes[0] === 0x01) {
              await withDocumentEditorRead(
                identity.userId, identity.projectId, identity.grantGeneration,
                async readClient => {
                  const loaded = await loadDocumentInTransaction(readClient, identity.projectId);
                  if (!connection.active) return;
                  send(connection, makeFrame(
                    0x11, loaded.sequence,
                    Y.encodeStateAsUpdate(loaded.doc, bytes.subarray(1)),
                  ));
                  connection.lastSequence = loaded.sequence;
                },
              );
              return;
            }
            const result = await commitDocumentUpdate({
              actorId: identity.userId,
              projectId: identity.projectId,
              bytes: bytes.subarray(1),
              expectedGrantGeneration: identity.grantGeneration,
            });
            send(connection, makeFrame(0x12, result.sequence));
            // The writer may have missed earlier concurrent commits. Catch up
            // from its previous sequence, including its own canonical update.
            await reconcile(connection);
            for (const peer of room) {
              if (peer !== connection) queue(peer, () => reconcile(peer));
            }
          }, bytes.length);
        });
      });
    },
    close(): Promise<void> {
      if (closing) return closing;
      isClosing = true;
      clearInterval(interval);
      if (listenerRetryTimer) {
        clearTimeout(listenerRetryTimer);
        listenerRetryTimer = null;
      }
      closing = (async () => {
        await ready;
        await listenerAttempt;
        const connected = listener;
        const release = releaseListener;
        listener = null;
        releaseListener = null;
        if (connected) {
          await connected.query('UNLISTEN wujie_canvas_document_changed').catch(() => undefined);
          await connected.query('UNLISTEN wujie_document_access_changed').catch(() => undefined);
          release?.();
        }
        for (const connection of connections) connection.socket.terminate();
        while (operations.size > 0) await Promise.all([...operations]);
        await new Promise<void>(resolve => webSocketServer.close(() => resolve()));
      })();
      return closing;
    },
  };
}
