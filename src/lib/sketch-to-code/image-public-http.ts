import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { after, type NextResponse } from 'next/server';
import { getCloudTaskById, type PersistedCloudTask } from '@/lib/cloud-task-storage';
import { abortTaskExecution, cancelTask, updateTaskProgress } from '@/lib/task-registry';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { readSketchImageResult } from './image-result';
import { cancelSketchImageTransaction } from './image-task-http';
import { confirmSketchImageCancellationReceipt, isOriginalSketchImageGenericRefundId } from './image-cancel-reconfirm';
import { readSketchImageTaskIdentity, type SketchImageTaskIdentity } from './image-task-state';
import { readSketchImageCheckpoint } from './image-execution';
import { parseSketchImageAnalysis } from './image-contract';
import { parseSketchImagePricing } from './image-pricing';
import { sketchFields, sketchHttpId, sketchJson, SketchHttpError } from './http';

export interface SketchImagePublicHttpDependencies {
  getTask?: typeof getCloudTaskById;
  readResult?: typeof readSketchImageResult;
  cancelTransaction?: typeof cancelSketchImageTransaction;
  confirmCancelledReceipt?: typeof confirmSketchImageCancellationReceipt;
  scheduleRecovery?: (candidate: PersistedCloudTask, requestId: string) => boolean;
  abortMemory?: typeof abortTaskExecution;
  cancelMemory?: typeof cancelTask;
  updateMemory?: typeof updateTaskProgress;
}
interface OriginalCandidate {
  readonly task: PersistedCloudTask;
  readonly fields: Record<string, unknown>;
  readonly identity: Readonly<SketchImageTaskIdentity>;
}
function originalCandidate(candidate: unknown, actorUserId: string): OriginalCandidate {
  try {
    const fields = sketchFields(candidate), task = candidate as PersistedCloudTask;
    const identity = readSketchImageTaskIdentity(task, sketchHttpId(actorUserId));
    if (typeof fields.progress !== 'number' || !Number.isFinite(fields.progress) || fields.progress < 0 || fields.progress > 100) throw new Error();
    return { task, fields, identity };
  } catch { throw new SketchHttpError(404, 'SKETCH_IMAGE_TASK_UNAVAILABLE'); }
}
function summary(original: OriginalCandidate): Record<string, unknown> {
  const { identity, fields } = original, input = identity.input;
  // Reparse the data-only quote; never spread admission, checkpoint or task data.
  return { taskId: identity.taskId, type: 'sketch-to-image', projectId: identity.projectId, status: fields.status, progress: fields.progress,
    visionProviderId: input.visionProviderId, visionModelId: input.visionModelId, imageProviderId: input.imageProviderId, imageModelId: input.imageModelId,
    pricing: parseSketchImagePricing(identity.pricing), reserveCredits: identity.pricing.totalReserveCredits };
}
/** Original private identity is data, not today's project/model permission. */
export function sketchImageTaskSummary(candidate: unknown, actorUserId: string): Record<string, unknown> {
  return summary(originalCandidate(candidate, actorUserId));
}
function strictBody(body: unknown, identity: Readonly<SketchImageTaskIdentity>, polling: boolean): void {
  const fields = sketchFields(body, polling ? ['taskId', 'projectId', 'providerId', 'imageProviderId', 'model'] : ['taskId', 'projectId']);
  if (sketchHttpId(fields.taskId) !== identity.taskId || sketchHttpId(fields.projectId) !== identity.projectId) throw new Error();
  for (const key of ['providerId', 'imageProviderId'] as const) {
    if (Object.hasOwn(fields, key) && sketchHttpId(fields[key]) !== identity.input.imageProviderId) throw new Error();
  }
  if (Object.hasOwn(fields, 'model')) {
    const model = sketchHttpId(fields.model);
    if (model !== identity.input.imageModelId && model !== `${identity.input.imageProviderId}::${identity.input.imageModelId}`) throw new Error();
  }
}
function rejection(status: number, code: string, requestId: string): NextResponse {
  return sketchJson({ success: false, code, retryable: false }, status, requestId);
}
/** A public URL shape filter only. Actual managed storage/bytes/access remain
 * the protected reader's responsibility; a URL prefix is never authorization. */
function managedUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/api/serve-upload/') || /[?#\\\p{Cc}]/u.test(value)) throw new Error();
  const decoded = decodeURIComponent(value.slice('/api/serve-upload/'.length));
  if (!/^[A-Za-z0-9._/-]+$/u.test(decoded) || decoded.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error();
  return value;
}
function completedProjection(value: unknown, identity: Readonly<SketchImageTaskIdentity>): Record<string, unknown> {
  const result = sketchFields(value), input = identity.input;
  if (result.taskId !== identity.taskId || result.projectId !== identity.projectId
    || result.visionProviderId !== input.visionProviderId || result.visionModelId !== input.visionModelId
    || result.imageProviderId !== input.imageProviderId || result.imageModelId !== input.imageModelId
    || result.reserveCredits !== identity.pricing.totalReserveCredits
    || !isDeepStrictEqual(parseSketchImagePricing(result.pricing), identity.pricing)
    || typeof result.actualCredits !== 'number' || !Number.isSafeInteger(result.actualCredits) || result.actualCredits < 0) throw new Error();
  const previewAssetId = sketchHttpId(result.previewAssetId), previewAssetVersionId = sketchHttpId(result.previewAssetVersionId);
  const imageAssetId = sketchHttpId(result.imageAssetId), imageAssetVersionId = sketchHttpId(result.imageAssetVersionId);
  if (previewAssetId === imageAssetId || previewAssetVersionId === imageAssetVersionId) throw new Error();
  return { previewAssetId, previewAssetVersionId, imageAssetId, imageAssetVersionId,
    previewUrl: managedUrl(result.previewUrl), imageUrl: managedUrl(result.imageUrl), analysis: parseSketchImageAnalysis(result.analysis), actualCredits: result.actualCredits };
}
function scheduleRecovery(candidate: PersistedCloudTask, requestId: string): boolean {
  try {
    after(async () => {
      try {
        const { recoverConfiguredSketchImageTask } = await import('./image-service');
        await recoverConfiguredSketchImageTask(candidate, requestId);
      } catch { /* Failed background recovery never permits POST/refund or leaks errors. */ }
    });
    return true;
  } catch { return false; }
}
function validRecoveryLease(fields: Record<string, unknown>): boolean {
  return typeof fields.leaseExpiresAt === 'number' && Number.isSafeInteger(fields.leaseExpiresAt) && fields.leaseExpiresAt >= 0
    && typeof fields.attemptCount === 'number' && Number.isSafeInteger(fields.attemptCount) && fields.attemptCount >= 1;
}
function originalActiveAttempt(fields: Record<string, unknown>, identity: Readonly<SketchImageTaskIdentity>, expired: boolean): boolean {
  // First execution alone may have no checkpoint yet. This permits read-only
  // observation, never success, a replacement worker, paid work or settlement.
  return validRecoveryLease(fields) && !expired && fields.attemptCount === 1
    && typeof fields.leaseOwner === 'string'
    && /^sketch-image:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(fields.leaseOwner)
    && fields.creditStatus === (identity.pricing.totalReserveCredits === 0 ? 'not-applicable' : 'pending')
    && (fields.refundedTransactionId === undefined || fields.refundedTransactionId === '');
}
export async function pollSketchImageTask(body: unknown, candidate: unknown, actorUserId: string, requestId: string,
  deps: SketchImagePublicHttpDependencies = {}): Promise<NextResponse> {
  let original: OriginalCandidate;
  try { original = originalCandidate(candidate, actorUserId); } catch { return rejection(404, 'SKETCH_IMAGE_TASK_UNAVAILABLE', requestId); }
  try { strictBody(body, original.identity, true); } catch { return rejection(400, 'SKETCH_INPUT_INVALID', requestId); }
  const projection = summary(original), { identity, fields } = original;
  if (fields.status === 'completed') {
    try {
      const result = await (deps.readResult ?? readSketchImageResult)({ actorUserId: identity.actorUserId, projectId: identity.projectId, taskId: identity.taskId });
      return sketchJson({ success: true, ...projection, ...completedProjection(result, identity) }, 200, requestId);
    } catch { return rejection(404, 'SKETCH_IMAGE_RESULT_UNAVAILABLE', requestId); }
  }
  if (fields.status === 'failed' || fields.status === 'cancelled' || fields.status === 'timeout') {
    const codes = { failed: 'SKETCH_IMAGE_EXECUTION_FAILED', cancelled: 'SKETCH_IMAGE_EXECUTION_CANCELLED', timeout: 'SKETCH_IMAGE_EXECUTION_TIMEOUT' } as const;
    return sketchJson({ success: true, ...projection, error: { code: codes[fields.status], retryable: false } }, 200, requestId);
  }
  let recoveryPending = false, needsReconcile = false;
  if (fields.status === 'processing') {
    // This clock gates scheduling only. The service/worker owns current permits,
    // original row/ledger locks and its post-lock database clock authority.
    const expired = validRecoveryLease(fields) && (fields.leaseExpiresAt as number) <= Date.now();
    needsReconcile = !validRecoveryLease(fields) || expired;
    try {
      const checkpoint = readSketchImageCheckpoint(sketchFields(fields.result).sketchImageExecution, identity);
      if (!checkpoint || checkpoint.phase !== 'accepted') needsReconcile = !originalActiveAttempt(fields, identity, expired);
      else if (expired) {
        needsReconcile = true;
        recoveryPending = (deps.scheduleRecovery ?? scheduleRecovery)(original.task, requestId) === true;
      }
    } catch { needsReconcile = true; }
  }
  return sketchJson({ success: true, ...projection, needsReconcile, recoveryPending }, 202, requestId);
}
function confirmedCancelled(original: OriginalCandidate): void {
  const { fields, identity } = original, result = sketchFields(fields.result), free = identity.pricing.totalReserveCredits === 0;
  if (fields.status !== 'cancelled' || Object.hasOwn(result, 'sketchImageSettlement')
    || fields.creditStatus !== (free ? 'not-applicable' : 'refunded')) throw new Error();
  const absent = (value: unknown): boolean => value === undefined || value === '';
  if (free ? !absent(fields.chargedTransactionId) || !absent(fields.refundedTransactionId)
    : fields.chargedTransactionId !== createTaskBillingTransactionId('charge', identity.taskId)
      || fields.refundedTransactionId !== createTaskBillingTransactionId('refund', identity.taskId)) throw new Error();
}
function reflectConfirmedCancellation(taskId: string, deps: SketchImagePublicHttpDependencies): void {
  // Durable confirmation is the only gate; memory is a best-effort projection.
  try { (deps.abortMemory ?? abortTaskExecution)(taskId); } catch { /* keep durable ACK */ }
  try { (deps.cancelMemory ?? cancelTask)(taskId); } catch { /* keep durable ACK */ }
  try { (deps.updateMemory ?? updateTaskProgress)(taskId, { status: 'cancelled', progress: 0 }); } catch { /* keep durable ACK */ }
}
function genericCancelledRefund(original: OriginalCandidate): string | undefined {
  const { fields, identity } = original;
  if (!isOriginalSketchImageGenericRefundId(fields.refundedTransactionId)) return undefined;
  if (identity.pricing.totalReserveCredits <= 0 || fields.status !== 'cancelled' || fields.creditStatus !== 'refunded'
    || fields.chargedTransactionId !== createTaskBillingTransactionId('charge', identity.taskId)
    || fields.leaseOwner !== undefined && fields.leaseOwner !== ''
    || fields.leaseExpiresAt !== undefined && fields.leaseExpiresAt !== 0
    || Object.hasOwn(sketchFields(fields.result), 'sketchImageSettlement')) throw new Error();
  // This classifies only the original storage ID; a ledger receipt is still required.
  return fields.refundedTransactionId;
}
export async function cancelSketchImageTask(body: unknown, candidate: unknown, actorUserId: string, requestId: string,
  deps: SketchImagePublicHttpDependencies = {}): Promise<NextResponse> {
  let original: OriginalCandidate;
  try { original = originalCandidate(candidate, actorUserId); } catch { return rejection(404, 'SKETCH_IMAGE_TASK_UNAVAILABLE', requestId); }
  try { strictBody(body, original.identity, false); } catch { return rejection(400, 'SKETCH_INPUT_INVALID', requestId); }
  const { identity, fields } = original, refunded = identity.pricing.totalReserveCredits > 0;
  if (fields.status !== 'processing' && fields.status !== 'cancelled') return rejection(409, 'SKETCH_IMAGE_TASK_NOT_ACTIVE', requestId);
  try {
    if (fields.status === 'cancelled') {
      const genericRefund = genericCancelledRefund(original);
      if (genericRefund === undefined) confirmedCancelled(original);
      const fresh = originalCandidate(await (deps.getTask ?? getCloudTaskById)(identity.taskId), actorUserId);
      if (!isDeepStrictEqual(fresh.identity, identity)) throw new Error();
      if (genericRefund === undefined) confirmedCancelled(fresh);
      else {
        if (genericCancelledRefund(fresh) !== genericRefund
          || await (deps.confirmCancelledReceipt ?? confirmSketchImageCancellationReceipt)(identity, genericRefund) !== true) throw new Error();
      }
    } else {
      const ack = sketchFields(await (deps.cancelTransaction ?? cancelSketchImageTransaction)(identity), ['cancelled', 'refunded']);
      if (Object.keys(ack).length !== 2 || ack.cancelled !== true || ack.refunded !== refunded) throw new Error();
    }
  } catch {
    // In particular: an unknown COMMIT is not a retry, read-back refund or memory ACK.
    return rejection(503, 'SKETCH_IMAGE_CANCELLATION_UNCONFIRMED', requestId);
  }
  reflectConfirmedCancellation(identity.taskId, deps);
  return sketchJson({ success: true, ...summary(original), status: 'cancelled', progress: 0, refunded }, 200, requestId);
}
