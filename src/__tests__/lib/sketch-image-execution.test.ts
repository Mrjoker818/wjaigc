import { createCanvas } from '@napi-rs/canvas';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { PersistedCloudTask } from '@/lib/cloud-task-storage';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import { readSketchImageTaskIdentity, type SketchImageTaskRow } from '@/lib/sketch-to-code/image-task-state';
import { persistSketchImageCheckpoint, readSketchImageCheckpoint, type SketchImageCheckpointInput, type SketchImageCheckpointDependencies } from '@/lib/sketch-to-code/image-execution';
vi.mock('server-only', () => ({}));
const input = { projectId: 'project-a', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: '海边木屋', visionProviderId: 'vision-p',
  visionModelId: 'vision-model', imageProviderId: 'image-p', imageModelId: 'image-model', idempotencyKey: 'nonce-a', aspectRatio: '4:3' };
const access = { kind: 'personal' as const, actorUserId: 'user-a', projectId: 'project-a', ownerId: 'user-a' };
const pricing = { version: 1 as const, vision: { providerId: 'vision-p', modelId: 'vision-model', calls: 1 as const, mode: 'flat' as const, reserveCredits: 7 },
  image: { providerId: 'image-p', modelId: 'image-model', calls: 1 as const, credits: 11 }, totalReserveCredits: 18 };
