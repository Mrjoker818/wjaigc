import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/s3-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/s3-storage')>(),
  uploadBinaryToS3: async (): Promise<null> => null,
}));

import { ensureCoreTables } from '@/lib/db-storage';
import { ensureCloudTaskTables, completeCloudTask } from '@/lib/cloud-task-storage';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { persistAssetBytes } from '@/lib/asset-core/binary-persistence';
import { assetBinaryFileOps } from '@/lib/asset-core/binary-file-ops';
import { getPool } from '@/lib/db-client';
import * as mediaSource from '@/lib/collaboration/document-media-source';
import { projectWorkflowEditTaskResult } from '@/lib/collaboration/workflow-edit-output';

requireOfflineBridgeTestDatabaseUrl(process.env);
let parent: string;
let root: string;
beforeAll(async () => {
  if (!process.env.WUJIE_DATA_DIR) throw new Error('Missing private fixture root');
  parent = path.resolve(process.env.WUJIE_DATA_DIR);
  root = await mkdtemp(path.join(parent, 'stage7-workflow-output-'));
  vi.stubEnv('WUJIE_DATA_DIR', root);
  vi.stubEnv('SERVER_DATA_ROOT', root);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  vi.unstubAllEnvs();
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('stage7-workflow-output-')) {
    throw new Error('Refusing to remove unexpected workflow fixture root');
  }
  await rm(resolved, { recursive: true, force: true });
});

async function seed(databaseUrl: string, query: QueryFn): Promise<{ url: string; bytes: Buffer }> {
  const migration = spawnSync(process.execPath, [path.resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl,
      WUJIE_DATA_DIR: parent, SERVER_DATA_ROOT: parent },
    timeout: 30_000,
  });
  expect(migration.status, migration.stderr || migration.stdout).toBe(0);
  await ensureCoreTables();
  await ensureCloudTaskTables();
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
  await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
  await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
    VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
  await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
  await query(`INSERT INTO wujie_workspace_placements
    (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
    VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    VALUES ('credits_editor','editor',100,100,0,1,1)`);
  await createBillableTask({ userId: 'editor', idempotencyKey: 'output-lifecycle', requestDigest: 'request-a', creditCost: 5,
    workflowPublication: { access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner',
      projectId: 'shared', grantGeneration: '1' }, workflowId: 'workflow-a', nodeId: 'edit-a',
      sourceEntityId: 'input-a', sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
      imageUrl: '/api/serve-upload/canonical.png', origin: 'https://app.example' },
    task: { id: 'edit-output', projectId: 'shared', sessionId: 'workflow:shared', messageId: 'run-a:edit-a',
      type: 'edit', status: 'processing', providerId: 'provider-a', model: 'model-a', progress: 0, createdAt: 1, updatedAt: 1 },
  });
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 4,
    background: { r: 15, g: 40, b: 90, alpha: 1 } } }).png().toBuffer();
  const file = await persistAssetBytes({ bytes, filename: 'output.png', mimeType: 'image/png' });
  expect(await completeCloudTask('edit-output', { image: { url: file.url } })).toBe(true);
  return { url: file.url, bytes };
}

async function exportNames(): Promise<string[]> { return (await readdir(path.join(root, 'exports'))).sort(); }
async function stored(url: string): Promise<Buffer> {
  const filename = url.slice('/api/serve-upload/exports/'.length);
  if (!url.startsWith('/api/serve-upload/exports/') || filename !== path.basename(filename)) throw new Error('Unexpected URL');
  return readFile(path.join(root, 'exports', filename));
}

async function drainFixture(calls: Promise<unknown>[], cleanups: () => (() => Promise<void>)[], bodySucceeded: boolean): Promise<void> {
  const operations = await Promise.allSettled(calls);
  const cleanupResults = await Promise.allSettled(cleanups().map(cleanup => Promise.resolve().then(cleanup)));
  const failures = [...operations, ...cleanupResults].flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length && bodySucceeded) throw new AggregateError(failures, 'Workflow fixture drain failed');
  if (failures.length) console.error({ code: 'WORKFLOW_FIXTURE_DRAIN_FAILED', failures: failures.length, errors: failures });
}

