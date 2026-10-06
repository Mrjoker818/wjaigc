import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
vi.mock('server-only', () => ({}));
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { seedOrdinaryGeneration } from '../helpers/canvas-ordinary-generation-fixture';
import { canvasBilling, loseCanvasCommitReply } from '../helpers/canvas-generation-fixture';
import { lockEditAdmission, editDatabaseSnapshot } from '../helpers/canvas-edit-fixture';
import { authorizeGenerationProject } from '@/lib/collaboration/generation-project-access';
import { parseCanvasOrdinaryPublication, canvasOrdinaryRequestDigest, validateCanvasOrdinarySources } from '@/lib/collaboration/canvas-ordinary-generation-admission';
import { createBillableTask, type CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { grantDocumentEditor, revokeDocumentEditor } from '@/lib/collaboration/document-access';

const media = mkdtempSync(join(process.env.WUJIE_DATA_DIR!, 'ordinary-admission-'));
beforeEach((): void => { process.env.WUJIE_DATA_DIR = media; process.env.WUJIE_YJS_ENABLED = 'true';
  vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared IO'); }); });
afterEach((): void => { vi.unstubAllGlobals(); });
async function admission(key = 'ordinary-admission', actor = 'editor', body: Record<string, unknown> = {}): Promise<CreateBillableTaskInput> {
  const access = await authorizeGenerationProject({ actorUserId: actor, projectId: 'shared' });
  if (access.kind !== 'document') throw new Error('Expected real document access');
  const request = { prompt: 'cup', model: 'gpt-image-1', ...body };
  return { userId: actor, idempotencyKey: key, requestDigest: canvasOrdinaryRequestDigest(request), creditCost: 7,
    canvasPublication: parseCanvasOrdinaryPublication(access, request), task: { id: `ordinary_${key}`, type: 'generate', projectId: 'shared',
      status: 'processing', providerId: 'provider', model: 'gpt-image-1', progress: 0, createdAt: 1, updatedAt: 1 } };
}

it('fault proxy admits only the exact local 3i2 database and refuses other hosts, ports and databases', async () => {
  for (const url of ['postgresql://postgres@localhost:55492/wujie_yjs_task8cb3i2_20260927',
    'postgresql://postgres@127.0.0.1:55493/wujie_yjs_task8cb3i2_20260927', 'postgresql://postgres@127.0.0.1:55492/unknown'])
    await expect(loseCanvasCommitReply(url)).rejects.toThrow('Dedicated loopback PG required');
  const proxy = await loseCanvasCommitReply(process.env.POSTGRES_TEST_DATABASE_URL!);
  try { expect(proxy.dropped()).toBe(false); } finally { await proxy.close(); }
});

it.each(['editor', 'owner'])('atomically admits %s and charges once under identical-key concurrency', async actor => {
  await withIsolatedPostgres('ordinary-core-concurrent', async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const input = await admission('concurrent', actor);
    const outcomes = await Promise.all([createBillableTask(input), createBillableTask({ ...input, task: { ...input.task, id: 'ordinary_other' } })]);
    expect(outcomes[0].task.id).toBe(outcomes[1].task.id);
    const state = await canvasBilling(query);
    expect([state.tasks.length, state.publications.length, state.transactions.length]).toEqual([1, 1, 1]);
    expect(state.credits.find(row => row.user_id === actor)?.balance).toBe(93);
    expect(state.credits.find(row => row.user_id !== actor)?.balance).toBe(100);
  });
}, 60_000);

it.each(['zero', 'rollback', 'mixed', 'wrong-type', 'edit-without-parent'])('preserves atomic admission invariant: %s', async scenario => {
  await withIsolatedPostgres(`ordinary-core-${scenario}`, async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const input = await admission();
    if (scenario === 'zero') input.creditCost = 0;
    if (scenario === 'mixed') input.canvasPublication!.batchAdmission = true;
    if (scenario === 'wrong-type') input.task.type = 'edit';
    if (scenario === 'edit-without-parent') { input.task.type = 'edit'; input.canvasPublication!.singleAdmission = 'edit'; }
    if (scenario === 'rollback') {
      await query("CREATE FUNCTION reject_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected ordinary intent failure'; END $$");
      await query('CREATE TRIGGER reject_intent BEFORE INSERT ON wujie_canvas_task_publications FOR EACH ROW EXECUTE FUNCTION reject_intent()');
    }
    if (scenario === 'zero') {
      const outcome = await createBillableTask(input); expect(outcome.charged).toBe(false);
      const state = await canvasBilling(query); expect([state.tasks.length, state.publications.length, state.transactions.length]).toEqual([1, 1, 0]);
    } else {
      const before = await editDatabaseSnapshot(query);
      await expect(createBillableTask(input)).rejects.toThrow();
      expect(await editDatabaseSnapshot(query)).toEqual(before);
    }
  });
}, 60_000);

it.each(['revoke', 'regrant', 'version', 'delete', 'selection'])('locked ordinary admission revalidates %s before any charge', async mutation => {
  await withIsolatedPostgres(`ordinary-lock-${mutation}`, async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const input = await admission('locked', 'editor', { referenceImages: ['/api/serve-upload/shared.png'],
      assetParentVersionIds: ['version-shared'], assetSelectedEntityIds: ['image-shared'] });
    const lock = await lockEditAdmission('locked');
    const running = createBillableTask(input).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    let before: Record<string, unknown>;
    try {
      await lock.wait(query);
      if (mutation === 'revoke' || mutation === 'regrant') await revokeDocumentEditor('owner', 'shared', 'editor');
      if (mutation === 'regrant') await grantDocumentEditor('owner', 'shared', 'editor');
      if (mutation === 'version') await query("UPDATE wujie_workspace_placements SET asset_id='asset-second',asset_version_id='version-second' WHERE id='placement-shared'");
      if (mutation === 'delete') await query("DELETE FROM wujie_workspace_placements WHERE id='placement-shared'");
      if (mutation === 'selection') await query("UPDATE wujie_workspace_placements SET entity_id='changed' WHERE id='placement-shared'");
      before = await editDatabaseSnapshot(query);
    } finally { await lock.release(); }
    expect((await running).error).toBeDefined();
    expect(await editDatabaseSnapshot(query)).toEqual(before!);
  });
}, 60_000);

