import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { writeFileSync, renameSync } from 'node:fs';
import sharp from 'sharp';
import * as Y from 'yjs';
import { afterEach, expect, it, vi } from 'vitest';

const roots = await vi.hoisted(async () => {
  const database = process.env.POSTGRES_TEST_DATABASE_URL;
  if (!database || !['127.0.0.1', '[::1]'].includes(new URL(database).hostname)) {
    throw new Error('Explicit loopback test database required');
  }
  const { mkdtempSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const base = process.env.WUJIE_DATA_DIR || tmpdir();
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'completion-'));
  process.env.WUJIE_DATA_DIR = root;
  return { root };
});
vi.mock('server-only', () => ({}));
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { saveFixtureMigrationLog } from '../helpers/fixture-migration-log';
import { ensureCoreTables } from '@/lib/db-storage';
import { createAgentRuntimeService } from '@/lib/agent-runtime/service';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import { createBillableTask, settleFailedTask } from '@/lib/task-core/billing-service';
import { transitionTask } from '@/lib/task-core/task-service';
import { getCloudTaskForUser } from '@/lib/cloud-task-storage';
import * as cloudStorage from '@/lib/cloud-task-storage';
import { appendAgentEvent, listAgentEventsForActor, listAgentEventStreamsForActor } from '@/lib/agent-runtime/event-storage';
import { recordImageTaskTerminal, projectPersistedCompletedTask } from '@/lib/cloud-task-persistence';
import { recordAgentTaskTerminal } from '@/lib/agent-task-persistence';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import { createCanvasDocument, applyCanvasImagePatch, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import * as safeImage from '@/lib/safe-image-input';

afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('a completion projection read failure preserves accepted real event and records pending without refund', async () => {
  await withIsolatedPostgres('completion-read-failure', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); const runtime = service();
    const created = await runtime.createRun({ actor, request: structuredClone(request) });
    // Runtime already holds the real storage dependency; fail only the shared
    // completion projection's subsequent read, after its real terminal/event writes.
    const read = vi.spyOn(cloudStorage, 'getCloudTaskForUser').mockRejectedValueOnce(new Error('projection read unavailable'));
    await expect(runtime.appendEvent({ actorUserId: 'editor', runId: created.runId, eventId: 'read-failure', type: 'run.completed',
      payload: { result: { imageUrl: '/api/serve-upload/shared.png' } } })).resolves.toMatchObject({ accepted: true });
    read.mockRestore();
    expect((await getCloudTaskForUser(created.runId, 'editor'))!).toMatchObject({ status: 'completed', result: { assetProjection: { status: 'projection_pending' } } });
    expect((await listAgentEventsForActor({ actorUserId: 'editor', projectId: 'shared', runId: created.runId })).filter(event => event.type === 'run.completed')).toHaveLength(1);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows).toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
  });
}, 60_000);
for (const status of ['failed', 'cancelled', 'timeout'] as const) {
  it(`late cloud and agent-edit outputs never revive ${status} or repeat its settlement`, async () => {
    await withIsolatedPostgres(`completion-late-${status}`, async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName); const created = await service().createRun({ actor, request: structuredClone(request) });
      await recordAgentTaskTerminal(created.runId, { status, error: 'terminal' });
      const billing = (await query('SELECT to_jsonb(t) AS row FROM wujie_credit_transactions t ORDER BY id')).rows;
      await recordImageTaskTerminal(created.runId, { status: 'completed', imageUrl: '/api/serve-upload/shared.png' });
      await recordAgentTaskTerminal(created.runId, { status: 'completed', imageUrl: '/api/serve-upload/shared.png' });
      expect((await getCloudTaskForUser(created.runId, 'editor'))!.status).toBe(status);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toEqual([]);
      expect((await query('SELECT to_jsonb(t) AS row FROM wujie_credit_transactions t ORDER BY id')).rows).toEqual(billing);
      expect((await query("SELECT result->'assetProjectionLateAudit' AS audit FROM cloud_tasks")).rows[0].audit)
        .toMatchObject({ status: 'isolated', terminalStatus: status, urls: ['/api/serve-upload/shared.png'] });
    });
  }, 60_000);
}
it('already completed cloud replay does not read callback media while initial alpha and enrich still inspect', async () => {
  await withIsolatedPostgres('cloud-replay-no-io', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName); const created = await service().createRun({ actor, request: structuredClone(request) });
    await query(`UPDATE cloud_tasks SET result='{"submissionPayload":{"background":"transparent"}}' WHERE id=$1`, [created.runId]);
    const read = vi.spyOn(safeImage, 'loadSafeImageInput'); // calls through to real local bytes
    await recordImageTaskTerminal(created.runId, { status: 'completed', imageUrl: '/api/serve-upload/shared.png' });
    expect(read.mock.calls.filter(([url]) => url === '/api/serve-upload/shared.png').length).toBeGreaterThanOrEqual(2);
    const original = (await query('SELECT result FROM cloud_tasks')).rows;
    read.mockClear();
    await recordImageTaskTerminal(created.runId, { status: 'completed', imageUrl: '/api/serve-upload/unrelated-callback.png' });
    expect(read.mock.calls.map(([url]) => url)).toEqual([]);
    expect((await query('SELECT result FROM cloud_tasks')).rows).toEqual(original);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
  });
}, 60_000);
const actor = { id: 'editor', name: 'Editor', role: 'user' as const, status: 'active' as const,
  productType: 'canvas,chat', createdAt: 1, updatedAt: 1 };
