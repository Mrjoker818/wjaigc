import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { parseSketchImagePricing, quoteSketchImageSettlement, type SketchImagePricing, type SketchImageSettlement } from './image-pricing';

export interface SketchImageLedgerTaskRow {
  id: string; user_id: string; project_id: string; type: string; status: string; model: string; provider_id: string;
  credit_cost: unknown; charged_transaction_id: string | null; refunded_transaction_id: string | null;
  credit_status: string; result: Record<string, unknown>;
}
interface LedgerRow { id: string; user_id: string; type: string; amount: number; balance_after: number; model: string; task_id: string; reference_id: string }
export interface SketchImageLedger {
  readonly task: SketchImageLedgerTaskRow; readonly pricing: Readonly<SketchImagePricing>;
  readonly balance: number | null; readonly totalUsed: number | null; readonly chargeId: string | null;
  readonly transactions: readonly LedgerRow[];
}
export type SketchImageLedgerSettlement = Readonly<SketchImageSettlement & {
  chargedTransactionId: string | null; adjustmentTransactionId: string | null;
}>;

const PG_MAX = 2_147_483_647;
const TASK_FIELDS = ['id', 'user_id', 'project_id', 'type', 'status', 'model', 'provider_id', 'credit_cost',
  'charged_transaction_id', 'refunded_transaction_id', 'credit_status', 'result'] as const;
const TX_FIELDS = ['id', 'user_id', 'type', 'amount', 'balance_after', 'model', 'task_id', 'reference_id'] as const;
const SETTLEMENT_FIELDS = ['version', 'reserveCredits', 'visionCredits', 'imageCredits', 'actualCredits', 'deltaCredits',
  'usage', 'chargedTransactionId', 'adjustmentTransactionId'] as const;
