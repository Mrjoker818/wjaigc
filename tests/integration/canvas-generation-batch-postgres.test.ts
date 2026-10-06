import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
await vi.hoisted(async () => {
  const database = new URL(process.env.POSTGRES_TEST_DATABASE_URL || '');
  if (!['127.0.0.1', '[::1]'].includes(database.hostname)
    || !['postgres:', 'postgresql:'].includes(database.protocol)) {
    throw new Error('Explicit loopback POSTGRES_TEST_DATABASE_URL required');
  }
  const fs = await import('node:fs'); const path = await import('node:path');
  process.env.WUJIE_DATA_DIR = fs.mkdtempSync(path.join(process.env.WUJIE_DATA_DIR!, 'batch-core-'));
  process.env.WUJIE_YJS_ENABLED = 'true';
});
vi.mock('server-only', () => ({}));
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { seedCanvasGeneration, canvasBilling, lockCanvasSlot, moveCanvasSource, loseCanvasCommitReply } from '../helpers/canvas-generation-fixture';
import { admitCanvasGenerationBatch, type AdmitCanvasGenerationBatchInput } from '@/lib/collaboration/canvas-generation-batch-admission';
import { createDurableGenerationBatch } from '@/lib/task-core/generation-batch';
import { createBillableTask, settleFailedTask, type CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { revokeDocumentEditor, grantDocumentEditor } from '@/lib/collaboration/document-access';
import { executeDocumentAssetCommand } from '@/lib/collaboration/document-asset-commands';
import { parseCanvasTaskPublicationIntent } from '@/lib/collaboration/task-publication-intent';
import { prepareCanvasGenerationPublication } from '@/lib/collaboration/canvas-generation-batch-admission';

afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function input(root: string = 'batch', parents: string[] = []): AdmitCanvasGenerationBatchInput {
  const access = { kind: 'document' as const, actorUserId: 'editor', projectId: 'shared', ownerId: 'owner', grantGeneration: '1' };
  return { access, batch: createDurableGenerationBatch({ batchId: `batch-${createHash('sha256').update(root).digest('hex').slice(0, 24)}`,
    requestedCount: 2, createTaskId: (): string => `task-${randomUUID()}` }), rootIdempotencyKey: root,
    requestDigest: 'digest', creditCost: 7, providerId: 'provider', model: 'gpt-image-1',
    publication: { access, workspace: 'canvas', workspaceId: 'shared', intent: {
      parentVersionIds: parents, projectionMode: 'derived', placement: { action: 'append', selectedEntityIds: ['image-shared'] } } },
    submissionPayload: { prompt: 'square', workerMode: 'recovery', assetWorkspace: 'canvas' } };
}

function child(request: AdmitCanvasGenerationBatchInput, index: number, anchorTaskId?: string): CreateBillableTaskInput {
  const slot = request.batch.slots[index];
  return { userId: request.access.actorUserId, idempotencyKey: `${request.rootIdempotencyKey}:${index}`,
    requestDigest: request.requestDigest, creditCost: request.creditCost,
    canvasPublication: { ...request.publication, batchAdmission: true,
      ...(anchorTaskId ? { batchPlacement: { anchorTaskId, slotIndex: index, slotCount: 2, requestDigest: request.requestDigest } } : {}) },
    task: { id: slot.taskId, projectId: 'shared', type: 'generate-async', status: 'processing', progress: 0, createdAt: 1, updatedAt: 1,
      result: { submissionPayload: { batchId: slot.batchId, slotId: slot.slotId, slotIndex: index, slotCount: 2 } } } };
}

for (const change of ['move', 'replace', 'remove'] as const) {
  it(`no-parent layout selection ${change}: preserves frozen first slot and only admits the original source version`, async () => {
    await withIsolatedPostgres(`batch-selection-${change}`, async ({ query, databaseUrl, schemaName }) => {
      await seedCanvasGeneration(query, databaseUrl, schemaName);
      const request = input(); const first = await createBillableTask(child(request, 0));
      const frozen = (await query('SELECT publication_intent FROM wujie_canvas_task_publications')).rows[0].publication_intent;
      expect(frozen.selectionSnapshot).toEqual([{ entityId: 'image-shared', placementId: 'placement-shared', assetVersionId: 'version-shared' }]);
      const parsed = parseCanvasTaskPublicationIntent(frozen);
      expect(Object.isFrozen(parsed.selectionSnapshot)).toBe(true);
      expect(Object.isFrozen(parsed.selectionSnapshot![0])).toBe(true);
      if (change === 'move') {
        await moveCanvasSource(999_990, 1000); // Recomputing append here would overflow; identity remains valid.
        await executeDocumentAssetCommand({ actorId: 'owner', projectId: 'shared', idempotencyKey: 'other-output', command: {
          action: 'attach', assetVersionId: 'version-second', transform: { x: 700, y: 50, width: 100, height: 100, rotation: 0, zIndex: 3 } } });
      } else {
        await executeDocumentAssetCommand({ actorId: 'owner', projectId: 'shared', idempotencyKey: 'change-source', command: change === 'replace'
          ? { action: 'replace', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared', assetVersionId: 'version-second' }
          : { action: 'remove', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' } });
      }
      const before = await canvasBilling(query);
      if (change === 'move') {
        const result = await admitCanvasGenerationBatch(request);
        expect(result[0].taskId).toBe(first.task.id);
        expect((await query('SELECT publication_intent FROM wujie_canvas_task_publications WHERE task_id=$1', [result[1].taskId])).rows[0].publication_intent.placement.transform)
          .toEqual({ x: 264, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 });
        const after = await canvasBilling(query);
        expect((await admitCanvasGenerationBatch(input())).map(slot => slot.taskId)).toEqual(result.map(slot => slot.taskId));
        expect(await canvasBilling(query)).toEqual({ ...after,
          tasks: after.tasks.map(task => ({ ...task, revision: Number(task.revision) + 1 })) });
      } else {
        await expect(admitCanvasGenerationBatch(request)).rejects.toMatchObject({ status: 409, partialTaskIds: [first.task.id] });
        expect(await canvasBilling(query)).toEqual({ ...before,
          tasks: before.tasks.map(task => ({ ...task, revision: Number(task.revision) + 1 })) });
      }
      expect((await query('SELECT publication_intent FROM wujie_canvas_task_publications WHERE task_id=$1', [first.task.id])).rows[0].publication_intent).toEqual(frozen);
    });
  }, 60_000);
}

it('second slot insufficient funds refunds only this request newly created task once and cancelled anchor cannot resume', async () => {
  await withIsolatedPostgres('batch-partial-funds', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    await query("UPDATE wujie_credits SET balance=10 WHERE user_id='editor'");
    const request = input();
    await expect(admitCanvasGenerationBatch(request)).rejects.toMatchObject({ status: 402, partialTaskIds: [request.batch.slots[0].taskId] });
    expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows).toEqual([{ status: 'cancelled', credit_status: 'refunded' }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY type')).rows).toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
    const before = await canvasBilling(query);
    await expect(admitCanvasGenerationBatch(input())).rejects.toMatchObject({ status: 409 });
    expect(await canvasBilling(query)).toEqual(before);
  });
}, 60_000);

for (const state of ['revoke', 'regrant', 'actor-disabled', 'owner-disabled', 'archived', 'closed', 'global-off', 'bad-parent', 'db-error'] as const) {
  it(`slot waiting at the real core lock rejects ${state} before new charge`, async () => {
    await withIsolatedPostgres(`batch-lock-${state}`, async ({ query, databaseUrl, schemaName }) => {
      await seedCanvasGeneration(query, databaseUrl, schemaName);
      const request = input('batch', ['version-shared']);
      const gate = await lockCanvasSlot('batch', 0);
      const pending = admitCanvasGenerationBatch(request).then(value => value, (error: unknown) => error);
      try {
        await gate.wait(query);
        if (state === 'revoke' || state === 'regrant') {
          await revokeDocumentEditor('owner', 'shared', 'editor');
          if (state === 'regrant') await grantDocumentEditor('owner', 'shared', 'editor');
        } else if (state.endsWith('-disabled')) await query("UPDATE wujie_users SET status='disabled' WHERE id=$1", [state === 'actor-disabled' ? 'editor' : 'owner']);
        else if (state === 'archived') await query("UPDATE wujie_projects SET status='trashed'");
        else if (state === 'closed') await query('UPDATE wujie_project_document_settings SET enabled=false');
        else if (state === 'global-off') vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
        else if (state === 'bad-parent') await query("UPDATE wujie_asset_versions SET availability='missing' WHERE id='version-shared'");
        else await query('ALTER TABLE wujie_canvas_task_publications RENAME TO unavailable_publications');
      } finally { await gate.release(); await pending; }
      const result = await pending;
      expect(result).toMatchObject({ status: state === 'db-error' ? 503 : state === 'bad-parent' ? 409 : 403 });
      expect((await query('SELECT * FROM cloud_tasks')).rows).toEqual([]);
      expect((await query('SELECT * FROM wujie_credit_transactions')).rows).toEqual([]);
      expect((await query('SELECT balance FROM wujie_credits ORDER BY user_id')).rows).toEqual([{ balance: 100 }, { balance: 100 }]);
    });
  }, 60_000);
}

it('two interleaved batches failing after regrant never refund the other request reused first task', async () => {
  await withIsolatedPostgres('batch-interleave', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const request = input();
    const original = await createBillableTask(child(request, 0));
    const gate = await lockCanvasSlot('batch', 1);
    const pending = [admitCanvasGenerationBatch(input()), admitCanvasGenerationBatch(input())].map(promise => promise.catch((error: unknown) => error));
    try { await gate.wait(query, 2); await revokeDocumentEditor('owner', 'shared', 'editor'); await grantDocumentEditor('owner', 'shared', 'editor'); }
    finally { await gate.release(); await Promise.all(pending); }
    for (const outcome of await Promise.all(pending)) expect(outcome).toMatchObject({ status: 403, partialTaskIds: [original.task.id] });
    expect((await query('SELECT id,status FROM cloud_tasks')).rows).toEqual([{ id: original.task.id, status: 'processing' }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }]);
    const fresh = input(); fresh.access.grantGeneration = '3';
    await expect(admitCanvasGenerationBatch(fresh)).rejects.toMatchObject({ status: 409 });
    expect((await query('SELECT count(*) FROM cloud_tasks')).rows[0].count).toBe('1');
  });
}, 60_000);

it('legacy pending cannot be upgraded, terminal replay stays terminal, anchor without snapshot cannot create missing child', async () => {
  await withIsolatedPostgres('batch-legacy', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const request = input(); const first = child(request, 0); delete first.canvasPublication;
    await createBillableTask(first);
    const before = await canvasBilling(query);
    await expect(admitCanvasGenerationBatch(request)).rejects.toMatchObject({ status: 409 });
    expect(await canvasBilling(query)).toEqual(before);
    await settleFailedTask({ taskId: first.task.id, status: 'cancelled', error: { code: 'CANCEL', message: 'cancel' } });
    const terminalBefore = await canvasBilling(query);
    await expect(admitCanvasGenerationBatch(request)).rejects.toMatchObject({ status: 409, partialTaskIds: [first.task.id] });
    expect(await canvasBilling(query)).toEqual(terminalBefore);
    const historical = input('historical');
    const old = child(historical, 0); delete old.canvasPublication!.batchAdmission;
    await createBillableTask(old);
    const oldBefore = await canvasBilling(query);
    await expect(createBillableTask(child(historical, 1, old.task.id))).rejects.toMatchObject({ status: 409 });
    expect(await canvasBilling(query)).toEqual(oldBefore);
  });
}, 60_000);

it('core rejects wrong actor project grant root slot count digest anchor and unsafe identity before any consume', async () => {
  await withIsolatedPostgres('batch-identity', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const request = input(); const first = await createBillableTask(child(request, 0));
    const other = input('other'); const otherAnchor = await createBillableTask(child(other, 0));
    const wrongs: Array<(value: CreateBillableTaskInput) => void> = [
      value => { value.userId = 'owner'; },
      value => { value.task.projectId = 'wrong'; },
      value => { value.canvasPublication!.access = { ...value.canvasPublication!.access, grantGeneration: '3' }; },
      value => { value.idempotencyKey = 'other:1'; },
      value => { value.requestDigest = 'different'; },
      value => { value.canvasPublication!.batchPlacement!.requestDigest = 'different'; },
      value => { value.canvasPublication!.batchPlacement!.anchorTaskId = otherAnchor.task.id; },
      value => { value.canvasPublication!.batchPlacement!.anchorTaskId = 'missing'; },
      value => { value.canvasPublication!.batchPlacement!.slotCount = 3; },
      value => { (value.task.result!.submissionPayload as Record<string, unknown>).slotCount = 3; },
      value => { (value.task.result!.submissionPayload as Record<string, unknown>).slotIndex = Number.MAX_SAFE_INTEGER + 1; },
      value => { (value.task.result!.submissionPayload as Record<string, unknown>).slotIndex = -1; },
      value => { (value.task.result!.submissionPayload as Record<string, unknown>).slotId = 'forged'; },
      value => { (value.task.result!.submissionPayload as Record<string, unknown>).batchId = 'forged'; },
      value => { delete value.canvasPublication!.batchPlacement; },
    ];
    const before = await canvasBilling(query);
    for (const wrong of wrongs) {
      const candidate = structuredClone(child(request, 1, first.task.id)); wrong(candidate);
      await expect(createBillableTask(candidate)).rejects.toMatchObject({ name: 'CanvasTaskPublicationError' });
      expect(await canvasBilling(query)).toEqual(before);
    }
    for (const mutate of [
      (value: AdmitCanvasGenerationBatchInput): void => { value.batch.slots.reverse(); },
      (value: AdmitCanvasGenerationBatchInput): void => { value.batch.requestedCount = 3; },
      (value: AdmitCanvasGenerationBatchInput): void => { value.batch.slots[1].taskId = value.batch.slots[0].taskId; },
    ]) {
      const candidate = input(); mutate(candidate);
      await expect(admitCanvasGenerationBatch(candidate)).rejects.toMatchObject({ status: 400 });
      expect(await canvasBilling(query)).toEqual(before);
    }
  });
}, 60_000);

it('offset overflow rejects only missing slot without modifying the existing successful admission', async () => {
  await withIsolatedPostgres('batch-offset', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName); await moveCanvasSource(999_800);
    const request = input(); await createBillableTask(child(request, 0));
    const before = await canvasBilling(query);
    await expect(admitCanvasGenerationBatch(request)).rejects.toMatchObject({ status: 409 });
    expect(await canvasBilling(query)).toEqual({ ...before,
      tasks: before.tasks.map(task => ({ ...task, revision: Number(task.revision) + 1 })) });
  });
}, 60_000);

