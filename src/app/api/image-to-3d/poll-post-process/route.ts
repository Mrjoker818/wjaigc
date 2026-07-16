import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';

/**
 * Poll 3D Post-Processing Task Status
 * Used for polling Meshy Retexture/Remesh tasks
 * 
 * POST /api/image-to-3d/poll-post-process
 * Body: {
 *   taskId: string,           // Our internal task ID
 *   providerTaskId: string,   // Meshy task ID
 *   baseUrl: string,
 *   apiKey: string,
 *   endpoint: string,         // e.g. /openapi/v1/retexture/xxx
 *   action: 'retexture' | 'remesh',
 * }
 */

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const body = await request.json();
    const { taskId, providerTaskId, baseUrl, apiKey, endpoint, action } = body;

    if (!providerTaskId || !baseUrl || !apiKey || !endpoint) {
      return NextResponse.json({
        success: false,
        error: 'Missing required poll parameters',
        status: 'failed',
      }, { status: 400 });
    }

    const pollUrl = `${baseUrl}${endpoint}`;
    console.log(`[3d-poll-pp] Polling ${action} task:`, pollUrl);

    const response = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`[3d-poll-pp] Poll failed:`, response.status, errorText.slice(0, 200));
      return NextResponse.json({
        success: false,
        status: 'failed',
        error: `Poll failed: ${response.status}`,
        taskId,
        progress: 0,
      });
    }

    const data = await response.json();

    // Map Meshy status to our status
    const meshyStatus = data.status;
    let status: string;
    let progress = 0;

    switch (meshyStatus) {
      case 'SUCCEEDED':
        status = 'completed';
        progress = 100;
        break;
      case 'FAILED':
        status = 'failed';
        progress = data.progress || 0;
        break;
      case 'CANCELED':
        status = 'cancelled';
        progress = 0;
        break;
      case 'IN_PROGRESS':
        status = 'processing';
        progress = data.progress || 50;
        break;
      case 'PENDING':
      default:
        status = 'processing';
        progress = data.progress || 0;
        break;
    }

    // Build result for completed tasks
    let result: Record<string, unknown> | undefined;
    if (status === 'completed') {
      result = {
        modelUrls: data.model_urls || {},
        thumbnailUrl: data.thumbnail_url || '',
        thumbnailUrls: data.thumbnail_urls || {},
        textureUrls: data.texture_urls || [],
        action,
        providerTaskId,
      };
    }

    // Task error
    const taskError = data.task_error?.message || '';

    return NextResponse.json({
      success: status !== 'failed',
      status,
      progress,
      taskId,
      providerTaskId,
      action,
      label: status === 'completed'
        ? `${action === 'retexture' ? '重贴图' : '减面'}完成`
        : `${action === 'retexture' ? '重贴图' : '减面'}处理中... ${progress}%`,
      result,
      error: taskError || (status === 'failed' ? `${action} task failed` : ''),
      rawData: data,
    });
  } catch (error) {
    console.error('[3d-poll-pp] Fatal error:', error);
    return NextResponse.json({
      success: false,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Poll failed',
      progress: 0,
    }, { status: 500 });
  }
}
