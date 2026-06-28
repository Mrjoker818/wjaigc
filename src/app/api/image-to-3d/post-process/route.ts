import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';

/**
 * 3D Model Post-Processing API
 * Supports Meshy Retexture and Remesh operations on existing 3D models
 * 
 * POST /api/image-to-3d/post-process
 * Body: {
 *   action: 'retexture' | 'remesh',
 *   taskId: string,          // Original Meshy task ID
 *   providerId?: string,
 *   model?: string,
 *   // Retexture params
 *   texturePrompt?: string,  // Text prompt for retexturing
 *   textureImageUrl?: string,// Reference image for retexturing
 *   enablePBR?: boolean,
 *   hdTexture?: boolean,
 *   removeLighting?: boolean,
 *   // Remesh params
 *   targetPolycount?: number,
 *   topology?: 'triangle' | 'quad',
 *   decimationMode?: 1 | 2 | 3 | 4,
 * }
 */

export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUser(request);
    const body = await request.json();

    const { action, taskId, providerId, model, ...params } = body;

    if (!action || !taskId) {
      return NextResponse.json(
        { success: false, error: 'Missing action or taskId' },
        { status: 400 }
      );
    }

    if (action !== 'retexture' && action !== 'remesh') {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Must be "retexture" or "remesh"' },
        { status: 400 }
      );
    }

    // Resolve provider
    const providers = await getApiProviders();
    let provider = providerId
      ? providers.find(p => p.id === providerId && p.isEnabled)
      : null;
    if (!provider && model) {
      provider = await findProviderForFeature('3d');
    }
    if (!provider) {
      return NextResponse.json(
        { success: false, error: 'No 3D provider found. Please configure a 3D provider in admin settings.' },
        { status: 400 }
      );
    }

    const baseUrl = normalizeApiBaseUrl(provider.baseUrl?.replace(/\/+$/, '') || '');
    if (!baseUrl || !provider.apiKey) {
      return NextResponse.json(
        { success: false, error: 'Provider misconfigured' },
        { status: 400 }
      );
    }

    // Check if provider is Meshy (only Meshy supports these post-processing APIs)
    if (!baseUrl.includes('meshy')) {
      return NextResponse.json(
        { success: false, error: 'Post-processing is currently only supported via Meshy provider' },
        { status: 400 }
      );
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    };

    let endpoint: string;
    let requestBody: Record<string, unknown>;

    if (action === 'retexture') {
      endpoint = '/openapi/v1/retexture';
      requestBody = {
        input_task_id: taskId,
        texture_prompt: params.texturePrompt || '',
        texture_image_url: params.textureImageUrl || undefined,
        enable_pbr: params.enablePBR ?? false,
        hd_texture: params.hdTexture ?? false,
        remove_lighting: params.removeLighting ?? true,
        ai_model: params.aiModel || 'meshy-6',
      };
      // Remove undefined fields
      Object.keys(requestBody).forEach(key => {
        if (requestBody[key] === undefined) delete requestBody[key];
      });
    } else {
      // remesh
      endpoint = '/openapi/v1/remesh';
      requestBody = {
        input_task_id: taskId,
        target_polycount: params.targetPolycount || 30000,
        topology: params.topology || 'triangle',
        decimation_mode: params.decimationMode || undefined,
      };
      Object.keys(requestBody).forEach(key => {
        if (requestBody[key] === undefined) delete requestBody[key];
      });
    }

    const url = `${baseUrl}${endpoint}`;
    console.log(`[3d-post-process] Submitting ${action} task:`, url);

    // Register task
    const postProcessTaskId = `3d-pp-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await registerTask(postProcessTaskId, action === 'retexture' ? '3d-retexture' : '3d-remesh', `3D ${action} task`, userId?.id || undefined);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`[3d-post-process] ${action} submit failed:`, response.status, errorText);
      await updateTaskProgress(postProcessTaskId, { status: 'failed', error: `${action} submit failed: ${response.status}` });
      return NextResponse.json({
        success: false,
        error: `${action} submit failed: ${response.status} - ${errorText.slice(0, 200)}`,
      }, { status: response.status });
    }

    const data = await response.json();
    const meshyTaskId = data.result || data.id;

    if (!meshyTaskId) {
      console.error('[3d-post-process] No task ID in response:', data);
      await updateTaskProgress(postProcessTaskId, { status: 'failed', error: 'No task ID returned' });
      return NextResponse.json({
        success: false,
        error: 'No task ID returned from provider',
      }, { status: 500 });
    }

    console.log(`[3d-post-process] ${action} task submitted:`, meshyTaskId);

    await updateTaskProgress(postProcessTaskId, {
      status: 'processing',
      progress: 0,
      label: `${action === 'retexture' ? '重贴图' : '减面'}处理中...`,
    });

    return NextResponse.json({
      success: true,
      taskId: postProcessTaskId,
      providerTaskId: meshyTaskId,
      provider: provider.name || 'Meshy',
      providerId: provider.id,
      action,
      message: `${action === 'retexture' ? '重贴图' : '减面'}任务已提交`,
      // Include provider info for polling
      pollInfo: {
        baseUrl,
        apiKey: provider.apiKey,
        providerId: provider.id,
        endpoint: action === 'retexture' ? `/openapi/v1/retexture/${meshyTaskId}` : `/openapi/v1/remesh/${meshyTaskId}`,
        isMeshy: true,
      },
    });
  } catch (error) {
    console.error('[3d-post-process] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Post-process failed',
    }, { status: 500 });
  }
}

/**
 * GET: Return available post-processing operations and capabilities
 */
export async function GET(request: NextRequest) {
  try {
    await getSessionUser(request);
    const providers = await getApiProviders();
    const meshyProviders = providers.filter(p =>
      p.isEnabled && (p.baseUrl?.includes('meshy') || p.modelType === '3d')
    );

    return NextResponse.json({
      success: true,
      operations: [
        {
          id: 'retexture',
          name: '重贴图',
          description: '使用新的纹理提示词或参考图重新生成3D模型贴图',
          params: {
            texturePrompt: { type: 'string', label: '贴图提示词', required: false },
            textureImageUrl: { type: 'string', label: '参考图URL', required: false },
            enablePBR: { type: 'boolean', label: 'PBR材质', default: false },
            hdTexture: { type: 'boolean', label: '4K高清纹理', default: false },
            removeLighting: { type: 'boolean', label: '移除光照', default: true },
          },
        },
        {
          id: 'remesh',
          name: '减面/重建网格',
          description: '减少3D模型面数或改变拓扑结构',
          params: {
            targetPolycount: { type: 'number', label: '目标面数', default: 30000, min: 100, max: 300000 },
            topology: { type: 'select', label: '拓扑结构', options: ['triangle', 'quad'], default: 'triangle' },
            decimationMode: {
              type: 'select', label: '减面模式', options: [
                { value: 1, label: '超高面数' },
                { value: 2, label: '高面数' },
                { value: 3, label: '中等面数' },
                { value: 4, label: '低面数' },
              ],
            },
          },
        },
      ],
      availableProviders: meshyProviders.length,
      meshyOnly: true,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get capabilities',
    }, { status: 500 });
  }
}
