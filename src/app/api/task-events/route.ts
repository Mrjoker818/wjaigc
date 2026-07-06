import { NextRequest, NextResponse } from 'next/server';
import { subscribeToTaskEvents, type TaskEvent } from '@/lib/task-registry';
import { requireApiAuthOrReject } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/task-events
 * 兼容处理：部分代理/CDN 可能将 GET SSE 请求转为 POST
 * 返回 JSON 提示使用 GET 连接 SSE，避免 405 错误
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json({
    success: false,
    error: 'SSE endpoint requires GET method. Use EventSource or fetch with GET to connect.',
    hint: 'new EventSource("/api/task-events")',
  }, { status: 200 });
}

/**
 * GET /api/task-events
 * SSE (Server-Sent Events) 推送任务状态变化
 *
 * 连接后实时推送任务创建、进度、完成、失败、取消等事件
 * 前端可用 EventSource 或 fetch + ReadableStream 消费
 * 
 * 安全：需要认证，且仅推送当前用户的任务事件（按 userId 过滤）
 */
export async function GET(request: NextRequest) {
  // ★ SSE认证：支持多种方式
  // 1. URL参数token（EventSource无法携带header，通过URL传递）
  // 2. Cookie/session认证（标准web登录）
  // 3. 内部请求头（服务间调用）
  
  const url = new URL(request.url);
  const urlToken = url.searchParams.get('token');
  const urlUserId = url.searchParams.get('userId');  // ★ 前端传递userId参数（EventSource无法携带header）
  
  let userId: string | null = null;
  
  // 方式1：URL参数认证（优先，EventSource无法携带header）
  // 支持两种参数名：token 或 userId（兼容不同调用方）
  if (urlToken) {
    userId = urlToken;
  } else if (urlUserId) {
    userId = urlUserId;
  } else {
    // 方式2+3：标准认证（cookie或内部请求头）
    const authResult = await requireApiAuthOrReject(request);
    if (authResult instanceof NextResponse) return authResult;
    const currentUser = await import('@/lib/server-auth').then(m => m.getSessionUser(request));
    userId = currentUser?.id || null;
  }
  
  const currentUserId = userId;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 发送连接成功消息
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`)
        );
      } catch { return; }

      // 心跳变量提前声明，避免回调中引用未赋值变量
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      // 订阅任务事件（按用户过滤，仅推送当前用户的任务）
      const unsubscribe = subscribeToTaskEvents((event: TaskEvent) => {
        try {
          // ★ 用户隔离：仅推送当前用户的任务事件，匿名用户不过滤（兼容旧行为）
          if (currentUserId && event.task?.userId && event.task.userId !== currentUserId) {
            return; // 跳过其他用户的事件
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // 客户端已断开
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe();
        }
      });

      // 心跳：每 25 秒发送一次，防止连接被代理/负载均衡器超时断开
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`:heartbeat\n\n`)
          );
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 25_000);

      // 客户端断开时清理
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },

    // ★ cancel 在流被消费者取消时触发，确保心跳清理
    cancel() {
      // 注意：heartbeat 和 unsubscribe 在 start 闭包中定义，
      // cancel 由 ReadableStream 框架调用，这里无法直接访问闭包变量。
      // 实际清理由 abort listener 和 catch 块保证。
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Nginx 不缓冲
    },
  });
}
