import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { createBillableTask, type CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { ensureCoreTables } from '@/lib/db-storage';
import { adoptDocumentTaskResult, importDocumentAssetVersion, importDocumentUpload } from '@/lib/collaboration/document-media-import';
import { grantDocumentEditor, revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { getServerDataRoot } from '@/lib/server-data-root';
import { getPool } from '@/lib/db-client';
import { assetBinaryFileOps } from '@/lib/asset-core/binary-file-ops';
import * as managedMedia from '@/lib/asset-core/managed-media-read';
import { executeDocumentAssetCommand } from '@/lib/collaboration/document-asset-commands';
import { POST } from '@/app/api/collaboration/document-assets/adopt/route';
import { NextRequest } from 'next/server';
import type { PoolClient, QueryResult } from 'pg';

// Bind before ANY product import: server-data-root caches its first resolution.
const roots = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const paths = await import('node:path');
  const os = await import('node:os');
  const previousRoot = process.env.WUJIE_DATA_DIR;
  const base = previousRoot ?? os.tmpdir();
  if (!base || !paths.isAbsolute(base) || !fs.statSync(base).isDirectory()) throw new Error('Valid existing media base required');
  const root = fs.mkdtempSync(paths.join(base, 'publication-import-'));
  process.env.WUJIE_DATA_DIR = root;
  return { base, root, previousRoot };
});
vi.mock('server-only', () => ({}));
const auth = vi.hoisted(() => ({ id: 'editor' }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async (): Promise<{ id: string }> => auth }));
let image: Buffer;
beforeAll(async (): Promise<void> => {
  expect(path.resolve(getServerDataRoot())).toBe(path.resolve(roots.root));
  const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('Explicit POSTGRES_TEST_DATABASE_URL required');
  const db = new URL(databaseUrl);
  expect(['127.0.0.1', 'localhost', '[::1]', '::1']).toContain(db.hostname);
  await mkdir(path.join(roots.root, 'images'), { recursive: true });
  image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer();
  await writeFile(path.join(roots.root, 'images/source.png'), image);
});
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); auth.id = 'editor'; });
afterAll(async (): Promise<void> => {
  const relative = path.relative(path.resolve(roots.base), path.resolve(roots.root));
  expect(relative.startsWith('publication-import-') && !relative.includes(path.sep)).toBe(true);
  await rm(roots.root, { recursive: true, force: true });
  if (roots.previousRoot === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = roots.previousRoot;
});

async function seed(query: QueryFn, databaseUrl: string, actorId: string = 'editor', frozen: boolean = true): Promise<void> {
  const migration = spawnSync(process.execPath, [path.resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  console.log('Full migrations:', migration.status, migration.stdout, migration.stderr);
  expect(migration.status, migration.stderr || migration.stdout).toBe(0);
  await ensureCoreTables();
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner','Owner','test','active',1,1),('editor','Editor','test','active',1,1)`);
  await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('shared','owner','Shared'),('other','owner','Other')");
  await query(`INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled)
    VALUES ('shared','owner',true),('other','owner',true)`);
  await query(`INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id)
    VALUES ('shared','owner','editor'),('other','owner','editor')`);
  await query("INSERT INTO wujie_project_canvas_documents (project_id,owner_id) VALUES ('shared','owner')");
  await query(`INSERT INTO wujie_credits (id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    SELECT 'credits_'||id,id,100,100,0,1,1 FROM wujie_users`);
  const input: CreateBillableTaskInput = {
    userId: actorId, idempotencyKey: 'task', requestDigest: 'digest', creditCost: 7,
    task: { id: 'task', projectId: 'shared', type: 'image-generate', status: 'processing', progress: 0, createdAt: 1, updatedAt: 1 },
    ...(frozen ? { canvasPublication: { access: { kind: 'document' as const, actorUserId: actorId,
      ownerId: 'owner', projectId: 'shared', grantGeneration: actorId === 'owner' ? '0' : '1' },
    workspace: 'canvas' as const, workspaceId: 'shared' } } : {}),
  };
  expect(await createBillableTask(input)).toMatchObject({ charged: true });
  await query("UPDATE cloud_tasks SET status='completed',progress=100,result=$1::jsonb WHERE id='task'",
    [JSON.stringify({ imageUrl: '/api/serve-upload/images/source.png' })]);
  expect((await query('SELECT user_id,balance FROM wujie_credits ORDER BY user_id')).rows).toEqual([
    { user_id: 'editor', balance: actorId === 'editor' ? 93 : 100 }, { user_id: 'owner', balance: actorId === 'owner' ? 93 : 100 },
  ]);
}
const command = { action: 'attach' as const, transform: { x: 10, y: 20, width: 32, height: 24, rotation: 0, zIndex: 1 } };
const request = { projectId: 'shared', taskId: 'task', outputIndex: 0, idempotencyKey: 'adopt', command };
const sharedTables = ['wujie_projects', 'wujie_assets', 'wujie_asset_versions', 'wujie_workspace_placements',
  'wujie_project_canvas_documents', 'wujie_project_canvas_updates', 'wujie_canvas_asset_commands', 'wujie_canvas_media_lineage'];
const chargeTables = ['cloud_tasks', 'wujie_credits', 'wujie_credit_transactions', 'wujie_canvas_task_publications'];
async function snapshot(query: QueryFn, tables: string[] = sharedTables): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const table of tables) result[table] = (await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
}
async function files(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(roots.root, { recursive: true })).sort()) {
    if (!(await stat(path.join(roots.root, name))).isFile()) continue;
    result[name] = createHash('sha256').update(await readFile(path.join(roots.root, name))).digest('hex');
  }
  return result;
}
async function regrant(): Promise<void> {
  await revokeDocumentEditor('owner', 'shared', 'editor');
  await grantDocumentEditor('owner', 'shared', 'editor');
}

