import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/user-types';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
// Controlled authentication boundary; actual POST, normalization, settings,
// charge/refund SQL remain real. This does not claim a login test.
vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: async (request: NextRequest): Promise<User | null> =>
    request.headers.get('x-test-admin') === 'pricing-admin'
      ? { id: 'pricing-admin', name: 'Pricing admin', role: 'admin',
          status: 'active', createdAt: 1, updatedAt: 1 } as User
      : null,
}));

import { POST } from '@/app/api/admin/credits/pricing/route';
import { ensureCoreTables } from '@/lib/db-storage';
import { CREDIT_PRICING_CONFIG_KEY, loadCreditPricingConfig, saveCreditPricingConfig,
  resolveConfiguredCreditCost } from '@/lib/credit-pricing';
import { consumeCredits, settleTokenCharge } from '@/lib/credits';

const modelKey = 'pricing-provider::pricing-model';
type PriceField = 'credits' | 'quality' | 'resolution' | 'token-input' | 'token-output';

function entryWith(field: PriceField, value: unknown): Record<string, unknown> {
  const entry: Record<string, unknown> = { credits: 9 };
  if (field === 'credits') entry.credits = value;
  if (field === 'quality') entry.quality = { high: value };
  if (field === 'resolution') entry.resolution = { '2048': value };
  if (field === 'token-input') entry.tokenPricing = { input: value, output: 1 };
  if (field === 'token-output') entry.tokenPricing = { input: 1, output: value };
  return entry;
}

function pricingRequest(entry: unknown, admin = true): NextRequest {
  return new NextRequest('http://localhost/api/admin/credits/pricing', {
    method: 'POST', headers: { 'content-type': 'application/json',
      ...(admin ? { 'x-test-admin': 'pricing-admin' } : {}) },
    body: JSON.stringify({ modelCredits: { [modelKey]: entry } }),
  });
}

async function readSetting(query: QueryFn): Promise<unknown[]> {
  return (await query('SELECT value, updated_at FROM wujie_system_settings WHERE key=$1',
    [CREDIT_PRICING_CONFIG_KEY])).rows;
}

async function seedPricing(): Promise<void> {
  await ensureCoreTables();
  await saveCreditPricingConfig({ modelCredits: { [modelKey]: 9 } });
}

async function seedTokenBilling(query: QueryFn): Promise<void> {
  await ensureCoreTables();
  await query(`INSERT INTO wujie_credits
    (id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    VALUES ('token-credit','token-owner',100,100,0,1,1)`);
  await saveCreditPricingConfig({ modelCredits: {
    [modelKey]: { credits: 10, tokenPricing: { input: 1, output: 1 } },
  } });
  expect(await consumeCredits('token-owner', 'chat', 10, 'precharge', 'pricing-model'))
    .toMatchObject({ success: true, balance: 90, cost: 10 });
}

