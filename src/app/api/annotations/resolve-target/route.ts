import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { AnnotationSourceAdmissionError, findAuthorizedAnnotationSource, assertAnnotationSourceUnchanged } from '@/lib/annotation-authorized-source';
import { identifyImageTargetAtPoint } from '@/lib/identify-subject';
import { normalizeTrustedManagedMediaInput } from '@/lib/safe-image-input';

export const runtime = 'nodejs';
export const maxDuration = 60;
const MAX_REQUEST_BYTES = 64 * 1024;

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  retryable = false,
) {
  return NextResponse.json({
    success: false,
    code,
    message,
    requestId,
    retryable,
  }, { status });
}

function isNormalizedPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.x === 'number'
    && Number.isFinite(point.x)
    && point.x >= 0
    && point.x <= 1
    && typeof point.y === 'number'
    && Number.isFinite(point.y)
    && point.y >= 0
    && point.y <= 1
  );
}

function trustedRequestHosts(request: NextRequest): string[] {
  return [
    request.nextUrl.host,
    request.headers.get('host') || '',
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || '',
  ].filter(Boolean);
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const requestId = request.headers.get('x-request-id') || randomUUID();

  let body: Record<string, unknown>;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
      return errorResponse(
        413,
        'ANNOTATION_COMPLEXITY_INVALID',
        'Annotation target request body exceeds 64 KB',
        requestId,
      );
    }
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return errorResponse(
      400,
      'ANNOTATION_REQUEST_INVALID',
      '请求 JSON 无效',
      requestId,
    );
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  const sourceImageId = typeof body.sourceImageId === 'string'
    ? body.sourceImageId.trim()
    : '';
  const sourceVersionId = typeof body.sourceVersionId === 'string'
    ? body.sourceVersionId.trim()
    : '';
  if (
    !projectId
    || !sourceImageId
    || !sourceVersionId
    || !isNormalizedPoint(body.point)
  ) {
    return errorResponse(
      400,
      'ANNOTATION_REQUEST_INVALID',
      '项目、来源图片、来源版本或点击坐标无效',
      requestId,
    );
  }

  try {
    const source = await findAuthorizedAnnotationSource(
      auth.userId,
      projectId,
      sourceImageId,
    );
    if (!source) {
      return errorResponse(
        404,
        'ANNOTATION_PROJECT_NOT_FOUND',
        '项目或来源图片不存在',
        requestId,
      );
    }
    if (source.versionId !== sourceVersionId) {
      return errorResponse(
        409,
        'ANNOTATION_SOURCE_STALE',
        'Source image version has changed. Refresh the annotation and try again.',
        requestId,
      );
    }
    const sourceImageInput = normalizeTrustedManagedMediaInput(
      source.imageUrl,
      trustedRequestHosts(request),
    );
    const target = await identifyImageTargetAtPoint(
      sourceImageInput,
      body.point,
      30_000,
      { userId: auth.userId, userRole: auth.userRole },
    );
    await assertAnnotationSourceUnchanged(source);
    if (!target) {
      return errorResponse(
        422,
        'ANNOTATION_TARGET_NOT_FOUND',
        '未能可靠识别点击对象，请改用框选工具',
        requestId,
        true,
      );
    }
    return NextResponse.json({
      success: true,
      target,
      requiresConfirmation: target.confidence < 0.72,
      // The resolver intentionally auto-selects only from this user's assigned
      // vision models; callers cannot expand provider or model permissions.
      modelSelection: { mode: 'auto-authorized' },
      requestId,
    });
  } catch (error) {
    if (error instanceof AnnotationSourceAdmissionError) {
      return errorResponse(error.status, error.code, error.message, requestId, error.status === 503);
    }
    return errorResponse(
      422,
      'ANNOTATION_TARGET_RESOLUTION_FAILED',
      error instanceof Error ? error.message : '对象识别失败',
      requestId,
      true,
    );
  }
}