// Missing expectedGrantGeneration must fail this test by accepting the old task.
it('rejects grant1 charged completed task after revoke/grant3 without shared, billing or file writes', async (): Promise<void> => {
  await withIsolatedPostgres('publication-import-red', async ({ query, databaseUrl }): Promise<void> => {
    await seed(query, databaseUrl);
    const chargedCompleted = await snapshot(query, chargeTables);
    await regrant();
    expect((await query("SELECT grant_generation::text FROM wujie_project_document_editors WHERE project_id='shared'")).rows)
      .toEqual([{ grant_generation: '3' }]);
    const before = await snapshot(query); const beforeFiles = await files();
    // Collect the outcome first so RED also exposes all unauthorized side effects.
    const outcome: unknown = await adoptDocumentTaskResult('editor', request).catch((error: unknown): unknown => error);
    expect.soft(outcome).toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    expect.soft(await snapshot(query)).toEqual(before);
    expect.soft(await snapshot(query, chargeTables)).toEqual(chargedCompleted);
    expect.soft(await files()).toEqual(beforeFiles);
  });
}, 60_000);

function post(value: unknown = request): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/collaboration/document-assets/adopt', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(value),
  }));
}
async function unchanged(query: QueryFn, rows: Record<string, unknown>, billing: Record<string, unknown>, media: Record<string, string>): Promise<void> {
  expect(await snapshot(query)).toEqual(rows);
  expect(await snapshot(query, chargeTables)).toEqual(billing);
  expect(await files()).toEqual(media);
}

