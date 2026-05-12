import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderForFeature, findAllProvidersForType, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import sharp from 'sharp';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';

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
export const maxDuration = 120;
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
  // local path
  if (url.startsWith('/')) {
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    const localPath = path.join(workspacePath, 'public', url);
    if (fsSync.existsSync(localPath)) return fsSync.readFileSync(localPath);
    // Try localhost fetch
    const fullUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${url}`;
    const res = await fetch(fullUrl, { signal: AbortSignal.timeout(10000) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    throw new Error(`Cannot access local image: ${url}`);
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
  endpoint: '/images/generations' | '/images/edits' = '/images/generations'
): Promise<{ taskId?: string; directUrl?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  // Debug: log key params for image-to-image verification
  const hasImageUrls = !!(requestBody as Record<string, unknown>)?.image_urls;
  const urls = (requestBody as Record<string, unknown>)?.image_urls as string[] | undefined;
  const str = (requestBody as Record<string, unknown>)?.strength;
  const sz = (requestBody as Record<string, unknown>)?.size;
  const pmt = String((requestBody as Record<string, unknown>)?.prompt || '').substring(0, 80);
  console.info(`[submitImageTask] API call: endpoint=${endpoint}, hasImageUrls=${hasImageUrls}, urlCount=${urls?.length || 0}, urlType=${urls?.[0]?.substring(0, 30) || 'N/A'}, strength=${str}, size=${sz}, prompt=${pmt}...`);

  const submitResponse = await fetchWithV1Retry(
    apiBaseUrl,
    endpoint,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    }
  );

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
    if (errorMsg.includes('apimart_error') || errorMsg.includes('try again later')) {
      throw new ModelCapabilityError(`当前模型暂时不可用，尝试切换其他模型...`);
    }
    if (errorMsg.includes('Invalid API key') || errorMsg.includes('invalid api_key')) {
      throw new Error(`API 密钥无效，请联系管理员检查配置`);
    }

    throw new Error(errorMsg);
  }

  const submitResult = await submitResponse.json();
  const taskId = submitResult.data?.[0]?.task_id;

  if (!taskId) {
    const directUrl = submitResult.data?.[0]?.url;
    if (directUrl) {
      return { directUrl };
    }
    throw new Error('未获取到任务ID');
  }

  return { taskId };
}

/**
 * 从文本解析 SSE 格式的 chat/completions 响应
 * 用于处理 APImart 代理即使 stream:false 也返回 SSE 流的情况
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
  candidateModels: Array<{ model: string; apiKey: string; apiBaseUrl: string; source: string }>,
  buildRequestBody: (model: string) => Record<string, unknown>,
  operation: string,
  endpoint: '/images/generations' | '/images/edits' = '/images/generations',
): Promise<{ taskId?: string; directUrl?: string; usedModel?: string }> {
  const errors: string[] = [];
  
  for (const candidate of candidateModels) {
    try {
      console.log(`[image-edit] ${operation}: Trying model ${candidate.model} (source: ${candidate.source}, endpoint: ${endpoint})`);
      const requestBody = buildRequestBody(candidate.model);
      const result = await submitImageTask(candidate.apiBaseUrl, candidate.apiKey, requestBody, endpoint);
      return { ...result, usedModel: candidate.model };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate.model}: ${errMsg}`);
      console.warn(`[image-edit] ${operation}: Model ${candidate.model} failed: ${errMsg}`);
      
      // ModelCapabilityError → 继续尝试下一个模型
      if (err instanceof ModelCapabilityError) {
        continue;
      }
      // 其他错误（网络/超时等）→ 不继续尝试，直接抛出
      throw err;
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
 * 使用 APImart 的 GET /tasks/{taskId} 接口查询状态
 */
