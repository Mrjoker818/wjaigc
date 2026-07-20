/**
 * Request ID 中间件 — 为每个请求生成唯一 requestId 并贯穿前后端
 * 用法: 在 API 路由中 import { withRequestId } 或直接调用 getRequestId(request)
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 从请求中提取或生成 requestId
 */
export function getRequestId(request: NextRequest): string {
  // 优先使用客户端传入的 requestId（前端生成）
  const clientId = request.headers.get(REQUEST_ID_HEADER);
  if (clientId && /^[a-zA-Z0-9_-]{8,64}$/.test(clientId)) {
    return clientId;
  }
  // 服务端生成
  return `req_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

/**
 * 为响应添加 requestId header
 */
export function withRequestId<T extends NextResponse>(response: T, requestId: string): T {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/**
 * 创建带 requestId 的 JSON 错误响应（统一错误格式）
 */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  retryable = false,
  extra?: Record<string, unknown>,
): NextResponse {
  return withRequestId(
    NextResponse.json(
      {
        success: false,
        code,
        message,
        requestId,
        retryable,
        timestamp: new Date().toISOString(),
        ...extra,
      },
      { status },
    ),
    requestId,
  );
}

/**
 * 创建带 requestId 的 JSON 成功响应
 */
export function successResponse<T extends Record<string, unknown>>(
  data: T,
  requestId: string,
): NextResponse {
  return withRequestId(
    NextResponse.json({
      success: true,
      requestId,
      ...data,
    }),
    requestId,
  );
}
