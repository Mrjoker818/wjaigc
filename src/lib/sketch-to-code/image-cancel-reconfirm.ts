import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { readSketchImageTaskRowIdentity, type SketchImageTaskIdentity, type SketchImageTaskRow } from './image-task-state';
import { sketchFields } from './http';

export interface SketchImageCancellationReceiptDependencies { connect?: () => Promise<PoolClient> }
/** Classification only, never refund evidence or financial authority. The suffix
 * can be empty when the original Math.random() is zero; the SQL proof still applies. */
export function isOriginalSketchImageGenericRefundId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^ctx_(0|[1-9]\d*)_[a-z0-9]{0,8}$/u.exec(value);
  return !!match && Number.isSafeInteger(Number(match[1]));
}
function invalid(): never { throw new Error('SKETCH_IMAGE_CANCELLATION_UNCONFIRMED'); }
function dbInteger(value: unknown): number {
  const number = typeof value === 'string' && /^(0|[1-9]\d*)$/u.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) invalid();
  return number;
}
/** Read-only confirmation of an already committed original cancellation receipt.
 * No terminal transition, charge/refund, account init, grant refresh or provider call.
 * The caller separately verifies its original candidate and fresh private identity. */
export async function confirmSketchImageCancellationReceipt(identityValue: Readonly<SketchImageTaskIdentity>, refundId: string,
  dependencies: SketchImageCancellationReceiptDependencies = {}): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  let raw: PoolClient | undefined, began = false, committing = false, discard = false;
  const guard = (): void => { if (Date.now() >= deadline) invalid(); };
  try {
    if (!isOriginalSketchImageGenericRefundId(refundId)) invalid();
    const identity = structuredClone(identityValue), reserve = identity.pricing.totalReserveCredits;
    if (!Number.isSafeInteger(reserve) || reserve <= 0 || reserve > 2_147_483_647) invalid();
    const chargeId = createTaskBillingTransactionId('charge', identity.taskId);
    const readRow = (rows: readonly unknown[]): Record<string, unknown> => {
      if (rows.length !== 1) invalid();
      const fields = sketchFields(rows[0]), result = sketchFields(fields.result);
      if (!isDeepStrictEqual(readSketchImageTaskRowIdentity(rows[0] as SketchImageTaskRow, identity.actorUserId), identity)
        || fields.status !== 'cancelled' || fields.credit_status !== 'refunded'
        || fields.charged_transaction_id !== chargeId || fields.refunded_transaction_id !== refundId
        || fields.lease_owner !== '' || dbInteger(fields.lease_expires_at) !== 0
        || typeof fields.attempt_count !== 'number' || !Number.isSafeInteger(fields.attempt_count) || fields.attempt_count < 0
        || Object.hasOwn(result, 'sketchImageSettlement') || dbInteger(fields.now_ms) >= deadline) invalid();
      return structuredClone(result);
    };
    const connect = dependencies.connect ?? (() => getPool().connect());
    guard(); raw = await connect(); guard();
    const client = new Proxy(raw, { get(target, key) {
      if (key === 'query') return async (...args: unknown[]): Promise<unknown> => {
        guard(); const result: unknown = await Reflect.apply(target.query, target, args); guard(); return result;
      };
      const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
    } });
    began = true;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    const sql = 'SELECT *, (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS now_ms FROM cloud_tasks WHERE id=$1';
    const originalResult = readRow((await client.query(sql, [identity.taskId])).rows);
    // One coherent read-only snapshot includes all task/reference and exact-ID
    // rows, so an extra refund or foreign-ID row cannot disappear behind a filter.
    const transactions = (await client.query('SELECT id,user_id,type,amount,balance_after,model,task_id,reference_id FROM wujie_credit_transactions WHERE task_id=$1 OR reference_id=$1 OR id=ANY($2::text[]) ORDER BY id',
      [identity.taskId, [chargeId, refundId]])).rows as unknown[];
    if (transactions.length !== 2) invalid();
    const fields = transactions.map(row => {
      const tx = sketchFields(row, ['id', 'user_id', 'type', 'amount', 'balance_after', 'model', 'task_id', 'reference_id']);
      if (Object.keys(tx).length !== 8 || typeof tx.amount !== 'number' || !Number.isSafeInteger(tx.amount)
        || tx.amount < -2_147_483_648 || tx.amount > 2_147_483_647 || typeof tx.balance_after !== 'number'
        || !Number.isSafeInteger(tx.balance_after) || tx.balance_after < 0 || tx.balance_after > 2_147_483_647
        || tx.user_id !== identity.actorUserId || tx.task_id !== identity.taskId || tx.reference_id !== identity.taskId) invalid();
      return tx;
    });
    const charge = fields.find(tx => tx.id === chargeId), refund = fields.find(tx => tx.id === refundId);
    if (!charge || !refund || charge === refund || charge.type !== 'consume' || charge.amount !== -reserve
      || charge.model !== identity.input.imageModelId || refund.type !== 'refund' || refund.amount !== reserve
      || fields.filter(tx => tx.type === 'refund').length !== 1) invalid();
    if (!isDeepStrictEqual(readRow((await client.query(sql, [identity.taskId])).rows), originalResult)) invalid();
    guard(); committing = true; await client.query('COMMIT'); return true;
  } catch {
    if (committing) discard = true;
    else if (raw && began) try { await raw.query('ROLLBACK'); } catch { discard = true; }
    return false;
  } finally { raw?.release(discard); }
}