it('source context must preserve the front door grant and layout-only selection stays independent of ancestry', async () => {
  await withIsolatedPostgres('batch-context', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const access = input().access;
    const layoutOnly = await prepareCanvasGenerationPublication({ access, origin: 'http://localhost', body: { assetSelectedEntityIds: ['image-shared'] } });
    expect(layoutOnly.intent?.parentVersionIds).toEqual([]);
    for (const ref of ['/api/serve-upload/shared.png', { url: 'http://localhost/api/serve-upload/shared.png' }]) {
      expect((await prepareCanvasGenerationPublication({ access, origin: 'http://localhost', body: {
        assetParentVersionIds: ['version-shared'], referenceImages: [ref], assetSelectedEntityIds: ['image-second'] } })).intent?.parentVersionIds).toEqual(['version-shared']);
    }
    const before = await canvasBilling(query);
    for (const ref of ['/api/serve-upload/second.png', 'https://evil.invalid/api/serve-upload/shared.png', 'data:image/png;base64,aA==']) {
      await expect(prepareCanvasGenerationPublication({ access, origin: 'http://localhost', body: {
        assetParentVersionIds: ['version-shared'], referenceImages: [ref] } })).rejects.toBeInstanceOf(Error);
      expect(await canvasBilling(query)).toEqual(before);
    }
    await revokeDocumentEditor('owner', 'shared', 'editor'); await grantDocumentEditor('owner', 'shared', 'editor');
    await expect(prepareCanvasGenerationPublication({ access, origin: 'http://localhost', body: {
      assetParentVersionIds: ['version-shared'] } })).rejects.toMatchObject({ status: 403 });
  });
}, 60_000);