it('fixture drain attempts every cleanup and preserves the original failed body', async () => {
  let secondAttempted = false;
  await expect(drainFixture([Promise.reject(new Error('body'))], () => [
    async () => { throw new Error('first cleanup'); },
    async () => { secondAttempted = true; },
  ], false)).resolves.toBeUndefined();
  expect(secondAttempted).toBe(true);
});

it('fixture drain reports rejected operations after draining every cleanup on a successful body', async () => {
  let cleaned = false;
  await expect(drainFixture([Promise.reject(new Error('operation'))], () => [
    async () => { cleaned = true; },
  ], true)).rejects.toThrow(/fixture drain/i);
  expect(cleaned).toBe(true);
});

it('fixture drain retains the original body error and logs the same secondary failure objects', async () => {
  const bodyError = new Error('body A');
  const operationError = new Error('operation B');
  const cleanupError = new Error('cleanup C');
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const run = async (): Promise<void> => {
    try { throw bodyError; }
    finally {
      await drainFixture([Promise.reject(bodyError), Promise.reject(operationError)],
        () => [async () => { throw cleanupError; }], false);
    }
  };
  await expect(run()).rejects.toBe(bodyError);
  expect(log).toHaveBeenCalledWith({ code: 'WORKFLOW_FIXTURE_DRAIN_FAILED', failures: 3,
    errors: [bodyError, operationError, cleanupError] });
  const logged = log.mock.calls[0][0] as { errors: unknown[] };
  expect(logged.errors[0]).toBe(bodyError);
  expect(logged.errors[1]).toBe(operationError);
  expect(logged.errors[2]).toBe(cleanupError);
});

it('records a real failed deletion in the outbox with all other pool connections occupied', async () => {
  await withIsolatedPostgres('workflow-output-cleanup-pool', async ({ databaseUrl, query }) => {
    const source = await seed(databaseUrl, query);
    await query(`CREATE FUNCTION reject_workflow_output() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN RAISE EXCEPTION ''forced publication failure''; END'`);
    await query(`CREATE TRIGGER reject_output BEFORE INSERT ON wujie_workflow_edit_outputs
      FOR EACH ROW EXECUTE FUNCTION reject_workflow_output()`);
    const pool = getPool();
    const previousTimeout = pool.options.connectionTimeoutMillis;
    pool.options.connectionTimeoutMillis = 250;
    const held: PoolClient[] = [];
    const prepare = mediaSource.prepareAdoptedMedia;
    const remove = assetBinaryFileOps.rm;
    let deletionFailed = false;
    vi.spyOn(mediaSource, 'prepareAdoptedMedia').mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      const file = mediaSource.importedMediaIdentity(prepared).file;
      const target = path.join(root, 'exports', path.basename(file.url));
      vi.spyOn(assetBinaryFileOps, 'rm').mockImplementation(async (...removeArgs) => {
        if (path.resolve(String(removeArgs[0])) === target) {
          deletionFailed = true;
          throw new Error('Injected owned-file deletion failure');
        }
        return remove(...removeArgs);
      });
      for (let index = 0; index < 4; index++) held.push(await pool.connect());
      return prepared;
    });
    try {
      await expect(projectWorkflowEditTaskResult('editor', 'edit-output')).rejects.toThrow(/forced publication failure/);
      expect(deletionFailed).toBe(true);
      expect((await query('SELECT status FROM wujie_asset_cleanup_outbox')).rows).toEqual([{ status: 'pending' }]);
      expect(await stored(source.url)).toEqual(source.bytes);
    } finally {
      for (const client of held) client.release();
      pool.options.connectionTimeoutMillis = previousTimeout;
      vi.restoreAllMocks();
    }
  });
}, 60_000);

