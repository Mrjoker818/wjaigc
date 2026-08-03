import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { findOwnedAnnotationSource } from '@/lib/annotation-project-source';
import {
  cancelEffectReverseTask,
  EffectReverseServiceError,
  getEffectReverseTask,
  submitEffectReverseTask,
  type EffectReverseAction,
} from '@/lib/effect-reverse-engineering/service';
import type { EffectReverseSessionInput } from '@/lib/effect-reverse-engineering/types';
import {
  EffectReverseValidationError,
  validateEffectReverseSessionInput,
} from '@/lib/effect-reverse-engineering/validation';
import { normalizeTrustedManagedMediaInput } from '@/lib/safe-image-input';

const MAX_REQUEST_BYTES = 256 * 1024;
const ACTIONS = new Set<EffectReverseAction>([
  'correct',
  'export-png',
  'export-svg',
  'export-pdf',
  'export-zip',
]);

function responseError(error: unknown): NextResponse {
  if (error instanceof EffectReverseServiceError) {
    return NextResponse.json({
      success: false,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    }, { status: error.status });
  }
  if (error instanceof EffectReverseValidationError) {
    return NextResponse.json({
      success: false,
      code: error.code,
      message: error.message,
      retryable: false,
    }, { status: 400 });
  }
  console.error('[effect-reverse-engineering] Unhandled error:', error);
  return NextResponse.json({
    success: false,
    code: 'EFFECT_REVERSE_INTERNAL_ERROR',
    message: 'Effect reverse engineering is temporarily unavailable',
    retryable: true,
  }, { status: 500 });
}

function trustedHosts(request: NextRequest): string[] {
  const hosts: string[] = [];
  const configured = process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim();
  if (configured) {
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(configured)
        ? configured
        : `https://${configured}`);
      if (!url.username && !url.password && ['http:', 'https:'].includes(url.protocol)) {
        hosts.push(url.host);
      }
    } catch {
      // Invalid deployment configuration must not widen the trust boundary.
    }
  }
  if (
    process.env.NODE_ENV !== 'production'
    && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(request.nextUrl.hostname)
  ) {
    hosts.push(request.nextUrl.host);
  }
  return hosts;
}

async function readBoundedJson(request: NextRequest): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new EffectReverseServiceError(
      'EFFECT_REVERSE_BODY_TOO_LARGE',
      'Request body exceeds 256 KiB',
      413,
    );
  }
  if (!request.body) {
    throw new EffectReverseServiceError(
      'EFFECT_REVERSE_REQUEST_INVALID',
      'Request body is required',
      400,
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new EffectReverseServiceError(
          'EFFECT_REVERSE_BODY_TOO_LARGE',
          'Request body exceeds 256 KiB',
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof EffectReverseServiceError) throw error;
    throw new EffectReverseServiceError(
      'EFFECT_REVERSE_JSON_INVALID',
      'Request body must contain a JSON object',
      400,
    );
  }
}

function requireTaskId(request: NextRequest): string {
  const taskId = request.nextUrl.searchParams.get('taskId')?.trim() || '';
  if (!taskId || taskId.length > 256) {
    throw new EffectReverseServiceError(
      'EFFECT_REVERSE_TASK_ID_INVALID',
      'A valid taskId is required',
      400,
    );
  }
  return taskId;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await readBoundedJson(request);
    const action = body.action;
    if (typeof action !== 'string' || !ACTIONS.has(action as EffectReverseAction)) {
      throw new EffectReverseServiceError(
        'EFFECT_REVERSE_ACTION_INVALID',
        'Unsupported reverse engineering action',
        400,
      );
    }
    const parsed = validateEffectReverseSessionInput(body as unknown as EffectReverseSessionInput);
    const owned = await findOwnedAnnotationSource(
      auth.userId,
      parsed.projectId,
      parsed.sourceImageId,
    );
    if (!owned) {
      throw new EffectReverseServiceError(
        'EFFECT_REVERSE_SOURCE_NOT_FOUND',
        'Source image was not found in the owned project',
        404,
      );
    }
    if (owned.versionId !== parsed.sourceVersionId) {
      throw new EffectReverseServiceError(
        'EFFECT_REVERSE_SOURCE_STALE',
        'Source image version has changed',
        409,
      );
    }
    const hosts = trustedHosts(request);
    const submittedUrl = normalizeTrustedManagedMediaInput(parsed.imageUrl, hosts);
    const ownedUrl = normalizeTrustedManagedMediaInput(owned.imageUrl, hosts);
    if (submittedUrl !== ownedUrl) {
      throw new EffectReverseServiceError(
        'EFFECT_REVERSE_SOURCE_MISMATCH',
        'Source image URL does not match the owned snapshot',
        409,
      );
    }

    const result = await submitEffectReverseTask({
      userId: auth.userId,
      action: action as EffectReverseAction,
      request: { ...parsed, imageUrl: ownedUrl },
    });
    return NextResponse.json({ success: true, ...result }, { status: 202 });
  } catch (error) {
    return responseError(error);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await getEffectReverseTask({
      taskId: requireTaskId(request),
      userId: auth.userId,
      userRole: auth.userRole,
    }));
  } catch (error) {
    return responseError(error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await cancelEffectReverseTask({
      taskId: requireTaskId(request),
      userId: auth.userId,
      userRole: auth.userRole,
    }));
  } catch (error) {
    return responseError(error);
  }
}
