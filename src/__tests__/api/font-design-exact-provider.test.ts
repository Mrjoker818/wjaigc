import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  workers: [] as Array<() => Promise<void>>,
  providers: [] as Array<Record<string, unknown>>,
  submit: vi.fn(),
  consumeCredits: vi.fn(),
  refundCredits: vi.fn(),
  registerTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  setResult: vi.fn(),
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
  isTaskCancelled: vi.fn(() => false),
  getTaskInfo: vi.fn(),
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: vi.fn(async () => ({ id: 'font-user' })) }));
vi.mock('@/lib/credits', () => ({ consumeCredits: state.consumeCredits, refundCredits: state.refundCredits }));
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
    expect(state.updateTaskProgress).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('503'),
    }));
  });
});
