import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById, findProviderForFeature, findAllProvidersForType, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, convertAspectRatioToSize, buildPollUrl, type ApiCompatProfile, type ImageEndpoint } from '@/lib/api-compatibility';
import { saveImageFile } from '@/lib/server-data-root';
import sharp from 'sharp';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { getServerDataRoot } from '@/lib/server-data-root';
import { isS3Available, uploadImageToS3 } from '@/lib/s3-storage';

const SUPPORTED_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

function findClosestAspectRatio(aspectRatio: string): string {
  if (SUPPORTED_RATIOS.includes(aspectRatio)) return aspectRatio;
  const parts = aspectRatio.split(':').map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
    const targetRatio = parts[0] / parts[1];
    let best = SUPPORTED_RATIOS[0];
    let bestDiff = Infinity;
    for (const sr of SUPPORTED_RATIOS) {
      const [sw, sh] = sr.split(':').map(Number);
      const diff = Math.abs(targetRatio - sw / sh);
      if (diff < bestDiff) { bestDiff = diff; best = sr; }
    }
    return best;
  }
  return '1:1';
}

// Greatest common divisor
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// Parse ratio string like "16:9" to get width/height proportions
function parseRatio(ratio: string): [number, number] {
  const parts = ratio.split(':').map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
    return [parts[0], parts[1]];
  }
  return [1, 1];
}

// 图像编辑 API - 支持放大、擦除、蒙版修复、扩图、移除背景
export const maxDuration = 600; // 10分钟 - token link等API生图最久可达600s
export const dynamic = 'force-dynamic';

type EditAction = 'inpaint' | 'outpaint' | 'remove_background' | 'upscale' | 'multi_angle';

interface EditRequest {
  action: EditAction;
  imageUrl: string;
  maskImage?: string; // base64 encoded mask
  prompt?: string;
  editMode?: 'erase' | 'mask'; // 区分擦除和蒙版模式，用于错误消息
  expandRatio?: string;
  expandScale?: number;
  expandPadding?: { top: number; right: number; bottom: number; left: number }; // 即梦风格方向性扩展
  targetWidth?: number;
  targetHeight?: number;
  aspectRatio?: string; // e.g. "4:3" - used to preserve original image ratio
  angleMode?: 'image' | 'camera';
  rotation?: number;
  tilt?: number;
  zoom?: number;
  originalWidth?: number;
  originalHeight?: number;
  scale?: number; // 放大倍率 2/4/8
  model?: string;
  providerId?: string;
}

