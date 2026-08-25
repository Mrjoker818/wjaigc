import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
  requireApiAuthOrReject: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/server-api-config', () => ({
  findProviderById: mocks.findProviderById,
  findProviderForModel: mocks.findProviderForModel,
}));

vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-helpers')>();
  return {
    ...actual,
    fetchWithTimeout: mocks.fetchWithTimeout,
  };
});

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>();
  return {
    ...actual,
    requireApiAuthOrReject: mocks.requireApiAuthOrReject,
  };
});

vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {
    async webSearch() {
      return { web_items: [] };
    }
  },
  Config: class {},
  HeaderUtils: { extractForwardHeaders: vi.fn(() => ({})) },
}));

import { POST as chatPost } from '@/app/api/simple-chat/chat/route';
import { POST as deepResearchPost } from '@/app/api/simple-chat/deep-research/route';

const provider = {
  id: 'provider-a',
  name: 'Provider A',
  apiKey: 'provider-secret',
  baseUrl: 'https://provider.example/v1',
};

function chatProviderResponse(): Response {
  return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function reportProviderResponse(): Response {
  return new Response('data: {"choices":[{"delta":{"content":"report"}}]}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function chatRequest(
  idempotencyKey: unknown,
  headerKey: string | undefined = typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(headerKey === undefined ? {} : { 'Idempotency-Key': headerKey }),
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'chat-model',
      providerId: 'provider-a',
      idempotencyKey,
    }),
  });
}

function deepResearchRequest(
  idempotencyKey: unknown,
  headerKey: string | undefined = typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/deep-research', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(headerKey === undefined ? {} : { 'Idempotency-Key': headerKey }),
    },
    body: JSON.stringify({
      query: 'Research this',
      model: 'chat-model',
      providerId: 'provider-a',
      depth: 'standard',
      idempotencyKey,
    }),
  });
}

describe('simple-chat retry idempotency boundary', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({
      id: 'admin-a',
      role: 'admin',
      productType: 'chat',
      apiPermissions: { chat: true },
    });
    mocks.requireApiAuthOrReject.mockResolvedValue({ userId: 'admin-a', role: 'admin' });
    mocks.findProviderForModel.mockResolvedValue(provider);
    mocks.findProviderById.mockResolvedValue(provider);
    mocks.fetchWithTimeout.mockResolvedValue(chatProviderResponse());
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"steps":[{"step":1,"query":"Research this","rationale":"direct"}]}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(reportProviderResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards a bounded retry key to the chat provider', async () => {
    const key = 'simple-chat-retry:task-a:assistant-a';
    const response = await chatPost(chatRequest(key));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': key }),
      }),
      'chat',
    );
  });

  it('derives stable Deep Research phase keys', async () => {
    const response = await deepResearchPost(deepResearchRequest('research-a'));
    await response.text();

    const providerFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(response.status).toBe(200);
    expect(providerFetch.mock.calls[0][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'Idempotency-Key': 'research-a:plan' }),
    }));
    expect(providerFetch.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'Idempotency-Key': 'research-a:report' }),
    }));
  });

  it('rejects an oversized header idempotency key', async () => {
    const response = await chatPost(chatRequest(undefined, 'x'.repeat(257)));
    expect(response.status).toBe(400);
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('rejects invalid idempotency key characters', async () => {
    const response = await deepResearchPost(deepResearchRequest('research key with spaces'));
    expect(response.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects conflicting body and header keys', async () => {
    const response = await chatPost(chatRequest('body-key', 'header-key'));
    expect(response.status).toBe(409);
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
  });
});
