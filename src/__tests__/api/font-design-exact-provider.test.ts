import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  workers: [] as Array<() => Promise<void>>,
  providers: [] as Array<Record<string, unknown>>,
  submit: vi.fn(),
  consumeCredits: vi.fn(),
  refundCredits: vi.fn(),
  calculateCreditCost: vi.fn(),
  createBillableTask: vi.fn(),
  completeCloudTask: vi.fn(),
  updateCloudTask: vi.fn(),
  settleFailedTask: vi.fn(),
  registerTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  setResult: vi.fn(),
  cancelled: false,
}));

vi.mock('next/server', async importOriginal => ({
  ...await importOriginal<typeof import('next/server')>(),
  after: (worker: () => Promise<void>) => state.workers.push(worker),
}));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: vi.fn(async () => state.providers),
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: state.submit }));
vi.mock('@/lib/api-compatibility', () => ({
  resolveCompatProfile: vi.fn(() => ({ id: 'openai' })),
  adjustRequestForProfile: (body: unknown) => ({ body, endpoint: '/images/generations' }),
  parseResponseForProfile: (body: unknown) => body,
  tryChatCompletionsImageFallback: vi.fn(async () => null),
  isChannelUnavailableError: vi.fn(() => false),
}));
vi.mock('@/lib/persist-result-image', () => ({ persistResultImage: vi.fn(async (url: string) => url) }));
vi.mock('@/lib/task-registry', () => ({
  registerTask: state.registerTask,
  updateTaskProgress: state.updateTaskProgress,
  isTaskCancelled: vi.fn(() => state.cancelled),
  getTaskInfo: vi.fn(),
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: vi.fn(async () => ({ id: 'font-user' })) }));
vi.mock('@/lib/credits', () => ({
  consumeCredits: state.consumeCredits,
  refundCredits: state.refundCredits,
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
vi.mock('@/lib/op-log', () => ({ logOperation: vi.fn(), logError: vi.fn(), OP_ACTIONS: {}, startTimer: vi.fn() }));
vi.mock('@/lib/font-design-task-store', () => ({ setFontDesignResult: state.setResult }));

import { POST } from '@/app/api/font-design/generate-image/route';

const selectedProvider = {
  id: 'selected-provider', name: 'Selected provider', displayName: 'Selected provider',
  baseUrl: 'https://selected.example/v1', apiKey: 'selected-key', isEnabled: true,
  modelType: 'image', selectedModels: ['gpt-image-2'], discoveredModels: [],
};
const fallbackProvider = {
  id: 'fallback-provider', name: 'Fallback provider', displayName: 'Fallback provider',
  baseUrl: 'https://fallback.example/v1', apiKey: 'fallback-key', isEnabled: true,
  modelType: 'image', selectedModels: ['gpt-image-2'], discoveredModels: [],
};

function request(overrides: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/font-design/generate-image', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '字体设计测试', model: 'gpt-image-2', providerId: selectedProvider.id,
      ratio: '1:1', count: 1, ...overrides,
    }),
  });
}