// Helper: fetch image as Buffer (supports external URLs, data URLs, and local paths)
async function fetchImageBuffer(url: string): Promise<Buffer> {
  // data URL
  if (url.startsWith('data:')) {
    const matches = url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (matches) return Buffer.from(matches[2], 'base64');
    throw new Error('Invalid data URL format');
  }
  // blob URL - cannot be resolved server-side
  if (url.startsWith('blob:')) {
    throw new Error('Blob URLs cannot be processed server-side');
  }
  // local path (e.g., /api/serve-upload/xxx, /uploads/xxx)
  if (url.startsWith('/')) {
    // 1. Try local public directory (dev)
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    const localPath = path.join(workspacePath, 'public', url);
    if (fsSync.existsSync(localPath)) return fsSync.readFileSync(localPath);
    // 2. Try persistent data directory
    const { getServerDataRoot } = await import('@/lib/server-data-root');
    const dataRoot = await getServerDataRoot();
    // Try exact path under dataRoot
    const persistentPath = path.join(dataRoot, url.replace(/^\//, ''));
    if (fsSync.existsSync(persistentPath)) return fsSync.readFileSync(persistentPath);
    // Try uploads/ prefix under dataRoot
    const uploadPath = path.join(dataRoot, 'uploads', url.replace(/^\//, ''));
    if (fsSync.existsSync(uploadPath)) return fsSync.readFileSync(uploadPath);
    // 3. Try S3 object storage fallback (try both 'images/' and 'uploads/' prefixes)
    const { isS3Available, downloadImageFromS3 } = await import('@/lib/s3-storage');
    if (isS3Available()) {
      for (const prefix of ['images/', 'uploads/']) {
        const s3Key = `${prefix}${url.replace(/^\/api\/serve-upload\//, '').replace(/^\//, '')}`;
        const s3Buffer = await downloadImageFromS3(s3Key);
        if (s3Buffer) return s3Buffer;
      }
    }
    // 4. Try source URL mapping (re-download from original external URL)
    const filename = url.replace(/^\/api\/serve-upload\//, '').replace(/^\//, '');
    const { getImageSourceUrl } = await import('@/lib/image-source-map');
    const sourceUrl = await getImageSourceUrl(filename);
    if (sourceUrl) {
      console.log(`[image-edit] Re-downloading from source: ${sourceUrl.substring(0, 80)}...`);
      try {
        const srcRes = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
        if (srcRes.ok) {
          const buffer = Buffer.from(await srcRes.arrayBuffer());
          // Re-save to local for future use
          try {
            const { getServerDataRoot } = await import('@/lib/server-data-root');
            const dataRoot = await getServerDataRoot();
            const dir = path.join(dataRoot, 'api', 'serve-upload');
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path.join(dir, filename), buffer);
          } catch { /* ignore save failure */ }
          return buffer;
        }
      } catch { /* ignore re-download failure */ }
    }
    // 5. Try localhost fetch (serve-upload API)
    const port = process.env.DEPLOY_RUN_PORT || 5000;
    const res = await fetch(`http://localhost:${port}${url}`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    // 6. Try current domain fetch
    const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
    if (domain) {
      const fullUrl = `${domain}${url}`;
      const domainRes = await fetch(fullUrl, { signal: AbortSignal.timeout(10000) });
      if (domainRes.ok) return Buffer.from(await domainRes.arrayBuffer());
    }
    throw new Error(`无法获取原始图片：文件已过期或不存在，请重新生成图片`);
  }
  // external URL
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Helper: submit a task to the images/generations API and return taskId or directUrl
// Custom error for model capability issues (triggers chat-vision fallback)
class ModelCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelCapabilityError';
  }
}

async function submitImageTask(
  apiBaseUrl: string,
  apiKey: string,
  requestBody: Record<string, unknown>,
  endpoint: '/images/generations' | '/images/edits' = '/images/generations',
  providerInfo?: { baseUrl?: string; requestStyle?: string; advancedParams?: Record<string, string> } | null,
): Promise<{ taskId?: string; directUrl?: string }> {
  // 解析兼容性档案
  const profile = resolveCompatProfile(providerInfo);

  // 使用兼容性层调整请求（size格式、端点选择、input_fidelity等）
  const hasImageField = !!requestBody.image;
  const { body: adjustedBody, endpoint: resolvedEndpoint } = adjustRequestForProfile(
    requestBody,
    profile,
    { hasImage: hasImageField, isEditEndpoint: endpoint === '/images/edits' },
  );

  // 如果兼容性层建议使用不同的端点，优先使用
  const effectiveEndpoint = resolvedEndpoint;

  const controller = new AbortController();
  const isDirectMode = profile.responseMode === 'direct';
  const timeoutMs = isDirectMode ? 600000 : 60000; // 直接模式600s(兼容token link等慢速API), 异步模式60s
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Debug: log key params for image-to-image verification
  const hasImageUrls = !!adjustedBody.image_urls;
  const urls = adjustedBody.image_urls as string[] | undefined;
  const str = adjustedBody.strength;
  const sz = adjustedBody.size;
  const pmt = String(adjustedBody.prompt || '').substring(0, 80);
  const hasImg = !!adjustedBody.image;
  const inputFidelity = adjustedBody.input_fidelity;
  console.info(`[submitImageTask] API call: endpoint=${effectiveEndpoint}, profile=${profile.id}, hasImageUrls=${hasImageUrls}, hasImage=${hasImg}, inputFidelity=${inputFidelity}, urlCount=${urls?.length || 0}, urlType=${urls?.[0]?.substring(0, 30) || 'N/A'}, strength=${str}, size=${sz}, prompt=${pmt}...`);

  // For /images/edits endpoint, try JSON first (most proxies accept it), then fallback to multipart form
  let submitResponse: Response;

  if (effectiveEndpoint === '/images/edits' && hasImg) {
    // Strategy: Try JSON first (most API proxies support JSON for edits)
    // If it fails with form-related error, retry with multipart form data
    const jsonBody = { ...adjustedBody };

    submitResponse = await fetchWithV1Retry(
      apiBaseUrl,
      effectiveEndpoint,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jsonBody),
        signal: controller.signal,
      }
    );

    // If JSON request fails with form-related errors, try multipart form data
    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      const needsMultipart = errorText.includes('multipart') ||
        errorText.includes('form-data') ||
        errorText.includes('Content-Type') ||
        errorText.includes('expected multipart') ||
        errorText.includes('no file') ||
        errorText.includes('file required') ||
        errorText.includes('Missing image');

      if (needsMultipart) {
        console.info(`[submitImageTask] JSON failed for edits endpoint, retrying with multipart form data...`);
        // Build multipart form data
        const formData = new FormData();
        for (const [key, value] of Object.entries(adjustedBody)) {
          if (value === undefined || value === null) continue;
          if (key === 'image') {
            // image field: could be base64 data URL or plain base64
            const imgVal = String(value);
            if (imgVal.startsWith('data:')) {
              // data:image/png;base64,xxxxx
              const match = imgVal.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                const binaryData = Buffer.from(base64Data, 'base64');
                const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
                const file = new File([binaryData], `image.${ext}`, { type: mimeType });
                formData.append('image', file);
              }
            } else {
              // Plain base64
              const binaryData = Buffer.from(imgVal, 'base64');
              const file = new File([binaryData], 'image.png', { type: 'image/png' });
              formData.append('image', file);
            }
          } else if (Array.isArray(value)) {
            // Arrays like image[] for multi-image edits
            for (const item of value) {
              formData.append(key, String(item));
            }
          } else {
            formData.append(key, String(value));
          }
        }

        submitResponse = await fetchWithV1Retry(
          apiBaseUrl,
          effectiveEndpoint,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
            body: formData,
            signal: controller.signal,
          }
        );
      } else {
        // Not a form-related error, re-create the response for error handling below
        // We already have the error text, create a synthetic response
        submitResponse = new Response(errorText, { status: submitResponse.status, headers: submitResponse.headers });
      }
    }
  } else {
    // Standard JSON request for /images/generations
    submitResponse = await fetchWithV1Retry(
      apiBaseUrl,
      effectiveEndpoint,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(adjustedBody),
        signal: controller.signal,
      }
    );
  }

  clearTimeout(timeoutId);

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('Image task submit error:', submitResponse.status, errorText);
    let errorMsg = `API 请求失败 (${submitResponse.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) errorMsg = errorJson.error.message;
    } catch { /* ignore */ }

    // 清理常见 API 错误信息，提供更友好的中文提示
    if (errorMsg.includes('ratio or price') || errorMsg.includes('not configured')) {
      throw new ModelCapabilityError(`当前模型不支持此操作，尝试回退到视觉模型...`);
    }
    if (errorMsg.includes('image_urls') || errorMsg.includes('mask_image') || errorMsg.includes('image editing')) {
      throw new ModelCapabilityError(`当前模型不支持图像编辑功能，尝试回退到视觉模型...`);
    }
    if (errorMsg.includes('must be an URL') || errorMsg.includes('Invalid URL') || errorMsg.includes('data:')) {
      throw new ModelCapabilityError(`当前模型不支持 Base64 图片输入，尝试回退到视觉模型...`);
    }
    if (errorMsg.includes('Insufficient balance') || errorMsg.includes('insufficient')) {
      throw new Error(`API 余额不足，请联系管理员充值`);
    }
    if (errorMsg.includes('Rate limit') || errorMsg.includes('rate_limit') || errorMsg.includes('Too many requests')) {
      throw new Error(`请求过于频繁，请稍后再试`);
    }
    if (errorMsg.includes('model_not_found') || errorMsg.includes('model not found') || errorMsg.includes('Model not found')) {
      throw new ModelCapabilityError(`模型不存在或已下线，尝试切换其他模型...`);
    }
    if (errorMsg.includes('_error') || errorMsg.includes('try again later')) {
      throw new ModelCapabilityError(`当前模型暂时不可用，尝试切换其他模型...`);
    }
    if (errorMsg.includes('Invalid API key') || errorMsg.includes('invalid api_key')) {
      throw new Error(`API 密钥无效，请联系管理员检查配置`);
    }

    throw new Error(errorMsg);
  }

  // 解析响应 — 防止 API 返回 HTML 页面导致 JSON 解析失败
  const responseText = await submitResponse.text();
  let submitResult: Record<string, unknown>;
  try {
    submitResult = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    console.error('[image-edit] API returned non-JSON response, first 200 chars:', responseText.substring(0, 200));
    throw new Error('API 返回了非 JSON 响应（可能是端点不存在），请检查 API 地址配置');
  }
  const parsed = parseResponseForProfile(submitResult, profile);

  if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
    return { directUrl: parsed.directImageUrls[0] };
  }

  if (parsed.taskIds.length > 0) {
    return { taskId: parsed.taskIds[0] };
  }

  throw new Error('未获取到任务ID或图片数据');
}

/**
 * 从文本解析 SSE 格式的 chat/completions 响应
 * 用于处理某些 API 代理即使 stream:false 也返回 SSE 流的情况
 */
function parseSSEChatResponseFromText(text: string): Record<string, unknown> | null {
  const lines = text.split('\n');
  
  let finalContent = '';
  let model = '';
  let role = 'assistant';
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'data: [DONE]') continue;
    if (!trimmed.startsWith('data:') && !trimmed.startsWith('data :')) continue;
    
    const dataStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.startsWith('data :') ? trimmed.slice(6) : trimmed.slice(5);
    
    try {
      const json = JSON.parse(dataStr);
      // 非流式响应：直接取 message.content
      if (json.choices?.[0]?.message?.content) {
        finalContent = typeof json.choices[0].message.content === 'string' 
          ? json.choices[0].message.content 
          : JSON.stringify(json.choices[0].message.content);
      }
      // 流式响应：累加 delta.content
      const delta = json.choices?.[0]?.delta;
      if (delta?.content) {
        finalContent += delta.content;
      }
      if (delta?.role) role = delta.role;
      if (json.model) model = json.model;
    } catch {
      // 忽略无法解析的行
    }
  }
  
  if (!finalContent) return null;
  
  return {
    choices: [{
      message: { content: finalContent, role },
      finish_reason: 'stop',
    }],
    model,
  } as Record<string, unknown>;
}

// Helper: use chat-completions with vision model to describe an image
// Returns a text description of the image, or null if all models fail
async function describeImageWithVision(
  imageBase64: string,
  instruction: string,
): Promise<string | null> {
  const chatProviders = await findAllProvidersForType('chat');
  if (chatProviders.length === 0) {
    console.warn('[image-edit] No chat models available for vision description');
    return null;
  }

  const imageDataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;

  for (const entry of chatProviders) {
    for (const m of entry.models) {
      try {
        console.log(`[image-edit] vision-describe: Trying ${m}`);
        const chatRequestBody = {
          model: m,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: imageDataUrl } },
                { type: 'text', text: instruction }
              ]
            }
          ],
          max_tokens: 2048,
          stream: false,
        };

        const chatResponse = await fetchWithV1Retry(
          normalizeApiBaseUrl(entry.provider.baseUrl),
          '/chat/completions',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${entry.provider.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(chatRequestBody),
            signal: AbortSignal.timeout(60000),
          }
        );

        if (!chatResponse.ok) continue;

        const responseText = await chatResponse.text();
        let chatResult: Record<string, unknown> | null = null;
        const trimmedText = responseText.trim();

        if (trimmedText.startsWith('data:') || trimmedText.startsWith('data :')) {
          chatResult = parseSSEChatResponseFromText(trimmedText);
        } else {
          try { chatResult = JSON.parse(trimmedText); } catch { chatResult = parseSSEChatResponseFromText(trimmedText); }
        }

        if (!chatResult) continue;

        const choice = (chatResult as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0];
        const content = choice?.message?.content;

        // Extract text content (whether string or array)
        if (typeof content === 'string' && content.length > 20) {
          console.log(`[image-edit] vision-describe: ${m} returned ${content.length} chars`);
          return content;
        }
        if (Array.isArray(content)) {
          const textParts = content
            .filter((p: { type: string }) => p.type === 'text')
            .map((p: { text: string }) => p.text)
            .filter((t: string) => t.length > 10);
          if (textParts.length > 0) {
            const joined = textParts.join(' ');
            console.log(`[image-edit] vision-describe: ${m} returned ${joined.length} chars (array)`);
            return joined;
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[image-edit] vision-describe: ${m} failed: ${errMsg}`);
        continue;
      }
    }
  }

  return null;
}

/**
 * 自动尝试提交图像任务 - 遍历候选模型直到成功
 * 遇到 ModelCapabilityError 时自动切换下一个候选模型
 */