async function rejectLedgerInsert(query: QueryFn, type: 'refund' | 'consume'): Promise<void> {
  // Nontransactional sequence proves one real attempt even when the CTE rolls back.
  await query('CREATE SEQUENCE rejected_ledger_attempts');
  await query(`CREATE FUNCTION reject_token_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.type = '${type}' THEN
        PERFORM nextval('rejected_ledger_attempts');
        RAISE EXCEPTION 'isolated token ledger rejection' USING ERRCODE='22012';
      END IF;
      RETURN NEW;
    END $$`);
  await query(`CREATE TRIGGER reject_token_ledger BEFORE INSERT ON wujie_credit_transactions
    FOR EACH ROW EXECUTE FUNCTION reject_token_ledger()`);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('administrator price input and real Token settlement', () => {
  const invalidCases: Array<{ field: PriceField; label: string; value: unknown }> = [];
  for (const field of ['credits', 'quality', 'resolution'] as const) {
    for (const [label, value] of [
      ['null', null], ['false', false], ['true', true], ['empty', ''],
      ['blank', '  \t'], ['array', []], ['numeric-array', [0]],
    ] as const) invalidCases.push({ field, label, value });
  }
  for (const field of ['token-input', 'token-output'] as const) {
    invalidCases.push({ field, label: 'true', value: true });
    invalidCases.push({ field, label: 'numeric-array', value: [1] });
  }

  it.each(invalidCases)('rejects $field $label before changing persisted pricing', async ({ field, value }) => {
    await withIsolatedPostgres('task-pricing-invalid', async ({ query }): Promise<void> => {
      await seedPricing();
      const before = await readSetting(query);
      const response = await POST(pricingRequest(entryWith(field, value)));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ success: false });
      expect(await readSetting(query)).toEqual(before);
      expect((await loadCreditPricingConfig()).modelCredits).toEqual({ [modelKey]: 9 });
    });
  }, 30_000);

  it.each([0, '0', ' 0 ', '7'] as const)('preserves intentional price %s and numeric-string compatibility', async value => {
    await withIsolatedPostgres('task-pricing-valid', async ({ query }): Promise<void> => {
      await seedPricing();
      const response = await POST(pricingRequest({
        credits: value, quality: { high: value }, resolution: { '2048': value },
        tokenPricing: { input: ' 2 ', output: 3 },
      }));
      const cost = value === '7' ? 7 : 0;
      expect(response.status).toBe(200);
      const config = await loadCreditPricingConfig();
      expect(config.modelCredits).toEqual({ [modelKey]: {
        credits: cost, quality: { high: cost }, resolution: { '2048': cost },
        tokenPricing: { input: 2, output: 3 },
      } });
      expect(resolveConfiguredCreditCost(config, 'pricing-model', 'high', undefined, 99,
        'pricing-provider')).toBe(cost);
      expect(resolveConfiguredCreditCost(config, 'pricing-model', undefined, '2048', 99,
        'pricing-provider')).toBe(cost);
      expect((await readSetting(query)).length).toBe(1);
    });
  }, 30_000);

  it('preserves flat explicit zero and refuses unauthenticated pricing writes', async () => {
    await withIsolatedPostgres('task-pricing-auth-zero', async ({ query }): Promise<void> => {
      await seedPricing();
      expect((await POST(pricingRequest(0))).status).toBe(200);
      expect((await loadCreditPricingConfig()).modelCredits).toEqual({ [modelKey]: 0 });
      const before = await readSetting(query);
      expect((await POST(pricingRequest(8, false))).status).toBe(403);
      expect(await readSetting(query)).toEqual(before);
    });
  }, 30_000);

  it('reports retained precharge when real refund SQL fails, without another refund attempt', async () => {
    await withIsolatedPostgres('task-token-refund-failure', async ({ query }): Promise<void> => {
      await seedTokenBilling(query);
      await rejectLedgerInsert(query, 'refund');
      const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const settled = await settleTokenCharge('token-owner', 'pricing-model', 'pricing-provider',
        { inputTokens: 1000, outputTokens: 0 }, 10, 'Token test');
      expect(settled).toBe(10);
      expect((await query('SELECT balance,total_used FROM wujie_credits')).rows)
        .toEqual([{ balance: 90, total_used: 10 }]);
      expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
        .toEqual([{ type: 'consume', amount: -10 }]);
      expect((await query('SELECT last_value::int AS attempts FROM rejected_ledger_attempts')).rows)
        .toEqual([{ attempts: 1 }]);
      expect(warnings.mock.calls).toEqual([[expect.objectContaining({
        code: 'TOKEN_SETTLEMENT_REFUND_FAILED', preChargedCredits: 10, refundAmount: 9,
      })]]);
      expect(errors.mock.calls).toContainEqual([
        '[credits] refundCredits error:',
        expect.objectContaining({ code: '22012', message: 'isolated token ledger rejection' }),
      ]);
    });
  }, 30_000);

  it('returns actual cost only after the real refund updates balance and ledger', async () => {
    await withIsolatedPostgres('task-token-refund-success', async ({ query }): Promise<void> => {
      await seedTokenBilling(query);
      expect(await settleTokenCharge('token-owner', 'pricing-model', 'pricing-provider',
        { inputTokens: 1000, outputTokens: 0 }, 10, 'Token test')).toBe(1);
      expect((await query('SELECT balance,total_used FROM wujie_credits')).rows)
        .toEqual([{ balance: 99, total_used: 1 }]);
      expect((await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY amount')).rows)
        .toEqual([{ type: 'consume', amount: -10 }, { type: 'refund', amount: 9 }]);
    });
  }, 30_000);

  it('keeps successful top-up settlement and its real balance movement', async () => {
    await withIsolatedPostgres('task-token-topup-success', async ({ query }): Promise<void> => {
      await seedTokenBilling(query);
      expect(await settleTokenCharge('token-owner', 'pricing-model', 'pricing-provider',
        { inputTokens: 20_000_000, outputTokens: 0 }, 10, 'Token test')).toBe(20);
      expect((await query('SELECT balance,total_used FROM wujie_credits')).rows)
        .toEqual([{ balance: 80, total_used: 20 }]);
      expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
        .toEqual([{ type: 'consume', amount: -10 }, { type: 'consume', amount: -10 }]);
    });
  }, 30_000);

  it('keeps the existing retained-precharge contract on real top-up SQL failure', async () => {
    await withIsolatedPostgres('task-token-topup-failure', async ({ query }): Promise<void> => {
      await seedTokenBilling(query);
      await rejectLedgerInsert(query, 'consume');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await settleTokenCharge('token-owner', 'pricing-model', 'pricing-provider',
        { inputTokens: 20_000_000, outputTokens: 0 }, 10, 'Token test')).toBe(10);
      expect((await query('SELECT balance,total_used FROM wujie_credits')).rows)
        .toEqual([{ balance: 90, total_used: 10 }]);
      expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
        .toEqual([{ type: 'consume', amount: -10 }]);
      expect((await query('SELECT last_value::int AS attempts FROM rejected_ledger_attempts')).rows)
        .toEqual([{ attempts: 1 }]);
    });
  }, 30_000);
});
