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
  registerTask: vi.fn(),
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
vi.mock('@/lib/task-registry', () => ({ registerTask: state.registerTask, updateTaskProgress: state.updates, isTaskCancelled: vi.fn(() => false) }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: vi.fn(async () => ({ id: 'test-user' })) }));
vi.mock('@/lib/credits', () => ({ consumeCredits: state.consumeCredits, refundCredits: vi.fn() }));
vi.mock('@/lib/db-storage', () => ({ dbGetEcomTemplate: vi.fn(async () => null) }));
vi.mock('@/lib/op-log', () => ({ logOperation: vi.fn(), logError: vi.fn(), OP_ACTIONS: {}, startTimer: vi.fn() }));
vi.mock('@/app/api/brand-ecommerce/result-store', () => ({ setBrandResult: state.cached }));
import { POST } from '@/app/api/brand-ecommerce/route';

describe('brand ecommerce server result identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.workers.length = 0;
    state.findProviderById.mockResolvedValue(state.provider);
    state.findProviderForModel.mockResolvedValue(state.provider);
    state.consumeCredits.mockResolvedValue({ success: true, cost: 60 });
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
