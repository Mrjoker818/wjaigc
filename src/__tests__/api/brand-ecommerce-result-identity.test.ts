import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  workers: [] as Array<() => Promise<void>>,
  updates: vi.fn(),
  cached: vi.fn(),
  submit: vi.fn(),
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  consumeCredits: vi.fn(),
  calculateCreditCost: vi.fn(),
  createBillableTask: vi.fn(),
  completeCloudTask: vi.fn(),
  updateCloudTask: vi.fn(),
  settleFailedTask: vi.fn(),
  registerTask: vi.fn(),
  cancelled: false,
  provider: { id: 'resolved-provider', name: 'Provider internal', displayName: 'Verified Provider', baseUrl: 'https://provider.example/v1', apiKey: 'local-test-key', isEnabled: true, modelType: 'image', selectedModels: ['gpt-image-2'], discoveredModels: [] },
}));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), after: (worker: () => Promise<void>) => state.workers.push(worker) }));
vi.mock('@/lib/server-api-config', () => ({ findProviderById: state.findProviderById, findProviderForModel: state.findProviderForModel, getPublicModels: vi.fn() }));
vi.mock('@/lib/api-compatibility', () => ({
  resolveCompatProfile: vi.fn(() => ({})),
  adjustRequestForProfile: (body: unknown) => ({ body, endpoint: '/images/generations' }),
  parseResponseForProfile: (data: unknown) => data,
  buildPollUrl: () => 'https://provider.example/tasks/remote-test',
  extractImageUrl: (data: { url?: string }) => data.url,
}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: state.submit, getInternalApiUrl: (path: string) => path }));
vi.mock('@/lib/api-auth', () => ({ getInternalRequestHeaders: vi.fn(async () => ({})) }));
vi.mock('@/lib/task-registry', () => ({ registerTask: state.registerTask, updateTaskProgress: state.updates, isTaskCancelled: vi.fn(() => state.cancelled) }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: vi.fn(async () => ({ id: 'test-user' })) }));
vi.mock('@/lib/credits', () => ({
  consumeCredits: state.consumeCredits,
  refundCredits: vi.fn(),
  calculateConfiguredCreditCost: state.calculateCreditCost,
}));
vi.mock('@/lib/task-core/billing-service', () => ({
  createBillableTask: state.createBillableTask,
  settleFailedTask: state.settleFailedTask,
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  completeCloudTask: state.completeCloudTask,
  updateCloudTask: state.updateCloudTask,
}));
vi.mock('@/lib/db-storage', () => ({ dbGetEcomTemplate: vi.fn(async () => null) }));
vi.mock('@/lib/op-log', () => ({ logOperation: vi.fn(), logError: vi.fn(), OP_ACTIONS: {}, startTimer: vi.fn() }));
vi.mock('@/app/api/brand-ecommerce/result-store', () => ({ setBrandResult: state.cached }));
import { POST } from '@/app/api/brand-ecommerce/route';

