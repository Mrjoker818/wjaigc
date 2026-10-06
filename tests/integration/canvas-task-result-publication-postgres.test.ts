import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import * as Y from 'yjs';
import { afterEach, expect, it, vi } from 'vitest';
const roots = await vi.hoisted(async () => {
  const database = process.env.POSTGRES_TEST_DATABASE_URL;
  if (!database || !['127.0.0.1', '[::1]'].includes(new URL(database).hostname)) throw new Error('Explicit loopback database required');
  const fs = await import('node:fs'); const path = await import('node:path'); const os = await import('node:os');
  const base = process.env.WUJIE_DATA_DIR || os.tmpdir(); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'publication-')); process.env.WUJIE_DATA_DIR = root;
  return { root };
});
vi.mock('server-only', () => ({}));
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { ensureCoreTables } from '@/lib/db-storage';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { transitionTask } from '@/lib/task-core/task-service';
import { createCanvasDocument, applyCanvasImagePatch, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { projectCanvasTaskResult, canvasTaskOutputCommandKey } from '@/lib/collaboration/task-result-publication';
import { projectAgentResultToWorkspace } from '@/lib/agent-runtime/workspace-results';
import type { CanvasPublicationIntentProposal } from '@/lib/collaboration/task-publication-intent';
import { publishDocumentTaskOutput } from '@/lib/collaboration/document-media-import';
import { executeDocumentAssetCommand } from '@/lib/collaboration/document-asset-commands';
import { loadDocument, commitDocumentUpdate } from '@/lib/collaboration/document-store';
import * as binary from '@/lib/asset-core/binary-persistence';
import * as managed from '@/lib/asset-core/managed-media-read';
import { importedMediaIdentity, prepareAdoptedMedia, type PreparedImportedMedia, type MediaTaskSource } from '@/lib/collaboration/document-media-source';
import { taskPublicationSnapshot, type PreparedTaskPublication } from '@/lib/collaboration/task-publication-output';
import * as publicationOutput from '@/lib/collaboration/task-publication-output';
import { enableCollaborativeProject } from '@/lib/collaboration/document-project-bridge';
import { getPool } from '@/lib/db-client';
import type { PoolClient, QueryResult } from 'pg';
import { grantDocumentEditor, revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { recordTaskProjectionPending } from '@/lib/asset-core/task-projector';
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function privateFallbackTask(query: QueryFn): Promise<Parameters<typeof projectAgentResultToWorkspace>[0]> {
  await query(`INSERT INTO wujie_projects(id,owner_id,name,metadata)
    VALUES ('private','editor','Private','{"presenceProjection":true}')`);
  await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
    VALUES ('editor','projects',$1::jsonb,1)`, [JSON.stringify([{
    id: 'private', userId: 'editor', name: 'Private', createdAt: 1, updatedAt: 1, canvasImages: [], settings: {},
  }])]);
  await createBillableTask({ userId: 'editor', idempotencyKey: 'private', requestDigest: 'private', creditCost: 7,
    task: { id: 'private', projectId: 'private', type: 'generate', status: 'processing', progress: 0, createdAt: 1, updatedAt: 1 } });
  await transitionTask({ taskId: 'private', from: ['processing'], to: 'completed', creditStatus: 'charged',
    result: { imageUrl: '/api/serve-upload/shared.png' } });
  return { actorUserId: 'editor', taskId: 'private', targetProjectId: 'private', workspace: 'canvas',
    parentVersionIds: [], idempotencyKey: 'private' };
}
async function assertNoPrivateFallback(query: QueryFn): Promise<void> {
  for (const table of ['wujie_assets', 'wujie_asset_versions', 'wujie_workspace_placements', 'wujie_canvas_asset_commands', 'wujie_project_canvas_updates']) {
    expect((await query(`SELECT * FROM ${table} WHERE project_id='private'`)).rows, table).toEqual([]);
  }
  expect((await query("SELECT status,result FROM cloud_tasks WHERE id='private'")).rows).toEqual([
    { status: 'completed', result: { imageUrl: '/api/serve-upload/shared.png' } },
  ]);
  expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
    .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
  expect((await query("SELECT enabled FROM wujie_project_document_settings WHERE project_id='private'")).rows)
    .toEqual([{ enabled: true }]);
}
function barrier(): { reached: Promise<void>; release: () => void } {
  let release!: () => void;
  return { reached: new Promise<void>(resolve => { release = resolve; }), release: (): void => release() };
}
async function waitForDatabaseBlock(query: QueryFn, waiter: number, holder: number, settled: () => boolean): Promise<void> {
  let blockers: number[] = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    blockers = (await query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [waiter])).rows[0].blockers;
    if (blockers.includes(holder) || settled()) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(blockers, 'the real competing transaction must wait for the project row lock').toContain(holder);
}

it('private fallback rejects enable committed after real null selection without old writes or completed marker', async () => {
  await withIsolatedPostgres('fix1-private-null-enable', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); const request = await privateFallbackTask(query);
    const prepare = publicationOutput.prepareTaskPublication;
    let selectedPrivate = false; let enabledSnapshot: Record<string, unknown> | undefined;
    vi.spyOn(publicationOutput, 'prepareTaskPublication').mockImplementationOnce(async (...args) => {
      const capability = await prepare(...args); expect(capability).toBeNull(); selectedPrivate = true;
      await enableCollaborativeProject('editor', 'private', 0);
      enabledSnapshot = await snapshot(query);
      return capability;
    });
    const outcome = await projectAgentResultToWorkspace(request).then(() => null, (error: unknown) => error);
    expect(selectedPrivate).toBe(true);
    await assertNoPrivateFallback(query);
    expect(await snapshot(query)).toEqual(enabledSnapshot);
    expect(outcome).toMatchObject({ code: 'TASK_PROJECTION_CONFLICT' });
  });
}, 60_000);

it('private fallback waits for enabling project lock then rechecks the committed enabled state', async () => {
  await withIsolatedPostgres('fix1-private-enable-first', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); const request = await privateFallbackTask(query);
    const enableLocked = barrier(); const releaseEnable = barrier(); const projecting = barrier();
    let enablePid = 0; let projectionPid = 0; let projectionSettled = false;
    const restore = interceptQueries(async (client, sql, next) => {
      if (sql.includes('SELECT status FROM wujie_projects') && sql.includes('FOR UPDATE')) {
        const result = await next(); enablePid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        enableLocked.release(); await releaseEnable.reached; return result;
      }
      const result = await next();
      if (sql.includes('charged_transaction_id') && sql.includes('FOR UPDATE')) {
        projectionPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid; projecting.release();
      }
      return result;
    });
    const enabling = enableCollaborativeProject('editor', 'private', 0);
    let projection: Promise<unknown> | undefined;
    try {
      await enableLocked.reached;
      projection = projectAgentResultToWorkspace(request).then(
        result => { projectionSettled = true; return result; },
        (error: unknown) => { projectionSettled = true; return error; });
      await projecting.reached;
      await waitForDatabaseBlock(query, projectionPid, enablePid, () => projectionSettled);
    } finally { releaseEnable.release(); await enabling; await projection; restore(); }
    expect(await projection).toMatchObject({ code: 'TASK_PROJECTION_CONFLICT' });
    await assertNoPrivateFallback(query);
  });
}, 60_000);

it('private fallback holds the project lock through actual writes so enable cannot overtake its transaction', async () => {
  await withIsolatedPostgres('fix1-private-project-first', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); const request = await privateFallbackTask(query);
    const writing = barrier(); const releaseWrite = barrier(); const enablingStarted = barrier();
    let projectionPid = 0; let enablePid = 0; let enableSettled = false;
    let projectionClient: PoolClient | undefined; let enableClient: PoolClient | undefined;
    const commits: string[] = [];
    const restore = interceptQueries(async (client, sql, next) => {
      if (sql.includes('INSERT INTO wujie_assets(')) {
        projectionClient = client; projectionPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        writing.release(); await releaseWrite.reached;
      }
      if (sql.includes('SELECT status FROM wujie_projects') && sql.includes('FOR UPDATE')) {
        enableClient = client; enablePid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        enablingStarted.release();
      }
      const result = await next();
      if (sql === 'COMMIT' && client === projectionClient) commits.push('projection');
      if (sql === 'COMMIT' && client === enableClient) commits.push('enable');
      return result;
    });
    const projection = projectAgentResultToWorkspace(request);
    let enabling: Promise<void> | undefined;
    try {
      await writing.reached;
      enabling = enableCollaborativeProject('editor', 'private', 0).finally(() => { enableSettled = true; });
      await enablingStarted.reached;
      await waitForDatabaseBlock(query, enablePid, projectionPid, () => enableSettled);
    } finally { releaseWrite.release(); await projection; await enabling; restore(); }
    const refs = await projection;
    expect(refs).toHaveLength(1); expect(commits.slice(0, 2)).toEqual(['projection', 'enable']);
    expect((await query("SELECT id FROM wujie_asset_versions WHERE task_id='private'")).rows)
      .toEqual([{ id: refs[0].assetVersionId }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
    expect((await query("SELECT enabled FROM wujie_project_document_settings WHERE project_id='private'")).rows)
      .toEqual([{ enabled: true }]);
  });
}, 60_000);

it('publication connection outage reports 503 and never falls back to private writes', async () => {
  await withIsolatedPostgres('publication-connect-outage', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); await task('outage');
    const before = await snapshot(query); const media = files();
    vi.spyOn(getPool(), 'connect').mockRejectedValueOnce(new Error('isolated connection outage'));
    await expect(projectAgentResultToWorkspace({ ...input('outage'), idempotencyKey: 'outage' })).rejects.toMatchObject({ status: 503 });
    expect(await snapshot(query)).toEqual(before); expect(files()).toEqual(media);
  });
}, 60_000);

it('one multi-output attempt cannot adopt a changed intent between committed outputs', async () => {
  await withIsolatedPostgres('publication-original-intent', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName);
    await task('original-intent', { ...proposal, projectionMode: 'derived' },
      { imageUrls: ['/api/serve-upload/shared.png', '/api/serve-upload/shared.png'] });
    const writes = new Set<PoolClient>(); let changed = false;
    const restore = interceptQueries(async (client, sql, next) => {
      if (sql.includes('INSERT INTO wujie_canvas_asset_commands')) writes.add(client);
      const result = await next();
      if (sql === 'COMMIT' && writes.delete(client) && !changed) {
        changed = true;
        await query(`UPDATE wujie_canvas_task_publications SET publication_intent=jsonb_set(publication_intent,'{placement,transform,x}','700')`);
      }
      return result;
    });
    try { await expect(projectCanvasTaskResult(input('original-intent'))).rejects.toThrow(); } finally { restore(); }
    expect(changed).toBe(true);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
    expect((await query('SELECT * FROM wujie_project_canvas_updates')).rows).toHaveLength(1);
  });
}, 60_000);

it('production default preserves private canvas workflow and chat while enabled canvas without publication fails closed', async () => {
  await withIsolatedPostgres('publication-private', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    for (const workspace of ['canvas', 'workflow', 'chat'] as const) {
      await createBillableTask({ userId: 'editor', idempotencyKey: workspace, requestDigest: workspace, creditCost: 7,
        task: { id: workspace, projectId: 'private', type: 'generate', status: 'processing', progress: 0, createdAt: 1, updatedAt: 1 } });
      await transitionTask({ taskId: workspace, from: ['processing'], to: 'completed', creditStatus: 'charged', result: { imageUrl: '/api/serve-upload/shared.png' } });
      const request = { actorUserId: 'editor', taskId: workspace, targetProjectId: 'private', workspace,
        workspaceId: `${workspace}:private`, parentVersionIds: [], idempotencyKey: `private-${workspace}` };
      const refs = await projectAgentResultToWorkspace(request); expect(refs).toHaveLength(1);
      const version = (await query('SELECT * FROM wujie_asset_versions WHERE id=$1', [refs[0].assetVersionId])).rows[0];
      expect(version).toMatchObject({ owner_id: 'editor', project_id: 'private', task_id: workspace });
      expect(await projectAgentResultToWorkspace(request)).toEqual(refs);
    }
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toEqual([]);
    await createBillableTask({ userId: 'owner', idempotencyKey: 'old-owner', requestDigest: 'old-owner', creditCost: 7,
      task: { id: 'old-owner', projectId: 'shared', type: 'generate', status: 'processing', progress: 0, createdAt: 1, updatedAt: 1 } });
    await transitionTask({ taskId: 'old-owner', from: ['processing'], to: 'completed', creditStatus: 'charged', result: { imageUrl: '/api/serve-upload/shared.png' } });
    const before = await snapshot(query); const media = files();
    await expect(projectAgentResultToWorkspace({ ...input('old-owner', 'owner'), idempotencyKey: 'old-owner' })).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(query)).toEqual(before); expect(files()).toEqual(media);
  });
}, 60_000);

it('annotation source current-version change after preparation rejects revision with full rollback', async () => {
  await withIsolatedPostgres('publication-annotation', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName);
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height)
      SELECT 'version-second-next',asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height
      FROM wujie_asset_versions WHERE id='version-second'`);
    const loaded = await loadDocument('shared');
    loaded.doc.getMap('annotationRecords').set('annotation', { id: 'annotation', projectId: 'shared',
      sourceImageId: 'placement-shared', sourceVersionId: 'version-shared', type: 'region',
      geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } }, maskAssetId: 'asset-second', status: 'ready', createdAt: 1, updatedAt: 2 });
    await commitDocumentUpdate({ actorId: 'editor', projectId: 'shared', bytes: Y.encodeStateAsUpdate(loaded.doc) }); loaded.doc.destroy();
    await task('annotation'); const media = files(); let before: Record<string, unknown> | undefined;
    const original = managed.getManagedAssetMediaDescriptor;
    vi.spyOn(managed, 'getManagedAssetMediaDescriptor').mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await query("UPDATE wujie_assets SET current_version_id='version-second-next' WHERE id='asset-second'");
      before = await snapshot(query); return result;
    });
    await expect(projectCanvasTaskResult(input('annotation'))).rejects.toThrow();
    expect(await snapshot(query)).toEqual(before); expect(files()).toEqual(media);
  });
}, 60_000);

