import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, lstat, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { BigIntStats } from 'node:fs';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ pool: null as Pool | null, root: '' }));
vi.mock('@/lib/db-client', () => ({
  isDatabaseConfigured: (): boolean => true,
  execSql: async (sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    const result = await state.pool!.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  },
}));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: (): string => state.root }));
import { recordAssetCleanupFailure, drainPendingAssetCleanup } from '@/lib/asset-core/cleanup-outbox';
import type { BinaryLocalIdentity } from '@/lib/asset-core/binary-local-identity';

async function ownedIdentity(key: string): Promise<BinaryLocalIdentity> {
  const from = (stats: BigIntStats): { dev: string; ino: string; birthtimeNs: string } => ({
    dev: String(stats.dev), ino: String(stats.ino), birthtimeNs: String(stats.birthtimeNs),
  });
  return { version: 1, directory: from(await lstat(join(state.root, 'exports'), { bigint: true })),
    file: from(await lstat(join(state.root, key), { bigint: true })) };
}

const url = requireOfflineBridgeTestDatabaseUrl(process.env);
const schema = `task8b2a_${randomUUID().replaceAll('-', '')}`;
let admin: Pool;
function connect(): Pool { return new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 2 }); }

beforeAll(async () => {
  admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  state.pool = connect();
  for (const migration of ['20260810_wj_stable_s2_assets.sql', '20260909_mpe_export_cleanup_outbox.sql', '20260910_mpe_export_cleanup_leases.sql']) {
    await state.pool.query(await readFile(resolve('migrations', migration), 'utf8'));
  }
  const identityMigration = await readFile(resolve('migrations/20260927_asset_cleanup_local_identity.sql'), 'utf8');
  await state.pool.query(identityMigration);
  await state.pool.query(identityMigration);
  state.root = await mkdtemp(join(tmpdir(), 'task8b2a-cleanup-pg-'));
  await mkdir(join(state.root, 'exports'));
  vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'http://127.0.0.1:1');
  vi.stubEnv('COZE_BUCKET_NAME', 'controlled-transport');
});

afterAll(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await state.pool?.end();
  if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  if (state.root) await rm(state.root, { recursive: true, force: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await state.pool!.query('DELETE FROM wujie_asset_cleanup_outbox');
});

it('persists media cleanup failure, reconnects, retries exact S3 deletion, and protects an asset reference', async () => {
  const key = 'exports/0123456789abcdef-video.webm';
  const protectedKey = 'exports/0123456789abcdef-kept.mp4';
  const objects = new Set([key, protectedKey]);
  let offline = true;
  vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown): Promise<unknown> => {
    if (!(command instanceof DeleteObjectCommand)) throw new Error('unexpected S3 command');
    if (offline) throw new Error('injected storage outage');
    objects.delete(command.input.Key!); return {};
  }) as never);
  await writeFile(join(state.root, key), 'disposable-media');
  await recordAssetCleanupFailure({ rootId: 'server-data', localPath: key, localIdentity: await ownedIdentity(key), storageKey: key, lastError: 'failed compensation' });
  expect(await drainPendingAssetCleanup()).toEqual({ completed: 0, failed: 1 });
  const first = await state.pool!.query('SELECT status, attempt_count, last_error FROM wujie_asset_cleanup_outbox');
  expect(first.rows[0]).toMatchObject({ status: 'pending', attempt_count: 1, last_error: 'S3_BINARY_DELETE_FAILED' });
  expect(objects.has(key)).toBe(true);
  await expect(readFile(join(state.root, key))).rejects.toMatchObject({ code: 'ENOENT' });
  await state.pool!.end(); state.pool = connect(); offline = false;
  expect(await drainPendingAssetCleanup({ now: new Date(Date.now() + 60000) })).toEqual({ completed: 1, failed: 0 });
  expect(objects.has(key)).toBe(false);
  expect((await state.pool!.query('SELECT status, attempt_count FROM wujie_asset_cleanup_outbox')).rows[0])
    .toMatchObject({ status: 'completed', attempt_count: 2 });

  await state.pool!.query("INSERT INTO wujie_projects(id, owner_id) VALUES ('p', 'actor')");
  await state.pool!.query("INSERT INTO wujie_assets(id, owner_id, project_id, kind) VALUES ('a', 'actor', 'p', 'video')");
  await state.pool!.query("INSERT INTO wujie_asset_versions(id, asset_id, owner_id, project_id, file_url, storage_key) VALUES ('v', 'a', 'actor', 'p', $1, $2)", [`/api/serve-upload/${protectedKey}`, protectedKey]);
  await writeFile(join(state.root, protectedKey), 'protected-media');
  await recordAssetCleanupFailure({ rootId: 'server-data', localPath: protectedKey, storageKey: protectedKey, lastError: 'late cleanup' });
  expect(await drainPendingAssetCleanup()).toEqual({ completed: 1, failed: 0 });
  expect(objects.has(protectedKey)).toBe(true);
  expect(await readFile(join(state.root, protectedKey), 'utf8')).toBe('protected-media');
});

