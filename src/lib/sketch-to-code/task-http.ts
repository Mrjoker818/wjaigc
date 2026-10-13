import { isDeepStrictEqual } from 'node:util';
import { getCloudTaskById, terminateCloudTaskAndRefund } from '@/lib/cloud-task-storage';
import { abortTaskExecution, cancelTask, updateTaskProgress } from '@/lib/task-registry';
import type { SketchRecoveryIdentity } from './execution';
import type { readSketchDocument } from './document';
import { parseSketchAdmissionPricing, type SketchAdmissionPricing } from './token-billing';
import { sketchFields, sketchHttpId, SketchHttpError, sketchJson, sketchError } from './http';
import type { NextResponse } from 'next/server';

interface SketchTask {
  id: string; userId: string; projectId: string; providerId: string; model: string; requestDigest: string; idempotencyKey: string;
  status: string; progress: number; creditStatus: string; error?: string; label?: string;
}
export interface SketchHttpIdentity { task: Readonly<SketchTask>; recovery: Readonly<SketchRecoveryIdentity>; pricing: Readonly<SketchAdmissionPricing> }
/** Full original admission before any cache/provider/recovery branch. Prefix is never authority. */
export function sketchTaskIdentity(value: unknown, actorUserId: string): SketchHttpIdentity {
  try {
    const t = sketchFields(value); const id = sketchHttpId(t.id), projectId = sketchHttpId(t.projectId);
    const providerId = sketchHttpId(t.providerId), modelId = sketchHttpId(t.model), nonce = sketchHttpId(t.idempotencyKey);
    if (t.type !== 'sketch-to-code' || t.userId !== actorUserId || typeof t.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(t.requestDigest)) throw new Error();
    const result = sketchFields(t.result), meta = sketchFields(result.sketchAdmission, ['version', 'route', 'requestDigest', 'access', 'pricing']);
    if (meta.version !== 1 || meta.route !== '/api/sketch-to-code' || meta.requestDigest !== t.requestDigest) throw new Error();
    const a = sketchFields(meta.access); const ownerId = sketchHttpId(a.ownerId);
    if (a.actorUserId !== actorUserId || a.projectId !== projectId) throw new Error();
    let access: SketchRecoveryIdentity['access'];
    if (a.kind === 'personal' && ownerId === actorUserId && Object.keys(a).length === 4) access = { kind: 'personal', actorUserId, projectId, ownerId };
    else if (a.kind === 'document' && Object.keys(a).length === 5) access = { kind: 'document', actorUserId, projectId, ownerId, grantGeneration: sketchHttpId(a.grantGeneration) };
    else throw new Error();
    const pricing = parseSketchAdmissionPricing(meta.pricing);
    if (t.creditCost !== pricing.totalCredits || !['pending', 'processing', 'submitting', 'completed', 'failed', 'cancelled', 'timeout'].includes(String(t.status))
      || typeof t.progress !== 'number' || !Number.isFinite(t.progress) || t.progress < 0 || t.progress > 100
      || !['pending', 'charged', 'refunded', 'not-applicable'].includes(String(t.creditStatus))) throw new Error();
    return Object.freeze({ task: Object.freeze({ id, userId: actorUserId, projectId, providerId, model: modelId, requestDigest: t.requestDigest, idempotencyKey: nonce,
      status: String(t.status), progress: t.progress, creditStatus: String(t.creditStatus), ...(typeof t.error === 'string' ? { error: t.error } : {}), ...(typeof t.label === 'string' ? { label: t.label } : {}) }), pricing,
      recovery: Object.freeze({ actorUserId, projectId, providerId, modelId, requestDigest: t.requestDigest, idempotencyKey: nonce, access: Object.freeze(access) }) });
  } catch { throw new SketchHttpError(404, 'SKETCH_TASK_UNAVAILABLE'); }
}
export function sketchTaskSummary(identity: SketchHttpIdentity): Record<string, unknown> {
  const { task: t, pricing } = identity;
  const phase = t.label === '草图转代码：分析中' ? 'analysis' : t.label === '草图转代码：重建中' ? 'reconstruction' : undefined;
  return { taskId: t.id, type: 'sketch-to-code', projectId: t.projectId, providerId: t.providerId, modelId: t.model,
    status: t.status, progress: t.progress, reserveCredits: pricing.totalCredits, pricing, ...(phase ? { phase } : {}) };
}
function validateBody(value: unknown, identity: SketchHttpIdentity, poll: boolean): void {
  const body = sketchFields(value, poll ? ['taskId', 'projectId', 'model', 'providerId'] : ['taskId', 'projectId']); const t = identity.task;
  if (body.taskId !== t.id || body.projectId !== undefined && body.projectId !== t.projectId) throw new SketchHttpError(400, 'SKETCH_INPUT_INVALID');
  if (body.providerId !== undefined && body.providerId !== t.providerId) throw new SketchHttpError(400, 'SKETCH_BINDING_MISMATCH');
  if (body.model !== undefined) {
    if (typeof body.model !== 'string') throw new SketchHttpError(400, 'SKETCH_BINDING_MISMATCH');
    const parts = body.model.split('::');
    if (parts.length === 1 ? body.model !== t.model : parts.length !== 2 || parts[0] !== t.providerId || parts[1] !== t.model) throw new SketchHttpError(400, 'SKETCH_BINDING_MISMATCH');
  }
}
function terminalError(identity: SketchHttpIdentity): Record<string, unknown> {
  const generic = { code: 'SKETCH_EXECUTION_FAILED' }; const error = identity.task.error;
  if (!error || error.length > 20_000) return generic;
  if (['SKETCH_EXECUTION_TIMEOUT', 'SKETCH_EXECUTION_CANCELLED', 'SKETCH_TOKEN_USAGE_INVALID', 'SKETCH_TOKEN_INSUFFICIENT_CREDITS', 'SKETCH_TOKEN_INTEGER_OVERFLOW'].includes(error)) return { code: error };
  try {
    const e = sketchFields(JSON.parse(error) as unknown, ['code', 'phase', 'requestId', 'providerId', 'modelId', 'providerStatus', 'providerCode', 'message']);
    if (!['SKETCH_PROVIDER_REJECTED', 'SKETCH_PROVIDER_RESPONSE_INVALID', 'SKETCH_PROVIDER_RESPONSE_LIMIT', 'SKETCH_PROVIDER_BINDING_MISMATCH'].includes(String(e.code))
      || !['analysis', 'reconstruction'].includes(String(e.phase)) || typeof e.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(e.requestId)
      || e.providerId !== identity.task.providerId || e.modelId !== identity.task.model || typeof e.message !== 'string' || e.message.length > 8192
      || e.providerCode !== undefined && (typeof e.providerCode !== 'string' || e.providerCode.length > 128)
      || e.providerStatus !== undefined && (typeof e.providerStatus !== 'number' || !Number.isInteger(e.providerStatus) || e.providerStatus < 100 || e.providerStatus > 599)) return generic;
    return { ...e };
  } catch { return generic; }
}
export async function pollSketchTask(value: unknown, candidate: unknown, actorUserId: string, requestId: string): Promise<NextResponse> {
  try {
    let identity = sketchTaskIdentity(candidate, actorUserId); validateBody(value, identity, true);
    if (['pending', 'processing'].includes(identity.task.status)) {
      const { recoverExpiredSketchTask } = await import('./execution');
      const outcome = await recoverExpiredSketchTask(identity.task.id, identity.recovery);
      if (outcome.status === 'deferred') return sketchJson({ success: true, ...sketchTaskSummary(identity), needsReconcile: true }, 202, requestId);
      let current: Awaited<ReturnType<typeof getCloudTaskById>>;
      try { current = await getCloudTaskById(identity.task.id); } catch { throw new SketchHttpError(503, 'SKETCH_TASK_UNAVAILABLE'); }
      const refreshed = sketchTaskIdentity(current, actorUserId);
      if (!isDeepStrictEqual(refreshed.recovery, identity.recovery) || !isDeepStrictEqual(refreshed.pricing, identity.pricing)) throw new SketchHttpError(404, 'SKETCH_TASK_UNAVAILABLE');
      identity = refreshed; validateBody(value, identity, true);
    }
    const summary = sketchTaskSummary(identity);
    if (identity.task.status === 'completed') {
      let document: Awaited<ReturnType<typeof readSketchDocument>>;
      try { document = await (await import('./document')).readSketchDocument({ actorUserId, projectId: identity.task.projectId, taskId: identity.task.id }); }
      catch { throw new SketchHttpError(404, 'SKETCH_DOCUMENT_UNAVAILABLE'); }
      if (document.taskId !== identity.task.id || document.projectId !== identity.task.projectId || document.providerId !== identity.task.providerId || document.modelId !== identity.task.model
        || document.reserveCredits !== identity.pricing.totalCredits || !isDeepStrictEqual(document.pricing, identity.pricing)) throw new SketchHttpError(404, 'SKETCH_DOCUMENT_UNAVAILABLE');
      return sketchJson({ success: true, ...summary, html: document.html, analysis: document.analysis,
        previewAssetId: document.previewAssetId, htmlAssetId: document.htmlAssetId, previewAssetVersionId: document.previewAssetVersionId, htmlAssetVersionId: document.htmlAssetVersionId,
        actualCredits: document.actualCredits, reserveCredits: document.reserveCredits, pricing: document.pricing,
        providerId: document.providerId, modelId: document.modelId, documentUrl: `${document.documentUrl}?projectId=${encodeURIComponent(identity.task.projectId)}`, refunded: false }, 200, requestId);
    }
    const active = ['pending', 'processing'].includes(identity.task.status);
    return sketchJson({ success: true, ...summary, ...(!active ? { error: terminalError(identity), refunded: identity.task.creditStatus === 'refunded' } : {}) }, active ? 202 : 200, requestId);
  } catch (error) { return sketchError(error, requestId); }
}
export async function cancelSketchTask(value: unknown, candidate: unknown, actorUserId: string, requestId: string): Promise<NextResponse> {
  try {
    const identity = sketchTaskIdentity(candidate, actorUserId); validateBody(value, identity, false);
    let refunded = identity.task.creditStatus === 'refunded';
    if (identity.task.status !== 'cancelled') {
      if (!['pending', 'processing'].includes(identity.task.status)) throw new SketchHttpError(409, 'SKETCH_TASK_NOT_ACTIVE');
      // Explicit owner cancellation intentionally does NOT demand today's write
      // grant or a worker lease. The original atomic service decides the winner.
      const settled = await terminateCloudTaskAndRefund(identity.task.id, 'cancelled', 'SKETCH_EXECUTION_CANCELLED', undefined, { requireActive: true });
      if (!settled.transitioned || settled.status !== 'cancelled') {
        let current: SketchHttpIdentity;
        try { current = sketchTaskIdentity(await getCloudTaskById(identity.task.id), actorUserId); }
        catch { throw new SketchHttpError(503, 'SKETCH_TASK_UNAVAILABLE'); }
        if (!isDeepStrictEqual(current.recovery, identity.recovery) || !isDeepStrictEqual(current.pricing, identity.pricing)) throw new SketchHttpError(503, 'SKETCH_TASK_UNAVAILABLE');
        if (['completed', 'failed', 'timeout'].includes(current.task.status)) throw new SketchHttpError(409, 'SKETCH_TASK_NOT_ACTIVE');
        if (current.task.status !== 'cancelled') throw new SketchHttpError(503, 'SKETCH_TASK_UNAVAILABLE');
        refunded = current.task.creditStatus === 'refunded';
      } else refunded = settled.refunded;
    }
    // Only an authoritative cancelled result permits memory interruption.
    abortTaskExecution(identity.task.id); cancelTask(identity.task.id); updateTaskProgress(identity.task.id, { status: 'cancelled', progress: 0 });
    return sketchJson({ success: true, ...sketchTaskSummary(identity), status: 'cancelled', progress: 0, refunded }, 200, requestId);
  } catch (error) { return sketchError(error, requestId); }
}