describe('font design exact provider routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.workers.length = 0;
    state.providers = [selectedProvider, fallbackProvider];
    state.consumeCredits.mockResolvedValue({ success: true, cost: 12 });
    state.calculateCreditCost.mockResolvedValue(12);
    state.createBillableTask.mockImplementation(async input => ({
      task: { ...input.task, userId: input.userId, creditCost: input.creditCost, creditStatus: 'pending', revision: 0 },
      reused: false,
      charged: true,
    }));
    state.completeCloudTask.mockResolvedValue(true);
    state.updateCloudTask.mockResolvedValue(true);
    state.settleFailedTask.mockResolvedValue({ transitioned: true, refunded: true });
    state.cancelled = false;
  });

  it.each([
    ['missing provider', [fallbackProvider], 'gpt-image-2'],
    ['model outside provider catalog', [selectedProvider, fallbackProvider], 'other-image-model'],
  ])('rejects an explicit provider/model mismatch before task creation or billing: %s', async (_label, providers, model) => {
    state.providers = providers;

    const response = await POST(request({ model }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'MODEL_PROVIDER_MISMATCH',
      providerId: selectedProvider.id,
      model,
    });
    expect(state.consumeCredits).not.toHaveBeenCalled();
    expect(state.registerTask).not.toHaveBeenCalled();
    expect(state.workers).toHaveLength(0);
  });

  it('does not switch providers when the explicitly selected provider fails', async () => {
    state.submit.mockResolvedValueOnce(new Response('selected provider unavailable', { status: 503 }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(state.workers).toHaveLength(1);

    await state.workers[0]();

    expect(state.submit).toHaveBeenCalledTimes(1);
    expect(state.submit.mock.calls[0][0]).toBe(selectedProvider.baseUrl);
    expect(state.createBillableTask).toHaveBeenCalledTimes(1);
    expect(state.settleFailedTask).toHaveBeenCalledTimes(1);
    expect(state.settleFailedTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: expect.stringMatching(/^font-design-/),
      status: 'failed',
    }));
    expect(state.completeCloudTask).not.toHaveBeenCalled();
  });

  it('commits a direct result in the database before publishing it to the font cache', async () => {
    state.submit.mockResolvedValue(Response.json({ directImageUrls: ['/api/serve-upload/font.png'] }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await state.workers[0]();

    expect(state.completeCloudTask).toHaveBeenCalledTimes(1);
    expect(state.completeCloudTask.mock.invocationCallOrder[0]).toBeLessThan(state.setResult.mock.invocationCallOrder[0]);
    expect(state.setResult).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      status: 'completed',
      result: expect.objectContaining({
        providerId: selectedProvider.id,
        providerName: selectedProvider.displayName,
        usedModel: 'gpt-image-2',
      }),
    }));
    expect(state.settleFailedTask).not.toHaveBeenCalled();
  });

  it('persists an asynchronous provider id without publishing a false completed cache entry', async () => {
    state.submit.mockResolvedValue(Response.json({ taskIds: ['remote-font-task'] }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await state.workers[0]();

    expect(state.updateCloudTask).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      remoteTaskId: 'remote-font-task',
      expectedStatuses: ['processing'],
    }));
    const persistedPatch = state.updateCloudTask.mock.calls[0][1] as Record<string, unknown>;
    expect(JSON.stringify(persistedPatch)).not.toContain('selected-key');
    expect(JSON.stringify(persistedPatch)).not.toContain('apiKey');
    const publicRegistryPatch = state.updateTaskProgress.mock.calls.find(([, update]) => (
      (update as Record<string, unknown>).result
      && ((update as Record<string, unknown>).result as Record<string, unknown>).remoteTaskId === 'remote-font-task'
    ))?.[1] as Record<string, unknown> | undefined;
    expect(publicRegistryPatch).toBeDefined();
    expect(JSON.stringify(publicRegistryPatch)).not.toContain('selected-key');
    expect(JSON.stringify(publicRegistryPatch)).not.toContain('apiKey');
    expect(publicRegistryPatch?.result).toMatchObject({
      remoteTaskId: 'remote-font-task',
      providerId: selectedProvider.id,
      usedModel: 'gpt-image-2',
    });
    expect(state.completeCloudTask).not.toHaveBeenCalled();
    expect(state.setResult).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'completed' }));
  });

  it('settles cancellation durably and does not publish a completed font result', async () => {
    state.cancelled = true;

    const response = await POST(request());
    expect(response.status).toBe(200);
    await state.workers[0]();

    expect(state.settleFailedTask).toHaveBeenCalledTimes(1);
    expect(state.settleFailedTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: expect.stringMatching(/^font-design-/),
      status: 'cancelled',
      error: expect.objectContaining({ code: 'USER_CANCELLED' }),
    }));
    expect(state.completeCloudTask).not.toHaveBeenCalled();
    expect(state.setResult).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'completed' }));
  });

  it('reuses one durable font task for a repeated idempotency key without scheduling another worker', async () => {
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
    const submit = () => POST(new NextRequest('http://localhost/api/font-design/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'font-click-1' },
      body: JSON.stringify({
        prompt: '字体设计测试', model: 'gpt-image-2', providerId: selectedProvider.id,
        ratio: '1:1', count: 1,
      }),
    }));

    const firstPayload = await (await submit()).json();
    const secondPayload = await (await submit()).json();

    expect(firstPayload.taskId).toBe(secondPayload.taskId);
    expect(secondPayload).toMatchObject({ reused: true });
    expect(state.workers).toHaveLength(1);
    expect(state.registerTask).toHaveBeenCalledTimes(1);
    expect(state.createBillableTask.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      'font-click-1', 'font-click-1',
    ]);
  });

  it('uses the original model identity in the request digest so 4K cannot reuse a base-model task', async () => {
    state.providers = [{
      ...selectedProvider,
      selectedModels: ['gpt-image-2', 'gpt-image-2-4k'],
    }];
    const submit = (model: string) => POST(new NextRequest('http://localhost/api/font-design/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'font-model-digest' },
      body: JSON.stringify({
        prompt: '字体设计测试', model, providerId: selectedProvider.id,
        ratio: '1:1', count: 1,
      }),
    }));

    await submit('gpt-image-2');
    await submit('gpt-image-2-4k');

    expect(state.createBillableTask.mock.calls[0][0].requestDigest).not.toBe(
      state.createBillableTask.mock.calls[1][0].requestDigest,
    );
  });

  it('reports an oversized idempotency key as a client error', async () => {
    const response = await POST(new NextRequest('http://localhost/api/font-design/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'x'.repeat(257) },
      body: JSON.stringify({
        prompt: '字体设计测试', model: 'gpt-image-2', providerId: selectedProvider.id,
        ratio: '1:1', count: 1,
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false });
    expect(state.workers).toHaveLength(0);
  });
});
