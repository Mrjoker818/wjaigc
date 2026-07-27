import { getInternalRequestHeaders } from '@/lib/api-auth';
import { getInternalApiUrl } from '@/lib/api-helpers';
import type { AnnotationProviderRequest } from '@/lib/annotation-provider-adapter';

interface SubmitAnnotationEditInput {
  request: AnnotationProviderRequest;
  userId: string;
  userRole: string;
  signal?: AbortSignal;
}

interface SubmitAnnotationEditResult {
  taskId: string;
  mode: string;
}

export async function submitAnnotationEdit({
  request,
  userId,
  userRole,
  signal,
}: SubmitAnnotationEditInput): Promise<SubmitAnnotationEditResult> {
  const timeoutSignal = AbortSignal.timeout(120_000);
  const response = await fetch(getInternalApiUrl('/api/edit'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': request.requestId,
      'x-idempotency-key': request.idempotencyKey,
      ...(await getInternalRequestHeaders(
        userId,
        userRole === 'admin' ? 'admin' : 'user',
      )),
    },
    body: JSON.stringify({
      image: request.image,
      prompt: request.prompt,
      mask: request.mask,
      referenceImages: request.referenceImages,
      model: request.model,
      providerId: request.providerId,
      size: request.size,
      quality: request.quality,
      count: 1,
    }),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });

  const payload = await response.json().catch(() => null) as {
    taskId?: string;
    mode?: string;
    error?: string;
  } | null;
  if (!response.ok || !payload?.taskId) {
    throw new Error(payload?.error || `批注修图提交失败: HTTP ${response.status}`);
  }

  return {
    taskId: payload.taskId,
    mode: payload.mode || 'polling',
  };
}
