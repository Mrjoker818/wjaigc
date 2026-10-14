import { createCanvas } from '@napi-rs/canvas';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { PersistedCloudTask } from '@/lib/cloud-task-storage';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import { readSketchImageTaskIdentity, type SketchImageTaskRow } from '@/lib/sketch-to-code/image-task-state';
import { markSketchImageKnownFailure } from '@/lib/sketch-to-code/image-known-failure';
import { settleSketchImageKnownFailure, type SketchImageFailureInput } from '@/lib/sketch-to-code/image-failure';
const { terminate } = vi.hoisted(() => ({ terminate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/cloud-task-storage', async importOriginal => ({ ...(await importOriginal<Record<string, unknown>>()), terminateCloudTaskAndRefund: terminate }));
afterEach(() => vi.useRealTimers());
function harness(phase: 'analysis' | 'generation' | 'result' = 'generation', free = false): {
  value: SketchImageFailureInput; row: SketchImageTaskRow; query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>;
  fence: ReturnType<typeof vi.fn>; finance: { balance: number; total_used: number }; transactions: Record<string, unknown>[];
  queries: string[]; connect: () => Promise<PoolClient>;
} {
  const cost = free ? 0 : 18, input = { projectId: 'p', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: '木屋',
    visionProviderId: 'vp', visionModelId: 'vm', imageProviderId: 'ip', imageModelId: 'im', idempotencyKey: 'nonce', aspectRatio: '1:1' };
  const pricing = { version: 1, vision: { providerId: 'vp', modelId: 'vm', calls: 1, mode: 'flat', reserveCredits: free ? 0 : 7 },
    image: { providerId: 'ip', modelId: 'im', calls: 1, credits: free ? 0 : 11 }, totalReserveCredits: cost };
  const routing = { vision: '1'.repeat(64), image: '2'.repeat(64) }, access = { kind: 'personal', actorUserId: 'actor', ownerId: 'actor', projectId: 'p' };
  const analysis = { summary: '木屋', composition: '木屋在左', prompt: '水彩木屋', negativePrompt: '' }, expiry = Date.now() + 660_000;
  const task = { id: 'skimg_failure', type: 'sketch-to-image', userId: 'actor', projectId: 'p', providerId: 'ip', model: 'im', status: 'processing',
    progress: 0, revision: 1, createdAt: 0, updatedAt: 0, creditCost: cost, creditStatus: free ? 'not-applicable' : 'pending',
    requestDigest: sketchImageRequestDigest(input), idempotencyKey: 'nonce', result: {
      sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', requestDigest: sketchImageRequestDigest(input), input, pricing, access },
      sketchImageExecution: { version: 1, phase: phase === 'result' ? 'accepted' : phase, routing: structuredClone(routing), ...(phase === 'analysis' ? {} : { analysis }),
        ...(phase === 'result' ? { receipt: { taskIds: ['remote-a'], directImageUrls: [], usedModel: 'im', usedProviderId: 'ip' } } : {}) } },
  } satisfies PersistedCloudTask;
  const row: SketchImageTaskRow = { id: task.id, type: task.type, user_id: 'actor', project_id: 'p', provider_id: 'ip', model: 'im', status: 'processing',
    request_digest: task.requestDigest, idempotency_key: 'nonce', result: task.result, credit_cost: String(cost), credit_status: task.creditStatus,
    charged_transaction_id: free ? null : createTaskBillingTransactionId('charge', task.id), refunded_transaction_id: null,
    lease_owner: 'lease-a', lease_expires_at: expiry, attempt_count: 1 };
  const finance = { balance: 100, total_used: cost }, transactions: Record<string, unknown>[] = free ? [] : [{ id: row.charged_transaction_id, user_id: 'actor',
    type: 'consume', amount: -cost, balance_after: 100, model: 'im', task_id: task.id, reference_id: task.id }];
  const queries: string[] = [], release = vi.fn(), fence = vi.fn(async (): Promise<void> => {});
  const query = vi.fn(async (sql: string): Promise<{ rows: Record<string, unknown>[] }> => {
    queries.push(sql);
    if (sql.startsWith('SELECT *')) return { rows: [{ ...structuredClone(row), ...(sql.includes('clock_timestamp') ? { now_ms: String(Date.now()) } : {}) }] };
    if (sql.includes('FROM wujie_credits')) return { rows: free ? [] : [{ ...finance }] };
    if (sql.includes('FROM wujie_credit_transactions')) return { rows: structuredClone(transactions) };
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql)) return { rows: [] };
    throw new Error('UNEXPECTED_SQL');
  });
  terminate.mockReset(); terminate.mockImplementation(async (_taskId: string, status: string) => {
    queries.push('ORIGINAL_TERMINATION'); row.status = status; row.lease_owner = ''; row.lease_expires_at = 0;
    if (!free) { finance.balance += cost; finance.total_used -= cost; row.credit_status = 'refunded'; row.refunded_transaction_id = 'original-refund';
      transactions.push({ id: 'original-refund', user_id: 'actor', type: 'refund', amount: cost, balance_after: finance.balance, model: '', task_id: task.id, reference_id: task.id }); }
    return { status, userId: 'actor', transitioned: true, refunded: !free, creditCost: cost, balance: free ? undefined : finance.balance };
  });
  const binding = phase === 'analysis' ? { providerId: 'vp', modelId: 'vm' } : { providerId: 'ip', modelId: 'im' };
  const error = markSketchImageKnownFailure(new Error('safe-original'), { phase, ...binding, kind: phase === 'result' ? 'remote-failed' : 'rejected',
    ...(phase === 'result' ? { remoteId: 'remote-a' } : {}) });
  return { value: { identity: readSketchImageTaskIdentity(task), lease: { taskId: task.id, owner: 'lease-a', expiresAt: expiry, attemptCount: 1 },
    routing, error, signal: new AbortController().signal }, row, query, release, fence, finance, transactions, queries,
    connect: async () => ({ query, release } as unknown as PoolClient) };
}
describe('known failure original fenced transaction (controlled SQL, not real PG)', () => {
  it.each(['analysis', 'generation', 'result'] as const)('settles confirmed %s failure once using original same-client terminal authority', async phase => {
    const h = harness(phase), admission = structuredClone(h.row.result.sketchImageAdmission);
    expect(await settleSketchImageKnownFailure(h.value, { connect: h.connect, assertProjectFence: h.fence })).toBe(true);
    expect(terminate).toHaveBeenCalledOnce(); expect(terminate.mock.calls[0].slice(0, 4)).toEqual(['skimg_failure', 'failed', 'SKETCH_IMAGE_STAGE_REJECTED', 'lease-a']);
    expect(terminate.mock.calls[0][4]).toMatchObject({ requireActive: true }); expect(h.row.status).toBe('failed'); expect(h.finance).toEqual({ balance: 118, total_used: 0 });
    expect(h.transactions).toHaveLength(2); expect(h.row.result.sketchImageAdmission).toEqual(admission); expect(h.row.credit_cost).toBe('18');
    expect(h.fence).toHaveBeenCalledOnce(); expect(h.queries.at(-1)).toBe('COMMIT'); expect(h.release).toHaveBeenCalledWith(false);
  });
  it('settles a zero-submit proven generation failure and never posts or initializes free finance', async () => {
    const h = harness('generation', true); h.value = { ...h.value, error: markSketchImageKnownFailure(new Error('safe'),
      { phase: 'generation', providerId: 'ip', modelId: 'im', kind: 'not-submitted' }) };
    expect(await settleSketchImageKnownFailure(h.value, { connect: h.connect, assertProjectFence: h.fence })).toBe(true);
    expect(h.transactions).toHaveLength(0); expect(h.finance).toEqual({ balance: 100, total_used: 0 }); expect(h.row.credit_status).toBe('not-applicable');
  });
  it('unknown strings/forged proof and pre-aborted operation perform no DB or termination attempt', async () => {
    const h = harness(), connect = vi.fn(h.connect);
    for (const error of [new Error('SKETCH_IMAGE_PROVIDER_REJECTED'), { phase: 'generation', kind: 'rejected', providerId: 'ip', modelId: 'im' }]) {
      expect(await settleSketchImageKnownFailure({ ...h.value, error }, { connect, assertProjectFence: h.fence })).toBe(false);
    }
    const c = new AbortController(); c.abort();
    expect(await settleSketchImageKnownFailure({ ...h.value, signal: c.signal }, { connect, assertProjectFence: h.fence })).toBe(false);
    expect(connect).not.toHaveBeenCalled(); expect(terminate).not.toHaveBeenCalled();
  });
  it.each(['owner', 'attempt', 'expiry', 'terminal', 'refund', 'quote', 'phase', 'routing', 'binding', 'remote', 'grant', 'ledger'] as const)
    ('does not terminate changed original %s authority', async kind => {
      const h = harness(kind === 'remote' ? 'result' : 'generation');
      if (kind === 'owner') h.row.lease_owner = 'other'; if (kind === 'attempt') h.row.attempt_count = 2; if (kind === 'expiry') h.row.lease_expires_at = 0;
      if (kind === 'terminal') h.row.status = 'completed'; if (kind === 'refund') h.row.refunded_transaction_id = 'other'; if (kind === 'quote') h.row.credit_cost = '19';
      if (kind === 'phase') (h.row.result.sketchImageExecution as { phase: string }).phase = 'accepted';
      if (kind === 'routing') (h.row.result.sketchImageExecution as { routing: { image: string } }).routing.image = '3'.repeat(64);
      if (kind === 'binding') h.value = { ...h.value, error: markSketchImageKnownFailure(new Error('safe'), { phase: 'generation', kind: 'rejected', providerId: 'other', modelId: 'im' }) };
      if (kind === 'remote') (h.row.result.sketchImageExecution as { receipt: { taskIds: string[] } }).receipt.taskIds = ['other'];
      if (kind === 'grant') h.fence.mockRejectedValueOnce(new Error('revoked')); if (kind === 'ledger') h.transactions[0].amount = -19;
      expect(await settleSketchImageKnownFailure(h.value, { connect: h.connect, assertProjectFence: h.fence })).toBe(false);
      expect(terminate).not.toHaveBeenCalled(); expect(h.queries).not.toContain('COMMIT');
    });
  it.each(['balance', 'refund', 'identity', 'clock'] as const)('rolls back mismatching original %s after settlement before COMMIT', async kind => {
    const h = harness(), original = terminate.getMockImplementation()!;
    if (kind === 'clock') vi.useFakeTimers();
    terminate.mockImplementationOnce(async (...args: unknown[]) => { const result = await original(...args);
      if (kind === 'balance') h.finance.balance++; if (kind === 'refund') h.transactions[1].amount = (h.transactions[1].amount as number) + 1;
      if (kind === 'identity') h.row.user_id = 'other'; if (kind === 'clock') vi.setSystemTime(Date.now() + 10_001); return result;
    });
    expect(await settleSketchImageKnownFailure(h.value, { connect: h.connect, assertProjectFence: h.fence })).toBe(false);
    expect(h.queries.at(-1)).toBe('ROLLBACK'); expect(h.queries).not.toContain('COMMIT'); expect(h.release).toHaveBeenCalledWith(false);
  });
  it('unknown successful COMMIT ACK discards without second refund, rollback or success', async () => {
    const h = harness(), original = h.query.getMockImplementation()!;
    h.query.mockImplementation(async sql => { const result = await original(sql); if (sql === 'COMMIT') throw new Error('ack-loss'); return result; });
    expect(await settleSketchImageKnownFailure(h.value, { connect: h.connect, assertProjectFence: h.fence })).toBe(false);
    expect(h.queries.filter(q => q === 'COMMIT')).toHaveLength(1); expect(h.queries).not.toContain('ROLLBACK'); expect(terminate).toHaveBeenCalledOnce(); expect(h.release).toHaveBeenCalledWith(true);
  });
  it('owns a busy actual query until terminal rollback, even after cancellation', async () => {
    const h = harness(), original = h.query.getMockImplementation()!, c = new AbortController(); let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; });
    h.query.mockImplementationOnce(async sql => { enter(); await new Promise<void>(r => { release = r; }); return original(sql); });
    const running = settleSketchImageKnownFailure({ ...h.value, signal: c.signal }, { connect: h.connect, assertProjectFence: h.fence });
    await entered; c.abort(); await nextTurn(); expect(h.release).not.toHaveBeenCalled(); release();
    expect(await running).toBe(false); expect(h.queries).toEqual(['BEGIN', 'ROLLBACK']); expect(h.release).toHaveBeenCalledWith(false); expect(terminate).not.toHaveBeenCalled();
  });
});

