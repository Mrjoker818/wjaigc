import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { findOwnedAnnotationSource } from '@/lib/annotation-project-source';
import { DISPLAY_DECOMPOSE_SUPPORTED_RATIOS } from '@/lib/display-decompose';
import {
  cancelElementDecomposition,
  ElementDecompositionError,
  getElementDecomposition,
  retryElementBranch,
  submitElementDecomposition,
} from '@/lib/element-decomposition/service';
import type { ElementDecomposeRequest } from '@/lib/element-decomposition/types';
import { validateLayerIdempotencyKey } from '@/lib/layer-decomposition/validation';
import { normalizeTrustedManagedMediaInput } from '@/lib/safe-image-input';

const MAX_ELEMENT_REQUEST_BODY_BYTES = 128 * 1024;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ElementDecompositionError) {
    return NextResponse.json({
      success: false,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    }, { status: error.status });
  }
  const validation = error as { code?: unknown; status?: unknown; message?: unknown };
  if (typeof validation.code === 'string' && typeof validation.status === 'number') {
    return NextResponse.json({
      success: false,
      code: validation.code,
      message: typeof validation.message === 'string' ? validation.message : 'Invalid element decomposition request',
      retryable: false,
    }, { status: validation.status });
  }
  console.error('[element-decompose] Unhandled error:', error);
  return NextResponse.json({
    success: false,
    code: 'ELEMENT_INTERNAL_ERROR',
    message: '元素拆解服务暂时不可用',
    retryable: true,
  }, { status: 500 });
}

function badRequest(code: string, message: string): never {
  throw new ElementDecompositionError(code, message, 400);
}

function trustedHosts(request: NextRequest): string[] {
  const hosts: string[] = [];
  const configured = process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim();
  if (configured) {
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(configured) ? configured : `https://${configured}`);
      if (!url.username && !url.password && ['http:', 'https:'].includes(url.protocol)) hosts.push(url.host);
    } catch {
      // Invalid deployment configuration must not widen the media trust boundary.
    }
  }
  if (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(request.nextUrl.hostname)) {
    hosts.push(request.nextUrl.host);
  }
  return hosts;
}

async function readElementRequestJson(request: NextRequest): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_ELEMENT_REQUEST_BODY_BYTES) {
    throw new ElementDecompositionError('ELEMENT_BODY_TOO_LARGE', 'Request body exceeds 128 KiB', 413);
  }
  if (!request.body) badRequest('ELEMENT_REQUEST_INVALID', 'Request body is required');
  const reader = request.body!.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ELEMENT_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new ElementDecompositionError('ELEMENT_BODY_TOO_LARGE', 'Request body exceeds 128 KiB', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return badRequest('ELEMENT_REQUEST_INVALID', 'Request must be a JSON object');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ElementDecompositionError) throw error;
    throw new ElementDecompositionError('ELEMENT_JSON_INVALID', 'Request body must contain valid JSON', 400);
  }
}

function stringField(value: unknown, name: string, max: number, required = true): string | undefined {
  if (typeof value !== 'string') {
    if (!required && value === undefined) return undefined;
    return badRequest('ELEMENT_REQUEST_INVALID', `${name} must be a string`);
  }
  const normalized = value.trim();
  if ((!normalized && required) || normalized.length > max) return badRequest('ELEMENT_REQUEST_INVALID', `${name} is invalid`);
  return normalized || undefined;
}