// Snapshot provenance/single-use guard only, NOT permission or financial authority.
// A rollback requires a fresh lock snapshot from the caller's original transaction.
const locks = new WeakMap<SketchImageLedger, { client: PoolClient; readOnly: boolean; used: boolean }>();
function invalid(): never { throw new Error('SKETCH_IMAGE_EVIDENCE_INVALID'); }
function record(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)
      || fields && !fields.includes(key) || !property || !('value' in property) || !property.enumerable) invalid();
    copy[key] = property.value as unknown;
  }
  return copy;
}
/** Own data only: never run a getter/toJSON or freeze live caller objects. */
function snapshot(value: unknown, depth = 0, ancestors = new Set<object>(), budget = { nodes: 0 }): unknown {
  if (++budget.nodes > 100_000 || depth > 64) invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return value; }
  if (!value || typeof value !== 'object' || ancestors.has(value)) invalid();
  ancestors.add(value);
  let copy: unknown;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) invalid();
    const items: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const property = Object.getOwnPropertyDescriptor(value, String(i));
      if (!property || !('value' in property) || !property.enumerable) invalid();
      items.push(snapshot(property.value as unknown, depth + 1, ancestors, budget));
    }
    copy = Object.freeze(items);
  } else {
    const fields = record(value), output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(fields)) output[key] = snapshot(item, depth + 1, ancestors, budget);
    copy = Object.freeze(output);
  }
  ancestors.delete(value);
  return copy;
}
function integer(value: unknown, min = 0, max = PG_MAX): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 256 || /\p{Cc}/u.test(value)) invalid();
  return value;
}
/** Original SQL row absence only; nonempty IDs are validated, never rewritten. */
export function readSketchImageSqlBillingId(value: unknown): string | null {
  return value === null || value === '' ? null : id(value);
}
function adjustmentId(taskId: string, delta: number): string | null {
  return delta === 0 ? null : delta < 0 ? createTaskBillingTransactionId('refund', taskId)
    : `ctx_token_${createHash('sha256').update(`sketch-to-image-token-delta\0${taskId}`).digest('hex').slice(0, 32)}`;
}
function taskSnapshot(row: SketchImageLedgerTaskRow): SketchImageLedgerTaskRow {
  const fields = record(row), copy: Record<string, unknown> = {};
  for (const key of TASK_FIELDS) {
    if (!Object.hasOwn(fields, key)) invalid();
    copy[key] = snapshot(fields[key]);
  }
  copy.charged_transaction_id = readSketchImageSqlBillingId(copy.charged_transaction_id);
  copy.refunded_transaction_id = readSketchImageSqlBillingId(copy.refunded_transaction_id);
  return Object.freeze(copy) as unknown as SketchImageLedgerTaskRow;
}
function taskPricing(task: SketchImageLedgerTaskRow): Readonly<SketchImagePricing> {
  for (const key of ['id', 'user_id', 'project_id', 'model', 'provider_id'] as const) id(task[key]);
  if (task.type !== 'sketch-to-image' || !task.id.startsWith('skimg_')
    || !['processing', 'completed'].includes(task.status) || task.refunded_transaction_id !== null) invalid();
  const admission = record(task.result.sketchImageAdmission), input = record(admission.input);
  const pricing = parseSketchImagePricing(admission.pricing), reserve = pricing.totalReserveCredits;
  if (integer(task.credit_cost) !== reserve || input.projectId !== task.project_id
    || pricing.vision.providerId !== input.visionProviderId || pricing.vision.modelId !== input.visionModelId
    || pricing.image.providerId !== input.imageProviderId || pricing.image.modelId !== input.imageModelId
    || task.provider_id !== pricing.image.providerId || task.model !== pricing.image.modelId) invalid();
  if (reserve > 0) {
    if (task.charged_transaction_id !== createTaskBillingTransactionId('charge', task.id)
      || task.credit_status !== (task.status === 'processing' ? 'pending' : 'charged')) invalid();
  } else if (task.charged_transaction_id !== null || task.credit_status !== 'not-applicable') invalid();
  if (Object.hasOwn(task.result, 'sketchImageSettlement') !== (task.status === 'completed')) invalid();
  return pricing;
}
function transactionSnapshot(value: unknown): Readonly<LedgerRow> {
  const row = record(value, TX_FIELDS);
  if (Object.keys(row).length !== TX_FIELDS.length) invalid();
  for (const key of ['id', 'user_id', 'type', 'model', 'task_id', 'reference_id'] as const) id(row[key]);
  return Object.freeze({ ...row, amount: integer(row.amount, -PG_MAX - 1), balance_after: integer(row.balance_after) }) as unknown as LedgerRow;
}
function matches(tx: LedgerRow, task: SketchImageLedgerTaskRow, txId: string, amount: number, type: string): boolean {
  return tx.id === txId && tx.user_id === task.user_id && tx.type === type && tx.amount === amount
    && tx.model === task.model && tx.task_id === task.id && tx.reference_id === task.id;
}
function verifyTransactions(ledger: SketchImageLedger, settlement?: SketchImageLedgerSettlement): void {
  const reserve = ledger.pricing.totalReserveCredits;
  if (reserve === 0) { if (ledger.transactions.length !== 0 || ledger.chargeId !== null) invalid(); return; }
  const count = settlement?.adjustmentTransactionId ? 2 : 1;
  if (ledger.transactions.length !== count || new Set(ledger.transactions.map(tx => tx.id)).size !== count) invalid();
  const charge = ledger.transactions.find(tx => tx.id === ledger.chargeId);
  if (!charge || !ledger.chargeId || !matches(charge, ledger.task, ledger.chargeId, -reserve, 'consume')) invalid();
  if (settlement?.adjustmentTransactionId) {
    const adjustment = ledger.transactions.find(tx => tx.id === settlement.adjustmentTransactionId);
    if (!adjustment || !matches(adjustment, ledger.task, settlement.adjustmentTransactionId,
      -settlement.deltaCredits, settlement.deltaCredits < 0 ? 'refund' : 'consume')) invalid();
  }
}
function withIdentity(ledger: SketchImageLedger, quote: Readonly<SketchImageSettlement>): SketchImageLedgerSettlement {
  return Object.freeze({ ...quote, chargedTransactionId: ledger.chargeId,
    adjustmentTransactionId: adjustmentId(ledger.task.id, quote.deltaCredits) });
}
function verifyProjection(ledger: SketchImageLedger, projection: unknown): SketchImageLedgerSettlement {
  const raw = record(projection, SETTLEMENT_FIELDS);
  const quote = withIdentity(ledger, quoteSketchImageSettlement(ledger.pricing, raw.usage));
  if (!isDeepStrictEqual(raw, quote)) invalid();
  return quote;
}
/** Caller owns the original task, current permission, lease/DB-clock and asset locks.
 * This only locks original finance rows; no BEGIN/COMMIT, account init or authority.
 * AFTER ALL locks caller MUST recheck original DB clock/lease/deadline/permission/abort. */