it('second-slot intent failure cancels only its own first task with one refund and no invented failed task ID', async () => {
  await withIsolatedPostgres('batch-mid-intent', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const request = input(); const gate = await lockCanvasSlot('batch', 1);
    const pending = admitCanvasGenerationBatch(request).catch((error: unknown) => error);
    try {
      await gate.wait(query);
      await executeDocumentAssetCommand({ actorId: 'owner', projectId: 'shared', idempotencyKey: 'remove', command: {
        action: 'remove', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' } });
    } finally { await gate.release(); await pending; }
    expect(await pending).toMatchObject({ status: 409, partialTaskIds: [request.batch.slots[0].taskId] });
    expect((await query('SELECT id,status FROM cloud_tasks')).rows).toEqual([{ id: request.batch.slots[0].taskId, status: 'cancelled' }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY type')).rows).toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
  });
}, 60_000);

it('lost successful COMMIT reply stays unknown without fabricated partial IDs or refund and same-key retry reuses it', async () => {
  await withIsolatedPostgres('batch-unknown-commit', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const request = input(); const proxy = await loseCanvasCommitReply(databaseUrl);
    try {
      await expect(admitCanvasGenerationBatch(request)).rejects.toMatchObject({ status: 503, partialTaskIds: [] });
      expect(proxy.dropped()).toBe(true);
      expect(proxy.connectionErrors.map(error => error.message)).toEqual(['Connection terminated unexpectedly']);
      expect((await query('SELECT id,status FROM cloud_tasks')).rows).toEqual([{ id: request.batch.slots[0].taskId, status: 'processing' }]);
      expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }]);
      expect((await query('SELECT * FROM wujie_canvas_task_publications')).rows).toHaveLength(1);
    } finally { await proxy.close(); }
    const resumed = await admitCanvasGenerationBatch(input());
    expect(resumed[0].taskId).toBe(request.batch.slots[0].taskId);
    expect((await query('SELECT * FROM cloud_tasks')).rows).toHaveLength(2);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }, { type: 'consume', amount: -7 }]);
  });
}, 60_000);

