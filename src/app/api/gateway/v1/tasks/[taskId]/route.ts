import { NextRequest, NextResponse } from 'next/server';

import { recordGatewayAttempt } from '@/lib/media-gateway/admission';
import { auditGatewayEvent } from '@/lib/media-gateway/audit';
import {
  authenticateGatewayBearer,
  type GatewayPrincipal,
} from '@/lib/media-gateway/key-service';
import { getGatewayTaskProjection } from '@/lib/media-gateway/task-projection';
import { GatewayError, type GatewayErrorCode } from '@/lib/media-gateway/types';
import { getRequestId } from '@/lib/request-id';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

function stableMessage(code: GatewayErrorCode): string {
  if (code === 'GATEWAY_DISABLED') return 'Media gateway is disabled';
  if (code === 'GATEWAY_AUTH_REQUIRED') return 'Gateway bearer authentication is required';
  if (code === 'GATEWAY_KEY_INVALID') return 'Gateway key is invalid';
  if (code === 'GATEWAY_TASK_NOT_FOUND') return 'Gateway task was not found';
  if (code === 'GATEWAY_RATE_LIMITED') return '请求过于频繁，请稍后重试';
  return 'Media gateway is unavailable';
}

function errorResponse(
  requestId: string,
  code: GatewayErrorCode,
  status: number,
  retryable = false,
): NextResponse {
  return NextResponse.json({
    success: false,
    code,
    message: stableMessage(code),
    requestId,
    retryable,
  }, { status });
}

async function auditedResponse(
  response: NextResponse,
  requestId: string,
  principal?: GatewayPrincipal,
): Promise<NextResponse> {
  try {
    await auditGatewayEvent({
      action: 'gateway_task_query',
      outcome: response.status >= 200 && response.status < 300 ? 'success' : 'failure',
      requestId,
      ...(principal ? { gatewayKeyId: principal.keyId, userId: principal.userId } : {}),
      responseStatus: response.status,
    });
  } catch {
    // Audit storage is best-effort and cannot alter the authoritative response.
  }
  return response;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const requestId = getRequestId(request);
  if (process.env.GATEWAY_ENABLED !== 'true') {
    return errorResponse(requestId, 'GATEWAY_DISABLED', 503);
  }

  let principal: GatewayPrincipal | undefined;
  try {
    const authorization = request.headers.get('authorization');
    if (!authorization) {
      throw new GatewayError('GATEWAY_AUTH_REQUIRED', 401, 'Authentication required');
    }
    principal = await authenticateGatewayBearer(authorization);
    await recordGatewayAttempt(principal);
    const { taskId } = await context.params;
    const task = await getGatewayTaskProjection(principal, taskId);
    return auditedResponse(
      NextResponse.json({ success: true, requestId, ...task }),
      requestId,
      principal,
    );
  } catch (error) {
    if (error instanceof GatewayError) {
      return auditedResponse(
        errorResponse(requestId, error.code, error.status, error.retryable),
        requestId,
        principal,
      );
    }
    return auditedResponse(
      errorResponse(requestId, 'GATEWAY_INTERNAL_UNAVAILABLE', 503, true),
      requestId,
      principal,
    );
  }
}
