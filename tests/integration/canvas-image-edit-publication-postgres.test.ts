import { afterEach, expect, it, vi } from 'vitest';
import * as disk from 'node:fs/promises';
import { join } from 'node:path';
import * as Y from 'yjs';
await vi.hoisted(async () => {
  const db = new URL(process.env.POSTGRES_TEST_DATABASE_URL || 'invalid:');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(db.hostname)) throw new Error('Explicit loopback PG required');
  const fs = await import('node:fs'); const path = await import('node:path');
  const base = process.env.WUJIE_DATA_DIR;
  if (!base || !path.isAbsolute(base) || !fs.statSync(base).isDirectory()) throw new Error('Explicit media root required');
  process.env.WUJIE_DATA_DIR = fs.mkdtempSync(path.join(base, 'task-8cb3j4a-'));
  process.env.WUJIE_YJS_ENABLED = 'true';
  globalThis.fetch = async (): Promise<Response> => { throw new Error('Task8Cb3j4a denies fetch'); };
});
vi.mock('server-only', () => ({}));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { seedImageEditPublication, completeRoleTask, roleAdmission, roleResult, roleState, recoverRolesInFreshProcess } from '../helpers/canvas-image-edit-publication-fixture';
import { projectCanvasTaskResult } from '@/lib/collaboration/task-result-publication';
import { createBillableTask, settleFailedTask } from '@/lib/task-core/billing-service';
import { ensureCloudTaskTables } from '@/lib/cloud-task-storage';
import { prepareTaskPublication, taskPublicationSnapshot } from '@/lib/collaboration/task-publication-output';
import { adoptDocumentTaskResult, publishDocumentTaskOutput } from '@/lib/collaboration/document-media-import';
import { prepareMediaTaskSource } from '@/lib/collaboration/document-media-source';
import { prepareCanvasTaskPublicationInTransaction, persistCanvasTaskPublicationInTransaction } from '@/lib/collaboration/task-publication';
import { closePool, getPool } from '@/lib/db-client';
import { loadDocument, commitDocumentUpdate } from '@/lib/collaboration/document-store';
import { applyCanvasImagePatch, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { grantDocumentEditor, revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { executeDocumentAssetCommand } from '@/lib/collaboration/document-asset-commands';

afterEach((): void => { vi.restoreAllMocks(); });
function projection(taskId: string = 'image_edit_roles'): Parameters<typeof projectCanvasTaskResult>[0] {
  return { actorUserId: 'editor', taskId, targetProjectId: 'shared', workspace: 'canvas', parentVersionIds: ['version-shared'] };
}
async function moveSource(): Promise<void> {
  const loaded = await loadDocument('shared');
  try {
    applyCanvasImagePatch(loaded.doc, { placementId: 'placement-shared', x: 900, width: 200 }, 'move');
    await commitDocumentUpdate({ actorId: 'owner', projectId: 'shared', bytes: Y.encodeStateAsUpdate(loaded.doc) });
  } finally { loaded.doc.destroy(); }
}
async function changeSourcePlacement(query: QueryFn, action: 'remove' | 'replace', expectedVersion: string): Promise<void> {
  if (action === 'replace') {
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-unrelated','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height)
      SELECT 'version-unrelated','asset-unrelated','owner','shared',file_url,mime_type,byte_size,checksum,width,height
      FROM wujie_asset_versions WHERE id='version-shared'`);
    await query("UPDATE wujie_assets SET current_version_id='version-unrelated' WHERE id='asset-unrelated'");
  }
  await executeDocumentAssetCommand({ actorId: 'owner', projectId: 'shared', idempotencyKey: 'unrelated-placement-change',
    command: action === 'remove' ? { action, placementId: 'placement-shared', expectedAssetVersionId: expectedVersion }
      : { action, placementId: 'placement-shared', expectedAssetVersionId: expectedVersion, assetVersionId: 'version-unrelated' } });
}

it('revision primary and mask publish as two independent asset families', async () => {
  await withIsolatedPostgres('task-8cb3j4a-roles', async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    await completeRoleTask();
    const outcome = await projectCanvasTaskResult({ actorUserId: 'editor', taskId: 'image_edit_roles',
      targetProjectId: 'shared', workspace: 'canvas', parentVersionIds: ['version-shared'] });
    expect(outcome).toHaveLength(2);
    const outputs = (await query("SELECT asset_id,metadata FROM wujie_asset_versions WHERE task_id='image_edit_roles' ORDER BY (metadata->>'outputIndex')::int")).rows;
    expect(outputs).toHaveLength(2);
    expect(outputs[0].asset_id).toBe('asset-shared');
    expect(outputs[1].asset_id).not.toBe('asset-shared');
    expect(outputs.map(row => row.metadata)).toEqual([
      { source: 'document-media-import', sourceVersionIds: ['version-shared'], outputRole: 'primary', outputIndex: 0 },
      { source: 'document-media-import', sourceVersionIds: ['version-shared'], outputRole: 'mask', outputIndex: 1 },
    ]);
    expect((await query("SELECT current_version_id FROM wujie_assets WHERE id='asset-shared'")).rows[0].current_version_id).toBe(outcome![0].assetVersionId);
    expect((await query("SELECT provider_id,model_id FROM wujie_asset_versions WHERE task_id='image_edit_roles'")).rows)
      .toEqual(Array(2).fill({ provider_id: 'frozen-provider', model_id: 'frozen-model' }));
    const parents = (await query('SELECT parent_version_id,parent_order FROM wujie_asset_version_parents ORDER BY version_id')).rows;
    expect(parents).toEqual(Array(2).fill({ parent_version_id: 'version-shared', parent_order: 0 }));
    const loaded = await loadDocument('shared');
    try {
      const placements = readCanvasDocument(loaded.doc).placements;
      expect(placements[outcome![0].placementId!]).toMatchObject({ x: 132, y: 10, width: 100, height: 80 });
      expect(placements[outcome![1].placementId!]).toMatchObject({ x: 264, y: 10, width: 100, height: 80, rotation: 0 });
    } finally { loaded.doc.destroy(); }
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='editor'")).rows[0].balance).toBe(93);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }]);
    const before = await roleState(query);
    expect(await projectCanvasTaskResult(projection())).toEqual(outcome);
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);

it.each(['primary-only', 'derived', 'same-url', 'replace', 'derived-replace'] as const)('publishes %s with frozen SQL and Yjs roles', async mode => {
  await withIsolatedPostgres(`task-8cb3j4a-${mode}`, async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    const input = roleAdmission(); const result = roleResult();
    if (mode === 'primary-only') { input.canvasPublication!.imageEditOutputs!.includeMask = false; Object.assign(result, roleResult(input.task.id, false)); }
    if (mode === 'derived' || mode === 'derived-replace') input.canvasPublication!.intent!.projectionMode = 'derived';
    if (mode === 'same-url') {
      result.maskUrl = result.imageUrl;
      const checkpoint = result.imageEditPublicationCheckpoint as { outputs: Array<{ url: unknown }> };
      checkpoint.outputs[1].url = result.imageUrl;
    }
    if (mode === 'replace' || mode === 'derived-replace') input.canvasPublication!.intent!.placement = { action: 'replace', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' };
    await completeRoleTask(input, result);
    const beforeIntent = (await query('SELECT publication_intent FROM wujie_canvas_task_publications')).rows[0].publication_intent;
    const outcome = await projectCanvasTaskResult(projection());
    expect(outcome).toHaveLength(mode === 'primary-only' ? 1 : 2);
    expect(outcome![0].assetId === 'asset-shared').toBe(mode !== 'derived' && mode !== 'derived-replace');
    if (outcome!.length === 2) expect(outcome![1].assetId).not.toBe(outcome![0].assetId);
    if (mode === 'replace' || mode === 'derived-replace') {
      expect(outcome![0].placementId).toBe('placement-shared');
      const loaded = await loadDocument('shared');
      try {
        const placements = readCanvasDocument(loaded.doc).placements;
        expect(placements['placement-shared']).toMatchObject({ x: 0, y: 10, rotation: 15, assetVersionId: outcome![0].assetVersionId });
        expect(placements[outcome![1].placementId!]).toMatchObject({ x: 132, y: 10, rotation: 0, zIndex: 5 });
      } finally { loaded.doc.destroy(); }
    }
    expect((await query('SELECT publication_intent FROM wujie_canvas_task_publications')).rows[0].publication_intent).toEqual(beforeIntent);
    expect((await query('SELECT count(*)::int AS n FROM wujie_canvas_asset_commands')).rows[0].n).toBe(outcome!.length);
    expect((await query("SELECT result->'assetProjection'->>'status' AS status FROM cloud_tasks")).rows[0].status).toBe('completed');
    const completedState = await roleState(query);
    expect(await createBillableTask(input)).toMatchObject({ reused: true, charged: false });
    expect(await roleState(query)).toEqual(completedState);
  });
}, 60_000);

it.each(['append', 'replace', 'derived-replace'] as const)('recovers %s primary after mask disk failure and source movement exactly once across restart/concurrency', async mode => {
  await withIsolatedPostgres(`task-8cb3j4a-recover-${mode}`, async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    const input = roleAdmission(); const result = roleResult();
    if (mode !== 'append') input.canvasPublication!.intent!.placement = { action: 'replace', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' };
    if (mode === 'derived-replace') input.canvasPublication!.intent!.projectionMode = 'derived';
    result.maskUrl = `/api/serve-upload/missing-mask-${mode}.png`;
    (result.imageEditPublicationCheckpoint as { outputs: Array<{ url: unknown }> }).outputs[1].url = result.maskUrl;
    await completeRoleTask(input, result);
    await expect(projectCanvasTaskResult(projection())).rejects.toThrow();
    const first = (await query("SELECT id FROM wujie_asset_versions WHERE task_id='image_edit_roles'")).rows;
    expect(first).toHaveLength(1);
    expect((await query("SELECT result->'assetProjection'->>'status' AS status FROM cloud_tasks")).rows[0].status).not.toBe('completed');
    await moveSource();
    const replay = await createBillableTask(input); expect(replay.reused).toBe(true);
    await disk.copyFile(join(process.env.WUJIE_DATA_DIR!, 'mask.png'), join(process.env.WUJIE_DATA_DIR!, `missing-mask-${mode}.png`));
    await closePool();
    const restarted = recoverRolesInFreshProcess(databaseUrl, schemaName);
    expect(restarted).toHaveLength(2); expect(restarted[0].assetVersionId).toBe(first[0].id);
    const both = await Promise.all([projectCanvasTaskResult(projection()), projectCanvasTaskResult(projection())]);
    expect(both[0]).toEqual(restarted);
    expect(both[0]).toEqual(both[1]); expect(both[0]).toHaveLength(2);
    expect(both[0]![0].assetVersionId).toBe(first[0].id);
    expect((await query('SELECT count(*)::int AS n FROM wujie_canvas_asset_commands')).rows[0].n).toBe(2);
    expect((await query('SELECT count(*)::int AS n FROM wujie_canvas_media_lineage')).rows[0].n).toBe(2);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }]);
    const loaded = await loadDocument('shared');
    try { expect(readCanvasDocument(loaded.doc).placements[both[0]![1].placementId!].x).toBe(mode === 'append' ? 264 : 132); }
    finally { loaded.doc.destroy(); }
    if (mode === 'derived-replace') expect((await query("SELECT current_version_id FROM wujie_assets WHERE id='asset-shared'")).rows[0].current_version_id).toBe('version-shared');
  });
}, 60_000);

it('only canonical manual adoption obtains a capability; underlying sources reject bypass', async () => {
  await withIsolatedPostgres('task-8cb3j4a-manual', async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName); await completeRoleTask();
    const capability = await prepareTaskPublication('editor', 'image_edit_roles');
    const input = taskPublicationSnapshot(capability!).requests[1];
    const before = await roleState(query);
    for (const invalid of [{ ...input, projectId: 'other' }, { ...input, idempotencyKey: 'fake' },
      { ...input, sourceVersionId: 'version-shared' }, { ...input, role: 'primary' },
      { ...input, command: { action: 'replace', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' } }]) {
      await expect(adoptDocumentTaskResult('editor', invalid)).rejects.toThrow();
    }
    await expect(prepareMediaTaskSource('editor', input)).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
    const mask = await adoptDocumentTaskResult('editor', input);
    expect(mask.assetReference.assetId).not.toBe('asset-shared');
    const all = await projectCanvasTaskResult(projection()); expect(all![1].assetVersionId).toBe(mask.assetVersionId);
  });
}, 60_000);

it.each(['policy', 'checkpoint', 'missing-mask', 'extra-role', 'order', 'digest', 'task', 'type', 'status'] as const)('rejects persistent %s corruption without writes or charges', async fault => {
  await withIsolatedPostgres(`task-8cb3j4a-invalid-${fault}`, async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName); await completeRoleTask();
    if (fault === 'policy') await query("UPDATE wujie_canvas_task_publications SET publication_intent=publication_intent-'imageEditOutputs'");
    else if (fault === 'checkpoint') await query("UPDATE cloud_tasks SET result=result-'imageEditPublicationCheckpoint'");
    else if (fault === 'digest') await query("UPDATE cloud_tasks SET request_digest=$1", ['b'.repeat(64)]);
    else if (fault === 'type') await query("UPDATE cloud_tasks SET type='generate'");
    else if (fault === 'status') await query("UPDATE cloud_tasks SET status='processing'");
    else {
      const result = roleResult(); const checkpoint = result.imageEditPublicationCheckpoint as { outputs: unknown[]; taskId: string };
      if (fault === 'missing-mask') checkpoint.outputs.pop();
      if (fault === 'extra-role') checkpoint.outputs.push(checkpoint.outputs[1]);
      if (fault === 'order') checkpoint.outputs.reverse();
      if (fault === 'task') checkpoint.taskId = 'image_edit_fake';
      await query('UPDATE cloud_tasks SET result=$1', [result]);
    }
    const before = await roleState(query);
    await expect(projectCanvasTaskResult(projection())).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);

it('policy replay mismatch and publication persist rejection roll back tasks and consumption', async () => {
  await withIsolatedPostgres('task-8cb3j4a-admission', async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    await createBillableTask(roleAdmission()); const before = await roleState(query);
    for (const fault of ['policy', 'projection', 'selection', 'replace', 'digest', 'parent']) {
      const replay = roleAdmission();
      if (fault === 'policy') replay.canvasPublication!.imageEditOutputs!.includeMask = false;
      if (fault === 'projection') replay.canvasPublication!.intent!.projectionMode = 'derived';
      if (fault === 'selection') replay.canvasPublication!.intent!.placement = { action: 'append', selectedEntityIds: [] };
      if (fault === 'replace') replay.canvasPublication!.intent!.placement = { action: 'replace', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' };
      if (fault === 'digest') replay.requestDigest = 'b'.repeat(64);
      if (fault === 'parent') replay.canvasPublication!.intent!.parentVersionIds = ['other'];
      await expect(createBillableTask(replay)).rejects.toThrow();
      expect(await roleState(query)).toEqual(before);
    }
    for (const fault of ['prefix', 'type', 'no-pair', 'empty-parent', 'digest', 'extra-policy']) {
      const input = roleAdmission(`image_edit_${fault}`);
      if (fault === 'prefix') input.task.id = 'legacy-wrong-prefix';
      if (fault === 'type') input.task.type = 'generate';
      if (fault === 'no-pair') delete input.canvasPublication!.singleAdmission;
      if (fault === 'empty-parent') input.canvasPublication!.intent!.parentVersionIds = [];
      if (fault === 'digest') input.requestDigest = 'invalid';
      if (fault === 'extra-policy') Object.assign(input.canvasPublication!.imageEditOutputs!, { maskPlacement: {} });
      await expect(createBillableTask(input)).rejects.toThrow();
      expect(await roleState(query)).toEqual(before);
    }
  });
}, 60_000);

it('rejects completed same-key policy changes instead of bypassing the frozen publication contract', async () => {
  await withIsolatedPostgres('task-8cb3j4a-completed-policy', async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName); await completeRoleTask();
    const changed = roleAdmission(); changed.canvasPublication!.imageEditOutputs!.includeMask = false;
    const before = await roleState(query);
    await expect(createBillableTask(changed)).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);

it.each(['edit', 'generate', 'universal-generate'] as const)('preserves other type %s terminal replay compatibility without new writes', async type => {
  await withIsolatedPostgres(`task-8cb3j4a-terminal-${type}`, async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    const input = roleAdmission(`legacy_${type}`);
    input.task.type = type;
    input.canvasPublication!.singleAdmission = type;
    delete input.canvasPublication!.imageEditOutputs;
    await completeRoleTask(input, { imageUrl: '/api/serve-upload/primary.png' });
    await changeSourcePlacement(query, 'remove', 'version-shared');
    await revokeDocumentEditor('owner', 'shared', 'editor');
    input.canvasPublication!.intent!.projectionMode = 'derived';
    const before = await roleState(query);
    expect(await createBillableTask(input)).toMatchObject({ reused: true, charged: false, task: { status: 'completed' } });
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);

it.each(['failed', 'cancelled', 'timeout'] as const)('replays image-edit %s exactly and rejects policy changes without a second charge or refund', async status => {
  await withIsolatedPostgres(`task-8cb3j4a-terminal-${status}`, async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    const input = roleAdmission();
    await createBillableTask(input);
    const settlement = { taskId: input.task.id, status, error: { code: `TEST_${status}`, message: `Test ${status}` },
      result: { terminalMarker: status } };
    expect(await settleFailedTask(settlement)).toEqual({ transitioned: true, refunded: true });
    const terminal = (await query('SELECT status,credit_status,result,revision FROM cloud_tasks')).rows[0];
    expect(terminal).toMatchObject({ status, credit_status: 'refunded', result: { terminalMarker: status } });
    expect(Number(terminal.revision)).toBeGreaterThan(0);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions ORDER BY type")).rows)
      .toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='editor'")).rows[0].balance).toBe(100);
    const before = await roleState(query);
    expect(await createBillableTask(input)).toMatchObject({ reused: true, charged: false, task: { status, creditStatus: 'refunded' } });
    expect(await roleState(query)).toEqual(before);
    const changed = roleAdmission(); changed.canvasPublication!.imageEditOutputs!.includeMask = false;
    await expect(createBillableTask(changed)).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
    expect(await settleFailedTask(settlement)).toEqual({ transitioned: false, refunded: false });
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);

it('concurrent same-key admission charges once; a real publication SQL failure rolls consumption back', async () => {
  await withIsolatedPostgres('task-8cb3j4a-atomic', async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    const outcomes = await Promise.all([createBillableTask(roleAdmission()), createBillableTask(roleAdmission())]);
    expect(outcomes.map(outcome => outcome.reused).sort()).toEqual([false, true]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }]);
    await query(`CREATE FUNCTION reject_role_publication() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'isolated publication failure'; END $$`);
    await query('CREATE TRIGGER reject_role_publication BEFORE INSERT ON wujie_canvas_task_publications FOR EACH ROW EXECUTE FUNCTION reject_role_publication()');
    const before = await roleState(query);
    await expect(createBillableTask(roleAdmission('image_edit_rollback'))).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);

it.each(['/api/serve-upload/../shared.png', 'data:image/png;base64,AA==', 'http://127.0.0.1/private.png'])('safe media layer rejects role URL %s', async url => {
  await withIsolatedPostgres('task-8cb3j4a-unsafe-url', async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    const result = roleResult(); result.imageUrl = url;
    (result.imageEditPublicationCheckpoint as { outputs: Array<{ url: string }> }).outputs[0].url = url;
    await completeRoleTask(roleAdmission(), result);
    const before = await roleState(query);
    await expect(projectCanvasTaskResult(projection())).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);

it.each(['policy', 'projection', 'parents', 'selection', 'access'] as const)('real billing entry freezes %s before synchronous caller mutation', async field => {
  await withIsolatedPostgres(`task-8cb3j4a-entry-copy-${field}`, async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    const input = roleAdmission();
    const publication = input.canvasPublication!;
    const pending = createBillableTask(input);
    // No await or scheduler barrier: mutate the caller's nested objects in the same stack.
    if (field === 'policy') publication.imageEditOutputs!.includeMask = false;
    if (field === 'projection') publication.intent!.projectionMode = 'derived';
    if (field === 'parents') publication.intent!.parentVersionIds[0] = 'changed-parent';
    if (field === 'selection' && publication.intent!.placement.action === 'append') {
      publication.intent!.placement.selectedEntityIds[0] = 'changed-selection';
    }
    if (field === 'access') Object.assign(publication.access, { grantGeneration: '2' });
    await expect(pending).resolves.toMatchObject({ reused: false, charged: true });
    const frozen = (await query('SELECT publication_intent FROM wujie_canvas_task_publications')).rows[0].publication_intent;
    expect(frozen).toMatchObject({ projectionMode: 'revision', parentVersionIds: ['version-shared'],
      selectionSnapshot: [{ entityId: 'image-shared', placementId: 'placement-shared', assetVersionId: 'version-shared' }],
      imageEditOutputs: { includeMask: true, requestDigest: 'a'.repeat(64), sourceSnapshot: [
        { versionId: 'version-shared', assetId: 'asset-shared', assetCurrentVersionId: 'version-shared' },
      ] } });
    expect((await query('SELECT grant_generation FROM wujie_canvas_task_publications')).rows[0].grant_generation).toBe('1');
    expect((await query('SELECT count(*)::int AS n FROM cloud_tasks')).rows[0].n).toBe(1);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='editor'")).rows[0].balance).toBe(93);
  });
}, 60_000);

it('real billing entry rejects mismatched marker even when caller repairs it synchronously', async () => {
  await withIsolatedPostgres('task-8cb3j4a-entry-marker', async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    await ensureCloudTaskTables();
    const before = await roleState(query);
    const unchanged = roleAdmission(); unchanged.canvasPublication!.singleAdmission = 'generate';
    await expect(createBillableTask(unchanged)).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
    const input = roleAdmission(); input.canvasPublication!.singleAdmission = 'generate';
    const pending = createBillableTask(input);
    input.canvasPublication!.singleAdmission = 'image-edit';
    await expect(pending).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);

it('copies all admission input before first SQL wait', async () => {
  await withIsolatedPostgres('task-8cb3j4a-input-copy', async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    const legacy = roleAdmission('image_edit_copy'); delete legacy.canvasPublication;
    await createBillableTask(legacy);
    const client = await getPool().connect();
    try {
      await client.query('BEGIN'); const input = roleAdmission('image_edit_copy');
      const promise = prepareCanvasTaskPublicationInTransaction(client, { actorUserId: 'editor', projectId: 'shared',
        publication: input.canvasPublication!, singleTaskIdentity: { type: 'image-edit', idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest } });
      input.canvasPublication!.imageEditOutputs!.includeMask = false;
      input.canvasPublication!.intent!.parentVersionIds[0] = 'fake';
      const prepared = await promise;
      await persistCanvasTaskPublicationInTransaction(client, { taskId: input.task.id, publication: prepared });
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); }
    const intent = (await query('SELECT publication_intent FROM wujie_canvas_task_publications')).rows[0].publication_intent;
    expect(intent.imageEditOutputs.includeMask).toBe(true); expect(intent.parentVersionIds).toEqual(['version-shared']);
  });
}, 60_000);

it.each(['source', 'revoke', 'regrant', 'disable', 'asset', 'unavailable', 'scope', 'placement-delete', 'placement-replace'] as const)('rechecks %s across a real media-read barrier before final SQL', async fault => {
  await withIsolatedPostgres(`task-8cb3j4a-barrier-${fault}`, async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName); await completeRoleTask();
    const { open } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let reached!: () => void; let release!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(disk.open).mockImplementationOnce(async (...args) => { reached(); await resume; return open(...args); });
    const pending = projectCanvasTaskResult(projection()).then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      await paused;
      if (fault === 'source') await query("UPDATE wujie_asset_versions SET metadata='{\"changed\":true}' WHERE id='version-shared'");
      if (fault === 'asset') await query("UPDATE wujie_assets SET metadata='{\"changed\":true}' WHERE id='asset-shared'");
      if (fault === 'unavailable') await query("UPDATE wujie_asset_versions SET availability='missing' WHERE id='version-shared'");
      if (fault === 'scope') {
        await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('other','owner','Other')");
        await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-other','owner','other','image')");
        await query("DELETE FROM wujie_workspace_placements WHERE id='placement-shared'");
        await query("UPDATE wujie_assets SET current_version_id=NULL WHERE id='asset-shared'");
        await query("UPDATE wujie_asset_versions SET project_id='other',asset_id='asset-other' WHERE id='version-shared'");
      }
      if (fault === 'placement-delete' || fault === 'placement-replace') await changeSourcePlacement(query,
        fault === 'placement-delete' ? 'remove' : 'replace', 'version-shared');
      if (fault === 'revoke' || fault === 'regrant') await revokeDocumentEditor('owner', 'shared', 'editor');
      if (fault === 'regrant') await grantDocumentEditor('owner', 'shared', 'editor');
      if (fault === 'disable') await query('UPDATE wujie_project_document_settings SET enabled=false');
      const before = await roleState(query); release();
      expect(await pending).toHaveProperty('error'); expect(await roleState(query)).toEqual(before);
    } finally { release(); await pending; }
  });
}, 60_000);

it.each(['remove', 'replace'] as const)('rejects third-party source placement %s while original version and asset remain ready', async action => {
  await withIsolatedPostgres(`task-8cb3j4a-placement-${action}`, async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName); await completeRoleTask();
    await changeSourcePlacement(query, action, 'version-shared');
    expect((await query("SELECT availability FROM wujie_asset_versions WHERE id='version-shared'")).rows[0].availability).toBe('ready');
    expect((await query("SELECT status,current_version_id FROM wujie_assets WHERE id='asset-shared'")).rows[0])
      .toEqual({ status: 'active', current_version_id: 'version-shared' });
    const before = await roleState(query);
    await expect(projectCanvasTaskResult(projection())).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
    await expect(createBillableTask(roleAdmission())).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);

it.each(['remove', 'replace'] as const)('own primary replace proof does not authorize a later unrelated placement %s', async action => {
  await withIsolatedPostgres(`task-8cb3j4a-own-then-${action}`, async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName);
    const input = roleAdmission(); input.canvasPublication!.intent!.placement = { action: 'replace', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' };
    await completeRoleTask(input); const primary = await publishDocumentTaskOutput('editor', 'image_edit_roles', 0);
    await changeSourcePlacement(query, action, primary.assetVersionId);
    const before = await roleState(query);
    await expect(projectCanvasTaskResult(projection())).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);

it.each(['mask-head', 'command', 'parents', 'source-version', 'other-head'] as const)('rejects %s forgery after primary publication', async fault => {
  await withIsolatedPostgres(`task-8cb3j4a-forge-${fault}`, async ({ query, databaseUrl, schemaName }) => {
    await seedImageEditPublication(query, databaseUrl, schemaName); await completeRoleTask();
    const first = await publishDocumentTaskOutput('editor', 'image_edit_roles', 0);
    if (fault === 'mask-head') await query('UPDATE wujie_canvas_media_lineage SET output_index=1 WHERE target_version_id=$1', [first.assetVersionId]);
    if (fault === 'command') await query('UPDATE wujie_canvas_asset_commands SET source_request_digest=$1', ['b'.repeat(64)]);
    if (fault === 'parents') await query('UPDATE wujie_asset_version_parents SET parent_order=9 WHERE version_id=$1', [first.assetVersionId]);
    if (fault === 'source-version') await query("UPDATE wujie_asset_versions SET metadata='{\"changed\":true}' WHERE id='version-shared'");
    if (fault === 'other-head') await query('UPDATE wujie_asset_versions SET task_id=NULL WHERE id=$1', [first.assetVersionId]);
    const before = await roleState(query);
    await expect(projectCanvasTaskResult(projection())).rejects.toThrow();
    expect(await roleState(query)).toEqual(before);
  });
}, 60_000);
