import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

vi.hoisted(async () => {
  const url = new URL(process.env.POSTGRES_TEST_DATABASE_URL || '');
  if (!['127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Explicit loopback test database required');
  const { mkdtempSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = process.env.WUJIE_DATA_DIR || tmpdir();
  mkdirSync(root, { recursive: true });
  process.env.WUJIE_DATA_DIR = mkdtempSync(join(root, 'intent-'));
});
vi.mock('server-only', () => ({}));

import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { ensureCoreTables } from '@/lib/db-storage';
import { createAgentRuntimeService } from '@/lib/agent-runtime/service';
import type { AgentEvent, AgentRunRequest } from '@/lib/agent-runtime/types';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import type { CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { prepareCanvasTaskPublicationInTransaction, persistCanvasTaskPublicationInTransaction } from '@/lib/collaboration/task-publication';
import type { CanvasPublicationIntentProposal } from '@/lib/collaboration/task-publication-intent';
import * as publicationReader from '@/lib/collaboration/task-publication-access';
import { grantDocumentEditor, revokeDocumentEditor } from '@/lib/collaboration/document-access';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const request: AgentRunRequest = {
  projectId: 'shared', workspace: 'canvas', workspaceId: 'canvas:shared',
  mode: 'agent', providerId: 'provider', modelId: 'model', prompt: 'Use shared image',
  sourceVersionIds: ['version-shared'], allowedToolIds: ['generate_image'], idempotencyKey: 'run',
  context: { selectedEntityIds: ['image-shared'], visibleVersionIds: [], locale: 'zh-CN' },
};
const actor = { id: 'editor', name: 'Editor', role: 'user' as const, status: 'active' as const,
  productType: 'canvas,chat', createdAt: 1, updatedAt: 1 };
const expectedIntent = { version: 1, parentVersionIds: ['version-shared'], projectionMode: 'derived',
  placement: { action: 'attach', transform: { x: 132, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 }, strideX: 132 } };

async function seed(query: QueryFn, databaseUrl: string): Promise<void> {
  const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  console.log('Full migrations:', migration.status, migration.stdout, migration.stderr);
  expect(migration.status, migration.stderr || migration.stdout).toBe(0);
  await ensureCoreTables();
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1), ('editor','Editor','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  await query("INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('asset-shared','owner','shared','image')");
  await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,file_url,mime_type)
    VALUES ('version-shared','asset-shared','owner','shared','/api/serve-upload/shared.png','image/png')`);
  await query(`INSERT INTO wujie_workspace_placements
    (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
    VALUES ('placement-shared','owner','shared','asset-shared','version-shared','canvas','shared','canvas-image','image-shared')`);
  await query(`INSERT INTO wujie_project_canvas_documents (project_id,owner_id,projection)
    VALUES ('shared','owner',$1::jsonb)`, [JSON.stringify({ placements: { 'placement-shared': {
      assetVersionId: 'version-shared', x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0,
    } } })]);
  await query(`INSERT INTO wujie_credits (id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    SELECT 'credits_' || id,id,100,100,0,1,1 FROM wujie_users`);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}

function service(): ReturnType<typeof createAgentRuntimeService> {
  const events: AgentEvent[] = [];
  let sequence = 0;
  return createAgentRuntimeService({
    randomUUID: () => `service-task-${++sequence}`, now: () => 1,
    authorizeContext: authorizeAgentContext, createBillableTask,
    listRunEventStreams: async () => [],
    getTaskForUser: async () => { throw new Error('Unused boundary'); },
    transitionTask: async () => { throw new Error('Unused boundary'); },
    settleFailedTask: async () => { throw new Error('Unexpected event failure'); },
    abortTaskExecution: () => false, calculateCreditCost: async () => 7,
    resolveTaskModel: async () => ({
      providerId: 'provider', modelId: 'model', kind: 'chat', sourceType: 'chat',
      protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [],
      maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: ['text'], capabilitySources: {},
    }),
    appendEvent: async input => {
      const event: AgentEvent = { eventId: input.eventId, runId: input.runId, sequence: events.length + 1,
        type: input.type, timestamp: new Date(1).toISOString(), payload: input.payload };
      events.push(event); return event;
    },
    listEvents: async () => events,
  });
}

it('real createRun freezes parents and canonical placement inside actor billing transaction', async () => {
  await withIsolatedPostgres('intent-create-run', async ({ query, databaseUrl, schemaName }) => {
    console.log('Isolation:', schemaName, process.env.WUJIE_DATA_DIR);
    await seed(query, databaseUrl);
    const result = await service().createRun({ actor, request: structuredClone(request) });
    expect(result.charged).toBe(true);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
    const stored = (await query(`SELECT to_jsonb(p)->'publication_intent' AS intent
      FROM wujie_canvas_task_publications p WHERE task_id=$1`, ['service-task-1'])).rows[0];
    expect(stored.intent).toEqual(expectedIntent);
  });
}, 60_000);

const proposal: CanvasPublicationIntentProposal = { parentVersionIds: ['version-shared'], projectionMode: 'derived',
  placement: { action: 'append', selectedEntityIds: ['image-shared'] } };
const access = { kind: 'document' as const, actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '1' };
const conflict = { code: 'CANVAS_TASK_PUBLICATION_CONFLICT', status: 409 };
const unavailable = { code: 'CANVAS_TASK_PUBLICATION_UNAVAILABLE', status: 503 };

function billable(id: string, intent: CanvasPublicationIntentProposal | undefined = structuredClone(proposal)): CreateBillableTaskInput {
  return { userId: 'editor', idempotencyKey: id, requestDigest: 'digest', creditCost: 7,
    task: { id, projectId: 'shared', type: 'agent', status: 'processing', progress: 0, createdAt: 1, updatedAt: 1 },
    canvasPublication: { access: { ...access }, workspace: 'canvas', workspaceId: 'shared', intent } };
}
async function snapshot(query: QueryFn, tables: string[] = ['wujie_assets', 'wujie_asset_versions',
  'wujie_workspace_placements', 'wujie_project_canvas_documents', 'wujie_credits', 'wujie_credit_transactions',
  'cloud_tasks', 'wujie_canvas_task_publications']): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const table of tables) result[table] = (await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
}
async function stored(query: QueryFn, taskId: string): Promise<unknown> {
  return (await query('SELECT publication_intent FROM wujie_canvas_task_publications WHERE task_id=$1', [taskId])).rows[0]?.publication_intent;
}
async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

it('reads immutable historical intent after movement, deletion and result changes without new authorization', async () => {
  await withIsolatedPostgres('intent-history', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    await service().createRun({ actor, request: structuredClone(request) });
    await query(`UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,x}','600')`);
    await query(`UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now()`);
    await query(`UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,deleted}','true')`);
    await query(`UPDATE cloud_tasks SET result='{"submissionPayload":{"assetParentVersionIds":[]}}'`);
    await revokeDocumentEditor('owner', 'shared', 'editor');
    const before = await snapshot(query);
    const read = await transaction(client => publicationReader.readTaskPublicationIntent(client, 'editor', 'service-task-1'));
    expect(read).toEqual(expectedIntent);
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read!.parentVersionIds)).toBe(true);
    expect(Object.isFrozen(read!.placement)).toBe(true);
    if (read!.placement.action === 'attach') expect(Object.isFrozen(read!.placement.transform)).toBe(true);
    expect(await snapshot(query)).toEqual(before);
    await expect(transaction(client => publicationReader.readTaskPublicationIntent(client, 'owner', 'service-task-1')))
      .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
  });
}, 60_000);