it('revocation after publication but before marker prevents new shared confirmation', async () => {
  await withIsolatedPostgres('publication-marker-revoke', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); await task('marker-revoke');
    let revoked = false;
    const restore = interceptQueries(async (_client, sql, next) => {
      if (sql === 'SELECT 1 FROM cloud_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE' && !revoked) {
        revoked = true; await revokeDocumentEditor('owner', 'shared', 'editor');
      }
      return next();
    });
    try { await expect(projectCanvasTaskResult(input('marker-revoke'))).rejects.toThrow(); } finally { restore(); }
    expect(revoked).toBe(true); expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
    expect((await query("SELECT status,result->'assetProjection' AS marker FROM cloud_tasks")).rows).toEqual([{ status: 'completed', marker: null }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows).toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
  });
}, 60_000);

async function seed(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  const log = resolve('.superpowers/sdd/2026-09-25-v588-yjs-canvas-collaboration', `task-8cb3e-migrations-${schemaName}.log`);
  writeFileSync(log, `exit=${migration.status}\n${migration.stdout}\n${migration.stderr}`);
  console.info('Full migrations:', migration.status, log, 'media:', roots.root);
  if (migration.status !== 0) console.error(migration.stdout, migration.stderr);
  expect(migration.status).toBe(0); await ensureCoreTables();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer();
  writeFileSync(join(roots.root, 'shared.png'), png);
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  const doc = createCanvasDocument();
  for (const suffix of ['shared', 'second']) {
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ($1,'owner','shared','image')", [`asset-${suffix}`]);
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height)
      VALUES ($1,$2,'owner','shared','/api/serve-upload/shared.png','image/png',$3,$4,2,2)`,
    [`version-${suffix}`, `asset-${suffix}`, png.length, createHash('sha256').update(png).digest('hex')]);
    await query('UPDATE wujie_assets SET current_version_id=$1 WHERE id=$2', [`version-${suffix}`, `asset-${suffix}`]);
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ($1,'owner','shared',$2,$3,'canvas','shared','canvas-image',$4)`,
    [`placement-${suffix}`, `asset-${suffix}`, `version-${suffix}`, `image-${suffix}`]);
    applyCanvasImagePatch(doc, { placementId: `placement-${suffix}`, assetVersionId: `version-${suffix}`,
      x: suffix === 'shared' ? 0 : -200, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0 }, 'fixture');
  }
  await query(`INSERT INTO wujie_project_canvas_documents(project_id,owner_id,projection,snapshot_bytes)
    VALUES ('shared','owner',$1,$2)`, [readCanvasDocument(doc), Buffer.from(Y.encodeStateAsUpdate(doc))]); doc.destroy();
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    SELECT 'credits_' || id,id,100,100,0,1,1 FROM wujie_users`);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}
const proposal: CanvasPublicationIntentProposal = { parentVersionIds: ['version-shared'], projectionMode: 'revision',
  placement: { action: 'append', selectedEntityIds: ['image-shared'] } };
async function task(id: string, intent: CanvasPublicationIntentProposal = structuredClone(proposal),
  result: Record<string, unknown> = { imageUrl: '/api/serve-upload/shared.png' }, actorId: string = 'editor'): Promise<void> {
  await createBillableTask({ userId: actorId, idempotencyKey: id, requestDigest: id, creditCost: 7,
    task: { id, projectId: 'shared', type: 'agent-edit', providerId: 'trusted-provider', model: 'trusted-model', status: 'processing',
      progress: 0, createdAt: Date.now(), updatedAt: Date.now() },
    canvasPublication: { access: { kind: 'document', actorUserId: actorId, ownerId: 'owner', projectId: 'shared',
      grantGeneration: actorId === 'owner' ? '0' : '1' }, workspace: 'canvas', workspaceId: 'shared', intent } });
  await transitionTask({ taskId: id, from: ['processing'], to: 'completed', result, creditStatus: 'charged' });
}
const input = (taskId: string, actorUserId: string = 'editor'): Parameters<typeof projectCanvasTaskResult>[0] => ({
  actorUserId, taskId, targetProjectId: 'shared', workspace: 'canvas', parentVersionIds: [],
});
async function snapshot(query: QueryFn, tables: string[] = ['wujie_assets', 'wujie_asset_versions', 'wujie_asset_version_parents',
  'wujie_workspace_placements', 'wujie_canvas_asset_commands', 'wujie_canvas_media_lineage', 'wujie_project_canvas_documents',
  'wujie_project_canvas_updates', 'wujie_credits', 'wujie_credit_transactions']): Promise<Record<string, unknown>> {
  const rows: Record<string, unknown> = {};
  for (const table of tables) rows[table] = (await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  return rows;
}
function files(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of readdirSync(roots.root, { recursive: true, withFileTypes: true })) {
    if (file.isFile()) { const name = join(file.parentPath, file.name); result[name] = createHash('sha256').update(readFileSync(name)).digest('hex'); }
  }
  return result;
}

// A new asset with revision metadata is a bug: revision must reuse the real family.
it('revision uses the frozen asset family, ordered real parent edge and leaves source placement and bytes intact', async () => {
  await withIsolatedPostgres('publication-revision', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); await task('revision');
    const source = await snapshot(query, ['wujie_workspace_placements']); const original = readFileSync(join(roots.root, 'shared.png'));
    const refs = await projectCanvasTaskResult(input('revision'));
    const key = 'canvas-task-output:v1:b152789c500f91c0904a222641b9303f7eb75ee8868db4fd4a75d70253dcbbde';
    expect(canvasTaskOutputCommandKey({ actorId: 'editor', projectId: 'shared', taskId: 'revision', outputIndex: 0 })).toBe(key);
    expect((await query('SELECT idempotency_key FROM wujie_canvas_asset_commands')).rows).toEqual([{ idempotency_key: key }]);
    expect(refs).toHaveLength(1); expect(refs![0].assetId).toBe('asset-shared');
    expect(refs![0].assetVersionId).not.toBe('version-shared');
    expect((await query("SELECT current_version_id FROM wujie_assets WHERE id='asset-shared'")).rows[0].current_version_id).toBe(refs![0].assetVersionId);
    expect((await query('SELECT parent_version_id,parent_order FROM wujie_asset_version_parents ORDER BY parent_order')).rows)
      .toEqual([{ parent_version_id: 'version-shared', parent_order: 0 }]);
    const version = (await query('SELECT * FROM wujie_asset_versions WHERE id=$1', [refs![0].assetVersionId])).rows[0];
    expect(version).toMatchObject({ task_id: 'revision', provider_id: 'trusted-provider', model_id: 'trusted-model',
      metadata: { sourceVersionIds: ['version-shared'] } });
    expect((await query("SELECT to_jsonb(t) AS row FROM wujie_workspace_placements t WHERE id IN ('placement-shared','placement-second') ORDER BY to_jsonb(t)::text")).rows)
      .toEqual(source.wujie_workspace_placements);
    expect(readFileSync(join(roots.root, 'shared.png'))).toEqual(original);
    const before = await snapshot(query); const beforeFiles = files();
    expect(await projectAgentResultToWorkspace({ ...input('revision'), idempotencyKey: 'caller-is-not-authority',
      workspace: 'chat', workspaceId: 'wrong', parentVersionIds: ['wrong'], projectionMode: 'derived' })).toEqual(refs);
    expect(await snapshot(query)).toEqual(before); expect(files()).toEqual(beforeFiles);
  });
}, 60_000);

it('derived ordered parents and two outputs recover a committed prefix without downloading it again', async () => {
  await withIsolatedPostgres('publication-prefix', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName);
    await task('multi', { ...proposal, projectionMode: 'derived', parentVersionIds: ['version-second', 'version-shared'] },
      { imageUrls: ['/api/serve-upload/shared.png', '/api/serve-upload/missing.png'] });
    await expect(projectCanvasTaskResult(input('multi'))).rejects.toThrow();
    const prefix = (await query('SELECT * FROM wujie_canvas_asset_commands')).rows;
    expect(prefix).toHaveLength(1);
    expect((await query("SELECT result->'assetProjection' AS marker FROM cloud_tasks")).rows[0].marker).toBeNull();
    writeFileSync(join(roots.root, 'missing.png'), readFileSync(join(roots.root, 'shared.png')));
    const persistence = vi.spyOn(binary, 'persistAssetBytes');
    const refs = await projectCanvasTaskResult(input('multi')); expect(refs).toHaveLength(2);
    expect(persistence).toHaveBeenCalledTimes(1);
    expect(refs![0].assetVersionId).toBe(prefix[0].asset_version_id);
    const placements = (await query("SELECT transform FROM wujie_workspace_placements WHERE id NOT IN ('placement-shared','placement-second') ORDER BY (transform->>'x')::int")).rows;
    expect(placements).toEqual([{ transform: { x: 132, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 } },
      { transform: { x: 264, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 } }]);
    for (const ref of refs!) expect((await query('SELECT parent_version_id,parent_order FROM wujie_asset_version_parents WHERE version_id=$1 ORDER BY parent_order', [ref.assetVersionId])).rows)
      .toEqual([{ parent_version_id: 'version-second', parent_order: 0 }, { parent_version_id: 'version-shared', parent_order: 1 }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows).toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
  });
}, 60_000);

it('20 concurrent publishers share one command version placement update and monotonic marker', async () => {
  await withIsolatedPostgres('publication-concurrent', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); await task('race');
    const results = await Promise.all(Array.from({ length: 20 }, () => projectCanvasTaskResult(input('race'))));
    results.forEach(value => expect(value).toEqual(results[0]));
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
    expect((await query('SELECT * FROM wujie_canvas_media_lineage')).rows).toHaveLength(1);
    expect((await query('SELECT * FROM wujie_project_canvas_updates')).rows).toHaveLength(1);
    expect((await query('SELECT * FROM wujie_asset_versions')).rows).toHaveLength(3);
    expect((await query('SELECT * FROM wujie_workspace_placements')).rows).toHaveLength(3);
    await recordTaskProjectionPending({ actorUserId: 'editor', taskId: 'race', reason: 'late failure' });
    expect((await query("SELECT result->'assetProjection' AS marker FROM cloud_tasks")).rows[0].marker.references).toEqual(results[0]);
  });
}, 60_000);

type Intercept = (client: PoolClient, sql: string, next: () => Promise<QueryResult>) => Promise<QueryResult>;
function interceptQueries(intercept: Intercept): () => void {
  const pool = getPool(); const seen = new Set<PoolClient>(); const restores: Array<() => void> = [];
  const acquire = (client: PoolClient): void => {
    if (seen.has(client)) return; seen.add(client); const query = client.query.bind(client);
    type Callback = (error: Error | null, result?: QueryResult) => void;
    const spy = vi.spyOn(client, 'query').mockImplementation(((sql: string, values?: unknown[] | Callback, callback?: Callback): Promise<QueryResult> | undefined => {
      const parameters = Array.isArray(values) ? values : undefined; const done = typeof values === 'function' ? values : callback;
      const pending = intercept(client, sql, () => query(sql, parameters));
      if (done) { void pending.then(result => done(null, result), (error: Error) => done(error)); return undefined; }
      return pending;
    }) as PoolClient['query']); restores.push((): void => spy.mockRestore());
  };
  pool.on('acquire', acquire);
  return (): void => { pool.off('acquire', acquire); restores.forEach(restore => restore()); };
}
it('COMMIT ACK loss and crash before marker recover original durable identity and keep media', async () => {
  await withIsolatedPostgres('publication-crash', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); await task('crash');
    const commits = new Set<PoolClient>(); let lost = false;
    const restore = interceptQueries(async (client, sql, next) => {
      if (sql.includes('INSERT INTO wujie_canvas_asset_commands')) commits.add(client);
      const result = await next();
      if (sql === 'COMMIT' && commits.delete(client) && !lost) { lost = true; throw new Error('lost COMMIT acknowledgement'); }
      return result;
    });
    let result: Awaited<ReturnType<typeof publishDocumentTaskOutput>>;
    try { result = await publishDocumentTaskOutput('editor', 'crash', 0); } finally { restore(); }
    expect(lost).toBe(true);
    const before = await snapshot(query); const media = files();
    const restoreMarker = interceptQueries(async (_client, sql, next) => {
      if (sql.startsWith("UPDATE cloud_tasks SET result=jsonb_set")) throw new Error('crash before marker');
      return next();
    });
    try { await expect(projectCanvasTaskResult(input('crash'))).rejects.toThrow('crash before marker'); }
    finally { restoreMarker(); }
    expect(await snapshot(query)).toEqual(before); expect(files()).toEqual(media);
    expect(await projectCanvasTaskResult(input('crash'))).toEqual([result!.assetReference]);
    expect(await snapshot(query)).toEqual(before); expect(files()).toEqual(media);
  });
}, 60_000);

it('frozen layout survives source movement and deletion; output remove and replacement never resurrect on replay', async () => {
  await withIsolatedPostgres('publication-history', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); await task('history');
    const loaded = await loadDocument('shared'); const vector = Y.encodeStateVector(loaded.doc);
    applyCanvasImagePatch(loaded.doc, { placementId: 'placement-shared', x: 600 }, 'move');
    await commitDocumentUpdate({ actorId: 'editor', projectId: 'shared', bytes: Y.encodeStateAsUpdate(loaded.doc, vector) }); loaded.doc.destroy();
    await executeDocumentAssetCommand({ actorId: 'editor', projectId: 'shared', idempotencyKey: 'remove-source',
      command: { action: 'remove', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' } });
    const refs = await projectCanvasTaskResult(input('history')); const ref = refs![0];
    expect((await query('SELECT transform FROM wujie_workspace_placements WHERE id=$1', [ref.placementId])).rows[0].transform.x).toBe(132);
    await executeDocumentAssetCommand({ actorId: 'editor', projectId: 'shared', idempotencyKey: 'replace-output',
      command: { action: 'replace', placementId: ref.placementId!, expectedAssetVersionId: ref.assetVersionId!, assetVersionId: 'version-second' } });
    const replaced = await snapshot(query); expect(await projectCanvasTaskResult(input('history'))).toEqual(refs); expect(await snapshot(query)).toEqual(replaced);
    await executeDocumentAssetCommand({ actorId: 'editor', projectId: 'shared', idempotencyKey: 'remove-output',
      command: { action: 'remove', placementId: ref.placementId!, expectedAssetVersionId: 'version-second' } });
    const deleted = await snapshot(query); expect(await projectCanvasTaskResult(input('history'))).toEqual(refs); expect(await snapshot(query)).toEqual(deleted);
  });
}, 60_000);

it('explicit replace is independent of revision; stale CAS, multi replace and overflow have no partial writes', async () => {
  await withIsolatedPostgres('publication-replace', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName);
    const replace: CanvasPublicationIntentProposal = { ...proposal, placement: { action: 'replace', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' } };
    await task('multi-replace', replace, { imageUrls: ['/api/serve-upload/shared.png', '/api/serve-upload/shared.png'] });
    await task('stale', replace); await task('replace', replace);
    let before = await snapshot(query); let media = files();
    await expect(projectCanvasTaskResult(input('multi-replace'))).rejects.toThrow(); expect(await snapshot(query)).toEqual(before); expect(files()).toEqual(media);
    const refs = await projectCanvasTaskResult(input('replace')); expect(refs![0]).toMatchObject({ placementId: 'placement-shared', assetId: 'asset-shared' });
    before = await snapshot(query); media = files();
    await expect(projectCanvasTaskResult(input('stale'))).rejects.toThrow(); expect(await snapshot(query)).toEqual(before); expect(files()).toEqual(media);
    await task('overflow', { ...proposal, parentVersionIds: ['version-second'], placement: { action: 'append', selectedEntityIds: ['image-second'] } },
      { imageUrls: ['/api/serve-upload/shared.png', '/api/serve-upload/shared.png'] });
    await query(`UPDATE wujie_canvas_task_publications SET publication_intent=jsonb_set(publication_intent,'{placement,transform,x}','999999') WHERE task_id='overflow'`);
    before = await snapshot(query); media = files(); await expect(projectCanvasTaskResult(input('overflow'))).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(query)).toEqual(before); expect(files()).toEqual(media);
  });
}, 60_000);

for (const action of ['revoke', 'regrant', 'disable', 'archive', 'actor-disabled', 'global-off'] as const) {
  it(`media preparation ${action} blocks publication with original task/billing and no media leak`, async () => {
    await withIsolatedPostgres(`publication-deny-${action}`, async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName); await task('denied');
      const before = await snapshot(query); const media = files(); const tasks = await snapshot(query, ['cloud_tasks']);
      const original = binary.persistAssetBytes;
      vi.spyOn(binary, 'persistAssetBytes').mockImplementationOnce(async input => {
        const result = await original(input);
        if (action === 'revoke' || action === 'regrant') await revokeDocumentEditor('owner', 'shared', 'editor');
        if (action === 'regrant') await grantDocumentEditor('owner', 'shared', 'editor');
        if (action === 'disable') await query('UPDATE wujie_project_document_settings SET enabled=false');
        if (action === 'archive') await query("UPDATE wujie_projects SET status='trashed'");
        if (action === 'actor-disabled') await query("UPDATE wujie_users SET status='disabled' WHERE id='editor'");
        if (action === 'global-off') vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
        return result;
      });
      await expect(projectCanvasTaskResult(input('denied'))).rejects.toThrow();
      expect(await snapshot(query)).toEqual(before); expect(await snapshot(query, ['cloud_tasks'])).toEqual(tasks); expect(files()).toEqual(media);
    });
  }, 60_000);
}

for (const mutation of ['marker', 'url', 'metadata', 'parent-current', 'parent-metadata', 'other-asset'] as const) {
  it(`prepared snapshots allow only assetProjection marker changes: ${mutation}`, async () => {
    await withIsolatedPostgres(`publication-snapshot-${mutation}`, async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName); await task('snapshot'); const media = files();
      let afterMutation: Record<string, unknown> | undefined;
      const change = async (): Promise<void> => {
        if (mutation === 'marker') await recordTaskProjectionPending({ actorUserId: 'editor', taskId: 'snapshot', reason: 'parallel marker' });
        if (mutation === 'url') await query(`UPDATE cloud_tasks SET result=jsonb_set(result,'{imageUrl}','"/api/serve-upload/changed.png"')`);
        if (mutation === 'metadata') await query(`UPDATE cloud_tasks SET result=result || '{"metadata":{"changed":true}}'::jsonb`);
        if (mutation === 'parent-current') await query("UPDATE wujie_assets SET current_version_id=NULL WHERE id='asset-shared'");
        if (mutation === 'parent-metadata') await query(`UPDATE wujie_assets SET metadata='{"changed":true}' WHERE id='asset-shared'`);
        if (mutation === 'other-asset') await query(`UPDATE wujie_assets SET metadata='{"changed":true}' WHERE id='asset-second'`);
        afterMutation = await snapshot(query);
      };
      if (mutation === 'other-asset') {
        const original = managed.getManagedAssetMediaDescriptor;
        vi.spyOn(managed, 'getManagedAssetMediaDescriptor').mockImplementationOnce(async (...args) => { const result = await original(...args); await change(); return result; });
      } else {
        const original = binary.persistAssetBytes;
        vi.spyOn(binary, 'persistAssetBytes').mockImplementationOnce(async args => { const result = await original(args); await change(); return result; });
      }
      if (mutation === 'marker') expect(await projectCanvasTaskResult(input('snapshot'))).toHaveLength(1);
      else { await expect(projectCanvasTaskResult(input('snapshot'))).rejects.toThrow(); expect(await snapshot(query)).toEqual(afterMutation); expect(files()).toEqual(media); }
    });
  }, 60_000);
}

it('scope, legacy null, corrupt intent, database failure, forged capabilities and cancellation fail closed', async () => {
  await withIsolatedPostgres('publication-closed', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); await task('closed'); const before = await snapshot(query); const media = files();
    await expect(projectCanvasTaskResult(input('closed', 'owner'))).rejects.toThrow();
    await expect(projectCanvasTaskResult({ ...input('closed'), targetProjectId: 'other' })).rejects.toThrow();
    expect(() => taskPublicationSnapshot({ access: { ownerId: 'owner' } } as unknown as PreparedTaskPublication)).toThrow();
    expect(() => importedMediaIdentity({ assetId: 'asset-shared' } as unknown as PreparedImportedMedia)).toThrow();
    await expect(prepareAdoptedMedia({} as MediaTaskSource, 'editor', 'owner', 'shared', new AbortController().signal)).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await expect(publishDocumentTaskOutput('editor', 'closed', 0, controller.signal)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CANCELLED' });
    const intent = (await query('SELECT publication_intent FROM wujie_canvas_task_publications')).rows[0].publication_intent;
    for (const invalid of [null, {}, { ...intent, ownerId: 'forged' }]) {
      await query('UPDATE wujie_canvas_task_publications SET publication_intent=$1', [invalid]);
      await expect(projectCanvasTaskResult(input('closed'))).rejects.toMatchObject({ status: 409 });
    }
    await query('UPDATE wujie_canvas_task_publications SET publication_intent=$1', [intent]);
    await query('ALTER TABLE wujie_canvas_task_publications RENAME COLUMN publication_intent TO unavailable_intent');
    await expect(projectAgentResultToWorkspace({ ...input('closed'), idempotencyKey: 'no-fallback' })).rejects.toMatchObject({ status: 503 });
    await query('ALTER TABLE wujie_canvas_task_publications RENAME COLUMN unavailable_intent TO publication_intent');
    expect(await snapshot(query)).toEqual(before); expect(files()).toEqual(media);
  });
}, 60_000);

it('owner generic video-only result is a real video; structured Skill parent and 3D are not empty completed publications', async () => {
  await withIsolatedPostgres('publication-video', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName);
    writeFileSync(join(roots.root, 'video.mp4'), Buffer.from(readFileSync('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64', 'utf8'), 'base64'));
    await task('video', { ...proposal, projectionMode: 'derived' }, { videoUrl: '/api/serve-upload/video.mp4', imageUrls: [], images: [] }, 'owner');
    const refs = await projectCanvasTaskResult(input('video', 'owner')); expect(refs![0]).toMatchObject({ kind: 'video' });
    const row = (await query('SELECT mime_type,task_id FROM wujie_asset_versions WHERE id=$1', [refs![0].assetVersionId])).rows[0];
    expect(row).toEqual({ mime_type: 'video/mp4', task_id: 'video' });
    await task('skill', proposal, { steps: [{ outputs: { imageUrl: '/api/serve-upload/shared.png' } }] });
    expect(await projectCanvasTaskResult(input('skill'))).toEqual([]);
    expect((await query("SELECT result->'assetProjection' AS marker FROM cloud_tasks WHERE id='skill'")).rows[0].marker).toBeNull();
    await task('model', proposal, { assetUrl: '/api/serve-upload/model.glb' }); await query("UPDATE cloud_tasks SET type='3d-model' WHERE id='model'");
    await expect(projectCanvasTaskResult(input('model'))).rejects.toThrow();
  });
}, 60_000);
