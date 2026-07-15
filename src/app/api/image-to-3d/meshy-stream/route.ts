import { NextRequest } from 'next/server';
import { findProviderForModel, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';

/**
 * Meshy SSE Stream Proxy
 * Proxies Meshy's native SSE stream to the frontend for real-time 3D task progress
 * Endpoint: GET /api/image-to-3d/meshy-stream?taskId=xxx&providerId=xxx&mode=single-image|multi-image|text-to-3d
 */

export const dynamic = 'force-dynamic';

interface StreamRequest {
  taskId: string;
  mode?: 'single-image' | 'multi-image' | 'text-to-3d';
  providerId?: string;
  model?: string;
}

function splitProviderSelection(selection?: string): { providerId?: string; model?: string } {
  if (!selection) return {};
  if (selection.startsWith('admin-3d::')) {
    const parts = selection.split('::');
    return {
      providerId: parts[1] || undefined,
      model: parts.slice(2).join('::').trim() || undefined,
    };
  }
  const [providerId, ...modelParts] = selection.split('::');
  return { providerId: providerId || undefined, model: modelParts.join('::').trim() || undefined };
}

export async function GET(request: NextRequest) {
  try {
    // Verify session
    await getSessionUser(request);

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');
    const mode = (searchParams.get('mode') as StreamRequest['mode']) || 'single-image';
    const providerId = searchParams.get('providerId') || undefined;
    const selected = splitProviderSelection(providerId);
    const model = searchParams.get('model') || selected.model || '';

    if (!taskId) {
      return new Response('Missing taskId', { status: 400 });
    }

    // Resolve provider
    const providers = await getApiProviders();
    let provider = selected.providerId
      ? providers.find(p => p.id === selected.providerId && p.isEnabled)
      : null;
    if (!provider && model) {
      provider = await findProviderForModel(model, '3d');
    }
    if (!provider) {
      return new Response('No 3D provider found', { status: 400 });
    }

    const baseUrl = normalizeApiBaseUrl(provider.baseUrl?.replace(/\/+$/, '') || '');
    if (!baseUrl || !provider.apiKey) {
      return new Response('Provider misconfigured', { status: 400 });
    }

    // Build Meshy SSE stream URL based on mode
    let streamPath: string;
    if (mode === 'text-to-3d') {
      streamPath = `/text-to-3d/${taskId}/stream`;
    } else if (mode === 'multi-image') {
      streamPath = `/multi-image-to-3d/${taskId}/stream`;
    } else {
      streamPath = `/image-to-3d/${taskId}/stream`;
    }

    const streamUrl = `${baseUrl}${streamPath}`;
    console.log('[meshy-stream] Connecting to:', streamUrl, 'for task:', taskId);

    // Fetch the SSE stream from Meshy
    const upstreamResponse = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Accept': 'text/event-stream',
      },
    });

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text().catch(() => '');
      console.error('[meshy-stream] Upstream error:', upstreamResponse.status, errorText.slice(0, 200));
      return new Response(`Upstream error: ${upstreamResponse.status}`, { status: upstreamResponse.status });
    }

    if (!upstreamResponse.body) {
      return new Response('No upstream body', { status: 502 });
    }

    // Proxy the SSE stream to the client
    const encoder = new TextEncoder();
    const reader = upstreamResponse.body.getReader();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // Send a completion event
              controller.enqueue(encoder.encode('event: done\ndata: {"status":"stream_ended"}\n\n'));
              controller.close();
              break;
            }
            // Forward the chunk as-is (already in SSE format from Meshy)
            controller.enqueue(value);
          }
        } catch (err) {
          console.error('[meshy-stream] Stream error:', err);
          try {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Stream error' })}\n\n`));
          } catch { /* ignore */ }
          controller.close();
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[meshy-stream] Fatal error:', error);
    return new Response(
      error instanceof Error ? error.message : 'Stream proxy failed',
      { status: 500 }
    );
  }
}