function parseRequest(value: unknown, request: NextRequest): ElementDecomposeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return badRequest('ELEMENT_REQUEST_INVALID', 'Request must be a JSON object');
  const body = value as Record<string, unknown>;
  const projectId = stringField(body.projectId, 'projectId', 256)!;
  const sourceImageId = stringField(body.sourceImageId, 'sourceImageId', 256)!;
  const sourceVersionId = stringField(body.sourceVersionId, 'sourceVersionId', 512, false);
  const rawImageUrl = stringField(body.imageUrl, 'imageUrl', 21 * 1024 * 1024)!;
  const outputMode = body.outputMode ?? 'both';
  if (!['board', 'layers', 'both'].includes(String(outputMode))) return badRequest('ELEMENT_OUTPUT_MODE_INVALID', 'outputMode must be board, layers, or both');
  const board = body.board && typeof body.board === 'object' && !Array.isArray(body.board) ? body.board as Record<string, unknown> : {};
  const layers = body.layers && typeof body.layers === 'object' && !Array.isArray(body.layers) ? body.layers as Record<string, unknown> : {};
  const background = board.background ?? 'light-gray';
  if (background !== 'light-gray' && background !== 'transparent') return badRequest('ELEMENT_BOARD_BACKGROUND_INVALID', 'board background is invalid');
  const aspectRatio = stringField(board.aspectRatio ?? '16:9', 'aspectRatio', 16)!;
  if (!DISPLAY_DECOMPOSE_SUPPORTED_RATIOS.includes(
    aspectRatio as typeof DISPLAY_DECOMPOSE_SUPPORTED_RATIOS[number],
  )) {
    return badRequest('ELEMENT_BOARD_RATIO_INVALID', 'board aspect ratio is unsupported');
  }
  const boardProviderId = stringField(board.providerId, 'board.providerId', 128, false);
  const boardModelId = stringField(board.modelId, 'board.modelId', 256, false);
  const boardRequested = outputMode === 'board' || outputMode === 'both';
  if ((boardRequested && (!boardProviderId || !boardModelId)) || Boolean(boardProviderId) !== Boolean(boardModelId)) {
    return badRequest(
      'ELEMENT_BOARD_PROVIDER_REQUIRED',
      'board providerId and modelId must be selected together when board output is requested',
    );
  }
  const engine = layers.engine ?? 'smart';
  if (!['smart', 'cloud', 'local'].includes(String(engine))) return badRequest('ELEMENT_LAYER_MODE_INVALID', 'layer engine is invalid');
  if (layers.requireTransparentSubject !== undefined && typeof layers.requireTransparentSubject !== 'boolean') {
    return badRequest('ELEMENT_LAYER_TRANSPARENCY_INVALID', 'layers.requireTransparentSubject must be a boolean');
  }
  const providerId = stringField(layers.providerId, 'providerId', 128, false);
  const modelId = stringField(layers.modelId, 'modelId', 256, false);
  if ((engine === 'cloud' && (!providerId || !modelId)) || Boolean(providerId) !== Boolean(modelId)) {
    return badRequest('ELEMENT_LAYER_PROVIDER_REQUIRED', 'providerId and modelId must be selected together for cloud layering');
  }
  return {
    projectId,
    sourceImageId,
    sourceVersionId,
    imageUrl: normalizeTrustedManagedMediaInput(rawImageUrl, trustedHosts(request)),
    outputMode: outputMode as ElementDecomposeRequest['outputMode'],
    board: {
      aspectRatio,
      background,
      providerId: boardProviderId,
      modelId: boardModelId,
    },
    layers: {
      engine: engine as ElementDecomposeRequest['layers']['engine'],
      providerId,
      modelId,
      requireTransparentSubject: layers.requireTransparentSubject === true || background === 'transparent',
    },
  };
}

async function verifyOwnedSource(
  auth: { userId: string },
  parsed: ElementDecomposeRequest,
  request: NextRequest,
): Promise<ElementDecomposeRequest> {
  const owned = await findOwnedAnnotationSource(auth.userId, parsed.projectId, parsed.sourceImageId);
  if (!owned) {
    throw new ElementDecompositionError('ELEMENT_SOURCE_NOT_FOUND', 'Element decomposition source was not found in the owned project', 404);
  }
  if (!parsed.sourceVersionId || owned.versionId !== parsed.sourceVersionId) {
    throw new ElementDecompositionError('ELEMENT_SOURCE_STALE', 'Element decomposition source version has changed', 409);
  }
  const hosts = trustedHosts(request);
  const submittedUrl = normalizeTrustedManagedMediaInput(parsed.imageUrl, hosts);
  const ownedUrl = normalizeTrustedManagedMediaInput(owned.imageUrl, hosts);
  if (submittedUrl !== ownedUrl) {
    throw new ElementDecompositionError('ELEMENT_SOURCE_MISMATCH', 'Element decomposition source URL does not match the owned snapshot', 409);
  }
  return { ...parsed, imageUrl: ownedUrl };
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await readElementRequestJson(request);
    if (body.action === 'retry') {
      const taskId = stringField(body.taskId, 'taskId', 256)!;
      if (body.branch !== 'board' && body.branch !== 'layers') return badRequest('ELEMENT_BRANCH_INVALID', 'branch must be board or layers');
      return NextResponse.json(await retryElementBranch({ taskId, branch: body.branch, userId: auth.userId, userRole: auth.userRole }));
    }
    const idempotencyKey = validateLayerIdempotencyKey(request.headers.get('idempotency-key'));
    const parsedRequest = await verifyOwnedSource(auth, parseRequest(body, request), request);
    const result = await submitElementDecomposition({
      userId: auth.userId,
      userRole: auth.userRole,
      idempotencyKey,
      request: parsedRequest,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const taskId = stringField(request.nextUrl.searchParams.get('taskId'), 'taskId', 256)!;
    return NextResponse.json(await getElementDecomposition({ taskId, userId: auth.userId, userRole: auth.userRole }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const taskId = stringField(request.nextUrl.searchParams.get('taskId'), 'taskId', 256)!;
    return NextResponse.json(await cancelElementDecomposition({ taskId, userId: auth.userId, userRole: auth.userRole }));
  } catch (error) {
    return errorResponse(error);
  }
}
