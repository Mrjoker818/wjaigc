import { createCanvas } from '@napi-rs/canvas';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { CreateBillableTaskInput, CreateBillableTaskResult } from '@/lib/task-core/billing-service';
import type { CloudTask } from '@/lib/cloud-task-storage';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { CreditPricingConfig } from '@/lib/credit-pricing';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import { requiresAtomicTerminalSettlement } from '@/lib/task-core/terminal-settlement';
import { SketchAdmissionError } from '@/lib/sketch-to-code/admission';
import { admitSketchImageTask, type SketchImageAdmissionDependencies } from '@/lib/sketch-to-code/image-admission';
vi.mock('server-only', () => ({}));
const input = { projectId: 'project-a', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: '海边木屋，水彩',
  visionProviderId: 'vision-p', visionModelId: 'same-model', imageProviderId: 'image-p', imageModelId: 'same-model',
  idempotencyKey: 'nonce-a', aspectRatio: '4:3' };
const vision: TaskModelDescriptor = { providerId: 'vision-p', modelId: 'same-model', kind: 'chat', sourceType: 'vlm', protocol: 'chat-completions',
  executionMode: 'sync', supportsVision: true, supportsReferenceImages: true, supportsMask: false, allowedRatios: [], allowedSizes: [],
  qualityOptions: [], maxOutputs: 1, outputKinds: ['text'], capabilitySources: {} };
const image: TaskModelDescriptor = { ...vision, providerId: 'image-p', kind: 'image', sourceType: 'image', protocol: 'images', executionMode: 'async',
  maxReferenceImages: 1, supportedOperations: ['image-to-image'], allowedRatios: ['4:3', '16:9'], allowedSizes: ['1024'], qualityOptions: ['high'], outputKinds: ['image'] };
