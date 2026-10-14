import { createCanvas } from '@napi-rs/canvas';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedCloudTask } from '@/lib/cloud-task-storage';
import type { SketchImageTaskAdmission } from '@/lib/sketch-to-code/image-admission';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import { readSketchImageTaskIdentity } from '@/lib/sketch-to-code/image-task-state';
import { parseSketchImageAnalysis } from '@/lib/sketch-to-code/image-contract';
import { parseStoredSketchImageReceipt, type SketchImageExecutionHooks, type SketchImagePreparation } from '@/lib/sketch-to-code/image-generation';
import { executeSketchImageTask, recoverSketchImageTask, type SketchImageWorkerDependencies, type SketchImagePublicationValue } from '@/lib/sketch-to-code/image-worker';
import { markSketchImageKnownFailure } from '@/lib/sketch-to-code/image-known-failure';
import type { SketchImageFailureInput } from '@/lib/sketch-to-code/image-failure';
vi.mock('server-only', () => ({}));
const input = { projectId: 'project-a', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: '海边木屋', visionProviderId: 'vision-p',
  visionModelId: 'vision-model', imageProviderId: 'image-p', imageModelId: 'image-model', idempotencyKey: 'nonce-a', aspectRatio: '4:3' };
const access = { kind: 'personal' as const, actorUserId: 'user-a', projectId: 'project-a', ownerId: 'user-a' };
const pricing = { version: 1 as const, vision: { providerId: 'vision-p', modelId: 'vision-model', calls: 1 as const, mode: 'flat' as const, reserveCredits: 7 },
  image: { providerId: 'image-p', modelId: 'image-model', calls: 1 as const, credits: 11 }, totalReserveCredits: 18 };