it('retains an existing export record without ownership identity and does not delete its paired S3 object', async () => {
  const key = 'exports/0123456789abcdef-legacy.mp4';
  await writeFile(join(state.root, key), 'legacy-owned-by-unknown');
  const objects = new Set([key]);
  vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown): Promise<unknown> => {
    if (!(command instanceof DeleteObjectCommand)) throw new Error('unexpected command');
    objects.delete(command.input.Key!); return {};
  }) as never);
  await recordAssetCleanupFailure({ rootId: 'server-data', localPath: key, storageKey: key, lastError: 'old record' });
  expect(await drainPendingAssetCleanup()).toEqual({ completed: 0, failed: 1 });
  expect(await readFile(join(state.root, key), 'utf8')).toBe('legacy-owned-by-unknown');
  expect(objects.has(key)).toBe(true);
  const row = (await state.pool!.query('SELECT status, last_error FROM wujie_asset_cleanup_outbox WHERE local_path=$1', [key])).rows[0];
  expect(row).toMatchObject({ status: 'pending', last_error: 'ASSET_CLEANUP_LOCAL_IDENTITY_REQUIRED' });
});

it('keeps each identity generation separate across enqueue conflicts and reconnect', async () => {
  const key = 'exports/0123456789abcdef-generations.mp4';
  await writeFile(join(state.root, key), 'first');
  const first = await ownedIdentity(key);
  await rename(join(state.root, key), join(state.root, 'displaced-generation'));
  await writeFile(join(state.root, key), 'second');
  const second = await ownedIdentity(key);
  // The old snapshot is submitted after failure/replacement: it must not adopt second.
  for (const localIdentity of [first, second, first]) {
    await recordAssetCleanupFailure({ rootId: 'server-data', localPath: key, localIdentity, lastError: 'retry' });
  }
  const rows = (await state.pool!.query('SELECT id, target_hash, local_identity FROM wujie_asset_cleanup_outbox')).rows;
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map(row => row.target_hash)).size).toBe(2);
  expect(rows.map(row => row.local_identity)).toEqual(expect.arrayContaining([first, second]));
  // Exercise the old generation alone after reconnect.
  await state.pool!.query("UPDATE wujie_asset_cleanup_outbox SET next_attempt_at=NOW()+INTERVAL '1 day' WHERE local_identity=$1::jsonb", [JSON.stringify(second)]);
  await state.pool!.end(); state.pool = connect();
  expect(await drainPendingAssetCleanup()).toEqual({ completed: 0, failed: 1 });
  expect(await readFile(join(state.root, key), 'utf8')).toBe('second');
  expect((await state.pool!.query('SELECT last_error FROM wujie_asset_cleanup_outbox WHERE local_identity=$1::jsonb', [JSON.stringify(first)])).rows[0].last_error).toBe('ASSET_FILE_IDENTITY_CHANGED');
  // Matching generation is independently eligible and removes only that object.
  await state.pool!.query("UPDATE wujie_asset_cleanup_outbox SET next_attempt_at=CASE WHEN local_identity=$1::jsonb THEN NOW()-INTERVAL '1 second' ELSE NOW()+INTERVAL '1 day' END", [JSON.stringify(second)]);
  expect(await drainPendingAssetCleanup()).toEqual({ completed: 1, failed: 0 });
  await expect(readFile(join(state.root, key))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(state.root, 'displaced-generation'), 'utf8')).toBe('first');
});