it('reads null legacy records and rejects corrupt canonical JSON and database failures', async () => {
  await withIsolatedPostgres('intent-reader-errors', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const legacy = billable('legacy'); delete legacy.canvasPublication!.intent;
    await createBillableTask(legacy);
    expect(await transaction(client => publicationReader.readTaskPublicationIntent(client, 'editor', 'legacy'))).toBeNull();
    expect(await transaction(client => publicationReader.readTaskPublicationIntent(client, 'editor', 'missing'))).toBeNull();
    const corrupt = [ {}, { ...expectedIntent, version: 2 }, { ...expectedIntent, grant: '99' },
      { ...expectedIntent, projectionMode: 'revision', parentVersionIds: [] },
      { ...expectedIntent, placement: { ...expectedIntent.placement, strideX: 1 } },
      { ...expectedIntent, placement: { ...expectedIntent.placement, transform: { ...expectedIntent.placement.transform, x: 1_000_001 } } },
      { ...expectedIntent, placement: { ...expectedIntent.placement, ownerId: 'attacker' } },
      { ...expectedIntent, placement: { action: 'append', selectedEntityIds: [] } },
      { ...expectedIntent, parentVersionIds: ['version-shared', 'version-shared'] },
      { ...expectedIntent, parentVersionIds: ['https:bad'] } ];
    for (const intent of corrupt) {
      await query('UPDATE wujie_canvas_task_publications SET publication_intent=$1', [intent]);
      await expect(transaction(client => publicationReader.readTaskPublicationIntent(client, 'editor', 'legacy'))).rejects.toMatchObject(conflict);
    }
    await query('ALTER TABLE wujie_canvas_task_publications RENAME COLUMN publication_intent TO hidden_intent');
    await expect(transaction(client => publicationReader.readTaskPublicationIntent(client, 'editor', 'legacy'))).rejects.toMatchObject(unavailable);
    await query('ALTER TABLE wujie_canvas_task_publications RENAME COLUMN hidden_intent TO publication_intent');
    await query("UPDATE cloud_tasks SET project_id='other'");
    await expect(transaction(client => publicationReader.readTaskPublicationIntent(client, 'editor', 'legacy')))
      .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
  });
}, 60_000);