const request: AgentRunRequest = {
  projectId: 'shared', workspace: 'canvas', workspaceId: 'canvas:shared', mode: 'agent',
  providerId: 'provider', modelId: 'model', prompt: 'Use shared image', sourceVersionIds: ['version-shared'],
  allowedToolIds: ['generate_image'], idempotencyKey: 'run',
  context: { selectedEntityIds: ['image-shared'], visibleVersionIds: [], locale: 'zh-CN' },
};
function service(append: typeof appendAgentEvent = appendAgentEvent): ReturnType<typeof createAgentRuntimeService> {
  return createAgentRuntimeService({
    randomUUID: () => 'run-task', now: () => Date.now(), authorizeContext: authorizeAgentContext,
    createBillableTask, settleFailedTask, transitionTask, getTaskForUser: getCloudTaskForUser,
    appendEvent: append, listEvents: listAgentEventsForActor, listRunEventStreams: listAgentEventStreamsForActor,
    projectPersistedCompletedTask,
    abortTaskExecution: () => false, calculateCreditCost: async () => 7,
    resolveTaskModel: async () => ({ providerId: 'provider', modelId: 'model', kind: 'chat', sourceType: 'chat',
      protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [],
      maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: ['text'], capabilitySources: {} }),
  });
}
async function seed(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  const log = saveFixtureMigrationLog(schemaName, migration);
  console.info('Full migrations:', migration.status, log, 'media:', roots.root);
  if (migration.status !== 0) console.error(migration.stdout, migration.stderr);
  expect(migration.status).toBe(0);
  await ensureCoreTables();
  const png = await sharp({ create: {
    width: 2, height: 2, channels: 4, background: '#d4af37',
  } }).png().toBuffer();
  writeFileSync(join(roots.root, 'shared.png'), png);
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-shared','owner','shared','image')");
  await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height)
    VALUES ('version-shared','asset-shared','owner','shared','/api/serve-upload/shared.png','image/png',$1,$2,2,2)`,
    [png.length, createHash('sha256').update(png).digest('hex')]);
  await query("UPDATE wujie_assets SET current_version_id='version-shared'");
  await query(`INSERT INTO wujie_workspace_placements
    (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
    VALUES ('placement-shared','owner','shared','asset-shared','version-shared','canvas','shared','canvas-image','image-shared')`);
  const doc = createCanvasDocument();
  applyCanvasImagePatch(doc, { placementId: 'placement-shared', assetVersionId: 'version-shared',
    x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0 }, 'fixture');
  await query(`INSERT INTO wujie_project_canvas_documents(project_id,owner_id,projection,snapshot_bytes)
    VALUES ('shared','owner',$1,$2)`, [readCanvasDocument(doc), Buffer.from(Y.encodeStateAsUpdate(doc))]);
  doc.destroy();
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    SELECT 'credits_' || id,id,100,100,0,1,1 FROM wujie_users`);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}

