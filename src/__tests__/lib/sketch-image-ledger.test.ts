import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { quoteSketchImagePricing, type SketchImagePricing } from '@/lib/sketch-to-code/image-pricing';
import { lockSketchImageLedger, settleSketchImageCredits, verifySketchImageSettlement,
  type SketchImageLedgerTaskRow } from '@/lib/sketch-to-code/image-ledger';

vi.mock('server-only', () => ({}));

const PG_MAX = 2_147_483_647;
const taskId = 'skimg_fixture';
const selection = { visionProviderId: 'vision-provider', visionModelId: 'same-model',
  imageProviderId: 'image-provider', imageModelId: 'same-model' };
const token: SketchImagePricing = { version: 1,
  vision: { providerId: selection.visionProviderId, modelId: selection.visionModelId, calls: 1,
    mode: 'token', reserveCredits: 7, tokenPricing: { input: 1_000_000, output: 2_000_000 } },
  image: { providerId: selection.imageProviderId, modelId: selection.imageModelId, calls: 1, credits: 30 },
  totalReserveCredits: 37 };
const flat: SketchImagePricing = { ...token, vision: { providerId: selection.visionProviderId,
  modelId: selection.visionModelId, calls: 1, mode: 'flat', reserveCredits: 7 } };
const free: SketchImagePricing = { ...flat, vision: { ...flat.vision, reserveCredits: 0 },
  image: { ...flat.image, credits: 0 }, totalReserveCredits: 0 };
interface SqlCall { sql: string; values: unknown[] }
interface Transaction { id: string; user_id: string; type: string; amount: unknown; balance_after: unknown;
  model: string; task_id: string; reference_id: string }

// Original parameterized SQL boundary, in memory only. Unknown SQL is an error:
// an accidental BEGIN/COMMIT, task write, initialization or extra service cannot hide.
function fixture(pricing: SketchImagePricing = token): {
  client: PoolClient; task: SketchImageLedgerTaskRow; credit: { balance: unknown; total_used: unknown } | null;
  transactions: Transaction[]; calls: SqlCall[]; updateMode: string; insertFailure: boolean;
} {
  const reserve = pricing.totalReserveCredits;
  const task: SketchImageLedgerTaskRow = { id: taskId, user_id: 'actor', project_id: 'project',
    type: 'sketch-to-image', status: 'processing', model: selection.imageModelId, provider_id: selection.imageProviderId,
    credit_cost: reserve, charged_transaction_id: reserve ? createTaskBillingTransactionId('charge', taskId) : null,
    refunded_transaction_id: null, credit_status: reserve ? 'pending' : 'not-applicable',
    result: { sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', requestDigest: 'a'.repeat(64),
      input: { projectId: 'project', ...selection, instruction: 'test', imageDataUrl: 'synthetic-png',
        idempotencyKey: 'nonce', aspectRatio: '1:1' },
      access: { kind: 'personal', actorUserId: 'actor', projectId: 'project', ownerId: 'actor' },
      pricing: structuredClone(pricing) } } };
  const transactions: Transaction[] = reserve ? [{ id: task.charged_transaction_id!, user_id: 'actor',
    type: 'consume', amount: -reserve, balance_after: 100 - reserve, model: task.model, task_id: taskId, reference_id: taskId }] : [];
  const state: ReturnType<typeof fixture> = { client: {} as PoolClient, task, credit: reserve ? { balance: 100 - reserve, total_used: reserve } : null,
    transactions, calls: [] as SqlCall[], updateMode: 'normal', insertFailure: false };
  const query = async (sql: string, values: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
    state.calls.push({ sql, values: structuredClone(values) });
    if (sql.includes('SELECT balance,total_used FROM wujie_credits')) {
      if (values.length !== 1 || values[0] !== task.user_id || !/FOR (UPDATE|SHARE)$/.test(sql)) throw new Error('SQL_CREDIT_LOCK');
      return { rows: state.credit ? [{ ...state.credit }] : [], rowCount: state.credit ? 1 : 0 };
    }
    if (sql.includes('FROM wujie_credit_transactions')) {
      if (values[0] !== task.id || !Array.isArray(values[1]) || !/ORDER BY id FOR (UPDATE|SHARE)$/.test(sql)) throw new Error('SQL_LEDGER_LOCK');
      const ids = values[1] as unknown[];
      const rows = state.transactions.filter(tx => tx.task_id === values[0] || tx.reference_id === values[0] || ids.includes(tx.id));
      return { rows: rows.map(tx => ({ ...tx })), rowCount: rows.length };
    }
    if (sql.startsWith('UPDATE wujie_credits')) {
      if (values.length !== 3 || values[2] !== task.user_id || !sql.includes('RETURNING balance,total_used')) throw new Error('SQL_UPDATE');
      if (state.updateMode === 'missing') return { rows: [], rowCount: 0 };
      state.credit = { balance: values[0] as number, total_used: values[1] as number };
      const row = { ...state.credit };
      if (state.updateMode === 'wrong') row.balance = Number(row.balance) + 1;
      return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO wujie_credit_transactions')) {
      if (state.insertFailure) throw new Error('SQL_INSERT_FAILED');
      if (state.updateMode === 'silent-insert') return { rows: [], rowCount: 0 };
      if (values.length !== 8 || values[1] !== task.user_id || values[7] !== task.id || typeof values[5] !== 'string') throw new Error('SQL_INSERT');
      if (state.transactions.some(tx => tx.id === values[0])) throw new Error('SQL_DUPLICATE');
      state.transactions.push({ id: values[0] as string, user_id: values[1] as string, type: values[2] as string,
        amount: values[3], balance_after: values[4], model: values[6] as string, task_id: values[7] as string, reference_id: values[7] as string });
      return { rows: [], rowCount: 1 };
    }
    throw new Error('SQL_OUTSIDE_LEDGER');
  };
  state.client = { query } as unknown as PoolClient;
  return state;
}
function writes(f: ReturnType<typeof fixture>): SqlCall[] {
  return f.calls.filter(call => /^(UPDATE|INSERT)/.test(call.sql));
}
function admission(f: ReturnType<typeof fixture>): Record<string, unknown> {
  return f.task.result.sketchImageAdmission as Record<string, unknown>;
}
async function completed(pricing: SketchImagePricing = token, usage?: unknown): Promise<{
  f: ReturnType<typeof fixture>; projections: Record<string, unknown>[];
}> {
  const f = fixture(pricing);
  const ledger = await lockSketchImageLedger(f.client, f.task);
  const settlement = await settleSketchImageCredits(f.client, ledger, usage);
  f.task.status = 'completed'; f.task.credit_status = pricing.totalReserveCredits ? 'charged' : 'not-applicable';
  f.task.result.sketchImageSettlement = structuredClone(settlement);
  return { f, projections: [0, 1, 2].map(() => structuredClone(settlement) as unknown as Record<string, unknown>) };
}