const analysis = { summary: '木屋与海', composition: '木屋左，海右', prompt: '水彩海边木屋', negativePrompt: '水印' };
const response = { analysis, usage: { inputTokens: 2, outputTokens: 3 } };
const draft = { ...response, receipt: { taskIds: ['remote-a'], directImageUrls: [] as string[], usedModel: 'image-model', usedProviderId: 'image-p' } };
const routing = { vision: '1'.repeat(64), image: '2'.repeat(64) };
afterEach(() => { vi.useRealTimers(); });
function harness(): { value: SketchImageCheckpointInput; dep: SketchImageCheckpointDependencies; queries: string[]; row: SketchImageTaskRow;
  query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn>; fence: ReturnType<typeof vi.fn>; commits: () => number } {
  const expiry = Date.now() + 660_000, task: PersistedCloudTask = { id: 'skimg_one', type: 'sketch-to-image', userId: 'user-a', projectId: 'project-a', providerId: 'image-p',
    model: 'image-model', requestDigest: sketchImageRequestDigest(input), idempotencyKey: 'nonce-a', creditCost: 18, creditStatus: 'pending', status: 'processing',
    progress: 0, revision: 1, createdAt: 1, updatedAt: 1, leaseOwner: 'lease-one', leaseExpiresAt: expiry, attemptCount: 1,
    result: { sketchImageAdmission: structuredClone({ version: 1, route: '/api/sketch-to-image', requestDigest: sketchImageRequestDigest(input), access, input, pricing }) } };
  const row: SketchImageTaskRow = { id: task.id, user_id: 'user-a', project_id: 'project-a', type: task.type, provider_id: 'image-p', model: 'image-model',
    request_digest: task.requestDigest!, idempotency_key: 'nonce-a', result: task.result!, credit_cost: 18, credit_status: 'pending', status: 'processing',
    charged_transaction_id: createTaskBillingTransactionId('charge', task.id), refunded_transaction_id: null, lease_owner: 'lease-one', lease_expires_at: expiry, attempt_count: 1 };
  const queries: string[] = []; let commits = 0;
  const query = vi.fn(async (sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> => {
    queries.push(sql);
    if (sql === 'COMMIT') { commits++; return { rows: [] }; }
    if (sql.startsWith('SELECT * FROM cloud_tasks')) return { rows: [{ ...structuredClone(row) }] };
    if (sql.includes('clock_timestamp()') && sql.startsWith('SELECT')) return { rows: [{ ...structuredClone(row), now_ms: String(Date.now()) }] };
    if (sql.includes('SELECT balance,total_used')) return { rows: [{ balance: 100, total_used: 18 }] };
    if (sql.includes('FROM wujie_credit_transactions')) return { rows: [{ id: row.charged_transaction_id, user_id: 'user-a', type: 'consume', amount: -18,
      balance_after: 100, model: 'image-model', task_id: task.id, reference_id: task.id }] };
    if (sql.startsWith('UPDATE cloud_tasks')) { row.result.sketchImageExecution = JSON.parse(values![1] as string) as unknown; return { rows: [{ result: structuredClone(row.result) }], rowCount: 1 }; }
    return { rows: [] };
  });
  const release = vi.fn(), fence = vi.fn(async (): Promise<void> => {}), check = vi.fn(async () => routing);
  return { row, queries, query, release, check, fence, commits: () => commits,
    value: { identity: readSketchImageTaskIdentity(task), lease: { taskId: task.id, owner: 'lease-one', attemptCount: 1, expiresAt: expiry }, routing,
      phase: 'analysis', signal: new AbortController().signal }, dep: { connect: async () => ({ query, release } as unknown as PoolClient), assertProjectFence: fence, checkCurrent: check } };
}
describe('original task transaction checkpoint (SQL fixture, not PG proof)', () => {
  it('ACKs all four original paid phase barriers with canonical PG NUMERIC text', async () => {
    const h = harness(); h.row.credit_cost = '18';
    for (const phase of ['analysis', 'analysis-complete', 'generation', 'accepted'] as const) {
      await persistSketchImageCheckpoint({ ...h.value, phase, ...(phase === 'analysis-complete' ? { response } : {}), ...(phase === 'accepted' ? { draft } : {}) }, h.dep);
    }
    expect(h.row.credit_cost).toBe('18'); expect(h.commits()).toBe(4); expect(h.check).toHaveBeenCalledTimes(2);
    expect(h.row.result.sketchImageExecution).toEqual({ version: 1, phase: 'accepted', routing, ...response, receipt: draft.receipt });
  });
  it('ACKs free canonical PG NUMERIC text without creating financial rows', async () => {
    const h = harness(), freePricing = { ...pricing, vision: { ...pricing.vision, reserveCredits: 0 }, image: { ...pricing.image, credits: 0 }, totalReserveCredits: 0 };
    h.value = { ...h.value, identity: { ...h.value.identity, pricing: freePricing } };
    (h.row.result.sketchImageAdmission as { pricing: unknown }).pricing = freePricing;
    h.row.credit_cost = '0'; h.row.credit_status = 'not-applicable'; h.row.charged_transaction_id = null;
    const original = h.query.getMockImplementation()!;
    h.query.mockImplementation(async (sql, values) => sql.includes('FROM wujie_credits') || sql.includes('FROM wujie_credit_transactions') ? { rows: [] } : original(sql, values));
    await persistSketchImageCheckpoint(h.value, h.dep);
    expect(h.row.credit_cost).toBe('0'); expect(h.commits()).toBe(1); expect(h.row.result.sketchImageExecution).toMatchObject({ phase: 'analysis' });
    expect(h.queries.some(sql => sql.startsWith('UPDATE wujie_credits'))).toBe(false); expect(h.release).toHaveBeenCalledWith(false);
  });
  it.each(['018', '18.0', '1.8e1', '+18', ' 18', '-0', '9007199254740992', '19'])('refuses noncanonical or wrong SQL reserve %s before checkpoint ACK', async value => {
    const h = harness(); h.row.credit_cost = value;
    await expect(persistSketchImageCheckpoint(h.value, h.dep)).rejects.toThrow('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED');
    expect(h.commits()).toBe(0); expect(h.check).not.toHaveBeenCalled(); expect(h.queries.at(-1)).toBe('ROLLBACK');
  });
  it('ACKs the original permission/finance/lease-fenced phase before return and preserves private admission', async () => {
    const h = harness(), original = structuredClone(h.row.result.sketchImageAdmission); await persistSketchImageCheckpoint(h.value, h.dep);
    expect(h.fence).toHaveBeenCalledOnce(); expect(h.check).toHaveBeenCalledOnce(); expect(h.commits()).toBe(1);
    expect(h.row.result.sketchImageAdmission).toEqual(original); expect(h.row.result.sketchImageExecution).toMatchObject({ version: 1, phase: 'analysis', routing });
    const ledgerLock = h.queries.findIndex(x => x.includes('FROM wujie_credit_transactions'));
    const finalClock = h.queries.flatMap((sql, index) => sql.startsWith('SELECT') && sql.includes('clock_timestamp()') ? [index] : []).at(-1) ?? -1;
    expect(ledgerLock).toBeGreaterThan(-1); expect(finalClock).toBeGreaterThan(ledgerLock); expect(h.queries.at(-1)).toBe('COMMIT'); expect(h.release).toHaveBeenCalledWith(false);
  });
  it('requires all four transitions and exact stored analysis/usage before accepting remote receipt', async () => {
    const h = harness(); for (const phase of ['analysis', 'analysis-complete', 'generation', 'accepted'] as const) {
      await persistSketchImageCheckpoint({ ...h.value, phase, ...(phase === 'analysis-complete' ? { response } : {}), ...(phase === 'accepted' ? { draft } : {}) }, h.dep);
    } expect(h.commits()).toBe(4); expect(h.check).toHaveBeenCalledTimes(2);
    expect(h.row.result.sketchImageExecution).toEqual({ version: 1, phase: 'accepted', routing, ...response, receipt: draft.receipt });
  });
  it.each(['analysis-complete', 'generation', 'accepted'] as const)('cannot skip directly to %s', async phase => {
    const h = harness(); await expect(persistSketchImageCheckpoint({ ...h.value, phase, response, draft }, h.dep)).rejects.toThrow('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED');
    expect(h.commits()).toBe(0); expect(h.queries.at(-1)).toBe('ROLLBACK');
  });
  it('does not repeat an already started analysis phase even in a fresh process', async () => {
    const h = harness(); await persistSketchImageCheckpoint(h.value, h.dep);
    await expect(persistSketchImageCheckpoint(h.value, h.dep)).rejects.toThrow('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED'); expect(h.commits()).toBe(1);
  });
  it.each(['owner', 'expiry', 'attempt', 'terminal', 'refund', 'permission', 'routing'] as const)('never commits wrong or expired %s authority', async kind => {
    const h = harness(); if (kind === 'owner') h.row.lease_owner = 'other'; if (kind === 'expiry') h.row.lease_expires_at = Date.now() - 1;
    if (kind === 'attempt') h.row.attempt_count = 2; if (kind === 'terminal') h.row.status = 'cancelled'; if (kind === 'refund') h.row.refunded_transaction_id = 'refund-one';
    if (kind === 'permission') h.fence.mockRejectedValueOnce(new Error('revoked')); if (kind === 'routing') h.check.mockResolvedValueOnce({ ...routing, image: '3'.repeat(64) });
    await expect(persistSketchImageCheckpoint(h.value, h.dep)).rejects.toThrow('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED'); expect(h.commits()).toBe(0);
  });
  it('pre-cancellation makes zero connection or query attempts', async () => {
    const h = harness(), c = new AbortController(), reason = new Error('stop-now'); c.abort(reason);
    await expect(persistSketchImageCheckpoint({ ...h.value, signal: c.signal }, h.dep)).rejects.toBe(reason); expect(h.query).not.toHaveBeenCalled();
  });
  it('waits for the real terminal query before rollback/release and discards its late ACK after cancel', async () => {
    const h = harness(), original = h.query.getMockImplementation()!, c = new AbortController(); let releaseQuery!: () => void, entered!: () => void;
    const ready = new Promise<void>(r => { entered = r; });
    h.query.mockImplementationOnce(async (sql: string) => { entered(); await new Promise<void>(r => { releaseQuery = r; }); return original(sql); });
    const result = persistSketchImageCheckpoint({ ...h.value, signal: c.signal }, h.dep);
    const observed = result.then(() => ({ error: undefined }), error => ({ error: error as Error }));
    await ready; c.abort(new Error('cancel')); await nextTurn(); expect(h.release).not.toHaveBeenCalled(); expect(h.queries).toHaveLength(0);
    releaseQuery(); expect((await observed).error?.message).toBe('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED'); expect(h.queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(h.release).toHaveBeenCalledWith(false); expect(h.commits()).toBe(0);
  });
  it('unknown successful COMMIT acknowledgement destroys the connection, never retries or refunds', async () => {
    const h = harness(), original = h.query.getMockImplementation()!;
    h.query.mockImplementation(async (sql: string, values?: unknown[]) => { const result = await original(sql, values); if (sql === 'COMMIT') throw new Error('private-ack-lost'); return result; });
    await expect(persistSketchImageCheckpoint(h.value, h.dep)).rejects.toThrow('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED');
    expect(h.commits()).toBe(1); expect(h.release).toHaveBeenCalledWith(true); expect(h.queries).not.toContain('ROLLBACK');
    expect(h.queries.filter(x => x.startsWith('UPDATE cloud_tasks'))).toHaveLength(1); expect(h.queries.some(x => x.startsWith('UPDATE wujie_credits'))).toBe(false);
  });
  it('a hanging current-model check is bounded without racing any query on the original locked client', async () => {
    const h = harness(); let enter!: () => void, releaseCheck!: () => void, settled = false;
    const entered = new Promise<void>(r => { enter = r; });
    h.check.mockImplementationOnce(async () => { enter(); await new Promise<void>(r => { releaseCheck = r; }); return routing; });
    vi.useFakeTimers(); const outcome = persistSketchImageCheckpoint(h.value, h.dep).then(() => ({ error: undefined }), error => ({ error: error as Error }));
    void outcome.then(() => { settled = true; }); await entered; await vi.advanceTimersByTimeAsync(5000);
    const settledAtBudget = settled; releaseCheck(); const result = await outcome;
    expect(settledAtBudget).toBe(true); expect(result.error?.message).toBe('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED');
    expect(h.commits()).toBe(0); expect(h.queries.at(-1)).toBe('ROLLBACK'); expect(h.release).toHaveBeenCalledWith(false);
  });
  it.each(['analysis', 'usage', 'model'] as const)('does not accept a receipt with changed persisted %s', async kind => {
    const h = harness(); await persistSketchImageCheckpoint(h.value, h.dep);
    await persistSketchImageCheckpoint({ ...h.value, phase: 'analysis-complete', response }, h.dep);
    await persistSketchImageCheckpoint({ ...h.value, phase: 'generation' }, h.dep);
    const changed = structuredClone(draft);
    if (kind === 'analysis') changed.analysis.prompt = 'different'; if (kind === 'usage') changed.usage.inputTokens = 99; if (kind === 'model') changed.receipt.usedModel = 'other';
    await expect(persistSketchImageCheckpoint({ ...h.value, phase: 'accepted', draft: changed }, h.dep)).rejects.toThrow('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED');
    expect(h.commits()).toBe(3); expect(h.row.result.sketchImageExecution).toMatchObject({ phase: 'generation' });
  });
  it('missing real token usage cannot advance into a paid image phase or mutate credits', async () => {
    const h = harness(), tokenPricing = { ...pricing, vision: { ...pricing.vision, mode: 'token' as const, tokenPricing: { input: 10, output: 20 } } };
    h.value = { ...h.value, identity: { ...h.value.identity, pricing: tokenPricing } };
    (h.row.result.sketchImageAdmission as { pricing: unknown }).pricing = tokenPricing;
    await persistSketchImageCheckpoint(h.value, h.dep);
    await expect(persistSketchImageCheckpoint({ ...h.value, phase: 'analysis-complete', response: { analysis } }, h.dep)).rejects.toThrow('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED');
    expect(h.commits()).toBe(1); expect(h.row.result.sketchImageExecution).toMatchObject({ phase: 'analysis' }); expect(h.check).toHaveBeenCalledOnce();
    expect(h.queries.some(sql => sql.startsWith('UPDATE wujie_credits'))).toBe(false);
  });
  it.each(['analysis-complete', 'generation', 'accepted'] as const)('restored token %s cannot omit original real usage', phase => {
    const h = harness(), tokenPricing = { ...pricing, vision: { ...pricing.vision, mode: 'token' as const, tokenPricing: { input: 10, output: 20 } } };
    const identity = { ...h.value.identity, pricing: tokenPricing };
    expect(() => readSketchImageCheckpoint({ version: 1, phase, routing, analysis, ...(phase === 'accepted' ? { receipt: draft.receipt } : {}) }, identity)).toThrow('SKETCH_IMAGE_USAGE_INVALID');
  });
  it.each(['analysis-complete', 'generation'] as const)('missing stored token usage never ACKs a transition from %s', async phase => {
    const h = harness(), tokenPricing = { ...pricing, vision: { ...pricing.vision, mode: 'token' as const, tokenPricing: { input: 10, output: 20 } } };
    h.value = { ...h.value, identity: { ...h.value.identity, pricing: tokenPricing } };
    (h.row.result.sketchImageAdmission as { pricing: unknown }).pricing = tokenPricing;
    h.row.result.sketchImageExecution = { version: 1, phase, routing, analysis };
    await expect(persistSketchImageCheckpoint({ ...h.value, phase: phase === 'analysis-complete' ? 'generation' : 'accepted',
      ...(phase === 'generation' ? { draft: { analysis, receipt: draft.receipt } } : {}) }, h.dep)).rejects.toThrow('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED');
    expect(h.commits()).toBe(0); expect(h.check).not.toHaveBeenCalled(); expect(h.queries.some(sql => sql.startsWith('UPDATE cloud_tasks'))).toBe(false);
  });
  it('restoration preserves optional usage for flat and exact real usage for token', () => {
    const h = harness(), saved = { version: 1, phase: 'accepted', routing, analysis, receipt: draft.receipt };
    expect(readSketchImageCheckpoint(saved, h.value.identity)).toMatchObject({ phase: 'accepted', analysis });
    const tokenPricing = { ...pricing, vision: { ...pricing.vision, mode: 'token' as const, tokenPricing: { input: 10, output: 20 } } };
    expect(readSketchImageCheckpoint({ ...saved, usage: response.usage }, { ...h.value.identity, pricing: tokenPricing })).toMatchObject({ usage: response.usage });
  });
});
