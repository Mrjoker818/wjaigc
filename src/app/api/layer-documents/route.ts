import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  createLayerDocumentForSource,
  getLayerDocumentForSource,
  saveLayerDocument,
} from '@/lib/layer-documents/service';
import type { LayerDocumentSource } from '@/lib/layer-documents/types';
import {
  LayerDocumentError,
  readLayerDocumentContent,
  validateLayerDocumentRequestSize,
} from '@/lib/layer-documents/validation';
import {
  errorResponse,
  getRequestId,
  successResponse,
} from '@/lib/request-id';

export const runtime = 'nodejs';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_REQUEST_INVALID',
      '图层文档请求格式无效',
    );
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_REQUEST_INVALID',
      `${label}无效`,
    );
  }
  return value.trim();
}

function sourceFrom(value: unknown): LayerDocumentSource {
  const input = record(value);
  const imageUrl = identifier(input.imageUrl, '来源图片地址');
  return {
    projectId: identifier(input.projectId, '项目 ID'),
    sourceImageId: identifier(input.sourceImageId, '来源图片 ID'),
    sourceVersionId: identifier(input.sourceVersionId, '来源版本 ID'),
    imageUrl,
  };
}

async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const rawBody = await request.text();
  validateLayerDocumentRequestSize(rawBody);
  try {
    return record(JSON.parse(rawBody) as unknown);
  } catch (error) {
    if (error instanceof LayerDocumentError) throw error;
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_JSON_INVALID',
      '请求体必须是有效 JSON',
    );
  }
}

function routeError(error: unknown, requestId: string): NextResponse {
  if (error instanceof LayerDocumentError) {
    return errorResponse(
      error.status,
      error.code,
      error.message,
      requestId,
      error.retryable,
    );
  }
  const coded = error && typeof error === 'object'
    ? error as { code?: unknown; status?: unknown; retryable?: unknown; message?: unknown }
    : null;
  if (
    typeof coded?.code === 'string'
    && coded.code.startsWith('LAYER_DOCUMENT_')
    && typeof coded.status === 'number'
    && Number.isInteger(coded.status)
    && coded.status >= 400
    && coded.status <= 599
  ) {
    return errorResponse(
      coded.status,
      coded.code,
      typeof coded.message === 'string' ? coded.message : '图层文档操作失败',
      requestId,
      coded.retryable === true,
    );
  }
  return errorResponse(
    503,
    'LAYER_DOCUMENT_PERSISTENCE_UNAVAILABLE',
    '图层文档服务暂时不可用，请稍后重试',
    requestId,
    true,
  );
}

async function authenticatedUserId(
  request: NextRequest,
  requestId: string,
): Promise<string | NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) {
    return errorResponse(
      401,
      'AUTH_REQUIRED',
      '请登录后再使用图层文档',
      requestId,
      false,
    );
  }
  return auth.userId;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const userId = await authenticatedUserId(request, requestId);
  if (userId instanceof NextResponse) return userId;
  try {
    const source = {
      projectId: identifier(request.nextUrl.searchParams.get('projectId'), '项目 ID'),
      sourceImageId: identifier(request.nextUrl.searchParams.get('sourceImageId'), '来源图片 ID'),
      sourceVersionId: identifier(request.nextUrl.searchParams.get('sourceVersionId'), '来源版本 ID'),
    };
    const owned = await getLayerDocumentForSource({
      userId,
      source,
    });
    return successResponse({ document: owned }, requestId);
  } catch (error) {
    return routeError(error, requestId);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const userId = await authenticatedUserId(request, requestId);
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJson(request);
    const document = await createLayerDocumentForSource({
      userId,
      source: sourceFrom(body.source),
      taskId: identifier(body.taskId, '任务 ID'),
      content: readLayerDocumentContent(body.content),
    });
    const response = successResponse({ document }, requestId);
    return new NextResponse(response.body, {
      status: 201,
      headers: response.headers,
    });
  } catch (error) {
    return routeError(error, requestId);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const userId = await authenticatedUserId(request, requestId);
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJson(request);
    if (
      typeof body.expectedRevision !== 'number'
      || !Number.isInteger(body.expectedRevision)
      || body.expectedRevision < 0
    ) {
      throw new LayerDocumentError(
        'LAYER_DOCUMENT_REVISION_INVALID',
        '图层文档修订号无效',
      );
    }
    const document = await saveLayerDocument({
      userId,
      documentId: identifier(body.documentId, '文档 ID'),
      expectedRevision: body.expectedRevision,
      content: readLayerDocumentContent(body.content),
    });
    return successResponse({ document }, requestId);
  } catch (error) {
    return routeError(error, requestId);
  }
}