describe('canonical SQL empty billing-id absence counterexamples', () => {
  it.each([false, true])('known generation failure accepts original SQL empty absents with exact terminal refund (free=%s)', async free => {
    const h = harness('generation', free), originalResult = structuredClone(h.row.result);
    h.row.refunded_transaction_id = ''; if (free) h.row.charged_transaction_id = '';
    expect(await settleSketchImageKnownFailure(h.value, { connect: h.connect, assertProjectFence: h.fence })).toBe(true);
    expect(terminate).toHaveBeenCalledOnce(); expect(terminate.mock.calls[0].slice(0, 4)).toEqual(['skimg_failure', 'failed', 'SKETCH_IMAGE_STAGE_REJECTED', 'lease-a']);
    expect(terminate.mock.calls[0][4]).toMatchObject({ requireActive: true }); expect(h.row.result).toEqual(originalResult);
    expect(h.row.charged_transaction_id).toBe(free ? '' : createTaskBillingTransactionId('charge', 'skimg_failure'));
    expect(h.row.refunded_transaction_id).toBe(free ? '' : 'original-refund');
    expect(h.transactions).toHaveLength(free ? 0 : 2); expect(h.finance).toEqual(free ? { balance: 100, total_used: 0 } : { balance: 118, total_used: 0 });
    expect(h.queries.at(-1)).toBe('COMMIT'); expect(h.queries.filter(q => q === 'COMMIT')).toHaveLength(1); expect(h.release).toHaveBeenCalledWith(false);
  });
});
