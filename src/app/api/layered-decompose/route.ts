import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  cancelLayerTask,
  getLayerTaskStatus,
  LayerServiceError,
  submitLayerDecomposition,
} from '@/lib/layer-decomposition/service';
import {
  LayerRequestValidationError,
  readLayerRequest,
  validateLayerIdempotencyKey,
} from '@/lib/layer-decomposition/validation';

function errorResponse(error: unknown): NextResponse {
  if (error instanceof LayerRequestValidationError || error instanceof LayerServiceError) {
    return NextResponse.json({
      success: false,
      code: error.code,
      message: error.message,
      retryable: error instanceof LayerServiceError ? error.retryable : false,
    }, { status: error.status });
  }
  console.error('[layered-decompose] Unhandled error:', error);
  return NextResponse.json({
    success: false,
    code: 'LAYER_INTERNAL_ERROR',
    message: '图片分层服务暂时不可用',
    retryable: true,
  }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const layerRequest = await readLayerRequest(request);
    const idempotencyKey = validateLayerIdempotencyKey(
      request.headers.get('idempotency-key'),
    );
    const result = await submitLayerDecomposition({
      userId: auth.userId,
      userRole: auth.userRole,
      idempotencyKey,
      request: layerRequest,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const taskId = request.nextUrl.searchParams.get('taskId')?.trim();
  if (!taskId) {
    return NextResponse.json({
      success: false,
      code: 'LAYER_TASK_ID_REQUIRED',
      message: '缺少图片分层任务 ID',
      retryable: false,
    }, { status: 400 });
  }
  try {
    return NextResponse.json(await getLayerTaskStatus({
      taskId,
      userId: auth.userId,
      userRole: auth.userRole,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const taskId = request.nextUrl.searchParams.get('taskId')?.trim();
  if (!taskId) {
    return NextResponse.json({
      success: false,
      code: 'LAYER_TASK_ID_REQUIRED',
      message: '缺少图片分层任务 ID',
      retryable: false,
    }, { status: 400 });
  }
  try {
    return NextResponse.json(await cancelLayerTask({
      taskId,
      userId: auth.userId,
      userRole: auth.userRole,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
