import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userId: 'user-a' as string | null,
  provider: { baseUrl: 'https://llm.example.com/v1', apiKey: 'k', selectedModels: ['chat-1'] } as Record<string, unknown> | null,
  replies: [] as string[],
  llmCalls: 0,
  balance: 30,
  prices: [] as Array<{ model: string; options: Record<string, unknown> }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => (mocks.userId
    ? { authenticated: true, userId: mocks.userId, userRole: 'user' }
    : NextResponse.json({ error: 'Authentication required' }, { status: 401 })),
}));
vi.mock('@/lib/server-api-config', () => ({ findProviderForFeature: async () => mocks.provider }));
vi.mock('@/lib/api-helpers', () => ({
  fetchWithV1Retry: async () => {
    mocks.llmCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: mocks.replies.shift() ?? '' } }] }), { status: 200 });
  },
}));
vi.mock('@/lib/credits', () => ({
  calculateConfiguredCreditCost: async (_op: string, model: string, options: Record<string, unknown>) => {
    mocks.prices.push({ model, options });
    return 10 * Number(options.durationSeconds);
  },
}));
vi.mock('@/lib/credit-pricing', () => ({ loadCreditPricingConfig: async () => ({ modelCredits: {} }) }));
vi.mock('@/lib/db-storage', () => ({ dbGetCredits: async () => ({ balance: mocks.balance }) }));

import { POST as plan } from '@/app/api/drama/plan/route';
import { POST as estimate } from '@/app/api/drama/estimate/route';

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const script = JSON.stringify({
  title: '雨夜', cast: [{ id: 'lin', name: '林夏', appearance: '短发' }], locations: [],
  episodes: [{ title: '一', scenes: [{ heading: '咖啡馆', summary: '林夏收到信。她拆开。', characterIds: ['lin'] }] }],
});

beforeEach(() => {
  mocks.userId = 'user-a';
  mocks.provider = { baseUrl: 'https://llm.example.com/v1', apiKey: 'k', selectedModels: ['chat-1'] };
  mocks.replies = [];
  mocks.llmCalls = 0;
  mocks.prices = [];
});

describe('POST /api/drama/plan', () => {
  it('writes a script and retries once when the first reply is not JSON', async () => {
    mocks.replies = ['not json', script];
    const response = await plan(post('/api/drama/plan', { action: 'script', idea: '雨夜收到信', aspectRatio: 'bad' }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.llmCalls).toBe(2);
    expect(data.doc.aspectRatio).toBe('9:16');
    expect(data.doc.episodes[0].scenes).toHaveLength(1);
  });

  it('breaks a scene into shots from the saved document', async () => {
    mocks.replies = [script];
    const { doc } = await (await plan(post('/api/drama/plan', { action: 'script', idea: 'x' }))).json();
    mocks.replies = [JSON.stringify({ shots: [{ prompt: '林夏拆信', duration: 5, dialogue: '是你？' }, { prompt: '特写', duration: 4 }] })];
    const response = await plan(post('/api/drama/plan', { action: 'shots', doc, episodeId: doc.episodes[0].id, sceneId: doc.episodes[0].scenes[0].id }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.shots).toHaveLength(2);
    expect(data.shots[0]).toMatchObject({ dialogue: '是你？', characterIds: ['lin'], takes: [] });
  });

  it('explains what to do when no chat model is configured or the input is empty', async () => {
    mocks.provider = null;
    const missing = await plan(post('/api/drama/plan', { action: 'script', idea: 'x' }));
    expect(missing.status).toBe(503);
    expect((await missing.json()).error).toContain('对话模型');
    mocks.provider = { baseUrl: 'https://llm.example.com', apiKey: 'k', defaultChatModel: 'c' };
    expect((await plan(post('/api/drama/plan', { action: 'script', idea: '  ' }))).status).toBe(400);
    expect((await plan(post('/api/drama/plan', { action: 'other' }))).status).toBe(400);
    expect(mocks.llmCalls).toBe(0);
  });

  it('requires a signed-in user', async () => {
    mocks.userId = null;
    expect((await plan(post('/api/drama/plan', { action: 'script', idea: 'x' }))).status).toBe(401);
  });
});

describe('POST /api/drama/estimate', () => {
  it('prices each shot with the provider split out of the model key and returns the balance', async () => {
    const response = await estimate(post('/api/drama/estimate', { shots: [
      { shotId: 's1', modelId: 'pear::kling', durationSec: 5, generateAudio: true, referenceImages: 2 },
      { shotId: 's2', modelId: 'kling', providerId: 'apimart', durationSec: 10.4 },
    ] }));
    const data = await response.json();
    expect(data).toMatchObject({ total: 150, perShot: { s1: 50, s2: 100 }, balance: 30 });
    expect(mocks.prices[0]).toMatchObject({ model: 'kling', options: { providerId: 'pear', audio: true, inputImages: 2, durationSeconds: 5 } });
    expect(mocks.prices[1]).toMatchObject({ model: 'kling', options: { providerId: 'apimart', durationSeconds: 10 } });
  });

  it('rejects shots without a model', async () => {
    expect((await estimate(post('/api/drama/estimate', { shots: [{ shotId: 's1', durationSec: 5 }] }))).status).toBe(400);
    expect((await estimate(post('/api/drama/estimate', { shots: 'x' }))).status).toBe(400);
  });
});
