import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { assertSketchProjectFence, type SketchTaskAdmission } from './admission';
import type { SketchCodeDraft, SketchCodeInput, SketchCodePreparation } from './generation';
import { type PersistedCloudTask, type CloudTaskLease, getCloudTaskById, claimCloudTaskLease,
  updateCloudTask, terminateCloudTaskAndRefund, type SketchTaskSettlementFence } from '@/lib/cloud-task-storage';
import { createTaskAbortScope, type TaskAbortScope } from '@/lib/task-core/task-abort';
import { SketchProviderError } from './provider';
import { createSketchRuntimeObserver } from './runtime-observation';
import { SketchTokenPublicationRejectedError, lockSketchTokenLedger, type SketchTokenTaskRow } from './token-billing';

export interface SketchExecutionContext { actorUserId: string; projectId: string; signal?: AbortSignal }
export interface SketchRecoveryIdentity {
  actorUserId: string; projectId: string; providerId: string; modelId: string; requestDigest: string;
  idempotencyKey: string;
  access: SketchCodePreparation['access'];
}
export interface SketchPublicationInput {
  readonly task: Readonly<PersistedCloudTask>; readonly access: SketchCodePreparation['access'];
  readonly input: Readonly<SketchCodeInput>; readonly draft: Readonly<SketchCodeDraft>;
  readonly lease: Readonly<CloudTaskLease>; readonly signal: AbortSignal;
}
/** Trusted server seam, NOT permission from the prepared authorization snapshot.
 * The publisher must lock the original task and current project authorization in
 * one transaction, fence owner/attempt/expiry/digest, create both AssetVersions,
 * and complete the original task. Check signal immediately before COMMIT.
 * false means no publication; rejection/abort may mean an unknown COMMIT.
 */
export interface SketchExecutionDependencies {
  getCloudTaskById?: typeof getCloudTaskById;
  claimCloudTaskLease?: typeof claimCloudTaskLease;
  updateCloudTask?: typeof updateCloudTask;
  terminateCloudTaskAndRefund?: typeof terminateCloudTaskAndRefund;
  publisher?: (input: SketchPublicationInput) => Promise<boolean>;
  /** Trusted caller-owned rejection settlement connection; never a public input. */
  connect?: () => Promise<PoolClient>;
}
export interface SketchExecutionOutcome {
  status: 'completed' | 'skipped' | 'deferred' | 'failed' | 'cancelled' | 'timeout'; reason?: string;
  providerError?: { code: string; phase: string; requestId: string; providerId: string; modelId: string; message: string; providerCode?: string; providerStatus?: number };
}

const LEASE_MS = 180_000;
const EXECUTION_MS = 150_000;
const COMPUTE_MS = 120_000;
const CHECK_MS = 1_000;
const ACTIVE = ['pending', 'processing'] as const;