it('retains mismatched temporary file/parent identities and paired S3 objects', async () => {
  const key = 'exports/.parent-swap.recover.tmp';
  await writeFile(join(state.root, key), 'owned');
  const localIdentity = await ownedIdentity(key);
  await rename(join(state.root, 'exports'), join(state.root, 'displaced-exports'));
  await mkdir(join(state.root, 'exports'));
  await writeFile(join(state.root, key), 'foreign');
  const storageKey = 'exports/0123456789abcdef-parent.mp4';
  const objects = new Set([storageKey]);
  vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown): Promise<unknown> => {
    if (!(command instanceof DeleteObjectCommand)) throw new Error('unexpected command');
    objects.delete(command.input.Key!); return {};
  }) as never);
  await recordAssetCleanupFailure({ rootId: 'server-data', localPath: key, localIdentity, storageKey, lastError: 'failure' });
  expect(await drainPendingAssetCleanup()).toEqual({ completed: 0, failed: 1 });
  expect(await readFile(join(state.root, key), 'utf8')).toBe('foreign');
  expect(objects.has(storageKey)).toBe(true);
});

it('resolves an already absent legacy local object without inferring ownership', async () => {
  await recordAssetCleanupFailure({ rootId: 'server-data', localPath: 'exports/0123456789abcdef-absent.mp4', lastError: 'legacy' });
  expect(await drainPendingAssetCleanup()).toEqual({ completed: 1, failed: 0 });
});

it('does not let a stale SQL lease complete or retry over a reclaimed token', async () => {
  const storageKey = 'exports/0123456789abcdef-lease.mp4';
  for (const fail of [false, true]) {
    await recordAssetCleanupFailure({ rootId: 'server-data', storageKey, lastError: 'lease probe' });
    const replacement = randomUUID();
    vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (): Promise<unknown> => {
      await state.pool!.query('UPDATE wujie_asset_cleanup_outbox SET lease_token=$1 WHERE storage_key=$2', [replacement, storageKey]);
      if (fail) throw new Error('late failure');
      return {};
    }) as never);
    expect(await drainPendingAssetCleanup()).toEqual({ completed: 0, failed: 1 });
    expect((await state.pool!.query('SELECT status,lease_token,last_error FROM wujie_asset_cleanup_outbox WHERE storage_key=$1', [storageKey])).rows[0])
      .toMatchObject({ status: 'processing', lease_token: replacement, last_error: 'lease probe' });
  }
});

it('applies and reapplies the ownership migration without backfilling an old record', async () => {
  const temporarySchema = `task8b2a_migration_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${temporarySchema}`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${temporarySchema}`, max: 1 });
  try {
    for (const file of ['20260909_mpe_export_cleanup_outbox.sql', '20260910_mpe_export_cleanup_leases.sql']) {
      await pool.query(await readFile(resolve('migrations', file), 'utf8'));
    }
    const id = randomUUID();
    await pool.query("INSERT INTO wujie_asset_cleanup_outbox(id,target_hash,root_id,local_path,last_error) VALUES ($1,$2,'server-data','exports/.old.tmp','old')", [id, 'a'.repeat(64)]);
    const migration = await readFile(resolve('migrations/20260927_asset_cleanup_local_identity.sql'), 'utf8');
    await pool.query(migration); await pool.query(migration);
    expect((await pool.query('SELECT id,local_identity,status FROM wujie_asset_cleanup_outbox')).rows)
      .toEqual([{ id, local_identity: null, status: 'pending' }]);
  } finally { await pool.end(); await admin.query(`DROP SCHEMA ${temporarySchema} CASCADE`); }
});
