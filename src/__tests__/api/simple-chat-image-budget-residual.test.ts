import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  provider: vi.fn(), user: vi.fn(), upstream: vi.fn(), headers: vi.fn(),
  schedule: vi.fn(), admit: vi.fn(), execute: vi.fn(), projectResult: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({ findProviderForModel: mocks.provider, findProviderById: mocks.provider }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.user }));
vi.mock('@/lib/api-helpers', () => ({
  fetchWithTimeout: mocks.upstream, getInternalApiUrl: (p: string) => `http://offline.invalid${p}`, shouldSkipV1Retry: () => true,
}));
vi.mock('@/lib/api-auth', () => ({ getInternalRequestHeaders: mocks.headers }));
vi.mock('@/lib/agent-runtime/mode', () => ({ resolveAgentRuntimeMode: () => 'legacy' }));
vi.mock('@/lib/agent-runtime/surface-dispatch', () => ({ prepareAdmittedAgentTaskExecution: mocks.schedule }));
vi.mock('@/lib/agent-runtime/admission-gate', () => ({ admitAuthorizedAgentExecution: mocks.admit }));
vi.mock('@/lib/agent-runtime/workspace-results', () => ({
  projectAgentResultToWorkspace: mocks.projectResult,
  agentWorkspaceProjectionIdempotencyKey: () => 'offline-projection',
}));
vi.mock('@/lib/chat-tools', () => ({ CHAT_TOOLS: [], executeToolCall: mocks.execute }));
vi.mock('coze-coding-dev-sdk', () => ({ HeaderUtils: { extractForwardHeaders: vi.fn() }, SearchClient: class {}, Config: class {} }));
// Reject accidental entry into real asset/database and billing boundaries.
vi.mock('@/lib/asset-core/service', () => ({ AssetServiceError: class extends Error {}, createAssetService: () => { throw Error('NO_ASSET_IO'); } }));
vi.mock('@/lib/credits', () => ({
  consumeCredits: () => { throw Error('NO_REAL_BILLING'); },
  calculateConfiguredCreditCost: () => { throw Error('NO_REAL_BILLING'); },
}));

import { POST } from '@/app/api/simple-chat/chat/route';

interface Submission { body: Record<string, unknown>; key: string | null }
let submitted: Submission[];
let polled: string[];

function toolReply(count: number): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: Array.from({ length: count }, (_, index) => ({
    index, id: `call-${index}`, function: { name: 'generate_image', arguments: JSON.stringify({ prompt: '猫咪海报', aspect_ratio: '1:1', image_count: 4 }) },
  })) } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

async function run(text: string, calls: number, asyncTasks = false) {
  mocks.upstream.mockResolvedValue(toolReply(calls));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === 'http://offline.invalid/api/generate') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const key = new Headers(init?.headers).get('idempotency-key');
      submitted.push({ body, key });
      const taskId = `offline-task-${submitted.length}`;
      // This mock is the task admission/charging boundary, never the real generate route.
      return Response.json(asyncTasks ? { success: true, taskIds: [taskId] }
        : { success: true, directImageUrls: [`/api/serve-upload/${taskId}.png`] });
    }
    if (url === 'http://offline.invalid/api/poll-task') {
      const { taskId } = JSON.parse(String(init?.body)) as { taskId: string };
      polled.push(taskId);
      return Response.json({ status: 'completed', imageUrl: `/api/serve-upload/${taskId}.png` });
    }
    throw new Error(`UNEXPECTED_OFFLINE_FETCH:${url}`);
  }));
  const response = await POST(new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '上轮生成3张' }, { role: 'assistant', content: '可以生成4张' }, { role: 'user', content: text }],
      model: 'chat-model', providerId: 'chat-provider', imageModel: 'image-model', imageProviderId: 'image-provider',
      projectId: 'project', taskId: 'task', responseMessageId: 'reply',
      ...(asyncTasks ? { assetProjectId: 'asset-project' } : {}),
    }),
  }));
  const stream = response.text();
  if (asyncTasks) await vi.runAllTimersAsync();
  const events = (await stream).split('\n').filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)) as Record<string, unknown>);
  expect(response.status).toBe(200);
  expect(events.some(event => event.type === 'error')).toBe(false);
  expect(events.some(event => event.type === 'done')).toBe(true);
  return events;
}

