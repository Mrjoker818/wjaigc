import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { terminateCloudTaskAndRefund, type CloudTaskLease } from '@/lib/cloud-task-storage';
import { getPool } from '@/lib/db-client';
import { assertSketchProjectFence } from './admission';
import { assertSketchImageTaskRow, readSketchImageTaskRowIdentity, type SketchImageTaskIdentity, type SketchImageTaskRow } from './image-task-state';
import { readSketchImageCheckpoint, type SketchImageRouting } from './image-execution';
import { lockSketchImageLedger, readSketchImageSqlBillingId } from './image-ledger';
import { readSketchImageKnownFailure } from './image-known-failure';
export interface SketchImageFailureInput {
  readonly identity: Readonly<SketchImageTaskIdentity>; readonly lease: Readonly<CloudTaskLease>;
  readonly routing: Readonly<SketchImageRouting>; readonly error: unknown; readonly signal: AbortSignal;
}
export interface SketchImageFailureDependencies {
  connect?: () => Promise<PoolClient>;
  assertProjectFence?: (client: PoolClient, access: SketchImageTaskIdentity['access']) => Promise<void>;
}
/** No public error string, unknown receipt or memory abort supplies refund authority. */
export async function settleSketchImageKnownFailure(value: SketchImageFailureInput,
  dependencies: SketchImageFailureDependencies = {}): Promise<boolean> {
  const evidence = readSketchImageKnownFailure(value.error);
  if (!evidence || value.signal.aborted) return false;
  const source = structuredClone({ identity: value.identity, lease: value.lease, routing: value.routing });
  const { identity, lease, routing } = source, signal = value.signal;
  const binding = evidence.phase === 'analysis'
    ? { providerId: identity.input.visionProviderId, modelId: identity.input.visionModelId }
    : { providerId: identity.input.imageProviderId, modelId: identity.input.imageModelId };
  if (evidence.providerId !== binding.providerId || evidence.modelId !== binding.modelId) return false;
  const deadline = Math.min(lease.expiresAt, Date.now() + 10_000);
  const connect = dependencies.connect || (() => getPool().connect()), fence = dependencies.assertProjectFence || assertSketchProjectFence;
  let raw: PoolClient | undefined, began = false, committing = false, discard = false;
  const reject = (): never => { throw new Error('SKETCH_IMAGE_FAILURE_UNCONFIRMED'); };
  const guard = (): void => { if (signal.aborted || Date.now() >= deadline) reject(); };
  const phaseFence = (row: SketchImageTaskRow): void => {
    const saved = readSketchImageCheckpoint(row.result.sketchImageExecution, identity);
    if (!saved || !isDeepStrictEqual(saved.routing, routing) || saved.phase !== (evidence.phase === 'result' ? 'accepted' : evidence.phase)
      || evidence.phase === 'result' && (saved.receipt?.taskIds.length !== 1 || saved.receipt.taskIds[0] !== evidence.remoteId || saved.receipt.directImageUrls.length !== 0)
      || ['previewAssetId', 'previewAssetVersionId', 'imageAssetId', 'imageAssetVersionId'].some(key => Object.hasOwn(row.result, key))) reject();
  };
  try {
    guard(); raw = await connect(); guard();
    const client = new Proxy(raw, { get(target, key) {
      if (key === 'query') return async (...args: unknown[]): Promise<unknown> => {
        guard(); const result: unknown = await Reflect.apply(target.query, target, args); guard(); return result;
      };
      const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
    } });
    began = true; await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    const row = (await client.query<SketchImageTaskRow>('SELECT * FROM cloud_tasks WHERE id=$1 FOR UPDATE', [identity.taskId])).rows[0];
    assertSketchImageTaskRow(row, identity, lease, 0, deadline); phaseFence(row);
    const originalResult = structuredClone(row.result);
    await fence(client, identity.access); await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    // Original complete identity/quote was verified above; strict ledger remains
    // the sole original financial read guard. No NUMERIC coercion of finance rows.
    const ledger = await lockSketchImageLedger(client, { ...row, credit_cost: identity.pricing.totalReserveCredits });
    const reserve = ledger.pricing.totalReserveCredits;
    const dbGuard = async (settled: boolean): Promise<SketchImageTaskRow> => {
      const current = (await client.query<SketchImageTaskRow & { now_ms: unknown }>(
        'SELECT *, (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS now_ms FROM cloud_tasks WHERE id=$1', [identity.taskId])).rows[0];
      if (!settled) {
        assertSketchImageTaskRow(current, identity, lease, current?.now_ms, deadline);
        if (readSketchImageSqlBillingId(current.refunded_transaction_id) !== null) reject();
      }
      else {
        const now = typeof current?.now_ms === 'string' && /^(0|[1-9]\d*)$/.test(current.now_ms) ? Number(current.now_ms) : current?.now_ms;
        if (!current || !isDeepStrictEqual(readSketchImageTaskRowIdentity(current), identity)
          || typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0 || now >= deadline
          || current.status !== 'failed' || current.credit_status !== (reserve ? 'refunded' : 'not-applicable')
          || current.lease_owner !== '' || current.lease_expires_at !== 0 && current.lease_expires_at !== '0'
          || current.attempt_count !== lease.attemptCount || (reserve ? readSketchImageSqlBillingId(current.refunded_transaction_id) === null
            : readSketchImageSqlBillingId(current.refunded_transaction_id) !== null)) reject();
      }
      if (readSketchImageSqlBillingId(current.charged_transaction_id) !== ledger.chargeId || !isDeepStrictEqual(current.result, originalResult)) reject();
      phaseFence(current); guard(); return current;
    };
    await dbGuard(false);
    if (reserve && (ledger.balance === null || ledger.totalUsed === null || ledger.balance + reserve > 2_147_483_647 || ledger.totalUsed < reserve)) reject();
    // Same original locked task/client; the old code-only opt-in fence is never
    // reused to broaden task type. Active + exact original lease remains required.
    const result = await terminateCloudTaskAndRefund(identity.taskId, 'failed', 'SKETCH_IMAGE_STAGE_REJECTED', lease.owner, { requireActive: true, client });
    if (!result.transitioned || result.status !== 'failed' || result.userId !== identity.actorUserId || result.creditCost !== reserve || result.refunded !== (reserve > 0)) reject();
    const settled = await dbGuard(true);
    const accounts = (await client.query<{ balance: unknown; total_used: unknown }>('SELECT balance,total_used FROM wujie_credits WHERE user_id=$1', [identity.actorUserId])).rows;
    if (ledger.balance === null ? accounts.length !== 0 : accounts.length !== 1 || accounts[0].balance !== ledger.balance + reserve
      || accounts[0].total_used !== ledger.totalUsed! - reserve) reject();
    if (reserve && result.balance !== accounts[0].balance) reject();
    const transactions = (await client.query<Record<string, unknown>>(`SELECT id,user_id,type,amount,balance_after,model,task_id,reference_id
      FROM wujie_credit_transactions WHERE task_id=$1 OR reference_id=$1 OR id=ANY($2::text[]) ORDER BY id FOR SHARE`,
    [identity.taskId, [ledger.chargeId, settled.refunded_transaction_id]])).rows;
    if (!reserve) { if (transactions.length !== 0) reject(); }
    else {
      const charge = transactions.find(item => item.id === ledger.chargeId), refund = transactions.find(item => item.id === settled.refunded_transaction_id);
      if (transactions.length !== 2 || !isDeepStrictEqual(charge, ledger.transactions[0]) || !refund || refund.id === ledger.chargeId
        || refund.user_id !== identity.actorUserId || refund.type !== 'refund' || refund.amount !== reserve
        || refund.balance_after !== accounts[0].balance || refund.task_id !== identity.taskId || refund.reference_id !== identity.taskId) reject();
    }
    await dbGuard(true); guard(); committing = true; await client.query('COMMIT'); return true;
  } catch {
    if (committing) discard = true;
    else if (raw && began) try { await raw.query('ROLLBACK'); } catch { discard = true; }
    return false;
  } finally { raw?.release(discard); }
}