it('supports both aliases, owner/editor, unselected and empty layouts, ordered parents and revision independent of replace', async () => {
  await withIsolatedPostgres('intent-layouts', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const runtime = service();
    const protectedTables = ['wujie_assets', 'wujie_asset_versions', 'wujie_workspace_placements', 'wujie_project_canvas_documents'];
    const before = await snapshot(query, protectedTables);
    for (const [index, workspaceId] of ['shared', 'canvas:shared'].entries()) {
      await runtime.createRun({ actor: { ...actor, id: index ? 'owner' : 'editor' },
        request: { ...structuredClone(request), workspaceId, idempotencyKey: `alias-${index}` } });
    }
    expect((await query('SELECT publication_intent FROM wujie_canvas_task_publications')).rows)
      .toEqual([{ publication_intent: expectedIntent }, { publication_intent: expectedIntent }]);
    expect(await snapshot(query, protectedTables)).toEqual(before);
    await query(`INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-second','owner','shared','image')`);
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-second','asset-second','owner','shared','/api/serve-upload/second.png','image/png')`);
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-second','owner','shared','asset-second','version-second','canvas','canvas:shared','canvas-image','image-second')`);
    await query(`UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-second}',$1)`,
      [{ assetVersionId: 'version-second', x: -300, y: 40, width: 200, height: 80, rotation: 30, zIndex: 1000000 }]);
    const ordered = { parentVersionIds: ['version-second', 'version-shared'], projectionMode: 'derived' as const,
      placement: { action: 'append' as const, selectedEntityIds: ['image-second', 'image-shared'] } };
    await createBillableTask(billable('multi', ordered));
    expect(await stored(query, 'multi')).toEqual({ version: 1, parentVersionIds: ['version-second', 'version-shared'], projectionMode: 'derived',
      placement: { action: 'attach', transform: { x: -68, y: 40, width: 200, height: 80, rotation: 0, zIndex: 1000000 }, strideX: 232 } });
    await createBillableTask(billable('unselected', { ...proposal, placement: { action: 'append', selectedEntityIds: [] } }));
    expect(await stored(query, 'unselected')).toEqual({ version: 1, parentVersionIds: ['version-shared'], projectionMode: 'derived',
      placement: { action: 'attach', transform: { x: 132, y: 0, width: 512, height: 512, rotation: 0, zIndex: 0 }, strideX: 544 } });
    for (const projectionMode of ['derived', 'revision'] as const) {
      const replacement = { ...proposal, projectionMode, placement: { action: 'replace' as const,
        placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' } };
      await createBillableTask(billable(`replace-${projectionMode}`, replacement));
      expect(await stored(query, `replace-${projectionMode}`)).toEqual({ version: 1, ...replacement });
    }
    await createBillableTask(billable('revision-append', { ...proposal, projectionMode: 'revision' }));
    expect(await stored(query, 'revision-append')).toEqual({ ...expectedIntent, projectionMode: 'revision' });
    await query(`UPDATE wujie_project_canvas_documents SET projection='{"placements":{}}'`);
    await createBillableTask(billable('empty', { parentVersionIds: [], projectionMode: 'derived', placement: { action: 'append', selectedEntityIds: [] } }));
    expect(await stored(query, 'empty')).toEqual({ version: 1, parentVersionIds: [], projectionMode: 'derived',
      placement: { action: 'attach', transform: { x: 0, y: 0, width: 512, height: 512, rotation: 0, zIndex: 0 }, strideX: 544 } });
  });
}, 60_000);

it('rejects malformed proposals without any asset, document, task or billing writes', async () => {
  await withIsolatedPostgres('intent-proposal-denials', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const malformed: unknown[] = [null, {}, { ...proposal, ownerId: 'owner' }, { ...proposal, projectionMode: 'replace' },
      { ...proposal, projectionMode: 'revision', parentVersionIds: [] },
      { ...proposal, projectionMode: 'revision', parentVersionIds: ['version-shared', 'version-second'] },
      ...[['version-shared', 'version-shared'], [''], ['data:image'], ['processing-1'], ['https://bad'], ['a\n'], ['x'.repeat(161)],
        Array.from({ length: 33 }, (_, i) => `v-${i}`)].map(parentVersionIds => ({ ...proposal, parentVersionIds })),
      { ...proposal, placement: { action: 'append', selectedEntityIds: ['image-shared', 'image-shared'] } },
      { ...proposal, placement: { action: 'append', selectedEntityIds: [''] } },
      { ...proposal, placement: { action: 'append', selectedEntityIds: [], transform: {} } },
      { ...proposal, placement: { action: 'replace', placementId: 'placement-shared' } },
      { ...proposal, placement: { action: 'replace', placementId: 'image-shared', expectedAssetVersionId: 'version-shared' } },
      { ...proposal, placement: { action: 'replace', placementId: 'placement-shared', expectedAssetVersionId: 'version-old' } },
    ];
    for (const intent of malformed) {
      const before = await snapshot(query);
      await expect(createBillableTask(billable('invalid', intent as CanvasPublicationIntentProposal))).rejects.toMatchObject(conflict);
      expect(await snapshot(query)).toEqual(before);
    }
  });
}, 60_000);

