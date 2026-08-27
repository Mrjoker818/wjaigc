import { randomUUID } from 'node:crypto';

import { after, NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { InsufficientCreditsError } from '@/lib/credits';
import {
  PsdAnalysisError,
  PSD_ANALYSIS_DEADLINE_MS,
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
  taskId?: string;
}

function errorIdentity(error: unknown): ErrorIdentity {
  if (error instanceof PsdAnalysisError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: error.retryable,
      ...(error.taskId ? { taskId: error.taskId } : {}),
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
    ...(identity.taskId ? { taskId: identity.taskId } : {}),
  }, { status: identity.status });
}

function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  const aborted = () => signal.reason instanceof PsdAnalysisError
    ? signal.reason
    : new PsdAnalysisError(
        'PSD_ANALYSIS_CANCELLED',
        'PSD 分析请求已取消',
        499,
        false,
        { cause: signal.reason },
      );
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = `req_${randomUUID()}`;
  const deadlineAt = Date.now() + PSD_ANALYSIS_DEADLINE_MS;
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort(new PsdAnalysisError(
      'PSD_ANALYSIS_TIMEOUT',
      'PSD 分析超过 45 秒总截止时间',
      504,
      true,
    ));
  }, PSD_ANALYSIS_DEADLINE_MS);
  const abortFromCaller = () => {
    if (!deadline.signal.aborted) deadline.abort(request.signal.reason);
  };
  request.signal.addEventListener('abort', abortFromCaller, { once: true });
  if (request.signal.aborted) abortFromCaller();

  try {
    const auth = await awaitWithSignal(requireApiAuthOrReject(request), deadline.signal);
    if (auth instanceof NextResponse) {
      return NextResponse.json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: '请先登录后再执行 PSD 分析',
        requestId,
        retryable: false,
      }, { status: auth.status });
    }
    if (auth.user.status === 'disabled' || auth.user.apiPermissions?.vlm === false) {
      return NextResponse.json({
        success: false,
        code: 'PSD_ANALYSIS_FORBIDDEN',
        message: '当前账号没有 PSD 视觉分析权限',
        requestId,
        retryable: false,
      }, { status: 403 });
    }

    const input = await readPsdAnalysisRequest(request, deadline.signal);
    const result = await executePsdAnalysis({
      request: input,
      user: auth.user,
      requestId,
      scheduleBackground: work => after(work),
      requestSignal: deadline.signal,
      deadlineAt,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return errorResponse(error, requestId);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abortFromCaller);
  }
}
