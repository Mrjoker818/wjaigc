import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Scope inherited DB bindings before imports and module-level guard snapshots.
await vi.hoisted(async () => {
  const { afterAll } = await import('vitest');
  const { scopeOfflineDatabaseEnvironment } = await import('../helpers/isolated-child-database-env');
  const restore = scopeOfflineDatabaseEnvironment(process.env);
  try {
    afterAll(restore);
  } catch (error) {
    restore();
    throw error;
  }
});

// Only storage and provider transport are synthetic. Route, session verification,
// provider selection, credit pricing/charge/refund, parsers and errors stay real.
vi.mock('server-only', () => ({}));
const boundary = vi.hoisted(() => ({
  query: vi.fn(), providers: vi.fn(), users: vi.fn(), setting: vi.fn(), credits: vi.fn(),
}));
vi.mock('@/lib/db-client', () => ({
  isDatabaseConfigured: (): boolean => true, // synthetic DB, never load pg
  execSql: boundary.query,
  getPool: () => ({
    query: boundary.query,
    connect: async () => ({ query: boundary.query, release: (): void => {} }),
  }),
}));
vi.mock('@/lib/db-storage', () => ({
  dbReadUsers: boundary.users,
  dbGetApiProviders: boundary.providers,
  dbGetSystemSetting: boundary.setting,
  dbGetCredits: boundary.credits,
  dbInitCredits: async (): Promise<never> => { throw Error('Unexpected credit initialization'); },
  ensureCoreTables: async (): Promise<void> => {},
  ensureDeploymentProviderBootstrap: async (): Promise<void> => {},
}));

import { POST } from '@/app/api/omp-agent/route';

const OWNER = 'omp-refund-owner';
const SECRET = 'omp-offline-synthetic-secret-32-characters';
const MODEL = 'omp-offline-model';
const PROVIDER = 'omp-offline-provider';
const PROVIDER_URL = 'https://omp-provider.invalid/v1/chat/completions';
const DB_ENV = /^(PG|DATABASE|POSTGRES|TEST_POSTGRES|COZE_SUPABASE)|^WUJIE_.*DB|^WUJIE_AUTH_PERSISTENCE_MODE$/;
const inheritedDbKeys = Object.keys(process.env).filter(key => DB_ENV.test(key));

interface Entry { type: 'consume' | 'refund'; amount: number; userId: string; reference: string }
type Fault = 'none' | 'before-commit' | 'after-commit';
let balance: number;
let totalUsed: number;
let ledger: Entry[];
let chargeFault: Fault;
let refundFault: Fault;
let chargeAttempts: number;
let refundAttempts: number;
let refundLookups: number;
let providerCalls: number;
let providerReply: (options?: RequestInit) => Promise<Response>;
let consoleErrors: ReturnType<typeof vi.spyOn>;

function providerRow(): Record<string, unknown> {
  return { id: PROVIDER, name: 'Offline OMP fixture', display_name: 'Offline OMP fixture',
    base_url: 'https://omp-provider.invalid/v1', api_key: 'synthetic-not-a-key',
    is_enabled: true, type: 'chat', model_type: 'chat', request_style: 'chat-completions',
    selected_models: [MODEL], advanced_params: {}, is_default: true, discovered_models: [],
    sort_order: 0, created_at: 1, updated_at: 1 };
}

function signedToken(): string {
  const encoded = Buffer.from(JSON.stringify({ sub: OWNER, role: 'user', name: 'OMP fixture',
    exp: Date.now() + 60_000 })).toString('base64url');
  return `${encoded}.${createHmac('sha256', SECRET).update(encoded).digest('base64url')}`;
}

function request(overrides: Record<string, unknown> = {}, auth: 'web' | 'desktop' | 'none' = 'web'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth === 'web') headers.cookie = `wujie_session=${signedToken()}`;
  if (auth === 'desktop') headers.authorization = `Bearer ${signedToken()}`;
  return new NextRequest('http://localhost/api/omp-agent', { method: 'POST', headers,
    body: JSON.stringify({ inputText: '一只玩具熊', model: MODEL, providerId: PROVIDER, ...overrides }) });
}

