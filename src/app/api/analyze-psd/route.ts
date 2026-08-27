import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { InsufficientCreditsError } from '@/lib/credits';
import {
  PsdAnalysisError,
  readPsdAnalysisRequest,
} from '@/lib/psd-analysis/contracts';
import { executePsdAnalysis } from '@/lib/psd-analysis/service';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';

export const runtime = 'nodejs';

interface ErrorIdentity {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
}

function errorIdentity(error: unknown): ErrorIdentity {
  if (error instanceof PsdAnalysisError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: error.retryable,
    };
  }
  if (error instanceof InsufficientCreditsError) {
    return {
      code: error.code,
      message: '积分不足，无法执行 PSD 分析',
      status: error.status,
      retryable: false,
    };
  }
  if (error instanceof IdempotencyConflictError) {
    return {
      code: error.code,
      message: '该幂等键已绑定到不同的 PSD 分析请求',
      status: error.status,
      retryable: false,
    };
  }
  return {
    code: 'PSD_ANALYSIS_INTERNAL_ERROR',
    message: 'PSD 分析服务暂时不可用',
    status: 500,
    retryable: false,
  };
}

function errorResponse(error: unknown, requestId: string): NextResponse {
  const identity = errorIdentity(error);
  if (identity.status >= 500) {
    console.error('[analyze-psd] request failed', {
      requestId,
      code: identity.code,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return NextResponse.json({
    success: false,
    code: identity.code,
    message: identity.message,
    requestId,
    retryable: identity.retryable,
  }, { status: identity.status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  const requestId = `req_${randomUUID()}`;
  if (auth.user.status === 'disabled' || auth.user.apiPermissions?.vlm === false) {
    return NextResponse.json({
      success: false,
      code: 'PSD_ANALYSIS_FORBIDDEN',
      message: '当前账号没有 PSD 视觉分析权限',
      requestId,
      retryable: false,
    }, { status: 403 });
  }

  try {
    const input = await readPsdAnalysisRequest(request);
    const result = await executePsdAnalysis({
      request: input,
      user: auth.user,
      requestId,
      requestSignal: request.signal,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
