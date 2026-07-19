import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { saveImageFile } from '@/lib/server-data-root';
import { validateApiInputs } from '@/lib/api-validator';

/**
 * Qwen-Image-Layered RGBA 图层分解 API
 *
 * 基于 https://github.com/QwenLM/Qwen-Image-Layered
 * 将图像分解为多个 RGBA 图层，实现固有的可编辑性：
 * - 每个图层可以独立操作，不影响其他内容
 * - 支持高保真基本操作：调整大小、重新定位、重新着色
 * - 通过将语义/结构组件物理隔离到不同图层中
 *
 * 支持两种模式:
 * 1. 外部 Qwen-Image-Layered 服务 (QWEN_LAYERED_ENDPOINT 环境变量)
 * 2. 管理员配置的分层模型 API (LAYERED_MODEL_API, 兼容现有 segment-elements)
 */

interface DecomposeRequest {
  imageUrl: string;
  layers?: number;
  resolution?: number;
  prompt?: string;
  negativePrompt?: string;
  numInferenceSteps?: number;
  trueCfgScale?: number;
  seed?: number;
  cfgNormalize?: boolean;
  useEnPrompt?: boolean;
  exportFormat?: 'psd' | 'zip' | 'both';
}

interface LayerInfo {
  id: number;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
}

interface DecomposeResult {
  success: boolean;
  layers: LayerInfo[];
  compositeUrl?: string;
  psdUrl?: string;
  zipUrl?: string;
  numLayers: number;
  elapsedSeconds?: number;
  error?: string;
}

/**
 * 通过外部 Qwen-Image-Layered 服务执行分解
 */
async function decomposeViaExternal(
  endpoint: string,
  req: DecomposeRequest,
): Promise<DecomposeResult> {
  const resp = await fetch(`${endpoint}/decompose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: req.imageUrl,
      layers: req.layers || 4,
      resolution: req.resolution || 640,
      prompt: req.prompt || '',
      negative_prompt: req.negativePrompt || ' ',
      num_inference_steps: req.numInferenceSteps || 50,
      true_cfg_scale: req.trueCfgScale || 4.0,
      seed: req.seed || 777,
      cfg_normalize: req.cfgNormalize ?? true,
      use_en_prompt: req.useEnPrompt ?? true,
      export_format: req.exportFormat || 'both',
    }),
    signal: AbortSignal.timeout(300000), // 5分钟超时
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`External service error: ${resp.status} - ${errText}`);
  }

  type ExternalLayer = { id: number; name: string; image_url: string; width: number; height: number };
  type ExternalResult = { success?: boolean; layers?: ExternalLayer[]; numLayers?: number; elapsedSeconds?: number; composite_url?: string; psd_url?: string; zip_url?: string; compositeUrl?: string; psdUrl?: string; zipUrl?: string };

  const result = await resp.json() as ExternalResult;

  // 转换字段名 (snake_case → camelCase)
  const layers: LayerInfo[] = (result.layers || []).map((l: ExternalLayer) => ({
    id: l.id,
    name: l.name,
    imageUrl: l.image_url?.startsWith('/')
      ? `${endpoint}${l.image_url}`
      : l.image_url || '',
    width: l.width,
    height: l.height,
  }));

  let compositeUrl = result.composite_url || result.compositeUrl;
  if (compositeUrl?.startsWith('/')) compositeUrl = `${endpoint}${compositeUrl}`;

  let psdUrl = result.psd_url || result.psdUrl;
  if (psdUrl?.startsWith('/')) psdUrl = `${endpoint}${psdUrl}`;

  let zipUrl = result.zip_url || result.zipUrl;
  if (zipUrl?.startsWith('/')) zipUrl = `${endpoint}${zipUrl}`;

  return {
    success: result.success ?? true,
    layers,
    compositeUrl,
    psdUrl,
    zipUrl,
    numLayers: result.numLayers || layers.length,
    elapsedSeconds: result.elapsedSeconds,
  };
}

/**
 * 通过管理员配置的 AI API 执行分层 (兼容模式)
 * 使用 segment-elements 风格的 API 调用
 */
async function decomposeViaAI(
  imageUrl: string,
  numLayers: number,
): Promise<DecomposeResult> {
  // 尝试使用管理员配置的分层模型
  const { findProviderForFeature } = await import('@/lib/server-api-config');
  const provider = await findProviderForFeature('layer');

  if (!provider) {
    throw new Error('未配置分层模型 API，请在管理员系统中添加图片分层模型，或配置 QWEN_LAYERED_ENDPOINT');
  }

  // Resolve local image URL to base64 for external API access
  let resolvedImageUrl = imageUrl;
  if (imageUrl.startsWith('/uploads/') || imageUrl.startsWith('/api/serve-upload/')) {
    const { getServerDataRoot } = await import('@/lib/server-data-root');
    const serverDataRoot = getServerDataRoot();
    const publicDir = path.join(process.cwd(), 'public');
    const filename = imageUrl.split('/').pop() || '';

    // Try public/uploads first, then dataRoot/uploads
    let localPath = path.join(publicDir, 'uploads', filename);
    if (!fs.existsSync(localPath)) {
      localPath = path.join(serverDataRoot, 'uploads', filename);
    }
    if (fs.existsSync(localPath)) {
      const buffer = await fs.promises.readFile(localPath);
      const base64 = buffer.toString('base64');
      resolvedImageUrl = `data:image/png;base64,${base64}`;
    }
  }

  // 使用 AI 图像生成 API 来生成分层结果
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${provider.apiKey}`,
    'Content-Type': 'application/json',
  };

  // 注入高级参数
  if (provider.advancedParams) {
    Object.entries(provider.advancedParams).forEach(([key, value]) => {
      if (key && value) {
        headers[key] = value;
      }
    });
  }

  // Try chat/completions format first (for qwen-image-layered models)
  const selectedModel = provider.selectedModels?.[0] || provider.discoveredModels?.[0] || '';
  
  // Try /images/edits endpoint with fetchWithV1Retry for /v1 compatibility
  const resp = await fetchWithV1Retry(baseUrl, '/images/edits', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: selectedModel,
      image: resolvedImageUrl,
      n: numLayers,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    throw new Error(`AI API error: ${resp.status}`);
  }

  const data = await resp.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const results = data.data || [];

  // 保存每个图层
  const taskPrefix = `layered_${Date.now()}`;
  const layerInfos: LayerInfo[] = [];

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const filename = `${taskPrefix}_layer_${i}.png`;

    let buffer: Buffer;
    if (item.b64_json) {
      buffer = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      const imgResp = await fetch(item.url, { signal: AbortSignal.timeout(30000) });
      buffer = Buffer.from(await imgResp.arrayBuffer());
    } else {
      continue;
    }

    const layerUrl = await saveImageFile(buffer, filename, 'layered');

    try {
      const meta = await sharp(buffer).metadata();
      layerInfos.push({
        id: i,
        name: `Layer ${i + 1}`,
        imageUrl: layerUrl,
        width: meta.width || 0,
        height: meta.height || 0,
      });
    } catch {
      layerInfos.push({
        id: i,
        name: `Layer ${i + 1}`,
        imageUrl: layerUrl,
        width: 0,
        height: 0,
      });
    }
  }

  return {
    success: true,
    layers: layerInfos,
    numLayers: layerInfos.length,
  };
}