it.each(['editor', 'owner'])('admits original %s generation through real POST, replays and never resurrects deleted placement', async (actorId): Promise<void> => {
  await withIsolatedPostgres('publication-success', async ({ query, databaseUrl }): Promise<void> => {
    await seed(query, databaseUrl, actorId); auth.id = actorId;
    const billing = await snapshot(query, chargeTables);
    const response = await post(); expect(response.status).toBe(200);
    const { success, ...result } = await response.json(); expect(success).toBe(true);
    expect(result.documentSequence).toBe(1);
    const placement = (await query('SELECT id,entity_id,owner_id,asset_version_id FROM wujie_workspace_placements')).rows[0];
    expect(placement).toMatchObject({ id: result.placementId, owner_id: 'owner', asset_version_id: result.assetVersionId });
    expect(placement.entity_id).not.toBe(placement.id);
    expect((await query("SELECT projection FROM wujie_project_canvas_documents WHERE project_id='shared'")).rows[0].projection.placements)
      .toEqual({ [placement.id]: { assetVersionId: result.assetVersionId, ...command.transform } });
    const before = await snapshot(query); const media = await files();
    expect(await adoptDocumentTaskResult(actorId, request)).toEqual(result);
    await unchanged(query, before, billing, media);
    await executeDocumentAssetCommand({ actorId, projectId: 'shared', idempotencyKey: 'delete',
      command: { action: 'remove', placementId: result.placementId, expectedAssetVersionId: result.assetVersionId } });
    const deleted = await snapshot(query);
    expect(await adoptDocumentTaskResult(actorId, request)).toEqual(result);
    expect((await query('SELECT status FROM wujie_workspace_placements')).rows).toEqual([{ status: 'trashed' }]);
    await unchanged(query, deleted, billing, media);
    if (actorId === 'editor') {
      await regrant();
      const denied = await post(); expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ success: false, code: 'DOCUMENT_FORBIDDEN' });
      await unchanged(query, deleted, billing, media);
    }
  });
}, 60_000);

const denials: Array<[string, string, number, string]> = [
  ['owner-disabled', "UPDATE wujie_users SET status='disabled' WHERE id='owner'", 403, 'DOCUMENT_FORBIDDEN'],
  ['editor-disabled', "UPDATE wujie_users SET status='disabled' WHERE id='editor'", 403, 'DOCUMENT_FORBIDDEN'],
  ['archived', "UPDATE wujie_projects SET status='trashed' WHERE id='shared'", 403, 'DOCUMENT_FORBIDDEN'],
  ['document-missing', "DELETE FROM wujie_project_canvas_documents WHERE project_id='shared'", 403, 'DOCUMENT_FORBIDDEN'],
  ['setting-disabled', "UPDATE wujie_project_document_settings SET enabled=false WHERE project_id='shared'", 503, 'DOCUMENT_PROJECT_NOT_ENABLED'],
  ['global-disabled', '', 503, 'DOCUMENT_DISABLED'],
];
it.each(denials)('rejects frozen %s without changing completed task/credits/files', async (_mode, sql, status, code): Promise<void> => {
  await withIsolatedPostgres('publication-denied', async ({ query, databaseUrl }): Promise<void> => {
    await seed(query, databaseUrl);
    if (sql) await query(sql); else vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    const before = await snapshot(query); const billing = await snapshot(query, chargeTables); const media = await files();
    const response = await post(); expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ success: false, code });
    await unchanged(query, before, billing, media);
  });
}, 60_000);

it('rejects forged login, authoritative tuple/task mismatch and extra JSON permission fields', async (): Promise<void> => {
  await withIsolatedPostgres('publication-forgery', async ({ query, databaseUrl }): Promise<void> => {
    await seed(query, databaseUrl);
    const before = await snapshot(query); const billing = await snapshot(query, chargeTables); const media = await files();
    await expect(adoptDocumentTaskResult('owner', request)).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    for (const extra of [{ ownerId: 'editor' }, { grantGeneration: '3' }, { publication: null }, { skipAuthorization: true },
      { canvasPublication: { actorId: 'editor', ownerId: 'owner', grantGeneration: '3' } }]) {
      const response = await post({ ...request, ...extra }); expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_MEDIA_INVALID' });
    }
    await unchanged(query, before, billing, media);
    for (const sql of ["UPDATE cloud_tasks SET user_id='owner'", "UPDATE cloud_tasks SET project_id='other'",
      "UPDATE wujie_canvas_task_publications SET actor_id='owner',grant_generation=0",
      "UPDATE wujie_canvas_task_publications SET project_id='other',workspace_id='other'"]) {
      await query('BEGIN');
      // Corrupt only this disposable schema, commit so real service sessions see it.
      await query(sql); await query('COMMIT');
      const baseline = await snapshot(query, chargeTables);
      await expect(adoptDocumentTaskResult('editor', request)).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      await unchanged(query, before, baseline, media);
      await query("UPDATE cloud_tasks SET user_id='editor',project_id='shared'");
      await query("UPDATE wujie_canvas_task_publications SET actor_id='editor',project_id='shared',workspace_id='shared',grant_generation=1");
    }
  });
}, 60_000);

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: (): void => resolve() };
}
function stagedBarrier(): { arrived: Promise<void>; release(): void } {
  const arrived = deferred(); const released = deferred(); const write = assetBinaryFileOps.writeFile;
  let first = true;
  vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (...args: Parameters<typeof write>): Promise<void> => {
    await write(...args);
    if (first) { first = false; arrived.resolve(); await released.promise; }
  });
  return { arrived: arrived.promise, release: released.resolve };
}