describe('original image ledger locks and immutable evidence', () => {
  it.each([false, true])('locks original rows in order with readOnly=%s and never freezes the live client', async readOnly => {
    const f = fixture(); const ledger = await lockSketchImageLedger(f.client, f.task, readOnly);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].values).toEqual(['actor']);
    expect(f.calls[1].values[0]).toBe(taskId);
    expect(f.calls[1].values[1]).toContain(createTaskBillingTransactionId('charge', taskId));
    expect(f.calls.every(call => call.sql.endsWith(readOnly ? 'FOR SHARE' : 'FOR UPDATE'))).toBe(true);
    expect(ledger).toMatchObject({ balance: 63, totalUsed: 37, chargeId: f.task.charged_transaction_id, pricing: token });
    expect([ledger, ledger.task, ledger.task.result, ledger.pricing, ledger.pricing.vision, ledger.transactions, ledger.transactions[0]].every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(f.client)).toBe(false); expect(Object.isFrozen(f.task)).toBe(false);
    (admission(f).input as Record<string, unknown>).visionProviderId = 'changed'; f.transactions[0].amount = -999;
    expect((ledger.task.result.sketchImageAdmission as { input: { visionProviderId: string } }).input.visionProviderId).toBe('vision-provider');
    expect(ledger.transactions[0].amount).toBe(-37);
  });
  it('free0 locks empty ledger without initializing or requiring a credit account', async () => {
    const f = fixture(free); const ledger = await lockSketchImageLedger(f.client, f.task);
    expect(ledger).toMatchObject({ pricing: free, balance: null, totalUsed: null, chargeId: null, transactions: [] });
    expect(f.credit).toBeNull(); expect(f.calls).toHaveLength(2); expect(writes(f)).toEqual([]);
  });
  it('free0 validates an existing account but neither creates nor charges it', async () => {
    const f = fixture(free); f.credit = { balance: PG_MAX, total_used: 0 };
    const ledger = await lockSketchImageLedger(f.client, f.task);
    expect(ledger).toMatchObject({ balance: PG_MAX, totalUsed: 0 });
    expect(await settleSketchImageCredits(f.client, ledger, undefined)).toMatchObject({ actualCredits: 0, chargedTransactionId: null });
    expect(writes(f)).toEqual([]);
  });
  it.each(['balance', 'total_used'])('rejects negative existing account %s', async field => {
    const f = fixture(); f.credit![field as 'balance' | 'total_used'] = -1;
    await expect(lockSketchImageLedger(f.client, f.task)).rejects.toThrow(); expect(writes(f)).toEqual([]);
  });
  it.each(['type', 'id', 'actor', 'project', 'model', 'provider', 'status', 'credit-status', 'charge-id', 'refund-id',
    'price-total', 'vision-provider', 'vision-model', 'image-provider', 'image-model', 'input-project', 'missing-input'])(
    'rejects task/input binding %s before SQL', async variant => {
      const f = fixture(); const input = admission(f).input as Record<string, unknown>;
      if (variant === 'type') f.task.type = 'sketch-to-code';
      if (variant === 'id') f.task.id = 'sketch_fixture';
      if (variant === 'actor') f.task.user_id = '';
      if (variant === 'project') f.task.project_id = '';
      if (variant === 'model') f.task.model = 'other';
      if (variant === 'provider') f.task.provider_id = 'vision-provider';
      if (variant === 'status') f.task.status = 'cancelled';
      if (variant === 'credit-status') f.task.credit_status = 'charged';
      if (variant === 'charge-id') f.task.charged_transaction_id = 'other';
      if (variant === 'refund-id') f.task.refunded_transaction_id = createTaskBillingTransactionId('refund', taskId);
      if (variant === 'price-total') f.task.credit_cost = 38;
      if (variant === 'vision-provider') input.visionProviderId = 'image-provider';
      if (variant === 'vision-model') input.visionModelId = 'other';
      if (variant === 'image-provider') input.imageProviderId = 'vision-provider';
      if (variant === 'image-model') input.imageModelId = 'other';
      if (variant === 'input-project') input.projectId = 'other';
      if (variant === 'missing-input') delete admission(f).input;
      await expect(lockSketchImageLedger(f.client, f.task)).rejects.toThrow(); expect(f.calls).toEqual([]);
    });
  it.each(['charged-id', 'refunded-id', 'pending', 'charged', 'row'])(
    'free reserve rejects invented financial evidence %s', async variant => {
      const f = fixture(free);
      if (variant === 'charged-id') f.task.charged_transaction_id = createTaskBillingTransactionId('charge', taskId);
      if (variant === 'refunded-id') f.task.refunded_transaction_id = createTaskBillingTransactionId('refund', taskId);
      if (variant === 'pending' || variant === 'charged') f.task.credit_status = variant;
      if (variant === 'row') f.transactions.push({ id: 'extra', user_id: 'actor', type: 'consume', amount: 0, balance_after: 0,
        model: 'same-model', task_id: taskId, reference_id: taskId });
      await expect(lockSketchImageLedger(f.client, f.task)).rejects.toThrow(); expect(writes(f)).toEqual([]);
    });
  it.each(['missing', 'extra', 'id', 'actor', 'type', 'amount', 'model', 'task', 'reference', 'balance'])(
    'rejects non-exact original charge %s', async variant => {
      const f = fixture(); const tx = f.transactions[0];
      if (variant === 'missing') f.transactions.length = 0;
      if (variant === 'extra') f.transactions.push({ ...tx, id: createTaskBillingTransactionId('refund', taskId), type: 'refund', amount: 1 });
      if (variant === 'id') tx.id = 'other';
      if (variant === 'actor') tx.user_id = 'owner';
      if (variant === 'type') tx.type = 'refund';
      if (variant === 'amount') tx.amount = -36;
      if (variant === 'model') tx.model = 'another-model';
      if (variant === 'task') tx.task_id = 'another-task';
      if (variant === 'reference') tx.reference_id = 'another-task';
      if (variant === 'balance') tx.balance_after = -1;
      await expect(lockSketchImageLedger(f.client, f.task)).rejects.toThrow(); expect(writes(f)).toEqual([]);
    });
  it.each(['credit_cost', 'balance', 'total_used', 'amount', 'balance_after'])(
    'refuses numeric strings/nonfinite/fraction/overflow in DB %s', async field => {
      for (const value of ['37', NaN, Infinity, -Infinity, 0.5, PG_MAX + 1, -PG_MAX - 2, null, undefined]) {
        const f = fixture();
        if (field === 'credit_cost') f.task.credit_cost = value;
        else if (field === 'balance' || field === 'total_used') f.credit![field] = value;
        else f.transactions[0][field as 'amount' | 'balance_after'] = value;
        await expect(lockSketchImageLedger(f.client, f.task)).rejects.toThrow(); expect(writes(f)).toEqual([]);
      }
    });
  it('requires the charged account but accepts exact PG endpoint values', async () => {
    const f = fixture(); f.credit = null;
    await expect(lockSketchImageLedger(f.client, f.task)).rejects.toThrow();
    for (const n of [0, PG_MAX]) {
      const g = fixture(); g.credit = { balance: n, total_used: n }; g.transactions[0].balance_after = n;
      expect(await lockSketchImageLedger(g.client, g.task)).toMatchObject({ balance: n, totalUsed: n });
    }
  });
  it.each(['task', 'result', 'admission', 'input', 'pricing', 'credit', 'transaction'])(
    'does not execute %s accessors while copying evidence', async variant => {
      const f = fixture(); let invoked = 0;
      const target = variant === 'task' ? f.task : variant === 'result' ? f.task.result : variant === 'admission' ? admission(f)
        : variant === 'input' ? admission(f).input : variant === 'pricing' ? admission(f).pricing
          : variant === 'credit' ? f.credit : f.transactions[0];
      const key = variant === 'task' ? 'credit_cost' : variant === 'result' ? 'sketchImageAdmission' : variant === 'admission' ? 'pricing'
        : variant === 'input' ? 'visionProviderId' : variant === 'pricing' ? 'vision' : variant === 'credit' ? 'balance' : 'amount';
      Object.defineProperty(target, key, { enumerable: true, get: (): number => { invoked++; return 37; } });
      // The SQL fixture must preserve descriptors to model malicious rows instead of erasing them.
      if (variant === 'credit' || variant === 'transaction') {
        const query = async (sql: string): Promise<{ rows: unknown[] }> => {
          f.calls.push({ sql, values: [] });
          return { rows: sql.includes('wujie_credits') ? [f.credit] : f.transactions };
        };
        f.client = { query } as unknown as PoolClient;
      }
      await expect(lockSketchImageLedger(f.client, f.task)).rejects.toThrow(); expect(invoked).toBe(0);
    });
});

