import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { getServerDataRoot } from '@/lib/server-data-root';
import fsSync from 'fs';
import path from 'path';
import { validateApiInputs } from '@/lib/api-validator';
import { logOperation, logError, OP_ACTIONS } from '@/lib/op-log';
import { recordThreeDTaskSubmitted } from '@/lib/cloud-task-persistence';
import {
  THREE_D_SUBMISSION_TIMEOUT_MS,
  TRIPO_UPLOAD_CONCURRENCY,
  TRIPO_UPLOAD_TIMEOUT_MS,
  mapWithConcurrency,
} from '@/lib/three-d-task-performance';

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

interface MultiViewImage {
  url: string;
  view?: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
}

interface ImageTo3DRequest {
  imageUrl: string;              // 主图（单图模式必填）
  images?: MultiViewImage[];     // 多图模式：多视角图片列表
  prompt?: string;               // 文生3D描述
  mode: 'single-image' | 'multi-image' | 'text-to-3d'; // 生成模式
  backend: 'api' | 'local';
  type: string;
  quality: string;
  texture: string;
  format: string;
  version?: 'rapid' | 'pro'; // 混元3D: rapid=极速版, pro=专业版
  providerId?: string;
  provider?: ThreeDProvider;
  local?: Local3DConfig;
  enablePBR?: boolean;           // PBR材质
  faceCount?: number;            // 目标面数
  pose?: 'a-pose' | 't-pose' | '';  // 姿态模式
}

// ==================== Image URL to Base64 Helper ====================