class ExecutionStop extends Error {
  constructor(readonly code: string) { super(code); }
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(item => freeze(item)); Object.freeze(value);
  }
  return value;
}
function snapshot<T>(value: T): T { return freeze(structuredClone(value)); }
function deferred(reason: string): SketchExecutionOutcome { return { status: 'deferred', reason }; }
function skipped(reason: string): SketchExecutionOutcome { return { status: 'skipped', reason }; }
function sameAccess(value: unknown, expected: SketchCodePreparation['access']): boolean {
  if (!value || typeof value !== 'object') return false;
  const access = value as Record<string, unknown>;
  const fields = expected.kind === 'document' ? ['kind', 'actorUserId', 'projectId', 'ownerId', 'grantGeneration'] : ['kind', 'actorUserId', 'projectId', 'ownerId'];
  if (!['personal', 'document'].includes(expected.kind) || Object.keys(access).length !== fields.length) return false;
  return fields.every(key => access[key] === (expected as unknown as Record<string, unknown>)[key]);
}
function matches(task: PersistedCloudTask | null, id: string, identity: SketchRecoveryIdentity, nonce?: string): task is PersistedCloudTask {
  if (!task || task.id !== id || task.type !== 'sketch-to-code' || task.userId !== identity.actorUserId
    || task.projectId !== identity.projectId || task.providerId !== identity.providerId || task.model !== identity.modelId
    || !/^[a-f0-9]{64}$/.test(identity.requestDigest) || task.requestDigest !== identity.requestDigest
    || identity.access.actorUserId !== identity.actorUserId || identity.access.projectId !== identity.projectId
    || !identity.idempotencyKey || task.idempotencyKey !== (nonce ?? identity.idempotencyKey)) return false;
  const meta = task.result?.sketchAdmission as Record<string, unknown> | undefined;
  return !!meta && meta.version === 1 && meta.route === '/api/sketch-to-code'
    && meta.requestDigest === identity.requestDigest && sameAccess(meta.access, identity.access);
}
function live(task: PersistedCloudTask): boolean { return ACTIVE.some(status => status === task.status); }
function owns(task: PersistedCloudTask, lease: CloudTaskLease): boolean {
  return live(task) && task.leaseOwner === lease.owner && task.attemptCount === lease.attemptCount
    && task.leaseExpiresAt === lease.expiresAt && lease.expiresAt > Date.now();
}
function settlementFence(identity: SketchRecoveryIdentity, lease: CloudTaskLease): SketchTaskSettlementFence {
  return snapshot({ ...identity, leaseOwner: lease.owner, attemptCount: lease.attemptCount,
    leaseExpiresAt: lease.expiresAt, settleBefore: Date.now() + CHECK_MS });
}
function ports(dependencies: SketchExecutionDependencies): Required<Omit<SketchExecutionDependencies, 'publisher'>> {
  return { getCloudTaskById: dependencies.getCloudTaskById || getCloudTaskById,
    claimCloudTaskLease: dependencies.claimCloudTaskLease || claimCloudTaskLease,
    updateCloudTask: dependencies.updateCloudTask || updateCloudTask,
    terminateCloudTaskAndRefund: dependencies.terminateCloudTaskAndRefund || terminateCloudTaskAndRefund,
    connect: dependencies.connect || (() => getPool().connect()) };
}

interface TokenFailureRow extends SketchTokenTaskRow {
  type: string; project_id: string; request_digest: string; idempotency_key: string;
  lease_owner: string; attempt_count: number; lease_expires_at: string | number;
}
function matchesTokenFailure(row: TokenFailureRow | undefined, taskId: string, identity: SketchRecoveryIdentity): row is TokenFailureRow {
  const meta = row?.result?.sketchAdmission as Record<string, unknown> | undefined;
  return !!row && row.id === taskId && row.type === 'sketch-to-code' && row.user_id === identity.actorUserId
    && row.project_id === identity.projectId && row.provider_id === identity.providerId && row.model === identity.modelId
    && row.request_digest === identity.requestDigest && row.idempotency_key === identity.idempotencyKey
    && meta?.version === 1 && meta.route === '/api/sketch-to-code' && meta.requestDigest === identity.requestDigest
    && sameAccess(meta.access, identity.access) && !Object.hasOwn(row.result, 'sketchTokenSettlement');
}
/** Only a genuine, identity-bound, acknowledged publication rollback reaches here.
 * The original permission helper sets 5s/10s driver limits. We deliberately await
 * every query's REAL terminal result, never race/release a busy client. A late
 * result trips the fixed 1s deadline before any next query (except ROLLBACK).
 */
