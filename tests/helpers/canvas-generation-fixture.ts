import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import * as Y from 'yjs';
import { expect } from 'vitest';
import { ensureCoreTables } from '@/lib/db-storage';
import { createCanvasDocument, applyCanvasImagePatch, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import type { QueryFn } from './postgres-test-database';
import { getPool, closePool } from '@/lib/db-client';
import { createServer, createConnection, type Socket } from 'node:net';
import { createIdempotencyLockKey } from '@/lib/task-core/idempotency';
import { loadDocument, commitDocumentUpdate } from '@/lib/collaboration/document-store';
import { isActiveOfflineBridgeTestConnection } from './offline-bridge-database-guard';

/** A real PostgreSQL gate, observed through pg_blocking_pids, never timed with sleeps. */
export async function lockCanvasSlot(root: string, index: number): Promise<{ wait: (query: QueryFn, count?: number) => Promise<void>; release: () => Promise<void> }> {
  const client = await getPool().connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [createIdempotencyLockKey('editor', `${root}:${index}`)]);
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let released = false;
  return { wait: async (query, count = 1): Promise<void> => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const blocked = (await query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))`, [pid])).rows[0].count;
      if (blocked >= count) return;
    }
    throw new Error('Expected real database lock wait was not observed');
  }, release: async (): Promise<void> => {
    if (released) return; released = true;
    try { await client.query('COMMIT'); } finally { client.release(); }
  } };
}

export async function moveCanvasSource(x: number, width: number = 100): Promise<void> {
  const loaded = await loadDocument('shared');
  try {
    applyCanvasImagePatch(loaded.doc, { placementId: 'placement-shared', x, width, zIndex: 9 }, 'move');
    await commitDocumentUpdate({ actorId: 'owner', projectId: 'shared', bytes: Y.encodeStateAsUpdate(loaded.doc) });
  } finally { loaded.doc.destroy(); }
}

/** Hold A's second core BEGIN before it reaches PG; other connections continue. */
export async function pauseCanvasSecondTransaction(databaseUrl: string): ReturnType<typeof canvasPgFault> {
  return canvasPgFault(databaseUrl, { pauseBeginIndex: 2 });
}

/** Forward real PG protocol, but lose a successful COMMIT acknowledgement. */
export async function loseCanvasCommitReply(databaseUrl: string, commitIndex: number = 1): ReturnType<typeof canvasPgFault> {
  return canvasPgFault(databaseUrl, { commitIndex });
}

async function canvasPgFault(databaseUrl: string, fault: { commitIndex?: number; pauseBeginIndex?: number }): Promise<{
  close: () => Promise<void>; dropped: () => boolean; connectionErrors: Error[];
  paused: Promise<void>; failBeforeCommit: () => void;
}> {
  const target = new URL(databaseUrl);
  const activeBridgeDatabase = isActiveOfflineBridgeTestConnection(process.env, databaseUrl);
  if (!activeBridgeDatabase && (target.hostname !== '127.0.0.1' || target.port !== '55492'
    || !['/wujie_yjs_task8cb3f_20260927', '/wujie_yjs_task8cb3g_20260927', '/wujie_yjs_task8cb3h_20260927', '/wujie_yjs_task8cb3i2_20260927'].includes(target.pathname))) throw new Error('Dedicated loopback PG required');
  const sockets = new Set<Socket>(); let dropped = false; let commits = 0; let begins = 0;
  let held: [Socket, Socket] | undefined;
  let signalPaused: () => void = (): void => {};
  const paused = new Promise<void>(resolve => { signalPaused = resolve; });
  const failBeforeCommit = (): void => { if (held) { dropped = true; held.forEach(socket => socket.destroy()); held = undefined; } };
  const connectionErrors: Error[] = [];
  const server = createServer(downstream => {
    const upstream = createConnection({ host: target.hostname, port: Number(target.port) });
    sockets.add(downstream); sockets.add(upstream);
    let startup = true; let outbound = Buffer.alloc(0); let inbound = Buffer.alloc(0); let loseReply = false;
    downstream.on('data', data => {
      outbound = Buffer.concat([outbound, data]);
      while (outbound.length >= (startup ? 4 : 5)) {
        const length = outbound.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1);
        if (outbound.length < length) break;
        const packet = outbound.subarray(0, length); outbound = outbound.subarray(length);
        if (!startup && packet[0] === 81) {
          const sql = packet.subarray(5, -1).toString().trim();
          if (sql === 'BEGIN' && ++begins === fault.pauseBeginIndex) {
            held = [downstream, upstream]; signalPaused(); return;
          }
          if (sql === 'COMMIT' && !dropped) { commits++; loseReply = commits === fault.commitIndex; }
        }
        startup = false; upstream.write(packet);
      }
    });
    upstream.on('data', data => {
      if (!loseReply) { downstream.write(data); return; }
      inbound = Buffer.concat([inbound, data]);
      while (inbound.length >= 5) {
        const length = inbound.readInt32BE(1) + 1;
        if (inbound.length < length) break;
        const packet = inbound.subarray(0, length); inbound = inbound.subarray(length);
        if (packet[0] === 67 && packet.subarray(5, -1).toString() === 'COMMIT') {
          dropped = true; downstream.destroy(); upstream.destroy(); return;
        }
      }
    });
    downstream.on('error', (): void => { upstream.destroy(); });
    upstream.on('error', (): void => { downstream.destroy(); });
    downstream.on('close', (): void => { sockets.delete(downstream); upstream.destroy(); });
    upstream.on('close', (): void => { sockets.delete(upstream); downstream.destroy(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No proxy port');
  await closePool();
  const proxy = new URL(databaseUrl); proxy.port = String(address.port); proxy.searchParams.set('sslmode', 'disable');
  process.env.DATABASE_URL = proxy.href; process.env.PGDATABASE_URL = proxy.href;
  // Observe pg's separate client error event as well as the rejected real query.
  // No query, transaction, or result is replaced. The test asserts this channel too.
  getPool().on('connect', client => client.on('error', error => { connectionErrors.push(error); }));
  console.info('Loopback PG fault proxy:', address.port, fault);
  return { dropped: (): boolean => dropped, connectionErrors, paused, failBeforeCommit, close: async (): Promise<void> => {
    failBeforeCommit();
    await closePool(); process.env.DATABASE_URL = databaseUrl; process.env.PGDATABASE_URL = databaseUrl;
    sockets.forEach(socket => socket.destroy());
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

export async function seedCanvasGeneration(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  const start = new Date().toISOString();
  const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  const log = resolve('.superpowers/sdd/2026-09-25-v588-yjs-canvas-collaboration', `task-8cb3f-migrations-${schemaName}.log`);
  writeFileSync(log, `start=${start}\nend=${new Date().toISOString()}\nexit=${migration.status}\n${migration.stdout}\n${migration.stderr}`);
  console.info('Isolation:', schemaName, 'media:', process.env.WUJIE_DATA_DIR, 'migration:', log);
  expect(migration.status, migration.stderr || migration.stdout).toBe(0);
  await ensureCoreTables();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer();
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  const doc = createCanvasDocument();
  for (const suffix of ['shared', 'second']) {
    writeFileSync(join(process.env.WUJIE_DATA_DIR!, `${suffix}.png`), png);
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ($1,'owner','shared','image')", [`asset-${suffix}`]);
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height)
      VALUES ($1,$2,'owner','shared',$3,'image/png',$4,$5,2,2)`,
    [`version-${suffix}`, `asset-${suffix}`, `/api/serve-upload/${suffix}.png`, png.length, createHash('sha256').update(png).digest('hex')]);
    await query('UPDATE wujie_assets SET current_version_id=$1 WHERE id=$2', [`version-${suffix}`, `asset-${suffix}`]);
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ($1,'owner','shared',$2,$3,'canvas','shared','canvas-image',$4)`,
    [`placement-${suffix}`, `asset-${suffix}`, `version-${suffix}`, `image-${suffix}`]);
    applyCanvasImagePatch(doc, { placementId: `placement-${suffix}`, assetVersionId: `version-${suffix}`,
      x: suffix === 'shared' ? 0 : -200, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0 }, 'fixture');
  }
  await query(`INSERT INTO wujie_project_canvas_documents(project_id,owner_id,projection,snapshot_bytes)
    VALUES ('shared','owner',$1,$2)`, [readCanvasDocument(doc), Buffer.from(Y.encodeStateAsUpdate(doc))]);
  doc.destroy();
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    SELECT 'credits_' || id,id,100,100,0,1,1 FROM wujie_users`);
  await query(`INSERT INTO wujie_system_settings(key,value,updated_at) VALUES ('credit_pricing_config',$1,1)`,
    [JSON.stringify({ modelCredits: { 'provider::gpt-image-1': 7 } })]);
}

export async function canvasBilling(query: QueryFn): Promise<{
  tasks: Record<string, unknown>[]; publications: Record<string, unknown>[];
  transactions: Record<string, unknown>[]; credits: Record<string, unknown>[];
}> {
  return { tasks: (await query('SELECT * FROM cloud_tasks ORDER BY id')).rows,
    publications: (await query('SELECT * FROM wujie_canvas_task_publications ORDER BY task_id')).rows,
    transactions: (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows,
    credits: (await query('SELECT * FROM wujie_credits ORDER BY user_id')).rows };
}