async function autoTrySubmitImageTask(
  candidateModels: Array<{ model: string; apiKey: string; apiBaseUrl: string; source: string; advancedParams?: Record<string, string> }>,
  buildRequestBody: (model: string) => Record<string, unknown>,
  operation: string,
  endpoint: '/images/generations' | '/images/edits' = '/images/generations',
): Promise<{ taskId?: string; directUrl?: string; usedModel?: string }> {
  const errors: string[] = [];
  
  for (const candidate of candidateModels) {
    try {
      console.log(`[image-edit] ${operation}: Trying model ${candidate.model} (source: ${candidate.source}, endpoint: ${endpoint})`);
      const requestBody = buildRequestBody(candidate.model);
      const result = await submitImageTask(candidate.apiBaseUrl, candidate.apiKey, requestBody, endpoint, {
        baseUrl: candidate.apiBaseUrl,
        advancedParams: candidate.advancedParams,
      });
      return { ...result, usedModel: candidate.model };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate.model}: ${errMsg}`);
      console.warn(`[image-edit] ${operation}: Model ${candidate.model} failed: ${errMsg}`);
      
      // ModelCapabilityError → 继续尝试下一个模型
      if (err instanceof ModelCapabilityError) {
        continue;
      }
      // 不可重试的致命错误（认证/配额等）→ 直接抛出
      const nonRetryable = 
        errMsg.includes('Invalid API key') || 
        errMsg.includes('invalid api_key') ||
        errMsg.includes('Insufficient balance') ||
        errMsg.includes('insufficient balance');
      if (nonRetryable) {
        throw err;
      }
      // 提供商通道/配额/网络等错误 → 继续尝试下一个模型
      console.warn(`[image-edit] ${operation}: Retrying with next model...`);
      continue;
    }
  }
  
  // 所有候选模型都不支持此操作
  throw new ModelCapabilityError(
    `所有 ${candidateModels.length} 个可用模型均不支持${operation}操作。请添加支持图像编辑的模型（如 DALL-E、Flux 等）。\n` +
    `尝试过的模型: ${errors.map((e, i) => `${i + 1}. ${e}`).join('; ')}`
  );
}

/**
 * 自动尝试所有 LLM 模型做视觉 fallback
 * 遍历管理员配置的 chat 类型模型，用视觉理解+生成的方式替代图像编辑
 */
/**
 * 自动尝试所有 LLM 模型做视觉描述 + 图像生成 fallback
 * 用于 inpaint/erase 等操作，当 images/generations 不支持时
 */
async function autoTryChatVisionFallback(
  imageBase64: string,
  _maskBase64: string | null,
  prompt: string,
  operation: string,
): Promise<{ taskId?: string; directUrl?: string; usedModel?: string } | null> {
  // Step 1: 用 chat vision 模型描述图片内容
  const description = await describeImageWithVision(
    imageBase64,
    operation === 'erase'
      ? '请详细描述这张图片的内容，包括主体、背景、风格、色彩、构图等细节。'
      : prompt || '请详细描述这张图片的内容，包括主体、背景、风格、色彩、构图等细节。'
  );

  if (!description) {
    console.warn(`[image-edit] ${operation} vision fallback: No description available`);
    return null;
  }

  // Step 2: 用描述 + image_urls 作为参考提交 images/generations
  const imageProviders = await findAllProvidersForType('image');
  if (imageProviders.length === 0) {
    console.warn(`[image-edit] ${operation} vision fallback: No image models available`);
    return null;
  }

  const imageDataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;

  // 构建 candidate models from image providers
  const candidates: Array<{ model: string; apiKey: string; apiBaseUrl: string; source: string }> = [];
  for (const entry of imageProviders) {
    for (const m of entry.models) {
      candidates.push({
        model: m,
        apiKey: entry.provider.apiKey,
        apiBaseUrl: normalizeApiBaseUrl(entry.provider.baseUrl),
        source: 'chat-vision-fallback',
      });
    }
  }

  const enhancedPrompt = operation === 'erase'
    ? `${description}\n\nRemove the masked area content and fill with natural background. Seamlessly blend the repaired area with surrounding content.`
    : `${description}\n\n${prompt || ''}`;

  try {
    const result = await autoTrySubmitImageTask(candidates, (m) => ({
      model: m,
      prompt: enhancedPrompt,
      n: 1,
      size: '1024x1024',
      image_urls: [imageDataUrl],
      strength: 0.6,
    }), `${operation}(vision-fallback)`);
    return { ...result, usedModel: result.usedModel };
  } catch {
    return null;
  }
}

// ============================================================
// 分块放大 (Tile-based Upscale) 辅助函数
// ============================================================

interface TileInfo {
  col: number; row: number;
  x: number; y: number;           // 在原图中的起始坐标
  width: number; height: number;   // 原图中的实际尺寸
  buffer: Buffer;                  // tile 图像数据
  overlapLeft: number; overlapTop: number;   // 与左边/上边 tile 的重叠像素
  overlapRight: number; overlapBottom: number; // 与右边/下边的重叠像素
}

/**
 * 将图像分割为网格 tiles，带重叠区域（用于无缝拼接）
 * @param imageBuffer 原始图像 buffer
 * @param cols 列数
 * @param rows 行数
 * @param overlap 重叠像素数（默认 16px）
 */
async function splitImageIntoTiles(
  imageBuffer: Buffer,
  cols: number,
  rows: number,
  overlap: number = 16,
): Promise<{ tiles: TileInfo[]; origWidth: number; origHeight: number }> {
  const meta = await sharp(imageBuffer).metadata();
  const origW = meta.width || 512;
  const origH = meta.height || 512;

  const tileW = Math.ceil(origW / cols);
  const tileH = Math.ceil(origH / rows);
  const tiles: TileInfo[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * tileW;
      const y = r * tileH;
      // 实际裁切宽高（最后一个 tile 可能不满一格）
      const w = Math.min(tileW, origW - x);
      const h = Math.min(tileH, origH - y);

      // 扩展裁切区域以包含重叠（clamp 到图像边界）
      const extX = Math.max(0, x - (c > 0 ? overlap : 0));
      const extY = Math.max(0, y - (r > 0 ? overlap : 0));
      const extRight = Math.min(origW, x + w + (c < cols - 1 ? overlap : 0));
      const extBottom = Math.min(origH, y + h + (r < rows - 1 ? overlap : 0));
      const extW = extRight - extX;
      const extH = extBottom - extY;

      const tileBuffer = await sharp(imageBuffer)
        .extract({ left: extX, top: extY, width: extW, height: extH })
        .png()
        .toBuffer();

      tiles.push({
        col: c, row: r,
        x: extX, y: extY,
        width: extW, height: extH,
        buffer: tileBuffer,
        overlapLeft: extX < x ? x - extX : 0,
        overlapTop: extY < y ? y - extY : 0,
        overlapRight: extRight > x + w ? extRight - (x + w) : 0,
        overlapBottom: extBottom > y + h ? extBottom - (y + h) : 0,
      });
    }
  }

  return { tiles, origWidth: origW, origHeight: origH };
}

/**
 * 合并 tiles 为最终图像
 * 使用线性渐变混合重叠区域，消除拼接缝隙
 * @param tileResults 每个 tile 的图像 buffer（已放大）
 * @param tiles 原始 tile 信息
 * @param scale 放大倍率
 * @param targetWidth 最终输出宽度
 * @param targetHeight 最终输出高度
 */
async function mergeTiles(
  tileResults: Buffer[],
  tiles: TileInfo[],
  scale: number,
  targetWidth: number,
  targetHeight: number,
): Promise<Buffer> {
  // 创建最终画布
  const canvas = sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  });

  // 使用 compositing 逐 tile 叠加
  // 策略：每个 tile 按放大后的坐标放置，重叠区域后放置的 tile 覆盖先放置的
  // 为了无缝混合，我们在重叠区域使用 alpha 渐变
  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const tileImg = tileResults[i];

    // 放大后的坐标
    const left = Math.round(tile.x * scale);
    const top = Math.round(tile.y * scale);

    // 如果有重叠区域，为 tile 添加 alpha 渐变实现平滑混合
    const hasOverlap = tile.overlapLeft > 0 || tile.overlapTop > 0 ||
                       tile.overlapRight > 0 || tile.overlapBottom > 0;

    let compositeInput: Buffer;

    if (hasOverlap) {
      // 获取放大后 tile 的元数据
      const tileMeta = await sharp(tileImg).metadata();
      const tw = tileMeta.width || Math.round(tile.width * scale);
      const th = tileMeta.height || Math.round(tile.height * scale);

      // 创建 alpha 通道：重叠区域用渐变，核心区域全不透明
      const alphaChannels: Buffer[] = [];

      // 使用 raw 像素操作创建 alpha 通道
      // 先创建全不透明的 alpha
      const rawTile = await sharp(tileImg).ensureAlpha().raw().toBuffer();
      const channels = tileMeta.channels || 4;
      const pixelCount = tw * th;

      // 构建新的 alpha 通道
      const newAlpha = Buffer.alloc(pixelCount);
      for (let py = 0; py < th; py++) {
        for (let px = 0; px < tw; px++) {
          let alpha = 255;

          // 左重叠渐变
          if (tile.overlapLeft > 0 && px < Math.round(tile.overlapLeft * scale)) {
            const t = px / Math.round(tile.overlapLeft * scale);
            alpha = Math.min(alpha, Math.round(t * 255));
          }
          // 右重叠渐变
          if (tile.overlapRight > 0 && px >= tw - Math.round(tile.overlapRight * scale)) {
            const overlapPx = px - (tw - Math.round(tile.overlapRight * scale));
            const t = 1 - overlapPx / Math.round(tile.overlapRight * scale);
            alpha = Math.min(alpha, Math.round(t * 255));
          }
          // 上重叠渐变
          if (tile.overlapTop > 0 && py < Math.round(tile.overlapTop * scale)) {
            const t = py / Math.round(tile.overlapTop * scale);
            alpha = Math.min(alpha, Math.round(t * 255));
          }
          // 下重叠渐变
          if (tile.overlapBottom > 0 && py >= th - Math.round(tile.overlapBottom * scale)) {
            const overlapPy = py - (th - Math.round(tile.overlapBottom * scale));
            const t = 1 - overlapPy / Math.round(tile.overlapBottom * scale);
            alpha = Math.min(alpha, Math.round(t * 255));
          }

          newAlpha[py * tw + px] = alpha;
        }
      }

      // 将新 alpha 通道写入图像
      for (let idx = 0; idx < pixelCount; idx++) {
        rawTile[idx * channels + (channels - 1)] = newAlpha[idx];
      }

      compositeInput = await sharp(rawTile, { raw: { width: tw, height: th, channels } })
        .png()
        .toBuffer();
    } else {
      compositeInput = tileImg;
    }

    composites.push({
      input: compositeInput,
      left,
      top,
      blend: 'over',
    });
  }

  const result = await canvas.composite(composites).png({ quality: 95 }).toBuffer();
  return result;
}

/**
 * 轮询单个任务直到完成，返回图片 URL
 * 使用提供商的任务状态查询接口（兼容性档案决定轮询路径）
 */
async function pollTaskUntilComplete(
  taskId: string,
  apiKey: string,
  apiBaseUrl: string,
  profile: ApiCompatProfile,
  maxAttempts: number = 80,
  intervalMs: number = 3000,
): Promise<string> {
  // 使用兼容性档案确定轮询 URL
  const pollUrl = buildPollUrl(apiBaseUrl, taskId, profile);
  if (!pollUrl) {
    throw new Error(`Provider does not support polling for task ${taskId}`);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, intervalMs));

    try {
      const pollRes = await fetch(pollUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!pollRes.ok) continue;

      // 防止 API 返回 HTML 页面导致 JSON 解析失败
      const pollText = await pollRes.text();
      let pollData: Record<string, unknown>;
      try {
        pollData = JSON.parse(pollText) as Record<string, unknown>;
      } catch {
        console.error('[image-edit poll] Non-JSON response, first 200 chars:', pollText.substring(0, 200));
        continue; // 跳过这次轮询，下次重试
      }
      const taskData = pollData.data as Record<string, unknown> | undefined;
      const taskResult = taskData?.result as Record<string, unknown> | undefined;
      const status = taskData?.status;

      if (status === 'completed') {
        // 从 result.images 提取图片 URL
        const images = taskResult?.images as Array<Record<string, unknown>> | undefined;
        if (images && images.length > 0) {
          const rawUrl = images[0].url || images[0].image_url || images[0].src;
          const imageUrl = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl;
          if (imageUrl) return imageUrl as string;
        }
        // 兜底：b64_json
        const b64Json = taskResult?.b64_json as string | undefined;
        if (b64Json) {
          return `data:image/png;base64,${b64Json}`;
        }
        throw new Error(`Tile task ${taskId} completed but no image URL found`);
      }
      if (status === 'failed') {
        const taskError = taskData?.error as Record<string, unknown> | undefined;
        const failReason = (taskError?.message as string) || 'unknown';
        throw new Error(`Tile task ${taskId} failed: ${failReason}`);
      }
      if (status === 'cancelled') {
        throw new Error(`Tile task ${taskId} was cancelled`);
      }
      // status = 'pending' / 'processing' → continue polling
    } catch (err: unknown) {
      if (err instanceof Error && (err.message.includes('failed:') || err.message.includes('cancelled') || err.message.includes('no image URL'))) throw err;
      // 网络错误继续重试
    }
  }
  throw new Error(`Tile task ${taskId} timed out after ${maxAttempts} attempts`);
}

/**
 * 保存 buffer 到 public 目录并返回可访问的 URL 路径
 */
async function saveBufferToPublic(buffer: Buffer, filename: string): Promise<string> {
  if (isS3Available()) {
    const s3Url = await uploadImageToS3(buffer, filename, 'image/png');
    if (s3Url) return s3Url;
  }
  const url = await saveImageFile(buffer, filename, 'upscaled');
  return url || `/api/serve-upload/upscaled/${filename}`;
}

export async function POST(request: NextRequest) {
  try {
    const body: EditRequest = await request.json();
    const sessionUser = await getSessionUser(request);
    const {
      action,
      imageUrl,
      maskImage,
      prompt,
      editMode,
      expandRatio,
      expandScale = 1,
      expandPadding,
      targetWidth,
      targetHeight,
      aspectRatio,
      angleMode = 'image',
      rotation = 0,
      tilt = 0,
      zoom = 1,
      model: rawModel = 'gemini-2.5-flash-image-preview',
      providerId,
    } = body;

    // 防御性处理：确保 model 是字符串（前端可能误传对象）
    const modelStr = typeof rawModel === 'string' ? rawModel : (rawModel as any)?.model || String(rawModel);

    // 放大/擦除/蒙版 均使用管理员系统的 image 类型模型
    // 策略：自动识别管理员配置的所有可用 image 模型，按优先级逐一尝试
    // 0. 先尝试前端指定的 provider（如果提供了 providerId）
    // 1. 再尝试前端指定的模型（如果匹配到 provider）
    // 2. 再尝试管理员配置的其他 image 类型 provider 的模型
    // 3. 最后使用环境变量兜底
    // 构建候选模型列表：前端指定的模型优先，然后是其他所有可用模型
    const candidateModels: Array<{ model: string; apiKey: string; apiBaseUrl: string; source: string; advancedParams?: Record<string, string> }> = [];
    const triedModels = new Set<string>();
    
    const allImageProviders = await findAllProvidersForType('image');
    
    // 0. 优先使用前端指定的 providerId
    if (providerId) {
      const specifiedProvider = await findProviderById(providerId);
      if (specifiedProvider) {
        candidateModels.push({
          model: modelStr,
          apiKey: specifiedProvider.apiKey,
          apiBaseUrl: normalizeApiBaseUrl(specifiedProvider.baseUrl),
          source: 'specified-provider',
          advancedParams: specifiedProvider.advancedParams,
        });
        triedModels.add(modelStr);
      }
    }
    
    // 1. 前端指定的模型（如果匹配到 provider）
    const preferredProvider = await findProviderForModel(modelStr, 'image')
      || await findProviderForModel(modelStr, 'universal');
    if (preferredProvider) {
      candidateModels.push({
        model: modelStr,
        apiKey: preferredProvider.apiKey,
        apiBaseUrl: normalizeApiBaseUrl(preferredProvider.baseUrl),
        source: 'preferred',
        advancedParams: preferredProvider.advancedParams,
      });
      triedModels.add(modelStr);
    }
    
    // 2. 管理员配置的所有 image 类型 provider 的模型
    for (const entry of allImageProviders) {
      for (const m of entry.models) {
        if (!triedModels.has(m)) {
          candidateModels.push({
            model: m,
            apiKey: entry.provider.apiKey,
            apiBaseUrl: normalizeApiBaseUrl(entry.provider.baseUrl),
            source: 'admin-auto',
            advancedParams: entry.provider.advancedParams,
          });
          triedModels.add(m);
        }
      }
    }
    
    // 3. 环境变量兜底
    const envApiKey = process.env.APIMART_API_KEY || '';
    const envApiBaseUrl = normalizeApiBaseUrl(process.env.APIMART_BASE_URL || '');
    if (envApiKey && candidateModels.length === 0) {
      candidateModels.push({
        model: modelStr,
        apiKey: envApiKey,
        apiBaseUrl: envApiBaseUrl,
        source: 'env-fallback',
      });
    }
    
    if (candidateModels.length === 0) {
      return NextResponse.json({
        success: false,
        error: '请先在管理员系统配置可用的图像模型（image类型）',
      }, { status: 400 });
    }
    
    // 选取第一个候选模型作为初始模型（后续 submitImageTask 失败时会自动尝试下一个）
    let currentModelIdx = 0;
    const getCurrentModel = () => candidateModels[currentModelIdx];
    
    // 自动尝试下一个候选模型
    const tryNextModel = (): { model: string; apiKey: string; apiBaseUrl: string } | null => {
      currentModelIdx++;
      if (currentModelIdx < candidateModels.length) {
        const next = candidateModels[currentModelIdx];
        console.log(`[image-edit] Trying next model: ${next.model} (source: ${next.source})`);
        return next;
      }
      return null;
    };

    // Helper: resolve local/blob/external image URL to base64 data URL
    const resolveImageToBase64 = async (url: string): Promise<string> => {
      if (url.startsWith('data:')) return url;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
        const localPrefix = `${domain}/`;
        if (url.startsWith(localPrefix)) {
          const localPath = url.replace(localPrefix, '');
          // Search multiple possible locations: dataRoot/localPath, dataRoot/public/localPath, devWorkspace/public/localPath
          const dataRoot = await getServerDataRoot();
          const searchPaths = [
            path.join(dataRoot, localPath),
            path.join(dataRoot, 'public', localPath),
            path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', localPath),
          ];
          for (const fp of searchPaths) {
            try { const buf = await fs.readFile(fp); const ext = localPath.split('.').pop()?.toLowerCase() || 'png'; const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'; return `data:${mime};base64,${buf.toString('base64')}`; } catch {}
          }
          throw new Error(`Local file not found: ${localPath} (searched ${searchPaths.join(', ')})`);
        }
        // External URL: fetch it
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get('content-type') || 'image/png';
        return `data:${ct};base64,${buf.toString('base64')}`;
      }
      // Relative path like /uploads/xxx.png or /outpaint/xxx.png
      const dataRoot = await getServerDataRoot();
      const relPath = url.startsWith('/') ? url.slice(1) : url;
      const searchPaths = [
        path.join(dataRoot, relPath),
        path.join(dataRoot, 'public', relPath),
        path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', relPath),
      ];
      for (const fp of searchPaths) {
        try { const buf = await fs.readFile(fp); const ext = relPath.split('.').pop()?.toLowerCase() || 'png'; const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'; return `data:${mime};base64,${buf.toString('base64')}`; } catch {}
      }
      throw new Error(`File not found: ${url} (searched ${searchPaths.join(', ')})`);
    };

    if (action === 'multi_angle') {
      // ============================================================
      // 多角度旋转 (Multi-Angle Rotation)
      //
      // 参考 Lovart.ai 的多角度功能实现方式:
      // 核心策略: 使用 /images/edits 端点 + input_fidelity: 'high'
      // - /images/edits 会把输入图片视为"要编辑的源图"而非"风格参考"
      // - input_fidelity: 'high' 让 AI 最大程度保留原图内容(identity/材质/细节)
      // - AI 推断隐藏侧面, 重新渲染指定角度的视图
      // 如果 /images/edits 不可用, 回退到 /images/generations + image_urls
      // ============================================================

      // Build angle description text
      // rotation: -90 to 90 (yaw), tilt: -30 to 60 (pitch), zoom: 0=特写 1=标准 2=广角
      const yawText = rotation > 0 ? `${Math.abs(rotation)} degrees to the right` : rotation < 0 ? `${Math.abs(rotation)} degrees to the left` : 'front view';
      const pitchText = tilt > 0 ? `${Math.abs(tilt)} degrees low angle looking up` : tilt < 0 ? `${Math.abs(tilt)} degrees high angle looking down` : 'level camera height';
      const zoomIdx = typeof zoom === 'number' ? zoom : 1;
      const dollyText = zoomIdx === 0 ? 'close-up shot, tight framing, subject fills the frame' : zoomIdx === 2 ? 'wide-angle shot, pulled back camera, shows more environment and context' : 'standard medium framing';

      // Build optimized prompt for multi-angle rotation
      // Key: The prompt must clearly convey "re-render from a different 3D angle" not "rotate the 2D image"
      const multiAnglePrompt = prompt || (angleMode === 'image'
        ? `Edit this image to show the subject as if it has been physically rotated ${yawText} in 3D space, viewed from ${pitchText}, with ${dollyText}. This is a 3D rotation of the subject itself, NOT a 2D canvas rotation. The subject is a real 3D object — reconstruct its unseen sides based on context and generate a photorealistic view from the new angle. Strictly preserve: the same identity, face, clothing, product, design, materials, labels, text, colors, proportions, and lighting style. Infer plausible hidden geometry and details for the newly visible sides. The result should look like a professional studio photograph of the same object from a different angle, with realistic perspective, depth, occlusion, and shadows. Do NOT simply rotate or warp the flat source image.`
        : `Edit this image as if moving a virtual camera around the scene: camera orbits to yaw ${yawText}, pitch ${pitchText}, ${dollyText}. The scene and subject remain fixed in place. Re-render the entire scene from this new camera position, preserving all subjects, objects, materials, colors, environment, and mood. Infer unseen geometry and surfaces based on the visible context. The result should look like a real photograph taken from the new camera position, with correct perspective, depth, occlusion, shadows, and reflections. Do NOT rotate the 2D image canvas.`);

      // Resolve image to base64 for maximum content preservation
      const multiAngleBase64 = await resolveImageToBase64(imageUrl);

      // Strategy 1: Try /images/edits endpoint with input_fidelity: 'high'
      // This is the correct approach for "edit this image from a different angle"
      let result: { taskId?: string; directUrl?: string; usedModel?: string } | null = null;
      let usedEndpoint: '/images/edits' | '/images/generations' = '/images/edits';

      try {
        if (multiAngleBase64) {
          // multiAngleBase64 is already a full data URL (data:image/xxx;base64,...), use directly
          result = await autoTrySubmitImageTask(candidateModels, (m) => ({
            model: m,
            prompt: multiAnglePrompt,
            size: '1:1',
            n: 1,
            image: multiAngleBase64,
            input_fidelity: 'high',
          }), '多角度(edits)', '/images/edits');
          console.info(`[multi-angle] Successfully used /images/edits endpoint`);
        } else {
          // No base64 available, skip edits and go straight to generations
          throw new ModelCapabilityError('No base64 image available for edits endpoint');
        }
      } catch (editsErr: unknown) {
        // Strategy 2: Fallback to /images/generations with image_urls
        // This treats the image as a reference rather than an edit source,
        // but is better than failing completely
        const editsErrMsg = editsErr instanceof Error ? editsErr.message : String(editsErr);
        console.warn(`[multi-angle] /images/edits failed: ${editsErrMsg}, falling back to /images/generations`);
        usedEndpoint = '/images/generations';

        result = await autoTrySubmitImageTask(candidateModels, (m) => ({
          model: m,
          prompt: multiAnglePrompt,
          size: '1:1',
          n: 1,
          image_urls: [imageUrl],
          ...(multiAngleBase64 ? { image: multiAngleBase64 } : {}),
          input_fidelity: 'high',
        }), '多角度(generations)');
      }

      if (result?.directUrl) {
        return NextResponse.json({ success: true, imageUrl: result.directUrl, action, usedModel: result.usedModel, endpoint: usedEndpoint });
      }
      return NextResponse.json({ success: true, taskId: result?.taskId, action, prompt: multiAnglePrompt, usedModel: result?.usedModel, endpoint: usedEndpoint });
    }

    if (action === 'upscale') {
      // ============================================================
      // 超清放大 (Upscale)
      //
      // 策略 A (推荐): upscayl-node 分块放大 — 像素级忠实，Real-ESRGAN 神经网络
      //   流程：Split → upscayl each tile → Merge
      //   优势：每个 tile 由专门的放大模型处理，像素级保留 + 细节增强
      //
      // 策略 B (兜底): AI 整图放大 — 用 images/generations + 低 strength
      //   流程：Describe → Generate with reference
      //   注意：不用分块！images/generations 不保留 tile 原始内容
      // ============================================================

      const scaleVal = body.scale || 2;
      const origW = body.originalWidth || 512;
      const origH = body.originalHeight || 512;
      const targetW = targetWidth || origW * scaleVal;
      const targetH = targetHeight || origH * scaleVal;

      // ---- 检测 upscayl 可用性 ----
      let useUpscayl = false;
      let upscaylModule: typeof import('@/lib/image-tools/upscayl') | null = null;
      try {
        upscaylModule = await import('@/lib/image-tools/upscayl');
        const upscaylStatus = await upscaylModule.isUpscaylAvailable();
        const upscaylModels = upscaylStatus.available ? await upscaylModule.listUpscaylModels() : [];
        useUpscayl = upscaylStatus.available && upscaylModels.length > 0;
        if (useUpscayl) {
          console.log(`[image-edit] upscale: upscayl available, will try tile mode first`);
        }
      } catch (e) {
        console.log(`[image-edit] upscale: upscayl not available:`, e);
      }

      if (useUpscayl && upscaylModule) {
        // ============================================================
        // 策略 A: upscayl-node 分块放大（如果失败自动回退到策略 B）
        // ============================================================
        try {
        const maxEdge = Math.max(origW, origH);
        let cols: number, rows: number;
        if (maxEdge < 800) { cols = 2; rows = 2; }
        else if (maxEdge < 1600) { cols = 2; rows = 3; }
        else { cols = 3; rows = 3; }

        const totalTiles = cols * rows;
        const overlap = 24;

        console.log(`[image-edit] upscale: upscayl tile mode. Original: ${origW}x${origH}, Scale: ${scaleVal}x, Grid: ${cols}x${rows}=${totalTiles} tiles`);

        // Step 1: 下载原图
        let imageBuffer: Buffer;
        try {
          imageBuffer = await fetchImageBuffer(imageUrl);
        } catch (e) {
          console.error('[image-edit] upscale: Failed to fetch source image:', e);
          return NextResponse.json({ success: false, error: '无法获取原始图片' }, { status: 500 });
        }

        // Step 2: 分块
        const { tiles } = await splitImageIntoTiles(imageBuffer, cols, rows, overlap);
        console.log(`[image-edit] upscale: Split into ${tiles.length} tiles`);

        // Step 3: 用 upscayl 逐块放大
        // upscayl 模型固定 4x 放大，scale=2 时先 4x 再缩放回 2x
        const upscaylAvailableModels = await upscaylModule.listUpscaylModels();
        const upscaylModel = upscaylAvailableModels.includes('realesrgan-x4plus') ? 'realesrgan-x4plus' : upscaylAvailableModels[0];
        const upscaylScale = 4; // upscayl 强制 4x

        const tileResultBuffers: Buffer[] = [];
        const tmpDir = path.join('/tmp', `upscayl_tiles_${Date.now()}`);
        await fs.mkdir(tmpDir, { recursive: true });

        try {
          for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i];
            // 使用 data URL 传递 tile，避免 readImageToBuffer 的路径拼接问题
            const tileDataUrl = `data:image/png;base64,${tile.buffer.toString('base64')}`;

            // 调用 upscayl 放大
            console.log(`[image-edit] upscale: upscayl processing tile ${i + 1}/${tiles.length}`);
            const result = await upscaylModule.performUpscale({
              imageUrl: tileDataUrl,
              model: upscaylModel,
              scale: upscaylScale as 2 | 4,
              outputFormat: 'png',
            });

            if (!result.success || !result.imageUrl) {
              throw new Error(`Tile ${i} upscayl failed: ${result.error || 'no output'}`);
            }

            // 读取 upscayl 输出
            let outputBuffer: Buffer;
            if (result.imageUrl && result.imageUrl.startsWith('/')) {
              // upscayl 输出路径如 /outputs/upscale/xxx.png → 实际在 process.cwd()/public/outputs/...
              const absPath = path.join(process.cwd(), 'public', result.imageUrl);
              outputBuffer = await fs.readFile(absPath);
            } else if (result.imageUrl) {
              const res = await fetch(result.imageUrl, { signal: AbortSignal.timeout(30000) });
              outputBuffer = Buffer.from(await res.arrayBuffer());
            } else {
              throw new Error(`Tile ${i} upscayl returned no output URL`);
            }

            // 如果 upscaylScale > scaleVal，resize 到目标倍率
            if (upscaylScale > scaleVal) {
              const resizeRatio = scaleVal / upscaylScale;
              const tileMeta = await sharp(outputBuffer).metadata();
              const newW = Math.round((tileMeta.width || tile.width * upscaylScale) * resizeRatio);
              const newH = Math.round((tileMeta.height || tile.height * upscaylScale) * resizeRatio);
              outputBuffer = await sharp(outputBuffer)
                .resize(newW, newH, { kernel: 'lanczos3' })
                .png()
                .toBuffer();
            }

            tileResultBuffers.push(outputBuffer);
          }
        } finally {
          // 清理临时目录
          try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }

        // Step 4: 合并 tiles
        console.log(`[image-edit] upscale: Merging ${tiles.length} tiles into ${targetW}x${targetH} image`);
        const mergedBuffer = await mergeTiles(tileResultBuffers, tiles, scaleVal, targetW, targetH);

        // Step 5: 保存并返回
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const filename = `upscale_${timestamp}_${randomSuffix}.png`;
        const savedPath = await saveBufferToPublic(mergedBuffer, filename);

        const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
        const fullUrl = `${domain}${savedPath}`;

        console.log(`[image-edit] upscale: upscayl tile upscale complete. Output: ${savedPath} (${(mergedBuffer.length / 1024).toFixed(0)}KB)`);

        return NextResponse.json({
          success: true,
          imageUrl: fullUrl,
          action,
          engine: 'upscayl-tile',
          usedModel: upscaylModel,
          tileInfo: { cols, rows, totalTiles, overlap, scale: scaleVal },
        });
        } catch (upscaylError) {
          // upscayl 执行失败（如无 GPU），回退到 AI 整图放大
          console.log(`[image-edit] upscale: upscayl tile mode failed, falling back to AI:`, upscaylError instanceof Error ? upscaylError.message : upscaylError);
        }
      }

      // ============================================================
      // 策略 B: AI 整图放大 (upscayl 不可用或失败时的兜底方案)
      // 注意：不做分块！images/generations 不保留 tile 原始内容
      // ============================================================
      console.log(`[image-edit] upscale: using AI whole-image upscale`);

      const effectiveSize = (() => {
        const ar = aspectRatio || (origW >= origH ? `${origW}:${origH}` : `${origW}:${origH}`);
        return findClosestAspectRatio(ar);
      })();

      // Step 1: 获取视觉描述
      const imageBase64ForVision = await resolveImageToBase64(imageUrl);
      const visionDescription = await describeImageWithVision(
        imageBase64ForVision,
        'Describe this image with extreme visual precision for an AI upscaler. Include: exact subject identity and pose, precise color palette, lighting, textures, background details, composition. Output dense keyword-rich description. No intro text.'
      );
      const descSnippet = visionDescription && visionDescription.length > 20
        ? visionDescription.substring(0, 500) : (prompt || '');

      // Step 2: 构建整图放大 prompt
      const upscalePrompt = [
        `Ultra-high resolution upscale. PRESERVE exactly: same content, colors, style, composition, lighting, every detail. ENHANCE only: add finer textures, sharper edges, crisper details. DO NOT change any element, pose, or color. DO NOT add new objects. masterpiece, best quality, ultra-detailed, 8k uhd, extremely sharp.`,
        descSnippet ? `Content: ${descSnippet.substring(0, 300)}.` : '',
      ].filter(Boolean).join(' ');

      const negativePrompt = '(worst quality, low quality, normal quality:2), blurry, pixelated, jpeg artifacts, noise, grain, changed content, new elements, different colors, altered composition, deformed';

      // Step 3: 提交整图 AI 放大
      const result = await autoTrySubmitImageTask(candidateModels, (m) => ({
        model: m,
        prompt: upscalePrompt,
        size: effectiveSize,
        n: 1,
        image: imageBase64ForVision,
        image_urls: [imageBase64ForVision],
        strength: 0.05,
        input_fidelity: 'high',
        negative_prompt: negativePrompt,
      }), 'AI放大');

      if (result.directUrl) {
        return NextResponse.json({
          success: true,
          imageUrl: result.directUrl,
          action,
          engine: 'ai-upscale-hq',
          usedModel: result.usedModel,
        });
      }

      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        action,
        engine: 'ai-upscale',
        prompt: upscalePrompt,
        usedModel: result.usedModel,
      });
    }


    if (action === 'remove_background') {
      const bgSize = aspectRatio ? findClosestAspectRatio(aspectRatio) : '1:1';
      const result = await autoTrySubmitImageTask(candidateModels, (m) => ({
        model: m,
        prompt: 'Remove the background from this image, keep only the main subject with transparent background. Output PNG format.',
        size: bgSize,
        n: 1,
        image_urls: [imageUrl],
      }), '移除背景');
      if (result.directUrl) {
        return NextResponse.json({ success: true, imageUrl: result.directUrl, action, usedModel: result.usedModel });
      }
      return NextResponse.json({ success: true, taskId: result.taskId, action, usedModel: result.usedModel });
    }

    if (action === 'inpaint') {
      // ============================================================
      // 蒙版修复/擦除 - AI 智能修复策略
      // 将原图 + 蒙版 + 提示词发送给 AI 模型生成新内容，
      // 然后将生成结果与原图按蒙版合成，确保非蒙版区域像素级保留。
      // ============================================================
      if (!maskImage) {
        return NextResponse.json({ success: false, error: '需要提供蒙版图像' }, { status: 400 });
      }

      // 1. 获取原始图片
      let imageBuffer: Buffer;
      try {
        imageBuffer = await fetchImageBuffer(imageUrl);
      } catch (e) {
        console.error('[inpaint] Failed to fetch source image:', e);
        return NextResponse.json({ success: false, error: '无法获取原始图片' }, { status: 500 });
      }

      const origMeta = await sharp(imageBuffer).metadata();
      const origW = origMeta.width || 512;
      const origH = origMeta.height || 512;

      // 2. 解码蒙版并确保与原图尺寸一致
      let maskBuffer: Buffer;
      try {
        if (maskImage.startsWith('data:')) {
          const base64Data = maskImage.replace(/^data:image\/\w+;base64,/, '');
          maskBuffer = Buffer.from(base64Data, 'base64');
        } else {
          maskBuffer = await fetchImageBuffer(maskImage);
        }
        const maskMeta = await sharp(maskBuffer).metadata();
        if (maskMeta.width !== origW || maskMeta.height !== origH) {
          console.log(`[inpaint] Resizing mask from ${maskMeta.width}x${maskMeta.height} to ${origW}x${origH}`);
          maskBuffer = await sharp(maskBuffer)
            .resize(origW, origH, { fit: 'fill', kernel: 'nearest' })
            .png()
            .toBuffer();
        }
      } catch (e) {
        console.error('[inpaint] Failed to process mask:', e);
        return NextResponse.json({ success: false, error: '蒙版处理失败' }, { status: 500 });
      }

      // 3. 检测蒙版是否为空
      // 前端 renderMaskFromStrokes 生成黑色背景+白色笔触的 PNG，alpha 通道全为 255，
      // 因此不能以 alpha > 127 判断蒙版区域，只能以 RGB 亮度判断（白色=蒙版区域）。
      const maskRawData = await sharp(maskBuffer).ensureAlpha().raw().toBuffer();
      let maskPixelCount = 0;
      let minX = origW, minY = origH, maxX = 0, maxY = 0;
      for (let y = 0; y < origH; y++) {
        for (let x = 0; x < origW; x++) {
          const idx = (y * origW + x) * 4;
          const brightness = (maskRawData[idx] + maskRawData[idx + 1] + maskRawData[idx + 2]) / 3;
          if (brightness > 127) {
            maskPixelCount++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maskPixelCount === 0) {
        const modeLabel = editMode === 'erase' ? '擦除区域为空，请先涂抹要擦除的区域' : '蒙版区域为空，请先涂抹要编辑的区域';
        return NextResponse.json({ success: false, error: modeLabel }, { status: 400 });
      }

      const isErase = !prompt || !prompt.trim();
      const totalPixels = origW * origH;
      const maskRatio = (maskPixelCount / totalPixels * 100).toFixed(1);
      console.log(`[inpaint] ${isErase ? 'ERASE' : 'MASK'} mode, image ${origW}x${origH}, mask pixels ${maskPixelCount}/${totalPixels} (${maskRatio}%)`);

      // 4. 生成标准黑白蒙版（白色=需要修复区域，黑色=保留区域）
      const binaryMaskPixels = Buffer.alloc(maskRawData.length);
      for (let i = 0; i < maskRawData.length; i += 4) {
        const brightness = (maskRawData[i] + maskRawData[i + 1] + maskRawData[i + 2]) / 3;
        const isMasked = brightness > 127;
        const val = isMasked ? 255 : 0;
        binaryMaskPixels[i] = val;
        binaryMaskPixels[i + 1] = val;
        binaryMaskPixels[i + 2] = val;
        binaryMaskPixels[i + 3] = 255;
      }
      const binaryMaskBuffer = await sharp(binaryMaskPixels, { raw: { width: origW, height: origH, channels: 4 } })
        .png()
        .toBuffer();

      // 5. 构建提示词
      let inpaintPrompt: string;
      if (isErase) {
        inpaintPrompt = (
          `Seamlessly erase the object in the masked area and fill it with content that naturally ` +
          `continues the surrounding scene. Match the same style, colors, lighting, perspective, ` +
          `and texture of the adjacent areas. The result should look as if the erased content ` +
          `never existed. Do not add any new objects, people, or text.`
        );
      } else {
        inpaintPrompt = prompt!.trim();
      }

      // 6. 确保 imageUrl 是 API 可访问的完整 URL
      let accessibleImageUrl = imageUrl;
      if (imageUrl.startsWith('/')) {
        const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
        if (domain) {
          accessibleImageUrl = `${domain}${imageUrl}`;
        } else {
          // 无公网域名时，将本地图片转为 base64 数据 URL
          try {
            const imgBuffer = await fetchImageBuffer(imageUrl);
            const imgBase64 = `data:image/png;base64,${imgBuffer.toString('base64')}`;
            accessibleImageUrl = imgBase64;
          } catch {
            accessibleImageUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}`;
          }
        }
      }

      // 7. 计算宽高比
      const effectiveSize = aspectRatio ? findClosestAspectRatio(aspectRatio) : '1:1';

      // 8. 构建蒙版 data URL（标准黑白图，白色=修复区域）
      const maskDataUrl = `data:image/png;base64,${binaryMaskBuffer.toString('base64')}`;

      // 9. 发送 AI 生成请求 - 自动尝试管理员系统中的所有可用图像模型
      const requestBody: Record<string, unknown> = {
        prompt: inpaintPrompt,
        negative_prompt: isErase
          ? 'text, watermark, logo, signature, new objects, new people, new animals, low quality, blurry, distorted, deformed'
          : 'low quality, blurry, distorted, deformed, watermark, text, signature',
        size: effectiveSize,
        n: 1,
        image_urls: [accessibleImageUrl],
        mask_image: maskDataUrl,
        strength: isErase ? 0.85 : 0.8,
      };

      console.log(`[inpaint] AI API request: size=${effectiveSize}, strength=${isErase ? 0.85 : 0.8}`);

      let result: { taskId?: string; directUrl?: string; usedModel?: string };
      try {
        // 自动尝试管理员系统中的所有可用图像模型
        result = await autoTrySubmitImageTask(
          candidateModels,
          (m: string) => ({ ...requestBody, model: m }),
          `${editMode === 'erase' ? '擦除' : '蒙版修图'}`,
        );
      } catch (autoTryErr: unknown) {
        // 所有 image 类型模型都失败，回退到视觉模型生成
        console.log(`[inpaint] All image models failed, trying chat-vision fallback...`);
        const fallbackResult = await autoTryChatVisionFallback(
          await resolveImageToBase64(accessibleImageUrl), maskDataUrl || null, inpaintPrompt, 'inpaint'
        );
        if (fallbackResult) {
          result = fallbackResult as { taskId: string; directUrl?: string; usedModel?: string };
        } else {
          return NextResponse.json({ success: false, error: '图像编辑失败，当前无可用模型支持图像编辑，请在管理员系统中配置支持图生图的模型' }, { status: 500 });
        }
      }

      // 10. 处理结果
      if (result.directUrl) {
        try {
          // 下载 AI 生成的结果
          const resultBuffer = await fetchImageBuffer(result.directUrl);
          const resultMeta = await sharp(resultBuffer).metadata();

          // 确保 AI 结果尺寸与原图一致
          const resizedResult = (resultMeta.width !== origW || resultMeta.height !== origH)
            ? await sharp(resultBuffer).resize(origW, origH, { fit: 'fill' }).png().toBuffer()
            : resultBuffer;

          // 用蒙版合成：AI结果在白色区域(蒙版区域)，原图在黑色区域(保留区域)
          // 方法：将模糊蒙版的亮度直接作为AI结果的alpha通道，然后叠加到原图上
          // 注意：不能用 sharp composite dest-in + blur mask，因为 blur 会导致黑色区域也有非零值
          //       造成整个图像半透明，原图被AI结果覆盖
          const softAlphaMask = await sharp(binaryMaskBuffer)
            .threshold(127)
            .blur(8)  // 边界柔化 8px
            .grayscale()
            .raw()
            .toBuffer();

          // 将 AI 结果转换为 RGBA，手动设置 alpha 通道
          const aiRaw = await sharp(resizedResult).ensureAlpha().raw().toBuffer();
          for (let i = 0; i < origW * origH; i++) {
            aiRaw[i * 4 + 3] = softAlphaMask[i]; // alpha = 蒙版亮度
          }
          const aiWithAlpha = await sharp(aiRaw, { raw: { width: origW, height: origH, channels: 4 } }).png().toBuffer();

          const compositeResult = await sharp(imageBuffer)
            .composite([{ input: aiWithAlpha, blend: 'over' }])
            .png()
            .toBuffer();

          // 保存合成结果
          const resultFileName = `inpaint_${Date.now()}.png`;
          let compositeUrl: string;

          if (isS3Available()) {
            compositeUrl = (await uploadImageToS3(compositeResult, resultFileName, 'image/png')) || '';
          } else {
            compositeUrl = (await saveImageFile(compositeResult, resultFileName, 'inpaint')) || `/api/serve-upload/inpaint/${resultFileName}`;
          }
          console.log(`[inpaint] AI composite result saved: ${resultFileName}`);

          return NextResponse.json({ success: true, imageUrl: compositeUrl, action, engine: 'ai-composite' });
        } catch (compositeErr) {
          console.error('[inpaint] Composite failed, returning raw AI result:', compositeErr);
          // 合成失败时直接返回 AI 结果
          return NextResponse.json({ success: true, imageUrl: result.directUrl, action, engine: 'ai-raw' });
        }
      }

      // 异步结果 - 返回 taskId 给前端轮询，前端做蒙版合成
      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        action,
        cropInfo: { cropX: 0, cropY: 0, cropW: origW, cropH: origH, origW, origH },
        engine: 'ai-api',
      });
    }

    if (action === 'outpaint') {
      // ============================================================
      // 扩图 - 向外扩展画面
      // 支持两种模式：
      // 1. 即梦风格方向性扩展 (expandPadding): 指定 top/right/bottom/left 像素
      // 2. 传统比例扩展 (expandRatio + expandScale): 指定目标比例和倍率
      // 策略：合成扩展画布(原图按偏移放置+灰色填充) + mask → API → 合成原图到结果
      // ============================================================

      // 获取原始图片
      let imageBuffer: Buffer;
      try {
        imageBuffer = await fetchImageBuffer(imageUrl);
      } catch (e) {
        console.error('Failed to fetch source image for outpaint:', e);
        return NextResponse.json({ success: false, error: '无法获取原始图片' }, { status: 500 });
      }

      // 获取原图尺寸
      const origMeta = await sharp(imageBuffer).metadata();
      const origW = origMeta.width || 512;
      const origH = origMeta.height || 512;

      // 计算目标扩展尺寸
      let targetW: number, targetH: number;
      let offsetX: number, offsetY: number;

      if (expandPadding && (expandPadding.top > 0 || expandPadding.right > 0 || expandPadding.bottom > 0 || expandPadding.left > 0)) {
        // 即梦风格方向性扩展：直接使用像素偏移量
        const pad = expandPadding;
        targetW = origW + pad.left + pad.right;
        targetH = origH + pad.top + pad.bottom;
        offsetX = pad.left;
        offsetY = pad.top;
        console.log(`[outpaint] directional padding: top=${pad.top} right=${pad.right} bottom=${pad.bottom} left=${pad.left}`);
      } else {
        // 传统比例扩展
        const ratio = expandRatio || '1:1';
        const scale = expandScale || 1;

        if (ratio === '原始比例') {
          targetW = Math.round(origW * scale);
          targetH = Math.round(origH * scale);
        } else {
          const [rw, rh] = parseRatio(ratio);
          const targetRatio = rw / rh;
          const origRatio = origW / origH;

          if (origRatio >= targetRatio) {
            targetW = origW;
            targetH = Math.round(origW / targetRatio);
          } else {
            targetH = origH;
            targetW = Math.round(origH * targetRatio);
          }

          if (scale > 1) {
            targetW = Math.round(targetW * scale);
            targetH = Math.round(targetH * scale);
          }
        }

        // 确保尺寸不小于原图
        targetW = Math.max(origW, targetW);
        targetH = Math.max(origH, targetH);

        // 原图居中放置
        offsetX = Math.round((targetW - origW) / 2);
        offsetY = Math.round((targetH - origH) / 2);
      }

      // 对齐到8的倍数（API要求）
      targetW = Math.ceil(targetW / 8) * 8;
      targetH = Math.ceil(targetH / 8) * 8;

      // 原图在目标画布中的位置
      const srcW = origW;
      const srcH = origH;

      console.log(`[outpaint] orig ${origW}x${origH} → target ${targetW}x${targetH}, offset (${offsetX},${offsetY})`);

      // 使用 sharp 合成扩展画布
      // 1. 创建背景画布（灰色填充表示需要扩展的区域）
      // 2. 将原图贴到 offsetX, offsetY 位置
      const resizedOriginal = await sharp(imageBuffer)
        .resize(srcW, srcH, { fit: 'fill' })
        .toBuffer();

      // 创建灰色背景
      const backgroundBuffer = await sharp({
        create: {
          width: targetW,
          height: targetH,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
        },
      }).png().toBuffer();

      // 合成：原图覆盖在灰色背景上
      const compositeImage = await sharp(backgroundBuffer)
        .composite([{
          input: resizedOriginal,
          left: offsetX,
          top: offsetY,
        }])
        .png()
        .toBuffer();

      // 创建蒙版：原图区域=黑(保留)，扩展区域=白(需要AI生成)
      const maskFullWhite = await sharp({
        create: {
          width: targetW,
          height: targetH,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      }).png().toBuffer();

      const maskBlackSrc = await sharp({
        create: {
          width: srcW,
          height: srcH,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      }).png().toBuffer();

      const finalMask = await sharp(maskFullWhite)
        .composite([{
          input: maskBlackSrc,
          left: offsetX,
          top: offsetY,
        }])
        .blur(8) // IOPaint sd_mask_blur 风格，确保衔接处无痕迹
        .png()
        .toBuffer();

      // 保存合成图和蒙版到临时目录（生产环境 public 目录可能只读，统一使用 /tmp）
      const tmpDir = path.join('/tmp', 'outpaint');
      await fs.mkdir(tmpDir, { recursive: true });
      const timestamp = Date.now();
      const compositeFileName = `composite_${timestamp}.png`;
      const maskFileName = `mask_${timestamp}.png`;
      const compositePath = path.join(tmpDir, compositeFileName);
      const maskPath = path.join(tmpDir, maskFileName);
      await fs.writeFile(compositePath, compositeImage);
      await fs.writeFile(maskPath, finalMask);

      // 始终使用 base64 数据 URL 发送图片（避免文件系统权限问题和外部 API 访问问题）
      const compositeBase64 = `data:image/png;base64,${compositeImage.toString('base64')}`;
      const maskFileBase64 = `data:image/png;base64,${finalMask.toString('base64')}`;

      // 构建扩图方向的提示词
      const directionHints: string[] = [];
      if (offsetY > 0) directionHints.push('above');
      if (offsetY + srcH < targetH) directionHints.push('below');
      if (offsetX > 0) directionHints.push('to the left');
      if (offsetX + srcW < targetW) directionHints.push('to the right');

      const directionText = directionHints.length > 0
        ? `Extend the scene ${directionHints.join(' and ')} of the original content.`
        : 'Extend the scene outward in all directions.';

      const outpaintPrompt = prompt || (
        `Image outpainting / expansion. ${directionText} ` +
        `The provided image has the original content in the center surrounded by a gray placeholder area. ` +
        `Keep the center original content exactly as-is and only generate new content in the gray border areas. ` +
        `The new content should seamlessly connect with the original scene, matching its style, lighting, colors, and perspective. ` +
        `Do not modify, crop, or alter the original center content in any way.`
      );

      // ============================================================
      // 即梦风格扩图策略
      // 核心思路：如果目标画布超出模型支持尺寸，先缩小到模型尺寸生成，
      // 然后提取 AI 生成的边缘内容，放大回原始尺寸，与原图合成
      // ============================================================

      // 确定模型支持的最大尺寸
      const firstModel = candidateModels[0]?.model || '';
      let modelMaxPx = 1024;
      if (firstModel.toLowerCase().includes('gpt-image')) {
        modelMaxPx = 4096; // GPT Image 2 支持较大尺寸
      } else if (firstModel.toLowerCase().includes('gemini')) {
        modelMaxPx = 2048; // Gemini 支持中等尺寸
      }
      const needsDownscale = targetW > modelMaxPx || targetH > modelMaxPx;

      // 计算缩小比例（如果目标超出模型限制）
      const scaleFactor = needsDownscale ? Math.min(modelMaxPx / targetW, modelMaxPx / targetH) : 1;
      const scaledTargetW = Math.max(8, Math.ceil(targetW * scaleFactor / 8) * 8);
      const scaledTargetH = Math.max(8, Math.ceil(targetH * scaleFactor / 8) * 8);
      const scaledOffsetX = Math.round(offsetX * scaleFactor);
      const scaledOffsetY = Math.round(offsetY * scaleFactor);
      const scaledSrcW = Math.round(srcW * scaleFactor);
      const scaledSrcH = Math.round(srcH * scaleFactor);

      console.log(`[outpaint] ${needsDownscale ? 'DOWNSCALE' : 'DIRECT'}: target ${targetW}x${targetH}, scaled ${scaledTargetW}x${scaledTargetH}, scale=${scaleFactor.toFixed(3)}`);

      // 清理临时文件（延迟清理，异步任务需要文件存在）
      const cleanupFiles = async () => {
        try { await fs.unlink(compositePath); } catch (_) { /* ignore */ }
        try { await fs.unlink(maskPath); } catch (_) { /* ignore */ }
      };

      // 辅助函数：将 AI 生成结果与原图合成
      // 策略：AI 在缩小尺寸上生成 → 提取扩展边缘 → 放大回原始尺寸 → 与原图合成
      const compositeOriginalOnResult = async (resultBuffer: Buffer): Promise<Buffer> => {
        const resultMeta = await sharp(resultBuffer).metadata();
        const resultW = resultMeta.width || scaledTargetW;
        const resultH = resultMeta.height || scaledTargetH;

        // Step 1: 将 AI 结果 resize 到缩放后的目标尺寸（如果 API 返回尺寸不一致）
        let aiResult = resultBuffer;
        if (resultW !== scaledTargetW || resultH !== scaledTargetH) {
          aiResult = await sharp(resultBuffer)
            .resize(scaledTargetW, scaledTargetH, { fit: 'fill' })
            .png()
            .toBuffer();
        }

        // Step 2: 在缩放尺寸上将原图叠在 AI 结果上（像素级保留原图区域）
        const scaledOriginal = await sharp(imageBuffer)
          .resize(scaledSrcW, scaledSrcH, { fit: 'fill' })
          .png()
          .toBuffer();

        const scaledComposite = await sharp(aiResult)
          .composite([{
            input: scaledOriginal,
            left: scaledOffsetX,
            top: scaledOffsetY,
            blend: 'over',
          }])
          .png()
          .toBuffer();

        // Step 3: 将合成结果放大到原始目标尺寸
        const finalComposite = await sharp(scaledComposite)
          .resize(targetW, targetH, { fit: 'fill' })
          .png()
          .toBuffer();

        return finalComposite;
      };

      // Build request body for AI generation using scaled target size
      const genSize = `${scaledTargetW}x${scaledTargetH}`;
      const genBody: Record<string, unknown> = {
        model: modelStr,
        prompt: outpaintPrompt,
        n: 1,
        size: genSize,
      };
      const outpaintNegPrompt = '(worst quality, low quality, normal quality:2), blurry, pixelated, jpeg artifacts, noise, grain, changed content, new elements, different colors, altered composition, deformed';
      if (outpaintNegPrompt) genBody.negative_prompt = outpaintNegPrompt;

      // Submit to AI model API
      const cm = candidateModels[0];
      const result = await submitImageTask(
        cm.apiBaseUrl, cm.apiKey, genBody, '/images/generations', cm
      );

      if (result.directUrl) {
        // 同步结果 - 合成原图到中心
        try {
          const resultBuffer = await fetchImageBuffer(result.directUrl);
          const finalBuffer = await compositeOriginalOnResult(resultBuffer);

          const resultFileName = `outpaint_${timestamp}.png`;
          let compositeResultUrl: string;

          if (isS3Available()) {
            compositeResultUrl = (await uploadImageToS3(finalBuffer, resultFileName, 'image/png')) || '';
          } else {
            compositeResultUrl = (await saveImageFile(finalBuffer, resultFileName, 'outpaint')) || `/api/serve-upload/outpaint/${resultFileName}`;
          }
          console.log(`[outpaint] Sync result saved: ${resultFileName}`);

          // 清理临时文件
          await cleanupFiles();

          return NextResponse.json({ success: true, imageUrl: compositeResultUrl, action, targetWidth: targetW, targetHeight: targetH });
        } catch (compositeErr) {
          console.error('[outpaint] Composite failed, using raw result:', compositeErr);
          await cleanupFiles();
          return NextResponse.json({ success: true, imageUrl: result.directUrl, action, targetWidth: targetW, targetHeight: targetH });
        }
      }

      // 异步结果 - 返回 taskId + 合成信息，前端轮询后需后端合成
      // 为了简化，异步结果也返回 cropInfo 供前端合成
      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        action,
        targetWidth: targetW,
        targetHeight: targetH,
        outpaintInfo: { offsetX, offsetY, srcW, srcH, targetW, targetH, origW, origH, scaleFactor, scaledTargetW, scaledTargetH, scaledOffsetX, scaledOffsetY, scaledSrcW, scaledSrcH },
      });
    }

    return NextResponse.json({ success: false, error: `不支持的操作: ${action}` }, { status: 400 });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Image edit error:', errMsg);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  }
}