describe('simple-chat request-wide image budget at the real POST caller', () => {
  beforeEach(() => {
    vi.clearAllMocks(); submitted = []; polled = [];
    mocks.user.mockResolvedValue({ id: 'user', role: 'admin', productType: 'chat' });
    mocks.provider.mockResolvedValue({ id: 'provider', apiKey: 'offline-only', baseUrl: 'https://provider.invalid/v1', advancedParams: {} });
    mocks.headers.mockResolvedValue({ Authorization: 'Bearer offline-only' });
    for (const mock of [mocks.schedule, mocks.admit, mocks.execute]) mock.mockImplementation(() => { throw Error('UNEXPECTED_SCHEDULER'); });
    mocks.schedule.mockImplementation(async ({ execute }: { execute: () => Promise<void> }) => ({ execute, runId: 'offline-run' }));
    mocks.projectResult.mockResolvedValue([]);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('admits and polls only one task for explicit one despite four model tool calls', async () => {
    vi.useFakeTimers();
    const events = await run('只生成1张猫咪海报，不要其他版本', 4, true);
    expect(submitted).toHaveLength(1);
    expect(polled).toEqual(['offline-task-1']);
    expect(events.filter(event => event.type === 'image')).toHaveLength(1);
    expect(submitted[0]).toEqual({ body: expect.objectContaining({ outputCount: 1, submitOnly: true, model: 'image-model', providerId: 'image-provider' }), key: 'simple-chat:task:reply:generate' });
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
    expect(mocks.projectResult).toHaveBeenCalledTimes(1);
    expect(mocks.admit).not.toHaveBeenCalled();
  });

  it.each([
    ['本轮只生成0张图片', 4],
    ['本轮只生成0张图片', 1],
    ['本轮只生成零张图片', 4],
  ])('honors explicit zero budget %s with %i tool calls without submitting, scheduling or polling', async (text, calls) => {
    vi.useFakeTimers();
    const events = await run(text, calls, true);
    expect(submitted).toHaveLength(0);
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(polled).toHaveLength(0);
    expect(mocks.projectResult).not.toHaveBeenCalled();
    expect(events.filter(event => event.type === 'image')).toHaveLength(0);
    // ChatArea renders `text` events; do not silently finish a zero-image request.
    expect(events.filter(event => event.type === 'text').map(event => event.content).join(''))
      .toMatch(/(?:未提交|不生成|无需生成|请确认)/);
  });

  it.each([
    ['生成一张海报', 4, 1],
    ['生成2张海报', 4, 2],
    ['再来3张海报', 1, 3],
    ['生成3张海报', 3, 3],
    ['分别画一只猫和一只狗', 2, 2],
    ['分别画一张猫和一张狗', 2, 2],
    ['猫和狗各一张', 2, 2],
    ['多出几张海报看看', 1, 3],
    ['之前1张，现在改成3张海报', 1, 3],
    ['生成3张海报，每张有2个苹果', 4, 3],
    ['参考这1张图生成3张海报', 1, 3],
  ])('respects user intent %s without changing per-image admission keys', async (text, calls, count) => {
    const events = await run(text, calls);
    expect(submitted).toHaveLength(count);
    expect(events.filter(event => event.type === 'image')).toHaveLength(count);
    expect(submitted.every(item => item.body.outputCount === 1)).toBe(true);
    expect(submitted.map(item => item.key)).toEqual(Array.from({ length: count }, (_, i) => `simple-chat:task:reply:generate${i ? `:${i}` : ''}`));
  });

  it('asks for a total before admitting any task for contradictory counts', async () => {
    const events = await run('只生成1张还是3张猫咪海报', 4);
    expect(submitted).toHaveLength(0);
    expect(polled).toHaveLength(0);
    // ChatArea appends only `text` events to the visible assistant reply.
    expect(events.filter(event => event.type === 'text').map(event => event.content).join('')).toMatch(/请确认.*(?:张数|几张|数量)/);
  });
});
