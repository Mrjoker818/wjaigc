import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { seedCanvasGeneration } from './canvas-generation-fixture';
import type { QueryFn } from './postgres-test-database';
import { getPool } from '@/lib/db-client';
import { createIdempotencyLockKey } from '@/lib/task-core/idempotency';
import { isActiveOfflineBridgeTestConnection } from './offline-bridge-database-guard';
import { requireOfflineBridgeTestMediaRoot } from './offline-bridge-media-guard';
const mediaParent = process.env.WUJIE_DATA_DIR!;
let mediaRoot: string | undefined;

/** Logical snapshot of every table in the unique test schema. */
export async function editDatabaseSnapshot(query: QueryFn): Promise<Record<string, unknown>> {
  const tables = (await query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename")).rows;
  const snapshot: Record<string, unknown> = {};
  for (const { tablename } of tables) {
    const name = String(tablename).replaceAll('"', '""');
    snapshot[String(tablename)] = (await query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${name}" t`)).rows[0].rows;
  }
  return snapshot;
}

export async function seedCanvasEdit(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  const database = new URL(databaseUrl);
  const legacyDatabase = database.hostname === '127.0.0.1'
    && database.pathname === '/wujie_yjs_task8cb3g_20260927';
  const activeBridgeDatabase = isActiveOfflineBridgeTestConnection(process.env, databaseUrl)
    && database.searchParams.get('options') === `-csearch_path=${schemaName}`;
  if (!legacyDatabase && !activeBridgeDatabase) {
    throw new Error('Task 8Cb3g dedicated database required');
  }
  if (activeBridgeDatabase) requireOfflineBridgeTestMediaRoot(mediaParent);
  if (mediaRoot && resolve(process.env.WUJIE_DATA_DIR || '') !== resolve(mediaRoot)
    && resolve(process.env.WUJIE_DATA_DIR || '') !== resolve(mediaParent)) {
    throw new Error('Task 8Cb3g dedicated media required');
  }
  mediaRoot ??= mkdtempSync(join(mediaParent, 'task-8cb3g-'));
  process.env.WUJIE_DATA_DIR = mediaRoot;
  process.env.WUJIE_YJS_ENABLED = 'true';
  await seedCanvasGeneration(query, databaseUrl, schemaName);
}

export function editBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { projectId: 'shared', image: '/api/serve-upload/shared.png', prompt: '将主体改成蓝色',
    model: 'gpt-image-1', providerId: 'provider', assetParentVersionIds: ['version-shared'],
    assetSelectedEntityIds: ['image-shared'], ...overrides };
}

export function gate(): { reached: Promise<void>; enter: () => void; released: Promise<void>; release: () => void } {
  let enter!: () => void;
  let release!: () => void;
  return { reached: new Promise<void>(resolve => { enter = resolve; }), enter: (): void => enter(),
    released: new Promise<void>(resolve => { release = resolve; }), release: (): void => release() };
}

export async function lockEditAdmission(key: string): Promise<{ wait: (query: QueryFn) => Promise<void>; release: () => Promise<void> }> {
  const client = await getPool().connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [createIdempotencyLockKey('editor', key)]);
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  return { wait: async (query): Promise<void> => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if ((await query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rowCount) return;
    }
    throw new Error('Edit admission did not reach the real PG lock');
  }, release: async (): Promise<void> => { try { await client.query('COMMIT'); } finally { client.release(); } } };
}
