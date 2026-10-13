import { createCanvas } from '@napi-rs/canvas';
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import type { CreateBillableTaskInput, CreateBillableTaskResult } from '@/lib/task-core/billing-service';
import type { SketchGenerationDependencies } from '@/lib/sketch-to-code/generation';
import { admitSketchTask, SketchAdmissionError, type SketchAdmissionDependencies } from '@/lib/sketch-to-code/admission';
import { requiresAtomicTerminalSettlement } from '@/lib/task-core/terminal-settlement';
import type { CloudTask } from '@/lib/cloud-task-storage';

vi.mock('server-only', () => ({}));
const pricingDatabase = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), execSql: vi.fn() }));
vi.mock('@/lib/db-client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/db-client')>(),
  getPool: () => ({ connect: async () => ({ query: pricingDatabase.query, release: pricingDatabase.release }) }),
  execSql: pricingDatabase.execSql,
}));
beforeEach(() => { pricingDatabase.query.mockReset(); pricingDatabase.release.mockReset(); pricingDatabase.execSql.mockReset(); });
const input = { projectId: 'project-a', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: '还原草图', providerId: 'p1', modelId: 'vision-1', idempotencyKey: 'nonce-1' };
const context = (): { actorUserId: string; signal: AbortSignal } => ({ actorUserId: 'user-a', signal: new AbortController().signal });
function harness(): { dep: SketchAdmissionDependencies; billing: ReturnType<typeof vi.fn>; fence: ReturnType<typeof vi.fn>; revalidate: ReturnType<typeof vi.fn>; analysis: ReturnType<typeof vi.fn>; calls: CreateBillableTaskInput[] } {
  const calls: CreateBillableTaskInput[] = [];
  const analysis = vi.fn(async (): Promise<string> => JSON.stringify({ summary: '登录', layout: '垂直', controls: [], text: [] }));
  const generation: SketchGenerationDependencies = {
    authorizeProject: async (actorUserId, projectId) => ({ kind: 'personal', actorUserId, ownerId: actorUserId, projectId }),
    resolveTaskModel: async (providerId, modelId) => ({ providerId, modelId, kind: 'chat', sourceType: 'vlm', protocol: 'chat-completions', executionMode: 'sync', supportsVision: true, supportsMask: false, supportsReferenceImages: true, allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, outputKinds: ['text'], capabilitySources: {} }),
    analyze: analysis, reconstruct: async () => JSON.stringify({ type: 'text', text: '欢迎' }),
  };
  const fence = vi.fn(async (): Promise<void> => {});
  const revalidate = vi.fn(async (): Promise<void> => {});
  const billing = vi.fn(async (value: CreateBillableTaskInput): Promise<CreateBillableTaskResult> => {
    calls.push(value);
    await value.beforeCharge?.({ query: vi.fn() } as unknown as PoolClient);
    return { task: { ...value.task, userId: value.userId, creditStatus: 'pending', creditCost: value.creditCost, idempotencyKey: value.idempotencyKey, revision: 0 }, reused: false, charged: value.creditCost > 0 };
  });
  return { calls, fence, revalidate, billing, analysis, dep: { generation, loadPricingConfig: async () => ({ modelCredits: { 'vision-1': 99, 'p1::vision-1': 7 } }), createBillableTask: billing, assertProjectFence: fence, revalidateAccess: revalidate,
    readExistingTask: async () => null } };
}

