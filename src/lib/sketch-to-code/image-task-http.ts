import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { terminateCloudTaskAndRefund } from '@/lib/cloud-task-storage';
import { readSketchImageTaskRowIdentity, type SketchImageTaskIdentity, type SketchImageTaskRow } from './image-task-state';
import { lockSketchImageLedger, readSketchImageSqlBillingId } from './image-ledger';
export interface SketchImageCancelDependencies { connect?: () => Promise<PoolClient> }
export interface SketchImageCancelResult { cancelled: boolean; refunded: boolean }
function failure(): never { throw new Error('SKETCH_IMAGE_CANCELLATION_UNCONFIRMED'); }
/** Explicit original owner cancellation. No current write grant or worker lease
 * is required, and only an ACKed original terminal transaction permits UI abort.
 * No automatic cancellation is inferred from unknown provider/checkpoint state. */
export async function cancelSketchImageTransaction(identityValue: Readonly<SketchImageTaskIdentity>,
  dependencies: SketchImageCancelDependencies = {}): Promise<SketchImageCancelResult> {
  const identity = structuredClone(identityValue), deadline = Date.now() + 10_000;
  const connect = dependencies.connect || (() => getPool().connect());
  let raw: PoolClient | undefined, began = false, committing = false, discard = false;
  const guard = (): void => { if (Date.now() >= deadline) failure(); };
  try {
    guard(); raw = await connect(); guard();
    const client = new Proxy(raw, { get(target, key) {
      if (key === 'query') return async (...args: unknown[]): Promise<unknown> => {
        guard(); const result: unknown = await Reflect.apply(target.query, target, args); guard(); return result;
      };
      const value: unknown = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    began = true; await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    const row = (await client.query<SketchImageTaskRow>('SELECT * FROM cloud_tasks WHERE id=$1 FOR UPDATE', [identity.taskId])).rows[0];
    if (!row || !isDeepStrictEqual(readSketchImageTaskRowIdentity(row), identity) || row.status !== 'processing') failure();
    // Adapt only after exact original identity and frozen quote verification.
    const ledger = await lockSketchImageLedger(client, { ...row, credit_cost: identity.pricing.totalReserveCredits }), reserve = ledger.pricing.totalReserveCredits;
    const dbGuard = async (settled: boolean): Promise<SketchImageTaskRow> => {
      const current = (await client.query<SketchImageTaskRow & { now_ms: unknown }>(
        'SELECT *, (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS now_ms FROM cloud_tasks WHERE id=$1', [identity.taskId])).rows[0];
      const now = typeof current?.now_ms === 'string' && /^(0|[1-9]\d*)$/.test(current.now_ms) ? Number(current.now_ms) : current?.now_ms;
      if (!current || !isDeepStrictEqual(readSketchImageTaskRowIdentity(current), identity) || typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0 || now >= deadline
        || readSketchImageSqlBillingId(current.charged_transaction_id) !== ledger.chargeId
        || current.status !== (settled ? 'cancelled' : 'processing')
        || current.credit_status !== (reserve ? settled ? 'refunded' : 'pending' : 'not-applicable')
        || (settled ? current.lease_owner !== '' || Number(current.lease_expires_at) !== 0
          || (reserve ? readSketchImageSqlBillingId(current.refunded_transaction_id) === null : readSketchImageSqlBillingId(current.refunded_transaction_id) !== null)
          : readSketchImageSqlBillingId(current.refunded_transaction_id) !== null)) failure(); guard(); return current;
    };
    await dbGuard(false);
    if (reserve && (ledger.balance === null || ledger.totalUsed === null || ledger.balance + reserve > 2_147_483_647 || ledger.totalUsed < reserve)) failure();
    // The wrapper's original task/finance locks remain held across this exact
    // caller-owned client call. Never use the old code-mode-only opt-in fence.
    const result = await terminateCloudTaskAndRefund(identity.taskId, 'cancelled', 'SKETCH_IMAGE_EXECUTION_CANCELLED', undefined, { requireActive: true, client });
    if (!result.transitioned || result.status !== 'cancelled' || result.userId !== identity.actorUserId || result.creditCost !== reserve || result.refunded !== (reserve > 0)) failure();
    const settled = await dbGuard(true);
    const accounts = (await client.query<{ balance: unknown; total_used: unknown }>('SELECT balance,total_used FROM wujie_credits WHERE user_id=$1', [identity.actorUserId])).rows;
    if (ledger.balance === null ? accounts.length !== 0 : accounts.length !== 1 || accounts[0].balance !== ledger.balance + reserve || accounts[0].total_used !== ledger.totalUsed! - reserve) failure();
    if (reserve && result.balance !== accounts[0].balance) failure();
    const transactions = (await client.query<Record<string, unknown>>(`SELECT id,user_id,type,amount,balance_after,model,task_id,reference_id
      FROM wujie_credit_transactions WHERE task_id=$1 OR reference_id=$1 OR id=ANY($2::text[]) ORDER BY id FOR SHARE`,
    [identity.taskId, [ledger.chargeId, settled.refunded_transaction_id]])).rows;
    if (!reserve) { if (transactions.length !== 0) failure(); }
    else {
      if (transactions.length !== 2) failure();
      const charge = transactions.find(row => row.id === ledger.chargeId), refund = transactions.find(row => row.id === settled.refunded_transaction_id);
      if (!isDeepStrictEqual(charge, ledger.transactions[0]) || !refund || refund.id === ledger.chargeId || refund.user_id !== identity.actorUserId
        || refund.type !== 'refund' || refund.amount !== reserve || refund.balance_after !== accounts[0].balance
        || refund.task_id !== identity.taskId || refund.reference_id !== identity.taskId) failure();
    }
    await dbGuard(true); guard(); committing = true; await client.query('COMMIT'); return { cancelled: true, refunded: reserve > 0 };
  } catch {
    if (committing) discard = true;
    else if (raw && began) try { await raw.query('ROLLBACK'); } catch { discard = true; }
    return failure();
  } finally { raw?.release(discard); }
}