// Catches the production owner-only completion branch losing the frozen canvas intent.
it('real createRun charges editor 7 and cloud completion publishes one canonical derived output', async () => {
  await withIsolatedPostgres('completion-first', async ({ query, databaseUrl, schemaName }) => {
    await seed(query, databaseUrl, schemaName);
    const created = await service().createRun({ actor, request: structuredClone(request) });
    expect(created.charged).toBe(true);
    expect((await query('SELECT publication_intent FROM wujie_canvas_task_publications')).rows[0].publication_intent)
      .toMatchObject({ projectionMode: 'derived', parentVersionIds: ['version-shared'] });
    await recordImageTaskTerminal(created.runId, { status: 'completed', imageUrl: '/api/serve-upload/shared.png', creditStatus: 'charged' });
    const placements = (await query("SELECT * FROM wujie_workspace_placements WHERE id <> 'placement-shared'")).rows;
    expect(placements, JSON.stringify((await getCloudTaskForUser(created.runId, 'editor'))?.result?.assetProjection)).toHaveLength(1);
    expect(placements[0].owner_id).toBe('owner');
    expect(placements[0].transform).toEqual({ x: 132, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 });
    expect((await query("SELECT user_id,amount FROM wujie_credit_transactions WHERE type='consume'")).rows)
      .toEqual([{ user_id: 'editor', amount: -7 }]);
    expect((await query("SELECT * FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([]);
    const command = (await query('SELECT * FROM wujie_canvas_asset_commands')).rows[0];
    const task = await getCloudTaskForUser(created.runId, 'editor');
    const marker = task!.result!.assetProjection as { references: Array<Record<string, unknown>> };
    expect(marker.references[0]).toEqual({ assetId: command.asset_id, assetVersionId: command.asset_version_id,
      placementId: command.placement_id, entityId: placements[0].entity_id,
      url: (await query('SELECT file_url FROM wujie_asset_versions WHERE id=$1', [command.asset_version_id])).rows[0].file_url, kind: 'image' });
    expect((await query('SELECT sequence FROM wujie_project_canvas_updates')).rows).toEqual([{ sequence: '1' }]);
  });
}, 60_000);

for (const window of ['first', 'task-before-event', 'existing-event'] as const) {
  it(`generic real run.completed restores ${window} window without a second charge or event`, async () => {
    await withIsolatedPostgres(`generic-${window}`, async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const runtime = service(); const created = await runtime.createRun({ actor, request: structuredClone(request) });
      const event = { actorUserId: 'editor', runId: created.runId, eventId: 'complete', type: 'run.completed' as const,
        payload: { result: { imageUrl: '/api/serve-upload/shared.png' } } };
      if (window === 'task-before-event') {
        const crash = service(async input => {
          if (input.type === 'run.completed') throw new Error('simulated crash before event INSERT');
          return appendAgentEvent(input);
        });
        await expect(crash.appendEvent(event)).rejects.toThrow('simulated crash');
        expect((await getCloudTaskForUser(created.runId, 'editor'))!.status).toBe('completed');
        expect((await listAgentEventsForActor({ actorUserId: 'editor', projectId: 'shared', runId: created.runId }))
          .filter(value => value.type === 'run.completed')).toHaveLength(0);
      }
      if (window === 'existing-event') {
        renameSync(join(roots.root, 'shared.png'), join(roots.root, 'held.png'));
        try { await runtime.appendEvent(event); }
        finally { renameSync(join(roots.root, 'held.png'), join(roots.root, 'shared.png')); }
        expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
      }
      const completed = await runtime.appendEvent(event);
      expect(completed.accepted).toBe(true);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
      const before = (await query('SELECT result FROM cloud_tasks')).rows;
      await runtime.appendEvent(event);
      expect((await query('SELECT result FROM cloud_tasks')).rows).toEqual(before);
      expect((await listAgentEventsForActor({ actorUserId: 'editor', projectId: 'shared', runId: created.runId }))
        .filter(value => value.type === 'run.completed')).toHaveLength(1);
      expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
        .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
      await expect(runtime.appendEvent({ ...event, payload: { result: { imageUrl: '/api/serve-upload/forged.png' } } }))
        .rejects.toThrow();
      expect((await runtime.appendEvent({ ...event, eventId: 'different', type: 'run.failed', payload: { error: 'late' } })).accepted).toBe(false);
      expect((await query('SELECT result FROM cloud_tasks')).rows).toEqual(before);
    });
  }, 60_000);
}

for (const consumer of ['cloud', 'agent-edit'] as const) {
  it(`${consumer} completed replay uses stored result and restores missing publication`, async () => {
    await withIsolatedPostgres(`consumer-replay-${consumer}`, async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const created = await service().createRun({ actor, request: structuredClone(request) });
      if (consumer === 'agent-edit') await query("UPDATE cloud_tasks SET type='agent-edit' WHERE id=$1", [created.runId]);
      await transitionTask({ taskId: created.runId, from: ['processing'], to: 'completed', creditStatus: 'charged',
        result: { imageUrl: '/api/serve-upload/shared.png' } });
      const complete = async (): Promise<unknown> => consumer === 'cloud'
        ? recordImageTaskTerminal(created.runId, { status: 'completed', imageUrl: '/api/serve-upload/forged.png' })
        : recordAgentTaskTerminal(created.runId, { status: 'completed', imageUrl: '/api/serve-upload/forged.png' });
      await complete();
      expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
      const before = (await query('SELECT result FROM cloud_tasks')).rows;
      expect(before[0].result.imageUrl).toBe('/api/serve-upload/shared.png');
      await complete(); expect((await query('SELECT result FROM cloud_tasks')).rows).toEqual(before);
      expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
        .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
    });
  }, 60_000);
}