it('revalidates canonical scope, visibility, version binding, state, MIME and numerical bounds in billing', async () => {
  await withIsolatedPostgres('intent-source-denials', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const scenarios: Array<[string, string]> = [
      ["UPDATE wujie_workspace_placements SET workspace_id='private'", "UPDATE wujie_workspace_placements SET workspace_id='shared'"],
      ["UPDATE wujie_workspace_placements SET workspace_id='canvas:canvas:shared'", "UPDATE wujie_workspace_placements SET workspace_id='shared'"],
      ["UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now()", "UPDATE wujie_workspace_placements SET status='active',deleted_at=NULL"],
      ["UPDATE wujie_assets SET status='trashed'", "UPDATE wujie_assets SET status='active'"],
      ["UPDATE wujie_asset_versions SET availability='missing'", "UPDATE wujie_asset_versions SET availability='ready'"],
      ["UPDATE wujie_asset_versions SET mime_type='video/mp4'", "UPDATE wujie_asset_versions SET mime_type='image/png'"],
      ["UPDATE wujie_asset_versions SET mime_type='application/json'", "UPDATE wujie_asset_versions SET mime_type='image/png'"],
      ["UPDATE wujie_assets SET kind='video'", "UPDATE wujie_assets SET kind='image'"],
      ["UPDATE wujie_workspace_placements SET workspace_kind='workflow',entity_type='workflow-input'",
        "UPDATE wujie_workspace_placements SET workspace_kind='canvas',entity_type='canvas-image'"],
      ["UPDATE wujie_workspace_placements SET entity_type='canvas-video'", "UPDATE wujie_workspace_placements SET entity_type='canvas-image'"],
      ["UPDATE wujie_project_canvas_documents SET projection=jsonb_build_object('placements',jsonb_build_object('image-shared',projection->'placements'->'placement-shared'))",
        "UPDATE wujie_project_canvas_documents SET projection=jsonb_build_object('placements',jsonb_build_object('placement-shared',projection->'placements'->'image-shared'))"],
      ["UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,deleted}','true')",
        "UPDATE wujie_project_canvas_documents SET projection=projection #- '{placements,placement-shared,deleted}'"],
      ["UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,assetVersionId}','\"version-old\"')",
        "UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,assetVersionId}','\"version-shared\"')"],
      ["UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,x}','999900')",
        "UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,x}','0')"],
      ["UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,width}','0')",
        "UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,width}','100')"],
    ];
    for (const [change, restore] of scenarios) {
      await query(change);
      const before = await snapshot(query);
      await expect(createBillableTask(billable('denied'))).rejects.toMatchObject(conflict);
      expect(await snapshot(query)).toEqual(before);
      await query(restore);
    }
    // An authorized snapshot is insufficient when its actual parent belongs elsewhere.
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('other','owner','Other')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-other','owner','other','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-other','asset-other','owner','other','/api/serve-upload/other.png','image/png')`);
    const before = await snapshot(query);
    await expect(createBillableTask(billable('foreign', { ...proposal, parentVersionIds: ['version-other'] }))).rejects.toMatchObject(conflict);
    expect(await snapshot(query)).toEqual(before);
  });
}, 60_000);