async function imageUrlToBase64(imageUrl: string): Promise<string | null> {
  try {
    // If already a base64 data URL, extract the base64 part
    if (imageUrl.startsWith('data:')) {
      const base64Match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (base64Match) return base64Match[1];
    }

    // Blob URLs cannot be resolved server-side
    if (imageUrl.startsWith('blob:')) {
      console.warn('[image-to-3d] Blob URLs cannot be resolved server-side');
      return null;
    }

    // Local path (e.g. /uploads/xxx.png or /api/serve-upload/xxx.png)
    // Read from filesystem first, then try localhost fetch
    if (imageUrl.startsWith('/')) {
      const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';

      // Try direct public path
      const localPath = path.join(workspacePath, 'public', imageUrl);
      if (fsSync.existsSync(localPath)) {
        const buffer = await fsSync.promises.readFile(localPath);
        return buffer.toString('base64');
      }

      // Try persistent data directory (DEV + PROD)
      const dataRoot = getServerDataRoot();
      const persistentPath = path.join(dataRoot, imageUrl.replace(/^\//, ''));
      if (fsSync.existsSync(persistentPath)) {
        const buffer = await fsSync.promises.readFile(persistentPath);
        return buffer.toString('base64');
      }

      // /api/serve-upload/filename → search upload directories
      const serveUploadMatch = imageUrl.match(/^\/api\/serve-upload\/(.+)$/);
      if (serveUploadMatch) {
        const filename = serveUploadMatch[1];
        const uploadDirs = [
          path.join(dataRoot, 'uploads'),
          path.join(workspacePath, 'public', 'uploads'),
        ];
        for (const dir of uploadDirs) {
          const filePath = path.join(dir, filename);
          if (fsSync.existsSync(filePath)) {
            const buffer = await fsSync.promises.readFile(filePath);
            return buffer.toString('base64');
          }
        }
      }

      // Fallback: fetch from localhost
      const fullUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}`;
      const response = await fetch(fullUrl, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer).toString('base64');
      }
      console.warn('[image-to-3d] Failed to fetch local image:', imageUrl);
      return null;
    }

    // External URL - fetch and convert
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

/**
 * Resolve a local image URL to a publicly accessible URL or data URL.
 * External APIs (Meshy, Tripo, etc.) can't access local paths like /uploads/xxx.png,
 * so we convert them to data URLs or use the server's public domain.
 */
async function resolveImageUrlForProvider(imageUrl: string): Promise<string> {
  // Already accessible formats
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  // Blob URL - cannot be resolved server-side
  if (imageUrl.startsWith('blob:')) {
    console.warn('[image-to-3d] Blob URL cannot be resolved for external API');
    return imageUrl;
  }

  // Local path - convert to data URL
  if (imageUrl.startsWith('/')) {
    const base64 = await imageUrlToBase64(imageUrl);
    if (base64) {
      // Determine MIME type from extension
      const ext = imageUrl.split('.').pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      };
      const mime = mimeMap[ext || ''] || 'image/png';
      return `data:${mime};base64,${base64}`;
    }

    // Fallback: try localhost URL
    const port = process.env.DEPLOY_RUN_PORT || 5000;
    const localhostUrl = `http://localhost:${port}${imageUrl}`;
    console.warn('[image-to-3d] Could not convert local image to base64, trying localhost URL:', localhostUrl);
    return localhostUrl;
  }

  return imageUrl;
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
  if (providerPreset === 'tripo' || providerName.includes('tripo') || endpoint.includes('tripo') || modelName.includes('tripo')) {
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

    case 'meshy': {
      // Meshy: multi-image / text-to-3d / single-image
      if (request.mode === 'text-to-3d') {
        return `${baseUrl}/text-to-3d`;
      }
      if (request.mode === 'multi-image' && request.images && request.images.length > 1) {
        return `${baseUrl}/multi-image-to-3d`;
      }
      return `${baseUrl}/image-to-3d`;
    }

    case 'tripo': {
      if (baseUrl.includes('302.ai') || baseUrl.includes('302ai')) {
        // 302.ai Tripo3D uses /tripo3d/v2/openapi/task endpoint
        return `${baseUrl.replace(/\/v\d+$/, '')}/tripo3d/v2/openapi/task`;
      }
      return `${baseUrl.replace(/\/v\d+$/, '')}/v2/openapi/image2model`;
    }

    case 'rodin':
      return `${baseUrl.replace(/\/v\d+$/, '')}/api/generation/generate`;

    case 'generic':
    default:
      // For generic OpenAI-compatible providers, check if model name suggests 3D
      if (modelName.includes('3d') || modelName.includes('mesh') || modelName.includes('obj')) {
        return `${baseUrl}/image-to-3d`;
      }
      // Fallback: try OpenAI images format
      return `${baseUrl}/images/generations`;
  }
}

// ==================== Request Body Builders ====================

async function buildHunyuan3DBody(request: ImageTo3DRequest): Promise<Record<string, unknown>> {
  // Determine version: rapid=极速版, pro=专业版
  const modelName = (request.provider?.model || '').toLowerCase();
  const isRapid = modelName.includes('lite') || modelName.includes('rapid') || modelName.includes('quick') || modelName.includes('极速') || request.version === 'rapid';

  const body: Record<string, unknown> = {};

  if (request.mode === 'text-to-3d' && request.prompt) {
    // 文生3D模式：混元专业版支持纯文字生成
    body.Prompt = request.prompt;
  } else if (request.mode === 'multi-image' && request.images && request.images.length > 1) {
    // 多图模式：混元3D 3.1支持MultiViewImages（最多8张八视图）
    // 第一张图作为主图ImageBase64
    const mainBase64 = await imageUrlToBase64(request.imageUrl);
    if (!mainBase64) {
      throw new Error('主图转Base64失败，无法调用混元3D API。请确保图片URL可访问。');
    }
    body.ImageBase64 = mainBase64;

    // 附加多视角图片 (API要求: ViewType + ViewImageBase64)
    const multiViewImages: Array<{ ViewType: string; ViewImageBase64: string }> = [];
    for (const img of request.images) {
      if (img.url === request.imageUrl) continue; // 主图已处理
      const b64 = await imageUrlToBase64(img.url);
      if (b64) {
        // 映射前端视角值到API支持的ViewType
        const viewMap: Record<string, string> = {
          front: 'left_front', left: 'left', right: 'right', back: 'back',
          top: 'top', bottom: 'bottom', front_left: 'left_front', front_right: 'right_front',
        };
        multiViewImages.push({
          ViewType: viewMap[img.view || ''] || 'left_front',
          ViewImageBase64: b64,
        });
      }
    }
    if (multiViewImages.length > 0) {
      body.MultiViewImages = multiViewImages;
    }
  } else {
    // 单图模式
    const base64Data = await imageUrlToBase64(request.imageUrl);
    if (!base64Data) {
      throw new Error('图片转Base64失败，无法调用混元3D API。请确保图片URL可访问。');
    }
    body.ImageBase64 = base64Data;
  }

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
    if (request.texture === 'pbr' || request.texture === '4k' || request.texture === '4096' || request.enablePBR) {
      body.EnablePBR = true;
    }
  } else {
    // 专业版 (pro-job) parameters
    // 混元3D 3.1支持多图八视图，3.0不支持
    const isMultiView = request.mode === 'multi-image' && request.images && request.images.length > 1;
    body.Model = isMultiView ? '3.1' : '3.0';

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
    if (request.texture === '4k' || request.texture === '4096' || request.enablePBR) {
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
    // 用户自定义面数优先
    if (request.faceCount && request.faceCount > 0) {
      body.FaceCount = Math.min(Math.max(request.faceCount, 3000), 1500000);
    }
  }

  // 302.ai 代理层要求显式声明图片格式
  body.ImageFormat = 'png';

  return body;
}

function buildMeshyBody(request: ImageTo3DRequest): Record<string, unknown> {
  // Meshy: multi-image / text-to-3d / single-image
  if (request.mode === 'text-to-3d' && request.prompt) {
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      ai_model: 'meshy-6',
    };
    if (request.texture === 'pbr' || request.texture === '4k' || request.enablePBR) body.enable_pbr = true;
    if (request.texture === '4k' || request.texture === '4096') body.hd_texture = true;
    if (request.format) body.target_formats = [request.format];
    if (request.faceCount && request.faceCount > 0) {
      body.should_remesh = true;
      body.target_polycount = Math.min(Math.max(request.faceCount, 100), 300000);
    }
    if (request.pose) body.pose_mode = request.pose;
    return body;
  }

  if (request.mode === 'multi-image' && request.images && request.images.length > 1) {
    const imageUrls = request.images.map(img => img.url);
    const body: Record<string, unknown> = {
      image_urls: imageUrls,
      ai_model: 'meshy-6',
      should_texture: request.texture !== 'none',
      image_enhancement: true,
      remove_lighting: true,
    };
    if (request.texture === 'pbr' || request.texture === '4k' || request.enablePBR) body.enable_pbr = true;
    if (request.texture === '4k' || request.texture === '4096') body.hd_texture = true;
    if (request.format) body.target_formats = [request.format];
    if (request.faceCount && request.faceCount > 0) {
      body.should_remesh = true;
      body.target_polycount = Math.min(Math.max(request.faceCount, 100), 300000);
    }
    if (request.pose) body.pose_mode = request.pose;
    return body;
  }

  // 单图转3D
  const body: Record<string, unknown> = {
    image_url: request.imageUrl,
    ai_model: 'meshy-6',
    should_texture: request.texture !== 'none',
    image_enhancement: true,
    remove_lighting: true,
  };
  if (request.texture === 'pbr' || request.texture === '4k' || request.enablePBR) body.enable_pbr = true;
  if (request.texture === '4k' || request.texture === '4096') body.hd_texture = true;
  if (request.format) body.target_formats = [request.format];
  if (request.faceCount && request.faceCount > 0) {
    body.should_remesh = true;
    body.target_polycount = Math.min(Math.max(request.faceCount, 100), 300000);
  }
  if (request.pose) body.pose_mode = request.pose;
  return body;
}

function resolveTripoFaceLimit(request: ImageTo3DRequest): number {
  const fallback = request.quality === 'ultra' ? 20000 : 10000;
  const requested = Number(request.faceCount);
  if (!Number.isFinite(requested) || requested <= 0) return fallback;
  return Math.min(Math.max(Math.round(requested), 100), 500000);
}

function buildTripoBody(request: ImageTo3DRequest): Record<string, unknown> {
  if (request.mode === 'text-to-3d' && request.prompt) {
    // Tripo文生3D
    return {
      prompt: request.prompt,
      type: 'text_to_model',
      settings: {
        face_limit: resolveTripoFaceLimit(request),
        texture_resolution: request.texture === '4k' ? 4096 : 2048,
        model_format: request.format,
      },
    };
  }

  if (request.mode === 'multi-image' && request.images && request.images.length > 1) {
    // Tripo多图转3D
    return {
      images: request.images.map(img => img.url),
      type: 'multi_image_to_model',
      settings: {
        face_limit: resolveTripoFaceLimit(request),
        texture_resolution: request.texture === '4k' ? 4096 : 2048,
        model_format: request.format,
      },
    };
  }

  return {
    file: { type: 'image', data: request.imageUrl },
    type: 'image_to_model',
    settings: {
      face_limit: resolveTripoFaceLimit(request),
      texture_resolution: request.texture === '4k' ? 4096 : 2048,
      model_format: request.format,
    },
  };
}

function buildRodinBody(request: ImageTo3DRequest): Record<string, unknown> {
  if (request.mode === 'text-to-3d' && request.prompt) {
    return {
      prompt: request.prompt,
      format: request.format,
      quality: request.quality,
      texture_resolution: request.texture,
    };
  }
  if (request.mode === 'multi-image' && request.images && request.images.length > 1) {
    return {
      images: request.images.map(img => img.url),
      format: request.format,
      quality: request.quality,
      texture_resolution: request.texture,
    };
  }
  return {
    image: request.imageUrl,
    format: request.format,
    quality: request.quality,
    texture_resolution: request.texture,
  };
}

// ─── 302.ai Tripo3D helpers ────────────────────────────────────

function is302Ai(request: ImageTo3DRequest): boolean {
  const baseUrl = request.provider?.baseUrl || '';
  return baseUrl.includes('302.ai') || baseUrl.includes('302ai');
}

/** Download an image from URL or data URL into a Buffer */
async function fetchImageAsBuffer(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const b64 = url.split(',')[1];
    return Buffer.from(b64, 'base64');
  }
  // Local path: read from disk
  if (url.startsWith('/')) {
    const fs = await import('fs/promises');
    const publicPath = url.startsWith('/api/serve-upload/')
      ? `/tmp/uploads/${url.split('/').pop()}`
      : url;
    try {
      return await fs.readFile(publicPath);
    } catch {
      // Try with /tmp prefix
      return await fs.readFile(`/tmp${url}`);
    }
  }
  // Remote URL
  const resp = await fetch(url, { signal: AbortSignal.timeout(TRIPO_UPLOAD_TIMEOUT_MS) });
  if (!resp.ok) {
    throw new Error(`Unable to download 3D source image: HTTP ${resp.status}`);
  }
  const arrayBuf = await resp.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/** Upload a single image to 302.ai Tripo and return the file_token */
async function uploadImageTo302Tripo(
  imageData: Buffer,
  fileName: string,
  apiKey: string,
  baseUrl: string
): Promise<string> {
  const cleanBase = baseUrl.replace(/\/v\d+$/, '').replace(/\/$/, '');
  const uploadUrl = `${cleanBase}/tripo3d/v2/openapi/upload`;

  const formData = new FormData();
  const blob = new Blob([imageData as BlobPart], { type: 'image/png' });
  formData.append('file', blob, fileName || 'image.png');

  console.log(`[image-to-3d] Uploading to 302.ai Tripo: ${uploadUrl}, size: ${imageData.length} bytes`);

  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(TRIPO_UPLOAD_TIMEOUT_MS),
  });

  if (!uploadResp.ok) {
    const errorText = await uploadResp.text().catch(() => '');
    throw new Error(`302.ai Tripo upload failed: HTTP ${uploadResp.status} ${errorText.slice(0, 200)}`);
  }

  const uploadResult = await uploadResp.json() as Record<string, unknown>;
  console.log(`[image-to-3d] 302.ai upload response:`, JSON.stringify(uploadResult).substring(0, 300));

  if ((uploadResult.code as number) !== 0) {
    throw new Error(`302.ai Tripo upload failed: ${JSON.stringify(uploadResult)}`);
  }

  const data = uploadResult.data as Record<string, unknown>;
  const fileToken = data.image_token as string;
  if (!fileToken) {
    throw new Error(`302.ai Tripo upload: no image_token in response`);
  }

  return fileToken;
}