function completion(content: string): Response {
  return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], model: MODEL });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The offline launcher must clear inherited DB bindings before module loading.
  expect(inheritedDbKeys, 'inherited DB configuration must be absent').toEqual([]);
  vi.stubEnv('WUJIE_AUTH_PERSISTENCE_MODE', 'DB_ONLY');
  vi.stubEnv('WUJIE_DEPLOYMENT_DB_ONLY', '1'); // only the synthetic storage above
  vi.stubEnv('WUJIE_DESKTOP_TOKEN_SECRET', SECRET);
  balance = 100; totalUsed = 0; ledger = [];
  chargeFault = 'none'; refundFault = 'none';
  chargeAttempts = 0; refundAttempts = 0; refundLookups = 0; providerCalls = 0;
  boundary.users.mockResolvedValue([{ id: OWNER, name: 'OMP fixture', password_hash: 'synthetic-unused',
    credential_hash: null, role: 'user', status: 'active', product_type: 'canvas,chat',
    api_permissions: {}, chat_models: [`${PROVIDER}::${MODEL}`], image_models: [],
    storage_folder: OWNER, created_at: 1, updated_at: 1 }]);
  boundary.providers.mockImplementation(async () => [providerRow()]);
  boundary.setting.mockImplementation(async (key: string) => key === 'credit_pricing_config'
    ? JSON.stringify({ modelCredits: { [MODEL]: 7 } }) : null);
  boundary.credits.mockImplementation(async () => ({ user_id: OWNER, balance, total_used: totalUsed }));
  // Strict synthetic SQL boundary: unknown queries fail, no real connection exists.
  boundary.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('WHERE key = ANY')) {
      return { rows: [{ key: 'auth_secret', value: SECRET }] };
    }
    if (sql.includes('WITH deducted AS')) {
      chargeAttempts++;
      expect(args[2]).toBe(OWNER);
      if (chargeFault === 'before-commit') throw Error('synthetic charge unavailable');
      const amount = Number(args[0]);
      if (balance < amount) return { rows: [] };
      balance -= amount; totalUsed += amount;
      ledger.push({ type: 'consume', amount: -amount, userId: String(args[2]), reference: String(args[5]) });
      if (chargeFault === 'after-commit') throw Error('synthetic charge acknowledgement lost');
      return { rows: [{ balance }] };
    }
    if (sql.includes('SELECT tx.user_id')) {
      refundLookups++;
      return { rows: ledger.filter(entry => entry.type === 'refund' && entry.reference === args[0])
        .map(entry => ({ user_id: entry.userId, amount: entry.amount, balance })) };
    }
    if (sql.includes('WITH updated AS')) {
      refundAttempts++;
      expect(args[3]).toBe(OWNER);
      expect(args[0]).toBe(args[1]);
      expect(args[5]).toBe(args[7]);
      if (refundFault === 'before-commit') throw Error('synthetic refund unavailable');
      const amount = Number(args[0]);
      balance += amount; totalUsed = Math.max(totalUsed - amount, 0);
      ledger.push({ type: 'refund', amount, userId: String(args[3]), reference: String(args[5]) });
      if (refundFault === 'after-commit') throw Error('synthetic refund acknowledgement lost');
      return { rows: [{ balance }] };
    }
    throw Error(`Unexpected synthetic SQL: ${sql}`);
  });
  providerReply = async () => completion('{"prompt":"完整的玩具熊提示词","sections":{"subject":"玩具熊"}}');
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
    expect(String(url), 'all network requests must stay at the synthetic provider boundary').toBe(PROVIDER_URL);
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body)).model).toBe(MODEL);
    providerCalls++;
    return providerReply(options);
  }));
  consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach((context) => {
  if (process.env.OMP_REFUND_EVIDENCE === '1') {
    console.info('OMP_REFUND_EVIDENCE', JSON.stringify({ test: context.task.name, balance, totalUsed,
      chargeAttempts, refundAttempts, refundLookups, providerCalls, ledger,
      errors: consoleErrors.mock.calls.map(args => args.map(String)) }));
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function expectRefund(): void {
  expect(chargeAttempts).toBe(1);
  expect(refundAttempts, 'one refund write for one failed charged request').toBe(1);
  expect(refundLookups).toBe(1);
  expect(balance).toBe(100);
  expect(totalUsed).toBe(0);
  expect(ledger.map(({ type, amount, userId }) => ({ type, amount, userId }))).toEqual([
    { type: 'consume', amount: -7, userId: OWNER }, { type: 'refund', amount: 7, userId: OWNER },
  ]);
  expect(ledger[1].reference).toMatch(/^refund-omp-agent-[0-9a-f-]{36}$/);
}

describe('OMP charged failure terminals (review-other #14)', () => {
  it('returns a safe upstream error without losing its original status or refund', async () => {
    providerReply = async () => Response.json({ error: { message: '供应商内部异常 synthetic-private-diagnostic' } }, { status: 400 });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: '服务暂时出错，请稍后重试或切换模型' });
    expectRefund();
  });

  it('refunds no-provider after a confirmed charge, preserving 400', async () => {
    boundary.providers.mockResolvedValue([{ ...providerRow(), is_enabled: false }]);
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: '未配置聊天模型，请先在管理面板添加 LLM 模型提供商' });
    expect(providerCalls).toBe(0);
    expectRefund();
  });

  it('refunds no-model after a confirmed charge, preserving 400', async () => {
    boundary.providers.mockResolvedValue([{ ...providerRow(), selected_models: [] }]);
    const response = await POST(request({ model: '' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: '未选择聊天模型' });
    // No requested model retains the existing default chat cost (2).
    expect(ledger.map(entry => entry.amount)).toEqual([-2, 2]);
    expect(balance).toBe(100); expect(totalUsed).toBe(0);
    expect(refundAttempts).toBe(1); expect(refundLookups).toBe(1); expect(providerCalls).toBe(0);
  });

  it.each([400, 429, 503])('refunds upstream HTTP %i once, preserving status', async (status) => {
    providerReply = async () => Response.json({ error: { message: 'rate limit' } }, { status });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ success: false, error: '请求过于频繁，请稍后再试' });
    expectRefund();
  });

  it.each(['json', 'sse', 'unlabelled-sse'])('refunds empty %s content once, preserving 500', async (format) => {
    providerReply = async () => format === 'json' ? completion('  ') : new Response(
      'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': format === 'sse' ? 'text/event-stream' : 'text/plain' } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'API 返回空内容' });
    expectRefund();
  });

  it('refunds the actual timeout/abort terminal once, preserving 408', async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const arrived = new Promise<void>(resolve => { started = resolve; });
    providerReply = async (options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      started();
    });
    const pending = POST(request());
    await arrived;
    await vi.advanceTimersByTimeAsync(300_000);
    const response = await pending;
    expect(response.status).toBe(408);
    expect(await response.json()).toEqual({ success: false, error: '请求超时，请重试' });
    expect(vi.getTimerCount()).toBe(0);
    expectRefund();
  });

  it.each(['invalid-json', 'transport', 'prompt-builder'])('retains one refund for existing outer catch: %s', async (kind) => {
    if (kind === 'invalid-json') providerReply = async () => new Response('not-json');
    if (kind === 'transport') providerReply = async () => { throw Error('synthetic connection reset'); };
    const response = await POST(request(kind === 'prompt-builder' ? { templateCategory: 'invalid' } : {}));
    expect(response.status).toBe(500);
    expect((await response.json()).success).toBe(false);
    expectRefund();
  });

  it('does not refund twice when HTTP error response construction reaches the outer catch', async () => {
    // JSON bodies are forbidden with 304: NextResponse.json throws after the
    // upstream failure refund, exercising both terminal error handlers for real.
    providerReply = async () => new Response(null, { status: 304 });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expectRefund();
  });

  it.each(['before-commit', 'after-commit'] as const)('does not retry an uncertain refund (%s) in the outer catch', async (fault) => {
    refundFault = fault;
    providerReply = async () => new Response(null, { status: 304 });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(refundAttempts).toBe(1); expect(refundLookups).toBe(1);
    expect(balance).toBe(fault === 'before-commit' ? 93 : 100);
    expect(ledger.filter(entry => entry.type === 'refund')).toHaveLength(fault === 'before-commit' ? 0 : 1);
    expect(consoleErrors).toHaveBeenCalled();
  });

  it('uses distinct refund references for separate failed requests', async () => {
    providerReply = async () => Response.json({ error: { message: 'rate limit' } }, { status: 429 });
    const responses = [await POST(request()), await POST(request())];
    expect(responses.map(response => response.status)).toEqual([429, 429]);
    const refunds = ledger.filter(entry => entry.type === 'refund');
    expect(chargeAttempts).toBe(2); expect(refundAttempts).toBe(2); expect(refunds).toHaveLength(2);
    expect(new Set(refunds.map(entry => entry.reference)).size).toBe(2);
    expect(balance).toBe(100); expect(totalUsed).toBe(0);
  });
});