it.each([null, '', ' \t ', '  IMAGE/PNG  ', 'image/heic', 'image/heif'])(
  'real createRun preserves historical/source MIME compatibility %j and bills once', async mime => {
    await withIsolatedPostgres('intent-mime-compatible', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl);
      await query('UPDATE wujie_asset_versions SET mime_type=$1', [mime]);
      const before = await snapshot(query, ['wujie_assets', 'wujie_asset_versions', 'wujie_workspace_placements', 'wujie_project_canvas_documents']);
      const runtime = service();
      await expect(runtime.createRun({ actor, request: structuredClone(request) })).resolves.toMatchObject({ charged: true });
      await expect(runtime.createRun({ actor, request: structuredClone(request) })).resolves.toMatchObject({ charged: false });
      expect(await stored(query, 'service-task-1')).toEqual(expectedIntent);
      expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
        .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
      expect((await query('SELECT user_id,balance FROM wujie_credits ORDER BY user_id')).rows)
        .toEqual([{ user_id: 'editor', balance: 93 }, { user_id: 'owner', balance: 100 }]);
      expect(await snapshot(query, ['wujie_assets', 'wujie_asset_versions', 'wujie_workspace_placements', 'wujie_project_canvas_documents'])).toEqual(before);
    });
  }, 60_000,
);

it('real createRun still rejects wrong MIME category without a charge', async () => {
  await withIsolatedPostgres('intent-mime-category', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    await query("UPDATE wujie_asset_versions SET mime_type=' video/mp4 '");
    const before = await snapshot(query);
    await expect(service().createRun({ actor, request: structuredClone(request) })).rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND' });
    await expect(createBillableTask(billable('wrong-category'))).rejects.toMatchObject(conflict);
    expect(await snapshot(query)).toEqual(before);
  });
}, 60_000);