describe('same-client single vision plus flat image settlement', () => {
  it.each([[0, 0, 1, 31, -6, 69], [2, 3, 8, 38, 1, 62], [7, 0, 7, 37, 0, 63]])(
    'real usage input=%i output=%i settles once to vision%i actual%i delta%i', async (inputTokens, outputTokens, visionCredits, actualCredits, deltaCredits, balance) => {
      const f = fixture(); const ledger = await lockSketchImageLedger(f.client, f.task);
      const usage = { inputTokens, outputTokens }; const settlement = await settleSketchImageCredits(f.client, ledger, usage);
      expect(settlement).toMatchObject({ version: 1, reserveCredits: 37, visionCredits, imageCredits: 30, actualCredits, deltaCredits,
        chargedTransactionId: createTaskBillingTransactionId('charge', taskId), usage: { inputTokens, outputTokens } });
      expect(f.credit).toEqual({ balance, total_used: actualCredits });
      expect(f.transactions).toHaveLength(deltaCredits === 0 ? 1 : 2);
      expect(writes(f)).toHaveLength(deltaCredits === 0 ? 0 : 2);
      if (deltaCredits < 0) {
        expect(settlement.adjustmentTransactionId).toBe(createTaskBillingTransactionId('refund', taskId));
        expect(f.transactions[1]).toMatchObject({ type: 'refund', amount: 6, balance_after: 69 });
        expect(f.task.refunded_transaction_id).toBeNull(); // Partial, not task termination/full refund.
      } else if (deltaCredits > 0) {
        const id = `ctx_token_${createHash('sha256').update(`sketch-to-image-token-delta\0${taskId}`).digest('hex').slice(0, 32)}`;
        expect(settlement.adjustmentTransactionId).toBe(id);
        expect(id).not.toBe(`ctx_token_${createHash('sha256').update(`sketch-to-code-token-delta\0${taskId}`).digest('hex').slice(0, 32)}`);
        expect(f.transactions[1]).toEqual({ id, user_id: 'actor', type: 'consume', amount: -1, balance_after: 62,
          model: 'same-model', task_id: taskId, reference_id: taskId });
      } else expect(settlement.adjustmentTransactionId).toBeNull();
      usage.inputTokens = 999;
      expect(settlement.usage?.inputTokens).toBe(inputTokens); expect(Object.isFrozen(settlement)).toBe(true);
      expect(Object.isFrozen(settlement.usage)).toBe(true); expect(f.task.status).toBe('processing');
      expect(f.calls.every(call => !/BEGIN|COMMIT|ROLLBACK|cloud_tasks/.test(call.sql))).toBe(true);
    });
  it.each([flat, free])('flat/free never invents usage or financial adjustments (%j)', async pricing => {
    const f = fixture(pricing); const ledger = await lockSketchImageLedger(f.client, f.task);
    const settlement = await settleSketchImageCredits(f.client, ledger, undefined);
    expect(settlement).toMatchObject({ visionCredits: pricing.vision.reserveCredits, imageCredits: pricing.image.credits,
      actualCredits: pricing.totalReserveCredits, deltaCredits: 0, adjustmentTransactionId: null });
    expect(settlement).not.toHaveProperty('usage'); expect(writes(f)).toEqual([]);
    expect(f.transactions.length).toBe(pricing.totalReserveCredits ? 1 : 0);
    expect(settlement.chargedTransactionId).toBe(pricing.totalReserveCredits ? createTaskBillingTransactionId('charge', taskId) : null);
  });
  it('flat preserves supplied true counters without changing prices', async () => {
    const f = fixture(flat); const ledger = await lockSketchImageLedger(f.client, f.task);
    expect(await settleSketchImageCredits(f.client, ledger, { inputTokens: 2, outputTokens: 3 })).toMatchObject({ actualCredits: 37, usage: { inputTokens: 2, outputTokens: 3 } });
    expect(writes(f)).toEqual([]);
  });
  it('provider scoped free/flat prices never inherit global same-name token billing', async () => {
    const pricing = await quoteSketchImagePricing(selection, { modelCredits: {
      'same-model': { credits: 99, tokenPricing: { input: 10_000_000, output: 10_000_000 } },
      'vision-provider::same-model': 0, 'image-provider::same-model': 30 } });
    const f = fixture(pricing); const ledger = await lockSketchImageLedger(f.client, f.task);
    expect(await settleSketchImageCredits(f.client, ledger, undefined)).toMatchObject({ visionCredits: 0, imageCredits: 30, actualCredits: 30 });
    expect(writes(f)).toEqual([]);
  });
  it('token base0 reserves1 and applies the single minimum even when image is free', async () => {
    const pricing = await quoteSketchImagePricing(selection, { modelCredits: {
      'vision-provider::same-model': { credits: 0, tokenPricing: { input: 1, output: 1 } }, 'image-provider::same-model': 0 } });
    const f = fixture(pricing); const ledger = await lockSketchImageLedger(f.client, f.task);
    expect(await settleSketchImageCredits(f.client, ledger, { inputTokens: 0, outputTokens: 0 })).toMatchObject({ reserveCredits: 1, actualCredits: 1, deltaCredits: 0 });
    expect(writes(f)).toEqual([]);
  });
  it.each([undefined, null, {}, { inputTokens: 1 }, { inputTokens: '1', outputTokens: 0 },
    { inputTokens: -1, outputTokens: 0 }, { inputTokens: 0.5, outputTokens: 0 },
    { inputTokens: 10_000_001, outputTokens: 0 }, { inputTokens: 0, outputTokens: Infinity },
    { inputTokens: 1, outputTokens: 0, extra: true }, { analysis: { inputTokens: 1, outputTokens: 0 }, reconstruction: null, total: null }])(
    'missing/malformed real usage is rejected with zero writes: %j', async usage => {
      const f = fixture(); const ledger = await lockSketchImageLedger(f.client, f.task);
      await expect(settleSketchImageCredits(f.client, ledger, usage)).rejects.toThrow('SKETCH_IMAGE_USAGE_INVALID'); expect(writes(f)).toEqual([]);
    });
  it.each([flat, free])('supplied malformed usage is rejected even for flat/free %j', async pricing => {
    const f = fixture(pricing); const ledger = await lockSketchImageLedger(f.client, f.task);
    await expect(settleSketchImageCredits(f.client, ledger, { inputTokens: 1 })).rejects.toThrow('SKETCH_IMAGE_USAGE_INVALID'); expect(writes(f)).toEqual([]);
  });
  it.each(['insufficient', 'balance-over', 'used-over', 'used-under'])(
    'refuses %s before modifying any ledger row', async variant => {
      const f = fixture();
      if (variant === 'insufficient') f.credit!.balance = 0;
      if (variant === 'balance-over') f.credit!.balance = PG_MAX;
      if (variant === 'used-over') f.credit!.total_used = PG_MAX;
      if (variant === 'used-under') f.credit!.total_used = 0;
      const ledger = await lockSketchImageLedger(f.client, f.task);
      const usage = { inputTokens: variant === 'balance-over' || variant === 'used-under' ? 0 : 2,
        outputTokens: variant === 'balance-over' || variant === 'used-under' ? 0 : 3 };
      await expect(settleSketchImageCredits(f.client, ledger, usage)).rejects.toThrow(variant === 'insufficient' ? 'SKETCH_IMAGE_INSUFFICIENT_CREDITS' : 'SKETCH_IMAGE_INTEGER_OVERFLOW');
      expect(writes(f)).toEqual([]); expect(f.task.status).toBe('processing');
    });
  it.each(['zero-balance', 'max-balance', 'zero-used', 'max-used'])(
    'accepts exact resulting PG boundary %s', async variant => {
      const f = fixture(); const negative = variant === 'max-balance' || variant === 'zero-used';
      if (variant === 'zero-balance') f.credit!.balance = 1;
      if (variant === 'max-balance') f.credit!.balance = PG_MAX - 6;
      if (variant === 'zero-used') f.credit!.total_used = 6;
      if (variant === 'max-used') f.credit!.total_used = PG_MAX - 1;
      const ledger = await lockSketchImageLedger(f.client, f.task);
      await settleSketchImageCredits(f.client, ledger, negative ? { inputTokens: 0, outputTokens: 0 } : { inputTokens: 2, outputTokens: 3 });
      expect(f.credit![variant.includes('balance') ? 'balance' : 'total_used']).toBe(variant.startsWith('zero') ? 0 : PG_MAX);
    });
  it.each(['missing', 'wrong', 'insert'])(
    'SQL failure %s propagates without claiming task completion or starting rollback', async variant => {
      const f = fixture(); f.updateMode = variant; f.insertFailure = variant === 'insert';
      const ledger = await lockSketchImageLedger(f.client, f.task);
      await expect(settleSketchImageCredits(f.client, ledger, { inputTokens: 2, outputTokens: 3 })).rejects.toThrow();
      expect(f.task.result).not.toHaveProperty('sketchImageSettlement'); expect(f.task.status).toBe('processing');
      expect(f.calls.some(call => /BEGIN|COMMIT|ROLLBACK/.test(call.sql))).toBe(false);
      expect(f.transactions).toHaveLength(1);
    });
  it('silent zero-row adjustment insert cannot return a successful settlement', async () => {
    const f = fixture(); f.updateMode = 'silent-insert';
    const ledger = await lockSketchImageLedger(f.client, f.task);
    await expect(settleSketchImageCredits(f.client, ledger, { inputTokens: 2, outputTokens: 3 })).rejects.toThrow();
    expect(f.task.status).toBe('processing'); expect(f.task.result).not.toHaveProperty('sketchImageSettlement');
    expect(f.transactions).toHaveLength(1); expect(f.calls.some(call => /BEGIN|COMMIT|ROLLBACK/.test(call.sql))).toBe(false);
  });
  it('the same locked snapshot cannot apply delta twice', async () => {
    const f = fixture(); const ledger = await lockSketchImageLedger(f.client, f.task);
    await settleSketchImageCredits(f.client, ledger, { inputTokens: 2, outputTokens: 3 }); const count = f.calls.length;
    await expect(settleSketchImageCredits(f.client, ledger, { inputTokens: 2, outputTokens: 3 })).rejects.toThrow();
    expect(f.calls).toHaveLength(count); expect(f.transactions).toHaveLength(2);
  });
  it.each(['readOnly', 'other-client'])('settlement refuses %s instead of writing outside original exclusive locks', async variant => {
    const f = fixture(); const ledger = await lockSketchImageLedger(f.client, f.task, variant === 'readOnly');
    const other = fixture();
    await expect(settleSketchImageCredits(variant === 'readOnly' ? f.client : other.client, ledger, { inputTokens: 2, outputTokens: 3 })).rejects.toThrow();
    expect(writes(f)).toEqual([]); expect(other.calls).toEqual([]);
  });
  it('max single-stage token usage and rates are accepted without second-LLM aggregation', async () => {
    const p = { ...token, vision: { ...token.vision, tokenPricing: { input: 10_000_000, output: 10_000_000 } } };
    const f = fixture(p); f.credit!.balance = 200_000_000;
    const ledger = await lockSketchImageLedger(f.client, f.task);
    expect(await settleSketchImageCredits(f.client, ledger, { inputTokens: 10_000_000, outputTokens: 10_000_000 })).toMatchObject({
      visionCredits: 200_000_000, imageCredits: 30, actualCredits: 200_000_030, deltaCredits: 199_999_993 });
    expect(f.credit).toEqual({ balance: 7, total_used: 200_000_030 });
  });
});

