import { NextRequest, NextResponse } from 'next/server';

import {
  markGatewayAdmitted,
  markGatewayRejected,
  reserveGatewayRequest,
} from '@/lib/media-gateway/admission';
import { readGatewayJson } from '@/lib/media-gateway/http';
import { submitGatewayImage } from '@/lib/media-gateway/internal-client';
import { authenticateGatewayBearer } from '@/lib/media-gateway/key-service';
import {
  digestGatewayRequest,
  normalizeGatewayImageRequest,
} from '@/lib/media-gateway/schema';
import { GatewayError, type GatewayErrorCode } from '@/lib/media-gateway/types';
import { getRequestId } from '@/lib/request-id';

export const dynamic = 'force-dynamic';

const FORBIDDEN_FIELD = /^(?:_skipCredits|_skipCloudTaskPersistence|sourceChannel)$/i;
const SECRET_FIELD = /(?:api[_-]?key|authorization|secret|hash)/i;

function stableMessage(code: GatewayErrorCode): string {
  if (code === 'GATEWAY_DISABLED') return 'Media gateway is disabled';
  if (code === 'GATEWAY_AUTH_REQUIRED') return 'Gateway bearer authentication is required';
  if (code === 'GATEWAY_KEY_INVALID') return 'Gateway key is invalid';
  if (code === 'GATEWAY_RATE_LIMITED') return '请求过于频繁，请稍后重试';
  if (code === 'GATEWAY_DAILY_QUOTA_EXCEEDED') return 'Gateway daily quota exceeded';
  if (code === 'GATEWAY_IDEMPOTENCY_REQUIRED') return 'Idempotency-Key is required';
  if (code === 'GATEWAY_IDEMPOTENCY_CONFLICT') return 'Idempotency key conflicts with another request';
  if (code === 'GATEWAY_BODY_TOO_LARGE') return 'Gateway request body is too large';
  if (code === 'GATEWAY_INVALID_REQUEST') return 'Invalid gateway request';
  return 'Media gateway is unavailable';
}

function errorResponse(
  requestId: string,
  code: GatewayErrorCode,
  status: number,
  retryable = false,
): NextResponse {
  return NextResponse.json({
    success: false, code, message: stableMessage(code), requestId, retryable,
  }, { status });
}

function assertSafeExternalBody(value: unknown, ancestors = new Set<object>()): void {
  if (!value || typeof value !== 'object') return;
  if (ancestors.has(value)) throw new GatewayError('GATEWAY_INVALID_REQUEST', 400, 'Invalid body');
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeExternalBody(entry, ancestors);
  } else {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_FIELD.test(key) || SECRET_FIELD.test(key)) {
        throw new GatewayError('GATEWAY_INVALID_REQUEST', 400, 'Forbidden field');
      }
      assertSafeExternalBody(entry, ancestors);
    }
  }
  ancestors.delete(value);
}

function successResponse(
  requestId: string,
  gatewayRequestId: string,
  taskIds: string[],
  status: string,
): NextResponse {
  return NextResponse.json({
    success: true,
    requestId,
    gatewayRequestId,
    taskId: taskIds[0],
    taskIds,
    status,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  if (process.env.GATEWAY_ENABLED !== 'true') {
    return errorResponse(requestId, 'GATEWAY_DISABLED', 503);
  }

  try {
    const authorization = request.headers.get('authorization');
    if (!authorization) {
      throw new GatewayError('GATEWAY_AUTH_REQUIRED', 401, 'Authentication required');
    }
    const principal = await authenticateGatewayBearer(authorization);
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
    if (!idempotencyKey) {
      throw new GatewayError('GATEWAY_IDEMPOTENCY_REQUIRED', 400, 'Idempotency required');
    }
    const rawBody = await readGatewayJson(request);
    assertSafeExternalBody(rawBody);
    const input = normalizeGatewayImageRequest(rawBody);
    const decision = await reserveGatewayRequest({
      principal,
      idempotencyKey,
      requestDigest: digestGatewayRequest(input),
      mediaType: 'image',
    });

    if (decision.kind === 'reuse') {
      if (decision.request.admissionStatus === 'admitted' && decision.request.taskIds.length > 0) {
        return successResponse(requestId, decision.request.id, decision.request.taskIds, 'queued');
      }
      if (decision.request.admissionStatus === 'rejected') {
        return errorResponse(requestId, 'GATEWAY_INVALID_REQUEST', 400);
      }
      return errorResponse(requestId, 'GATEWAY_INTERNAL_UNAVAILABLE', 503, true);
    }

    const submission = await submitGatewayImage({
      principal, requestId, gatewayRequestId: decision.request.id, input,
    });
    if (submission.kind === 'rejected') {
      await markGatewayRejected({
        gatewayRequestId: decision.request.id,
        rejectionCode: submission.rejectionCode,
        outcome: 'explicit',
      });
      return errorResponse(requestId, submission.code, submission.status, submission.retryable);
    }
    await markGatewayAdmitted({
      gatewayRequestId: decision.request.id,
      taskIds: submission.taskIds,
    });
    return successResponse(
      requestId,
      decision.request.id,
      submission.taskIds,
      submission.status,
    );
  } catch (error) {
    if (error instanceof GatewayError) {
      return errorResponse(requestId, error.code, error.status, error.retryable);
    }
    return errorResponse(requestId, 'GATEWAY_INTERNAL_UNAVAILABLE', 503, true);
  }
}
