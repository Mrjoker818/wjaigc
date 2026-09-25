import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import sharp from 'sharp';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { QueryFn } from '../helpers/postgres-test-database';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument } from '../../src/lib/collaboration/canvas-document';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
const previousDataRoot = process.env.WUJIE_DATA_DIR;
let mediaRoot = '';
let imageSize = 0;

beforeAll(async () => {
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'wujie-yjs-document-gateway-'));
  process.env.WUJIE_DATA_DIR = mediaRoot;
  await mkdir(path.join(mediaRoot, 'images'));
  const image = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#d4af37' },
  }).png().toBuffer();
  imageSize = image.length;
  await writeFile(path.join(mediaRoot, 'images', 'one.png'), image);
});

afterAll(async () => {
  if (previousDataRoot === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = previousDataRoot;
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
});

async function seed(query: QueryFn): Promise<void> {
  for (const file of [
    '20260809_wj_core_users.sql',
    '20260810_wj_stable_s2_assets.sql',
    '20260925_yjs_canvas_editors.sql',
    '20260925_yjs_canvas_tickets.sql',
    '20260925_yjs_canvas_tickets_limits.sql',
    '20260925_yjs_canvas_documents.sql',
  ]) await query(await readFile(path.join('migrations', file), 'utf8'));
  await query(`
    INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
    VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1),
           ('editor-a', 'Editor A', 'test', 'active', 1, 1)
  `);
  await query("INSERT INTO wujie_projects (id, owner_id, name) VALUES ('project-a', 'owner-a', 'A')");
  await query(`
    INSERT INTO wujie_project_document_editors
      (project_id, owner_id, member_user_id, status)
    VALUES ('project-a', 'owner-a', 'editor-a', 'active')
  `);
  await query(`
    INSERT INTO wujie_assets (id, owner_id, project_id, kind)
    VALUES ('asset-one', 'owner-a', 'project-a', 'image')
  `);
  await query(`
    INSERT INTO wujie_asset_versions
      (id, asset_id, owner_id, project_id, file_url, availability, mime_type, byte_size)
    VALUES ('version-one', 'asset-one', 'owner-a', 'project-a',
            '/api/serve-upload/images/one.png', 'ready', 'image/png', $1)
  `, [imageSize]);
}

function decodedFrame(data: WebSocket.RawData): { type: number; sequence: bigint; payload: Uint8Array } {
  const bytes = Buffer.from(data as Buffer);
  expect(bytes.length).toBeGreaterThanOrEqual(9);
  return { type: bytes[0], sequence: bytes.readBigUInt64BE(1), payload: bytes.subarray(9) };
}

describe('canvas document WebSocket on isolated PostgreSQL', () => {
  postgresIt('closes a socket when its per-connection operation queue exceeds the budget', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-gateway-queue-budget', async ({ query }) => {
      vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
      await seed(query);
      const { createDocumentGateway } = await import('../../src/lib/collaboration/document-gateway');
      const { issueDocumentTicket } = await import('../../src/lib/collaboration/document-tickets');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const gateway = createDocumentGateway({
        maxPendingOperationsPerConnection: 1, maxConnectionsPerProject: 1,
        maxQueuedBytesPerConnection: 5,
        reconcileIntervalMs: 60_000,
      });
      const server = createPresenceHttpServer({
        onRequest: (_request, response) => response.end('next-http'),
        onPresenceUpgrade: (_request, socket) => socket.destroy(),
        onDocumentUpgrade: (request, socket, head) => {
          void gateway.handleDocumentUpgrade(request, socket, head);
        },
      });
      let client: WebSocket | null = null;
      let budgetClient: WebSocket | null = null;
      try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const port = (server.address() as AddressInfo).port;
        const ticket = await issueDocumentTicket('owner-a', 'project-a');
        client = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/document`, [
          'wujie-document-v1', `wujie-document-ticket.${ticket}`,
        ], { origin: `http://127.0.0.1:${port}` });
        client.on('error', () => {});
        await once(client, 'message');
        const secondTicket = await issueDocumentTicket('editor-a', 'project-a');
        const second = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/document`, [
          'wujie-document-v1', `wujie-document-ticket.${secondTicket}`,
        ], { origin: `http://127.0.0.1:${port}` });
        second.on('error', () => {});
        const [, rejection] = await once(second, 'unexpected-response');
        expect(rejection.statusCode).toBe(429);
        rejection.resume();
        const closed = once(client, 'close');
        const frame = Buffer.concat([Buffer.from([0x01]), Buffer.from(Y.encodeStateVector(createCanvasDocument()))]);
        client.send(frame);
        client.send(frame);
        const [queueCode, queueReason] = await closed;
        expect(queueCode).toBe(1008);
        expect(Buffer.from(queueReason).toString('utf8')).toBe('operation queue');
        const budgetTicket = await issueDocumentTicket('owner-a', 'project-a');
        budgetClient = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/document`, [
          'wujie-document-v1', `wujie-document-ticket.${budgetTicket}`,
        ], { origin: `http://127.0.0.1:${port}` });
        budgetClient.on('error', () => {});
        await once(budgetClient, 'message');
        const budgetClosed = once(budgetClient, 'close');
        const local = createCanvasDocument();
        applyCanvasImagePatch(local, {
          placementId: 'placement-budget', assetVersionId: 'version-one',
          x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
        }, 'local');
        budgetClient.send(Buffer.concat([Buffer.from([0x02]), Buffer.from(Y.encodeStateAsUpdate(local))]));
        const [budgetCode, budgetReason] = await budgetClosed;
        expect(budgetCode).toBe(1008);
        expect(Buffer.from(budgetReason).toString('utf8')).toBe('inbound budget');
      } finally {
        client?.terminate();
        budgetClient?.terminate();
        await gateway.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        vi.unstubAllEnvs();
      }
    });
  });

  postgresIt('closes a client when the outbound document buffer budget is exceeded', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-gateway-buffer-budget', async ({ query }) => {
      vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
      await seed(query);
      const { createDocumentGateway } = await import('../../src/lib/collaboration/document-gateway');
      const { issueDocumentTicket } = await import('../../src/lib/collaboration/document-tickets');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const gateway = createDocumentGateway({ maxBufferedBytes: 8 });
      const server = createPresenceHttpServer({
        onRequest: (_request, response) => response.end('next-http'),
        onPresenceUpgrade: (_request, socket) => socket.destroy(),
        onDocumentUpgrade: (request, socket, head) => {
          void gateway.handleDocumentUpgrade(request, socket, head);
        },
      });
      let client: WebSocket | null = null;
      try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const port = (server.address() as AddressInfo).port;
        const ticket = await issueDocumentTicket('owner-a', 'project-a');
        client = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/document`, [
          'wujie-document-v1', `wujie-document-ticket.${ticket}`,
        ], { origin: `http://127.0.0.1:${port}` });
        client.on('error', () => {});
        expect((await once(client, 'close'))[0]).toBe(1008);
      } finally {
        client?.terminate();
        await gateway.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        vi.unstubAllEnvs();
      }
    });
  });

  postgresIt('rejects missing tickets, foreign origins, and ticket replay', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-gateway-auth-denials', async ({ query }) => {
      vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
      await seed(query);
      const { createDocumentGateway } = await import('../../src/lib/collaboration/document-gateway');
      const { issueDocumentTicket } = await import('../../src/lib/collaboration/document-tickets');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const gateway = createDocumentGateway();
      const server = createPresenceHttpServer({
        onRequest: (_request, response) => response.end('next-http'),
        onPresenceUpgrade: (_request, socket) => socket.destroy(),
        onDocumentUpgrade: (request, socket, head) => {
          void gateway.handleDocumentUpgrade(request, socket, head);
        },
      });
      let accepted: WebSocket | null = null;
      try {
        await gateway.ready;
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const port = (server.address() as AddressInfo).port;
        const url = `ws://127.0.0.1:${port}/api/collaboration/document`;
        const origin = `http://127.0.0.1:${port}`;
        const status = async (protocols: string[], requestOrigin: string): Promise<number> => {
          const client = new WebSocket(url, protocols, { origin: requestOrigin });
          client.on('error', () => {});
          return await new Promise<number>((resolve, reject) => {
            client.once('unexpected-response', (_request, response) => {
              response.resume();
              resolve(response.statusCode ?? 0);
            });
            client.once('open', () => reject(new Error('unexpected socket acceptance')));
          });
        };
        expect(await status([], origin)).toBe(401);
        const ticket = await issueDocumentTicket('owner-a', 'project-a');
        const protocols = ['wujie-document-v1', `wujie-document-ticket.${ticket}`];
        expect(await status(protocols, 'https://foreign.example')).toBe(403);
        accepted = new WebSocket(url, protocols, { origin });
        accepted.on('error', () => {});
        expect(decodedFrame((await once(accepted, 'message'))[0]).type).toBe(0x11);
        expect(await status(protocols, origin)).toBe(401);
        const oversizedClosed = once(accepted, 'close');
        accepted.send(Buffer.alloc(1_048_578, 0x02));
        expect((await oversizedClosed)[0]).toBe(1009);
        expect((await query("SELECT 1 FROM wujie_project_canvas_documents WHERE project_id = 'project-a'")).rowCount)
          .toBe(0);
      } finally {
        accepted?.terminate();
        await gateway.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        vi.unstubAllEnvs();
      }
    });
  });

  postgresIt('delivers a committed update across two gateway instances through PostgreSQL notification', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-gateway-cross-instance', async ({ query }) => {
      vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
      await seed(query);
      const { createDocumentGateway } = await import('../../src/lib/collaboration/document-gateway');
      const { issueDocumentTicket } = await import('../../src/lib/collaboration/document-tickets');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const gateways = [
        createDocumentGateway({ reconcileIntervalMs: 60_000 }),
        createDocumentGateway({ reconcileIntervalMs: 60_000 }),
      ];
      const servers = gateways.map(gateway => createPresenceHttpServer({
        onRequest: (_request, response) => response.end('next-http'),
        onPresenceUpgrade: (_request, socket) => socket.destroy(),
        onDocumentUpgrade: (request, socket, head) => {
          void gateway.handleDocumentUpgrade(request, socket, head);
        },
      }));
      const clients: WebSocket[] = [];
      try {
        await Promise.all(gateways.map(gateway => gateway.ready));
        const listenerPids = async (): Promise<number[]> => {
          const sessions = await query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
              WHERE datname = current_database()
                AND query = 'LISTEN wujie_document_access_changed'
              ORDER BY pid`,
          );
          return sessions.rows.map(row => row.pid);
        };
        const beforeRestart = await listenerPids();
        expect(beforeRestart).toHaveLength(2);
        await query('SELECT pg_terminate_backend(pid) FROM unnest($1::int[]) AS pid', [beforeRestart]);
        await vi.waitFor(async () => {
          const afterRestart = await listenerPids();
          expect(afterRestart).toHaveLength(2);
          expect(afterRestart.every(pid => !beforeRestart.includes(pid))).toBe(true);
        }, { timeout: 5_000, interval: 100 });
        await Promise.all(servers.map(async server => {
          server.listen(0, '127.0.0.1');
          await once(server, 'listening');
        }));
        const connect = async (index: number, userId: string): Promise<WebSocket> => {
          const port = (servers[index].address() as AddressInfo).port;
          const ticket = await issueDocumentTicket(userId, 'project-a');
          const client = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/document`, [
            'wujie-document-v1', `wujie-document-ticket.${ticket}`,
          ], { origin: `http://127.0.0.1:${port}` });
          client.on('error', () => {});
          clients.push(client);
          return client;
        };
        const owner = await connect(0, 'owner-a');
        await once(owner, 'message');
        const editor = await connect(1, 'editor-a');
        await once(editor, 'message');
        const local = createCanvasDocument();
        applyCanvasImagePatch(local, {
          placementId: 'placement-cross-instance', assetVersionId: 'version-one',
          x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
        }, 'local');
        const remoteFrame = Promise.race([
          once(editor, 'message').then(([data]) => decodedFrame(data)),
          new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('notification did not arrive')), 1200)),
        ]);
        owner.send(Buffer.concat([Buffer.from([0x02]), Buffer.from(Y.encodeStateAsUpdate(local))]));
        expect((await remoteFrame).sequence).toBe(BigInt(1));
      } finally {
        for (const client of clients) client.terminate();
        await Promise.all(gateways.map(gateway => gateway.close()));
        await Promise.all(servers.map(server => new Promise<void>(resolve => {
          server.closeAllConnections();
          server.close(() => resolve());
        })));
        vi.unstubAllEnvs();
      }
    });
  });

  postgresIt('closes a stale editor socket after revoke and regrant without persisting its frame', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-gateway-stale-editor', async ({ query }) => {
      vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
      await seed(query);
      const { createDocumentGateway } = await import('../../src/lib/collaboration/document-gateway');
      const { issueDocumentTicket } = await import('../../src/lib/collaboration/document-tickets');
      const { revokeDocumentEditor, grantDocumentEditor } =
        await import('../../src/lib/collaboration/document-access');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const gateway = createDocumentGateway({ reconcileIntervalMs: 50 });
      const server = createPresenceHttpServer({
        onRequest: (_request, response) => response.end('next-http'),
        onPresenceUpgrade: (_request, socket) => socket.destroy(),
        onDocumentUpgrade: (request, socket, head) => {
          void gateway.handleDocumentUpgrade(request, socket, head);
        },
      });
      let editor: WebSocket | null = null;
      try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const port = (server.address() as AddressInfo).port;
        const ticket = await issueDocumentTicket('editor-a', 'project-a');
        editor = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/document`, [
          'wujie-document-v1', `wujie-document-ticket.${ticket}`,
        ], { origin: `http://127.0.0.1:${port}` });
        editor.on('error', () => {});
        expect(decodedFrame((await once(editor, 'message'))[0]).type).toBe(0x11);
        const closed = once(editor, 'close');
        await revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
        await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
        const local = createCanvasDocument();
        applyCanvasImagePatch(local, {
          placementId: 'placement-stale', assetVersionId: 'version-one',
          x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
        }, 'local');
        if (editor.readyState === WebSocket.OPEN) {
          editor.send(Buffer.concat([Buffer.from([0x02]), Buffer.from(Y.encodeStateAsUpdate(local))]));
        }
        expect((await closed)[0]).toBe(1008);
        expect((await query("SELECT 1 FROM wujie_project_canvas_documents WHERE project_id = 'project-a'")).rowCount)
          .toBe(0);
      } finally {
        editor?.terminate();
        await gateway.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        vi.unstubAllEnvs();
      }
    });
  });

  postgresIt('sends a durable snapshot, confirms a write, then relays it to another editor', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-gateway-relay', async ({ query }) => {
      vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
      await seed(query);
      const { createDocumentGateway } = await import('../../src/lib/collaboration/document-gateway');
      const { issueDocumentTicket } = await import('../../src/lib/collaboration/document-tickets');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const gateway = createDocumentGateway({ reconcileIntervalMs: 50 });
      const server = createPresenceHttpServer({
        onRequest: (_request, response) => response.end('next-http'),
        onPresenceUpgrade: (_request, socket) => socket.destroy(),
        onDocumentUpgrade: (request, socket, head) => {
          void gateway.handleDocumentUpgrade(request, socket, head);
        },
      });
      const clients: WebSocket[] = [];
      try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const port = (server.address() as AddressInfo).port;
        const origin = `http://127.0.0.1:${port}`;
        const connect = async (userId: string): Promise<WebSocket> => {
          const ticket = await issueDocumentTicket(userId, 'project-a');
          const client = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/document`, [
            'wujie-document-v1', `wujie-document-ticket.${ticket}`,
          ], { origin });
          client.on('error', () => {});
          clients.push(client);
          return client;
        };
        const owner = await connect('owner-a');
        const initial = decodedFrame((await once(owner, 'message'))[0]);
        expect(owner.protocol).toBe('wujie-document-v1');
        expect(initial.type).toBe(0x11);
        expect(initial.sequence).toBe(BigInt(0));
        const editor = await connect('editor-a');
        expect(decodedFrame((await once(editor, 'message'))[0]).sequence).toBe(BigInt(0));

        const local = createCanvasDocument();
        applyCanvasImagePatch(local, {
          placementId: 'placement-one', assetVersionId: 'version-one',
          x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
        }, 'local');
        const acknowledged = once(owner, 'message');
        let ownerFrameCount = 0;
        const ownCanonical = new Promise<ReturnType<typeof decodedFrame>>(resolve => {
          owner.on('message', data => {
            ownerFrameCount += 1;
            if (ownerFrameCount === 2) resolve(decodedFrame(data));
          });
        });
        const relayed = once(editor, 'message');
        owner.send(Buffer.concat([Buffer.from([0x02]), Buffer.from(Y.encodeStateAsUpdate(local))]));
        const ack = decodedFrame((await acknowledged)[0]);
        const remote = decodedFrame((await relayed)[0]);
        expect(ack.type).toBe(0x12);
        expect(ack.sequence).toBe(BigInt(1));
        const ownSync = await Promise.race([
          ownCanonical,
          new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('writer sequence catch-up missing')), 1200)),
        ]);
        expect(ownSync.type).toBe(0x11);
        expect(ownSync.sequence).toBe(BigInt(1));
        expect(remote.type).toBe(0x11);
        expect(remote.sequence).toBe(BigInt(1));
        const restored = createCanvasDocument();
        Y.applyUpdate(restored, remote.payload);
        expect(readCanvasDocument(restored).placements['placement-one']?.assetVersionId)
          .toBe('version-one');
        const differential = Promise.race([
          once(editor, 'message').then(([data]) => decodedFrame(data)),
          new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('state-vector response missing')), 1200)),
        ]);
        editor.send(Buffer.concat([Buffer.from([0x01]), Buffer.from(Y.encodeStateVector(restored))]));
        const diff = await differential;
        expect(diff.type).toBe(0x11);
        expect(diff.sequence).toBe(BigInt(1));
        expect(Buffer.from(diff.payload)).toEqual(Buffer.from(Y.encodeStateAsUpdate(restored, Y.encodeStateVector(restored))));
        const secondLocal = createCanvasDocument();
        applyCanvasImagePatch(secondLocal, {
          placementId: 'placement-two', assetVersionId: 'version-one',
          x: 50, y: 40, width: 90, height: 70, rotation: 0, zIndex: 2,
        }, 'second-editor');
        const editorAck = once(editor, 'message');
        const ownerRelay = once(owner, 'message');
        editor.send(Buffer.concat([Buffer.from([0x02]), Buffer.from(Y.encodeStateAsUpdate(secondLocal))]));
        expect(decodedFrame((await editorAck)[0])).toMatchObject({ type: 0x12, sequence: BigInt(2) });
        const ownerSecond = decodedFrame((await ownerRelay)[0]);
        expect(ownerSecond.type).toBe(0x11);
        expect(ownerSecond.sequence).toBe(BigInt(2));
        Y.applyUpdate(restored, ownerSecond.payload);
        expect(Object.keys(readCanvasDocument(restored).placements).sort())
          .toEqual(['placement-one', 'placement-two']);
        const row = await query<{ sequence: string }>(
          "SELECT sequence::text FROM wujie_project_canvas_documents WHERE project_id = 'project-a'",
        );
        expect(row.rows[0]?.sequence).toBe('2');
        const disconnected = once(editor, 'close');
        editor.close();
        await disconnected;
        const reconnected = await connect('editor-a');
        const resumed = decodedFrame((await once(reconnected, 'message'))[0]);
        expect(resumed.sequence).toBe(BigInt(2));
        const resumedDoc = createCanvasDocument();
        Y.applyUpdate(resumedDoc, resumed.payload);
        expect(Object.keys(readCanvasDocument(resumedDoc).placements).sort())
          .toEqual(['placement-one', 'placement-two']);
      } finally {
        for (const client of clients) client.terminate();
        await gateway.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        vi.unstubAllEnvs();
      }
    });
  });
});