describe('completed task/input/output settlement recomputation', () => {
  it.each([['refund', token, { inputTokens: 0, outputTokens: 0 }, 31], ['topup', token, { inputTokens: 2, outputTokens: 3 }, 38],
    ['zero', token, { inputTokens: 7, outputTokens: 0 }, 37], ['flat', flat, undefined, 37], ['free', free, undefined, 0]] as const)(
    'accepts exact three projections with only original charge/unique %s', async (_label, pricing, usage, actualCredits) => {
      const { f, projections } = await completed(pricing, usage);
      const ledger = await lockSketchImageLedger(f.client, f.task, true); const count = f.calls.length;
      const settlement = verifySketchImageSettlement(ledger, projections);
      expect(settlement.actualCredits).toBe(actualCredits); expect(settlement.deltaCredits).toBe(actualCredits - pricing.totalReserveCredits);
      expect(Object.isFrozen(settlement)).toBe(true); expect(f.calls).toHaveLength(count);
      await expect(settleSketchImageCredits(f.client, ledger, usage)).rejects.toThrow(); expect(f.calls).toHaveLength(count);
    });
  it.each([0, 1, 2])('rejects altered projection %i even if the other two agree', async index => {
    const { f, projections } = await completed(token, { inputTokens: 0, outputTokens: 0 });
    const ledger = await lockSketchImageLedger(f.client, f.task, true);
    projections[index].actualCredits = 37;
    expect(() => verifySketchImageSettlement(ledger, projections)).toThrow();
  });
  it.each(['version', 'reserveCredits', 'visionCredits', 'imageCredits', 'actualCredits', 'deltaCredits',
    'chargedTransactionId', 'adjustmentTransactionId', 'usage', 'extra'])(
    'recomputes all settlement fields instead of trusting three matching tampered %s', async field => {
      const { f, projections } = await completed(token, { inputTokens: 0, outputTokens: 0 });
      const ledger = await lockSketchImageLedger(f.client, f.task, true);
      for (const projection of projections) projection[field] = field === 'usage' ? { inputTokens: 1 } : 'tampered';
      expect(() => verifySketchImageSettlement(ledger, projections)).toThrow();
    });
  it.each([0, 1, 2, 4])('requires exactly three projections, not %i', async count => {
    const { f, projections } = await completed(flat); const ledger = await lockSketchImageLedger(f.client, f.task, true);
    expect(() => verifySketchImageSettlement(ledger, Array.from({ length: count }, () => projections[0]))).toThrow();
  });
  it('does not execute projection accessors', async () => {
    const { f, projections } = await completed(flat); const ledger = await lockSketchImageLedger(f.client, f.task, true); let invoked = 0;
    Object.defineProperty(projections[2], 'actualCredits', { enumerable: true, get: (): number => { invoked++; return 37; } });
    expect(() => verifySketchImageSettlement(ledger, projections)).toThrow(); expect(invoked).toBe(0);
  });
  it.each(['absent', 'charged-while-processing', 'pending-while-completed', 'wrong-price'])(
    'completed task rejects inconsistent persisted settlement/state %s', async variant => {
      const { f } = await completed(flat);
      if (variant === 'absent') delete f.task.result.sketchImageSettlement;
      if (variant === 'charged-while-processing') f.task.status = 'processing';
      if (variant === 'pending-while-completed') f.task.credit_status = 'pending';
      if (variant === 'wrong-price') (f.task.result.sketchImageSettlement as Record<string, unknown>).visionCredits = 8;
      await expect(lockSketchImageLedger(f.client, f.task, true)).rejects.toThrow();
    });
  it.each(['missing', 'extra', 'actor', 'type', 'amount', 'model', 'task', 'reference', 'id', 'full-refund'])(
    'completed partial refund requires the unique exact adjustment: %s', async variant => {
      const { f } = await completed(token, { inputTokens: 0, outputTokens: 0 }); const tx = f.transactions[1];
      if (variant === 'missing') f.transactions.pop();
      if (variant === 'extra') f.transactions.push({ ...tx, id: 'extra' });
      if (variant === 'actor') tx.user_id = 'other';
      if (variant === 'type') tx.type = 'consume';
      if (variant === 'amount') tx.amount = 37;
      if (variant === 'model') tx.model = 'other';
      if (variant === 'task') tx.task_id = 'other';
      if (variant === 'reference') tx.reference_id = 'other';
      if (variant === 'id') tx.id = 'other';
      if (variant === 'full-refund') f.task.refunded_transaction_id = tx.id;
      await expect(lockSketchImageLedger(f.client, f.task, true)).rejects.toThrow();
    });
  it('completed0 free rejects any task ledger row', async () => {
    const { f } = await completed(free); f.transactions.push({ id: createTaskBillingTransactionId('refund', taskId), user_id: 'actor',
      type: 'refund', amount: 0, balance_after: 0, model: 'same-model', task_id: taskId, reference_id: taskId });
    await expect(lockSketchImageLedger(f.client, f.task, true)).rejects.toThrow();
  });
  it('processing tasks cannot be verified or already contain settlement evidence', async () => {
    const f = fixture(flat); const ledger = await lockSketchImageLedger(f.client, f.task);
    expect(() => verifySketchImageSettlement(ledger, [{}, {}, {}])).toThrow();
    f.task.result.sketchImageSettlement = {};
    await expect(lockSketchImageLedger(f.client, f.task)).rejects.toThrow(); expect(writes(f)).toEqual([]);
  });
});