it('validates ordered canonical sources and rejects URL substitution with no database changes', async () => {
  await withIsolatedPostgres('ordinary-source-order', async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const body = { referenceImages: ['/api/serve-upload/shared.png', '/api/serve-upload/second.png'], assetParentVersionIds: ['version-shared', 'version-second'] };
    const input = await admission('source', 'editor', body);
    expect(await validateCanvasOrdinarySources(input.canvasPublication!, body, 'http://localhost')).toEqual(body.referenceImages);
    const before = await editDatabaseSnapshot(query);
    for (const references of [body.referenceImages.toReversed(), ['data:image/png;base64,eA==', body.referenceImages[1]],
      ['https://external.invalid/image.png', body.referenceImages[1]]]) {
      await expect(validateCanvasOrdinarySources(input.canvasPublication!, { ...body, referenceImages: references }, 'http://localhost')).rejects.toThrow();
      expect(await editDatabaseSnapshot(query)).toEqual(before);
    }
  });
}, 60_000);

it('recovers the one committed ordinary task after a real COMMIT acknowledgement loss', async () => {
  await withIsolatedPostgres('ordinary-core-ack', async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); const input = await admission('ack');
    const proxy = await loseCanvasCommitReply(databaseUrl);
    try { await expect(createBillableTask(input)).rejects.toMatchObject({ status: 503 }); expect(proxy.dropped()).toBe(true); }
    finally { await proxy.close(); }
    const before = await canvasBilling(query);
    expect([before.tasks.length, before.transactions.length, before.publications.length]).toEqual([1, 1, 1]);
    expect((await createBillableTask({ ...input, task: { ...input.task, id: 'ordinary_wrong_candidate' } })).task.id).toBe('ordinary_ack');
    expect(await canvasBilling(query)).toEqual(before);
  });
}, 60_000);