it('second slot committed with lost ACK does not cancel or refund the first slot and the original key recovers both tasks', async () => {
  await withIsolatedPostgres('batch-second-unknown-commit', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const request = input(); const proxy = await loseCanvasCommitReply(databaseUrl, 2);
    try {
      await expect(admitCanvasGenerationBatch(request)).rejects.toMatchObject({ status: 503, partialTaskIds: [request.batch.slots[0].taskId] });
      expect(proxy.dropped()).toBe(true);
      expect(proxy.connectionErrors.map(error => error.message)).toEqual(['Connection terminated unexpectedly']);
      expect((await query('SELECT status FROM cloud_tasks ORDER BY id')).rows).toEqual([{ status: 'processing' }, { status: 'processing' }]);
      expect((await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY type')).rows).toEqual([{ type: 'consume', amount: -7 }, { type: 'consume', amount: -7 }]);
      expect((await query('SELECT * FROM wujie_canvas_task_publications')).rows).toHaveLength(2);
    } finally { await proxy.close(); }
    const resumed = await admitCanvasGenerationBatch(input());
    expect(resumed.map(slot => slot.taskId)).toEqual(request.batch.slots.map(slot => slot.taskId));
    expect(resumed.map(slot => slot.status)).toEqual(['processing', 'processing']);
    expect((await query('SELECT * FROM cloud_tasks')).rows).toHaveLength(2);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }, { type: 'consume', amount: -7 }]);
  });
}, 60_000);
