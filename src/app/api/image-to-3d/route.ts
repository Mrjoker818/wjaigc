import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';

/**
 * Image-to-3D API route
 * Supports multiple 3D API providers with proper request/response format adaptation
 */

interface ThreeDProvider {
  id?: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  providerPreset?: string;
  advancedParams?: Record<string, unknown>;
}

interface Local3DConfig {
  endpoint?: string;
  model?: string;
}

interface ImageTo3DRequest {
  imageUrl: string;
  backend: 'api' | 'local';
  type: string;
  quality: string;
  texture: string;
  format: string;
  version?: 'rapid' | 'pro'; // 混元3D: rapid=极速版, pro=专业版
  providerId?: string;
  provider?: ThreeDProvider;
  local?: Local3DConfig;
}

// ==================== Image URL to Base64 Helper ====================

async function imageUrlToBase64(imageUrl: string): Promise<string | null> {
  try {
    // If already a base64 data URL, extract the base64 part
    if (imageUrl.startsWith('data:')) {
      const base64Match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (base64Match) return base64Match[1];
    }

    // Fetch the image and convert to base64
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000), // 15s timeout
    });
    if (!response.ok) {
      console.warn('[image-to-3d] Failed to fetch image for base64 conversion:', response.status);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString('base64');
  } catch (err) {
    console.warn('[image-to-3d] Could not convert image URL to base64:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ==================== Provider Detection ====================

type ProviderType = 'hunyuan3d' | 'meshy' | 'tripo' | 'rodin' | 'generic';

function detectProviderType(request: ImageTo3DRequest): ProviderType {
  const modelName = (request.provider?.model || '').toLowerCase();
  const providerName = (request.provider?.name || '').toLowerCase();
  const providerPreset = (request.provider?.providerPreset || '').toLowerCase();
  const endpoint = (request.provider?.baseUrl || '').toLowerCase();

  // Hunyuan3D - detect by model name containing "hunyuan" or provider preset
  if (modelName.includes('hunyuan') || providerPreset.includes('hunyuan') || providerName.includes('hunyuan')) {
    return 'hunyuan3d';
  }

  // Meshy AI
  if (providerPreset === 'meshy' || providerName.includes('meshy') || endpoint.includes('meshy')) {
    return 'meshy';
  }

  // Tripo
  if (providerPreset === 'tripo' || providerName.includes('tripo') || endpoint.includes('tripo')) {
    return 'tripo';
  }

  // Rodin / Deemos
  if (providerPreset === 'rodin' || providerName.includes('rodin') || providerPreset === 'deemos' || providerName.includes('deemos') || endpoint.includes('rodin') || endpoint.includes('deemos')) {
    return 'rodin';
  }

  return 'generic';
}

// ==================== Endpoint Builder ====================

function buildEndpoint(request: ImageTo3DRequest): string | undefined {
  if (request.backend === 'local') {
    return request.local?.endpoint;
  }

  const baseUrl = normalizeApiBaseUrl(request.provider?.baseUrl?.replace(/\/+$/, '') || '');
  if (!baseUrl) return undefined;

  const providerType = detectProviderType(request);
  const modelName = (request.provider?.model || '').toLowerCase();

  switch (providerType) {
    case 'hunyuan3d': {
      // Determine version from model name or version param
      // lite/rapid/极速 → rapid-job (极速版)
      // standard/pro/专业 → pro-job (专业版)
      const isRapid = modelName.includes('lite') || modelName.includes('rapid') || modelName.includes('quick') || modelName.includes('极速') || request.version === 'rapid';
      const effectiveJobPath = isRapid ? 'rapid-job' : 'pro-job';

      if (baseUrl.includes('302.ai') || baseUrl.includes('302ai')) {
        return `${baseUrl}/tencent/hunyuan3d/${effectiveJobPath}`;
      }
      if (baseUrl.includes('hunyuan')) {
        return `${baseUrl}/${effectiveJobPath}`;
      }
      // Generic: try /tencent/hunyuan3d/{jobPath}
      return `${baseUrl}/tencent/hunyuan3d/${effectiveJobPath}`;
    }

    case 'meshy':
      return `${baseUrl}/image-to-3d`;

    case 'tripo':
      return `${baseUrl.replace(/\/v1$/, '')}/v2/openapi/image2model`;

    case 'rodin':
      return `${baseUrl.replace(/\/v1$/, '')}/api/generation/generate`;

    case 'generic':
    default:
      // For generic OpenAI-compatible providers, check if model name suggests 3D
      if (modelName.includes('3d') || modelName.includes('mesh') || modelName.includes('obj')) {
        return `${baseUrl}/image-to-3d`;
      }
      // Fallback: try OpenAI images format (baseUrl already includes /v1)
      return `${baseUrl}/images/generations`;
  }
}

// ==================== Request Body Builders ====================

async function buildHunyuan3DBody(request: ImageTo3DRequest): Promise<Record<string, unknown>> {
  // Determine version: rapid=极速版, pro=专业版
  const modelName = (request.provider?.model || '').toLowerCase();
  const isRapid = modelName.includes('lite') || modelName.includes('rapid') || modelName.includes('quick') || modelName.includes('极速') || request.version === 'rapid';

  // 混元3D仅支持图生3D（Base64格式），不支持文生3D
  const base64Data = await imageUrlToBase64(request.imageUrl);
  if (!base64Data) {
    throw new Error('图片转Base64失败，无法调用混元3D API。请确保图片URL可访问。');
  }

  const body: Record<string, unknown> = { ImageBase64: base64Data };

  if (isRapid) {
    // 极速版 (rapid-job) parameters - no Model parameter
    if (request.quality === 'geometry' || request.quality === 'sketch') {
      body.EnableGeometry = true;
    }
    const rapidFormatMap: Record<string, string> = {
      'stl': 'STL',
      'usdz': 'USDZ',
      'fbx': 'FBX',
    };
    if (request.format && rapidFormatMap[request.format]) {
      body.ResultFormat = rapidFormatMap[request.format];
    }
    if (request.texture === 'pbr' || request.texture === '4k' || request.texture === '4096') {
      body.EnablePBR = true;
    }
  } else {
    // 专业版 (pro-job) parameters
    body.Model = '3.0';
    const qualityMap: Record<string, string> = {
      'low': 'LowPoly',
      'standard': 'Normal',
      'medium': 'Normal',
      'high': 'Normal',
      'ultra': 'Normal',
    };
    body.GenerateType = qualityMap[request.quality] || 'Normal';
    const proFormatMap: Record<string, string> = {
      'glb': 'GLB',
      'obj': 'OBJ',
    };
    if (request.format && proFormatMap[request.format]) {
      body.ResultFormat = proFormatMap[request.format];
    }
    if (request.texture === '4k' || request.texture === '4096') {
      body.EnablePBR = true;
    }
    const faceMap: Record<string, number> = {
      'low': 5000,
      'standard': 10000,
      'medium': 10000,
      'high': 20000,
      'ultra': 50000,
    };
    if (request.quality && faceMap[request.quality]) {
      body.FaceCount = faceMap[request.quality];
    }
  }

  return body;
}

function buildMeshyBody(request: ImageTo3DRequest): Record<string, unknown> {
  return {
    image_url: request.imageUrl,
    mode: 'image_to_3d',
    art_style: 'realistic',
    topology: request.quality === 'ultra' ? '0' : '1',
    target_poly_count: request.quality === 'ultra' ? 10000 : 3000,
    texture_resolution: request.texture === '4k' ? '4K' : '2K',
  };
}

function buildTripoBody(request: ImageTo3DRequest): Record<string, unknown> {
  return {
    file: { type: 'image', data: request.imageUrl },
    type: 'image_to_model',
    settings: {
      face_limit: request.quality === 'ultra' ? 20000 : 10000,
      texture_resolution: request.texture === '4k' ? 4096 : 2048,
      model_format: request.format,
    },
  };
}

function buildRodinBody(request: ImageTo3DRequest): Record<string, unknown> {
  return {
    image: request.imageUrl,
    format: request.format,
    quality: request.quality,
    texture_resolution: request.texture,
  };
}

function buildGenericBody(request: ImageTo3DRequest): Record<string, unknown> {
  return {
    image_url: request.imageUrl,
    model: request.provider?.model,
    type: request.type,
    quality: request.quality,
    texture: request.texture,
    format: request.format,
    advanced_params: request.provider?.advancedParams || {},
  };
}

async function buildRequestBody(request: ImageTo3DRequest): Promise<Record<string, unknown>> {
  if (request.backend === 'local') {
    return {
      image_url: request.imageUrl,
      model: request.local?.model,
      type: request.type,
      quality: request.quality,
      texture: request.texture,
      format: request.format,
    };
  }

  const providerType = detectProviderType(request);
  switch (providerType) {
    case 'hunyuan3d': return buildHunyuan3DBody(request);
    case 'meshy': return buildMeshyBody(request);
    case 'tripo': return buildTripoBody(request);
    case 'rodin': return buildRodinBody(request);
    default: return buildGenericBody(request);
  }
}

function splitProviderSelection(selection?: string): { providerId?: string; model?: string } {
  if (!selection) return {};
  const [providerId, ...modelParts] = selection.split('::');
  const model = modelParts.join('::').trim();
  return {
    providerId: providerId || undefined,
    model: model || undefined,
  };
}

async function resolveServerProvider(request: ImageTo3DRequest): Promise<ImageTo3DRequest> {
  if (request.backend !== 'api') return request;

  const selection = splitProviderSelection(request.providerId || request.provider?.id);
  const selectedModel = request.provider?.model || selection.model;
  const providers = await getApiProviders();
  const byId = selection.providerId ? providers.find(item => item.id === selection.providerId && item.isEnabled) : null;
  const byModel = !byId && selectedModel ? await findProviderForModel(selectedModel, '3d') : null;
  const provider = byId || byModel;
  if (!provider) return request;

  return {
    ...request,
    provider: {
      id: provider.id,
      name: provider.displayName || provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: selectedModel || provider.selectedModel || provider.selectedModels?.[0],
      providerPreset: provider.providerPreset || request.provider?.providerPreset,
      advancedParams: provider.advancedParams || request.provider?.advancedParams,
    },
  };
}

// ==================== Response Parsers ====================

interface Parsed3DResponse {
  assetUrl?: string;
  previewImageUrl?: string;
  taskId?: string;
  status?: string;
  modelUrls?: Record<string, string>;
}

function parseHunyuan3DResponse(data: Record<string, unknown>): Parsed3DResponse {
  // Hunyuan3D response format:
  // Initial submit: { Response: { JobId: "xxx", RequestId: "..." } }
  // Polled result: { Response: { JobId: "xxx", StatusCode: "Succeeded", ModelUrl: "...", ObjUrl: "...", MtlUrl: "..." } }
  const resp = (data.Response || data) as Record<string, unknown>;
  const jobId = (resp.JobId || resp.job_id || resp.taskId || resp.task_id) as string | undefined;
  const statusCode = (resp.StatusCode || resp.status_code || resp.status) as string | undefined;

  if (statusCode === 'Succeeded' || statusCode === 'succeeded' || statusCode === 'completed') {
    // Task completed - extract model URLs
    const modelUrls: Record<string, string> = {};
    if (resp.ModelUrl) modelUrls.glb = resp.ModelUrl as string;
    if (resp.ObjUrl) modelUrls.obj = resp.ObjUrl as string;
    if (resp.MtlUrl) modelUrls.mtl = resp.MtlUrl as string;
    if (resp.TextureUrl) modelUrls.texture = resp.TextureUrl as string;
    if (resp.GlbUrl) modelUrls.glb = resp.GlbUrl as string;

    return {
      assetUrl: (resp.ModelUrl || resp.GlbUrl || resp.ObjUrl) as string | undefined,
      previewImageUrl: (resp.ThumbnailUrl || resp.PreviewUrl || resp.CoverUrl) as string | undefined,
      taskId: jobId,
      status: 'succeeded',
      modelUrls,
    };
  }

  // Task still pending/running
  return {
    taskId: jobId,
    status: statusCode || 'pending',
    previewImageUrl: (resp.ThumbnailUrl || resp.PreviewUrl) as string | undefined,
  };
}

function parseMeshyResponse(data: Record<string, unknown>): Parsed3DResponse {
  return {
    taskId: (data.result || data.task_id || data.id) as string | undefined,
    status: (data.status || 'pending') as string,
    previewImageUrl: (data.thumbnail_url || data.preview_url) as string | undefined,
  };
}

function parseTripoResponse(data: Record<string, unknown>): Parsed3DResponse {
  const inner = (data.data || data) as Record<string, unknown>;
  return {
    taskId: (inner.task_id || inner.id) as string | undefined,
    status: (inner.status || data.code === 0 ? 'pending' : 'error') as string,
    previewImageUrl: (inner.preview_url || inner.thumbnail_url) as string | undefined,
  };
}

function parseRodinResponse(data: Record<string, unknown>): Parsed3DResponse {
  return {
    taskId: (data.task_id || data.id || data.uuid) as string | undefined,
    status: (data.status || 'pending') as string,
    assetUrl: (data.model_url || data.glb_url || data.obj_url) as string | undefined,
    previewImageUrl: (data.preview_url || data.thumbnail_url) as string | undefined,
  };
}

function parseGenericResponse(data: Record<string, unknown>): Parsed3DResponse {
  return {
    assetUrl: (data.assetUrl || data.modelUrl || data.glbUrl || data.url || data.model_url || data.glb_url) as string | undefined,
    previewImageUrl: (data.previewImageUrl || data.previewUrl || data.thumbnailUrl || data.preview_url || data.thumbnail_url) as string | undefined,
    taskId: (data.taskId || data.task_id || data.id || data.result || data.JobId) as string | undefined,
    status: (data.status || data.StatusCode) as string | undefined,
  };
}

function parseProviderResponse(data: Record<string, unknown>, request: ImageTo3DRequest): Parsed3DResponse {
  const providerType = detectProviderType(request);
  switch (providerType) {
    case 'hunyuan3d': return parseHunyuan3DResponse(data);
    case 'meshy': return parseMeshyResponse(data);
    case 'tripo': return parseTripoResponse(data);
    case 'rodin': return parseRodinResponse(data);
    default: return parseGenericResponse(data);
  }
}

// ==================== Placeholder / Preview Generators ====================

function typeLabel(type: string): string {
  const labels: Record<string, string> = { ip: 'IP Character', product: 'Product', scene: 'Scene', avatar: 'Avatar' };
  return labels[type] || '3D Model';
}

function buildPlaceholderAsset(request: ImageTo3DRequest): string {
  const gltf = {
    asset: { version: '2.0', generator: 'UnboundAI Placeholder' },
    scene: 0,
    materials: [{ name: 'placeholder', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.7, 0.2, 1] } }],
    meshes: [{ name: 'placeholder-mesh', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    accessors: [{ type: 'VEC3', componentType: 5126, count: 3, max: [1, 1, 1], min: [-1, -1, -1] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ uri: 'data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', byteLength: 36 }],
    extensions: {
      type: request.type,
      quality: request.quality,
      texture: request.texture,
      format: request.format,
      note: 'Connect a 3D API or local model service to replace this placeholder with a real mesh asset.',
    },
    scenes: [{ nodes: [0] }],
    nodes: [{ name: `${typeLabel(request.type)} Preview Node` }],
  };
  return `data:model/gltf+json;charset=utf-8,${encodeURIComponent(JSON.stringify(gltf, null, 2))}`;
}

function buildPreviewSvg(request: ImageTo3DRequest, note?: string): string {
  const label = typeLabel(request.type);
  const qualityLabel = request.quality.charAt(0).toUpperCase() + request.quality.slice(1);
  const formatLabel = request.format.toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#1a1a2e"/>
        <stop offset="100%" style="stop-color:#16213e"/>
      </linearGradient>
      <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#d4af37"/>
        <stop offset="100%" style="stop-color:#f4e18f"/>
      </linearGradient>
    </defs>
    <rect width="400" height="400" fill="url(#bg)" rx="12"/>
    <polygon points="200,60 340,180 300,340 100,340 60,180" fill="none" stroke="url(#gold)" stroke-width="2" opacity="0.8"/>
    <polygon points="200,80 320,185 285,325 115,325 80,185" fill="#0d0d0d" stroke="#d4af37" stroke-width="1" opacity="0.5"/>
    <text x="200" y="220" text-anchor="middle" fill="#d4af37" font-size="20" font-weight="bold">${label}</text>
    <text x="200" y="245" text-anchor="middle" fill="#aaa" font-size="11">API Model / ${formatLabel} / ${request.texture.toUpperCase()}</text>
    <text x="200" y="265" text-anchor="middle" fill="#888" font-size="10">${qualityLabel} mesh + balanced topology</text>
    <text x="200" y="310" text-anchor="middle" fill="#666" font-size="9">${note || 'Preview'}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ==================== Main External Request ====================

async function tryExternalRequest(request: ImageTo3DRequest): Promise<{
  assetUrl?: string;
  previewImageUrl?: string;
  taskId?: string;
  modelUrls?: Record<string, string>;
  note: string;
} | null> {
  const endpoint = buildEndpoint(request);
  if (!endpoint) {
    console.log('[image-to-3d] No endpoint configured for backend:', request.backend);
    return null;
  }

  const providerType = detectProviderType(request);
  const requestBody = await buildRequestBody(request);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout - 3D generation can be slow

  try {
    console.log('[image-to-3d] Provider type:', providerType, 'Endpoint:', endpoint, 'Model:', request.provider?.model, 'Version:', request.version || (request.provider?.model?.toLowerCase().includes('lite') ? 'rapid' : 'pro'));
    // Log request body size (don't log base64 data)
    const bodyStr = JSON.stringify(requestBody);
    const hasBase64 = bodyStr.includes('ImageBase64');
    console.log('[image-to-3d] Request body size:', bodyStr.length, 'bytes', hasBase64 ? '(contains base64 image data)' : '');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Build auth headers
    if (request.backend === 'api' && request.provider?.apiKey) {
      headers['Authorization'] = `Bearer ${request.provider.apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    console.log('[image-to-3d] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[image-to-3d] API error:', response.status, errorText.slice(0, 500));
      return null;
    }

    const data = await response.json();
    console.log('[image-to-3d] API response:', JSON.stringify(data).slice(0, 1500));

    const parsed = parseProviderResponse(data, request);
    console.log('[image-to-3d] Parsed:', JSON.stringify(parsed));

    // If we got an asset URL directly
    if (parsed.assetUrl) {
      return {
        assetUrl: parsed.assetUrl,
        previewImageUrl: parsed.previewImageUrl,
        modelUrls: parsed.modelUrls,
        note: '3D model generated successfully.',
      };
    }

    // If we got a task ID, it's an async task
    if (parsed.taskId) {
      return {
        taskId: parsed.taskId,
        previewImageUrl: parsed.previewImageUrl,
        note: `3D API accepted task (ID: ${parsed.taskId}). The model is being generated - this may take 30-120 seconds.`,
      };
    }

    console.warn('[image-to-3d] API returned 200 but no asset URL or task ID found');
    return null;
  } catch (err) {
    console.error('[image-to-3d] Request failed:', err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ==================== Route Handler ====================

export async function POST(request: NextRequest) {
  try {
    const body = await resolveServerProvider(await request.json() as ImageTo3DRequest);
    const sessionUser = await getSessionUser(request);
    if (!body.imageUrl) {
      return NextResponse.json({ success: false, error: 'Missing imageUrl' }, { status: 400 });
    }
    if (body.backend === 'api' && !body.provider?.apiKey) {
      return NextResponse.json({ success: false, error: '请先在管理员系统配置可用的 3D 模型' }, { status: 400 });
    }

    const providerType = detectProviderType(body);
    console.log('[image-to-3d] Request:', JSON.stringify({
      backend: body.backend,
      providerType,
      type: body.type,
      quality: body.quality,
      texture: body.texture,
      format: body.format,
      provider: body.provider ? { name: body.provider.name, baseUrl: body.provider.baseUrl, model: body.provider.model, preset: body.provider.providerPreset } : undefined,
      local: body.local,
    }));

    const external = await tryExternalRequest(body);
    if (external?.assetUrl || external?.taskId) {
      return NextResponse.json({
        success: true,
        backend: body.backend,
        assetUrl: external.assetUrl,
        taskId: external.taskId,
        // For async tasks (taskId exists but no assetUrl yet), don't return a placeholder SVG
        // The frontend will show a processing progress frame instead
        previewImageUrl: external.assetUrl ? (external.previewImageUrl || buildPreviewSvg(body, external.note)) : external.previewImageUrl,
        modelUrls: external.modelUrls,
        note: external.note,
      });
    }

    const note = body.backend === 'api'
      ? 'No live 3D API response yet; generated a configurable task preview.'
      : 'Local 3D endpoint is not running or not reachable; generated a local-model preview.';

    return NextResponse.json({
      success: true,
      backend: body.backend,
      assetUrl: buildPlaceholderAsset(body),
      previewImageUrl: buildPreviewSvg(body, note),
      note,
    });
  } catch (error) {
    console.error('[image-to-3d] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Image to 3D failed',
    }, { status: 500 });
  }
}