it('real createRun permits more than 32 selected placements sharing one parent and retains the first anchor', async () => {
  await withIsolatedPostgres('intent-many-selections', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const placements: Record<string, unknown> = {};
    const selectedEntityIds: string[] = [];
    for (let i = 0; i < 33; i++) {
      await query(`INSERT INTO wujie_workspace_placements
        (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
        VALUES ($1,'owner','shared','asset-shared','version-shared','canvas','shared','canvas-image',$2)`, [`placement-${i}`, `image-${i}`]);
      placements[`placement-${i}`] = { assetVersionId: 'version-shared', x: i * 100, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0 };
      selectedEntityIds.push(`image-${i}`);
    }
    await query('UPDATE wujie_project_canvas_documents SET projection=$1', [{ placements }]);
    await service().createRun({ actor, request: { ...structuredClone(request), context: { ...request.context, selectedEntityIds } } });
    expect(await stored(query, 'service-task-1')).toEqual(expectedIntent);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
  });
}, 60_000);

it('metadata-only billing supports canonical video and does not add a format whitelist', async () => {
  await withIsolatedPostgres('intent-media-kind', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    await query("UPDATE wujie_asset_versions SET mime_type='image/future-format'");
    await createBillableTask(billable('image-metadata'));
    expect(await stored(query, 'image-metadata')).toEqual(expectedIntent);
    await query("UPDATE wujie_assets SET kind='video'");
    await query("UPDATE wujie_workspace_placements SET entity_type='canvas-video'");
    await query("UPDATE wujie_asset_versions SET mime_type=' VIDEO/MP4 '");
    await createBillableTask(billable('video-metadata'));
    expect(await stored(query, 'video-metadata')).toEqual(expectedIntent);
    await query("UPDATE wujie_asset_versions SET mime_type='image/png'");
    const before = await snapshot(query);
    await expect(createBillableTask(billable('video-wrong-mime'))).rejects.toMatchObject(conflict);
    expect(await snapshot(query)).toEqual(before);
  });
}, 60_000);

it('old unplaced parents, foreign owners and mismatched asset binding cannot mint intent', async () => {
  await withIsolatedPostgres('intent-parent-scope', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-old','asset-shared','owner','shared','/api/serve-upload/old.png','image/png')`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-private','editor','private','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-private','asset-private','editor','private','/api/serve-upload/private.png','image/png')`);
    for (const parentVersionIds of [['version-old'], ['version-private'], ['version-shared', 'version-old']]) {
      const before = await snapshot(query);
      await expect(createBillableTask(billable('parents', { ...proposal, parentVersionIds }))).rejects.toMatchObject(conflict);
      expect(await snapshot(query)).toEqual(before);
    }
    // Composite FK independently guarantees asset/version/owner/project binding.
    await expect(query("UPDATE wujie_workspace_placements SET asset_id='asset-private'"))
      .rejects.toMatchObject({ code: '23503' });
    // Canonical old versions are valid even when asset.current_version_id has advanced.
    await query("UPDATE wujie_assets SET current_version_id='version-old' WHERE id='asset-shared'");
    await createBillableTask(billable('canonical-not-latest'));
    expect(await stored(query, 'canonical-not-latest')).toEqual(expectedIntent);
  });
}, 60_000);

it('unselected layout ignores tombstones, preserves negative right edges and refuses overflowing output', async () => {
  await withIsolatedPostgres('intent-right-edge', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const unselected: CanvasPublicationIntentProposal = { parentVersionIds: [], projectionMode: 'derived', placement: { action: 'append', selectedEntityIds: [] } };
    await query(`UPDATE wujie_project_canvas_documents SET projection=$1`, [{ placements: {
      'placement-shared': { assetVersionId: 'version-shared', x: -500, y: 40, width: 100, height: 100, rotation: 20, zIndex: 2 },
      'placement-deleted': { assetVersionId: 'version-old', x: 900000, y: 0, width: 512, height: 512, rotation: 0, zIndex: 0, deleted: true },
    } }]);
    await createBillableTask(billable('negative', unselected));
    expect(await stored(query, 'negative')).toEqual({ version: 1, parentVersionIds: [], projectionMode: 'derived',
      placement: { action: 'attach', transform: { x: -368, y: 0, width: 512, height: 512, rotation: 0, zIndex: 0 }, strideX: 544 } });
    await query(`UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,x}','999900')`);
    const before = await snapshot(query);
    await expect(createBillableTask(billable('overflow', unselected))).rejects.toMatchObject(conflict);
    expect(await snapshot(query)).toEqual(before);
    await query(`UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,deleted}','true')`);
    await createBillableTask(billable('only-tombstones', unselected));
    expect(await stored(query, 'only-tombstones')).toMatchObject({ placement: { transform: { x: 0, y: 0 } } });
  });
}, 60_000);

