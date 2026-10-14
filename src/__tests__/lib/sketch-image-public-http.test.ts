import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedCloudTask } from '@/lib/cloud-task-storage';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import type { SketchImageAuthorizedResult } from '@/lib/sketch-to-code/image-result';
import { SketchHttpError } from '@/lib/sketch-to-code/http';
import { sketchImageTaskSummary, pollSketchImageTask, cancelSketchImageTask, type SketchImagePublicHttpDependencies } from '@/lib/sketch-to-code/image-public-http';

const defaults = vi.hoisted(() => ({ getTask: vi.fn(), readResult: vi.fn(), cancelTransaction: vi.fn(), after: vi.fn(),
  abort: vi.fn(), cancel: vi.fn(), update: vi.fn(), recover: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async original => ({ ...(await original<Record<string, unknown>>()), after: defaults.after }));
vi.mock('@/lib/cloud-task-storage', async original => ({ ...(await original<Record<string, unknown>>()), getCloudTaskById: defaults.getTask }));
vi.mock('@/lib/sketch-to-code/image-result', () => ({ readSketchImageResult: defaults.readResult }));
vi.mock('@/lib/sketch-to-code/image-task-http', () => ({ cancelSketchImageTransaction: defaults.cancelTransaction }));
vi.mock('@/lib/task-registry', () => ({ abortTaskExecution: defaults.abort, cancelTask: defaults.cancel, updateTaskProgress: defaults.update }));
vi.mock('@/lib/sketch-to-code/image-service', () => ({ recoverConfiguredSketchImageTask: defaults.recover }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

const actor = 'actor', requestId = 'public-request', body = { taskId: 'skimg_public', projectId: 'project-a' };
const png = createCanvas(8, 8).toDataURL('image/png');
function fixture(status: PersistedCloudTask['status'] = 'processing', free = false): {
  task: PersistedCloudTask; result: SketchImageAuthorizedResult; deps: SketchImagePublicHttpDependencies;
  getTask: ReturnType<typeof vi.fn>; readResult: ReturnType<typeof vi.fn>; cancelTransaction: ReturnType<typeof vi.fn>;
  schedule: ReturnType<typeof vi.fn>; effects: string[];
} {
  const input = { projectId: body.projectId, imageDataUrl: png, instruction: 'private-keywords', visionProviderId: 'vp', visionModelId: 'vm',
    imageProviderId: 'ip', imageModelId: 'im', idempotencyKey: 'private-nonce', aspectRatio: '1:1' };
  const pricing = { version: 1 as const, vision: { providerId: 'vp', modelId: 'vm', calls: 1 as const, mode: 'flat' as const, reserveCredits: free ? 0 : 7 },
    image: { providerId: 'ip', modelId: 'im', calls: 1 as const, credits: free ? 0 : 11 }, totalReserveCredits: free ? 0 : 18 };
  const analysis = { summary: '木屋', composition: '左侧', prompt: '水彩木屋', negativePrompt: '水印' };
  const task: PersistedCloudTask = { id: body.taskId, type: 'sketch-to-image', userId: actor, projectId: body.projectId, providerId: 'ip', model: 'im',
    status, progress: 31, creditStatus: free ? 'not-applicable' : status === 'completed' ? 'charged' : status === 'cancelled' ? 'refunded' : 'pending',
    creditCost: pricing.totalReserveCredits, chargedTransactionId: free ? undefined : createTaskBillingTransactionId('charge', body.taskId),
    refundedTransactionId: status === 'cancelled' && !free ? createTaskBillingTransactionId('refund', body.taskId) : undefined,
    leaseOwner: status === 'cancelled' ? undefined : 'old-worker', leaseExpiresAt: 1, attemptCount: 1, revision: 1, createdAt: 1, updatedAt: 1,
    idempotencyKey: input.idempotencyKey, requestDigest: sketchImageRequestDigest(input), remoteTaskId: 'private-remote', error: 'private raw error', label: 'private label',
    result: { sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', requestDigest: sketchImageRequestDigest(input), input, pricing,
      access: { kind: 'document', actorUserId: actor, projectId: body.projectId, ownerId: 'owner', grantGeneration: '1' } },
      sketchImageExecution: { version: 1, phase: 'accepted', routing: { vision: '1'.repeat(64), image: '2'.repeat(64) }, analysis,
        receipt: { taskIds: ['private-remote'], directImageUrls: [], usedModel: 'im', usedProviderId: 'ip' } } } };
  const result: SketchImageAuthorizedResult = { taskId: body.taskId, projectId: body.projectId, previewAssetId: 'ia', previewAssetVersionId: 'iv',
    imageAssetId: 'oa', imageAssetVersionId: 'ov', previewUrl: '/api/serve-upload/input.png', imageUrl: '/api/serve-upload/output.png',
    visionProviderId: 'vp', visionModelId: 'vm', imageProviderId: 'ip', imageModelId: 'im', analysis, pricing,
    reserveCredits: free ? 0 : 18, actualCredits: free ? 0 : 18 };
  const effects: string[] = [], getTask = vi.fn(async (): Promise<PersistedCloudTask> => { effects.push('fresh-read'); return structuredClone(task); });
  const readResult = vi.fn(async (): Promise<SketchImageAuthorizedResult> => result);
  const cancelTransaction = vi.fn(async () => { effects.push('transaction-ack'); return { cancelled: true, refunded: !free }; });
  const schedule = vi.fn(() => true);
  const deps: SketchImagePublicHttpDependencies = { getTask, readResult, cancelTransaction, scheduleRecovery: schedule,
    abortMemory: () => { effects.push('abort'); return true; }, cancelMemory: () => { effects.push('cancel'); return true; },
    updateMemory: () => { effects.push('update'); } };
  return { task, result, deps, getTask, readResult, cancelTransaction, schedule, effects };
}
function privateAbsent(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/private-|imageDataUrl|instruction|idempotencyKey|requestDigest|grantGeneration|sketchImageAdmission|sketchImageExecution|receipt|routing|remoteTaskId|chargedTransactionId|refundedTransactionId|inputTokens/);
}
async function responseJson(response: Awaited<ReturnType<typeof pollSketchImageTask>>): Promise<Record<string, unknown>> {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-request-id')).toBe(requestId);
  const json: unknown = await response.json(); privateAbsent(json); return json as Record<string, unknown>;
}
describe('strict public image task projection and protected completed reader boundary', () => {
  it('summary exposes only original identity, finite progress and the dual frozen quote', () => {
    const f = fixture(), summary = sketchImageTaskSummary(f.task, actor);
    expect(summary).toMatchObject({ taskId: body.taskId, type: 'sketch-to-image', projectId: body.projectId, status: 'processing', progress: 31,
      visionProviderId: 'vp', visionModelId: 'vm', imageProviderId: 'ip', imageModelId: 'im', reserveCredits: 18 });
    expect(summary.pricing).toEqual({ version: 1, vision: { providerId: 'vp', modelId: 'vm', calls: 1, mode: 'flat', reserveCredits: 7 },
      image: { providerId: 'ip', modelId: 'im', calls: 1, credits: 11 }, totalReserveCredits: 18 }); privateAbsent(summary);
  });
  it.each(['actor', 'type', 'source', 'nonce', 'digest', 'image-model', 'vision-quote', 'reserve', 'status', 'progress-nan', 'progress-high'] as const)('rejects summary with changed %s', kind => {
    const f = fixture();
    if (kind === 'actor') f.task.userId = 'other'; if (kind === 'type') f.task.type = 'generate';
    if (kind === 'source') ((f.task.result!.sketchImageAdmission as { input: { instruction: string } }).input).instruction = 'changed';
    if (kind === 'nonce') f.task.idempotencyKey = 'other'; if (kind === 'digest') f.task.requestDigest = '0'.repeat(64);
    if (kind === 'image-model') f.task.model = 'other'; if (kind === 'vision-quote') Object.assign(f.result.pricing.vision, { modelId: 'other' });
    if (kind === 'reserve') f.task.creditCost = 19; if (kind === 'status') f.task.status = 'queued';
    if (kind === 'progress-nan') f.task.progress = NaN; if (kind === 'progress-high') f.task.progress = 101;
    expect(() => sketchImageTaskSummary(f.task, actor)).toThrow('SKETCH_IMAGE_TASK_UNAVAILABLE');
  });
  it('owner identity is checked before hostile body descriptors without invoking getters', async () => {
    const f = fixture(); f.task.userId = 'other'; const getter = vi.fn(); const invalidBody = Object.defineProperty({}, 'taskId', { get: getter });
    const response = await pollSketchImageTask(invalidBody, f.task, actor, requestId, f.deps);
    expect(response.status).toBe(404); expect(await responseJson(response)).toMatchObject({ code: 'SKETCH_IMAGE_TASK_UNAVAILABLE' }); expect(getter).not.toHaveBeenCalled();
    expect(f.readResult).not.toHaveBeenCalled(); expect(f.schedule).not.toHaveBeenCalled();
  });
  it.each([{ taskId: body.taskId }, { ...body, projectId: 'other' }, { ...body, taskId: 'other' }, { ...body, providerId: 'vp' },
    { ...body, imageProviderId: 'vp' }, { ...body, model: 'vp::vm' }, { ...body, visionProviderId: 'vp' }, { ...body, arbitrary: true }])('rejects strict poll body %j before invoking any port', async input => {
    const f = fixture(), response = await pollSketchImageTask(input, f.task, actor, requestId, f.deps); expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({ success: false, retryable: false }); expect(f.readResult).not.toHaveBeenCalled(); expect(f.schedule).not.toHaveBeenCalled();
  });
  it.each(['im', 'ip::im'])('accepts only the explicit image binding (%s)', async model => {
    const f = fixture(); f.task.leaseExpiresAt = Date.now() + 600_000;
    const response = await pollSketchImageTask({ ...body, providerId: 'ip', imageProviderId: 'ip', model }, f.task, actor, requestId, f.deps);
    expect(response.status).toBe(202); expect(await responseJson(response)).toMatchObject({ status: 'processing' }); expect(f.schedule).not.toHaveBeenCalled();
  });
  it('completed uses protected reader and strips extra private fields instead of spreading its typed result', async () => {
    const f = fixture('completed'); f.readResult.mockResolvedValue({ ...f.result, actualCredits: 12, imageDataUrl: png, privateReceipt: 'private-reader-field', usage: { inputTokens: 2 } });
    const response = await pollSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(200);
    expect(await responseJson(response)).toMatchObject({ status: 'completed', imageUrl: '/api/serve-upload/output.png', previewUrl: '/api/serve-upload/input.png',
      imageAssetId: 'oa', imageAssetVersionId: 'ov', previewAssetId: 'ia', previewAssetVersionId: 'iv', actualCredits: 12, reserveCredits: 18 });
    expect(f.readResult).toHaveBeenCalledWith({ actorUserId: actor, projectId: body.projectId, taskId: body.taskId }); expect(f.schedule).not.toHaveBeenCalled();
  });
  it.each(['taskId', 'projectId', 'visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId', 'reserveCredits', 'pricing', 'imageUrl', 'actualCredits'] as const)('refuses protected result with changed %s', async key => {
    const f = fixture('completed'); const bad: Record<string, unknown> = { ...f.result };
    bad[key] = key === 'reserveCredits' ? 19 : key === 'pricing' ? { ...f.result.pricing, totalReserveCredits: 19 } : key === 'imageUrl' ? 'https://private.invalid/output.png' : key === 'actualCredits' ? NaN : 'other';
    f.readResult.mockResolvedValue(bad); const response = await pollSketchImageTask(body, f.task, actor, requestId, f.deps);
    expect(response.status).toBe(404); expect(await responseJson(response)).toMatchObject({ code: 'SKETCH_IMAGE_RESULT_UNAVAILABLE', retryable: false });
  });
  it('does not trust a protected reader error message, status or even foreign SketchHttpError', async () => {
    const f = fixture('completed'); f.readResult.mockRejectedValue(new SketchHttpError(418, 'private-reader-error'));
    const response = await pollSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(404);
    expect(await responseJson(response)).toMatchObject({ code: 'SKETCH_IMAGE_RESULT_UNAVAILABLE', retryable: false });
  });
  it.each(['failed', 'cancelled', 'timeout'] as const)('terminal %s uses fixed public errors, never raw errors', async status => {
    const f = fixture(status), response = await pollSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(200);
    expect(await responseJson(response)).toMatchObject({ status, error: { code: status === 'failed' ? 'SKETCH_IMAGE_EXECUTION_FAILED' : status === 'cancelled' ? 'SKETCH_IMAGE_EXECUTION_CANCELLED' : 'SKETCH_IMAGE_EXECUTION_TIMEOUT' } });
    expect(f.schedule).not.toHaveBeenCalled(); expect(f.readResult).not.toHaveBeenCalled();
  });
});
describe('accepted-only expired lease recovery is scheduled, never inline paid work', () => {
  it('returns promptly after queuing one captured background recovery', async () => {
    const f = fixture(), response = await pollSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(202);
    expect(await responseJson(response)).toMatchObject({ needsReconcile: true, recoveryPending: true });
    expect(f.schedule).toHaveBeenCalledOnce(); expect(f.schedule.mock.calls[0][0]).toMatchObject({ id: body.taskId, userId: actor }); expect(f.schedule.mock.calls[0][1]).toBe(requestId);
    expect(f.cancelTransaction).not.toHaveBeenCalled(); expect(f.effects).toEqual([]);
  });
  it.each(['analysis', 'analysis-complete', 'generation', 'missing', 'bad-receipt', 'active-lease', 'invalid-lease'] as const)('does not schedule %s', async phase => {
    const f = fixture(); const checkpoint = f.task.result!.sketchImageExecution as Record<string, unknown>;
    if (phase === 'missing') delete f.task.result!.sketchImageExecution;
    else if (phase === 'active-lease') f.task.leaseExpiresAt = Date.now() + 600_000;
    else if (phase === 'invalid-lease') f.task.leaseExpiresAt = NaN;
    else if (phase === 'bad-receipt') checkpoint.receipt = { usedProviderId: 'other' };
    else { checkpoint.phase = phase; delete checkpoint.receipt; if (phase === 'analysis') delete checkpoint.analysis; }
    const response = await pollSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(202); privateAbsent(await responseJson(response));
    expect(f.schedule).not.toHaveBeenCalled(); expect(f.cancelTransaction).not.toHaveBeenCalled(); expect(f.effects).toEqual([]);
  });
  it.each([false, 'throw'] as const)('schedule failure %s stays pending reconciliation without retry', async mode => {
    const f = fixture(); f.schedule.mockImplementation(() => { if (mode === 'throw') throw new SketchHttpError(401, 'private-schedule'); return false; });
    const response = await pollSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(202);
    expect(await responseJson(response)).toMatchObject({ needsReconcile: true, recoveryPending: false }); expect(f.schedule).toHaveBeenCalledOnce(); expect(f.effects).toEqual([]);
  });
  it.each(['negative-expiry', 'missing-expiry', 'missing-attempt', 'zero-attempt'] as const)('invalid recovery lease %s needs reconciliation, not a provider attempt', async kind => {
    const f = fixture();
    if (kind === 'negative-expiry') f.task.leaseExpiresAt = -1;
    if (kind === 'missing-expiry') delete f.task.leaseExpiresAt;
    if (kind === 'missing-attempt') delete f.task.attemptCount;
    if (kind === 'zero-attempt') f.task.attemptCount = 0;
    const response = await pollSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(202);
    expect(await responseJson(response)).toMatchObject({ needsReconcile: true, recoveryPending: false }); expect(f.schedule).not.toHaveBeenCalled();
  });
  it('default recovery is captured by after without inline service execution', async () => {
    const f = fixture(); const deps = { ...f.deps }; delete deps.scheduleRecovery;
    const response = await pollSketchImageTask(body, f.task, actor, requestId, deps); expect(response.status).toBe(202);
    expect(await responseJson(response)).toMatchObject({ recoveryPending: true }); expect(defaults.after).toHaveBeenCalledOnce();
    expect(typeof defaults.after.mock.calls[0][0]).toBe('function'); expect(f.effects).toEqual([]); expect(defaults.recover).not.toHaveBeenCalled();
    defaults.recover.mockResolvedValue({ status: 'deferred', reason: 'SKETCH_IMAGE_RECOVERY_UNCONFIRMED' });
    const callback = defaults.after.mock.calls[0][0] as () => Promise<unknown>;
    await callback(); expect(defaults.recover).toHaveBeenCalledOnce(); expect(defaults.recover).toHaveBeenCalledWith(f.task, requestId);
  });
  it('default after rejection remains 202 without inline recovery or raw errors', async () => {
    const f = fixture(), deps = { ...f.deps }; delete deps.scheduleRecovery;
    defaults.after.mockImplementation(() => { throw new SketchHttpError(418, 'private-after-error'); });
    const response = await pollSketchImageTask(body, f.task, actor, requestId, deps); expect(response.status).toBe(202);
    expect(await responseJson(response)).toMatchObject({ needsReconcile: true, recoveryPending: false }); expect(defaults.recover).not.toHaveBeenCalled();
  });
});
describe('owner cancellation ACK and original cancelled fresh-read idempotence', () => {
  it('cancel checks original owner before hostile body access or cancellation ports', async () => {
    const f = fixture(); f.task.userId = 'other'; const getter = vi.fn(), input = Object.defineProperty({}, 'taskId', { get: getter });
    const response = await cancelSketchImageTask(input, f.task, actor, requestId, f.deps); expect(response.status).toBe(404);
    expect(await responseJson(response)).toMatchObject({ code: 'SKETCH_IMAGE_TASK_UNAVAILABLE' }); expect(getter).not.toHaveBeenCalled();
    expect(f.effects).toEqual([]); expect(f.cancelTransaction).not.toHaveBeenCalled();
  });
  it.each([false, true])('processing ACK precedes all memory effects (free=%s)', async free => {
    const f = fixture('processing', free), response = await cancelSketchImageTask(body, f.task, actor, requestId, f.deps);
    expect(response.status).toBe(200); expect(await responseJson(response)).toMatchObject({ status: 'cancelled', progress: 0, refunded: !free });
    expect(f.effects).toEqual(['transaction-ack', 'abort', 'cancel', 'update']); expect(f.cancelTransaction.mock.calls[0][0]).toMatchObject({ taskId: body.taskId, actorUserId: actor, projectId: body.projectId });
    expect(f.getTask).not.toHaveBeenCalled();
  });
  it('awaits a real cancellation ACK before exposing cancellation or interrupting memory', async () => {
    const f = fixture(); let resolve!: (value: { cancelled: boolean; refunded: boolean }) => void;
    f.cancelTransaction.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = cancelSketchImageTask(body, f.task, actor, requestId, f.deps); await Promise.resolve(); expect(f.effects).toEqual([]); expect(typeof resolve).toBe('function');
    resolve({ cancelled: true, refunded: true }); const response = await pending; expect(response.status).toBe(200); expect(f.effects).toEqual(['abort', 'cancel', 'update']);
  });
  it.each(['unknown-commit', 'not-acked', 'wrong-refund'] as const)('unconfirmed %s never aborts memory or retries', async kind => {
    const f = fixture(); if (kind === 'unknown-commit') f.cancelTransaction.mockRejectedValue(new SketchHttpError(401, 'private-commit'));
    else f.cancelTransaction.mockResolvedValue({ cancelled: kind !== 'not-acked', refunded: kind !== 'wrong-refund' });
    const response = await cancelSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(503);
    expect(await responseJson(response)).toMatchObject({ code: 'SKETCH_IMAGE_CANCELLATION_UNCONFIRMED', retryable: false }); expect(f.effects).toEqual([]);
    expect(f.cancelTransaction).toHaveBeenCalledOnce(); expect(f.getTask).not.toHaveBeenCalled();
  });
  it.each(['pending', 'completed', 'failed', 'timeout'] as const)('terminal/non-processing %s returns 409 without cancelling', async status => {
    const f = fixture(status), response = await cancelSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(409);
    expect(await responseJson(response)).toMatchObject({ code: 'SKETCH_IMAGE_TASK_NOT_ACTIVE' }); expect(f.cancelTransaction).not.toHaveBeenCalled(); expect(f.effects).toEqual([]);
  });
  it.each([{ taskId: body.taskId }, { ...body, model: 'im' }, { ...body, providerId: 'ip' }, { ...body, visionModelId: 'vm' }])('strict cancel body %j cannot trigger transaction', async input => {
    const f = fixture(), response = await cancelSketchImageTask(input, f.task, actor, requestId, f.deps); expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({ retryable: false }); expect(f.cancelTransaction).not.toHaveBeenCalled(); expect(f.effects).toEqual([]);
  });
  it.each([false, true])('already cancelled fresh-read confirms original full refund, never repeats settlement (free=%s)', async free => {
    const f = fixture('cancelled', free), response = await cancelSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(200);
    expect(await responseJson(response)).toMatchObject({ status: 'cancelled', refunded: !free }); expect(f.effects).toEqual(['fresh-read', 'abort', 'cancel', 'update']);
    expect(f.getTask).toHaveBeenCalledWith(body.taskId); expect(f.cancelTransaction).not.toHaveBeenCalled();
  });
  it.each([['chargedTransactionId', 0], ['chargedTransactionId', false], ['refundedTransactionId', 0], ['refundedTransactionId', false]] as const)('free cancellation rejects non-ID %s=%s instead of treating it as absent', async (key, value) => {
    const f = fixture('cancelled', true); (f.task as unknown as Record<string, unknown>)[key] = value;
    const response = await cancelSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(503);
    expect(await responseJson(response)).toMatchObject({ code: 'SKETCH_IMAGE_CANCELLATION_UNCONFIRMED' }); expect(f.effects).toEqual([]);
    expect(f.cancelTransaction).not.toHaveBeenCalled(); expect(f.getTask).not.toHaveBeenCalled();
  });
  it.each(['charge', 'refund', 'credit', 'settlement', 'fresh-actor', 'fresh-nonce', 'fresh-price', 'fresh-completed', 'fresh-settlement', 'fresh-failure'] as const)('unconfirmed cancelled %s never interrupts memory or repeats refund', async kind => {
    const f = fixture('cancelled');
    if (kind === 'charge') f.task.chargedTransactionId = 'other'; if (kind === 'refund') f.task.refundedTransactionId = 'other';
    if (kind === 'credit') f.task.creditStatus = 'pending'; if (kind === 'settlement') f.task.result!.sketchImageSettlement = {};
    if (kind.startsWith('fresh-')) {
      const fresh = structuredClone(f.task);
      if (kind === 'fresh-actor') fresh.userId = 'other'; if (kind === 'fresh-nonce') fresh.idempotencyKey = 'other';
      if (kind === 'fresh-price') fresh.creditCost = 19; if (kind === 'fresh-completed') fresh.status = 'completed';
      if (kind === 'fresh-settlement') fresh.result!.sketchImageSettlement = {};
      f.getTask.mockImplementation(async () => { f.effects.push('fresh-read'); if (kind === 'fresh-failure') throw new SketchHttpError(418, 'private-fresh'); return fresh; });
    }
    const response = await cancelSketchImageTask(body, f.task, actor, requestId, f.deps); expect(response.status).toBe(503);
    expect(await responseJson(response)).toMatchObject({ retryable: false }); expect(f.effects.filter(e => e !== 'fresh-read')).toEqual([]); expect(f.cancelTransaction).not.toHaveBeenCalled();
  });
  it('default ports are the original reader, cancel transaction, fresh task and memory helpers', async () => {
    const completed = fixture('completed'); defaults.readResult.mockResolvedValue(completed.result);
    expect((await pollSketchImageTask(body, completed.task, actor, requestId)).status).toBe(200); expect(defaults.readResult).toHaveBeenCalledOnce();
    const processing = fixture(); defaults.cancelTransaction.mockResolvedValue({ cancelled: true, refunded: true });
    expect((await cancelSketchImageTask(body, processing.task, actor, requestId)).status).toBe(200);
    expect(defaults.abort).toHaveBeenCalledWith(body.taskId); expect(defaults.cancel).toHaveBeenCalledWith(body.taskId); expect(defaults.update).toHaveBeenCalledWith(body.taskId, { status: 'cancelled', progress: 0 });
    const cancelled = fixture('cancelled'); defaults.getTask.mockResolvedValue(cancelled.task);
    expect((await cancelSketchImageTask(body, cancelled.task, actor, requestId)).status).toBe(200); expect(defaults.getTask).toHaveBeenCalledOnce(); expect(defaults.cancelTransaction).toHaveBeenCalledOnce();
  });
});

describe('original generic stored refund repeated-cancel counterexamples', () => {
  const refundId = 'ctx_1700000000000_a1b2c3d4';
  type ReceiptPort = (identity: Readonly<import('@/lib/sketch-to-code/image-task-state').SketchImageTaskIdentity>, id: string) => Promise<boolean>;
  function genericFixture(): ReturnType<typeof fixture> {
    const f = fixture('cancelled'); f.task.refundedTransactionId = refundId;
    f.task.leaseOwner = undefined; f.task.leaseExpiresAt = undefined;
    return f;
  }
  it('reconfirms an original generic refund only after fresh identity and an ACKed read-only ledger proof', async () => {
    const f = genericFixture(), proof = vi.fn<ReceiptPort>(async (identity, id) => {
      expect(identity).toMatchObject({ taskId: body.taskId, actorUserId: actor, projectId: body.projectId,
        input: { imageDataUrl: png, instruction: 'private-keywords', idempotencyKey: 'private-nonce', visionProviderId: 'vp', visionModelId: 'vm', imageProviderId: 'ip', imageModelId: 'im' },
        access: { kind: 'document', ownerId: 'owner', grantGeneration: '1' }, pricing: { totalReserveCredits: 18, vision: { reserveCredits: 7 }, image: { credits: 11 } } });
      expect(id).toBe(refundId); f.effects.push('proof-ack'); return true;
    });
    const deps: SketchImagePublicHttpDependencies & { confirmCancelledReceipt: ReceiptPort } = { ...f.deps, confirmCancelledReceipt: proof };
    const response = await cancelSketchImageTask(body, f.task, actor, requestId, deps);
    expect(response.status).toBe(200); expect(await responseJson(response)).toMatchObject({ status: 'cancelled', refunded: true });
    expect(f.effects).toEqual(['fresh-read', 'proof-ack', 'abort', 'cancel', 'update']);
    expect(proof).toHaveBeenCalledOnce(); expect(f.cancelTransaction).not.toHaveBeenCalled();
  });
  it('waits for the actual receipt proof before returning success or interrupting memory', async () => {
    const f = genericFixture(); let resolve!: (confirmed: boolean) => void;
    const proof: ReceiptPort = () => new Promise(r => { resolve = r; });
    const deps = { ...f.deps, confirmCancelledReceipt: proof };
    const pending = cancelSketchImageTask(body, f.task, actor, requestId, deps);
    await Promise.resolve(); await Promise.resolve();
    expect(f.effects).toEqual(['fresh-read']); expect(typeof resolve).toBe('function');
    resolve(true); expect((await pending).status).toBe(200); expect(f.effects).toEqual(['fresh-read', 'abort', 'cancel', 'update']);
  });
  it.each(['false', 'throw', 'nonboolean'] as const)('unconfirmed read-only proof %s never exposes cancellation or retries finance', async mode => {
    const f = genericFixture(), proof = vi.fn<ReceiptPort>(async () => {
      if (mode === 'throw') throw new Error('private-read-proof');
      return mode === 'nonboolean' ? 'yes' as unknown as boolean : false;
    });
    const response = await cancelSketchImageTask(body, f.task, actor, requestId, { ...f.deps, confirmCancelledReceipt: proof });
    expect(response.status).toBe(503); expect(await responseJson(response)).toMatchObject({ code: 'SKETCH_IMAGE_CANCELLATION_UNCONFIRMED' });
    expect(f.effects).toEqual(['fresh-read']); expect(proof).toHaveBeenCalledOnce(); expect(f.cancelTransaction).not.toHaveBeenCalled();
  });
  it.each(['refund', 'source', 'nonce', 'quote', 'project', 'actor', 'lease', 'settlement'] as const)('changed fresh generic %s cannot reach the receipt port', async kind => {
    const f = genericFixture(), fresh = structuredClone(f.task), proof = vi.fn<ReceiptPort>(async () => true);
    const meta = fresh.result!.sketchImageAdmission as { input: Record<string, string>; requestDigest: string; pricing: { totalReserveCredits: number; image: { credits: number } }; access: Record<string, string> };
    if (kind === 'refund') fresh.refundedTransactionId = 'ctx_1700000000000_other123';
    if (kind === 'source' || kind === 'nonce' || kind === 'project') {
      if (kind === 'source') meta.input.instruction = 'different-source';
      if (kind === 'nonce') { meta.input.idempotencyKey = 'different-nonce'; fresh.idempotencyKey = 'different-nonce'; }
      if (kind === 'project') { meta.input.projectId = 'different-project'; fresh.projectId = 'different-project'; meta.access.projectId = 'different-project'; }
      meta.requestDigest = sketchImageRequestDigest(meta.input as unknown as Parameters<typeof sketchImageRequestDigest>[0]); fresh.requestDigest = meta.requestDigest;
    }
    if (kind === 'quote') { meta.pricing.image.credits = 12; meta.pricing.totalReserveCredits = 19; fresh.creditCost = 19; }
    if (kind === 'actor') fresh.userId = 'different-actor';
    if (kind === 'lease') fresh.leaseOwner = 'not-cleared';
    if (kind === 'settlement') fresh.result!.sketchImageSettlement = {};
    f.getTask.mockImplementation(async () => { f.effects.push('fresh-read'); return fresh; });
    const response = await cancelSketchImageTask(body, f.task, actor, requestId, { ...f.deps, confirmCancelledReceipt: proof });
    expect(response.status).toBe(503); privateAbsent(await responseJson(response)); expect(proof).not.toHaveBeenCalled();
    expect(f.effects).toEqual(['fresh-read']); expect(f.cancelTransaction).not.toHaveBeenCalled();
  });
  it.each([false, true])('old canonical/free confirmation never touches the new receipt port (free=%s)', async free => {
    const f = fixture('cancelled', free), proof = vi.fn<ReceiptPort>(async () => { throw new Error('must-not-read'); });
    const response = await cancelSketchImageTask(body, f.task, actor, requestId, { ...f.deps, confirmCancelledReceipt: proof });
    expect(response.status).toBe(200); expect(proof).not.toHaveBeenCalled(); expect(f.cancelTransaction).not.toHaveBeenCalled();
  });
  it('the first cancellation unknown COMMIT cannot fall through to receipt proof or fresh-read confirmation', async () => {
    const f = fixture(), proof = vi.fn<ReceiptPort>(async () => true);
    f.cancelTransaction.mockRejectedValue(new Error('private-unknown-commit'));
    const response = await cancelSketchImageTask(body, f.task, actor, requestId, { ...f.deps, confirmCancelledReceipt: proof });
    expect(response.status).toBe(503); expect(proof).not.toHaveBeenCalled(); expect(f.getTask).not.toHaveBeenCalled(); expect(f.effects).toEqual([]);
  });
});
