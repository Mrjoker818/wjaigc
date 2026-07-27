import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { submitAnnotationEdit } from '@/features/annotations/annotation-executor';
import { validateEditIntentBundle } from '@/features/annotations/annotation-bundle';
import type { EditIntentBundle } from '@/features/annotations/annotation-types';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { AnnotationAssetError, compileAnnotationAssets } from '@/lib/annotation-mask';
import { findOwnedAnnotationSource } from '@/lib/annotation-project-source';
import {
  AnnotationProviderError,
  buildAnnotationProviderRequest,
  resolveAnnotationProvider,
} from '@/lib/annotation-provider-adapter';
import { normalizeTrustedManagedMediaInput } from '@/lib/safe-image-input';

export const runtime = 'nodejs';
export const maxDuration = 60;
const MAX_REQUEST_BYTES = 512 * 1024;

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

function isBundle(value: unknown): value is EditIntentBundle {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Record<string, unknown>;
  return (
    typeof bundle.projectId === 'string'
    && typeof bundle.sourceImageId === 'string'
    && typeof bundle.sourceVersionId === 'string'
    && typeof bundle.idempotencyKey === 'string'
    && typeof bundle.modelId === 'string'
    && typeof bundle.providerId === 'string'
    && Array.isArray(bundle.annotationIds)
    && Array.isArray(bundle.annotations)
  );
}

function validationStatus(code: string): number {
  if (code === 'ANNOTATION_COUNT_INVALID') return 400;
  if (
    code === 'ANNOTATION_SOURCE_MISMATCH'
    || code === 'ANNOTATION_SOURCE_STALE'
  ) {
    return 409;
  }
  return 422;
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
        'Annotation request body exceeds 512 KB',
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

  if (!isBundle(body.bundle)) {
    return errorResponse(
      400,
      'ANNOTATION_REQUEST_INVALID',
      '批注包格式无效',
      requestId,
    );
  }
  const bundle = body.bundle;
  const validation = validateEditIntentBundle(bundle);
  if (!validation.success) {
    return errorResponse(
      validationStatus(validation.code),
      validation.code,
      validation.message,
      requestId,
    );
  }

  let source = await findOwnedAnnotationSource(
    auth.userId,
    bundle.projectId,
    bundle.sourceImageId,
  );
  if (!source) {
    // DB 中找不到图片（可能尚未同步），尝试使用前端传来的 imageUrl 兜底
    const fallbackUrl = typeof body.sourceImageUrl === 'string' ? body.sourceImageUrl.trim() : '';
    if (fallbackUrl) {
      source = {
        projectId: bundle.projectId,
        imageId: bundle.sourceImageId,
        imageUrl: fallbackUrl,
        versionId: bundle.sourceVersionId,
      };
    } else {
      return errorResponse(
        404,
        'ANNOTATION_PROJECT_NOT_FOUND',
        '项目或来源图片不存在',
        requestId,
      );
    }
  }
  if (source.versionId !== bundle.sourceVersionId) {
    return errorResponse(
      409,
      'ANNOTATION_SOURCE_STALE',
      '批注源图版本已变化，请重新标注后再执行修改',
      requestId,
    );
  }
  try {
    const resolved = await resolveAnnotationProvider(
      bundle.providerId,
      bundle.modelId,
      { userId: auth.userId, userRole: auth.userRole },
    );
    const effectiveBundle: EditIntentBundle = {
      ...bundle,
      providerId: resolved.providerId,
      modelId: resolved.modelId,
    };
    const sourceImageInput = normalizeTrustedManagedMediaInput(
      source.imageUrl,
      trustedRequestHosts(request),
    );
    const assets = await compileAnnotationAssets({
      imageUrl: sourceImageInput,
      annotations: effectiveBundle.annotations,
      signal: request.signal,
    });
    const providerRequest = buildAnnotationProviderRequest({
      bundle: effectiveBundle,
      imageUrl: sourceImageInput,
      assets,
      requestId,
    });
    const result = await submitAnnotationEdit({
      request: providerRequest,
      userId: auth.userId,
      userRole: auth.userRole,
    });

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      mode: result.mode,
      requestId,
    }, { status: 202 });
  } catch (error) {
    if (error instanceof AnnotationProviderError) {
      return errorResponse(
        error.code === 'ANNOTATION_MODEL_FORBIDDEN' ? 403 : 422,
        error.code,
        error.message,
        requestId,
      );
    }
    if (error instanceof AnnotationAssetError) {
      return errorResponse(422, error.code, error.message, requestId, true);
    }
    return errorResponse(
      502,
      'ANNOTATION_SUBMISSION_FAILED',
      error instanceof Error ? error.message : '批注修图提交失败',
      requestId,
      true,
    );
  }
}
