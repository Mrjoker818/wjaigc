import { createCanvas } from '@napi-rs/canvas';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import { readSketchImageTaskRowIdentity, type SketchImageTaskRow } from '@/lib/sketch-to-code/image-task-state';
import { confirmSketchImageCancellationReceipt } from '@/lib/sketch-to-code/image-cancel-reconfirm';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.useRealTimers(); });
const taskId = 'skimg_receipt', actor = 'receipt-actor', refundId = 'ctx_1700000000000_a1b2c3d4';
function fixture(): {
  row: SketchImageTaskRow; identity: ReturnType<typeof readSketchImageTaskRowIdentity>; transactions: Record<string, unknown>[];
  calls: { sql: string; args: unknown[] }[]; query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>;
  client: PoolClient; connect: ReturnType<typeof vi.fn>;
} {
  const input = { projectId: 'receipt-project', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: 'private-source',
    visionProviderId: 'vp', visionModelId: 'vm', imageProviderId: 'ip', imageModelId: 'im', idempotencyKey: 'private-nonce', aspectRatio: '1:1' };
  const pricing = { version: 1, vision: { providerId: 'vp', modelId: 'vm', calls: 1, mode: 'flat', reserveCredits: 7 },
    image: { providerId: 'ip', modelId: 'im', calls: 1, credits: 11 }, totalReserveCredits: 18 };
  const row: SketchImageTaskRow = { id: taskId, user_id: actor, project_id: input.projectId, type: 'sketch-to-image', status: 'cancelled',
    provider_id: 'ip', model: 'im', credit_cost: '18', credit_status: 'refunded', request_digest: sketchImageRequestDigest(input),
    idempotency_key: input.idempotencyKey, charged_transaction_id: createTaskBillingTransactionId('charge', taskId),
    refunded_transaction_id: refundId, lease_owner: '', lease_expires_at: '0', attempt_count: 1,
    result: { sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', input, pricing, requestDigest: sketchImageRequestDigest(input),
      access: { kind: 'document', actorUserId: actor, projectId: input.projectId, ownerId: 'old-owner', grantGeneration: '1' } },
      sketchImageExecution: { version: 1, phase: 'generation', routing: { vision: '1'.repeat(64), image: '2'.repeat(64) } } } };
  const transactions: Record<string, unknown>[] = [
    { id: row.charged_transaction_id, user_id: actor, type: 'consume', amount: -18, balance_after: 82, model: 'im', task_id: taskId, reference_id: taskId },
    { id: refundId, user_id: actor, type: 'refund', amount: 18, balance_after: 100, model: '', task_id: taskId, reference_id: taskId },
  ];
  const calls: { sql: string; args: unknown[] }[] = [], release = vi.fn();
  const query = vi.fn(async (sql: string, args: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
    calls.push({ sql, args: structuredClone(args) });
    if (/^BEGIN\b|^SET LOCAL\b|^(?:COMMIT|ROLLBACK)$/u.test(sql)) return { rows: [], rowCount: 0 };
    if (/^SELECT\b/u.test(sql) && sql.includes('FROM cloud_tasks')) {
      if (args[0] !== taskId) throw new Error('wrong original task query');
      return { rows: [{ ...structuredClone(row), now_ms: String(Date.now()) }], rowCount: 1 };
    }
    if (/^SELECT\b/u.test(sql) && sql.includes('FROM wujie_credit_transactions')) {
      if (args[0] !== taskId || JSON.stringify(args[1]) !== JSON.stringify([row.charged_transaction_id, refundId])) throw new Error('wrong original ledger query');
      return { rows: structuredClone(transactions), rowCount: transactions.length };
    }
    throw new Error('unexpected or mutating SQL');
  });
  const client = { query, release } as unknown as PoolClient, connect = vi.fn(async () => client);
  return { row, identity: readSketchImageTaskRowIdentity(row, actor), transactions, calls, query, release, client, connect };
}
describe('original generic cancellation receipt positives (controlled SQL, not real PG)', () => {
  it('accepts exactly the original cancelled row and canonical charge plus actual generic full refund in read-only SQL', async () => {
    const f = fixture();
    expect(await confirmSketchImageCancellationReceipt(f.identity, refundId, { connect: f.connect })).toBe(true);
    expect(f.calls[0].sql).toMatch(/^BEGIN .*READ ONLY/u); expect(f.calls.at(-1)?.sql).toBe('COMMIT');
    expect(f.calls.filter(c => c.sql.includes('FROM cloud_tasks'))).toHaveLength(2);
    expect(f.calls.filter(c => c.sql.includes('FROM wujie_credit_transactions'))).toHaveLength(1);
    expect(f.calls.some(c => /\b(?:UPDATE|INSERT|DELETE|CREATE|ALTER)\b/u.test(c.sql))).toBe(false);
    expect(f.row.status).toBe('cancelled'); expect(f.row.refunded_transaction_id).toBe(refundId); expect(f.transactions).toHaveLength(2);
    expect(f.release).toHaveBeenCalledWith(false);
  });
  it('captures the complete input and quote before connection awaits without refreshing a grant or recharging', async () => {
    const f = fixture(), identity = structuredClone(f.identity);
    const connect = async (): Promise<PoolClient> => {
      (identity.input as unknown as Record<string, unknown>).instruction = 'changed-after-start';
      return f.client;
    };
    expect(await confirmSketchImageCancellationReceipt(identity, refundId, { connect })).toBe(true);
    expect(f.row.credit_cost).toBe('18'); expect(f.transactions[0].amount).toBe(-18); expect(f.transactions[1].amount).toBe(18);
  });
});
describe('original generic cancellation receipt rejects mismatched evidence', () => {
  it.each(['owner', 'project', 'nonce', 'source', 'quote', 'charge', 'refund', 'status', 'credit', 'lease-owner', 'lease-expiry', 'settlement'] as const)('rejects original SQL row %s without a receipt ACK', async kind => {
    const f = fixture();
    if (kind === 'owner') f.row.user_id = 'other'; if (kind === 'project') f.row.project_id = 'other';
    if (kind === 'nonce') f.row.idempotency_key = 'other'; if (kind === 'source') {
      const meta = f.row.result.sketchImageAdmission as { input: Record<string, unknown> }; meta.input.instruction = 'different-source';
    }
    if (kind === 'quote') f.row.credit_cost = '19'; if (kind === 'charge') f.row.charged_transaction_id = 'other';
    if (kind === 'refund') f.row.refunded_transaction_id = 'ctx_1700000000000_other123';
    if (kind === 'status') f.row.status = 'completed'; if (kind === 'credit') f.row.credit_status = 'pending';
    if (kind === 'lease-owner') f.row.lease_owner = 'worker'; if (kind === 'lease-expiry') f.row.lease_expires_at = '1';
    if (kind === 'settlement') f.row.result.sketchImageSettlement = {};
    expect(await confirmSketchImageCancellationReceipt(f.identity, refundId, { connect: f.connect })).toBe(false);
    expect(f.calls.map(c => c.sql)).not.toContain('COMMIT'); expect(f.release).toHaveBeenCalledWith(false);
  });
  it.each(['charge-id', 'charge-actor', 'charge-amount', 'charge-type', 'charge-model', 'charge-task', 'charge-reference',
    'refund-id', 'refund-actor', 'refund-amount', 'refund-type', 'refund-task', 'refund-reference', 'extra-refund', 'missing-charge', 'numeric-string'] as const)('rejects real original transaction mismatch %s', async kind => {
    const f = fixture(), charge = f.transactions[0], refund = f.transactions[1];
    if (kind === 'charge-id') charge.id = 'other'; if (kind === 'charge-actor') charge.user_id = 'other';
    if (kind === 'charge-amount') charge.amount = -17; if (kind === 'charge-type') charge.type = 'refund'; if (kind === 'charge-model') charge.model = 'other';
    if (kind === 'charge-task') charge.task_id = 'other'; if (kind === 'charge-reference') charge.reference_id = 'other';
    if (kind === 'refund-id') refund.id = 'ctx_1700000000000_other123'; if (kind === 'refund-actor') refund.user_id = 'other';
    if (kind === 'refund-amount') refund.amount = 17; if (kind === 'refund-type') refund.type = 'consume';
    if (kind === 'refund-task') refund.task_id = ''; if (kind === 'refund-reference') refund.reference_id = 'other';
    if (kind === 'extra-refund') f.transactions.push({ ...refund, id: 'ctx_1700000000000_other123' });
    if (kind === 'missing-charge') f.transactions.shift(); if (kind === 'numeric-string') refund.amount = '18';
    expect(await confirmSketchImageCancellationReceipt(f.identity, refundId, { connect: f.connect })).toBe(false);
    expect(f.calls.map(c => c.sql)).not.toContain('COMMIT'); expect(f.release).toHaveBeenCalledWith(false);
  });
  it.each(['other', 'ctx_01_ab', 'ctx_1700000000000_UPPER', 'ctx_1700000000000_abcd12345', 'ctx_9007199254740992_ab'])('non-original ID shape %s never opens a SQL proof connection', async id => {
    const f = fixture();
    expect(await confirmSketchImageCancellationReceipt(f.identity, id, { connect: f.connect })).toBe(false); expect(f.calls).toEqual([]);
  });
  it('missing SQL row and wrong row count stay unconfirmed', async () => {
    const f = fixture(), original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, args) => sql.includes('FROM cloud_tasks') ? { rows: [], rowCount: 0 } : original(sql, args));
    expect(await confirmSketchImageCancellationReceipt(f.identity, refundId, { connect: f.connect })).toBe(false); expect(f.release).toHaveBeenCalledWith(false);
  });
  it.each(['clock', 'refund', 'result'] as const)('final fresh SQL %s change prevents receipt confirmation', async kind => {
    const f = fixture(), original = f.query.getMockImplementation()!; let reads = 0;
    f.query.mockImplementation(async (sql, args) => {
      const result = await original(sql, args);
      if (sql.includes('FROM cloud_tasks') && ++reads === 2) {
        const row = result.rows[0] as Record<string, unknown>;
        if (kind === 'clock') row.now_ms = String(Date.now() + 20_000);
        if (kind === 'refund') row.refunded_transaction_id = 'ctx_1700000000000_other123';
        if (kind === 'result') (row.result as Record<string, unknown>).extra = 'changed';
      }
      return result;
    });
    expect(await confirmSketchImageCancellationReceipt(f.identity, refundId, { connect: f.connect })).toBe(false);
    expect(f.calls.map(c => c.sql)).not.toContain('COMMIT'); expect(f.release).toHaveBeenCalledWith(false);
  });
});
describe('read-only receipt actual driver and cleanup', () => {
  it('unknown read-only COMMIT ACK discards without a second read, rollback or financial action', async () => {
    const f = fixture(), original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, args) => { const result = await original(sql, args); if (sql === 'COMMIT') throw new Error('private-ack-loss'); return result; });
    expect(await confirmSketchImageCancellationReceipt(f.identity, refundId, { connect: f.connect })).toBe(false);
    expect(f.calls.filter(c => c.sql === 'COMMIT')).toHaveLength(1); expect(f.calls.map(c => c.sql)).not.toContain('ROLLBACK');
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it('query failure and failed actual rollback discard the client', async () => {
    const f = fixture(), original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, args) => { if (sql.includes('FROM cloud_tasks') || sql === 'ROLLBACK') throw new Error('private-driver'); return original(sql, args); });
    expect(await confirmSketchImageCancellationReceipt(f.identity, refundId, { connect: f.connect })).toBe(false); expect(f.release).toHaveBeenCalledWith(true);
  });
  it('owns a busy actual SQL read until it finishes, then rolls back after its late deadline', async () => {
    const f = fixture(), original = f.query.getMockImplementation()!; let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; });
    f.query.mockImplementation(async (sql, args) => {
      if (sql.includes('FROM cloud_tasks')) { enter(); await new Promise<void>(r => { release = r; }); }
      return original(sql, args);
    });
    vi.useFakeTimers();
    const pending = confirmSketchImageCancellationReceipt(f.identity, refundId, { connect: f.connect });
    await entered; await vi.advanceTimersByTimeAsync(10_001); expect(f.release).not.toHaveBeenCalled(); release();
    expect(await pending).toBe(false); expect(f.calls.at(-1)?.sql).toBe('ROLLBACK'); expect(f.release).toHaveBeenCalledWith(false);
    expect(f.calls.map(c => c.sql)).not.toContain('COMMIT');
  });
});