it('20 real createRun calls keep one intent and one charge; replay and regrant never upgrade it or legacy null', async () => {
  await withIsolatedPostgres('intent-concurrency', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const runtime = service();
    const results = await Promise.all(Array.from({ length: 20 }, () => runtime.createRun({ actor, request: structuredClone(request) })));
    expect(results.filter(result => result.charged)).toHaveLength(1);
    expect((await query('SELECT count(*)::int AS n FROM cloud_tasks')).rows).toEqual([{ n: 1 }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
    const publication = (await query('SELECT task_id,publication_intent,grant_generation::text FROM wujie_canvas_task_publications')).rows[0];
    expect(publication.publication_intent).toEqual(expectedIntent);
    expect(publication.grant_generation).toBe('1');
    const legacy = billable('legacy'); delete legacy.canvasPublication!.intent;
    await createBillableTask(legacy);
    const migrationSql = readFileSync(resolve('migrations/20260927_yjs_canvas_task_publications_intent.sql'), 'utf8');
    await query(migrationSql); await query(migrationSql);
    expect(await stored(query, 'legacy')).toBeNull();
    await revokeDocumentEditor('owner', 'shared', 'editor');
    await grantDocumentEditor('owner', 'shared', 'editor');
    await query(`UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,x}','700')`);
    const beforeReplay = await snapshot(query);
    await runtime.createRun({ actor, request: structuredClone(request) });
    expect(await snapshot(query)).toEqual(beforeReplay);
    for (const status of ['completed', 'failed', 'cancelled']) {
      await query('UPDATE cloud_tasks SET status=$1,result=$2 WHERE id=$3', [status, { altered: true }, publication.task_id]);
      const before = await snapshot(query);
      await expect(runtime.createRun({ actor, request: structuredClone(request) })).rejects.toMatchObject({ code: 'AGENT_RUN_TERMINAL' });
      expect(await snapshot(query)).toEqual(before);
    }
    const upgraded = billable('legacy'); upgraded.canvasPublication!.access.grantGeneration = '3';
    await expect(createBillableTask(upgraded)).resolves.toMatchObject({ reused: true, charged: false });
    expect(await stored(query, 'legacy')).toBeNull();
    expect((await query('SELECT grant_generation::text FROM wujie_canvas_task_publications WHERE task_id=$1', [publication.task_id])).rows)
      .toEqual([{ grant_generation: '1' }]);
    const stale = billable('stale');
    await expect(createBillableTask(stale)).rejects.toMatchObject({ status: 403 });
  });
}, 60_000);

it('synchronously copies the proposal before SQL waits and holds the document against competing movement', async () => {
  await withIsolatedPostgres('intent-copy-lock', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const task = billable('copy'); delete task.canvasPublication;
    await createBillableTask(task);
    const pool = getPool();
    const client = await pool.connect();
    const mover = await pool.connect();
    const input = billable('copy').canvasPublication!;
    const originalQuery = client.query.bind(client) as QueryFn;
    let reached!: () => void;
    let proceed!: () => void;
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { proceed = resolve; });
    let first = true;
    vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
      if (first) { first = false; reached(); await gate; }
      return originalQuery(sql, values);
    }) as typeof client.query);
    let preparation: ReturnType<typeof prepareCanvasTaskPublicationInTransaction> | undefined;
    let movement: Promise<unknown> | undefined;
    try {
      await originalQuery('BEGIN');
      preparation = prepareCanvasTaskPublicationInTransaction(client, { actorUserId: 'editor', projectId: 'shared', publication: input });
      await waiting;
      input.intent!.parentVersionIds[0] = 'version-forged';
      input.intent!.projectionMode = 'revision';
      if (input.intent!.placement.action === 'append') input.intent!.placement.selectedEntityIds[0] = 'image-forged';
      proceed();
      const handle = await preparation;
      const pid = (await mover.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await mover.query('BEGIN');
      movement = mover.query(`UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-shared,x}','900')`);
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        blocked = (await query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await persistCanvasTaskPublicationInTransaction(client, { taskId: 'copy', publication: handle });
      await originalQuery('COMMIT');
      await movement; await mover.query('COMMIT');
      expect(await stored(query, 'copy')).toEqual(expectedIntent);
    } finally {
      proceed(); await preparation?.catch(() => undefined);
      await originalQuery('ROLLBACK'); await movement?.catch(() => undefined);
      await mover.query('ROLLBACK'); client.release(); mover.release(); vi.restoreAllMocks();
    }
    expect(pool.idleCount).toBe(pool.totalCount);
  });
}, 60_000);

