import { after, NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getRequestId } from '@/lib/request-id';
import { admitSketchImageTask } from '@/lib/sketch-to-code/image-admission';
import { createConfiguredSketchImageService } from '@/lib/sketch-to-code/image-service';
import { executeSketchImageTask } from '@/lib/sketch-to-code/image-worker';
import { readSketchImageTaskIdentity } from '@/lib/sketch-to-code/image-task-state';
import { sketchImageTaskSummary } from '@/lib/sketch-to-code/image-public-http';
import { parseStoredSketchImageInput } from '@/lib/sketch-to-code/image-contract';
import { readSketchImageBody } from '@/lib/sketch-to-code/image-http';
import { sketchAuthResponse, sketchError, sketchJson, SketchHttpError } from '@/lib/sketch-to-code/http';
import { SketchAdmissionError } from '@/lib/sketch-to-code/admission';
import { GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
import { ModelCapabilityError } from '@/lib/task-core/model-capability-contract';
import { InsufficientCreditsError } from '@/lib/credits';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 660;
function publicError(error: unknown): unknown {
  if (error instanceof SketchHttpError) return error;
  if (error instanceof GenerationProjectAccessError) return new SketchHttpError(error.status, error.code);
  if (error instanceof ModelCapabilityError) return new SketchHttpError(error.code === 'MODEL_NOT_AUTHORIZED' ? 403 : 422, error.code);
  if (error instanceof InsufficientCreditsError) return new SketchHttpError(402, 'INSUFFICIENT_CREDITS');
  if (error instanceof IdempotencyConflictError) return new SketchHttpError(409, 'IDEMPOTENCY_CONFLICT');
  if (error instanceof SketchAdmissionError && (error.code === 'SKETCH_PROJECT_CHANGED' && error.status === 403
    || ['SKETCH_IMAGE_PRICING_INVALID', 'SKETCH_TASK_UNAVAILABLE'].includes(error.code) && error.status === 503)) return new SketchHttpError(error.status, error.code);
  return error;
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  try {
    const auth = await requireApiAuthOrReject(request);
    if (auth instanceof NextResponse) return sketchAuthResponse(auth, requestId);
    const body = await readSketchImageBody(request); request.signal.throwIfAborted();
    // Data-only validation is not model/project permission. The original
    // preparation still resolves both roles and performs real CPU decoding.
    let value: ReturnType<typeof parseStoredSketchImageInput>;
    try { value = parseStoredSketchImageInput(body); } catch { throw new SketchHttpError(400, 'SKETCH_IMAGE_INPUT_INVALID'); }
    const service = createConfiguredSketchImageService(requestId);
    const admission = await admitSketchImageTask(value, { actorUserId: auth.user.id, signal: request.signal }, { generation: service.generation });
    const identity = readSketchImageTaskIdentity(admission.task, auth.user.id), summary = sketchImageTaskSummary(admission.task, auth.user.id);
    let dispatchPending = false;
    if (!admission.reused) {
      if (!admission.prepared) dispatchPending = true;
      else try {
        const dependencies = service.workerDependencies();
        after(async () => {
          // Closing a response is not an explicit owner cancellation. Each
          // producer retains its original DB/lease/charge/checkpoint fences.
          try { await executeSketchImageTask(admission, { actorUserId: auth.user.id, projectId: identity.projectId }, dependencies); }
          catch { /* Only original durable query/accepted recovery reconciles unknown outcomes. */ }
        });
      } catch { dispatchPending = true; }
    }
    return sketchJson({ success: true, ...summary, reused: admission.reused, charged: admission.charged,
      ...(dispatchPending ? { dispatchPending: true } : {}) }, admission.reused ? 200 : 202, requestId);
  } catch (error) { return sketchError(publicError(error), requestId); }
}
