import { getInternalRequestHeaders } from '@/lib/api-auth';
import { getInternalApiUrl } from '@/lib/api-helpers';
import type { AnnotationProviderRequest } from '@/lib/annotation-provider-adapter';
import type { AuthorizedAnnotationSource } from '@/lib/annotation-authorized-source';

interface SubmitAnnotationEditInput {
  request: AnnotationProviderRequest;
  userId: string;
  userRole: string;
  source: AuthorizedAnnotationSource;
  signal?: AbortSignal;
}

interface SubmitAnnotationEditResult {
  taskId: string;
  mode: string;
}

const REJECTION_MESSAGES: Readonly<Record<number, string>> = {
  400: '批注修图请求无效，请重新确认批注',
  401: '登录状态已失效，请重新登录',
  402: '积分不足，请充值后使用原请求重试',
  403: '无权执行该修图请求，请重新确认项目和模型权限',
  404: '项目或来源图片不存在',
  409: '来源版本、授权或请求已变化，请重新确认批注',
  413: '批注内容过大，请减少批注后重试',
  422: '批注修图请求无法执行，请检查批注和模型',
  429: '请求过于频繁，请稍后使用原请求重试',
  503: '批注修图准入暂不可用，请稍后使用原请求重试',
};
const REJECTION_CODES: Readonly<Record<string, readonly number[]>> = {
  ANNOTATION_PROJECT_NOT_FOUND: [404], ANNOTATION_SOURCE_STALE: [409], ANNOTATION_SOURCE_UNAVAILABLE: [503],
  ANNOTATION_EDIT_CONTEXT_INVALID: [400], ANNOTATION_COMPLEXITY_INVALID: [400, 413],
  ANNOTATION_IDEMPOTENCY_CONFLICT: [409], IDEMPOTENCY_CONFLICT: [409], INSUFFICIENT_CREDITS: [402],
  GENERATION_PROJECT_INVALID: [400], GENERATION_PROJECT_FORBIDDEN: [403], GENERATION_PROJECT_UNAVAILABLE: [503],
  CANVAS_EDIT_INVALID_INTENT: [400], CANVAS_EDIT_SOURCE_FORBIDDEN: [403], CANVAS_EDIT_SOURCE_MISMATCH: [403],
  CANVAS_EDIT_UNAVAILABLE: [503], CANVAS_TASK_PUBLICATION_FORBIDDEN: [403],
  CANVAS_TASK_PUBLICATION_CONFLICT: [409], CANVAS_TASK_PUBLICATION_UNAVAILABLE: [503],
};

/** Public transport error: never carries downstream bodies, causes or credentials. */
export class AnnotationSubmissionError extends Error {
  constructor(readonly status: number = 502, readonly code: string = 'ANNOTATION_SUBMISSION_FAILED',
    readonly retryable: boolean = true) {
    super(REJECTION_MESSAGES[status] ?? '批注修图提交暂不可用，请使用原请求重试');
    this.name = 'AnnotationSubmissionError';
  }
}

function downstreamRejection(status: number, payload: Record<string, unknown> | null): AnnotationSubmissionError {
  if (!Object.hasOwn(REJECTION_MESSAGES, status)) return new AnnotationSubmissionError();
  const rawCode = payload?.code;
  const code = typeof rawCode === 'string' && Object.hasOwn(REJECTION_CODES, rawCode)
    && REJECTION_CODES[rawCode].includes(status) ? rawCode : 'ANNOTATION_SUBMISSION_REJECTED';
  return new AnnotationSubmissionError(status, code, status === 429 || status === 503);
}

export async function submitAnnotationEdit({
  request,
  userId,
  userRole,
  source,
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
      image: source.imageUrl,
      prompt: request.prompt,
      mask: request.mask,
      referenceImages: [],
      _annotationReferenceImage: request.referenceImages[0],
      _annotationSource: source,
      projectId: source.projectId,
      ...(source.access?.kind === 'document' ? {
        assetWorkspace: 'canvas', assetWorkspaceId: source.projectId,
        assetParentVersionIds: [source.assetVersionId], assetSelectedEntityIds: [source.imageId],
        assetSourcePlacementId: source.placementId, sourceEntityId: source.imageId,
      } : {}),
      model: request.model,
      providerId: request.providerId,
      size: request.size,
      quality: request.quality,
      count: 1,
    }),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  }).catch((): never => { throw new AnnotationSubmissionError(); });

  const rawPayload: unknown = await response.json().catch(() => null);
  const payload = typeof rawPayload === 'object' && rawPayload !== null && !Array.isArray(rawPayload)
    ? rawPayload as Record<string, unknown> : null;
  if (!response.ok) throw downstreamRejection(response.status, payload);
  const taskId = payload?.taskId;
  if ((payload?.success !== undefined && payload.success !== true)
    || typeof taskId !== 'string' || !taskId || taskId.trim() !== taskId
    || taskId.length > 256 || /\p{Cc}/u.test(taskId)) {
    throw new AnnotationSubmissionError();
  }

  return {
    taskId,
    mode: typeof payload?.mode === 'string' && payload.mode ? payload.mode : 'polling',
  };
}
