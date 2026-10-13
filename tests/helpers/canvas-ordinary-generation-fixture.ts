import { basename, dirname, resolve, sep } from 'node:path';
import { seedCanvasGeneration } from './canvas-generation-fixture';
import type { QueryFn } from './postgres-test-database';
import { createConnection, createServer, type Socket } from 'node:net';
import { closePool, getPool } from '@/lib/db-client';
import { isActiveOfflineBridgeTestConnection } from './offline-bridge-database-guard';
import { registerOwnedFaultProxy, cleanupOwnedFaultProxy } from './owned-postgres-fault-proxy';
import { requireOfflineBridgeTestMediaRoot } from './offline-bridge-media-guard';

export function assertOrdinaryEnvironment(databaseUrl: string, media: string): void {
  const database = new URL(databaseUrl);
  const mediaRoot = resolve('J:/无界本地版/projects/_tmp_e2e/task8cb3i2-media-20260927');
  const actualMedia = resolve(media);
  const legacyDatabase = database.hostname === '127.0.0.1' && database.port === '55492'
    && database.pathname === '/wujie_yjs_task8cb3i2_20260927';
  const legacyMedia = actualMedia === mediaRoot || actualMedia.startsWith(`${mediaRoot}${sep}`);
  let activeBridgeMedia = false;
  if (isActiveOfflineBridgeTestConnection(process.env, databaseUrl)
    && /^ordinary-(?:admission|route)-[a-z0-9]+$/i.test(basename(actualMedia))) {
    try {
      activeBridgeMedia = requireOfflineBridgeTestMediaRoot(dirname(actualMedia)) === dirname(actualMedia);
    } catch { activeBridgeMedia = false; }
  }
  if (!(legacyDatabase && legacyMedia) && !activeBridgeMedia) {
    throw new Error('Task8Cb3i2 dedicated database and media required');
  }
}

export async function seedOrdinaryGeneration(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  assertOrdinaryEnvironment(databaseUrl, process.env.WUJIE_DATA_DIR || '');
  await seedCanvasGeneration(query, databaseUrl, schemaName);
}

/** Real wire failure after an autocommitted completion UPDATE, not a mocked storage result. */
export async function loseOrdinaryCompletionReply(databaseUrl: string): Promise<{ dropped: () => boolean; close: () => Promise<void> }> {
  if (typeof databaseUrl !== 'string') throw new Error('OWNED_PROXY_INPUT');
  assertOrdinaryEnvironment(databaseUrl, process.env.WUJIE_DATA_DIR || '');
  const target = new URL(databaseUrl); const sockets = new Set<Socket>(); let dropped = false;
  const server = createServer(downstream => {
    const upstream = createConnection({ host: '127.0.0.1', port: Number(target.port) });
    sockets.add(downstream); sockets.add(upstream);
    let startup = true; let outbound = Buffer.alloc(0); let inbound = Buffer.alloc(0);
    let intercept = false; let updated = false;
    downstream.on('data', data => {
      outbound = Buffer.concat([outbound, data]);
      while (outbound.length >= (startup ? 4 : 5)) {
        const length = startup ? outbound.readInt32BE(0) : outbound.readInt32BE(1) + 1;
        if (outbound.length < length) return;
        const packet = outbound.subarray(0, length); outbound = outbound.subarray(length);
        if (startup && length === 8 && packet.readInt32BE(4) === 80877103) { downstream.write('N'); continue; }
        if (!startup && (packet[0] === 81 || packet[0] === 80)) {
          const sql = packet[0] === 80 ? packet.subarray(5).toString().split('\0')[1] : packet.subarray(5, -1).toString();
          if (!dropped && sql.includes("RETURNING id, status = 'completed' AS committed")) intercept = true;
        }
        startup = false; upstream.write(packet);
      }
    });
    upstream.on('data', data => {
      if (!intercept) { downstream.write(data); return; }
      inbound = Buffer.concat([inbound, data]);
      let offset = 0;
      while (inbound.length - offset >= 5) {
        const length = inbound.readInt32BE(offset + 1) + 1;
        if (inbound.length - offset < length) break;
        const packet = inbound.subarray(offset, offset + length); offset += length;
        if (packet[0] === 67 && packet.subarray(5, -1).toString() === 'UPDATE 1') updated = true;
        if (packet[0] === 90) {
          if (updated) { dropped = true; downstream.destroy(); upstream.destroy(); return; }
          downstream.write(inbound); inbound = Buffer.alloc(0); intercept = false; return;
        }
      }
    });
    downstream.on('error', () => upstream.destroy()); upstream.on('error', () => downstream.destroy());
    downstream.on('close', () => { sockets.delete(downstream); upstream.destroy(); });
    upstream.on('close', () => { sockets.delete(upstream); downstream.destroy(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let revoke: () => void = (): void => {};
  let environmentBound = false;
  const restoreEnvironment = (): void => { process.env.DATABASE_URL = databaseUrl; process.env.PGDATABASE_URL = databaseUrl; };
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No loopback port');
    revoke = registerOwnedFaultProxy(server, databaseUrl, import.meta.url);
    await closePool();
    const proxy = new URL(databaseUrl); proxy.port = String(address.port); proxy.searchParams.set('sslmode', 'disable');
    environmentBound = true;
    process.env.DATABASE_URL = proxy.href; process.env.PGDATABASE_URL = proxy.href;
    getPool().on('connect', client => client.on('error', () => { /* Query rejection carries the actual connection failure. */ }));
  } catch (primaryError) {
    await cleanupOwnedFaultProxy({ server, sockets, revoke, restoreEnvironment, primaryError,
      closePool: environmentBound ? closePool : async (): Promise<void> => {} });
    throw primaryError;
  }
  return { dropped: () => dropped, close: async (): Promise<void> => {
    await cleanupOwnedFaultProxy({ server, sockets, revoke, closePool, restoreEnvironment });
  } };
}