it('rolls back intent resolution, insert and exact-match failures with no partial charge', async () => {
  await withIsolatedPostgres('intent-rollback', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const warm = billable('warm'); delete warm.canvasPublication; warm.creditCost = 0;
    await createBillableTask(warm);
    for (const phase of ['projection', 'source', 'insert', 'exact', 'commit']) {
      const before = await snapshot(query);
      const pool = getPool();
      const client = await pool.connect();
      const original = client.query.bind(client) as QueryFn;
      vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
        if ((phase === 'projection' && sql.startsWith('SELECT projection'))
          || (phase === 'source' && sql.includes('SELECT p.id,p.entity_id'))
          || (phase === 'insert' && sql.includes('INSERT INTO wujie_canvas_task_publications'))
          || (phase === 'exact' && sql.includes('publication_intent IS NOT DISTINCT'))
          || (phase === 'commit' && sql === 'COMMIT')) return original('SELECT missing_intent_test_column');
        return original(sql, values);
      }) as typeof client.query);
      vi.spyOn(pool, 'connect').mockImplementationOnce(async (): Promise<PoolClient> => client);
      try { await expect(createBillableTask(billable(`failure-${phase}`))).rejects.toMatchObject(unavailable); }
      finally { vi.restoreAllMocks(); }
      expect(await snapshot(query)).toEqual(before);
      expect(pool.idleCount).toBe(pool.totalCount);
    }
    await createBillableTask(billable('exact-task'));
    const before = await snapshot(query);
    await expect(transaction(async client => {
      const changed = billable('exact-task', { ...proposal, projectionMode: 'revision' });
      const prepared = await prepareCanvasTaskPublicationInTransaction(client, { actorUserId: 'editor', projectId: 'shared', publication: changed.canvasPublication! });
      await persistCanvasTaskPublicationInTransaction(client, { taskId: 'exact-task', publication: prepared });
    })).rejects.toMatchObject(conflict);
    expect(await snapshot(query)).toEqual(before);
    await transaction(async client => {
      const prepared = await prepareCanvasTaskPublicationInTransaction(client, { actorUserId: 'editor', projectId: 'shared', publication: billable('exact-task').canvasPublication! });
      await persistCanvasTaskPublicationInTransaction(client, { taskId: 'exact-task', publication: prepared });
    });
    expect(await snapshot(query)).toEqual(before);
    for (const invalid of ['[]', '1', '"text"', 'null']) {
      await expect(query('UPDATE wujie_canvas_task_publications SET publication_intent=$1::jsonb', [invalid])).rejects.toMatchObject({ code: '23514' });
    }
    expect((await query(`SELECT state FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND state LIKE 'idle in transaction%'`)).rows).toEqual([]);
  });
}, 60_000);