it('cleans a newly adopted file after a real PostgreSQL publication failure without deleting its source', async () => {
  await withIsolatedPostgres('workflow-output-rollback', async ({ databaseUrl, query }) => {
    const source = await seed(databaseUrl, query);
    const before = await exportNames();
    await query(`CREATE FUNCTION reject_workflow_output() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN RAISE EXCEPTION ''forced publication failure''; END'`);
    await query(`CREATE TRIGGER reject_output BEFORE INSERT ON wujie_workflow_edit_outputs
      FOR EACH ROW EXECUTE FUNCTION reject_workflow_output()`);
    await expect(projectWorkflowEditTaskResult('editor', 'edit-output')).rejects.toThrow(/forced publication failure/);
    expect((await query("SELECT task_id FROM wujie_workflow_edit_outputs")).rows).toEqual([]);
    expect(await exportNames()).toEqual(before);
    expect(await stored(source.url)).toEqual(source.bytes);
  });
}, 60_000);

it('cleans the real concurrent projection loser while retaining the winner and source files', async () => {
  await withIsolatedPostgres('workflow-output-race', async ({ databaseUrl, query }) => {
    const source = await seed(databaseUrl, query);
    const before = new Set(await exportNames());
    const original = mediaSource.prepareAdoptedMedia;
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const prepared: mediaSource.PreparedImportedMedia[] = [];
    vi.spyOn(mediaSource, 'prepareAdoptedMedia').mockImplementation(async (...args) => {
      const result = await original(...args);
      prepared.push(result);
      arrived += 1;
      if (arrived === 2) release();
      const controller = new AbortController();
      try {
        await Promise.race([barrier, delay(2000, undefined, { signal: controller.signal }).then(() => {
          throw new Error('Projection fixture barrier was not reached');
        })]);
      } finally { controller.abort(); }
      return result;
    });
    const calls = [projectWorkflowEditTaskResult('editor', 'edit-output'), projectWorkflowEditTaskResult('editor', 'edit-output')];
    let bodySucceeded = false;
    try {
      const [first, second] = await Promise.all(calls);
      expect(arrived).toBe(2);
      expect(first).toEqual(second);
      expect(first).toHaveLength(1);
      expect((await query('SELECT task_id FROM wujie_workflow_edit_outputs')).rows).toHaveLength(1);
      expect((await exportNames()).filter(name => !before.has(name))).toHaveLength(1);
      expect(await stored(first![0].url)).toEqual(source.bytes);
      expect(await stored(source.url)).toEqual(source.bytes);
      bodySucceeded = true;
    } finally {
      release();
      // Fixture failure must also drain files minted before the wrapper returned.
      try {
        await drainFixture(calls, () => prepared.map(capability => () => mediaSource.importedMediaIdentity(capability).file.cleanup()), bodySucceeded);
      } finally { vi.restoreAllMocks(); }
    }
  });
}, 60_000);

it('retains a committed adopted file when the real COMMIT reply is lost and recovered', async () => {
  await withIsolatedPostgres('workflow-output-commit-reply', async ({ databaseUrl, query }) => {
    const source = await seed(databaseUrl, query);
    const before = new Set(await exportNames());
    const pool = getPool();
    const connect = pool.connect.bind(pool);
    const connectWithCallback = connect as unknown as (callback: unknown) => void;
    let injected = false;
    vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
      if (typeof callback === 'function') return connectWithCallback(callback);
      return (async (): Promise<PoolClient> => {
      const client = await connect() as PoolClient;
      const proxy = client as unknown as { query: (sql: string, ...args: unknown[]) => Promise<unknown> };
      const original = proxy.query.bind(client);
      let outputInserted = false;
      proxy.query = async (sql, ...args) => {
        const result = await original(sql, ...args);
        if (sql.includes('INSERT INTO wujie_workflow_edit_outputs')) outputInserted = true;
        if (sql === 'COMMIT' && outputInserted && !injected) {
          injected = true;
          throw new Error('Lost actual COMMIT reply');
        }
        return result;
      };
      return client;
      })();
    }) as typeof pool.connect);
    try {
      const result = await projectWorkflowEditTaskResult('editor', 'edit-output');
      expect(injected).toBe(true);
      expect(result).toHaveLength(1);
      expect((await exportNames()).filter(name => !before.has(name))).toHaveLength(1);
      expect(await stored(result![0].url)).toEqual(source.bytes);
      expect(await stored(source.url)).toEqual(source.bytes);
    } finally { vi.restoreAllMocks(); }
  });
}, 60_000);
