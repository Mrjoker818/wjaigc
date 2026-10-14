import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import type { PersistedCloudTask } from '@/lib/cloud-task-storage';
import type { SketchImageTaskRow } from '@/lib/sketch-to-code/image-task-state';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import { readSketchImageTaskIdentity } from '@/lib/sketch-to-code/image-task-state';
import { cancelSketchImageTransaction } from '@/lib/sketch-to-code/image-task-http';
const { terminate } = vi.hoisted(() => ({ terminate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/cloud-task-storage', async importOriginal => ({ ...(await importOriginal<Record<string, unknown>>()), terminateCloudTaskAndRefund: terminate }));
afterEach(() => vi.useRealTimers());
function harness(free = false): { identity: ReturnType<typeof readSketchImageTaskIdentity>; row: SketchImageTaskRow; client: PoolClient;
  query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; queries: string[]; finance: { balance: number; total_used: number };
  transactions: Record<string, unknown>[]; commits: () => number } {
  const input = { projectId: 'project-a', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: '房子', visionProviderId: 'vp', visionModelId: 'vm',
    imageProviderId: 'ip', imageModelId: 'im', idempotencyKey: 'nonce-a', aspectRatio: '1:1' };
  const pricing = { version: 1, vision: { providerId: 'vp', modelId: 'vm', calls: 1, mode: 'flat', reserveCredits: free ? 0 : 7 },
    image: { providerId: 'ip', modelId: 'im', calls: 1, credits: free ? 0 : 11 }, totalReserveCredits: free ? 0 : 18 };
  const result = { sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', requestDigest: sketchImageRequestDigest(input), input, pricing,
    access: { kind: 'document', actorUserId: 'actor', ownerId: 'owner', projectId: 'project-a', grantGeneration: '3' } } };
  const row: SketchImageTaskRow = { id: 'skimg_cancel', type: 'sketch-to-image', user_id: 'actor', project_id: 'project-a', provider_id: 'ip', model: 'im',
    request_digest: sketchImageRequestDigest(input), idempotency_key: 'nonce-a', status: 'processing', credit_status: free ? 'not-applicable' : 'pending',
    credit_cost: free ? 0 : 18, charged_transaction_id: free ? null : createTaskBillingTransactionId('charge', 'skimg_cancel'), refunded_transaction_id: null,
    result, lease_owner: 'expired-or-other-worker', attempt_count: 1, lease_expires_at: 1 };
  const task = { id: row.id, type: row.type, userId: row.user_id, projectId: row.project_id, providerId: row.provider_id, model: row.model,
    requestDigest: row.request_digest, idempotencyKey: row.idempotency_key, creditCost: free ? 0 : 18, creditStatus: free ? 'not-applicable' : 'pending',
    status: 'processing', result, revision: 0, createdAt: 0, progress: 0, updatedAt: 0 } satisfies PersistedCloudTask;
  const finance = { balance: 100, total_used: 18 }, transactions: Record<string, unknown>[] = free ? [] : [{ id: row.charged_transaction_id, user_id: 'actor', type: 'consume',
    amount: -18, balance_after: 100, model: 'im', task_id: row.id, reference_id: row.id }];
  const queries: string[] = []; let commits = 0;
  const query = vi.fn(async (sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> => {
    queries.push(sql); if (sql === 'COMMIT') { commits++; return { rows: [] }; }
    if (sql.startsWith('BEGIN') || sql.startsWith('ROLLBACK') || sql.startsWith('SET LOCAL')) return { rows: [] };
    if (sql.startsWith('SELECT *')) return { rows: [{ ...structuredClone(row), ...(sql.includes('clock_timestamp') ? { now_ms: String(Date.now()) } : {}) }] };
    if (sql.includes('FROM wujie_credits')) return { rows: free ? [] : [{ ...finance }] };
    if (sql.includes('FROM wujie_credit_transactions')) return { rows: structuredClone(transactions) };
    throw new Error('UNEXPECTED_SQL');
  });
  const release = vi.fn(), client = { query, release } as unknown as PoolClient;
  terminate.mockReset(); terminate.mockImplementation(async (_id: string, status: string, reason: string, _lease: unknown, options: { client: PoolClient }) => {
    expect(options.client.query).toBeDefined(); queries.push('ORIGINAL_TERMINATION'); row.status = status; row.lease_owner = ''; row.lease_expires_at = 0;
    if (!free) { finance.balance += 18; finance.total_used -= 18; row.credit_status = 'refunded'; row.refunded_transaction_id = 'original-ctx-refund';
      transactions.push({ id: row.refunded_transaction_id, user_id: 'actor', type: 'refund', amount: 18, balance_after: 118, model: '', task_id: row.id, reference_id: row.id }); }
    void reason; return { status, transitioned: true, refunded: !free, creditCost: free ? 0 : 18, userId: 'actor', balance: free ? undefined : 118 };
  });
  return { identity: readSketchImageTaskIdentity(task, 'actor'), row, client, query, release, queries, finance, transactions, commits: () => commits };
}
describe('owner cancellation original transaction wrapper, not original SQL semantics proof', () => {
  it.each([false, true])('accepts canonical PG NUMERIC reserve text without changing original finance (free=%s)', async free => {
    const h = harness(free); h.row.credit_cost = String(free ? 0 : 18);
    expect(await cancelSketchImageTransaction(h.identity, { connect: async () => h.client })).toEqual({ cancelled: true, refunded: !free });
    expect(h.row.credit_cost).toBe(free ? '0' : '18'); expect(h.commits()).toBe(1); expect(terminate).toHaveBeenCalledOnce();
    expect(h.transactions).toHaveLength(free ? 0 : 2); expect(h.finance).toEqual(free ? { balance: 100, total_used: 18 } : { balance: 118, total_used: 0 });
  });
  it.each(['018', '18.0', '1.8e1', '+18', ' 18', '-0', '9007199254740992', '19'])('refuses noncanonical or wrong SQL reserve %s before termination', async value => {
    const h = harness(); h.row.credit_cost = value;
    await expect(cancelSketchImageTransaction(h.identity, { connect: async () => h.client })).rejects.toThrow('SKETCH_IMAGE_CANCELLATION_UNCONFIRMED');
    expect(terminate).not.toHaveBeenCalled(); expect(h.commits()).toBe(0); expect(h.queries.at(-1)).toBe('ROLLBACK');
  });
  it('does not require current write grant or a worker lease, uses original same client refund and commits exact original ledger', async () => {
    const h = harness(); expect(await cancelSketchImageTransaction(h.identity, { connect: async () => h.client })).toEqual({ cancelled: true, refunded: true });
    expect(terminate).toHaveBeenCalledOnce(); expect(terminate.mock.calls[0].slice(0,4)).toEqual(['skimg_cancel','cancelled','SKETCH_IMAGE_EXECUTION_CANCELLED',undefined]);
    expect(terminate.mock.calls[0][4].requireActive).toBe(true); expect(terminate.mock.calls[0][4].client.release).toBeDefined();
    expect(h.commits()).toBe(1); expect(h.finance).toEqual({ balance: 118, total_used: 0 }); expect(h.release).toHaveBeenCalledWith(false);
  });
  it('a free owner cancellation performs no financial initialization or adjustment', async () => {
    const h = harness(true); expect(await cancelSketchImageTransaction(h.identity, { connect: async () => h.client })).toEqual({ cancelled: true, refunded: false });
    expect(h.transactions).toHaveLength(0); expect(h.finance).toEqual({ balance: 100, total_used: 18 }); expect(h.commits()).toBe(1);
  });
  it.each(['actor','project','model','input','quote','charge','extra-refund','completed'] as const)('does not invoke original termination for changed %s authority', async kind => {
    const h = harness(); if (kind === 'actor') h.row.user_id = 'other'; if (kind === 'project') h.row.project_id = 'other'; if (kind === 'model') h.row.model = 'other';
    if (kind === 'input') ((h.row.result.sketchImageAdmission as { input: { instruction: string } }).input).instruction = 'changed';
    if (kind === 'quote') h.row.credit_cost = 19; if (kind === 'charge') h.row.charged_transaction_id = 'other';
    if (kind === 'extra-refund') h.transactions.push({ ...h.transactions[0], id: 'other', type: 'refund', amount: 18 }); if (kind === 'completed') h.row.status = 'completed';
    await expect(cancelSketchImageTransaction(h.identity, { connect: async () => h.client })).rejects.toThrow('SKETCH_IMAGE_CANCELLATION_UNCONFIRMED');
    expect(terminate).not.toHaveBeenCalled(); expect(h.commits()).toBe(0);
  });
  it.each(['result','balance','transaction','clock'] as const)('refuses a mismatching original settlement %s before COMMIT', async kind => {
    const h = harness(), original = terminate.getMockImplementation()!;
    terminate.mockImplementationOnce(async (...args: unknown[]) => { const result = await original(...args);
      if (kind === 'result') return { ...result, userId: 'other' }; if (kind === 'balance') h.finance.balance = 119;
      if (kind === 'transaction') h.transactions[1].amount = 19; if (kind === 'clock') vi.setSystemTime(Date.now()+10_001); return result;
    });
    if (kind === 'clock') vi.useFakeTimers();
    await expect(cancelSketchImageTransaction(h.identity, { connect: async () => h.client })).rejects.toThrow('SKETCH_IMAGE_CANCELLATION_UNCONFIRMED'); expect(h.commits()).toBe(0); expect(h.queries.at(-1)).toBe('ROLLBACK');
  });
  it('unknown successful COMMIT ACK never retries settlement or rolls back/interrupts memory', async () => {
    const h = harness(), original = h.query.getMockImplementation()!;
    h.query.mockImplementation(async sql => { const result = await original(sql); if (sql === 'COMMIT') throw new Error('ack-loss'); return result; });
    await expect(cancelSketchImageTransaction(h.identity, { connect: async () => h.client })).rejects.toThrow('SKETCH_IMAGE_CANCELLATION_UNCONFIRMED');
    expect(h.commits()).toBe(1); expect(terminate).toHaveBeenCalledOnce(); expect(h.queries).not.toContain('ROLLBACK'); expect(h.release).toHaveBeenCalledWith(true);
  });
  it('waits for a busy initial query actual terminal before rollback/release on its late deadline', async () => {
    const h = harness(), original = h.query.getMockImplementation()!; let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(r => { entered = r; });
    h.query.mockImplementationOnce(async sql => { entered(); await new Promise<void>(r => { release = r; }); return original(sql); });
    vi.useFakeTimers(); const outcome = cancelSketchImageTransaction(h.identity, { connect: async () => h.client }).then(() => ({ error: undefined }), error => ({ error: error as Error }));
    await Promise.race([ready,nextTurn()]); const didEnter = h.query.mock.calls.length===1; await vi.advanceTimersByTimeAsync(10_001);
    expect(h.release).not.toHaveBeenCalled(); if (didEnter) release();
    expect((await outcome).error?.message).toBe('SKETCH_IMAGE_CANCELLATION_UNCONFIRMED'); expect(h.release).toHaveBeenCalledWith(false); expect(terminate).not.toHaveBeenCalled();
  });
});

describe('canonical SQL empty billing-id absence counterexamples', () => {
  it.each([false, true])('owner cancel accepts original SQL empty absents, full refund only once (free=%s)', async free => {
    const h = harness(free); h.row.credit_cost = String(free ? 0 : 18); h.row.refunded_transaction_id = '';
    if (free) h.row.charged_transaction_id = '';
    expect(await cancelSketchImageTransaction(h.identity, { connect: async () => h.client })).toEqual({ cancelled: true, refunded: !free });
    expect(terminate).toHaveBeenCalledOnce(); expect(h.commits()).toBe(1); expect(h.queries.at(-1)).toBe('COMMIT');
    expect(h.row.charged_transaction_id).toBe(free ? '' : createTaskBillingTransactionId('charge', 'skimg_cancel'));
    expect(h.row.refunded_transaction_id).toBe(free ? '' : 'original-ctx-refund');
    expect(h.transactions).toHaveLength(free ? 0 : 2); expect(h.finance).toEqual(free ? { balance: 100, total_used: 18 } : { balance: 118, total_used: 0 });
    expect(h.release).toHaveBeenCalledWith(false);
  });
});