function context(signal = new AbortController().signal): { actorUserId: string; signal: AbortSignal } { return { actorUserId: 'user-a', signal }; }
function harness(): { dep: SketchImageAdmissionDependencies; calls: CreateBillableTaskInput[]; billing: ReturnType<typeof vi.fn>;
  fence: ReturnType<typeof vi.fn>; revalidate: ReturnType<typeof vi.fn>; price: ReturnType<typeof vi.fn>; analyze: ReturnType<typeof vi.fn>; generate: ReturnType<typeof vi.fn> } {
  const calls: CreateBillableTaskInput[] = [], fence = vi.fn(async (): Promise<void> => {}), revalidate = vi.fn(async (): Promise<void> => {});
  const price = vi.fn(async (): Promise<CreditPricingConfig> => ({ modelCredits: { 'vision-p::same-model': 7, 'image-p::same-model': 11 } }));
  const analyze = vi.fn(async (): Promise<unknown> => { throw new Error('must-not-compute'); });
  const generate = vi.fn(async (): Promise<unknown> => { throw new Error('must-not-compute'); });
  const billing = vi.fn(async (value: CreateBillableTaskInput): Promise<CreateBillableTaskResult> => {
    calls.push(value); await value.beforeCharge?.({ query: vi.fn() } as unknown as PoolClient);
    const task = { ...value.task, userId: value.userId, idempotencyKey: value.idempotencyKey, requestDigest: value.requestDigest,
      revision: 0, creditCost: value.creditCost, creditStatus: value.creditCost ? 'pending' as const : 'not-applicable' as const };
    return { task, reused: false, charged: value.creditCost > 0 };
  });
  return { calls, billing, fence, revalidate, price, analyze, generate, dep: { generation: {
    authorizeProject: async (actorUserId, projectId) => ({ kind: 'personal', actorUserId, projectId, ownerId: actorUserId }),
    resolveTaskModel: async providerId => ({ ...(providerId === 'vision-p' ? vision : image), providerId }), analyze, generate },
    loadPricingConfig: price, createBillableTask: billing, assertProjectFence: fence, revalidateAccess: revalidate, readExistingTask: async () => null } };
}
describe('sketch-image durable admission seams (not database proof)', () => {
  it('uses one original billable parent, both independent quotes and the original permission hook before charging', async () => {
    const h = harness(), result = await admitSketchImageTask(input, context(), h.dep);
    expect(h.fence).toHaveBeenCalledOnce(); expect(h.billing).toHaveBeenCalledOnce(); expect(h.analyze).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled();
    expect(result.task).toMatchObject({ type: 'sketch-to-image', providerId: 'image-p', model: 'same-model', projectId: 'project-a', creditCost: 18, status: 'processing' });
    expect(result.task.id).toMatch(/^skimg_/); expect(result.task.id).not.toMatch(/^sketch_/);
    expect(result.prepared?.input).toEqual(input);
    expect(result.task.result?.sketchImageAdmission).toMatchObject({ version: 1, route: '/api/sketch-to-image', input, requestDigest: h.calls[0].requestDigest,
      pricing: { vision: { providerId: 'vision-p', modelId: 'same-model', calls: 1, reserveCredits: 7 }, image: { providerId: 'image-p', modelId: 'same-model', calls: 1, credits: 11 }, totalReserveCredits: 18 } });
    expect(h.calls[0].requestDigest).toMatch(/^[a-f0-9]{64}$/); expect(result.task.result).not.toHaveProperty('apiKey');
  });
  it('opts only the new type into original atomic terminal policy', () => {
    expect(requiresAtomicTerminalSettlement({ type: 'sketch-to-image' })).toBe(true);
    expect(requiresAtomicTerminalSettlement({ type: 'sketch' })).toBe(false);
  });
  it.each(['instruction', 'imageDataUrl', 'projectId', 'visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId', 'idempotencyKey', 'aspectRatio'] as const)
    ('rejects invalid %s before pricing or billing', async key => { const h = harness();
      const code = key === 'imageDataUrl' ? 'SKETCH_IMAGE_PNG_INVALID' : ['instruction', 'idempotencyKey', 'aspectRatio'].includes(key) ? 'SKETCH_IMAGE_INPUT_INVALID' : 'SKETCH_INPUT_INVALID';
      await expect(admitSketchImageTask({ ...input, [key]: key === 'instruction' ? '\0' : '' }, context(), h.dep)).rejects.toThrow(code);
      expect(h.price).not.toHaveBeenCalled(); expect(h.billing).not.toHaveBeenCalled(); });
  it.each(['apiKey', 'actorUserId', 'result', 'creditCost'])('rejects client financial/credential authority %s', async key => {
    const h = harness(); await expect(admitSketchImageTask({ ...input, [key]: 'secret' }, context(), h.dep)).rejects.toThrow('SKETCH_INPUT_INVALID');
    expect(h.billing).not.toHaveBeenCalled();
  });
  it('refuses revoked access inside beforeCharge', async () => { const h = harness(); h.fence.mockRejectedValue(new SketchAdmissionError('SKETCH_PROJECT_CHANGED', 403));
    await expect(admitSketchImageTask(input, context(), h.dep)).rejects.toThrow('SKETCH_PROJECT_CHANGED'); expect(h.generate).not.toHaveBeenCalled(); });
  it('freezes original input/access/pricing before the original billing await', async () => { const h = harness(), mutable = { ...input };
    h.billing.mockImplementationOnce(async (v: CreateBillableTaskInput): Promise<CreateBillableTaskResult> => {
      mutable.instruction = 'changed'; expect(Object.isFrozen(v.task.result?.sketchImageAdmission)).toBe(true);
      expect(Object.isFrozen((v.task.result?.sketchImageAdmission as { input: object }).input)).toBe(true);
      expect((v.task.result?.sketchImageAdmission as { input: typeof input }).input.instruction).toBe(input.instruction);
      const task = { ...v.task, userId: v.userId, idempotencyKey: v.idempotencyKey, requestDigest: v.requestDigest, revision: 0, creditCost: v.creditCost, creditStatus: 'pending' as const };
      return { task, reused: false, charged: true };
    }); expect((await admitSketchImageTask(mutable, context(), h.dep)).prepared?.input.instruction).toBe(input.instruction); });
  it.each(['outage', 'invalid', 'token'] as const)('replays existing frozen quote before current pricing %s with zero second admission', async changed => {
    const h = harness(), first = await admitSketchImageTask(input, context(), h.dep);
    h.dep.readExistingTask = async () => first.task as CloudTask;
    h.price.mockImplementation(async () => { if (changed === 'outage') throw new Error('private-db-outage');
      return { modelCredits: { 'vision-p::same-model': changed === 'invalid' ? -1 : 99, 'image-p::same-model': 90 } }; });
    h.price.mockClear(); const replay = await admitSketchImageTask(input, context(), h.dep);
    expect(replay).toMatchObject({ reused: true, charged: false, task: { id: first.task.id, creditCost: 18 } }); expect(replay.prepared).toBeUndefined();
    expect(h.price).not.toHaveBeenCalled(); expect(h.billing).toHaveBeenCalledOnce(); expect(h.revalidate).toHaveBeenCalledOnce();
  });
  it('checks the original transactional reused result as well as the pre-read replay', async () => {
    const h = harness(), first = await admitSketchImageTask(input, context(), h.dep); h.billing.mockResolvedValueOnce({ ...first, reused: true, charged: false });
    expect((await admitSketchImageTask(input, context(), h.dep)).prepared).toBeUndefined(); expect(h.revalidate).toHaveBeenCalledOnce();
  });
  it.each(['visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId', 'instruction', 'imageDataUrl', 'aspectRatio', 'size', 'quality'] as const)
    ('semantic digest changes for %s but nonce retry is excluded', async key => { const h = harness(); await admitSketchImageTask(input, context(), h.dep);
      const first = h.calls[0].requestDigest;
      const changed = key === 'imageDataUrl' ? createCanvas(9, 8).toDataURL('image/png') : key === 'aspectRatio' ? '16:9' : key === 'size' ? '1024' : key === 'quality' ? 'high' : 'different';
      h.dep.generation.resolveTaskModel = async (providerId, modelId) => ({ ...(providerId === input.visionProviderId || providerId === 'different' && key.startsWith('vision') ? vision : image), providerId, modelId });
      await admitSketchImageTask({ ...input, [key]: changed }, context(), h.dep); expect(h.calls.at(-1)?.requestDigest).not.toBe(first);
      await admitSketchImageTask({ ...input, idempotencyKey: 'other-nonce' }, context(), h.dep); expect(h.calls.at(-1)?.requestDigest).toBe(first); });
  it.each(['type', 'actor', 'project', 'image-binding', 'vision-binding', 'quote', 'input', 'access', 'digest', 'nonce'] as const)
    ('rejects polluted original task %s without second billing or provider work', async kind => {
      const h = harness(), first = await admitSketchImageTask(input, context(), h.dep), task = structuredClone(first.task);
      const meta = task.result!.sketchImageAdmission as { input: typeof input; access: { ownerId: string }; pricing: { totalReserveCredits: number } };
      if (kind === 'type') task.type = 'sketch-to-code'; if (kind === 'actor') task.userId = 'other'; if (kind === 'project') task.projectId = 'other';
      if (kind === 'image-binding') task.providerId = 'other'; if (kind === 'vision-binding') meta.input.visionProviderId = 'other';
      if (kind === 'quote') meta.pricing.totalReserveCredits = 999; if (kind === 'input') meta.input.instruction = 'different';
      if (kind === 'access') meta.access.ownerId = 'other'; if (kind === 'digest') (task as CloudTask).requestDigest = 'f'.repeat(64); if (kind === 'nonce') task.idempotencyKey = 'other';
      h.dep.readExistingTask = async () => task as CloudTask;
      await expect(admitSketchImageTask(input, context(), h.dep)).rejects.toThrow(); expect(h.billing).toHaveBeenCalledOnce(); expect(h.generate).not.toHaveBeenCalled();
    });
  it('keeps both explicitly free stages free without a paid task', async () => { const h = harness(); h.price.mockResolvedValueOnce({ modelCredits: { 'vision-p::same-model': 0, 'image-p::same-model': 0 } });
    const result = await admitSketchImageTask(input, context(), h.dep); expect(result.charged).toBe(false); expect(result.task.creditCost).toBe(0); });
  it('keeps original conflicts and lost commit acknowledgement without refund or resubmission', async () => {
    const h = harness(), conflict = new IdempotencyConflictError({ userId: 'user-a', idempotencyKey: 'nonce-a', requestDigest: 'next', existingDigest: 'old' });
    h.billing.mockRejectedValueOnce(conflict); await expect(admitSketchImageTask(input, context(), h.dep)).rejects.toBe(conflict);
    h.billing.mockRejectedValueOnce(new Error('postgres://secret commit-ack-lost')); await expect(admitSketchImageTask(input, context(), h.dep)).rejects.toThrow('SKETCH_TASK_UNAVAILABLE');
    expect(h.billing).toHaveBeenCalledTimes(2); expect(h.generate).not.toHaveBeenCalled();
  });
  it('preserves cancellation after pricing and again after the exact original permission hook', async () => {
    const h = harness(), c = new AbortController(), reason = new Error('cancel-before-charge');
    h.price.mockImplementationOnce(async () => { c.abort(reason); return { modelCredits: {} }; });
    await expect(admitSketchImageTask(input, context(c.signal), h.dep)).rejects.toBe(reason); expect(h.billing).not.toHaveBeenCalled();
    const h2 = harness(), c2 = new AbortController(); h2.fence.mockImplementationOnce(async () => { c2.abort(reason); });
    await expect(admitSketchImageTask(input, context(c2.signal), h2.dep)).rejects.toBe(reason); expect(h2.generate).not.toHaveBeenCalled();
  });
  it.each(['input', 'access'] as const)('never invokes a stored %s accessor during replay', async key => {
    const h = harness(), first = await admitSketchImageTask(input, context(), h.dep), task = structuredClone(first.task); let reads = 0;
    const meta = task.result!.sketchImageAdmission as Record<string, object>;
    Object.defineProperty(meta[key], key === 'input' ? 'instruction' : 'ownerId', { enumerable: true, get: () => { reads++; return 'private'; } });
    h.dep.readExistingTask = async () => task as CloudTask;
    await expect(admitSketchImageTask(input, context(), h.dep)).rejects.toThrow('SKETCH_PROJECT_CHANGED'); expect(reads).toBe(0); expect(h.billing).toHaveBeenCalledOnce();
  });
  it.each([NaN, -1, 100_001])('rejects unsafe image price %s before billing', async price => {
    const h = harness(); h.price.mockResolvedValueOnce({ modelCredits: { 'vision-p::same-model': 7, 'image-p::same-model': price } });
    await expect(admitSketchImageTask(input, context(), h.dep)).rejects.toThrow('SKETCH_IMAGE_PRICING_INVALID'); expect(h.billing).not.toHaveBeenCalled();
  });
  it('reserves one vision token minimum plus exactly one selected image quote', async () => {
    const h = harness(); h.price.mockResolvedValueOnce({ modelCredits: { 'vision-p::same-model': { credits: 0, tokenPricing: { input: 10, output: 20 } }, 'image-p::same-model': 11 } });
    const result = await admitSketchImageTask(input, context(), h.dep); expect(result.task.creditCost).toBe(12);
    expect(result.task.result?.sketchImageAdmission).toMatchObject({ pricing: { vision: { mode: 'token', calls: 1, reserveCredits: 1 }, image: { calls: 1, credits: 11 } } });
  });
  it('empty optional keywords keep the valid sketch and never start provider work during admission', async () => {
    const h = harness(), result = await admitSketchImageTask({ ...input, instruction: '' }, context(), h.dep);
    expect(result.prepared?.input.instruction).toBe(''); expect(h.analyze).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled();
  });
  it('an unknown original nonce read fails closed before a second billable attempt', async () => {
    const h = harness(); h.dep.readExistingTask = async () => { throw new Error('postgres://secret'); };
    await expect(admitSketchImageTask(input, context(), h.dep)).rejects.toThrow('SKETCH_TASK_UNAVAILABLE'); expect(h.billing).not.toHaveBeenCalled(); expect(h.price).not.toHaveBeenCalled();
  });
});