async function pollTaskUntilComplete(
  taskId: string,
  apiKey: string,
  apiBaseUrl: string,
  maxAttempts: number = 80,
  intervalMs: number = 3000,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, intervalMs));

    try {
      const pollRes = await fetch(
        `${apiBaseUrl}/tasks/${taskId}?language=zh`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!pollRes.ok) continue;

      const pollData = await pollRes.json();
      const taskData = pollData.data;
      const status = taskData?.status;

      if (status === 'completed') {
        // 从 result.images 提取图片 URL
        const images = taskData?.result?.images;
        if (images && images.length > 0) {
          const rawUrl = images[0].url || images[0].image_url || images[0].src;
          const imageUrl = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl;
          if (imageUrl) return imageUrl;
        }
        // 兜底：b64_json
        if (taskData?.result?.b64_json) {
          return `data:image/png;base64,${taskData.result.b64_json}`;
        }
        throw new Error(`Tile task ${taskId} completed but no image URL found`);
      }
      if (status === 'failed') {
        const failReason = taskData?.error?.message || 'unknown';
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
  const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
  const publicDir = path.join(workspacePath, 'public', 'upscaled');
  await fs.mkdir(publicDir, { recursive: true });
  const filePath = path.join(publicDir, filename);
  await fs.writeFile(filePath, buffer);
  return `/upscaled/${filename}`;
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
      targetWidth,
      targetHeight,
      aspectRatio,
      angleMode = 'image',
      rotation = 0,
      tilt = 0,
      zoom = 1,
      model = 'gemini-2.5-flash-image-preview',
    } = body;

    // 放大/擦除/蒙版 均使用管理员系统的 image 类型模型
    // 策略：自动识别管理员配置的所有可用 image 模型，按优先级逐一尝试
    // 1. 先尝试前端指定的模型（如果匹配到 provider）
    // 2. 再尝试管理员配置的其他 image 类型 provider 的模型
    // 3. 最后使用环境变量兜底
    const allImageProviders = await findAllProvidersForType('image');
    
    // 构建候选模型列表：前端指定的模型优先，然后是其他所有可用模型
    const candidateModels: Array<{ model: string; apiKey: string; apiBaseUrl: string; source: string }> = [];
    const triedModels = new Set<string>();
    
    // 1. 前端指定的模型（如果匹配到 provider）
    const preferredProvider = await findProviderForModel(model, 'image')
      || await findProviderForModel(model, 'universal');
    if (preferredProvider) {
      candidateModels.push({
        model,
        apiKey: preferredProvider.apiKey,
        apiBaseUrl: normalizeApiBaseUrl(preferredProvider.baseUrl),
        source: 'preferred',
      });
      triedModels.add(model);
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
          });
          triedModels.add(m);
        }
      }
    }
    
    // 3. 环境变量兜底
    const envApiKey = process.env.APIMART_API_KEY || '';
    const envApiBaseUrl = normalizeApiBaseUrl(process.env.APIMART_BASE_URL || 'https://api.apimart.ai');
    if (envApiKey && candidateModels.length === 0) {
      candidateModels.push({
        model,
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
          const fullPath = `${process.env.COZE_WORKSPACE_PATH || '/workspace/projects'}/public/${localPath}`;
          const fs = await import('fs/promises');
          const buf = await fs.readFile(fullPath);
          const ext = localPath.split('.').pop()?.toLowerCase() || 'png';
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
          return `data:${mime};base64,${buf.toString('base64')}`;
        }
        // External URL: fetch it
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get('content-type') || 'image/png';
        return `data:${ct};base64,${buf.toString('base64')}`;
      }
      // Relative path like /uploads/xxx.png
      const fs = await import('fs/promises');
      const fullPath = `${process.env.COZE_WORKSPACE_PATH || '/workspace/projects'}/public${url.startsWith('/') ? url : '/' + url}`;
      const buf = await fs.readFile(fullPath);
      const ext = url.split('.').pop()?.toLowerCase() || 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    };

    if (action === 'multi_angle') {
      const yawText = rotation > 0 ? `${Math.abs(rotation)} degrees to the right` : rotation < 0 ? `${Math.abs(rotation)} degrees to the left` : 'front view';
      const pitchText = tilt > 0 ? `${Math.abs(tilt)} degrees high angle looking down` : tilt < 0 ? `${Math.abs(tilt)} degrees low angle looking up` : 'level camera height';
      const dollyText = zoom > 1.08 ? 'closer camera, tighter framing' : zoom < 0.92 ? 'pulled back camera, wider framing' : 'medium framing';
      const multiAnglePrompt = prompt || (angleMode === 'image'
        ? `Pseudo-3D AI photography studio. Reconstruct the reference image as a coherent three-dimensional object/subject and generate a new rendered view with the subject itself rotated ${yawText}. Preserve the same identity, design, materials, labels, colors, proportions, outfit/product details and lighting style. Infer plausible hidden sides instead of warping the flat image. Keep a clean professional studio background, realistic perspective, depth, occlusion, shadows, reflections, and high quality product/character photography. Camera pitch: ${pitchText}. Framing: ${dollyText}. Do not output a flat 2D rotated canvas, do not stretch or skew the original image.`
        : `Pseudo-3D AI photography studio. Keep the subject/object fixed as a real three-dimensional scene and move a virtual camera around it: yaw ${yawText}, pitch ${pitchText}, ${dollyText}. Preserve the same identity, design, materials, labels, colors, proportions and environment mood from the reference. Generate a new photographic view with real perspective, depth, occlusion, shadows, reflections, and inferred unseen geometry. Do not rotate the flat source image; re-render the scene from the requested camera angle.`);

      const result = await autoTrySubmitImageTask(candidateModels, (m) => ({
        model: m,
        prompt: multiAnglePrompt,
        size: '1:1',
        n: 1,
        image_urls: [imageUrl],
      }), '多角度');
      if (result.directUrl) {
        return NextResponse.json({ success: true, imageUrl: result.directUrl, action, usedModel: result.usedModel });
      }
      return NextResponse.json({ success: true, taskId: result.taskId, action, prompt: multiAnglePrompt, usedModel: result.usedModel });
    }

    if (action === 'upscale') {
      // ============================================================
      // AI 分块超清放大 (Tile-based Upscale)
      //
      // 核心思路：将原图切成 N 块，每块单独 AI 放大，最后无缝拼接
      // 优势：每块区域 AI 专注处理，细节更丰富；整体融合后画质显著提升
      //
      // 流程：Split → AI Upscale each tile → Merge → 返回最终图片
      // 分块策略：小图(<800px) 2×2=4块，中图(<1600px) 2×3=6块，大图 3×3=9块
      // ============================================================

      const scaleVal = body.scale || 2;
      const origW = body.originalWidth || 512;
      const origH = body.originalHeight || 512;
      const targetW = targetWidth || origW * scaleVal;
      const targetH = targetHeight || origH * scaleVal;

      // ---- 分块策略 ----
      const maxEdge = Math.max(origW, origH);
      let cols: number, rows: number;
      if (maxEdge < 800) { cols = 2; rows = 2; }       // 4 tiles
      else if (maxEdge < 1600) { cols = 2; rows = 3; }  // 6 tiles
      else { cols = 3; rows = 3; }                       // 9 tiles

      const totalTiles = cols * rows;
      const overlap = 24; // 重叠像素，保证拼接无缝

      console.log(`[image-edit] upscale: Tile-based mode. Original: ${origW}x${origH}, Scale: ${scaleVal}x, Target: ${targetW}x${targetH}, Grid: ${cols}x${rows}=${totalTiles} tiles, Overlap: ${overlap}px`);

      // ---- Step 1: 下载原图并分块 ----
      let imageBuffer: Buffer;
      try {
        imageBuffer = await fetchImageBuffer(imageUrl);
      } catch (e) {
        console.error('[image-edit] upscale: Failed to fetch source image:', e);
        return NextResponse.json({ success: false, error: '无法获取原始图片' }, { status: 500 });
      }

      const { tiles } = await splitImageIntoTiles(imageBuffer, cols, rows, overlap);
      console.log(`[image-edit] upscale: Split into ${tiles.length} tiles`);

      // ---- Step 2: 获取整图视觉描述（用于 prompt 增强）----
      const imageBase64ForVision = await resolveImageToBase64(imageUrl);
      const visionDescription = await describeImageWithVision(
        imageBase64ForVision,
        'Describe this image with extreme visual precision for an AI upscaler. Include: exact subject identity and pose, precise color palette, lighting, textures, background details, composition. Output dense keyword-rich description. No intro text.'
      );
      const descSnippet = visionDescription && visionDescription.length > 20
        ? visionDescription.substring(0, 500) : (prompt || '');

      // ---- Step 3: 逐 tile 提交 AI 放大任务 ----
      // 每个 tile 的 prompt 更精简，专注于保留+增强细节
      const tileUpscalePrompt = [
        `Ultra-high resolution upscale. PRESERVE exactly: same content, colors, style, composition, lighting. ENHANCE only: add finer textures, sharper edges, crisper details. DO NOT change any element or add new objects. masterpiece, best quality, ultra-detailed, 8k uhd, extremely sharp.`,
        descSnippet ? `Content: ${descSnippet.substring(0, 200)}.` : '',
      ].filter(Boolean).join(' ');

      const tileNegativePrompt = '(worst quality, low quality, normal quality:2), blurry, pixelated, jpeg artifacts, noise, grain, changed content, new elements, different colors, altered composition';

      // 尝试找到一个可用的模型组合
      let usedModel = '';
      let usedApiKey = '';
      let usedApiBaseUrl = '';

      // 尝试提交一个测试 tile 确认模型可用
      const testTile = tiles[0];
      const testTileBase64 = `data:image/png;base64,${testTile.buffer.toString('base64')}`;
      const testTileRatio = (() => {
        const g = (a: number, b: number): number => b === 0 ? a : g(b, a % b);
        const gcdVal = g(testTile.width, testTile.height);
        const rw = testTile.width / gcdVal;
        const rh = testTile.height / gcdVal;
        const supported = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
        let best = supported[0]; let bestD = Infinity;
        for (const sr of supported) {
          const [sw, sh] = sr.split(':').map(Number);
          const d = Math.abs(rw / rh - sw / sh);
          if (d < bestD) { bestD = d; best = sr; }
        }
        return best;
      })();

      let testTaskId: string | undefined;
      let testDirectUrl: string | undefined;

      // 尝试使用候选模型提交测试 tile
      for (const candidate of candidateModels) {
        try {
          console.log(`[image-edit] upscale: Testing model ${candidate.model} for tile processing`);
          const result = await submitImageTask(
            candidate.apiBaseUrl, candidate.apiKey,
            {
              model: candidate.model,
              prompt: tileUpscalePrompt,
              size: testTileRatio,
              n: 1,
              image: testTileBase64,
              image_urls: [testTileBase64],
              strength: 0.03, // 极低 strength，最大限度保留
              input_fidelity: 'high',
              negative_prompt: tileNegativePrompt,
            }
          );
          testTaskId = result.taskId;
          testDirectUrl = result.directUrl;
          usedModel = candidate.model;
          usedApiKey = candidate.apiKey;
          usedApiBaseUrl = candidate.apiBaseUrl;
          console.log(`[image-edit] upscale: Model ${candidate.model} accepted. Proceeding with all tiles.`);
          break;
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[image-edit] upscale: Model ${candidate.model} rejected: ${errMsg}`);
          if (err instanceof ModelCapabilityError) continue;
          // 非模型能力错误，直接抛出
          throw err;
        }
      }

      if (!usedModel) {
        return NextResponse.json({
          success: false,
          error: '没有可用的图像模型支持放大操作，请在管理员系统配置图像模型',
        }, { status: 500 });
      }

      // ---- Step 4: 并行提交剩余 tile 任务 ----
      // 测试 tile 已提交，现在提交其余 tiles
      const tileTaskIds: Array<{ taskId?: string; directUrl?: string; tileIndex: number }> = [
        { taskId: testTaskId, directUrl: testDirectUrl, tileIndex: 0 }
      ];

      // 并行提交其余 tiles（限制并发为 3，避免 rate limit）
      const batchSize = 3;
      for (let batchStart = 1; batchStart < tiles.length; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, tiles.length);
        const batchPromises = [];

        for (let i = batchStart; i < batchEnd; i++) {
          const tile = tiles[i];
          const tileBase64 = `data:image/png;base64,${tile.buffer.toString('base64')}`;
          const tileRatio = (() => {
            const g = (a: number, b: number): number => b === 0 ? a : g(b, a % b);
            const gcdVal = g(tile.width, tile.height);
            const rw = tile.width / gcdVal;
            const rh = tile.height / gcdVal;
            const supported = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
            let best = supported[0]; let bestD = Infinity;
            for (const sr of supported) {
              const [sw, sh] = sr.split(':').map(Number);
              const d = Math.abs(rw / rh - sw / sh);
              if (d < bestD) { bestD = d; best = sr; }
            }
            return best;
          })();

          batchPromises.push(
            submitImageTask(usedApiBaseUrl, usedApiKey, {
              model: usedModel,
              prompt: tileUpscalePrompt,
              size: tileRatio,
              n: 1,
              image: tileBase64,
              image_urls: [tileBase64],
              strength: 0.03,
              input_fidelity: 'high',
              negative_prompt: tileNegativePrompt,
            }).then(result => ({ ...result, tileIndex: i }))
          );
        }

        const batchResults = await Promise.all(batchPromises);
        tileTaskIds.push(...batchResults);
        console.log(`[image-edit] upscale: Submitted batch ${batchStart}-${batchEnd - 1} of ${tiles.length} tiles`);
      }

      // ---- Step 5: 轮询所有 tile 任务直到完成 ----
      console.log(`[image-edit] upscale: Polling ${tileTaskIds.length} tile tasks...`);

      const tileImageUrls: string[] = new Array(tiles.length).fill('');
      const pollPromises = tileTaskIds.map(async (entry) => {
        if (entry.directUrl) {
          tileImageUrls[entry.tileIndex] = entry.directUrl;
          return;
        }
        if (!entry.taskId) {
          throw new Error(`Tile ${entry.tileIndex} has no taskId or directUrl`);
        }
        const url = await pollTaskUntilComplete(entry.taskId, usedApiKey, usedApiBaseUrl);
        tileImageUrls[entry.tileIndex] = url;
      });

      await Promise.all(pollPromises);
      console.log(`[image-edit] upscale: All ${tiles.length} tiles completed`);

      // ---- Step 6: 下载所有 tile 结果图片 ----
      const tileResultBuffers: Buffer[] = [];
      for (let i = 0; i < tileImageUrls.length; i++) {
        const url = tileImageUrls[i];
        console.log(`[image-edit] upscale: Downloading tile ${i} result from ${url.substring(0, 80)}...`);
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`Failed to download tile ${i}: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        tileResultBuffers.push(buf);
      }

      // ---- Step 7: 合并 tiles ----
      console.log(`[image-edit] upscale: Merging ${tiles.length} tiles into ${targetW}x${targetH} image`);
      const mergedBuffer = await mergeTiles(tileResultBuffers, tiles, scaleVal, targetW, targetH);

      // ---- Step 8: 保存合并结果并返回 ----
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const filename = `upscale_${timestamp}_${randomSuffix}.png`;
      const savedPath = await saveBufferToPublic(mergedBuffer, filename);

      // 构建完整 URL
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
      const fullUrl = `${domain}${savedPath}`;

      console.log(`[image-edit] upscale: Tile-based upscale complete. Output: ${savedPath} (${(mergedBuffer.length / 1024).toFixed(0)}KB)`);

      return NextResponse.json({
        success: true,
        imageUrl: fullUrl,
        action,
        engine: 'tile-upscale',
        usedModel,
        tileInfo: { cols, rows, totalTiles, overlap, scale: scaleVal },
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

          // 创建渐变融合蒙版：在蒙版边界做柔和过渡，避免硬边
          const blendMask = await sharp(binaryMaskBuffer)
            .threshold(127)
            .blur(8)  // 边界柔化 8px
            .png()
            .toBuffer();

          // 用蒙版合成：AI结果在白色区域(蒙版区域)，原图在黑色区域(保留区域)
          // 步骤：1) 给AI结果加上蒙版alpha 2) 叠加到原图上
          const resultWithAlpha = await sharp(resizedResult)
            .composite([{ input: blendMask, blend: 'dest-in' }])
            .png()
            .toBuffer();

          const compositeResult = await sharp(imageBuffer)
            .composite([{ input: resultWithAlpha, blend: 'over' }])
            .png()
            .toBuffer();

          // 保存合成结果
          const publicDir = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', 'inpaint');
          await fs.mkdir(publicDir, { recursive: true });
          const resultFileName = `inpaint_${Date.now()}.png`;
          const resultPath = path.join(publicDir, resultFileName);
          await fs.writeFile(resultPath, compositeResult);

          const compositeUrl = `/inpaint/${resultFileName}`;
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
      // 策略：合成扩展画布(原图居中+灰色填充) + mask → API → 合成原图到结果中心
      // 核心改进：不依赖 API 的 mask_image 支持，而是在结果上合成原图确保像素级保留
      // ============================================================
      const ratio = expandRatio || '1:1';
      const scale = expandScale || 1;

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
      // 原则：倍数和比例是先后叠加融合关系
      //   Step1: 根据比例计算目标画布（原图完整放入，不足方向扩展）
      //   Step2: 在比例扩展基础上再应用倍数放大
      let targetW: number, targetH: number;

      if (ratio === '原始比例') {
        // 原始比例 + scale：等比放大
        targetW = Math.round(origW * scale);
        targetH = Math.round(origH * scale);
      } else {
        // 指定比例：原图完整放入目标画布，不足方向扩展
        const [rw, rh] = parseRatio(ratio);
        const targetRatio = rw / rh;
        const origRatio = origW / origH;

        if (origRatio >= targetRatio) {
          // 原图更宽或等宽：以原图宽度为基准，高度按目标比例扩展
          targetW = origW;
          targetH = Math.round(origW / targetRatio);
        } else {
          // 原图更高：以原图高度为基准，宽度按目标比例扩展
          targetH = origH;
          targetW = Math.round(origH * targetRatio);
        }

        // 应用 scale 倍数（在比例扩展基础上再放大）
        if (scale > 1) {
          targetW = Math.round(targetW * scale);
          targetH = Math.round(targetH * scale);
        }
      }

      // 确保尺寸不小于原图
      targetW = Math.max(origW, targetW);
      targetH = Math.max(origH, targetH);
      // 对齐到8的倍数（API要求）
      targetW = Math.ceil(targetW / 8) * 8;
      targetH = Math.ceil(targetH / 8) * 8;

      // 原图在目标画布中的位置（居中放置，保持原始像素大小）
      const srcW = origW;
      const srcH = origH;
      const offsetX = Math.round((targetW - srcW) / 2);
      const offsetY = Math.round((targetH - srcH) / 2);

      console.log(`[outpaint] orig ${origW}x${origH} → target ${targetW}x${targetH}, offset (${offsetX},${offsetY}), ratio=${ratio}, scale=${scale}`);

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

      // 保存合成图和蒙版到临时文件（避免 base64 过大导致 API 请求失败）
      const publicDir = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', 'outpaint');
      await fs.mkdir(publicDir, { recursive: true });
      const timestamp = Date.now();
      const compositeFileName = `composite_${timestamp}.png`;
      const maskFileName = `mask_${timestamp}.png`;
      const compositePath = path.join(publicDir, compositeFileName);
      const maskPath = path.join(publicDir, maskFileName);
      await fs.writeFile(compositePath, compositeImage);
      await fs.writeFile(maskPath, finalMask);

      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
      // 优先使用 base64 数据 URL 发送图片（避免外部 API 无法访问 localhost）
      const compositeBase64 = `data:image/png;base64,${compositeImage.toString('base64')}`;
      const compositeUrl = domain ? `${domain}/outpaint/${compositeFileName}` : compositeBase64;
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

      // 计算目标比例字符串用于API
      const targetRatioStr = `${targetW}:${targetH}`;
      const targetSize = findClosestAspectRatio(targetRatioStr);

      // 使用 base64 数据 URL 发送图片（确保外部 API 可访问）+ mask_image
      const result = await autoTrySubmitImageTask(
        candidateModels,
        (modelId: string) => ({
          model: modelId,
          prompt: outpaintPrompt,
          size: targetSize,
          n: 1,
          image_urls: [compositeBase64],
          mask_image: maskFileBase64,
        }),
        'outpaint'
      );

      // 清理临时文件（延迟清理，异步任务需要文件存在）
      const cleanupFiles = async () => {
        try { await fs.unlink(compositePath); } catch (_) { /* ignore */ }
        try { await fs.unlink(maskPath); } catch (_) { /* ignore */ }
      };

      // 辅助函数：将原图合成到结果中心，确保像素级保留
      const compositeOriginalOnResult = async (resultBuffer: Buffer): Promise<Buffer> => {
        const resultMeta = await sharp(resultBuffer).metadata();
        const resultW = resultMeta.width || targetW;
        const resultH = resultMeta.height || targetH;

        // 将结果 resize 到目标尺寸（API 可能返回不同尺寸）
        let resizedResult = resultBuffer;
        if (resultW !== targetW || resultH !== targetH) {
          resizedResult = await sharp(resultBuffer)
            .resize(targetW, targetH, { fit: 'fill' })
            .png()
            .toBuffer();
        }

        // 创建渐变蒙版：原图区域=黑(使用生成结果)，边缘过渡=灰(混合)
        // 但为了确保原图内容完全保留，我们直接将原图叠在结果上
        // 先创建一个带羽化边缘的蒙版
        const featherSize = 10; // 羽化像素数
        const blendMask = await sharp({
          create: {
            width: srcW,
            height: srcH,
            channels: 3,
            background: { r: 255, g: 255, b: 255 }, // 白色=保留原图
          },
        })
          .blur(featherSize) // 边缘羽化
          .png()
          .toBuffer();

        // 将原图 resize 到 srcW x srcH
        const originalForComposite = await sharp(imageBuffer)
          .resize(srcW, srcH, { fit: 'fill' })
          .png()
          .toBuffer();

        // 在原图上应用 alpha 通道（蒙版控制透明度）
        const originalWithAlpha = await sharp(originalForComposite)
          .composite([{
            input: blendMask,
            blend: 'dest-in', // 使用蒙版作为 alpha
          }])
          .png()
          .toBuffer();

        // 将带 alpha 的原图合成到结果中心
        const finalComposite = await sharp(resizedResult)
          .composite([{
            input: originalWithAlpha,
            left: offsetX,
            top: offsetY,
            blend: 'over',
          }])
          .png()
          .toBuffer();

        return finalComposite;
      };

      if (result.directUrl) {
        // 同步结果 - 合成原图到中心
        try {
          const resultBuffer = await fetchImageBuffer(result.directUrl);
          const finalBuffer = await compositeOriginalOnResult(resultBuffer);

          const resultFileName = `outpaint_${timestamp}.png`;
          const resultPath = path.join(publicDir, resultFileName);
          await fs.writeFile(resultPath, finalBuffer);

          const compositeResultUrl = `${domain}/outpaint/${resultFileName}`;
          console.log(`[outpaint] Sync result composited: ${resultFileName}`);

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
        outpaintInfo: { offsetX, offsetY, srcW, srcH, targetW, targetH, origW, origH, featherSize: 10 },
      });
    }

    return NextResponse.json({ success: false, error: `不支持的操作: ${action}` }, { status: 400 });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Image edit error:', errMsg);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  }
}
