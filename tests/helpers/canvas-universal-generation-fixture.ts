import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { seedCanvasGeneration } from './canvas-generation-fixture';
import type { QueryFn } from './postgres-test-database';
import { getPool } from '@/lib/db-client';
import { createIdempotencyLockKey } from '@/lib/task-core/idempotency';
import { isActiveOfflineBridgeTestConnection } from './offline-bridge-database-guard';
import { requireOfflineBridgeTestMediaRoot } from './offline-bridge-media-guard';

let mediaParent = 'J:/无界本地版/projects/_tmp_e2e/task8cb3h-media-20260927';
let mediaRoot: string | undefined;
export async function seedCanvasUniversal(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  const database = new URL(databaseUrl);
  const activeBridgeDatabase = isActiveOfflineBridgeTestConnection(process.env, databaseUrl)
    && new URL(databaseUrl).searchParams.get('options') === `-csearch_path=${schemaName}`;
  const legacyDatabase = database.hostname === '127.0.0.1' && database.port === '55492'
    && database.pathname === '/wujie_yjs_task8cb3h_20260927';
  if (!legacyDatabase && !activeBridgeDatabase) throw new Error('Task8Cb3h exact database and media isolation required');
  if (activeBridgeDatabase && !mediaRoot) mediaParent = requireOfflineBridgeTestMediaRoot(process.env.WUJIE_DATA_DIR);
  if (![resolve(mediaParent), mediaRoot].includes(resolve(process.env.WUJIE_DATA_DIR || ''))) {
    throw new Error('Task8Cb3h exact database and media isolation required');
  }
  mediaRoot ??= mkdtempSync(join(mediaParent, 'universal-'));
  process.env.WUJIE_DATA_DIR = mediaRoot;
  process.env.WUJIE_YJS_ENABLED = 'true';
  await seedCanvasGeneration(query, databaseUrl, schemaName);
}
export function universalBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { projectId: 'shared', model: 'gpt-image-1', providerId: 'provider', prompt: '蓝色杯子', n: 1, ...overrides };
}
/** New retained media only; never corrupt or remove an earlier fixture file. */
export async function invalidUniversalSource(query: QueryFn, kind: 'invalid' | 'oversized' | 'corrupt' | 'unavailable'): Promise<{ url: string; path: string }> {
  const root = resolve(process.env.WUJIE_DATA_DIR || '');
  if (!mediaRoot || root !== mediaRoot || !root.startsWith(`${resolve(mediaParent)}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Task8Cb3h media fixture not initialized');
  const filename = `fix1-${kind}-${randomUUID()}.png`; const path = join(root, filename);
  if (kind !== 'unavailable') writeFileSync(path, kind === 'oversized' ? Buffer.alloc(25 * 1024 * 1024 + 1)
    : kind === 'corrupt' ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) : Buffer.from('not an image'));
  const url = `/api/serve-upload/${filename}`;
  await query("UPDATE wujie_asset_versions SET file_url=$1 WHERE id='version-shared' AND availability='ready'", [url]);
  return { url, path };
}
export async function universalSnapshot(query: QueryFn): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {};
  for (const { tablename } of (await query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename')).rows) {
    const name = String(tablename).replaceAll('"', '""');
    snapshot[String(tablename)] = (await query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${name}" t`)).rows[0].rows;
  }
  return snapshot;
}
export function universalGate(): { reached: Promise<void>; enter: () => void; released: Promise<void>; release: () => void } {
  let enter!: () => void; let release!: () => void;
  return { reached: new Promise<void>(resolve => { enter = resolve; }), enter: (): void => enter(),
    released: new Promise<void>(resolve => { release = resolve; }), release: (): void => release() };
}
export async function lockUniversalAdmission(key: string): Promise<{ wait: (query: QueryFn) => Promise<void>; release: () => Promise<void> }> {
  const client = await getPool().connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [createIdempotencyLockKey('editor', key)]);
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  return { wait: async (query): Promise<void> => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if ((await query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rowCount) return;
    }
    throw new Error('Universal admission did not reach the PG lock');
  }, release: async (): Promise<void> => { try { await client.query('COMMIT'); } finally { client.release(); } } };
}