/** Build task body for 302.ai Tripo3D using file_tokens */
function buildTripo302TaskBody(
  request: ImageTo3DRequest,
  fileTokens: string[]
): Record<string, unknown> {
  const texture = request.texture !== 'none';
  const pbr = request.enablePBR !== false;

  if (request.mode === 'multi-image' && fileTokens.length > 1) {
    return {
      type: 'multiview_to_model',
      files: fileTokens.map(ft => ({ type: 'png' as const, file_token: ft })),
      texture,
      pbr,
      format: request.format || 'glb',
    };
  }

  return {
    type: 'image_to_model',
    file: { type: 'png', file_token: fileTokens[0] },
    texture,
    pbr,
    format: request.format || 'glb',
  };
}

/** Parse 302.ai Tripo submit response → taskId */
function parseTripo302Submit(data: Record<string, unknown>): { taskId?: string } {
  const inner = (data.data || data) as Record<string, unknown>;
  return { taskId: inner.task_id as string | undefined };
}

function buildGenericBody(request: ImageTo3DRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.provider?.model,
    type: request.type,
    quality: request.quality,
    texture: request.texture,
    format: request.format,
  };
  if (request.mode === 'text-to-3d' && request.prompt) {
    body.prompt = request.prompt;
  } else if (request.mode === 'multi-image' && request.images && request.images.length > 1) {
    body.image_urls = request.images.map(img => img.url);
  } else {
    body.image_url = request.imageUrl;
  }
  if (request.enablePBR) body.enable_pbr = true;
  if (request.faceCount) body.face_count = request.faceCount;
  if (request.pose) body.pose_mode = request.pose;
  return body;
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

  // Handle admin-3d::providerId::modelId format (from frontend admin model list)
  if (selection.startsWith('admin-3d::')) {
    const parts = selection.split('::');
    if (parts.length >= 3) {
      return {
        providerId: parts[1] || undefined,
        model: parts.slice(2).join('::').trim() || undefined,
      };
    }
    // Fallback: admin-3d::modelId
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

function buildPreviewSvg(request: ImageTo3DRequest, note?: string): string {
  const label = typeLabel(request.type);
  const qualityLabel = request.quality.charAt(0).toUpperCase() + request.quality.slice(1);
  const formatLabel = (request.format || 'glb').toUpperCase();
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
    <text x="200" y="245" text-anchor="middle" fill="#aaa" font-size="11">API Model / ${formatLabel} / ${(request.texture || 'standard').toUpperCase()}</text>
    <text x="200" y="265" text-anchor="middle" fill="#888" font-size="10">${qualityLabel} mesh + balanced topology</text>
    <text x="200" y="310" text-anchor="middle" fill="#666" font-size="9">${note || 'Preview'}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ==================== Image Compression ====================

async function compressImageDataUrl(dataUrl: string, maxEdge = 1024): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  try {
    const base64 = dataUrl.split(',')[1];
    if (!base64) return dataUrl;
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < 100 * 1024) return dataUrl; // skip small images (<100KB)

    const sharp = (await import('sharp')).default;
    const metadata = await sharp(buffer).metadata();
    const originalEdge = Math.max(metadata.width || 0, metadata.height || 0);
    if (originalEdge <= maxEdge) return dataUrl; // already small enough

    const resized = await sharp(buffer)
      .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const compressed = `data:image/jpeg;base64,${resized.toString('base64')}`;
    console.log(`[image-to-3d] Compressed image: ${originalEdge}px → ${maxEdge}px, ${(buffer.length / 1024).toFixed(0)}KB → ${(resized.length / 1024).toFixed(0)}KB`);
    return compressed;
  } catch (e) {
    console.warn('[image-to-3d] Image compression failed:', e instanceof Error ? e.message : e);
    return dataUrl; // fallback to original
  }
}