describe('sketch durable admission (billing seams are not database proof)', () => {
  it.each(['token', 'outage', 'invalid-price'] as const)('replays the original charged task before current %s pricing without another billing attempt', async changed => {
    const h = harness(); const first = await admitSketchTask(input, context(), h.dep);
    h.dep.readExistingTask = async () => ({ ...first.task, requestDigest: h.calls[0].requestDigest } as CloudTask);
    const pricing = vi.fn(async () => {
      if (changed === 'outage') throw new Error('private-db-unavailable');
      return { modelCredits: { 'p1::vision-1': changed === 'token' ? { credits: 7, tokenPricing: { input: 10, output: 20 } } : -1 } };
    }); h.dep.loadPricingConfig = pricing;
    const result = await admitSketchTask(input, context(), h.dep);
    expect(result.task.id).toBe(first.task.id); expect(result.task.creditCost).toBe(14); expect(result.prepared).toBeUndefined();
    expect(result.reused).toBe(true); expect(result.charged).toBe(false);
    expect(pricing).not.toHaveBeenCalled(); expect(h.billing).toHaveBeenCalledOnce(); expect(h.revalidate).toHaveBeenCalledOnce();
  });
  it('does not treat a failed default pricing database read as an absent configuration', async () => {
    const h = harness(); delete h.dep.loadPricingConfig;
    pricingDatabase.query.mockRejectedValueOnce(new Error('private-db-secret outage'));
    pricingDatabase.execSql.mockRejectedValueOnce(new Error('private-db-secret outage'));
    await expect(admitSketchTask(input, context(), h.dep)).rejects.toThrow('SKETCH_PRICING_INVALID');
    expect(h.billing).not.toHaveBeenCalled(); expect(h.analysis).not.toHaveBeenCalled();
  });
  it.each(['{broken-json', JSON.stringify({ modelCredits: { 'p1::vision-1': { credits: 7, tokenPricing: { input: 'invalid', output: 20 } } } }), JSON.stringify({ unrelated: true })])('does not silently parse malformed stored pricing as a free/default model', async value => {
    const h = harness(); delete h.dep.loadPricingConfig;
    pricingDatabase.query.mockResolvedValueOnce({ rows: [{ value }] }); pricingDatabase.execSql.mockResolvedValueOnce({ rows: [{ value }] });
    await expect(admitSketchTask(input, context(), h.dep)).rejects.toThrow('SKETCH_PRICING_INVALID');
    expect(h.billing).not.toHaveBeenCalled();
  });
  it('allows a successfully missing default pricing row through the original fallback policy', async () => {
    const h = harness(); delete h.dep.loadPricingConfig;
    pricingDatabase.query.mockResolvedValueOnce({ rows: [] }); pricingDatabase.execSql.mockResolvedValueOnce({ rows: [] });
    await admitSketchTask(input, context(), h.dep);
    expect(h.billing).toHaveBeenCalledOnce();
  });
  it('opts the new durable type into the existing atomic cancellation/refund policy', () => {
    expect(requiresAtomicTerminalSettlement({ type: 'sketch-to-code' })).toBe(true);
    expect(requiresAtomicTerminalSettlement({ type: 'sketch' })).toBe(false);
    expect(requiresAtomicTerminalSettlement({ type: 'image-edit' })).toBe(false);
  });
  it('admits only after full preparation, uses the original transaction hook and never starts provider work', async () => {
    const h = harness();
    const result = await admitSketchTask(input, context(), h.dep);
    expect(h.analysis).not.toHaveBeenCalled();
    expect(h.fence).toHaveBeenCalledOnce();
    expect(result.task).toMatchObject({ type: 'sketch-to-code', projectId: 'project-a', providerId: 'p1', model: 'vision-1', status: 'processing', creditCost: 14 });
    expect(result.prepared?.binding).toEqual({ providerId: 'p1', modelId: 'vision-1' });
    expect(result.task.result?.sketchAdmission).toMatchObject({ version: 1, route: '/api/sketch-to-code', requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/), pricing: { calls: 2, perCallCredits: 7, totalCredits: 14 } });
    expect(JSON.stringify(result.task.result)).not.toContain(input.imageDataUrl);
    expect(h.calls[0].requestDigest).toBe((result.task.result?.sketchAdmission as { requestDigest: string }).requestDigest);
    expect(h.calls[0].userId).toBe('user-a');
  });
  it.each(['imageDataUrl', 'projectId', 'providerId', 'modelId', 'idempotencyKey'] as const)('rejects invalid %s without pricing, billing or provider work', async field => {
    const h = harness(); const price = vi.fn(h.dep.loadPricingConfig!); h.dep.loadPricingConfig = price;
    await expect(admitSketchTask({ ...input, [field]: field === 'imageDataUrl' ? 'data:image/png;base64,bm90IGEgcG5n' : '' }, context(), h.dep)).rejects.not.toThrow('SKETCH_ADMISSION_NOT_IMPLEMENTED');
    expect(price).not.toHaveBeenCalled(); expect(h.billing).not.toHaveBeenCalled(); expect(h.analysis).not.toHaveBeenCalled();
  });
  it('rejects client credentials and actor identity before billing', async () => {
    const h = harness();
    for (const extra of [{ apiKey: 'private-key' }, { actorUserId: 'other-user' }]) await expect(admitSketchTask({ ...input, ...extra }, context(), h.dep)).rejects.toThrow('SKETCH_INPUT_INVALID');
    expect(h.billing).not.toHaveBeenCalled();
  });
  it('rejects revoked access in beforeCharge and does not start compute', async () => {
    const h = harness(); h.fence.mockRejectedValueOnce(new SketchAdmissionError('SKETCH_PROJECT_CHANGED', 403));
    await expect(admitSketchTask(input, context(), h.dep)).rejects.toThrow('SKETCH_PROJECT_CHANGED');
    expect(h.analysis).not.toHaveBeenCalled();
  });
  it('replays the original task and frozen price without returning a second compute closure', async () => {
    const h = harness(); const first = await admitSketchTask(input, context(), h.dep);
    h.billing.mockResolvedValueOnce({ ...first, reused: true, charged: false });
    h.dep.loadPricingConfig = async () => ({ modelCredits: { 'p1::vision-1': 42 } });
    const replay = await admitSketchTask(input, context(), h.dep);
    expect(replay.task.id).toBe(first.task.id); expect(replay.task.creditCost).toBe(14);
    expect(replay.prepared).toBeUndefined(); expect(h.revalidate).toHaveBeenCalledOnce(); expect(h.analysis).not.toHaveBeenCalled();
    expect(h.calls[0].requestDigest).toBe((replay.task.result?.sketchAdmission as { requestDigest: string }).requestDigest);
  });
  it('rejects replay if current access no longer matches the originally frozen scope', async () => {
    const h = harness(); const first = await admitSketchTask(input, context(), h.dep);
    h.billing.mockResolvedValueOnce({ ...first, task: { ...first.task, result: { ...first.task.result, sketchAdmission: { ...(first.task.result?.sketchAdmission as object), access: { kind: 'document', actorUserId: 'user-a', projectId: 'project-a', ownerId: 'owner', grantGeneration: '1' } } } }, reused: true, charged: false });
    await expect(admitSketchTask(input, context(), h.dep)).rejects.toThrow('SKETCH_PROJECT_CHANGED');
    expect(h.analysis).not.toHaveBeenCalled();
  });
  it('preserves the original idempotency conflict and never retries admission', async () => {
    const h = harness(); const conflict = new IdempotencyConflictError({ userId: 'user-a', idempotencyKey: 'nonce-1', requestDigest: 'next', existingDigest: 'old' });
    h.billing.mockRejectedValueOnce(conflict);
    await expect(admitSketchTask(input, context(), h.dep)).rejects.toBe(conflict);
    expect(h.billing).toHaveBeenCalledOnce();
  });
  it.each([NaN, Infinity, -1, 1.5, 100_001])('rejects an invalid price %s before billing', async price => {
    const h = harness(); h.dep.loadPricingConfig = async () => ({ modelCredits: { 'p1::vision-1': price } });
    await expect(admitSketchTask(input, context(), h.dep)).rejects.toThrow('SKETCH_PRICING_INVALID');
    expect(h.billing).not.toHaveBeenCalled();
  });
  it('does not silently replace configured token pricing with per-call billing', async () => {
    const h = harness(); h.dep.loadPricingConfig = async () => ({ modelCredits: { 'p1::vision-1': { credits: 7, tokenPricing: { input: 10, output: 20 } } } });
    const admitted = await admitSketchTask(input, context(), h.dep);
    expect(admitted.task.creditCost).toBe(14);
    expect(admitted.task.result?.sketchAdmission).toHaveProperty('pricing', { mode: 'token', calls: 2, perCallCredits: 7, totalCredits: 14, tokenPricing: { input: 10, output: 20 } });
    expect(h.analysis).not.toHaveBeenCalled();
  });
  it('Token base0 reserves1 and freezes both rates independently of caller mutations', async () => {
    const h = harness(); const config = { modelCredits: { 'p1::vision-1': { credits: 0, tokenPricing: { input: 10, output: 20 } } } };
    h.dep.loadPricingConfig = async () => config;
    const admitted = await admitSketchTask(input, context(), h.dep);
    config.modelCredits['p1::vision-1'].tokenPricing.input = 99;
    expect(admitted.task.creditCost).toBe(1);
    expect(admitted.task.result?.sketchAdmission).toHaveProperty('pricing', { mode: 'token', calls: 2, perCallCredits: 0, totalCredits: 1, tokenPricing: { input: 10, output: 20 } });
    expect(h.analysis).not.toHaveBeenCalled();
  });
  it.each(['getter', 'prototype', 'extra', 'string'] as const)('rejects original Token pricing %s before billing without invoking accessors', async variant => {
    const h = harness(); const rate = { input: 10, output: 20 }; let invoked = 0;
    if (variant === 'getter') Object.defineProperty(rate, 'input', { get: () => { invoked++; return 10; } });
    if (variant === 'prototype') Object.setPrototypeOf(rate, { inherited: 1 });
    if (variant === 'extra') Object.assign(rate, { perToken: true });
    if (variant === 'string') Object.assign(rate, { input: '10' });
    h.dep.loadPricingConfig = async () => ({ modelCredits: { 'p1::vision-1': { credits: 7, tokenPricing: rate } } });
    await expect(admitSketchTask(input, context(), h.dep)).rejects.toThrow('SKETCH_PRICING_INVALID');
    expect(invoked).toBe(0); expect(h.billing).not.toHaveBeenCalled();
  });
  it('keeps an explicitly configured free model free without creating a paid task', async () => {
    const h = harness(); h.dep.loadPricingConfig = async () => ({ modelCredits: { 'p1::vision-1': 0 } });
    const result = await admitSketchTask(input, context(), h.dep);
    expect(result.task.creditCost).toBe(0); expect(result.charged).toBe(false);
  });
  it('does not treat an unknown database admission outcome as a failed paid task', async () => {
    const h = harness(); h.billing.mockRejectedValueOnce(new Error('postgres://private-secret commit response lost'));
    await expect(admitSketchTask(input, context(), h.dep)).rejects.toThrow('SKETCH_TASK_UNAVAILABLE');
    expect(h.billing).toHaveBeenCalledOnce(); expect(h.analysis).not.toHaveBeenCalled();
  });
  it('checks abort after pricing and again inside the original billing transaction', async () => {
    const h = harness(); const controller = new AbortController(); const error = new Error('cancel-before-charge');
    h.dep.loadPricingConfig = async () => { controller.abort(error); return { modelCredits: {} }; };
    await expect(admitSketchTask(input, { actorUserId: 'user-a', signal: controller.signal }, h.dep)).rejects.toBe(error);
    expect(h.billing).not.toHaveBeenCalled();
    const h2 = harness(); const c2 = new AbortController(); h2.fence.mockImplementationOnce(async (): Promise<void> => { c2.abort(error); });
    await expect(admitSketchTask(input, { actorUserId: 'user-a', signal: c2.signal }, h2.dep)).rejects.toBe(error);
    expect(h2.analysis).not.toHaveBeenCalled();
  });
  it('uses distinct digests for any changed semantic input but not a changed retry nonce', async () => {
    const h = harness(); await admitSketchTask(input, context(), h.dep); const digest = h.calls[0].requestDigest;
    for (const extra of [{ instruction: 'changed' }, { projectId: 'project-b' }, { providerId: 'p2' }, { modelId: 'vision-2' }, { imageDataUrl: createCanvas(9, 8).toDataURL('image/png') }]) {
      await admitSketchTask({ ...input, ...extra }, context(), h.dep); expect(h.calls.at(-1)?.requestDigest).not.toBe(digest);
    }
    await admitSketchTask({ ...input, idempotencyKey: 'nonce-2' }, context(), h.dep); expect(h.calls.at(-1)?.requestDigest).toBe(digest);
  });
});
