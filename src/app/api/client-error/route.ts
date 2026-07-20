/**
 * POST /api/client-error — 客户端错误上报
 * 接收前端 window.onerror / unhandledrejection 的错误信息
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

// 简单的内存限流：每分钟最多 50 条
let errorCount = 0;
let resetTime = Date.now() + 60_000;
const MAX_ERRORS_PER_MINUTE = 50;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 限流检查
  const now = Date.now();
  if (now > resetTime) {
    errorCount = 0;
    resetTime = now + 60_000;
  }
  if (errorCount >= MAX_ERRORS_PER_MINUTE) {
    return NextResponse.json({ success: false, message: 'Rate limited' }, { status: 429 });
  }
  errorCount++;

  try {
    const body = await request.json();
    const requestId = `req_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

    // 脱敏：不记录用户隐私数据
    const sanitized = {
      requestId,
      type: body.type || 'error',
      message: String(body.message || '').slice(0, 500),
      stack: String(body.stack || '').slice(0, 2000),
      url: body.url,
      line: body.line,
      column: body.column,
      path: body.path,
      timestamp: body.timestamp || new Date().toISOString(),
      environment: process.env.COZE_PROJECT_ENV || 'unknown',
      userAgent: String(body.userAgent || '').slice(0, 200),
    };

    // 输出到服务端日志（可由日志收集器捕获）
    console.error('[CLIENT-ERROR]', JSON.stringify(sanitized));

    return NextResponse.json({ success: true, requestId });
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid error report' }, { status: 400 });
  }
}