async function compressRequestImages(req: ImageTo3DRequest): Promise<ImageTo3DRequest> {
  const MAX_EDGE = 1024;
  return {
    ...req,
    imageUrl: req.imageUrl ? await compressImageDataUrl(req.imageUrl, MAX_EDGE) : req.imageUrl,
    images: req.images ? await Promise.all(
      req.images.map(async (img) => ({
        ...img,
        url: await compressImageDataUrl(img.url, MAX_EDGE),
      }))
    ) : req.images,
  };
}

// ==================== Main External Request ====================

async function tryExternalRequest(request: ImageTo3DRequest): Promise<{
  assetUrl?: string;
  previewImageUrl?: string;
  taskId?: string;
  modelUrls?: Record<string, string>;
  note: string;
} | null> {
  // Compress images before building request body
  const compressedRequest = await compressRequestImages(request);

  const endpoint = buildEndpoint(compressedRequest);
  if (!endpoint) {
    console.log('[image-to-3d] No endpoint configured for backend:', compressedRequest.backend);
    return null;
  }

  const providerType = detectProviderType(compressedRequest);
  const apiKey = compressedRequest.provider?.apiKey || '';
  const baseUrl = compressedRequest.provider?.baseUrl || '';

  // ─── 302.ai Tripo3D: Upload → Submit → Poll flow ───
  if (providerType === 'tripo' && is302Ai(compressedRequest)) {
    try {
      console.log('[image-to-3d] Using 302.ai Tripo3D upload→submit flow');

      // Step 1: Upload images to get file_tokens
      const imageSources = compressedRequest.mode === 'multi-image' && compressedRequest.images?.length
        ? compressedRequest.images.map((img) => ({ url: img.url, name: `image_${img.view || 'view'}.png` }))
        : compressedRequest.imageUrl
          ? [{ url: compressedRequest.imageUrl, name: 'image.png' }]
          : [];
      const imagesToUpload = await mapWithConcurrency(
        imageSources,
        TRIPO_UPLOAD_CONCURRENCY,
        async (image) => ({ data: await fetchImageAsBuffer(image.url), name: image.name }),
      );
      const fileTokens = await mapWithConcurrency(
        imagesToUpload,
        TRIPO_UPLOAD_CONCURRENCY,
        (image) => uploadImageTo302Tripo(image.data, image.name, apiKey, baseUrl),
      );

      if (fileTokens.length === 0) {
        console.error('[image-to-3d] No images to upload for 302.ai Tripo');
        return null;
      }

      console.log(`[image-to-3d] 302.ai Tripo uploaded ${fileTokens.length} images, tokens:`, fileTokens);

      // Step 2: Build task body with file_tokens
      const taskBody = buildTripo302TaskBody(compressedRequest, fileTokens);
      const bodyStr = JSON.stringify(taskBody);
      console.log('[image-to-3d] 302.ai Tripo task body size:', bodyStr.length, 'bytes');

      // Step 3: Submit task
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const submitResp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: bodyStr,
          signal: controller.signal,
        });

        console.log('[image-to-3d] 302.ai Tripo submit status:', submitResp.status);

        if (!submitResp.ok) {
          const errText = await submitResp.text().catch(() => '');
          console.error('[image-to-3d] 302.ai Tripo submit error:', submitResp.status, errText.slice(0, 500));
          return null;
        }

        const submitData = await submitResp.json() as Record<string, unknown>;
        console.log('[image-to-3d] 302.ai Tripo submit response:', JSON.stringify(submitData).slice(0, 500));

        const parsed = parseTripo302Submit(submitData);
        if (parsed.taskId) {
          return {
            taskId: parsed.taskId,
            note: `302.ai Tripo3D task submitted (ID: ${parsed.taskId}).`,
          };
        }

        console.warn('[image-to-3d] 302.ai Tripo: no task_id in submit response');
        return null;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      console.error('[image-to-3d] 302.ai Tripo flow failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  // ─── Standard flow for other providers ───
  const requestBody = await buildRequestBody(compressedRequest);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), THREE_D_SUBMISSION_TIMEOUT_MS);

  try {
    console.log('[image-to-3d] Provider type:', providerType, 'Endpoint:', endpoint, 'Model:', compressedRequest.provider?.model, 'Version:', compressedRequest.version || (compressedRequest.provider?.model?.toLowerCase().includes('lite') ? 'rapid' : 'pro'));
    // Log request body size (don't log base64 data)
    const bodyStr = JSON.stringify(requestBody);
    const hasBase64 = bodyStr.includes('ImageBase64');
    console.log('[image-to-3d] Request body size:', bodyStr.length, 'bytes', hasBase64 ? '(contains base64 image data)' : '');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Build auth headers
    if (compressedRequest.backend === 'api' && compressedRequest.provider?.apiKey) {
      headers['Authorization'] = `Bearer ${compressedRequest.provider.apiKey}`;
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

    const parsed = parseProviderResponse(data, compressedRequest);
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
  const startTime = Date.now();
  let deductedCredits = 0;
  let sessionUser: Awaited<ReturnType<typeof getSessionUser>> = null;
  const finalModel = '';
  const finalProviderId = '';
  try {
    const body = await resolveServerProvider(await request.json() as ImageTo3DRequest);
    // 输入校验
    const _validationError = validateApiInputs(body as unknown as Record<string, unknown>, {
        imageUrl: 'optionalImageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    // Verify session (getSessionUser throws on unauthenticated)
    sessionUser = await getSessionUser(request);

    // 积分检查与扣除
    deductedCredits = 0;
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, '3d_model');
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    // Validate: text-to-3d needs prompt; single-image/multi-image needs imageUrl
    const mode = body.mode || 'single-image';
    if (mode === 'text-to-3d') {
      if (!body.prompt) {
        return NextResponse.json({ success: false, error: '文生3D模式需要提供描述文本(prompt)' }, { status: 400 });
      }
    } else if (mode === 'multi-image') {
      if (!body.images || body.images.length === 0) {
        return NextResponse.json({ success: false, error: '多图模式需要提供至少一张图片(images)' }, { status: 400 });
      }
    } else {
      if (!body.imageUrl) {
        return NextResponse.json({ success: false, error: 'Missing imageUrl' }, { status: 400 });
      }
    }
    if (body.backend === 'api' && !body.provider?.apiKey) {
      return NextResponse.json({ success: false, error: '请先在管理员系统配置可用的 3D 模型' }, { status: 400 });
    }

    // Resolve local image URLs to accessible format for external APIs
    if (body.imageUrl) {
      body.imageUrl = await resolveImageUrlForProvider(body.imageUrl);
    }
    // Resolve multi-image URLs
    if (body.images && Array.isArray(body.images)) {
      for (let i = 0; i < body.images.length; i++) {
        if (body.images[i].url) {
          body.images[i].url = await resolveImageUrlForProvider(body.images[i].url);
        }
      }
    }

    const providerType = detectProviderType(body);
    console.log('[image-to-3d] Request:', JSON.stringify({
      backend: body.backend,
      providerType,
      mode: body.mode || 'single-image',
      type: body.type,
      quality: body.quality,
      texture: body.texture,
      format: body.format,
      imageCount: body.images?.length || (body.imageUrl ? 1 : 0),
      hasPrompt: !!body.prompt,
      enablePBR: body.enablePBR,
      faceCount: body.faceCount,
      pose: body.pose,
      provider: body.provider ? { name: body.provider.name, baseUrl: body.provider.baseUrl, model: body.provider.model, preset: body.provider.providerPreset } : undefined,
      local: body.local,
    }));

    const external = await tryExternalRequest(body);
    if (external?.assetUrl || external?.taskId) {
      if (external.taskId) {
        void recordThreeDTaskSubmitted({
          taskId: external.taskId,
          userId: sessionUser?.id,
          providerId: body.provider?.id,
          model: body.provider?.model,
          label: '3D model generation',
        }).catch((persistError) => console.warn('[image-to-3d] Cloud task submit persistence failed:', persistError));
      }
      // 记录成功日志
      logOperation({
        userId: sessionUser?.id || 'anonymous',
        userName: sessionUser?.name || '匿名用户',
        action: OP_ACTIONS.MODEL_3D_GENERATE,
        level: 'info',
        detail: `3D转换成功: backend=${body.backend}`,
        model: finalModel,
        providerId: finalProviderId,
        durationMs: Date.now() - startTime,
        requestData: { backend: body.backend, taskId: external.taskId, hasAssetUrl: !!external.assetUrl },
      });
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

    throw new Error(
      body.backend === 'api'
        ? '3D provider did not accept the task. Check the provider endpoint, model, and API credentials.'
        : 'Local 3D endpoint did not accept the task. Check that the local model service is running.',
    );
  } catch (error) {
    console.error('[image-to-3d] Fatal error:', error);
    const durationMs = Date.now() - startTime;
    logError(OP_ACTIONS.MODEL_3D_GENERATE, error, {
      userId: sessionUser?.id || 'unknown',
      userName: sessionUser?.name || 'unknown',
      model: finalModel,
      providerId: finalProviderId,
      durationMs,
      detail: `3D转换失败: provider=${finalProviderId}, model=${finalModel}`,
    });
    // 退款：3D生成失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `3D模型生成失败退款: ${(error instanceof Error ? error.message : 'Unknown').substring(0, 100)}`);
      } catch (refundErr) { console.error('[image-to-3d] Refund failed:', refundErr); }
    }
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Image to 3D failed',
    }, { status: 500 });
  }
}