async function settleTokenRejection(taskId: string, identity: SketchRecoveryIdentity, lease: Readonly<CloudTaskLease>,
  error: SketchTokenPublicationRejectedError, signal: AbortSignal,
  storage: ReturnType<typeof ports>): Promise<SketchExecutionOutcome> {
  const fence = settlementFence(identity, lease), deadline = Math.min(fence.settleBefore, lease.expiresAt);
  let raw: PoolClient | undefined; let began = false; let committing = false; let discard = false;
  const guard = (): void => {
    if (signal.aborted || Date.now() >= deadline) throw new ExecutionStop('SKETCH_TASK_UNAVAILABLE');
  };
  try {
    guard(); raw = await storage.connect(); guard();
    // All original helpers receive this exact serialized, deadline-guarded client.
    // Cleanup uses raw only AFTER the active query has reached its terminal result.
    const client = new Proxy(raw, { get(target, key) {
      if (key === 'query') return async (sql: string, values?: unknown[]): Promise<unknown> => {
        guard(); const result = await target.query(sql, values); guard(); return result;
      };
      const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
    } });
    // Mark before awaiting BEGIN so unknown/late BEGIN is cleaned up or discarded.
    began = true; await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='1s'");
    const row = (await client.query<TokenFailureRow>('SELECT * FROM cloud_tasks WHERE id=$1 FOR UPDATE', [taskId])).rows[0];
    if (!matchesTokenFailure(row, taskId, identity) || row.status !== 'processing' || row.credit_status !== 'pending'
      || row.refunded_transaction_id || row.lease_owner !== lease.owner || row.attempt_count !== lease.attemptCount
      || Number(row.lease_expires_at) !== lease.expiresAt) throw new ExecutionStop('SKETCH_LEASE_LOST');
    await assertSketchProjectFence(client, identity.access);
    await client.query("SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='1s'");
    const ledger = await lockSketchTokenLedger(client, row);
    if (!ledger || ledger.transactions.length !== 1) throw new ExecutionStop('SKETCH_TOKEN_EVIDENCE_INVALID');
    // DB clock is sampled AFTER task/current permission/credits/ledger locks.
    const dbFence = async (settled: boolean): Promise<void> => {
      const current = (await client.query<TokenFailureRow & { now: string }>(
        'SELECT *, (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS now FROM cloud_tasks WHERE id=$1', [taskId])).rows[0];
      if (!matchesTokenFailure(current, taskId, identity) || !Number.isSafeInteger(Number(current.now))
        || Number(current.now) >= deadline || Number(current.now) >= lease.expiresAt
        || current.charged_transaction_id !== ledger.chargeId || Number(current.credit_cost) !== ledger.pricing.totalCredits
        || current.attempt_count !== lease.attemptCount
        || (settled ? current.status !== 'failed' || current.credit_status !== 'refunded' || !current.refunded_transaction_id
          || current.lease_owner !== '' || Number(current.lease_expires_at) !== 0
          : current.status !== 'processing' || current.credit_status !== 'pending' || !!current.refunded_transaction_id
            || current.lease_owner !== lease.owner || Number(current.lease_expires_at) !== lease.expiresAt)) {
        throw new ExecutionStop('SKETCH_LEASE_LOST');
      }
    };
    await dbFence(false);
    const settled = await storage.terminateCloudTaskAndRefund(taskId, 'failed', error.reason, lease.owner,
      { requireActive: true, expectedSketchExecution: fence, client });
    guard();
    if (!settled.transitioned || settled.status !== 'failed' || !settled.refunded || settled.creditCost !== ledger.pricing.totalCredits) {
      throw new ExecutionStop('SKETCH_SETTLEMENT_UNCONFIRMED');
    }
    await dbFence(true); guard();
    committing = true; await client.query('COMMIT');
    return { status: 'failed', reason: error.reason };
  } catch {
    // A COMMIT send (including true commit/ack loss) is never refund permission.
    if (committing) discard = true;
    else if (raw && began) try { await raw.query('ROLLBACK'); } catch { discard = true; }
    return deferred('SKETCH_TASK_UNAVAILABLE');
  } finally { raw?.release(discard); }
}
/** Own race/listener cleanup even if an external operation never settles. */
function bounded<T>(operation: () => Promise<T>, signal?: AbortSignal, timeoutMs?: number,
  timeoutCode = 'SKETCH_TASK_UNAVAILABLE'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined; let done = false;
    const cleanup = (): void => { if (timer !== undefined) clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const finish = (value: T | undefined, error?: unknown): void => {
      if (done) return; done = true; cleanup();
      if (error !== undefined) reject(error); else resolve(value as T);
    };
    const abort = (): void => finish(undefined, new ExecutionStop('SKETCH_EXECUTION_ABORTED'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    if (timeoutMs !== undefined) timer = setTimeout(() => finish(undefined, new ExecutionStop(timeoutCode)), timeoutMs);
    Promise.resolve().then(() => {
      if (done) throw new ExecutionStop('SKETCH_EXECUTION_ABORTED'); return operation();
    }).then(value => finish(value), error => finish(undefined, error ?? new ExecutionStop('SKETCH_EXECUTION_FAILED')));
  });
}
function errorCode(value: unknown): string | undefined {
  return value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' ? value.code : undefined;
}
function failure(error: unknown, identity: SketchRecoveryIdentity, signal: AbortSignal): SketchExecutionOutcome {
  if (signal.aborted) {
    const timeout = errorCode(signal.reason) === 'TASK_TIMEOUT' || errorCode(signal.reason) === 'SKETCH_EXECUTION_TIMEOUT';
    return { status: timeout ? 'timeout' : 'cancelled', reason: timeout ? 'SKETCH_EXECUTION_TIMEOUT' : 'SKETCH_EXECUTION_CANCELLED' };
  }
  if (error instanceof ExecutionStop && error.code === 'SKETCH_EXECUTION_TIMEOUT'
    || error instanceof Error && error.message === 'SKETCH_MODEL_TIMEOUT') return { status: 'timeout', reason: 'SKETCH_EXECUTION_TIMEOUT' };
  if (error instanceof SketchProviderError && error.providerId === identity.providerId && error.modelId === identity.modelId) {
    const providerError = { code: error.code, phase: error.phase, requestId: error.requestId,
      message: error.message.slice(0, 8192), ...(error.providerCode !== undefined ? { providerCode: error.providerCode.slice(0, 128) } : {}),
      providerId: identity.providerId, modelId: identity.modelId, ...(error.providerStatus !== undefined ? { providerStatus: error.providerStatus } : {}) };
    return { status: 'failed', reason: JSON.stringify(providerError), providerError };
  }
  if (error instanceof SketchTokenPublicationRejectedError) return { status: 'failed', reason: error.reason };
  return { status: 'failed', reason: 'SKETCH_EXECUTION_FAILED' };
}

export async function executeSketchTask(admission: SketchTaskAdmission, context: SketchExecutionContext,
  dependencies: SketchExecutionDependencies): Promise<SketchExecutionOutcome> {
  // Detach caller-owned mutable task/metadata BEFORE the first await.
  const accepted = snapshot(admission.task);
  const ctx = { actorUserId: context.actorUserId, projectId: context.projectId, signal: context.signal };
  const publisher = dependencies.publisher;
  if (admission.reused) return skipped('SKETCH_REUSED');
  if (typeof publisher !== 'function') return deferred('SKETCH_PUBLISHER_REQUIRED');
  const prepared = admission.prepared;
  if (!prepared || typeof prepared.compute !== 'function') return deferred('SKETCH_PREPARATION_REQUIRED');
  const input = snapshot(prepared.input); const access = snapshot(prepared.access); const binding = snapshot(prepared.binding);
  const compute = prepared.compute.bind(prepared); const storage = ports(dependencies);
  const requestDigest = createHash('sha256').update(JSON.stringify({ version: 1, type: 'sketch-to-code', projectId: input.projectId,
    imageDataUrl: input.imageDataUrl, instruction: input.instruction, providerId: binding.providerId, modelId: binding.modelId })).digest('hex');
  const identity = freeze({ actorUserId: ctx.actorUserId, projectId: ctx.projectId, providerId: binding.providerId, modelId: binding.modelId,
    requestDigest, idempotencyKey: input.idempotencyKey, access });
  const acceptedMeta = accepted.result?.sketchAdmission as Record<string, unknown> | undefined;
  if (!ctx.actorUserId || !ctx.projectId || accepted.type !== 'sketch-to-code' || accepted.userId !== ctx.actorUserId
    || accepted.projectId !== ctx.projectId || input.projectId !== ctx.projectId || input.providerId !== binding.providerId
    || input.modelId !== binding.modelId || accepted.providerId !== binding.providerId || accepted.model !== binding.modelId
    || accepted.idempotencyKey !== input.idempotencyKey || acceptedMeta?.requestDigest !== requestDigest
    || acceptedMeta.version !== 1 || acceptedMeta.route !== '/api/sketch-to-code'
    || access.actorUserId !== ctx.actorUserId || access.projectId !== ctx.projectId || !sameAccess(acceptedMeta.access, access)) return skipped('SKETCH_IDENTITY_MISMATCH');

  const observe = createSketchRuntimeObserver({ taskId: accepted.id, providerId: binding.providerId, modelId: binding.modelId });
  const globalDeadline = new AbortController();
  const globalTimer = setTimeout(() => globalDeadline.abort({ code: 'SKETCH_EXECUTION_TIMEOUT' }), EXECUTION_MS);
  let scope: TaskAbortScope | undefined; let monitorTimer: ReturnType<typeof setTimeout> | undefined;
  let monitorStopped = false; let unsafeReason: string | undefined; let publishing = false;
  let reading: Promise<PersistedCloudTask | null> | undefined;
  let lease: Readonly<CloudTaskLease> | undefined;
  const read = (signal?: AbortSignal): Promise<PersistedCloudTask | null> => {
    if (!reading) {
      // The driver has no abort port. Only its real completion may release the
      // guard; a cancelled/timed-out consumer must never start another query.
      const operation = Promise.resolve().then(async () => {
        const task = await storage.getCloudTaskById(accepted.id); return task ? snapshot(task) : null;
      });
      reading = operation;
      void operation.finally(() => { if (reading === operation) reading = undefined; }).catch(() => undefined);
    }
    const operation = reading;
    return bounded(() => operation, signal, CHECK_MS);
  };
  const stopMonitor = (): void => { monitorStopped = true; if (monitorTimer !== undefined) clearTimeout(monitorTimer); };
  const stopUnsafe = (reason: string): void => {
    unsafeReason = reason; stopMonitor(); scope?.controller.abort(new ExecutionStop(reason));
  };
  const check = async (): Promise<void> => {
    const started = Date.now();
    try {
      const current = await read(scope?.signal);
      if (monitorStopped) return;
      if (!matches(current, accepted.id, identity, input.idempotencyKey)) { stopUnsafe('SKETCH_IDENTITY_MISMATCH'); return; }
      if (!lease || !owns(current, lease)) { stopUnsafe('SKETCH_LEASE_LOST'); return; }
    } catch { if (!monitorStopped && !scope?.signal.aborted) stopUnsafe('SKETCH_TASK_UNAVAILABLE'); }
    if (!monitorStopped && !scope?.signal.aborted) monitorTimer = setTimeout(() => { void check(); }, Math.max(0, CHECK_MS - (Date.now() - started)));
  };
  const settleFailure = async (error: unknown): Promise<SketchExecutionOutcome> => {
    stopMonitor();
    if (unsafeReason) return deferred(unsafeReason);
    if (!scope || !lease) return deferred('SKETCH_TASK_UNAVAILABLE');
    if (errorCode(scope.signal.reason) === 'TASK_EXECUTION_REPLACED') return deferred('SKETCH_EXECUTION_REPLACED');
    if (error instanceof ExecutionStop && error.code === 'SKETCH_TASK_UNAVAILABLE') return deferred(error.code);
    const outcome = failure(error, identity, scope.signal);
    if (!scope.signal.aborted) scope.controller.abort({ code: outcome.reason });
    try {
      // Never settle from cached state, nor after an unknown read/lease result.
      const current = await read();
      if (!matches(current, accepted.id, identity, input.idempotencyKey) || !owns(current, lease)) return deferred('SKETCH_LEASE_LOST');
      const owner = lease.owner;
      const expectedSketchExecution = settlementFence(identity, lease);
      const settled = await bounded(() => storage.terminateCloudTaskAndRefund(accepted.id,
        outcome.status as 'failed' | 'cancelled' | 'timeout', outcome.reason!, owner,
        { requireActive: true, expectedSketchExecution }), undefined, CHECK_MS);
      return settled.transitioned && settled.status === outcome.status ? outcome : deferred('SKETCH_SETTLEMENT_UNCONFIRMED');
    } catch { return deferred('SKETCH_TASK_UNAVAILABLE'); }
  };
  try {
    const initial = await read(globalDeadline.signal);
    if (!matches(initial, accepted.id, identity, input.idempotencyKey) || !live(initial)) return skipped('SKETCH_TASK_NOT_EXECUTABLE');
    if ((initial.leaseExpiresAt || 0) >= Date.now() && initial.leaseExpiresAt !== 0) return skipped('SKETCH_LEASE_ACTIVE');
    if ((initial.attemptCount || 0) !== 0) return deferred('SKETCH_EXECUTION_ALREADY_ATTEMPTED');
    const owner = `sketch-execution:${randomUUID()}`;
    const claimed = await bounded(() => storage.claimCloudTaskLease(accepted.id, owner, LEASE_MS), globalDeadline.signal, CHECK_MS);
    if (!claimed) return skipped('SKETCH_LEASE_ACTIVE');
    lease = snapshot(claimed);
    if (lease.taskId !== accepted.id || lease.owner !== owner || lease.attemptCount !== 1
      || lease.expiresAt <= Date.now()) return deferred('SKETCH_EXECUTION_ALREADY_ATTEMPTED');
    const claimedTask = await read(globalDeadline.signal);
    if (!matches(claimedTask, accepted.id, identity, input.idempotencyKey) || !owns(claimedTask, lease)) return deferred('SKETCH_LEASE_LOST');
    scope = createTaskAbortScope(accepted.id, { signals: [globalDeadline.signal, ...(ctx.signal ? [ctx.signal] : [])] });
    const scopeSignal = scope.signal;
    let draft: Readonly<SketchCodeDraft>;
    try {
      if (!scopeSignal.aborted) {
        const updated = await bounded(() => storage.updateCloudTask(accepted.id, { progress: 1, label: '草图转代码：执行中',
          expectedStatuses: [...ACTIVE], expectedRevision: claimedTask.revision, leaseOwner: owner }), scopeSignal, CHECK_MS);
        if (!updated) return deferred('SKETCH_LEASE_LOST');
        monitorTimer = setTimeout(() => { void check(); }, CHECK_MS);
      }
      draft = snapshot(await bounded(() => compute(scopeSignal, async phase => {
        scopeSignal.throwIfAborted();
        observe({ event: 'phase-state-start', phase });
        try {
          const current = await read(scopeSignal);
          if (!matches(current, accepted.id, identity, input.idempotencyKey) || !owns(current, lease!)) {
            stopUnsafe('SKETCH_LEASE_LOST'); throw new ExecutionStop('SKETCH_LEASE_LOST');
          }
          const updated = await bounded(() => storage.updateCloudTask(accepted.id, {
            progress: phase === 'analysis' ? 10 : 55,
            label: phase === 'analysis' ? '草图转代码：分析中' : '草图转代码：重建中',
            expectedStatuses: [...ACTIVE], expectedRevision: current.revision, leaseOwner: owner,
          }), scopeSignal, CHECK_MS);
          if (!updated) { stopUnsafe('SKETCH_LEASE_LOST'); throw new ExecutionStop('SKETCH_LEASE_LOST'); }
          observe({ event: 'phase-state-confirmed', phase });
        } catch (error) {
          observe({ event: 'phase-state-unconfirmed', phase, aborted: scopeSignal.aborted });
          if (!scopeSignal.aborted) stopUnsafe('SKETCH_TASK_UNAVAILABLE');
          throw error;
        }
        scopeSignal.throwIfAborted();
      }), scopeSignal, COMPUTE_MS, 'SKETCH_EXECUTION_TIMEOUT'));
    } catch (error) {
      return await settleFailure(error);
    }
    if (unsafeReason) return deferred(unsafeReason);
    if (scopeSignal.aborted) return await settleFailure(new ExecutionStop('SKETCH_EXECUTION_ABORTED'));
    const publishTask = await read(scopeSignal);
    if (!matches(publishTask, accepted.id, identity, input.idempotencyKey) || !owns(publishTask, lease)) return deferred('SKETCH_LEASE_LOST');
    const publicationLease = lease;
    publishing = true;
    observe({ event: 'publication-start', phase: 'publication' });
    // Task data is already deeply frozen; AbortSignal is a live capability.
    const committed = await bounded(() => publisher(Object.freeze({ task: publishTask, access, input, draft, lease: publicationLease, signal: scopeSignal })), scopeSignal);
    observe({ event: 'publication-return', phase: 'publication', confirmed: committed === true });
    stopMonitor();
    if (!committed || unsafeReason || scopeSignal.aborted) return deferred(unsafeReason || 'SKETCH_PUBLICATION_UNCONFIRMED');
    const completed = await read(globalDeadline.signal);
    if (!matches(completed, accepted.id, identity, input.idempotencyKey) || completed.status !== 'completed'
      || typeof completed.result?.previewAssetId !== 'string' || !completed.result.previewAssetId
      || typeof completed.result?.htmlAssetId !== 'string' || !completed.result.htmlAssetId) return deferred('SKETCH_PUBLICATION_UNCONFIRMED');
    return { status: 'completed' };
  } catch (error) {
    if (publishing && error instanceof SketchTokenPublicationRejectedError && lease && error.taskId === accepted.id
      && error.requestDigest === identity.requestDigest && error.leaseOwner === lease.owner
      && error.attemptCount === lease.attemptCount && error.leaseExpiresAt === lease.expiresAt) {
      stopMonitor();
      if (unsafeReason || !scope || scope.signal.aborted) return deferred(unsafeReason || 'SKETCH_PUBLICATION_UNCONFIRMED');
      return await settleTokenRejection(accepted.id, identity, lease, error, scope.signal, storage);
    }
    // Includes claim/update/settlement COMMIT ambiguity and publisher response loss.
    if (!publishing && scope?.signal.aborted && !unsafeReason) return await settleFailure(error);
    return deferred(publishing ? 'SKETCH_PUBLICATION_UNCONFIRMED' : unsafeReason || 'SKETCH_TASK_UNAVAILABLE');
  } finally {
    stopMonitor(); clearTimeout(globalTimer);
    if (scope && !scope.signal.aborted) scope.controller.abort(new ExecutionStop('SKETCH_EXECUTION_FINISHED'));
    scope?.dispose();
  }
}

/** Identity-filtered reclamation only. Never reconstruct a compute/HTTP closure. */
export async function recoverExpiredSketchTask(taskId: string, expected: SketchRecoveryIdentity,
  dependencies: SketchExecutionDependencies = {}): Promise<SketchExecutionOutcome> {
  const identity = snapshot(expected); const storage = ports(dependencies);
  try {
    const initialValue = await bounded(() => storage.getCloudTaskById(taskId), undefined, CHECK_MS);
    const initial = initialValue ? snapshot(initialValue) : null;
    if (!matches(initial, taskId, identity) || !live(initial) || !Number.isFinite(initial.createdAt)
      || Date.now() - initial.createdAt <= LEASE_MS || (initial.leaseExpiresAt || 0) >= Date.now() && initial.leaseExpiresAt !== 0) return skipped('SKETCH_RECOVERY_NOT_ELIGIBLE');
    const owner = `sketch-recovery:${randomUUID()}`;
    const claimed = await bounded(() => storage.claimCloudTaskLease(taskId, owner, LEASE_MS), undefined, CHECK_MS);
    if (!claimed) return skipped('SKETCH_LEASE_ACTIVE');
    const lease = snapshot(claimed);
    const value = await bounded(() => storage.getCloudTaskById(taskId), undefined, CHECK_MS);
    const current = value ? snapshot(value) : null;
    if (lease.taskId !== taskId || lease.owner !== owner || !matches(current, taskId, identity) || !owns(current, lease)
      || current.createdAt !== initial.createdAt || Date.now() - current.createdAt <= LEASE_MS) return deferred('SKETCH_LEASE_LOST');
    const expectedSketchExecution = settlementFence(identity, lease);
    const settled = await bounded(() => storage.terminateCloudTaskAndRefund(taskId, 'timeout', 'SKETCH_EXECUTION_TIMEOUT', owner,
      { requireActive: true, expectedSketchExecution }), undefined, CHECK_MS);
    return settled.transitioned && settled.status === 'timeout' ? { status: 'timeout', reason: 'SKETCH_EXECUTION_TIMEOUT' } : deferred('SKETCH_SETTLEMENT_UNCONFIRMED');
  } catch { return deferred('SKETCH_TASK_UNAVAILABLE'); }
}
