import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { subscribeToTaskEvents, type TaskEvent } from '@/lib/task-registry';
import { getTaskEventTransport } from '@/lib/task-event-transport';
import { attachCanonicalGenerationSlotToEvent } from '@/lib/task-core/generation-batch';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest) {
  return NextResponse.json({
    success: false,
    error: 'SSE endpoint requires GET. Use EventSource to connect.',
  });
}

export function projectTaskEventPayload(
  event: TaskEvent,
): ReturnType<typeof attachCanonicalGenerationSlotToEvent<TaskEvent>> {
  return attachCanonicalGenerationSlotToEvent(event);
}

export async function GET(request: NextRequest): Promise<Response> {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof Response) return authResult;

  const currentUserId = authResult.userId;
  const transport = getTaskEventTransport();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', transport, timestamp: Date.now() })}\n\n`));
      } catch {
        return;
      }

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(':heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 25_000);
      const unsubscribe = subscribeToTaskEvents((event: TaskEvent) => {
        try {
          if (event.task?.userId !== currentUserId) return;
          const payload = projectTaskEventPayload(event);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe();
        }
      });

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The stream can already be closed by the browser.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
