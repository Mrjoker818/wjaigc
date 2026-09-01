import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  submit: vi.fn(),
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  provider: {
    id: 'apimart-chat',
    name: 'APImartLLM',
    displayName: 'APImartLLM',
    baseUrl: 'https://api.apib.ai/v1',
    apiKey: 'local-test-key',
    isEnabled: true,
    modelType: 'chat',
    requestStyle: 'chat-completions',
    selectedModels: ['gemini-3.1-flash-lite-preview'],
  },
}));

vi.mock('next/server', async importOriginal => ({
  ...await importOriginal<typeof import('next/server')>(),
  after: vi.fn(),
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: state.findProviderById,
  findProviderForModel: state.findProviderForModel,
  getPublicModels: vi.fn(),
}));
vi.mock('@/lib/api-helpers', () => ({
  fetchWithV1Retry: state.submit,
  getInternalApiUrl: (path: string) => path,
}));
vi.mock('@/lib/api-auth', () => ({ getInternalRequestHeaders: vi.fn(async () => ({})) }));
vi.mock('@/lib/task-registry', () => ({
  registerTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  isTaskCancelled: vi.fn(() => false),
}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: vi.fn(async () => ({ id: 'test-user' })),
}));
vi.mock('@/lib/credits', () => ({
  InsufficientCreditsError: class InsufficientCreditsError extends Error {
    code = 'INSUFFICIENT_CREDITS';
    statusCode = 402;
  },
  calculateConfiguredCreditCost: vi.fn(async () => 0),
  consumeCredits: vi.fn(async () => ({ success: true, cost: 0 })),
  refundCredits: vi.fn(),
}));
vi.mock('@/lib/db-storage', () => ({ dbGetEcomTemplate: vi.fn(async () => null) }));
vi.mock('@/lib/op-log', () => ({
  logOperation: vi.fn(),
  logError: vi.fn(),
  OP_ACTIONS: {},
  startTimer: vi.fn(),
}));
vi.mock('@/app/api/brand-ecommerce/result-store', () => ({ setBrandResult: vi.fn() }));

import { POST } from '@/app/api/brand-ecommerce/route';

describe('brand ecommerce assist provider route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.findProviderById.mockResolvedValue(state.provider);
    state.findProviderForModel.mockResolvedValue(null);
    state.submit.mockResolvedValue(Response.json({
      choices: [{ message: { content: '优化后的提示词' } }],
    }));
  });

  it('uses the selected APImart chat provider through chat/completions', async () => {
    const response = await POST(new NextRequest('http://localhost/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'assist',
        assistType: 'optimize-prompt',
        productDesc: '白色陶瓷咖啡杯',
        llmModel: 'gemini-3.1-flash-lite-preview',
        llmProviderId: 'apimart-chat',
      }),
    }));

    expect(response.status).toBe(200);
    expect(state.findProviderById).toHaveBeenCalledWith('apimart-chat');
    expect(state.findProviderForModel).not.toHaveBeenCalled();
    expect(state.submit).toHaveBeenCalledTimes(1);
    expect(state.submit.mock.calls[0][0]).toBe('https://api.apib.ai/v1');
    expect(state.submit.mock.calls[0][1]).toBe('/chat/completions');
    expect(JSON.parse(state.submit.mock.calls[0][2].body as string)).toMatchObject({
      model: 'gemini-3.1-flash-lite-preview',
    });
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      content: '优化后的提示词',
    });
  });

  it('does not switch providers when an explicit provider id is unavailable', async () => {
    state.findProviderById.mockResolvedValue(null);
    state.findProviderForModel.mockResolvedValue({
      ...state.provider,
      id: 'fallback-provider',
    });

    const response = await POST(new NextRequest('http://localhost/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'assist',
        assistType: 'optimize-prompt',
        productDesc: '白色陶瓷咖啡杯',
        llmModel: 'gemini-3.1-flash-lite-preview',
        llmProviderId: 'missing-provider',
      }),
    }));

    expect(response.status).toBe(400);
    expect(state.findProviderForModel).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('rejects a model that is not authorized by the explicit provider', async () => {
    const response = await POST(new NextRequest('http://localhost/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'assist',
        assistType: 'optimize-prompt',
        productDesc: '白色陶瓷咖啡杯',
        llmModel: 'model-from-another-provider',
        llmProviderId: 'apimart-chat',
      }),
    }));

    expect(response.status).toBe(400);
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('accepts an APImart SSE response and joins streamed content', async () => {
    state.submit.mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"优化后的"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"提示词"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const response = await POST(new NextRequest('http://localhost/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'assist',
        assistType: 'optimize-prompt',
        productDesc: '白色陶瓷咖啡杯',
        llmModel: 'gemini-3.1-flash-lite-preview',
        llmProviderId: 'apimart-chat',
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      content: '优化后的提示词',
    });
  });

  it('preserves an invalid upstream SSE body instead of reporting an empty success', async () => {
    state.submit.mockResolvedValue(new Response('data: upstream-not-json\n\ndata: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const response = await POST(new NextRequest('http://localhost/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'assist',
        assistType: 'optimize-prompt',
        productDesc: '白色陶瓷咖啡杯',
        llmModel: 'gemini-3.1-flash-lite-preview',
        llmProviderId: 'apimart-chat',
      }),
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('upstream-not-json'),
    });
  });
});