it('returns HTTP 403 when target is archived after the preparation permission snapshot during real media IO', async (): Promise<void> => {
  await withIsolatedPostgres('publication-target-archive', async ({ query, databaseUrl }): Promise<void> => {
    await seed(query, databaseUrl);
    // A committed placement makes preparation validate real existing media AFTER
    // committing its permission snapshot, but BEFORE taking the final task lock.
    await adoptDocumentTaskResult('editor', request);
    const billing = await snapshot(query, chargeTables); const media = await files();
    const arrived = deferred(); const released = deferred();
    const inspect = managedMedia.getManagedAssetMediaDescriptor;
    let first = true;
    vi.spyOn(managedMedia, 'getManagedAssetMediaDescriptor').mockImplementation(async (...args: Parameters<typeof inspect>): ReturnType<typeof inspect> => {
      const descriptor = await inspect(...args);
      if (first) { first = false; arrived.resolve(); await released.promise; }
      return descriptor;
    });
    const pending = post({ ...request, idempotencyKey: 'archive-race' });
    await arrived.promise;
    let before: Record<string, unknown>;
    try {
      // Prove there is newly prepared media to clean up, not a vacuous early denial.
      expect(Object.keys(await files())).toHaveLength(Object.keys(media).length + 1);
      await query("SET lock_timeout='1000ms'");
      await query("UPDATE wujie_projects SET status='trashed' WHERE id='shared'");
      before = await snapshot(query);
    } finally { released.resolve(); }
    const response = await pending;
    expect.soft(response.status).toBe(403);
    expect.soft(await response.json()).toEqual({ success: false, code: 'DOCUMENT_FORBIDDEN' });
    // Include the external archive in the baseline, but no import writes, task
    // changes, second charge/refund, or loss of previously committed media.
    await unchanged(query, before!, billing, media);
  });
}, 60_000);

type QueryIntercept = (client: PoolClient, sql: string, next: () => Promise<QueryResult>) => Promise<QueryResult>;
function interceptQueries(intercept: QueryIntercept): () => void {
  const pool = getPool(); const seen = new Set<PoolClient>(); const restores: Array<() => void> = [];
  const acquire = (client: PoolClient): void => {
    if (seen.has(client)) return;
    seen.add(client); const query = client.query.bind(client);
    type Callback = (error: Error | null, result?: QueryResult) => void;
    const spy = vi.spyOn(client, 'query').mockImplementation(((sql: string, values?: unknown[] | Callback, callback?: Callback): Promise<QueryResult> | undefined => {
      const parameters = Array.isArray(values) ? values : undefined; const done = typeof values === 'function' ? values : callback;
      const pending = intercept(client, sql, () => query(sql, parameters));
      if (done) { void pending.then(result => done(null, result), (error: Error) => done(error)); return undefined; }
      return pending;
    }) as PoolClient['query']);
    restores.push((): void => spy.mockRestore());
  };
  pool.on('acquire', acquire);
  return (): void => { pool.off('acquire', acquire); restores.forEach(restore => restore()); };
}

