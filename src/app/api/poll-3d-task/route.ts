import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';

/**
 * Poll 3D task status API
 * For async 3D generation APIs (Hunyuan3D, Meshy, Tripo, etc.) that return task IDs
 */

interface PollRequest {
  taskId: string;
  version?: 'rapid' | 'pro'; // 混元3D: rapid=极速版, pro=专业版
  provider: {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    providerPreset?: string;
  };
}

type ProviderType = 'hunyuan3d' | 'meshy' | 'tripo' | 'rodin' | 'generic';

function detectProviderType(provider: PollRequest['provider']): ProviderType {
  const modelName = (provider.model || '').toLowerCase();
  const providerName = (provider.name || '').toLowerCase();
  const providerPreset = (provider.providerPreset || '').toLowerCase();
  const endpoint = (provider.baseUrl || '').toLowerCase();

  if (modelName.includes('hunyuan') || providerPreset.includes('hunyuan') || providerName.includes('hunyuan')) return 'hunyuan3d';
  if (providerPreset === 'meshy' || providerName.includes('meshy') || endpoint.includes('meshy')) return 'meshy';
  if (providerPreset === 'tripo' || providerName.includes('tripo') || endpoint.includes('tripo')) return 'tripo';
  if (providerPreset === 'rodin' || providerName.includes('rodin') || providerPreset === 'deemos' || providerName.includes('deemos')) return 'rodin';
  return 'generic';
}

interface PollConfig {
  endpoint: string;
  method: string;
  body?: Record<string, unknown>;
}

function buildPollConfig(request: PollRequest): PollConfig | undefined {
  const baseUrl = normalizeApiBaseUrl(request.provider.baseUrl?.replace(/\/+$/, '') || '');
  if (!baseUrl) return undefined;

  const providerType = detectProviderType(request.provider);

  switch (providerType) {
    case 'hunyuan3d': {
      const modelName = (request.provider.model || '').toLowerCase();
      const isRapid = modelName.includes('lite') || modelName.includes('rapid') || modelName.includes('quick') || modelName.includes('极速') || request.version === 'rapid';

      // 302.ai style polling - try both POST with body and GET with query param
      // 302.ai wraps Tencent's API; uses path parameter format for polling
      // Correct format: GET /tencent/hunyuan3d/rapid-job/{JobId}
      if (baseUrl.includes('302.ai') || baseUrl.includes('302ai')) {
        if (isRapid) {
          return {
            endpoint: `${baseUrl}/tencent/hunyuan3d/rapid-job/${request.taskId}`,
            method: 'GET',
          };
        }
        return {
          endpoint: `${baseUrl}/tencent/hunyuan3d/pro-job/${request.taskId}`,
          method: 'GET',
        };
      }
      // Generic hunyuan3d - try GET with path parameter
      const jobPath = isRapid ? 'rapid-job' : 'pro-job';
      return {
        endpoint: `${baseUrl}/hunyuan3d/${jobPath}/${request.taskId}`,
        method: 'GET',
      };
    }

    case 'meshy':
      return {
        endpoint: `${baseUrl}/image-to-3d/${request.taskId}`,
        method: 'GET',
      };

    case 'tripo':
      return {
        endpoint: `${baseUrl.replace(/\/v\d+$/, '')}/v2/openapi/task/${request.taskId}`,
        method: 'GET',
      };

    case 'rodin':
      return {
        endpoint: `${baseUrl.replace(/\/v\d+$/, '')}/api/generation/status/${request.taskId}`,
        method: 'GET',
      };

    default:
      return {
        endpoint: `${baseUrl}/tasks/${request.taskId}`,
        method: 'GET',
      };
  }
}

function splitProviderSelection(selection?: string): { providerId?: string; model?: string } {
  if (!selection) return {};

  // Handle admin-3d::providerId::modelId format
  if (selection.startsWith('admin-3d::')) {
    const parts = selection.split('::');
    if (parts.length >= 3) {
      return {
        providerId: parts[1] || undefined,
        model: parts.slice(2).join('::').trim() || undefined,
      };
    }
    if (parts.length === 2) {
      return { model: parts[1].trim() || undefined };
    }
    return {};
  }

  const [providerId, ...modelParts] = selection.split('::');
  const model = modelParts.join('::').trim();
  return {
    providerId: providerId || undefined,
    model: model || undefined,
  };
}

