import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/user-types';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
const boundary = vi.hoisted(() => ({ providers: vi.fn(), providerFetch: vi.fn() }));
// Authentication and external provider I/O are controlled boundaries. Actual
// route, price settings, balance mutations and refund ledger remain real.
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: async (request: NextRequest): Promise<User | null> =>
    request.headers.get('x-test-user') === 'vision-owner'
      ? { id: 'vision-owner', name: 'Vision owner', role: 'user', status: 'active',
          chatModels: ['vision-provider::vision-model'], createdAt: 1, updatedAt: 1 }
      : null,
}));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: boundary.providers,
  findProviderForModel: async (): Promise<null> => null,
  normalizeApiBaseUrl: (url: string): string => url,
}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: boundary.providerFetch }));

import { POST } from '@/app/api/vision-prompt/route';
import { ensureCoreTables } from '@/lib/db-storage';
import { saveCreditPricingConfig } from '@/lib/credit-pricing';

const validProvider = { id: 'vision-provider', name: 'Vision fixture', type: 'chat',
  modelType: 'chat', isEnabled: true, apiKey: 'offline-fixture-only',
  baseUrl: 'https://provider.invalid/v1', selectedModels: ['vision-model'], providerPreset: 'openai' };

beforeEach(() => {
  boundary.providers.mockResolvedValue([validProvider]);
  boundary.providerFetch.mockImplementation(async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ message: { content: '{"zh":{"prompt":"fixture"}}' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline source failure')));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

function request(overrides: Record<string, unknown> = {}, authenticated = true): NextRequest {
  return new NextRequest('http://localhost/api/vision-prompt', {
    method: 'POST', headers: { 'content-type': 'application/json',
      ...(authenticated ? { 'x-test-user': 'vision-owner' } : {}) },
    body: JSON.stringify({ imageUrl: 'data:image/png;base64,AQID', model: 'vision-model',
      providerId: 'vision-provider', ...overrides }),
  });
}

async function seed(query: QueryFn, balance: number = 100): Promise<void> {
  await ensureCoreTables();
  await saveCreditPricingConfig({ modelCredits: { 'vision-model': 9 } });
  await query(`INSERT INTO wujie_credits
    (id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    VALUES ('vision-credit','vision-owner',$1,$1,0,1,1)`, [balance]);
}
async function balanceRows(query: QueryFn): Promise<unknown[]> {
  return (await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='vision-owner'")).rows;
}
async function ledgerRows(query: QueryFn): Promise<unknown[]> {
  return (await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY created_at,type')).rows;
}

describe('vision prompt authenticated real PostgreSQL billing boundary', () => {
  it.each(['/api/serve-upload/users/private.png', '/api/serve-upload/system/providers.json', '/settings.json'])
    ('rejects non-public %s before creating even a refunded charge', async (imageUrl) => {
      await withIsolatedPostgres('vision-private-admission', async ({ query }): Promise<void> => {
        await seed(query);
        const response = await POST(request({ imageUrl }));
        expect(await balanceRows(query)).toEqual([{ balance: 100, total_used: 0 }]);
        expect(await ledgerRows(query)).toEqual([]);
        expect(response.status).toBe(400);
        expect(boundary.providers).not.toHaveBeenCalled();
        expect(boundary.providerFetch).not.toHaveBeenCalled();
      });
    }, 60_000);

  it('rejects an anonymous caller before provider access or any charge', async () => {
    await withIsolatedPostgres('vision-anonymous', async ({ query }): Promise<void> => {
      await seed(query);
      expect((await POST(request({}, false))).status).toBe(401);
      expect(boundary.providers).not.toHaveBeenCalled();
      expect(boundary.providerFetch).not.toHaveBeenCalled();
      expect(await balanceRows(query)).toEqual([{ balance: 100, total_used: 0 }]);
      expect(await ledgerRows(query)).toEqual([]);
    });
  }, 60_000);

  it.each(['missing-provider', 'no-model'])('does not charge a rejected %s request', async (failure) => {
    await withIsolatedPostgres('vision-rejected-selection', async ({ query }): Promise<void> => {
      await seed(query);
      if (failure === 'no-model') boundary.providers.mockResolvedValue([]);
      const response = await POST(request(failure === 'missing-provider'
        ? { providerId: 'missing-provider' } : { model: '', providerId: '' }));
      expect(response.status).toBe(400);
      expect(await balanceRows(query)).toEqual([{ balance: 100, total_used: 0 }]);
      expect(await ledgerRows(query)).toEqual([]);
      expect(boundary.providerFetch).not.toHaveBeenCalled();
    });
  }, 60_000);

  const failures: Array<{ kind: string; status: number }> = [
    { kind: 'http-503', status: 503 }, { kind: 'http-400', status: 400 },
    { kind: 'invalid-json', status: 502 }, { kind: 'transport', status: 503 },
    { kind: 'source-conversion', status: 500 },
  ];
  it.each(failures)('refunds exactly once on $kind without changing its HTTP error status', async ({ kind, status }) => {
    await withIsolatedPostgres('vision-failed-request', async ({ query }): Promise<void> => {
      await seed(query);
      if (kind.startsWith('http-')) boundary.providerFetch.mockResolvedValue(new Response(
        JSON.stringify({ error: { message: 'fixture upstream failure' } }), { status }));
      if (kind === 'invalid-json') boundary.providerFetch.mockResolvedValue(new Response('not-json',
        { status: 200, headers: { 'content-type': 'application/json' } }));
      if (kind === 'transport') boundary.providerFetch.mockRejectedValue(new Error('fixture transport failure'));
      const response = await POST(request(kind === 'source-conversion'
        ? { imageUrl: 'https://source.invalid/fixture.png' } : {}));
      expect(response.status).toBe(status);
      expect(await balanceRows(query)).toEqual([{ balance: 100, total_used: 0 }]);
      expect(await ledgerRows(query)).toEqual([{ type: 'consume', amount: -9 }, { type: 'refund', amount: 9 }]);
      expect(boundary.providerFetch).toHaveBeenCalledTimes(kind === 'source-conversion' ? 0 : 1);
    });
  }, 60_000);

  it('charges one authenticated successful analysis and does not refund it', async () => {
    await withIsolatedPostgres('vision-success', async ({ query }): Promise<void> => {
      await seed(query);
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, model: 'vision-model', data: { zh: { prompt: 'fixture' } } });
      expect(await balanceRows(query)).toEqual([{ balance: 91, total_used: 9 }]);
      expect(await ledgerRows(query)).toEqual([{ type: 'consume', amount: -9 }]);
      expect(boundary.providerFetch).toHaveBeenCalledOnce();
    });
  }, 60_000);

  it('does not call the provider after insufficient-credit admission', async () => {
    await withIsolatedPostgres('vision-insufficient', async ({ query }): Promise<void> => {
      await seed(query, 8);
      expect((await POST(request())).status).toBe(402);
      expect(await balanceRows(query)).toEqual([{ balance: 8, total_used: 0 }]);
      expect(await ledgerRows(query)).toEqual([]);
      expect(boundary.providerFetch).not.toHaveBeenCalled();
    });
  }, 60_000);

  it('preserves a real refund SQL failure without retrying it or masking the upstream error', async () => {
    await withIsolatedPostgres('vision-refund-failure', async ({ query }): Promise<void> => {
      await seed(query);
      await query('CREATE SEQUENCE refund_attempts');
      await query(`CREATE FUNCTION reject_vision_refund() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.type='refund' THEN
          PERFORM nextval('refund_attempts');
          RAISE EXCEPTION 'isolated vision refund rejection' USING ERRCODE='22012';
        END IF; RETURN NEW; END $$`);
      await query('CREATE TRIGGER reject_vision_refund BEFORE INSERT ON wujie_credit_transactions FOR EACH ROW EXECUTE FUNCTION reject_vision_refund()');
      boundary.providerFetch.mockResolvedValue(new Response('fixture upstream failure', { status: 503 }));
      expect((await POST(request())).status).toBe(503);
      expect(await balanceRows(query)).toEqual([{ balance: 91, total_used: 9 }]);
      expect(await ledgerRows(query)).toEqual([{ type: 'consume', amount: -9 }]);
      expect((await query('SELECT last_value,is_called FROM refund_attempts')).rows)
        .toEqual([{ last_value: '1', is_called: true }]);
      expect(console.warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'VISION_PROMPT_REFUND_FAILED', userId: 'vision-owner', credits: 9 }));
      expect(boundary.providerFetch).toHaveBeenCalledOnce();
    });
  }, 60_000);
});