// GET: 检查可用性
export async function GET() {
  const layeredEndpoint = process.env.QWEN_LAYERED_ENDPOINT || '';

  if (layeredEndpoint) {
    try {
      const resp = await fetch(`${layeredEndpoint}/health`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const health = await resp.json() as { pipeline_loaded?: boolean; device?: string; cuda_available?: boolean };
        return NextResponse.json({
          available: true,
          source: 'external',
          endpoint: layeredEndpoint,
          pipelineLoaded: health.pipeline_loaded,
          device: health.device,
        });
      }
    } catch { /* not reachable */ }
  }

  // 检查管理员配置的分层模型
  try {
    const { findProviderForFeature } = await import('@/lib/server-api-config');
    const provider = await findProviderForFeature('layer');
    if (provider) {
      return NextResponse.json({
        available: true,
        source: 'admin-api',
        provider: provider.name,
      });
    }
  } catch { /* no admin config */ }

  return NextResponse.json({
    available: false,
    source: null,
  });
}

// POST: 执行 RGBA 图层分解
export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json() as DecomposeRequest;
    // 输入校验
    const _validationError = validateApiInputs(body as unknown as Record<string, unknown>, {
        imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const {
      imageUrl,
      layers: numLayers = 4,
      resolution = 640,
      prompt = '',
      negativePrompt = ' ',
      numInferenceSteps = 50,
      trueCfgScale = 4.0,
      seed = 777,
      cfgNormalize = true,
      useEnPrompt = true,
      exportFormat = 'both',
    } = body;

    if (!imageUrl) {
      return NextResponse.json({ error: '缺少图片URL' } as { error: string }, { status: 400 });
    }

    // 优先使用外部 Qwen-Image-Layered 服务
    const layeredEndpoint = process.env.QWEN_LAYERED_ENDPOINT || '';
    if (layeredEndpoint) {
      try {
        const result = await decomposeViaExternal(layeredEndpoint, {
          imageUrl,
          layers: numLayers,
          resolution,
          prompt,
          negativePrompt,
          numInferenceSteps,
          trueCfgScale,
          seed,
          cfgNormalize,
          useEnPrompt,
          exportFormat,
        });
        if (result.success) {
          return NextResponse.json(result);
        }
        console.log('[layered-decompose] External service failed, trying AI fallback');
      } catch (err) {
        console.log('[layered-decompose] External service error:', err instanceof Error ? err.message : err);
      }
    }

    // 回退到管理员配置的 AI API
    try {
      const result = await decomposeViaAI(imageUrl, numLayers);
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({
        success: false,
        error: `图层分解失败: ${message}`,
      } as DecomposeResult, { status: 500 });
    }
  } catch (error: unknown) {
    console.error('[layered-decompose] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      error: `图层分解失败: ${message}`,
    } as DecomposeResult, { status: 500 });
  }
}
