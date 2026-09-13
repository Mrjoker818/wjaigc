import { NextRequest, NextResponse } from 'next/server';

import { recordGatewayAttempt } from '@/lib/media-gateway/admission';
import { authenticateGatewayBearer } from '@/lib/media-gateway/key-service';
import { cancelGatewayTask } from '@/lib/media-gateway/task-projection';
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

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
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
    await recordGatewayAttempt(principal);
    const { taskId } = await context.params;
    const cancellation = await cancelGatewayTask(principal, taskId);
    if (cancellation.kind === 'conflict') {
      return NextResponse.json({
        success: false,
        code: 'GATEWAY_INVALID_REQUEST',
        message: 'Task cannot be cancelled',
        requestId,
        retryable: false,
        status: cancellation.status,
      }, { status: 409 });
    }
    return NextResponse.json({ success: true, requestId, ...cancellation.task });
  } catch (error) {
    if (error instanceof GatewayError) {
      return errorResponse(requestId, error.code, error.status, error.retryable);
    }
    return errorResponse(requestId, 'GATEWAY_INTERNAL_UNAVAILABLE', 503, true);
  }
}
