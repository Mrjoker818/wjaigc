import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { parseCreditPricingConfigStrict, type CreditPricingConfig, type TokenCreditPricing } from '@/lib/credit-pricing';
import { calculateTokenCredits, createTaskBillingTransactionId } from '@/lib/credits';
import { validateSketchCodeUsage, type SketchCodeUsage } from './usage';

export interface SketchFlatPricing { readonly calls: 2; readonly perCallCredits: number; readonly totalCredits: number }
export interface SketchTokenPricing extends SketchFlatPricing { readonly mode: 'token'; readonly tokenPricing: Readonly<TokenCreditPricing> }
export type SketchAdmissionPricing = SketchFlatPricing | SketchTokenPricing;
export interface SketchTokenSettlement {
  readonly version: 1; readonly reserveCredits: number; readonly actualCredits: number; readonly deltaCredits: number;
  readonly chargedTransactionId: string; readonly adjustmentTransactionId: string | null; readonly usage: Readonly<SketchCodeUsage>;
}
export type SketchTokenRejectionReason = 'SKETCH_TOKEN_USAGE_INVALID' | 'SKETCH_TOKEN_INSUFFICIENT_CREDITS' | 'SKETCH_TOKEN_INTEGER_OVERFLOW';
const REASONS: readonly SketchTokenRejectionReason[] = ['SKETCH_TOKEN_USAGE_INVALID', 'SKETCH_TOKEN_INSUFFICIENT_CREDITS', 'SKETCH_TOKEN_INTEGER_OVERFLOW'];
/** Internal candidate only. This error never itself authorizes a refund. */
export class SketchTokenBillingRejectedError extends Error {
  constructor(readonly reason: SketchTokenRejectionReason) { super(reason); this.name = 'SketchTokenBillingRejectedError'; }
}
/** Only the publisher constructs this after the original transaction ACKs ROLLBACK. */
export class SketchTokenPublicationRejectedError extends Error {
  readonly taskId: string; readonly requestDigest: string; readonly leaseOwner: string;
  readonly attemptCount: number; readonly leaseExpiresAt: number; readonly reason: SketchTokenRejectionReason;
  constructor(identity: { taskId: string; requestDigest: string; leaseOwner: string; attemptCount: number; leaseExpiresAt: number }, reason: SketchTokenRejectionReason) {
    super(reason); this.name = 'SketchTokenPublicationRejectedError';
    if (!REASONS.includes(reason) || !identity.taskId || !identity.leaseOwner || !/^[a-f0-9]{64}$/.test(identity.requestDigest)
      || !Number.isSafeInteger(identity.attemptCount) || identity.attemptCount < 1 || !Number.isSafeInteger(identity.leaseExpiresAt)) invalid();
    this.taskId = identity.taskId; this.requestDigest = identity.requestDigest; this.leaseOwner = identity.leaseOwner;
    this.attemptCount = identity.attemptCount; this.leaseExpiresAt = identity.leaseExpiresAt; this.reason = reason;
    Object.freeze(this);
  }
}
function invalid(): never { throw new Error('SKETCH_TOKEN_EVIDENCE_INVALID'); }
function data(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length > 10_000) invalid();
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)
      || fields && !fields.includes(key) || !descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    copy[key] = descriptor.value as unknown;
  }
  return copy;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function rates(value: unknown): Readonly<TokenCreditPricing> {
  const r = data(value, ['input', 'output']);
  return Object.freeze({ input: integer(r.input, 1, 10_000_000), output: integer(r.output, 1, 10_000_000) });
}
/** Check original descriptors and numeric types BEFORE the shared normalizer. */
export function copySketchPricingConfig(value: unknown): CreditPricingConfig {
  const config = data(typeof value === 'string' ? JSON.parse(value) as unknown : value, ['modelCredits', 'updatedAt']);
  const entries = data(config.modelCredits), copied: CreditPricingConfig['modelCredits'] = Object.create(null) as CreditPricingConfig['modelCredits'];
  for (const [key, value] of Object.entries(entries)) {
    if (!key.trim() || key !== key.trim()) invalid();
    if (typeof value === 'number') { copied[key] = integer(value, 0, 100_000); continue; }
    const e = data(value, ['credits', 'quality', 'resolution', 'tokenPricing']);
    const entry: { credits: number; quality?: Record<string, number>; resolution?: Record<string, number>; tokenPricing?: TokenCreditPricing } = { credits: integer(e.credits, 0, 100_000) };
    for (const field of ['quality', 'resolution'] as const) {
      if (Object.hasOwn(e, field)) {
        const tiers: Record<string, number> = Object.create(null) as Record<string, number>;
        for (const [tier, count] of Object.entries(data(e[field]))) { if (!tier.trim() || tier !== tier.trim()) invalid(); tiers[tier] = integer(count, 0, 100_000); }
        entry[field] = Object.freeze(tiers);
      }
    }
    if (Object.hasOwn(e, 'tokenPricing')) entry.tokenPricing = rates(e.tokenPricing);
    copied[key] = Object.freeze(entry);
  }
  if (Object.hasOwn(config, 'updatedAt') && config.updatedAt !== undefined) integer(config.updatedAt, 0, Number.MAX_SAFE_INTEGER);
  const parsed = parseCreditPricingConfigStrict({ modelCredits: copied, ...(config.updatedAt !== undefined ? { updatedAt: config.updatedAt } : {}) });
  for (const value of Object.values(parsed.modelCredits)) if (typeof value === 'object') {
    if (value.tokenPricing) Object.freeze(value.tokenPricing);
    if (value.quality) Object.freeze(value.quality); if (value.resolution) Object.freeze(value.resolution); Object.freeze(value);
  }
  Object.freeze(parsed.modelCredits); return Object.freeze(parsed);
}
export function parseSketchAdmissionPricing(value: unknown): Readonly<SketchAdmissionPricing> {
  const p = data(value, ['mode', 'calls', 'perCallCredits', 'totalCredits', 'tokenPricing']);
  const perCallCredits = integer(p.perCallCredits, 0, 100_000);
  if (p.calls !== 2) invalid();
  if (Object.hasOwn(p, 'mode')) {
    if (p.mode !== 'token' || Object.keys(p).length !== 5 || p.totalCredits !== Math.max(1, 2 * perCallCredits)) invalid();
    return Object.freeze({ mode: 'token', calls: 2, perCallCredits, totalCredits: integer(p.totalCredits, 1, 200_000), tokenPricing: rates(p.tokenPricing) });
  }
  if (Object.keys(p).length !== 3 || p.totalCredits !== 2 * perCallCredits) invalid();
  return Object.freeze({ calls: 2, perCallCredits, totalCredits: integer(p.totalCredits, 0, 200_000) });
}
function adjustmentId(taskId: string, delta: number): string | null {
  return delta === 0 ? null : delta < 0 ? createTaskBillingTransactionId('refund', taskId)
    : `ctx_token_${createHash('sha256').update(`sketch-to-code-token-delta\0${taskId}`).digest('hex').slice(0, 32)}`;
}
export function quoteSketchTokenSettlement(taskId: string, pricingValue: unknown, usageValue: unknown, chargedTransactionId: string): Readonly<SketchTokenSettlement> {
  const pricing = parseSketchAdmissionPricing(pricingValue);
  if (!('mode' in pricing) || !taskId || !chargedTransactionId) invalid();
  let usage: Readonly<SketchCodeUsage>;
  try { usage = validateSketchCodeUsage(usageValue); if (!usage.analysis || !usage.reconstruction || !usage.total) invalid(); }
  catch { throw new SketchTokenBillingRejectedError('SKETCH_TOKEN_USAGE_INVALID'); }
  // Strict bounds keep products and sum below JS safe integer limits. Exactly
  // one call to the original calculator, including zero's single minimum1.
  const actualCredits = calculateTokenCredits(usage.total!, pricing.tokenPricing);
  if (!Number.isSafeInteger(actualCredits) || actualCredits < 1 || actualCredits > 400_000_000) throw new SketchTokenBillingRejectedError('SKETCH_TOKEN_INTEGER_OVERFLOW');
  const deltaCredits = actualCredits - pricing.totalCredits;
  return Object.freeze({ version: 1, reserveCredits: pricing.totalCredits, actualCredits, deltaCredits,
    chargedTransactionId, adjustmentTransactionId: adjustmentId(taskId, deltaCredits), usage });
}
export interface SketchTokenTaskRow {
  id: string; user_id: string; model: string; provider_id: string; credit_cost: unknown; charged_transaction_id: string | null;
  credit_status: string; refunded_transaction_id: string | null; status: string; result: Record<string, unknown>;
}
interface LedgerRow { id: string; user_id: string; type: string; amount: number; balance_after: number; model: string; task_id: string; reference_id: string }
export interface SketchTokenLedger {
  readonly task: SketchTokenTaskRow; readonly pricing: Readonly<SketchTokenPricing>; readonly balance: number; readonly totalUsed: number;
  readonly chargeId: string; readonly transactions: readonly LedgerRow[];
}
const PG_MAX = 2_147_483_647;
function dbInteger(value: unknown): number {
  const n: unknown = typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value;
  return integer(n, 0, PG_MAX);
}
function matchesLedger(tx: LedgerRow, task: SketchTokenTaskRow, id: string, amount: number, type: 'consume' | 'refund'): boolean {
  return tx.id === id && tx.user_id === task.user_id && tx.type === type && tx.amount === amount && tx.model === task.model
    && tx.task_id === task.id && tx.reference_id === task.id && Number.isInteger(tx.balance_after) && tx.balance_after >= 0 && tx.balance_after <= PG_MAX;
}
/** Caller already owns task, current permission and version locks. No BEGIN/COMMIT here. */
export async function lockSketchTokenLedger(client: PoolClient, task: SketchTokenTaskRow, readOnly = false): Promise<SketchTokenLedger | null> {
  const admission = data(task.result.sketchAdmission);
  const pricing = parseSketchAdmissionPricing(admission.pricing);
  if (!('mode' in pricing)) { if (Object.hasOwn(task.result, 'sketchTokenSettlement')) invalid(); return null; }
  if (dbInteger(task.credit_cost) !== pricing.totalCredits || !task.charged_transaction_id
    || task.charged_transaction_id !== createTaskBillingTransactionId('charge', task.id)
    || task.refunded_transaction_id || !['pending', 'charged'].includes(task.credit_status)) invalid();
  const lock = readOnly ? 'SHARE' : 'UPDATE';
  const credit = (await client.query<{ balance: number; total_used: number }>(
    `SELECT balance,total_used FROM wujie_credits WHERE user_id=$1 FOR ${lock}`, [task.user_id])).rows[0];
  if (!credit) invalid();
  const transactions = (await client.query<LedgerRow>(`SELECT id,user_id,type,amount,balance_after,model,task_id,reference_id
    FROM wujie_credit_transactions WHERE task_id=$1 OR reference_id=$1 OR id=ANY($2::text[]) ORDER BY id FOR ${lock}`,
    [task.id, [task.charged_transaction_id, adjustmentId(task.id, 1), adjustmentId(task.id, -1)]])).rows;
  const charge = transactions.find(tx => tx.id === task.charged_transaction_id);
  if (!charge || !matchesLedger(charge, task, task.charged_transaction_id, -pricing.totalCredits, 'consume')) invalid();
  return { task, pricing, balance: dbInteger(credit.balance), totalUsed: dbInteger(credit.total_used), chargeId: charge.id, transactions };
}
/** Caller must recheck original DB clock/lease/deadline/abort AFTER all ledger locks. */
export async function settleSketchTokenCredits(client: PoolClient, ledger: SketchTokenLedger, usage: unknown): Promise<Readonly<SketchTokenSettlement>> {
  if (ledger.task.status !== 'processing' || ledger.task.credit_status !== 'pending' || ledger.transactions.length !== 1
    || Object.hasOwn(ledger.task.result, 'sketchTokenSettlement')) invalid();
  const settlement = quoteSketchTokenSettlement(ledger.task.id, ledger.pricing, usage, ledger.chargeId);
  const delta = settlement.deltaCredits, balance = ledger.balance - delta, totalUsed = ledger.totalUsed + delta;
  if (balance < 0) throw new SketchTokenBillingRejectedError('SKETCH_TOKEN_INSUFFICIENT_CREDITS');
  if (!Number.isSafeInteger(balance) || balance > PG_MAX || !Number.isSafeInteger(totalUsed) || totalUsed < 0 || totalUsed > PG_MAX) {
    throw new SketchTokenBillingRejectedError('SKETCH_TOKEN_INTEGER_OVERFLOW');
  }
  if (delta !== 0) {
    const updated = await client.query<{ balance: number; total_used: number }>(`UPDATE wujie_credits
      SET balance=$1,total_used=$2,updated_at=(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint WHERE user_id=$3 RETURNING balance,total_used`,
      [balance, totalUsed, ledger.task.user_id]);
    if (updated.rows.length !== 1 || updated.rows[0].balance !== balance || updated.rows[0].total_used !== totalUsed) invalid();
    await client.query(`INSERT INTO wujie_credit_transactions(id,user_id,type,amount,balance_after,description,model,task_id,reference_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint)`,
      [settlement.adjustmentTransactionId, ledger.task.user_id, delta < 0 ? 'refund' : 'consume', -delta, balance,
        '草图转代码：Token结算', ledger.task.model, ledger.task.id]);
  }
  return settlement;
}
/** Recompute from the frozen admission and strict true usage, then verify original ledger references. */
export function verifySketchTokenSettlement(ledger: SketchTokenLedger, projections: readonly unknown[]): Readonly<SketchTokenSettlement> {
  if (ledger.task.status !== 'completed' || ledger.task.credit_status !== 'charged' || projections.length !== 3) invalid();
  let expected: Readonly<SketchTokenSettlement> | undefined;
  for (const projection of projections) {
    const raw = data(projection, ['version', 'reserveCredits', 'actualCredits', 'deltaCredits', 'chargedTransactionId', 'adjustmentTransactionId', 'usage']);
    if (Object.keys(raw).length !== 7 || raw.version !== 1) invalid();
    const quote = quoteSketchTokenSettlement(ledger.task.id, ledger.pricing, raw.usage, ledger.chargeId);
    if (!isDeepStrictEqual({ ...raw }, quote) || expected && !isDeepStrictEqual(expected, quote)) invalid();
    expected = quote;
  }
  if (!expected || ledger.transactions.length !== (expected.deltaCredits === 0 ? 1 : 2)) invalid();
  if (expected.adjustmentTransactionId) {
    const tx = ledger.transactions.find(t => t.id === expected!.adjustmentTransactionId);
    if (!tx || !matchesLedger(tx, ledger.task, expected.adjustmentTransactionId, -expected.deltaCredits, expected.deltaCredits < 0 ? 'refund' : 'consume')) invalid();
  }
  return expected;
}
