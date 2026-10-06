import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
const roots = await vi.hoisted(async () => {
  const database = process.env.POSTGRES_TEST_DATABASE_URL;
  if (!database || !['127.0.0.1', '[::1]'].includes(new URL(database).hostname)) throw new Error('Explicit loopback database required');
  const fs = await import('node:fs'); const path = await import('node:path'); const os = await import('node:os');
  const base = process.env.WUJIE_DATA_DIR || os.tmpdir(); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'recovery-')); process.env.WUJIE_DATA_DIR = root;
  return { root };
});
const auth = vi.hoisted(() => ({ id: 'editor' as string | null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async (): Promise<{ id: string } | null> => auth.id ? { id: auth.id } : null }));
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { ensureCoreTables } from '@/lib/db-storage';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { transitionTask } from '@/lib/task-core/task-service';
import { recordTaskProjectionPending } from '@/lib/asset-core/task-projector';
import { GET } from '@/app/api/tasks/recover/route';
import { recordImageTaskTerminal } from '@/lib/cloud-task-persistence';
import { revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { projectCanvasTaskResult } from '@/lib/collaboration/task-result-publication';
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); auth.id = 'editor'; });
it('late pending cannot downgrade real committed completed marker', async () => {
  await withIsolatedPostgres('marker-monotonic', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); await create('task');
    await projectCanvasTaskResult({ actorUserId: 'editor', taskId: 'task', targetProjectId: 'shared', workspace: 'canvas', parentVersionIds: [] });
    const before = (await query('SELECT result FROM cloud_tasks')).rows;
    expect(before[0].result.assetProjection.status).toBe('completed');
    await recordTaskProjectionPending({ actorUserId: 'editor', taskId: 'task', reason: 'late failure' });
    expect((await query('SELECT result FROM cloud_tasks')).rows).toEqual(before);
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
  writeFileSync(join(roots.root, 'result.png'), await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer());
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    SELECT 'credits_' || id,id,100,100,0,1,1 FROM wujie_users`);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}
async function create(id: string, actorId: string = 'editor', legacyNull: boolean = false): Promise<void> {
  await createBillableTask({ userId: actorId, idempotencyKey: id, requestDigest: id, creditCost: 7,
    task: { id, projectId: 'shared', type: 'agent-run', status: 'processing', progress: 0, createdAt: Date.now(), updatedAt: Date.now() },
    canvasPublication: { access: { kind: 'document', actorUserId: actorId, ownerId: 'owner', projectId: 'shared',
      grantGeneration: actorId === 'owner' ? '0' : '1' }, workspace: 'canvas', workspaceId: 'shared',
      ...(!legacyNull ? { intent: { parentVersionIds: [], projectionMode: 'derived', placement: { action: 'append', selectedEntityIds: [] } } as const } : {}) } });
  await transitionTask({ taskId: id, from: ['processing'], to: 'completed', creditStatus: 'charged', result: { imageUrl: '/api/serve-upload/result.png' } });
}
function request(project: string = 'shared', legacy: boolean = false): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/recover?projectId=${project}${legacy ? '&includeLegacyUnassigned=1' : ''}`);
}
for (const marker of ['none', 'pending'] as const) {
  it(`real GET recovers ${marker} marker and returns newly committed complete references in the same HTTP response`, async () => {
    await withIsolatedPostgres(`recover-${marker}`, async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName); await create('task');
      if (marker === 'pending') await recordTaskProjectionPending({ actorUserId: 'editor', taskId: 'task', reason: 'crash' });
      const response = await GET(request()); const body = await response.json();
      expect(response.status).toBe(200); expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].result.assetProjection?.status).toBe('completed');
      const rows = (await query(`SELECT c.asset_id,c.asset_version_id,c.placement_id,p.entity_id,v.file_url,a.kind
        FROM wujie_canvas_asset_commands c JOIN wujie_assets a ON a.id=c.asset_id
        JOIN wujie_asset_versions v ON v.id=c.asset_version_id JOIN wujie_workspace_placements p ON p.id=c.placement_id`)).rows;
      expect(rows).toHaveLength(1);
      expect(body.tasks[0].result.assetProjection.references).toEqual([{ assetId: rows[0].asset_id, assetVersionId: rows[0].asset_version_id,
        placementId: rows[0].placement_id, entityId: rows[0].entity_id, url: rows[0].file_url, kind: 'image' }]);
      const original = body.tasks[0].result.assetProjection;
      await recordTaskProjectionPending({ actorUserId: 'editor', taskId: 'task', reason: 'late failed contender' });
      expect((await (await GET(request())).json()).tasks[0].result.assetProjection).toEqual(original);
      expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
        .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
    });
  }, 60_000);
}

it('real GET isolates actor/project/legacy and interleaves cloud completion without duplicate publication', async () => {
  await withIsolatedPostgres('recover-isolation', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); await create('editor-task'); await create('owner-task', 'owner'); await create('null-intent', 'editor', true);
    await query(`INSERT INTO cloud_tasks(id,user_id,project_id,type,status,result,created_at,updated_at) VALUES
      ('other','editor','other','generate','completed','{"imageUrl":"private"}',1,1),
      ('legacy','editor',NULL,'generate','completed','{"imageUrl":"legacy"}',1,1),
      ('legacy-agent','editor',NULL,'agent-edit','completed','{"imageUrl":"hidden"}',1,1)`);
    expect((await (await GET(request('other'))).json()).tasks.map((value: { id: string }) => value.id)).toEqual(['other']);
    const [response] = await Promise.all([GET(request('shared', true)), recordImageTaskTerminal('editor-task', { status: 'completed', imageUrl: '/api/serve-upload/result.png' })]);
    const body = await response.json();
    expect(body.tasks.map((value: { id: string }) => value.id).sort()).toEqual(['editor-task', 'legacy', 'null-intent']);
    expect(body.tasks.find((value: { id: string }) => value.id === 'editor-task').result.assetProjection.status).toBe('completed');
    expect(body.tasks.find((value: { id: string }) => value.id === 'null-intent').result.assetProjection).toBeUndefined();
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
    auth.id = 'owner'; const owner = await (await GET(request())).json();
    expect(owner.tasks.map((value: { id: string }) => value.id)).toEqual(['owner-task']);
    auth.id = null; expect((await GET(request())).status).toBe(401);
  });
}, 60_000);

it('real GET preserves personal completed result and pending after editor revocation', async () => {
  await withIsolatedPostgres('recover-revoked', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); await create('task'); await revokeDocumentEditor('owner', 'shared', 'editor');
    const response = await (await GET(request())).json();
    expect(response.tasks[0]).toMatchObject({ status: 'completed', result: { imageUrl: '/api/serve-upload/result.png', assetProjection: { status: 'projection_pending' } } });
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows).toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
  });
}, 60_000);
