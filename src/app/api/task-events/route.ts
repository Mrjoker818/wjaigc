import { NextRequest, NextResponse } from 'next/server';
import { subscribeToTaskEvents, type TaskEvent } from '@/lib/task-registry';

export const dynamic = 'force-dynamic';

/**
 * POST /api/task-events
 * 兼容处理：部分代理/CDN 可能将 GET SSE 请求转为 POST
 * 返回 JSON 提示使用 GET 连接 SSE，避免 405 错误
 */
export async function POST() {
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
 * 事件格式（SSE data 行）：
 *   { type: 'created'|'updated'|'completed'|'failed'|'cancelled'|'progress'|'queued', taskId: string, task: TaskInfo }
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 发送连接成功消息
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`)
        );
      } catch { return; }

      // 订阅任务事件
      const unsubscribe = subscribeToTaskEvents((event: TaskEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // 客户端已断开
          clearInterval(heartbeat);
          unsubscribe();
        }
      });

      // 心跳：每 25 秒发送一次，防止连接被代理/负载均衡器超时断开
      const heartbeat = setInterval(() => {
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
