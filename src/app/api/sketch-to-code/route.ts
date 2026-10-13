import { after, NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getRequestId } from '@/lib/request-id';
import { admitSketchTask, SketchAdmissionError } from '@/lib/sketch-to-code/admission';
import { executeSketchTask } from '@/lib/sketch-to-code/execution';
import { publishSketchTask } from '@/lib/sketch-to-code/publication';
import { SketchInputError } from '@/lib/sketch-to-code/generation';
import { sketchTaskIdentity, sketchTaskSummary } from '@/lib/sketch-to-code/task-http';
import { readSketchBody, sketchAuthResponse, sketchError, sketchJson, SketchHttpError } from '@/lib/sketch-to-code/http';
import { GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
import { ModelCapabilityError } from '@/lib/task-core/model-capability-contract';
import { InsufficientCreditsError } from '@/lib/credits';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import { createConfiguredSketchDependencies } from '@/lib/sketch-to-code/configured-dependencies';
import { resolveTaskModel } from '@/lib/task-core/model-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
function publicError(error: unknown): unknown {
  if (error instanceof SketchHttpError) return error;
  if (error instanceof SketchInputError) return new SketchHttpError(error.code === 'SKETCH_INPUT_INVALID' ? 400 : error.code === 'SKETCH_PROJECT_UNAVAILABLE' ? 404 : 422, error.code);
  if (error instanceof GenerationProjectAccessError) return new SketchHttpError(error.status, error.code);
  if (error instanceof ModelCapabilityError) return new SketchHttpError(error.code === 'MODEL_NOT_AUTHORIZED' ? 403 : 422, error.code);
  if (error instanceof InsufficientCreditsError) return new SketchHttpError(402, 'INSUFFICIENT_CREDITS');
  if (error instanceof IdempotencyConflictError) return new SketchHttpError(409, 'IDEMPOTENCY_CONFLICT');
  if (error instanceof SketchAdmissionError && (error.code === 'SKETCH_PROJECT_CHANGED' && error.status === 403
    || ['SKETCH_PRICING_INVALID', 'SKETCH_TASK_UNAVAILABLE'].includes(error.code) && error.status === 503)) return new SketchHttpError(error.status, error.code);
  return error;
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  try {
    const auth = await requireApiAuthOrReject(request);
    if (auth instanceof NextResponse) return sketchAuthResponse(auth, requestId);
    const value = await readSketchBody(request); request.signal.throwIfAborted();
    const generation = createConfiguredSketchDependencies({ requestId, resolveTaskModel: async (providerId, modelId, actorUserId) => {
      // The existing catalog remains authority. Validate its actual descriptor
      // here with an own typed error, not by trusting an arbitrary Error.message.
      const descriptor = await resolveTaskModel(providerId, modelId, actorUserId);
      if (descriptor.providerId !== providerId || descriptor.modelId !== modelId || descriptor.kind !== 'chat' || descriptor.supportsVision !== true
        || descriptor.protocol !== 'chat-completions' || descriptor.executionMode !== 'sync') throw new SketchInputError('SKETCH_MODEL_UNAVAILABLE');
      return descriptor;
    } });
    const admission = await admitSketchTask(value, { actorUserId: auth.user.id, signal: request.signal }, { generation });
    const identity = sketchTaskIdentity(admission.task, auth.user.id);
    let dispatchPending = false;
    if (!admission.reused) {
      if (!admission.prepared) dispatchPending = true;
      else try {
        after(async () => {
          // No inbound signal: response disconnect is NOT an explicit cancellation.
          try { await executeSketchTask(admission, { actorUserId: auth.user.id, projectId: identity.task.projectId }, { publisher: publishSketchTask }); }
          catch { /* unknown outcome is reconciled only by original query/recovery */ }
        });
      } catch { dispatchPending = true; }
    }
    return sketchJson({ success: true, ...sketchTaskSummary(identity), reused: admission.reused, charged: admission.charged, ...(dispatchPending ? { dispatchPending: true } : {}) }, admission.reused ? 200 : 202, requestId);
  } catch (error) { return sketchError(publicError(error), requestId); }
}