describe('canonical SQL empty billing-id absence counterexamples', () => {
  it.each([['paid', flat], ['free', free]] as const)('locks and settles original %s SQL empty absents without rewriting the caller row', async (_label, pricing) => {
    const f = fixture(pricing), reserve = pricing.totalReserveCredits;
    f.task.refunded_transaction_id = ''; if (!reserve) f.task.charged_transaction_id = '';
    const ledger = await lockSketchImageLedger(f.client, f.task);
    const chargeId = reserve ? createTaskBillingTransactionId('charge', taskId) : null;
    expect(ledger.chargeId).toBe(chargeId); expect(ledger.task.refunded_transaction_id).toBeNull();
    expect(await settleSketchImageCredits(f.client, ledger)).toMatchObject({ actualCredits: reserve, chargedTransactionId: chargeId, adjustmentTransactionId: null });
    expect(f.task.refunded_transaction_id).toBe(''); expect(f.task.charged_transaction_id).toBe(chargeId ?? '');
    expect(f.transactions).toHaveLength(reserve ? 1 : 0); expect(f.credit).toEqual(reserve ? { balance: 63, total_used: 37 } : null);
    expect(f.calls).toHaveLength(2); expect(writes(f)).toEqual([]);
  });
  it.each(['charged_transaction_id', 'refunded_transaction_id'] as const)('does not interpret invalid %s as SQL absence', async field => {
    for (const value of [undefined, false, 0, ' ', 'wrong-id']) {
      const f = fixture(field === 'charged_transaction_id' ? free : flat);
      (f.task as unknown as Record<string, unknown>)[field] = value;
      await expect(lockSketchImageLedger(f.client, f.task)).rejects.toThrow('SKETCH_IMAGE_EVIDENCE_INVALID');
      expect(f.calls).toEqual([]); expect(writes(f)).toEqual([]);
    }
  });
});