const analysis = parseSketchImageAnalysis({ summary: '木屋', composition: '木屋左海右', prompt: '水彩木屋', negativePrompt: '水印' });
const response = { analysis, usage: { inputTokens: 2, outputTokens: 3 } };
const routing = { vision: '1'.repeat(64), image: '2'.repeat(64) }, context = { actorUserId: 'user-a', projectId: 'project-a' };
afterEach(() => vi.useRealTimers());
function harness(direct = true): { task: PersistedCloudTask; admission: SketchImageTaskAdmission; dependencies: SketchImageWorkerDependencies;
  events: string[]; compute: ReturnType<typeof vi.fn>; publish: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>;
  checkpoint: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>; claim: ReturnType<typeof vi.fn> } {
  const digest = sketchImageRequestDigest(input), task: PersistedCloudTask = { id: 'skimg_one', type: 'sketch-to-image', userId: 'user-a', projectId: 'project-a',
    providerId: 'image-p', model: 'image-model', requestDigest: digest, idempotencyKey: 'nonce-a', status: 'processing', revision: 1, progress: 0,
    creditCost: 18, creditStatus: 'pending', createdAt: Date.now(), updatedAt: Date.now(), leaseOwner: '', leaseExpiresAt: 0, attemptCount: 0,
    result: { sketchImageAdmission: structuredClone({ version: 1, route: '/api/sketch-to-image', requestDigest: digest, input, access, pricing }) } };
  const receipt = parseStoredSketchImageReceipt({ taskIds: direct ? [] : ['remote-a'], directImageUrls: direct ? ['https://image.invalid/output.png'] : [],
    usedModel: 'image-model', usedProviderId: 'image-p' }, { modelId: 'image-model', providerId: 'image-p' });
  const events: string[] = [];
  const compute = vi.fn(async (signal: AbortSignal, hooks: SketchImageExecutionHooks) => {
    await hooks.beforePhase('analysis'); signal.throwIfAborted(); events.push('vision-post');
    await hooks.afterAnalysis(response); signal.throwIfAborted(); await hooks.beforePhase('generation'); signal.throwIfAborted(); events.push('image-post');
    return { ...response, receipt };
  });
  const prepared: SketchImagePreparation = { input: structuredClone(input), access: structuredClone(access),
    visionBinding: { providerId: 'vision-p', modelId: 'vision-model' }, imageBinding: { providerId: 'image-p', modelId: 'image-model' }, compute };
  const read = vi.fn(async () => structuredClone(task));
  const claim = vi.fn(async (id: string, owner: string, ttl: number) => {
    task.leaseOwner = owner; task.leaseExpiresAt = Date.now() + ttl; task.attemptCount = (task.attemptCount || 0) + 1;
    return { taskId: id, owner, expiresAt: task.leaseExpiresAt, attemptCount: task.attemptCount };
  });
  const checkpoint = vi.fn(async (value: Parameters<NonNullable<SketchImageWorkerDependencies['checkpoint']>>[0]) => {
    events.push('ack-' + value.phase);
    task.result!.sketchImageExecution = { version: 1, phase: value.phase, routing: value.routing,
      ...(value.phase === 'analysis-complete' || value.phase === 'generation' || value.phase === 'accepted' ? response : {}),
      ...(value.draft ? { receipt: value.draft.receipt } : {}) };
  });
  const query = vi.fn(async (remoteId: string) => { void remoteId; return { status: 'completed' as 'completed' | 'failed' | 'pending', imageUrls: ['https://image.invalid/output.png'] }; });
  const publish = vi.fn(async (value: SketchImagePublicationValue) => { void value; events.push('publication'); task.status = 'completed'; task.creditStatus = 'charged'; task.progress = 100;
    Object.assign(task.result!, { analysis, previewAssetId: 'input-a', previewAssetVersionId: 'input-v', imageAssetId: 'output-a', imageAssetVersionId: 'output-v' }); return true; });
  return { task, events, read, claim, compute, publish, query, checkpoint, admission: { task: task as SketchImageTaskAdmission['task'], reused: false, charged: true, prepared },
    dependencies: { routing, getTask: read, claimLease: claim, checkpoint, publisher: publish, query, checkCurrent: async () => routing } };
}
describe('same durable image parent execution and receipt-only recovery', () => {
  it.each(['analysis', 'generation'] as const)('closes only a privately confirmed %s failure after original terminal ACK/readback', async phase => {
    const h = harness(), error = markSketchImageKnownFailure(new Error('safe'), { phase, kind: 'rejected',
      providerId: phase === 'analysis' ? 'vision-p' : 'image-p', modelId: phase === 'analysis' ? 'vision-model' : 'image-model' });
    h.compute.mockImplementationOnce(async (signal, hooks) => { await hooks.beforePhase('analysis'); signal.throwIfAborted();
      if (phase === 'generation') { await hooks.afterAnalysis(response); await hooks.beforePhase('generation'); } throw error;
    });
    const failure = vi.fn(async (value: SketchImageFailureInput) => { expect(value.error).toBe(error); expect(value.signal.aborted).toBe(false);
      h.task.status = 'failed'; h.task.creditStatus = 'refunded'; h.task.refundedTransactionId = 'original-refund'; h.task.leaseOwner = ''; h.task.leaseExpiresAt = 0; return true;
    });
    expect(await executeSketchImageTask(h.admission, context, { ...h.dependencies, failure } as SketchImageWorkerDependencies & { failure: typeof failure })).toEqual({ status: 'failed' });
    expect(failure).toHaveBeenCalledOnce(); expect(failure.mock.calls[0][0]).toMatchObject({ identity: { taskId: h.task.id }, lease: { attemptCount: 1 }, routing });
    expect(h.publish).not.toHaveBeenCalled(); expect(h.query).not.toHaveBeenCalled(); expect(h.compute).toHaveBeenCalledOnce();
  });
  it('known original remote failure during receipt-only recovery settles without reconstructing either POST', async () => {
    const h = harness(false); h.task.attemptCount = 1;
    h.task.result!.sketchImageExecution = { version: 1, phase: 'accepted', routing, ...response,
      receipt: { taskIds: ['remote-a'], directImageUrls: [], usedProviderId: 'image-p', usedModel: 'image-model' } };
    const error = markSketchImageKnownFailure(new Error('safe'), { phase: 'result', kind: 'remote-failed', providerId: 'image-p', modelId: 'image-model', remoteId: 'remote-a' });
    h.query.mockRejectedValueOnce(error);
    const failure = vi.fn(async () => { h.task.status = 'failed'; h.task.creditStatus = 'refunded'; h.task.refundedTransactionId = 'original-refund'; h.task.leaseOwner = ''; h.task.leaseExpiresAt = 0; return true; });
    expect((await recoverSketchImageTask(h.task.id, readSketchImageTaskIdentity(h.task), { ...h.dependencies, failure } as SketchImageWorkerDependencies & { failure: typeof failure })).status).toBe('failed');
    expect(failure).toHaveBeenCalledOnce(); expect(h.compute).not.toHaveBeenCalled(); expect(h.checkpoint).not.toHaveBeenCalled(); expect(h.query).toHaveBeenCalledOnce();
  });
  it.each(['false-ack', 'false-terminal'] as const)('confirmed provider failure with %s still stays deferred and never retries settlement', async variant => {
    const h = harness(), error = markSketchImageKnownFailure(new Error('safe'), { phase: 'analysis', kind: 'rejected', providerId: 'vision-p', modelId: 'vision-model' });
    h.compute.mockImplementationOnce(async (_signal, hooks) => { await hooks.beforePhase('analysis'); throw error; });
    const failure = vi.fn(async () => variant === 'false-terminal');
    expect((await executeSketchImageTask(h.admission, context, { ...h.dependencies, failure } as SketchImageWorkerDependencies & { failure: typeof failure })).status).toBe('deferred');
    expect(failure).toHaveBeenCalledOnce(); expect(h.compute).toHaveBeenCalledOnce(); expect(h.publish).not.toHaveBeenCalled();
  });
  it.each(['forged', 'before-lease', 'publication'] as const)('never infers an automatic refund from %s failure', async variant => {
    const h = harness(), failure = vi.fn(async () => true);
    const error = variant === 'forged' ? new Error('SKETCH_IMAGE_PROVIDER_REJECTED') : markSketchImageKnownFailure(new Error('safe'),
      { phase: 'generation', kind: 'rejected', providerId: 'image-p', modelId: 'image-model' });
    if (variant === 'before-lease') h.claim.mockRejectedValueOnce(error);
    else if (variant === 'publication') h.publish.mockRejectedValueOnce(error);
    else h.compute.mockRejectedValueOnce(error);
    expect((await executeSketchImageTask(h.admission, context, { ...h.dependencies, failure } as SketchImageWorkerDependencies & { failure: typeof failure })).status).toBe('deferred');
    expect(failure).not.toHaveBeenCalled();
  });
  it('bounds an ignored-signal original failure consumer and ignores late terminal ACK', async () => {
    const h = harness(), error = markSketchImageKnownFailure(new Error('safe'), { phase: 'analysis', kind: 'rejected', providerId: 'vision-p', modelId: 'vision-model' });
    h.compute.mockImplementationOnce(async (_signal, hooks) => { await hooks.beforePhase('analysis'); throw error; });
    let finish!: (value: boolean) => void, actual: AbortSignal | undefined;
    const failure = vi.fn((value: SketchImageFailureInput) => { actual = value.signal; return new Promise<boolean>(r => { finish = r; }); });
    vi.useFakeTimers(); const running = executeSketchImageTask(h.admission, context, { ...h.dependencies, failure } as SketchImageWorkerDependencies & { failure: typeof failure });
    await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(10_000);
    expect((await running).status).toBe('deferred'); expect(failure).toHaveBeenCalledOnce(); expect(actual?.aborted).toBe(true);
    finish(true); await vi.advanceTimersByTimeAsync(0); expect(h.publish).not.toHaveBeenCalled(); expect(h.compute).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not let the monitor abort a confirmed original failure while its ACK is returning', async () => {
    const h = harness(), error = markSketchImageKnownFailure(new Error('safe'), { phase: 'analysis', kind: 'rejected', providerId: 'vision-p', modelId: 'vision-model' });
    h.compute.mockImplementationOnce(async (_signal, hooks) => { await hooks.beforePhase('analysis'); throw error; });
    const failure = vi.fn(async (value: SketchImageFailureInput) => { h.task.status = 'failed'; h.task.creditStatus = 'refunded'; h.task.refundedTransactionId = 'original-refund';
      h.task.leaseOwner = ''; h.task.leaseExpiresAt = 0; await new Promise(r => setTimeout(r, 2_000)); expect(value.signal.aborted).toBe(false); return true;
    });
    vi.useFakeTimers(); const running = executeSketchImageTask(h.admission, context, { ...h.dependencies, failure } as SketchImageWorkerDependencies & { failure: typeof failure });
    await vi.advanceTimersByTimeAsync(2_000); expect((await running).status).toBe('failed'); expect(failure).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('persists all four ACKs before calls, stores receipt before publication and completes original task', async () => {
    const h = harness(); expect(await executeSketchImageTask(h.admission, context, h.dependencies)).toEqual({ status: 'completed' });
    expect(h.events).toEqual(['ack-analysis', 'vision-post', 'ack-analysis-complete', 'ack-generation', 'image-post', 'ack-accepted', 'publication']);
    expect(h.compute).toHaveBeenCalledOnce(); expect(h.claim).toHaveBeenCalledOnce(); expect(h.query).not.toHaveBeenCalled();
    expect(h.publish.mock.calls[0][0]).toMatchObject({ identity: { taskId: 'skimg_one', input, pricing }, checkpoint: { phase: 'accepted' } });
  });
  it('a reused nonce never computes or claims a lease', async () => {
    const h = harness(); expect((await executeSketchImageTask({ ...h.admission, reused: true }, context, h.dependencies)).status).toBe('skipped');
    expect(h.compute).not.toHaveBeenCalled(); expect(h.claim).not.toHaveBeenCalled();
  });
  it.each(['publisher', 'prepared', 'routing'] as const)('requires connected %s before any model or lease', async kind => {
    const h = harness(); if (kind === 'publisher') delete h.dependencies.publisher;
    if (kind === 'prepared') delete h.admission.prepared; if (kind === 'routing') h.dependencies = { ...h.dependencies, routing: { ...routing, image: 'bad' } };
    expect((await executeSketchImageTask(h.admission, context, h.dependencies)).status).toBe('deferred');
    expect(h.compute).not.toHaveBeenCalled(); expect(h.claim).not.toHaveBeenCalled();
  });
  it.each(['actor', 'project', 'input', 'vision', 'image'] as const)('rejects wrong prepared %s identity without external calls', async kind => {
    const h = harness(); const ctx = { ...context }; if (kind === 'actor') ctx.actorUserId = 'other'; if (kind === 'project') ctx.projectId = 'other';
    if (kind === 'input') Object.assign(h.admission.prepared!.input, { instruction: 'other' });
    if (kind === 'vision') Object.assign(h.admission.prepared!.visionBinding, { modelId: 'other' }); if (kind === 'image') Object.assign(h.admission.prepared!.imageBinding, { providerId: 'other' });
    expect((await executeSketchImageTask(h.admission, ctx, h.dependencies)).status).toBe('skipped'); expect(h.claim).not.toHaveBeenCalled(); expect(h.compute).not.toHaveBeenCalled();
  });
  it.each(['analysis', 'analysis-complete', 'generation', 'accepted'] as const)('an unknown %s ACK never sends a later POST or publishes', async phase => {
    const h = harness(), original = h.checkpoint.getMockImplementation()!;
    h.checkpoint.mockImplementation(async value => { await original(value); if (value.phase === phase) throw new Error('private-lost-ack'); });
    expect((await executeSketchImageTask(h.admission, context, h.dependencies)).status).toBe('deferred'); expect(h.publish).not.toHaveBeenCalled();
    expect(h.events.filter(x => x === 'vision-post')).toHaveLength(phase === 'analysis' ? 0 : 1);
    expect(h.events.filter(x => x === 'image-post')).toHaveLength(phase === 'accepted' ? 1 : 0);
  });
  it('awaits only one known remote GET and never repeats either POST', async () => {
    const h = harness(false); expect((await executeSketchImageTask(h.admission, context, h.dependencies)).status).toBe('completed');
    expect(h.query).toHaveBeenCalledOnce(); expect(h.query.mock.calls[0][0]).toBe('remote-a'); expect(h.compute).toHaveBeenCalledOnce(); expect(h.publish).toHaveBeenCalledOnce();
  });
  it.each([
    { direct: true, change: 'grant' }, { direct: true, change: 'routing' },
    { direct: false, change: 'grant' }, { direct: false, change: 'routing' },
  ] as const)('retains the accepted receipt without publication when $change changes during a result (direct=$direct)', async ({ direct, change }) => {
    const h = harness(direct), failure = vi.fn(async () => false);
    let current = true, boundaryEntered = false, enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const boundary = new Promise<void>(resolve => { release = resolve; });
    const waitAtResult = async (): Promise<void> => { boundaryEntered = true; enter(); await boundary; };
    if (direct) {
      const original = h.compute.getMockImplementation()!;
      h.compute.mockImplementationOnce(async (signal, hooks) => { const draft = await original(signal, hooks); await waitAtResult(); return draft; });
    } else {
      const original = h.query.getMockImplementation()!;
      h.query.mockImplementationOnce(async remoteId => { const result = await original(remoteId); await waitAtResult(); return result; });
    }
    const running = executeSketchImageTask(h.admission, context, { ...h.dependencies, failure,
      checkCurrent: async () => {
        if (!current && change === 'grant') throw new Error('MODEL_NOT_AUTHORIZED');
        return !current ? { ...routing, image: '3'.repeat(64) } : routing;
      },
    });
    await Promise.race([entered, nextTurn()]);
    const reachedResultBoundary = boundaryEntered; current = false; release();
    const result = await running;
    expect(reachedResultBoundary).toBe(true); expect(result.status).toBe('deferred');
    expect(h.task).toMatchObject({ status: 'processing', creditStatus: 'pending', creditCost: 18 });
    expect(h.task.result?.sketchImageExecution).toMatchObject({ version: 1, phase: 'accepted',
      receipt: { taskIds: direct ? [] : ['remote-a'], directImageUrls: direct ? ['https://image.invalid/output.png'] : [],
        usedModel: 'image-model', usedProviderId: 'image-p' } });
    expect(h.task.result).not.toHaveProperty('imageAssetId'); expect(h.task.result).not.toHaveProperty('previewAssetId');
    expect(h.publish).not.toHaveBeenCalled(); expect(failure).not.toHaveBeenCalled();
    expect(h.compute).toHaveBeenCalledOnce(); expect(h.query).toHaveBeenCalledTimes(direct ? 0 : 1);
    expect(h.events.filter(event => event === 'image-post')).toHaveLength(1);
  });
  it.each(['wrong-routing', 'failed', 'many-images', 'late-cancel'] as const)('does not publish invalid remote %s', async kind => {
    const h = harness(false), c = new AbortController();
    if (kind === 'wrong-routing') h.dependencies.checkCurrent = async () => ({ ...routing, image: '3'.repeat(64) });
    if (kind === 'failed') h.query.mockResolvedValueOnce({ status: 'failed', imageUrls: [] });
    if (kind === 'many-images') h.query.mockResolvedValueOnce({ status: 'completed', imageUrls: ['https://image.invalid/a', 'https://image.invalid/b'] });
    if (kind === 'late-cancel') h.query.mockImplementationOnce(async () => { c.abort(); return { status: 'completed', imageUrls: ['https://image.invalid/output.png'] }; });
    expect((await executeSketchImageTask(h.admission, { ...context, signal: c.signal }, h.dependencies)).status).toBe('deferred'); expect(h.publish).not.toHaveBeenCalled();
  });
  it.each(['attempted', 'active-lease', 'cancelled'] as const)('does not claim or compute %s original task', async kind => {
    const h = harness(); if (kind === 'attempted') h.task.attemptCount = 1; if (kind === 'active-lease') { h.task.leaseOwner = 'other'; h.task.leaseExpiresAt = Date.now() + 1_000; }
    if (kind === 'cancelled') h.task.status = 'cancelled';
    expect((await executeSketchImageTask(h.admission, context, h.dependencies)).status).not.toBe('completed'); expect(h.compute).not.toHaveBeenCalled(); expect(h.claim).not.toHaveBeenCalled();
  });
  it('unknown claim result cannot be retried or refunded and does not compute', async () => {
    const h = harness(); h.claim.mockRejectedValueOnce(new Error('private-claim-ack-loss'));
    expect((await executeSketchImageTask(h.admission, context, h.dependencies)).status).toBe('deferred'); expect(h.compute).not.toHaveBeenCalled(); expect(h.claim).toHaveBeenCalledOnce();
  });
  it('publication false and late completed ACK remain deferred, never restart compute', async () => {
    const h = harness(), original = h.publish.getMockImplementation()!; h.publish.mockImplementationOnce(async value => { await original(value); return false; });
    expect((await executeSketchImageTask(h.admission, context, h.dependencies)).status).toBe('deferred'); expect(h.task.status).toBe('completed'); expect(h.compute).toHaveBeenCalledOnce();
  });
  it('receipt-only recovery claims a fresh lease and queries original remote without preparation', async () => {
    const h = harness(false); h.task.attemptCount = 1;
    h.task.result!.sketchImageExecution = { version: 1, phase: 'accepted', routing, ...response,
      receipt: { taskIds: ['remote-a'], directImageUrls: [], usedProviderId: 'image-p', usedModel: 'image-model' } };
    const identity = readSketchImageTaskIdentity(h.task);
    expect(await recoverSketchImageTask(h.task.id, identity, h.dependencies)).toEqual({ status: 'completed' });
    expect(h.compute).not.toHaveBeenCalled(); expect(h.checkpoint).not.toHaveBeenCalled(); expect(h.query).toHaveBeenCalledOnce(); expect(h.claim).toHaveBeenCalledOnce();
    expect(h.publish.mock.calls[0][0].lease.attemptCount).toBe(2);
  });
  it.each(['analysis', 'analysis-complete', 'generation', 'missing'] as const)('recovery never reconstructs an unknown %s paid request', async phase => {
    const h = harness(); h.task.attemptCount = 1;
    if (phase !== 'missing') h.task.result!.sketchImageExecution = { version: 1, phase, routing, ...(phase === 'analysis' ? {} : response) };
    expect((await recoverSketchImageTask(h.task.id, readSketchImageTaskIdentity(h.task), h.dependencies)).status).toBe('deferred');
    expect(h.claim).not.toHaveBeenCalled(); expect(h.compute).not.toHaveBeenCalled(); expect(h.query).not.toHaveBeenCalled(); expect(h.publish).not.toHaveBeenCalled();
  });
  it('pre-abort never starts a read or claim', async () => {
    const h = harness(), c = new AbortController(); c.abort();
    expect((await executeSketchImageTask(h.admission, { ...context, signal: c.signal }, h.dependencies)).status).toBe('deferred'); expect(h.read).not.toHaveBeenCalled(); expect(h.claim).not.toHaveBeenCalled();
  });
  it('keeps a hanging original read serialized, never issues a second read while it is busy', async () => {
    const h = harness(); let enter!: () => void, releaseRead!: () => void;
    const entered = new Promise<void>(r => { enter = r; });
    h.read.mockImplementationOnce(async () => { enter(); await new Promise<void>(r => { releaseRead = r; }); return structuredClone(h.task); });
    vi.useFakeTimers(); const outcome = executeSketchImageTask(h.admission, context, h.dependencies); const observed = outcome.then(value => value);
    // A callable stub has no read; release via a microtask so RED cannot hang on an unreachable latch.
    await Promise.race([entered, nextTurn()]); const didEnter = h.read.mock.calls.length === 1;
    await vi.advanceTimersByTimeAsync(5_000); if (didEnter) releaseRead();
    expect((await observed).status).toBe('deferred'); expect(h.read).toHaveBeenCalledOnce(); expect(h.claim).not.toHaveBeenCalled();
  });
  it('captures the prepared compute closure before the first await', async () => {
    const h = harness(); let enter!: () => void, releaseRead!: () => void;
    const entered = new Promise<void>(r => { enter = r; });
    h.read.mockImplementationOnce(async () => { enter(); await new Promise<void>(r => { releaseRead = r; }); return structuredClone(h.task); });
    const result = executeSketchImageTask(h.admission, context, h.dependencies); await entered;
    const replacement = vi.fn(async () => { throw new Error('mutated-compute'); }); h.admission.prepared!.compute = replacement;
    releaseRead(); expect((await result).status).toBe('completed'); expect(h.compute).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
  });
  it('does not treat the acknowledged publisher completed row as lost lease while awaiting its return', async () => {
    const h = harness(), original = h.publish.getMockImplementation()!; let enter!: () => void, releasePublisher!: () => void;
    const entered = new Promise<void>(r => { enter = r; });
    h.publish.mockImplementationOnce(async value => { await original(value); enter(); await new Promise<void>(r => { releasePublisher = r; }); return true; });
    vi.useFakeTimers(); const result = executeSketchImageTask(h.admission, context, h.dependencies); await entered;
    await vi.advanceTimersByTimeAsync(1000); releasePublisher(); expect((await result).status).toBe('completed'); expect(h.compute).toHaveBeenCalledOnce();
  });
  it.each(['accepted-timeout', 'accepted-abort', 'publisher-timeout', 'publisher-abort'] as const)('a hanging %s returns deferred while the producer remains owned until real completion', async kind => {
    const h = harness(), c = new AbortController(); let enter!: () => void, release!: () => void, settled = false, producerCompleted = false;
    const entered = new Promise<void>(r => { enter = r; });
    const waitProducer = async (): Promise<void> => { enter(); await new Promise<void>(r => { release = r; }); producerCompleted = true; };
    if (kind.startsWith('accepted')) {
      const original = h.checkpoint.getMockImplementation()!;
      h.checkpoint.mockImplementation(async value => { await original(value); if (value.phase === 'accepted') await waitProducer(); });
    } else {
      const original = h.publish.getMockImplementation()!;
      h.publish.mockImplementation(async value => { await original(value); await waitProducer(); return true; });
    }
    vi.useFakeTimers(); const result = executeSketchImageTask(h.admission, { ...context, signal: c.signal }, h.dependencies);
    void result.then(() => { settled = true; }); await entered;
    if (kind.endsWith('abort')) { c.abort(new Error('explicit-abort')); await vi.advanceTimersByTimeAsync(0); }
    else await vi.advanceTimersByTimeAsync(600_001);
    const endedAtBoundary = settled, producerEndedAtBoundary = producerCompleted; release(); const outcome = await result; await nextTurn();
    expect(endedAtBoundary).toBe(true); expect(producerEndedAtBoundary).toBe(false); expect(outcome.status).toBe('deferred');
    expect(h.events.filter(x => x === 'vision-post')).toHaveLength(1); expect(h.events.filter(x => x === 'image-post')).toHaveLength(1);
    expect(h.compute).toHaveBeenCalledOnce(); expect(h.claim).toHaveBeenCalledOnce();
    expect(h.publish).toHaveBeenCalledTimes(kind.startsWith('accepted') ? 0 : 1); expect(producerCompleted).toBe(true);
  });
});