// Compare null as well as populated snapshots; never silently upgrade/downgrade.
it.each(['regrant', 'delete', 'insert', 'generation', 'actor', 'owner', 'workspace', 'document-missing', 'setting-disabled', 'global-disabled'])(
  'rejects %s during actual staged media IO and removes only uncommitted media', async (mode): Promise<void> => {
    await withIsolatedPostgres('publication-media-race', async ({ query, databaseUrl }): Promise<void> => {
      await seed(query, databaseUrl, 'editor', mode !== 'insert');
      const beforeFiles = await files(); const barrier = stagedBarrier();
      const pending = adoptDocumentTaskResult('editor', request).catch((error: unknown): unknown => error);
      await barrier.arrived;
      let before: Record<string, unknown>; let billing: Record<string, unknown>;
      try {
        await query("SET lock_timeout='1000ms'");
        if (mode === 'regrant') await regrant();
        if (mode === 'delete') await query('DELETE FROM wujie_canvas_task_publications');
        if (mode === 'insert') await query(`INSERT INTO wujie_canvas_task_publications
          (task_id,actor_id,owner_id,project_id,workspace_id,grant_generation) VALUES ('task','editor','owner','shared','shared',1)`);
        if (mode === 'generation') {
          await regrant(); await query('UPDATE wujie_canvas_task_publications SET grant_generation=3');
        }
        if (mode === 'actor') await query("UPDATE cloud_tasks SET user_id='owner'");
        if (mode === 'owner' || mode === 'workspace') {
          // Exercise defensive validation even if a DBA bypassed constraints.
          const checks = await query<{ conname: string }>(`SELECT conname FROM pg_constraint
            WHERE conrelid='wujie_canvas_task_publications'::regclass AND contype IN ('c','f')`);
          for (const row of checks.rows) await query(`ALTER TABLE wujie_canvas_task_publications DROP CONSTRAINT "${row.conname}"`);
          await query(mode === 'owner' ? "UPDATE wujie_canvas_task_publications SET owner_id='editor'" :
            "UPDATE wujie_canvas_task_publications SET workspace_id='other'");
        }
        if (mode === 'document-missing') await query("DELETE FROM wujie_project_canvas_documents WHERE project_id='shared'");
        if (mode === 'setting-disabled') await query("UPDATE wujie_project_document_settings SET enabled=false WHERE project_id='shared'");
        if (mode === 'global-disabled') vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
        before = await snapshot(query); billing = await snapshot(query, chargeTables);
      } finally { barrier.release(); }
      const code = mode === 'setting-disabled' ? 'DOCUMENT_PROJECT_NOT_ENABLED' : mode === 'global-disabled' ? 'DOCUMENT_DISABLED' : 'DOCUMENT_FORBIDDEN';
      expect(await pending).toMatchObject({ code });
      await unchanged(query, before!, billing!, beforeFiles);
    });
  }, 60_000);