export async function lockSketchImageLedger(client: PoolClient, row: SketchImageLedgerTaskRow, readOnly = false): Promise<SketchImageLedger> {
  const task = taskSnapshot(row), pricing = taskPricing(task), lock = readOnly ? 'SHARE' : 'UPDATE';
  const credits = (await client.query<{ balance: unknown; total_used: unknown }>(
    `SELECT balance,total_used FROM wujie_credits WHERE user_id=$1 FOR ${lock}`, [task.user_id])).rows;
  if (credits.length > 1 || pricing.totalReserveCredits > 0 && credits.length !== 1) invalid();
  const credit = credits.length ? record(credits[0], ['balance', 'total_used']) : null;
  const balance = credit ? integer(credit.balance) : null, totalUsed = credit ? integer(credit.total_used) : null;
  const rows = (await client.query<LedgerRow>(`SELECT id,user_id,type,amount,balance_after,model,task_id,reference_id
    FROM wujie_credit_transactions WHERE task_id=$1 OR reference_id=$1 OR id=ANY($2::text[]) ORDER BY id FOR ${lock}`,
    [task.id, [createTaskBillingTransactionId('charge', task.id), adjustmentId(task.id, 1), adjustmentId(task.id, -1)]])).rows;
  const ledger: SketchImageLedger = Object.freeze({ task, pricing, balance, totalUsed,
    chargeId: task.charged_transaction_id, transactions: Object.freeze(rows.map(transactionSnapshot)) });
  const settlement = task.status === 'completed' ? verifyProjection(ledger, task.result.sketchImageSettlement) : undefined;
  verifyTransactions(ledger, settlement);
  locks.set(ledger, { client, readOnly, used: false });
  return ledger;
}
/** Same caller-owned transaction only. Caller MUST recheck original DB clock/lease,
 * current permission/deadline/abort after all locks and before calling this helper.
 * Caller owns rollback on ANY error, and completion/publication only after success. */
export async function settleSketchImageCredits(client: PoolClient, ledger: SketchImageLedger, usage?: unknown): Promise<SketchImageLedgerSettlement> {
  const held = locks.get(ledger);
  if (!held || held.client !== client || held.readOnly || held.used || ledger.task.status !== 'processing'
    || Object.hasOwn(ledger.task.result, 'sketchImageSettlement')) invalid();
  verifyTransactions(ledger);
  // One approved quote, one actual vision counter pair, one flat image. No two-LLM aggregate.
  const settlement = withIdentity(ledger, quoteSketchImageSettlement(ledger.pricing, usage));
  const delta = settlement.deltaCredits;
  let balance = ledger.balance, totalUsed = ledger.totalUsed;
  if (delta !== 0) {
    if (balance === null || totalUsed === null) invalid();
    balance -= delta; totalUsed += delta;
    if (balance < 0) throw new Error('SKETCH_IMAGE_INSUFFICIENT_CREDITS');
    if (!Number.isSafeInteger(balance) || balance > PG_MAX || !Number.isSafeInteger(totalUsed) || totalUsed < 0 || totalUsed > PG_MAX) {
      throw new Error('SKETCH_IMAGE_INTEGER_OVERFLOW');
    }
  }
  held.used = true;
  if (delta !== 0) {
    const updated = await client.query<{ balance: unknown; total_used: unknown }>(`UPDATE wujie_credits
      SET balance=$1,total_used=$2,updated_at=(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint WHERE user_id=$3 RETURNING balance,total_used`,
      [balance, totalUsed, ledger.task.user_id]);
    if (updated.rows.length !== 1) invalid();
    const result = record(updated.rows[0], ['balance', 'total_used']);
    if (result.balance !== balance || result.total_used !== totalUsed) invalid();
    const inserted = await client.query(`INSERT INTO wujie_credit_transactions(id,user_id,type,amount,balance_after,description,model,task_id,reference_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint)`,
      [settlement.adjustmentTransactionId, ledger.task.user_id, delta < 0 ? 'refund' : 'consume', -delta, balance,
        '草图生图：单次视觉Token结算', ledger.task.model, ledger.task.id]);
    if (inserted.rowCount !== 1) invalid();
  }
  return settlement;
}
/** Verification only; never grants publication, refund or reclamation authority.
 * Caller supplies the original task/input-asset/output-asset projections under its locks. */
export function verifySketchImageSettlement(ledger: SketchImageLedger, projections: readonly unknown[]): SketchImageLedgerSettlement {
  if (ledger.task.status !== 'completed' || ledger.task.credit_status !== (ledger.pricing.totalReserveCredits ? 'charged' : 'not-applicable')
    || projections.length !== 3) invalid();
  const expected = verifyProjection(ledger, ledger.task.result.sketchImageSettlement);
  for (const projection of projections) if (!isDeepStrictEqual(verifyProjection(ledger, projection), expected)) invalid();
  verifyTransactions(ledger, expected);
  return expected;
}
