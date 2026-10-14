import 'server-only';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SketchImageTaskAdmission } from './image-admission';
import { readSketchImageTaskIdentity, type SketchImageTaskIdentity } from './image-task-state';
import { persistSketchImageCheckpoint, readSketchImageCheckpoint, type SketchImageCheckpointDependencies, type SketchImageCheckpointInput, type SketchImageCheckpoint, type SketchImageRouting } from './image-execution';
import { getCloudTaskById, claimCloudTaskLease, type PersistedCloudTask, type CloudTaskLease } from '@/lib/cloud-task-storage';
import type { OrdinaryQueryResult } from '@/lib/task-core/ordinary-generation-provider';
import { createTaskAbortScope, type TaskAbortScope } from '@/lib/task-core/task-abort';
import { parseStoredSketchImageReceipt, type SketchImagePreparation } from './image-generation';
import { runSketchStage } from './stage';
import { settleSketchImageKnownFailure, type SketchImageFailureInput } from './image-failure';
import { readSketchImageKnownFailure } from './image-known-failure';
export interface SketchImagePublicationValue {
  readonly identity: Readonly<SketchImageTaskIdentity>; readonly lease: Readonly<CloudTaskLease>;
  readonly checkpoint: Readonly<SketchImageCheckpoint>; readonly imageUrl: string; readonly signal: AbortSignal;
}
export interface SketchImageWorkerDependencies extends SketchImageCheckpointDependencies {
  readonly routing: Readonly<SketchImageRouting>;
  getTask?: (taskId: string) => Promise<PersistedCloudTask | null>;
  claimLease?: (taskId: string, owner: string, ttl: number) => Promise<CloudTaskLease | null>;
  checkpoint?: (value: SketchImageCheckpointInput) => Promise<void>;
  query?: (remoteId: string, identity: Readonly<SketchImageTaskIdentity>, signal: AbortSignal) => Promise<Readonly<OrdinaryQueryResult>>;
  publisher?: (value: SketchImagePublicationValue) => Promise<boolean>;
  failure?: (value: SketchImageFailureInput) => Promise<boolean>;
}
export interface SketchImageWorkerContext { actorUserId: string; projectId: string; signal?: AbortSignal }
export interface SketchImageWorkerOutcome { status: 'completed' | 'failed' | 'skipped' | 'deferred'; reason?: string }
const LEASE_MS = 660_000, EXECUTION_MS = 600_000, CHECK_MS = 5_000;
function snapshot<T>(value: T): T {
  const copy: T = structuredClone(value);
  const freeze = (item: unknown): void => { if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(copy); return copy;
}
function outcome(status: SketchImageWorkerOutcome['status'], reason?: string): SketchImageWorkerOutcome {
  return { status, ...(reason ? { reason } : {}) };
}
function validateRouting(value: Readonly<SketchImageRouting>): Readonly<SketchImageRouting> {
  if (!value || Object.keys(value).sort().join(',') !== 'image,vision' || !/^[a-f0-9]{64}$/.test(value.image)
    || !/^[a-f0-9]{64}$/.test(value.vision)) throw new Error(); return snapshot(value);
}
function same(task: PersistedCloudTask | null, identity: Readonly<SketchImageTaskIdentity>): task is PersistedCloudTask {
  try { return !!task && isDeepStrictEqual(readSketchImageTaskIdentity(task, identity.actorUserId), identity); } catch { return false; }
}
function owns(task: PersistedCloudTask | null, identity: Readonly<SketchImageTaskIdentity>, lease: Readonly<CloudTaskLease>): task is PersistedCloudTask {
  return same(task, identity) && task.status === 'processing' && task.creditStatus === (identity.pricing.totalReserveCredits ? 'pending' : 'not-applicable')
    && !task.refundedTransactionId && lease.taskId === identity.taskId && task.leaseOwner === lease.owner
    && task.attemptCount === lease.attemptCount && task.leaseExpiresAt === lease.expiresAt && lease.expiresAt > Date.now();
}
function idle(task: PersistedCloudTask): boolean { return (task.leaseExpiresAt || 0) < Date.now() || task.leaseExpiresAt === 0; }
function delay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (): void => { signal.removeEventListener('abort', abort); clearTimeout(timer); };
    const abort = (): void => { done(); reject(signal.reason); };
    const timer = setTimeout(() => { done(); resolve(); }, 2_000);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
/** One original lease. The only recovery path consumes a durable accepted receipt;
 * it never restores a paid compute closure or refunds an ambiguous operation. */
async function run(identityValue: Readonly<SketchImageTaskIdentity>, dependencies: SketchImageWorkerDependencies,
  prepared?: SketchImagePreparation, suppliedSignal?: AbortSignal): Promise<SketchImageWorkerOutcome> {
  const publisher = dependencies.publisher, query = dependencies.query, currentModels = dependencies.checkCurrent;
  const compute = prepared?.compute.bind(prepared);
  const failureDependencies = { connect: dependencies.connect, assertProjectFence: dependencies.assertProjectFence };
  const failure = dependencies.failure || ((value: SketchImageFailureInput): Promise<boolean> => settleSketchImageKnownFailure(value, failureDependencies));
  let identity: Readonly<SketchImageTaskIdentity>, routing: Readonly<SketchImageRouting>;
  try { identity = snapshot(identityValue); routing = validateRouting(dependencies.routing); }
  catch { return outcome('deferred', 'SKETCH_IMAGE_DEPENDENCIES_REQUIRED'); }
  if (typeof publisher !== 'function' || typeof currentModels !== 'function' || typeof query !== 'function') return outcome('deferred', 'SKETCH_IMAGE_DEPENDENCIES_REQUIRED');
  const getTask = dependencies.getTask || getCloudTaskById, claim = dependencies.claimLease || claimCloudTaskLease;
  const persist = dependencies.checkpoint || ((value: SketchImageCheckpointInput): Promise<void> => persistSketchImageCheckpoint(value, dependencies));
  const controller = new AbortController(), signal = suppliedSignal ? AbortSignal.any([suppliedSignal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error('SKETCH_IMAGE_EXECUTION_TIMEOUT')), EXECUTION_MS);
  let scope: TaskAbortScope | undefined, reading: Promise<PersistedCloudTask | null> | undefined;
  let monitor: ReturnType<typeof setTimeout> | undefined, stopped = false, publishing = false;
  let executionLease: Readonly<CloudTaskLease> | undefined;
  const read = (actual = scope?.signal || signal): Promise<PersistedCloudTask | null> => {
    if (!reading) {
      const operation = Promise.resolve().then(async () => { const task = await getTask(identity.taskId); return task ? snapshot(task) : null; });
      reading = operation;
      void operation.finally(() => { if (reading === operation) reading = undefined; }).catch(() => undefined);
    }
    // A timed-out consumer does NOT clear the original busy-driver guard.
    const pending = reading; return runSketchStage(() => pending, actual, CHECK_MS);
  };
  try {
    signal.throwIfAborted(); const initial = await read();
    if (!same(initial, identity) || initial.status !== 'processing') return outcome('skipped', 'SKETCH_IMAGE_TASK_NOT_EXECUTABLE');
    if (!idle(initial)) return outcome('skipped', 'SKETCH_IMAGE_LEASE_ACTIVE');
    let saved = readSketchImageCheckpoint(initial.result?.sketchImageExecution, identity);
    if (prepared) {
      if ((initial.attemptCount || 0) !== 0 || saved) return outcome('deferred', 'SKETCH_IMAGE_ALREADY_ATTEMPTED');
    } else if (saved?.phase !== 'accepted') return outcome('deferred', 'SKETCH_IMAGE_RECEIPT_UNCONFIRMED');
    if (saved && !isDeepStrictEqual(saved.routing, routing)) return outcome('deferred', 'SKETCH_IMAGE_ROUTING_CHANGED');
    if (saved?.receipt?.taskIds.length && typeof query !== 'function') return outcome('deferred', 'SKETCH_IMAGE_QUERY_REQUIRED');
    const owner = `sketch-image:${randomUUID()}`;
    const claimed = await runSketchStage(() => claim(identity.taskId, owner, LEASE_MS), signal, CHECK_MS);
    if (!claimed) return outcome('skipped', 'SKETCH_IMAGE_LEASE_ACTIVE');
    const lease = snapshot(claimed);
    if (lease.taskId !== identity.taskId || lease.owner !== owner || !Number.isSafeInteger(lease.attemptCount)
      || lease.attemptCount !== (initial.attemptCount || 0) + 1 || !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt <= Date.now()) throw new Error();
    const claimedTask = await read(); if (!owns(claimedTask, identity, lease)) throw new Error();
    if (!isDeepStrictEqual(readSketchImageCheckpoint(claimedTask.result?.sketchImageExecution, identity), saved)) throw new Error();
    executionLease = lease;
    scope = createTaskAbortScope(identity.taskId, { signals: [signal] }); const taskSignal = scope.signal;
    const assertCurrent = async (): Promise<PersistedCloudTask> => {
      taskSignal.throwIfAborted(); const task = await read(taskSignal); if (!owns(task, identity, lease)) throw new Error('SKETCH_IMAGE_LEASE_LOST'); return task;
    };
    const check = async (): Promise<void> => {
      try {
        if (!stopped) {
          taskSignal.throwIfAborted(); const task = await read(taskSignal);
          // Completion is publisher-owned. Seeing its completed row never grants
          // success, but must not abort an ACK still being returned by that publisher.
          if (!(publishing && same(task, identity) && task.status === 'completed') && !owns(task, identity, lease)) throw new Error();
        }
      }
      catch { if (!stopped) { stopped = true; scope?.controller.abort(new Error('SKETCH_IMAGE_TASK_UNAVAILABLE')); } }
      if (!stopped) monitor = setTimeout(() => { void check(); }, 1_000);
    };
    monitor = setTimeout(() => { void check(); }, 1_000);
    if (prepared) {
      const draft = await compute!(taskSignal, {
        beforePhase: async phase => { await assertCurrent(); await persist({ identity, lease, routing, phase, signal: taskSignal }); taskSignal.throwIfAborted(); },
        afterAnalysis: async response => { await assertCurrent(); await persist({ identity, lease, routing, phase: 'analysis-complete', response, signal: taskSignal }); taskSignal.throwIfAborted(); },
      });
      taskSignal.throwIfAborted(); await assertCurrent();
      // Only the consumer is bounded here. The original transaction retains its
      // busy client and must reach real terminal cleanup with this aborted signal.
      await runSketchStage(actual => persist({ identity, lease, routing, phase: 'accepted', draft, signal: actual }), taskSignal, 10_000);
      taskSignal.throwIfAborted();
      const current = await assertCurrent(); saved = readSketchImageCheckpoint(current.result?.sketchImageExecution, identity);
      if (saved?.phase !== 'accepted' || !isDeepStrictEqual(saved.receipt, draft.receipt)
        || !isDeepStrictEqual(saved.analysis, draft.analysis) || !isDeepStrictEqual(saved.usage, draft.usage)) throw new Error();
    }
    if (!saved?.receipt || saved.phase !== 'accepted') throw new Error();
    const receipt = saved.receipt; let imageUrl: string;
    if (receipt.directImageUrls.length === 1) imageUrl = receipt.directImageUrls[0];
    else {
      if (typeof query !== 'function') throw new Error('SKETCH_IMAGE_QUERY_REQUIRED');
      for (;;) {
        await assertCurrent();
        const route = validateRouting(await runSketchStage(actual => currentModels(identity, actual), taskSignal, CHECK_MS));
        if (!isDeepStrictEqual(route, saved.routing)) throw new Error('SKETCH_IMAGE_ROUTING_CHANGED');
        const result = await runSketchStage(actual => query(receipt.taskIds[0], identity, actual), taskSignal, 30_000); taskSignal.throwIfAborted();
        if (result.status === 'completed') {
          const validated = parseStoredSketchImageReceipt({ taskIds: [], directImageUrls: result.imageUrls,
            usedModel: identity.input.imageModelId, usedProviderId: identity.input.imageProviderId },
          { providerId: identity.input.imageProviderId, modelId: identity.input.imageModelId }); imageUrl = validated.directImageUrls[0]; break;
        }
        if (result.status !== 'pending') throw new Error('SKETCH_IMAGE_PROVIDER_RESULT_UNCONFIRMED');
        await delay(taskSignal);
      }
    }
    const publicationRouting = validateRouting(await runSketchStage(actual => currentModels(identity, actual), taskSignal, CHECK_MS));
    if (!isDeepStrictEqual(publicationRouting, saved.routing)) throw new Error('SKETCH_IMAGE_ROUTING_CHANGED');
    await assertCurrent(); taskSignal.throwIfAborted();
    publishing = true;
    const publicationCheckpoint = saved;
    const acknowledged = await runSketchStage(actual => publisher(Object.freeze({ identity, lease,
      checkpoint: publicationCheckpoint, imageUrl, signal: actual })), taskSignal, 30_000);
    stopped = true; if (monitor !== undefined) clearTimeout(monitor);
    if (!acknowledged || taskSignal.aborted) return outcome('deferred', 'SKETCH_IMAGE_PUBLICATION_UNCONFIRMED');
    const completed = await read(taskSignal);
    if (!same(completed, identity) || completed.status !== 'completed'
      || completed.creditStatus !== (identity.pricing.totalReserveCredits ? 'charged' : 'not-applicable')
      || !['previewAssetId', 'previewAssetVersionId', 'imageAssetId', 'imageAssetVersionId'].every(key => typeof completed.result?.[key] === 'string' && !!completed.result[key])
      || !isDeepStrictEqual(readSketchImageCheckpoint(completed.result?.sketchImageExecution, identity), saved)) throw new Error();
    return outcome('completed');
  } catch (error) {
    const actual = scope?.signal || signal;
    // A private provider proof is only eligibility. The original handler still
    // owns task/phase/permission/lease/finance authority and actual COMMIT ACK.
    if (executionLease && !publishing && !actual.aborted && readSketchImageKnownFailure(error)) {
      stopped = true; if (monitor !== undefined) clearTimeout(monitor);
      try {
        const lease = executionLease;
        const acknowledged = await runSketchStage(current => failure({ identity, lease, routing, error, signal: current }), actual, 10_000);
        if (acknowledged && !actual.aborted) {
          const failed = await read(actual);
          if (same(failed, identity) && failed.status === 'failed'
            && failed.creditStatus === (identity.pricing.totalReserveCredits ? 'refunded' : 'not-applicable')
            && (identity.pricing.totalReserveCredits ? typeof failed.refundedTransactionId === 'string' && !!failed.refundedTransactionId : !failed.refundedTransactionId)
            && !failed.leaseOwner && !failed.leaseExpiresAt && failed.attemptCount === lease.attemptCount) return outcome('failed');
        }
      } catch { /* Unknown terminal/COMMIT ACK stays deferred; never retry refund. */ }
    }
    return outcome('deferred', 'SKETCH_IMAGE_EXECUTION_UNCONFIRMED');
  }
  finally {
    stopped = true; if (monitor !== undefined) clearTimeout(monitor); clearTimeout(timer);
    if (scope && !scope.signal.aborted) scope.controller.abort(new Error('SKETCH_IMAGE_EXECUTION_FINISHED')); scope?.dispose();
    if (!controller.signal.aborted) controller.abort(new Error('SKETCH_IMAGE_EXECUTION_FINISHED'));
  }
}
export async function executeSketchImageTask(admission: SketchImageTaskAdmission, context: SketchImageWorkerContext,
  dependencies: SketchImageWorkerDependencies): Promise<SketchImageWorkerOutcome> {
  if (admission.reused) return outcome('skipped', 'SKETCH_IMAGE_REUSED');
  const prepared = admission.prepared;
  if (!prepared || typeof prepared.compute !== 'function') return outcome('deferred', 'SKETCH_IMAGE_PREPARATION_REQUIRED');
  let identity: Readonly<SketchImageTaskIdentity>;
  try {
    identity = readSketchImageTaskIdentity(snapshot(admission.task) as PersistedCloudTask, context.actorUserId);
    if (identity.projectId !== context.projectId || !isDeepStrictEqual(snapshot(prepared.input), identity.input)
      || !isDeepStrictEqual(snapshot(prepared.access), identity.access)
      || !isDeepStrictEqual(snapshot(prepared.visionBinding), { providerId: identity.input.visionProviderId, modelId: identity.input.visionModelId })
      || !isDeepStrictEqual(snapshot(prepared.imageBinding), { providerId: identity.input.imageProviderId, modelId: identity.input.imageModelId })) throw new Error();
  } catch { return outcome('skipped', 'SKETCH_IMAGE_IDENTITY_MISMATCH'); }
  return run(identity, dependencies, prepared, context.signal);
}
export async function recoverSketchImageTask(taskId: string, identity: Readonly<SketchImageTaskIdentity>,
  dependencies: SketchImageWorkerDependencies): Promise<SketchImageWorkerOutcome> {
  if (taskId !== identity.taskId) return outcome('skipped', 'SKETCH_IMAGE_IDENTITY_MISMATCH'); return run(identity, dependencies);
}