async function resolvePollRequest(body: PollRequest & { providerId?: string }): Promise<PollRequest | null> {
  const selection = splitProviderSelection(body.providerId || body.provider?.id);
  const selectedModel = body.provider?.model || selection.model;
  const providers = await getApiProviders();
  const byId = selection.providerId ? providers.find(item => item.id === selection.providerId && item.isEnabled) : null;
  const byModel = !byId && selectedModel ? await findProviderForModel(selectedModel, '3d') : null;
  const provider = byId || byModel;
  if (!provider) return null;

  return {
    ...body,
    provider: {
      id: provider.id,
      name: provider.displayName || provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: selectedModel || provider.selectedModel || provider.selectedModels?.[0],
      providerPreset: provider.providerPreset || body.provider?.providerPreset,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await resolvePollRequest(await request.json() as PollRequest & { providerId?: string });
    // Verify session (getSessionUser throws on unauthenticated)
    await getSessionUser(request);
    if (!body) {
      return NextResponse.json({ success: false, error: '请先在管理员系统配置可用的 3D 模型' }, { status: 400 });
    }
    if (!body.taskId || !body.provider?.baseUrl) {
      return NextResponse.json({ success: false, error: 'Missing taskId or provider info' }, { status: 400 });
    }
    if (!body.provider.apiKey) {
      return NextResponse.json({ success: false, error: '请先在管理员系统配置可用的 3D 模型' }, { status: 400 });
    }

    const config = buildPollConfig(body);
    if (!config) {
      return NextResponse.json({ success: false, error: 'Could not build poll config' }, { status: 400 });
    }

    console.log('[poll-3d-task] Polling:', config.endpoint, 'method:', config.method, 'for task:', body.taskId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (body.provider.apiKey) {
      headers['Authorization'] = `Bearer ${body.provider.apiKey}`;
    }

    const fetchOptions: RequestInit = {
      method: config.method,
      headers,
    };
    if (config.body && config.method === 'POST') {
      fetchOptions.body = JSON.stringify(config.body);
    }

    const response = await fetch(config.endpoint, fetchOptions);
    console.log('[poll-3d-task] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[poll-3d-task] Error:', response.status, errorText.slice(0, 500));
      return NextResponse.json({
        success: false,
        status: 'error',
        error: `Poll failed: ${response.status}`,
      });
    }

    const data = await response.json();
    console.log('[poll-3d-task] Response:', JSON.stringify(data).slice(0, 1500));

    const providerType = detectProviderType(body.provider);

    // Parse response based on provider type
    let status = 'pending';
    let assetUrl: string | undefined;
    let previewImageUrl: string | undefined;
    let modelUrls: Record<string, string> | undefined;

    if (providerType === 'hunyuan3d') {
      // 302.ai / Tencent Hunyuan3D response is nested under Response key
      // Format: { Response: { Status: "DONE"|"WAIT"|"RUN"|"FAIL", ResultFile3Ds: [...], ... } }
      const resp = (data.Response || data) as Record<string, unknown>;
      const statusCode = (resp.Status || resp.StatusCode || resp.status_code || resp.status) as string | undefined;

      console.log('[poll-3d-task] Hunyuan3D status:', statusCode, 'resp keys:', Object.keys(resp));

      if (statusCode === 'DONE' || statusCode === 'Succeeded' || statusCode === 'succeeded' || statusCode === 'completed') {
        status = 'succeeded';
        // Extract from ResultFile3Ds array (302.ai format)
        const resultFiles = resp.ResultFile3Ds as Array<Record<string, string>> | undefined;
        if (resultFiles && Array.isArray(resultFiles) && resultFiles.length > 0) {
          const firstFile = resultFiles[0];
          previewImageUrl = firstFile.PreviewImageUrl || firstFile.previewImageUrl;
          const fileUrl = firstFile.Url || firstFile.url;
          if (fileUrl) {
            assetUrl = fileUrl;
            modelUrls = {};
            // Map each result file by type
            for (const file of resultFiles) {
              const type = (file.Type || 'unknown').toLowerCase();
              modelUrls[type] = file.Url || file.url;
              // Also capture preview from first file
              if (!previewImageUrl) previewImageUrl = file.PreviewImageUrl || file.previewImageUrl;
            }
          }
        }
        // Fallback: direct URL fields (non-302.ai format)
        if (!assetUrl) {
          assetUrl = (resp.ModelUrl || resp.GlbUrl || resp.ObjUrl) as string | undefined;
          previewImageUrl = (resp.ThumbnailUrl || resp.PreviewUrl || resp.CoverUrl) as string | undefined;
          modelUrls = {};
          if (resp.ModelUrl) modelUrls.glb = resp.ModelUrl as string;
          if (resp.ObjUrl) modelUrls.obj = resp.ObjUrl as string;
          if (resp.MtlUrl) modelUrls.mtl = resp.MtlUrl as string;
          if (resp.TextureUrl) modelUrls.texture = resp.TextureUrl as string;
          if (resp.GlbUrl) modelUrls.glb = resp.GlbUrl as string;
        }
      } else if (statusCode === 'FAIL' || statusCode === 'Failed' || statusCode === 'failed' || statusCode === 'error') {
        status = 'failed';
        const errorMsg = (resp.ErrorMessage || resp.error_message || resp.message) as string | undefined;
        const errorCode = (resp.ErrorCode || resp.error_code || resp.code) as string | undefined;
        console.error('[poll-3d-task] Hunyuan3D task failed:', errorCode, errorMsg);
      } else {
        // WAIT or RUN → still processing
        status = 'running';
      }
    } else {
      // Generic parsing
      const taskStatus = (data.status || data.StatusCode || data.state) as string | undefined;
      if (taskStatus === 'succeeded' || taskStatus === 'completed' || taskStatus === 'done') {
        status = 'succeeded';
        const inner = (data.data || data.result || data) as Record<string, unknown>;
        assetUrl = (inner.model_url || inner.glb_url || inner.obj_url || inner.assetUrl || inner.url) as string | undefined;
        previewImageUrl = (inner.preview_url || inner.thumbnail_url || inner.previewImageUrl) as string | undefined;
      } else if (taskStatus === 'failed' || taskStatus === 'error') {
        status = 'failed';
      } else {
        status = 'running';
      }
    }

    return NextResponse.json({
      success: true,
      taskId: body.taskId,
      status,
      assetUrl,
      previewImageUrl,
      modelUrls,
      rawData: data,
    });
  } catch (error) {
    console.error('[poll-3d-task] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Poll task failed',
    }, { status: 500 });
  }
}