it('rechecks after acquiring the idempotency lock, before any media is prepared', async (): Promise<void> => {
  await withIsolatedPostgres('publication-lock-phase', async ({ query, databaseUrl }): Promise<void> => {
    await seed(query, databaseUrl); const before = await snapshot(query); const billing = await snapshot(query, chargeTables); const media = await files();
    let first = true;
    const restore = interceptQueries(async (_client, sql, next): Promise<QueryResult> => {
      const result = await next();
      if (sql === 'COMMIT' && first) { first = false; await regrant(); }
      return result;
    });
    try { await expect(adoptDocumentTaskResult('editor', request)).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' }); }
    finally { restore(); }
    await unchanged(query, before, billing, media);
  });
}, 60_000);

it.each(['publication-read', 'task-read', 'document-read', 'missing-table', 'connect', 'BEGIN', 'COMMIT'])(
  'maps real %s SQL failure to fixed HTTP 503 without leaking details or side effects', async (mode): Promise<void> => {
    await withIsolatedPostgres('publication-sql-fault', async ({ query, databaseUrl }): Promise<void> => {
      await seed(query, databaseUrl); const before = await snapshot(query); const billing = await snapshot(query, chargeTables); const media = await files();
      if (mode === 'missing-table') await query('ALTER TABLE wujie_canvas_task_publications RENAME TO hidden_publications');
      if (mode === 'connect') vi.spyOn(getPool(), 'connect').mockRejectedValueOnce(new Error('private_connection_path_secret'));
      const restore = interceptQueries(async (client, sql, next): Promise<QueryResult> => {
        if ((mode === 'publication-read' && sql.includes('FROM wujie_canvas_task_publications'))
          || (mode === 'task-read' && sql.includes('SELECT user_id,project_id FROM cloud_tasks'))
          || (mode === 'document-read' && sql.includes('SELECT 1 FROM wujie_project_canvas_documents'))
          || (mode === 'BEGIN' && sql === 'BEGIN') || (mode === 'COMMIT' && sql === 'COMMIT')) {
          // Real PostgreSQL error, transaction abort and rollback; not a mocked authorization decision.
          return client.query('SELECT private_connection_path_secret');
        }
        return next();
      });
      try {
        const response = await post(); expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ success: false, code: 'CANVAS_TASK_PUBLICATION_UNAVAILABLE' });
      } finally {
        restore();
        if (mode === 'missing-table') await query('ALTER TABLE hidden_publications RENAME TO wujie_canvas_task_publications');
      }
      await unchanged(query, before, billing, media);
      expect((await getPool().query('SELECT 1 AS healthy')).rows).toEqual([{ healthy: 1 }]);
    });
  }, 60_000);

it.each(['authorized', 'regrant', 'tuple-delete', 'tuple-insert', 'sql-failure'])(
  'handles actual COMMIT followed by lost ACK and %s recovery without deleting durable media', async (mode): Promise<void> => {
    await withIsolatedPostgres('publication-ack', async ({ query, databaseUrl }): Promise<void> => {
      await seed(query, databaseUrl, 'editor', mode !== 'tuple-insert'); const beforeFiles = await files();
      const taskBilling = await snapshot(query, chargeTables.slice(0, 3));
      const writers = new Set<PoolClient>(); let lost = false;
      const restore = interceptQueries(async (client, sql, next): Promise<QueryResult> => {
        if (sql.includes('INSERT INTO wujie_canvas_media_lineage')) writers.add(client);
        if (sql === 'COMMIT' && writers.has(client) && !lost) {
          const result = await next(); lost = true;
          expect(result.command).toBe('COMMIT');
          if (mode === 'regrant') await regrant();
          if (mode === 'tuple-delete') await query('DELETE FROM wujie_canvas_task_publications');
          if (mode === 'tuple-insert') await query(`INSERT INTO wujie_canvas_task_publications
            (task_id,actor_id,owner_id,project_id,workspace_id,grant_generation) VALUES ('task','editor','owner','shared','shared',1)`);
          throw new Error('actual COMMIT succeeded but ACK was lost');
        }
        if (mode === 'sql-failure' && lost && sql.includes('FROM wujie_canvas_task_publications')) return client.query('SELECT private_ack_secret');
        return next();
      });
      try {
        if (mode === 'authorized') expect((await adoptDocumentTaskResult('editor', request)).documentSequence).toBe(1);
        else await expect(adoptDocumentTaskResult('editor', request)).rejects.toThrow('DOCUMENT_MEDIA_COMMIT_UNCONFIRMED');
      } finally { restore(); }
      expect(lost).toBe(true);
      expect((await query('SELECT count(*)::int AS n FROM wujie_canvas_asset_commands')).rows).toEqual([{ n: 1 }]);
      expect((await query('SELECT count(*)::int AS n FROM wujie_workspace_placements')).rows).toEqual([{ n: 1 }]);
      const url = (await query('SELECT file_url FROM wujie_asset_versions')).rows[0].file_url as string;
      expect(await readFile(path.join(roots.root, url.slice('/api/serve-upload/'.length)))).toEqual(image);
      expect(Object.keys(await files()).length).toBe(Object.keys(beforeFiles).length + 1);
      expect(await snapshot(query, chargeTables.slice(0, 3))).toEqual(taskBilling);
      const durable = await snapshot(query); const media = await files(); const billing = await snapshot(query, chargeTables);
      if (mode === 'regrant') await expect(adoptDocumentTaskResult('editor', request)).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      if (mode === 'authorized') expect((await adoptDocumentTaskResult('editor', request)).documentSequence).toBe(1);
      await unchanged(query, durable, billing, media);
    });
  }, 60_000);