describe('brand ecommerce server result identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.workers.length = 0;
    state.provider.selectedModels = ['gpt-image-2'];
    state.findProviderById.mockResolvedValue(state.provider);
    state.findProviderForModel.mockResolvedValue(state.provider);
    state.consumeCredits.mockResolvedValue({ success: true, cost: 60 });
    state.calculateCreditCost.mockResolvedValue(60);
    state.createBillableTask.mockImplementation(async input => ({
      task: { ...input.task, userId: input.userId, creditCost: input.creditCost, creditStatus: 'pending', revision: 0 },
      reused: false,
      charged: true,
    }));
    state.completeCloudTask.mockResolvedValue(true);
    state.updateCloudTask.mockResolvedValue(true);
    state.settleFailedTask.mockResolvedValue({ transitioned: true, refunded: true });
    state.cancelled = false;
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function start(): Promise<void> {
    const response = await POST(new NextRequest('http://localhost/api/brand-ecommerce', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', templateIds: ['white-bg'], productDesc: 'Local test cup', model: 'gpt-image-2', providerId: 'requested-alias', providerName: 'Untrusted client label', variantCount: 2 }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, taskId: expect.stringMatching(/^ecom-/) });
    expect(state.workers).toHaveLength(1);
  }
  function assertIdentity(): void {
    expect(state.cached).toHaveBeenCalledTimes(1);
    const result = state.cached.mock.calls[0][1] as { results: Array<Record<string, unknown>> };
    expect(result.results).toHaveLength(2);
    for (const row of result.results) expect(row).toMatchObject({ providerId: 'resolved-provider', providerName: 'Verified Provider', modelName: 'gpt-image-2' });
    const partials = state.updates.mock.calls.map(call => call[1] as { partialResults?: Array<Record<string, unknown>> }).filter(update => update.partialResults);
    expect(partials.length).toBeGreaterThan(0);
    expect(partials[0].partialResults![0]).toMatchObject(result.results[0]);
    const requestBody = JSON.parse(state.submit.mock.calls[0][2].body as string) as Record<string, unknown>;
    expect(requestBody.model).toBe(result.results[0].modelName);
  }

  it('preserves resolved identity in partial, final and cached direct-image results', async () => {
    state.submit.mockImplementation(async () => Response.json({ directImageUrls: ['/api/serve-upload/direct.png'] }));
    await start();
    await state.workers[0]();
    assertIdentity();
    expect(state.createBillableTask).toHaveBeenCalledTimes(1);
    expect(state.completeCloudTask).toHaveBeenCalledTimes(1);
    expect(state.completeCloudTask.mock.invocationCallOrder[0]).toBeLessThan(state.cached.mock.invocationCallOrder[0]);
    expect(state.settleFailedTask).not.toHaveBeenCalled();
  });

  it('preserves the same identity for asynchronous upstream task results', async () => {
    state.submit.mockImplementation(async () => Response.json({ taskIds: ['remote-test'] }));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'completed', url: '/api/serve-upload/async.png' })));
    await start();
    const worker = state.workers[0]();
    await vi.advanceTimersByTimeAsync(7000);
    await worker;
    assertIdentity();
  });

  it('atomically settles and refunds a background task when every generated variant fails', async () => {
    state.submit.mockResolvedValue(new Response('provider unavailable', { status: 503 }));

    await start();
    await state.workers[0]();

    expect(state.settleFailedTask).toHaveBeenCalledTimes(1);
    expect(state.settleFailedTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: expect.stringMatching(/^ecom-/),
      status: 'failed',
      error: expect.objectContaining({ code: 'ALL_VARIANTS_FAILED' }),
    }));
    expect(state.completeCloudTask).not.toHaveBeenCalled();
    expect(state.cached).not.toHaveBeenCalled();
  });

  it('settles cancellation durably instead of projecting a completed task', async () => {
    state.cancelled = true;

    await start();
    await state.workers[0]();

    expect(state.settleFailedTask).toHaveBeenCalledTimes(1);
    expect(state.settleFailedTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: expect.stringMatching(/^ecom-/),
      status: 'cancelled',
      error: expect.objectContaining({ code: 'USER_CANCELLED' }),
    }));
    expect(state.completeCloudTask).not.toHaveBeenCalled();
    expect(state.cached).not.toHaveBeenCalled();
  });

  it('reuses one durable task for the same user idempotency key without scheduling a second worker', async () => {
    let persistedTask: Record<string, unknown> | undefined;
    state.createBillableTask.mockImplementation(async input => {
      if (!persistedTask) {
        persistedTask = {
          ...input.task, userId: input.userId, creditCost: input.creditCost,
          creditStatus: 'pending', revision: 0,
        };
        return { task: persistedTask, reused: false, charged: true };
      }
      return { task: persistedTask, reused: true, charged: false };
    });
    const body = {
      action: 'generate', templateIds: ['white-bg'], productDesc: 'Idempotent cup',
      model: 'gpt-image-2', providerId: 'requested-alias', variantCount: 1,
    };
    const submit = () => POST(new NextRequest('http://localhost/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'brand-click-1' },
      body: JSON.stringify(body),
    }));

    const first = await submit();
    const firstPayload = await first.json();
    const second = await submit();
    const secondPayload = await second.json();

    expect(firstPayload.taskId).toBe(secondPayload.taskId);
    expect(secondPayload).toMatchObject({ reused: true });
    expect(state.workers).toHaveLength(1);
    expect(state.registerTask).toHaveBeenCalledTimes(1);
    expect(state.createBillableTask.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      'brand-click-1', 'brand-click-1',
    ]);
    expect(state.createBillableTask.mock.calls[0][0].requestDigest).toBe(
      state.createBillableTask.mock.calls[1][0].requestDigest,
    );
  });

  it('binds template text and the original model identity into the idempotency digest', async () => {
    state.provider.selectedModels = ['gpt-image-2', 'gpt-image-2-4k'];
    const submit = (mainText: string, model: string) => POST(new NextRequest('http://localhost/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'brand-digest-1' },
      body: JSON.stringify({
        action: 'generate', templateIds: ['white-bg'], productDesc: 'Digest cup',
        mainText, model, providerId: 'requested-alias', variantCount: 1,
      }),
    }));

    await submit('版本甲', 'gpt-image-2');
    await submit('版本乙', 'gpt-image-2');
    await submit('版本乙', 'gpt-image-2-4k');

    const digests = state.createBillableTask.mock.calls.map(([input]) => input.requestDigest);
    expect(new Set(digests).size).toBe(3);
  });

  it('reports an oversized idempotency key as a client error', async () => {
    const response = await POST(new NextRequest('http://localhost/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'x'.repeat(257) },
      body: JSON.stringify({
        action: 'generate', templateIds: ['white-bg'], productDesc: 'Local test cup',
        model: 'gpt-image-2', providerId: 'requested-alias', variantCount: 1,
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false });
    expect(state.workers).toHaveLength(0);
  });

  it.each([
    ['missing provider', null, 'gpt-image-2'],
    ['model outside provider catalog', state.provider, 'other-image-model'],
  ])('rejects an explicit provider/model mismatch before task creation or billing: %s', async (_label, resolvedProvider, model) => {
    state.findProviderById.mockResolvedValueOnce(resolvedProvider);

    const response = await POST(new NextRequest('http://localhost/api/brand-ecommerce', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generate', templateIds: ['white-bg'], productDesc: 'Local test cup',
        model, providerId: 'requested-provider', variantCount: 1,
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'MODEL_PROVIDER_MISMATCH',
      providerId: 'requested-provider',
      model,
    });
    expect(state.findProviderForModel).not.toHaveBeenCalled();
    expect(state.consumeCredits).not.toHaveBeenCalled();
    expect(state.registerTask).not.toHaveBeenCalled();
    expect(state.workers).toHaveLength(0);
  });
});