describe('OMP non-refundable boundaries', () => {
  it.each(['json', 'sse', 'ecommerce'])('keeps a successful %s charge without refund', async (kind) => {
    if (kind === 'sse') providerReply = async () => new Response(
      'data: {"choices":[{"delta":{"content":"完整提示词"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } });
    if (kind === 'ecommerce') providerReply = async () => completion(
      '{"prompts":[{"type":"主图","typeEn":"Main","prompt":"玩具熊主图","aspectRatio":"1:1"}]}');
    const response = await POST(request(kind === 'ecommerce' ? { templateCategory: 'ecommerce',
      ecommerceConfig: { platform: 'amazon', market: 'usa', language: 'en', aspectRatio: '1:1',
        sellingPoints: '', setStructure: 'smart' } } : {}));
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(balance).toBe(93); expect(totalUsed).toBe(7);
    expect(ledger.map(entry => entry.type)).toEqual(['consume']);
    expect(refundAttempts).toBe(0); expect(refundLookups).toBe(0);
  });

  it.each(['anonymous', 'invalid-input', 'insufficient', 'charge-unavailable', 'charge-unknown', 'free', 'desktop'])
    ('does not invent a refund for %s', async (kind) => {
      if (kind === 'insufficient') balance = 1;
      if (kind === 'charge-unavailable') chargeFault = 'before-commit';
      if (kind === 'charge-unknown') chargeFault = 'after-commit';
      if (kind === 'free') boundary.setting.mockResolvedValue(JSON.stringify({ modelCredits: { [MODEL]: 0 } }));
      providerReply = async () => Response.json({ error: { message: 'rate limit' } }, { status: 503 });
      const response = await POST(request(kind === 'invalid-input' ? { inputText: ' ' } : {},
        kind === 'anonymous' ? 'none' : kind === 'desktop' ? 'desktop' : 'web'));
      const status = kind === 'anonymous' ? 401 : kind === 'invalid-input' ? 400
        : ['insufficient', 'charge-unavailable', 'charge-unknown'].includes(kind) ? 402 : 503;
      expect(response.status).toBe(status);
      expect((await response.json()).success).toBe(false);
      expect(refundAttempts).toBe(0); expect(refundLookups).toBe(0);
      expect(ledger.filter(entry => entry.type === 'refund')).toEqual([]);
      expect(balance).toBe(kind === 'insufficient' ? 1 : kind === 'charge-unknown' ? 93 : 100);
      expect(chargeAttempts).toBe(['insufficient', 'charge-unavailable', 'charge-unknown'].includes(kind) ? 1 : 0);
      expect(providerCalls).toBe(['free', 'desktop'].includes(kind) ? 1 : 0);
    });
});