it('keeps historical no-publication manual adoption semantics after regrant', async (): Promise<void> => {
  await withIsolatedPostgres('publication-legacy', async ({ query, databaseUrl }): Promise<void> => {
    await seed(query, databaseUrl, 'editor', false); await regrant();
    const billing = await snapshot(query, chargeTables);
    expect((await adoptDocumentTaskResult('editor', request)).documentSequence).toBe(1);
    expect(await snapshot(query, chargeTables)).toEqual(billing);
  });
}, 60_000);

it('upload and taskless version import do not depend on publication table availability', async (): Promise<void> => {
  await withIsolatedPostgres('publication-not-task', async ({ query, databaseUrl }): Promise<void> => {
    await seed(query, databaseUrl);
    const billing = await snapshot(query, chargeTables);
    await query('ALTER TABLE wujie_canvas_task_publications RENAME TO hidden_publications');
    try {
      const uploaded = await importDocumentUpload('owner', new Request('http://localhost/upload', {
        method: 'POST', body: new Uint8Array(image), headers: { 'content-type': 'image/png',
          'x-wujie-asset-import': Buffer.from(JSON.stringify({ projectId: 'shared', idempotencyKey: 'upload', filename: 'image.png', command })).toString('base64url') },
      }));
      expect(uploaded.documentSequence).toBe(1);
      expect((await importDocumentAssetVersion('owner', { projectId: 'other', idempotencyKey: 'version',
        sourceVersionId: uploaded.assetVersionId, command })).documentSequence).toBe(1);
    } finally { await query('ALTER TABLE hidden_publications RENAME TO wujie_canvas_task_publications'); }
    expect(await snapshot(query, chargeTables)).toEqual(billing);
  });
}, 60_000);

it('allows explicit transfer to another authorized target without upgrading original publication or bypassing trusted source', async (): Promise<void> => {
  await withIsolatedPostgres('publication-other-target', async ({ query, databaseUrl }): Promise<void> => {
    // Existing trusted-source rules require source-version ownership; use the owner task.
    await seed(query, databaseUrl, 'owner');
    await query("INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,task_id,file_url,availability,mime_type,checksum,byte_size)
      VALUES ('source-version','source','owner','shared','task','/api/serve-upload/images/source.png','ready','image/png',$1,$2)`,
    [createHash('sha256').update(image).digest('hex'), image.length]);
    await query("UPDATE wujie_assets SET current_version_id='source-version'");
    await query("UPDATE wujie_project_document_settings SET enabled=false WHERE project_id='shared'");
    const billing = await snapshot(query, chargeTables);
    const other = { ...request, projectId: 'other', sourceVersionId: 'source-version' };
    await expect(adoptDocumentTaskResult('owner', { ...other, sourceVersionId: 'missing' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' });
    expect((await adoptDocumentTaskResult('owner', other)).documentSequence).toBe(1);
    await expect(adoptDocumentTaskResult('owner', request)).rejects.toMatchObject({ code: 'DOCUMENT_PROJECT_NOT_ENABLED' });
    expect(await snapshot(query, chargeTables)).toEqual(billing);
    expect((await query("SELECT projection FROM wujie_project_canvas_documents WHERE project_id='shared'")).rows[0].projection)
      .toEqual({ placements: {} });
  });
}, 60_000);
