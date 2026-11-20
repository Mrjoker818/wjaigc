import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
  requireApiAuthOrReject: vi.fn(),
  webSearch: vi.fn(),
  executeToolCall: vi.fn(),
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

vi.mock('@/lib/chat-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chat-tools')>();
  return { ...actual, executeToolCall: mocks.executeToolCall };
});

vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {
    async webSearch(...args: unknown[]) {
      return mocks.webSearch(...args);
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
    mocks.webSearch.mockReset();
    mocks.webSearch.mockResolvedValue({ web_items: [] });
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

  it('retries a 404 chat gateway once on /v1 with the same retry key', async () => {
    const unversioned = { ...provider, baseUrl: 'https://provider.example' };
    mocks.findProviderForModel.mockResolvedValue(unversioned);
    mocks.findProviderById.mockResolvedValue(unversioned);
    mocks.fetchWithTimeout.mockReset();
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(chatProviderResponse());
    const key = 'simple-chat-retry:task-b:assistant-b';
    const response = await chatPost(chatRequest(key));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.fetchWithTimeout.mock.calls;
    expect(String(first[0])).toBe('https://provider.example/chat/completions');
    expect(String(second[0])).toBe('https://provider.example/v1/chat/completions');
    expect(second[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'Idempotency-Key': key }),
    }));
  });

  it('retries a gateway that answers 405 for the unversioned route on /v1', async () => {
    const unversioned = { ...provider, baseUrl: 'https://provider.example' };
    mocks.findProviderForModel.mockResolvedValue(unversioned);
    mocks.findProviderById.mockResolvedValue(unversioned);
    mocks.fetchWithTimeout.mockReset();
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(new Response('POST not supported for route chat/completions', { status: 405 }))
      .mockResolvedValueOnce(chatProviderResponse());
    const response = await chatPost(chatRequest('simple-chat-retry:task-e:assistant-e'));
    const text = await response.text();

    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(String(mocks.fetchWithTimeout.mock.calls[1][0])).toBe('https://provider.example/v1/chat/completions');
    expect(text).not.toContain('"type":"error"');
  });

  it('does not retry a /v1 provider that answers 404', async () => {
    mocks.fetchWithTimeout.mockReset();
    mocks.fetchWithTimeout.mockResolvedValue(new Response('not found', { status: 404 }));
    const response = await chatPost(chatRequest('simple-chat-retry:task-d:assistant-d'));
    await response.text();
    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a streamed chat request that already succeeded', async () => {
    const response = await chatPost(chatRequest('simple-chat-retry:task-c:assistant-c'));
    await response.text();
    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('keeps each web search result field on one line for the client parser', async () => {
    mocks.webSearch.mockResolvedValue({
      web_items: [{ title: 'Line one\nline two', url: 'https://a.example', snippet: 'First\r\n  second', summary: 'S1\nS2' }],
    });
    const response = await chatPost(new NextRequest('http://localhost/api/simple-chat/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }], model: 'chat-model', providerId: 'provider-a', webSearch: true }),
    }));
    const body = await response.text();
    const event = body.split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
      .find(value => value?.type === 'search_status');

    expect(event).toMatchObject({ status: 'completed', resultCount: 1 });
    expect(event.searchResults).toContain('[1] Line one line two\nURL: https://a.example\n摘要: First second\nAI摘要: S1 S2');
  });

  it('runs a web_search tool round, pairs every result and keys each round separately', async () => {
    mocks.webSearch
      .mockResolvedValueOnce({ web_items: [{ title: 'First', url: 'https://a.example', snippet: 'one' }] })
      .mockResolvedValueOnce({ web_items: [{ title: 'Second', url: 'javascript:alert(1)', snippet: 'two' }] });
    const searchCall = JSON.stringify({ choices: [{ delta: {
      reasoning_content: 'need fresher data',
      tool_calls: [{ index: 0, id: 'call-search', function: { name: 'web_search', arguments: '{"query":"latest"}' } }],
    } }] });
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(new Response(`data: ${searchCall}\n\ndata: [DONE]\n\n`, { status: 200 }))
      .mockResolvedValueOnce(chatProviderResponse());

    const response = await chatPost(new NextRequest('http://localhost/api/simple-chat/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'turn-a' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'chat-model',
        providerId: 'provider-a',
        webSearch: true,
        idempotencyKey: 'turn-a',
      }),
    }));
    const events = (await response.text()).split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)));

    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.fetchWithTimeout.mock.calls.map(call => call[1] as RequestInit);
    expect((first.headers as Record<string, string>)['Idempotency-Key']).toBe('turn-a');
    expect((second.headers as Record<string, string>)['Idempotency-Key']).toBe('turn-a:round-1');
    const secondBody = JSON.parse(String(second.body));
    const toolNames = (body: { tools: Array<{ function: { name: string } }> }) => body.tools.map(tool => tool.function.name);
    expect(toolNames(JSON.parse(String(first.body)))).toContain('web_search');
    expect(secondBody.messages.at(-2)).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call-search' }] });
    expect(secondBody.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-search' });
    expect(secondBody.messages.at(-1).content).toContain('[2] Second');

    const lastCard = events.filter(event => event.type === 'search_status' && event.status === 'completed').at(-1);
    expect(lastCard).toMatchObject({ resultCount: 2 });
    expect(lastCard.searchResults).toContain('[2] Second\nURL: 无');
    expect(lastCard.searchResults).not.toContain('javascript:');
    expect(events).toContainEqual({ type: 'reasoning', content: 'need fresher data' });
    expect(events.filter(event => event.type === 'text').map(event => event.content).join('')).toBe('ok');
  });

  it('offers no search tool in the last round so the model has to answer', async () => {
    mocks.webSearch.mockResolvedValue({ web_items: [{ title: 'T', url: 'https://a.example', snippet: 's' }] });
    const searchCall = (id: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: {
      tool_calls: [{ index: 0, id, function: { name: 'web_search', arguments: '{"query":"q"}' } }],
    } }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(searchCall('s1'))
      .mockResolvedValueOnce(searchCall('s2'))
      .mockResolvedValueOnce(chatProviderResponse());

    const response = await chatPost(new NextRequest('http://localhost/api/simple-chat/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }], model: 'chat-model', providerId: 'provider-a', webSearch: true }),
    }));
    await response.text();

    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(3);
    const lastBody = JSON.parse(String((mocks.fetchWithTimeout.mock.calls[2][1] as RequestInit).body));
    expect(lastBody.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['generate_image', 'create_drama_draft']);
  });

  it('adds the work-mode steps to the system prompt and streams the plan in work mode', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(chatProviderResponse());
    const response = await chatPost(new NextRequest('http://localhost/api/simple-chat/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '写一份竞品分析报告' }],
        model: 'chat-model',
        providerId: 'provider-a',
        workMode: 'work',
      }),
    }));
    const events = (await response.text()).split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)));

    const body = JSON.parse(String((mocks.fetchWithTimeout.mock.calls[0][1] as RequestInit).body));
    expect(body.messages[0].content).toContain('## 步骤 1 · 明确目标与交付物');
    const planEvent = events.find(event => event.type === 'work_plan');
    expect(planEvent.workPlan).toMatchObject({ goal: '写一份竞品分析报告', deliverable: '带依据的结构化报告' });
    expect(planEvent.workPlan.steps).toHaveLength(4);
  });

  it('writes a short-drama draft when the model calls create_drama_draft', async () => {
    const dramaCall = JSON.stringify({ choices: [{ delta: {
      tool_calls: [{ index: 0, id: 'call-drama', function: { name: 'create_drama_draft', arguments: '{"idea":"外卖员暴雨夜送错餐","style":"anime"}' } }],
    } }] });
    mocks.fetchWithTimeout.mockResolvedValueOnce(new Response(`data: ${dramaCall}\n\ndata: [DONE]\n\n`, { status: 200 }));
    mocks.executeToolCall.mockResolvedValue({
      success: true,
      resultText: 'ok',
      data: { dramaId: 'drama_1', title: '雨夜来信', episodeCount: 1, sceneCount: 6, castCount: 3 },
    });
    const response = await chatPost(new NextRequest('http://localhost/api/simple-chat/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '帮我写个短剧' }], model: 'chat-model', providerId: 'provider-a', assetProjectId: 'project-1' }),
    }));
    const events = (await response.text()).split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)));

    const body = JSON.parse(String((mocks.fetchWithTimeout.mock.calls[0][1] as RequestInit).body));
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain('create_drama_draft');
    expect(body.messages[0].content).toContain('create_drama_draft');
    expect(mocks.executeToolCall).toHaveBeenCalledWith(
      'create_drama_draft',
      { idea: '外卖员暴雨夜送错餐', style: 'anime' },
      expect.objectContaining({ userId: 'admin-a', projectId: 'project-1', allowedTools: ['create_drama_draft'] }),
    );
    expect(events).toContainEqual({
      type: 'drama_draft', dramaId: 'drama_1', title: '雨夜来信', projectId: 'project-1', summary: '1 集、6 场、3 个角色',
    });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('reports a failed draft with the reason instead of a draft event', async () => {
    const dramaCall = JSON.stringify({ choices: [{ delta: {
      tool_calls: [{ index: 0, id: 'call-drama', function: { name: 'create_drama_draft', arguments: 'not json' } }],
    } }] });
    mocks.fetchWithTimeout.mockResolvedValueOnce(new Response(`data: ${dramaCall}\n\ndata: [DONE]\n\n`, { status: 200 }));
    mocks.executeToolCall.mockResolvedValue({ success: false, error: '剧本助手暂时不可用', resultText: 'x' });
    const response = await chatPost(chatRequest(undefined));
    const events = (await response.text()).split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)));

    expect(mocks.executeToolCall.mock.calls[0][1]).toEqual({ idea: 'Hello' });
    expect(events.some(event => event.type === 'drama_draft')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_status', tool: 'drama_draft', status: 'failed', label: '剧本没有写成：剧本助手暂时不可用' }));
  });

  it('does not offer the drama tool to a user without the video platform', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user', productType: 'chat', apiPermissions: { chat: true } });
    mocks.requireApiAuthOrReject.mockResolvedValue({ userId: 'user-a', role: 'user' });
    const response = await chatPost(chatRequest(undefined));
    await response.text();

    const body = JSON.parse(String((mocks.fetchWithTimeout.mock.calls[0][1] as RequestInit).body));
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).not.toContain('create_drama_draft');
    expect(body.messages[0].content).not.toContain('create_drama_draft');
  });

  it('sends no plan and no work-mode prompt outside work mode', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(chatProviderResponse());
    const response = await chatPost(chatRequest(undefined));
    const text = await response.text();

    const body = JSON.parse(String((mocks.fetchWithTimeout.mock.calls[0][1] as RequestInit).body));
    expect(body.messages[0].content).not.toContain('工作模式');
    expect(text).not.toContain('work_plan');
  });

  it('keeps a single request without the search tool when web search is off', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(chatProviderResponse());
    const response = await chatPost(chatRequest(undefined));
    await response.text();

    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((mocks.fetchWithTimeout.mock.calls[0][1] as RequestInit).body));
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['generate_image', 'create_drama_draft']);
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
