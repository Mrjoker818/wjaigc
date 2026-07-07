import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById, findProviderForFeature, findAllProvidersForType, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { translateApiError } from '@/lib/api-error-translate';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, convertAspectRatioToSize, buildPollUrl, isEditsEndpointRejected, stripEditsOnlyFields, type ApiCompatProfile, type ImageEndpoint, buildGeminiChatImageRequest, parseGeminiChatImageResponse, resolveProfileForModel, isGeminiImageModel, tryChatCompletionsImageFallback, isChannelUnavailableError } from '@/lib/api-compatibility';
import { saveImageFile } from '@/lib/server-data-root';
import { logError, logOperation, OP_ACTIONS, startTimer } from '@/lib/op-log';
import sharp from 'sharp';
import fsSync from 'fs';
import fs from 'fs/promises';
const { writeFile, mkdir, copyFile } = fs;
import path from 'path';
import { getServerDataRoot } from '@/lib/server-data-root';
import { isS3Available, uploadImageToS3 } from '@/lib/s3-storage';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';
import { eraseWithLama, removeBgWithIOPaint, generateRemoveBgMask, DEFAULT_REMOVEBG_MODEL, VALID_ERASE_MODELS, REMOVEBG_MODELS } from '@/lib/image-tools/iopaint-client';
import { LOCAL_AI_ENABLED } from '@/lib/image-tools/config';
import { postProcessAIRemoveBG, postProcessLocalRemoveBG } from '@/lib/remove-bg-postprocess';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { validateImageUrl } from '@/lib/input-validation';
import { enhanceViaAI } from '@/lib/quality-enhance';

const SUPPORTED_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

/** 将图片 Buffer 转为 data URL，确保前端 100% 可渲染 */
function imageBufferToDataUrl(buffer: Buffer, mimeType: string = 'image/png'): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

/** 将图片 Buffer 持久化保存，优先 S3 → 本地文件 → base64 data URL 兜底 */
async function persistImageBuffer(buffer: Buffer, filename: string, subDir: string, mimeType: string = 'image/png'): Promise<string> {
  // 1. 优先上传到 S3（最可靠的公开访问方式）
  if (await isS3Available()) {
    try {
      const s3Url = await uploadImageToS3(buffer, filename, mimeType);
      if (s3Url) return s3Url;
    } catch (e) {
      console.warn(`[image-edit] S3 upload failed for ${filename}:`, e);
    }
  }
  // 2. 保存到本地文件（通过 /api/serve-upload/ 可访问）
  try {
    const localUrl = saveImageFile(buffer, filename, subDir);
    if (localUrl) return localUrl;
  } catch (e) {
    console.warn(`[image-edit] Local save failed for ${filename}:`, e);
  }
  // 3. 最终兜底：base64 data URL（始终可渲染，但体积约大 33%）
  console.log(`[image-edit] Using base64 data URL fallback for ${filename}`);
  return imageBufferToDataUrl(buffer, mimeType);
}

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

/* ─── Inpaint 裁剪 & 本地擦除 ─── */
interface InpaintCropInfo {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  origW: number;
  origH: number;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * 计算蒙版区域的裁剪范围，仅裁取蒙版边界框 + 上下文边距，
 * 减少送入 AI 模型的图片面积，提升速度和质量。
 */
function calculateInpaintCrop(
  origW: number,
  origH: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  isErase: boolean,
): InpaintCropInfo {
  const bboxW = Math.max(1, maxX - minX + 1);
  const bboxH = Math.max(1, maxY - minY + 1);
  const longest = Math.max(bboxW, bboxH);
  const minPad = Math.max(
    isErase ? 64 : 96,
    Math.round(Math.min(origW, origH) * (isErase ? 0.04 : 0.08))
  );
  const contextualPad = Math.round(longest * (isErase ? 0.65 : 1.05));
  const pad = Math.max(minPad, contextualPad);

  const cropX = clampInt(minX - pad, 0, origW - 1);
  const cropY = clampInt(minY - pad, 0, origH - 1);
  const cropRight = clampInt(maxX + pad + 1, cropX + 1, origW);
  const cropBottom = clampInt(maxY + pad + 1, cropY + 1, origH);

  return {
    cropX,
    cropY,
    cropW: cropRight - cropX,
    cropH: cropBottom - cropY,
    origW,
    origH,
  };
}

/**
 * 本地擦除修复：BFS 边界扩散 + 高斯平滑，无需调用 AI 模型。
 * 适用于无提示词的纯擦除场景，速度快且无黑白块/笔刷痕迹。
 */

/**
 * 本地背景透明化兜底：适合白底/纯色底/轻微渐变背景。
 * 逻辑：取四周边缘背景色 → 计算每个像素与背景色的距离 → 生成柔边 alpha。
 * AI 去背景不可用或中转站不支持透明 PNG 时，至少保证商品图、海报素材白底图可用。
 */

async function createLocalBackgroundAlpha(imageBuffer: Buffer): Promise<Buffer> {
  const imgInfo = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = imgInfo.info;
  const raw = imgInfo.data;
  const samples: Array<[number, number, number]> = [];
  const stepX = Math.max(1, Math.floor(width / 60));
  const stepY = Math.max(1, Math.floor(height / 60));

  const addSample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    samples.push([raw[i], raw[i + 1], raw[i + 2]]);
  };

  for (let x = 0; x < width; x += stepX) {
    addSample(x, 0);
    addSample(x, height - 1);
  }
  for (let y = 0; y < height; y += stepY) {
    addSample(0, y);
    addSample(width - 1, y);
  }

  const median = (idx: number) => {
    const arr = samples.map(s => s[idx]).sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)] || 255;
  };
  const bgR = median(0), bgG = median(1), bgB = median(2);

  // 背景色越接近白色，阈值稍微放宽；深色/彩色背景保持谨慎，避免误删主体。
  const bgLuma = 0.2126 * bgR + 0.7152 * bgG + 0.0722 * bgB;
  const transparentThreshold = bgLuma > 230 ? 34 : 26;
  const opaqueThreshold = bgLuma > 230 ? 118 : 96;
  const out = Buffer.from(raw);

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const dr = raw[i] - bgR;
    const dg = raw[i + 1] - bgG;
    const db = raw[i + 2] - bgB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    let alpha: number;
    if (dist <= transparentThreshold) alpha = 0;
    else if (dist >= opaqueThreshold) alpha = raw[i + 3];
    else {
      const t = (dist - transparentThreshold) / (opaqueThreshold - transparentThreshold);
      alpha = Math.round(raw[i + 3] * Math.min(1, Math.max(0, t * t * (3 - 2 * t))));
    }
    out[i + 3] = alpha;
  }

  // 轻微羽化 alpha 边缘，减少白边/硬边。
  const alpha = Buffer.alloc(width * height);
  for (let p = 0; p < width * height; p++) alpha[p] = out[p * 4 + 3];
  const softAlpha = await sharp(alpha, { raw: { width, height, channels: 1 } }).blur(0.8).raw().toBuffer();
  for (let p = 0; p < width * height; p++) out[p * 4 + 3] = softAlpha[p];

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * 本地背景蒙版生成：与 createLocalBackgroundAlpha 使用相同算法，
 * 但输出黑白蒙版 PNG（白色=主体，黑色=背景），方便用户手动抠图。
 */
async function createLocalBackgroundMask(imageBuffer: Buffer): Promise<Buffer> {
  const imgInfo = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = imgInfo.info;
  const raw = imgInfo.data;
  const samples: Array<[number, number, number]> = [];
  const stepX = Math.max(1, Math.floor(width / 60));
  const stepY = Math.max(1, Math.floor(height / 60));

  const addSample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    samples.push([raw[i], raw[i + 1], raw[i + 2]]);
  };

  for (let x = 0; x < width; x += stepX) {
    addSample(x, 0);
    addSample(x, height - 1);
  }
  for (let y = 0; y < height; y += stepY) {
    addSample(0, y);
    addSample(width - 1, y);
  }

  const median = (idx: number) => {
    const arr = samples.map(s => s[idx]).sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)] || 255;
  };
  const bgR = median(0), bgG = median(1), bgB = median(2);

  const bgLuma = 0.2126 * bgR + 0.7152 * bgG + 0.0722 * bgB;
  const transparentThreshold = bgLuma > 230 ? 34 : 26;
  const opaqueThreshold = bgLuma > 230 ? 118 : 96;

  // 生成单通道灰度蒙版
  const maskData = Buffer.alloc(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const dr = raw[i] - bgR;
    const dg = raw[i + 1] - bgG;
    const db = raw[i + 2] - bgB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    let val: number;
    if (dist <= transparentThreshold) val = 0;       // 背景=黑色
    else if (dist >= opaqueThreshold) val = 255;     // 主体=白色
    else {
      const t = (dist - transparentThreshold) / (opaqueThreshold - transparentThreshold);
      val = Math.round(Math.min(255, Math.max(0, t * t * (3 - 2 * t)) * 255));
    }
    maskData[p] = val;
  }

  // 轻微羽化边缘
  const softMask = await sharp(maskData, { raw: { width, height, channels: 1 } }).blur(0.8).grayscale().raw().toBuffer();

  return sharp(softMask, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

async function createLocalEraseInpaint(
  imageBuffer: Buffer,
  maskRawData: Buffer,
  origW: number,
  origH: number,
  cropInfo: InpaintCropInfo,
): Promise<Buffer> {
  const src = await sharp(imageBuffer).ensureAlpha().raw().toBuffer();
  const out = Buffer.from(src);
  const total = origW * origH;
  const masked = new Uint8Array(total);
  const filled = new Uint8Array(total);
  let maskedCount = 0;
  const x0 = Math.max(0, cropInfo.cropX);
  const y0 = Math.max(0, cropInfo.cropY);
  const x1 = Math.min(origW - 1, cropInfo.cropX + cropInfo.cropW - 1);
  const y1 = Math.min(origH - 1, cropInfo.cropY + cropInfo.cropH - 1);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * origW + x;
      if (maskRawData[p] > 127) { masked[p] = 1; maskedCount++; }
      else { filled[p] = 1; }
    }
  }
  if (maskedCount === 0) return imageBuffer;

  const queue = new Int32Array(Math.max(1, maskedCount));
  let head = 0;
  let tail = 0;

  const tryFill = (p: number): boolean => {
    if (!masked[p] || filled[p]) return false;
    const x = p % origW;
    const y = Math.floor(p / origW);
    let r = 0; let g = 0; let b = 0; let a = 0; let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= origH) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= origW) continue;
        const np = yy * origW + xx;
        if (!filled[np]) continue;
        const ni = np * 4;
        r += out[ni]; g += out[ni + 1]; b += out[ni + 2]; a += out[ni + 3];
        count++;
      }
    }
    if (count === 0) return false;
    const i = p * 4;
    out[i] = Math.round(r / count);
    out[i + 1] = Math.round(g / count);
    out[i + 2] = Math.round(b / count);
    out[i + 3] = Math.round(a / count);
    filled[p] = 1;
    if (tail < queue.length) queue[tail++] = p;
    return true;
  };

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      tryFill(y * origW + x);
    }
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % origW;
    const y = Math.floor(p / origW);
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < y0 || yy > y1) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        if (xx < x0 || xx > x1) continue;
        tryFill(yy * origW + xx);
      }
    }
  }

  const smoothPasses = Math.min(22, Math.max(8, Math.round(Math.sqrt(maskedCount) / 18)));
  for (let pass = 0; pass < smoothPasses; pass++) {
    const prev = Buffer.from(out);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = y * origW + x;
        if (!masked[p]) continue;
        const i = p * 4;
        let r = prev[i] * 2; let g = prev[i + 1] * 2; let b = prev[i + 2] * 2; let a = prev[i + 3] * 2;
        let weight = 2;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= origH) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= origW) continue;
            const ni = (yy * origW + xx) * 4;
            r += prev[ni]; g += prev[ni + 1]; b += prev[ni + 2]; a += prev[ni + 3];
            weight++;
          }
        }
        out[i] = Math.round(r / weight);
        out[i + 1] = Math.round(g / weight);
        out[i + 2] = Math.round(b / weight);
        out[i + 3] = Math.round(a / weight);
      }
    }
  }

  const maskGray = Buffer.alloc(total, 0);
  for (let p = 0; p < total; p++) maskGray[p] = masked[p] ? 255 : 0;
  const alpha = await sharp(maskGray, { raw: { width: origW, height: origH, channels: 1 } })
    .blur(7)
    .raw()
    .toBuffer();
  const finalPixels = Buffer.from(src);
  for (let p = 0; p < total; p++) {
    const blend = alpha[p] / 255;
    if (blend <= 0) continue;
    const i = p * 4;
    finalPixels[i] = Math.round(out[i] * blend + src[i] * (1 - blend));
    finalPixels[i + 1] = Math.round(out[i + 1] * blend + src[i + 1] * (1 - blend));
    finalPixels[i + 2] = Math.round(out[i + 2] * blend + src[i + 2] * (1 - blend));
    finalPixels[i + 3] = src[i + 3];
  }

  return sharp(finalPixels, { raw: { width: origW, height: origH, channels: 4 } })
    .png()
    .toBuffer();
}

/**
 * AI 结果蒙版合成：将裁剪区域的 AI 结果精确合成到原图中
 * 仅在蒙版区域（白色）使用 AI 结果，非蒙版区域（黑色）保持原图不变
 * 蒙版边界做羽化过渡，避免硬边
 */
async function compositeAIResultToOriginal(
  origImageBuffer: Buffer,
  aiResultBuffer: Buffer,   // 裁剪区域尺寸的 AI 结果
  fullMaskBuffer: Buffer,   // 全尺寸蒙版（白色=修改区域）
  origW: number,
  origH: number,
  cropInfo: InpaintCropInfo,
): Promise<Buffer> {
  const src = await sharp(origImageBuffer).ensureAlpha().raw().toBuffer();
  const maskRaw = await sharp(fullMaskBuffer).ensureAlpha().raw().toBuffer();
  const aiRaw = await sharp(aiResultBuffer).ensureAlpha().raw().toBuffer();
  const aiMeta = await sharp(aiResultBuffer).metadata();
  const aiW = aiMeta.width || cropInfo.cropW;
  const aiH = aiMeta.height || cropInfo.cropH;
  if (!aiW || !aiH || aiW <= 0 || aiH <= 0) {
    throw new Error('AI返回图片尺寸无效，无法合成');
  }

  // 将 AI 结果放到裁剪区域位置
  const result = Buffer.from(src);

  for (let cy = 0; cy < cropInfo.cropH; cy++) {
    for (let cx = 0; cx < cropInfo.cropW; cx++) {
      const origX = cropInfo.cropX + cx;
      const origY = cropInfo.cropY + cy;
      if (origX < 0 || origX >= origW || origY < 0 || origY >= origH) continue;

      const origP = (origY * origW + origX);
      const maskIdx = origP * 4;
      const maskBrightness = (maskRaw[maskIdx] + maskRaw[maskIdx + 1] + maskRaw[maskIdx + 2]) / 3;

      // 非蒙版区域完全保留原图
      if (maskBrightness < 20) continue;

      // AI 结果坐标（AI结果可能和裁剪区域尺寸不完全一致）
      const aiX = Math.min(Math.round(cx * aiW / cropInfo.cropW), aiW - 1);
      const aiY = Math.min(Math.round(cy * aiH / cropInfo.cropH), aiH - 1);
      const aiP = (aiY * aiW + aiX);

      const origIdx = origP * 4;
      const aiIdx = aiP * 4;

      // 蒙版边界羽化：20像素过渡区
      // 计算到蒙版边界的距离
      const featherRadius = 20;
      const minDistToEdge = featherRadius;
      // 简化：直接用蒙版亮度作为混合权重
      // maskBrightness: 0=黑(保留原图) 255=白(AI结果)
      let blend: number;
      if (maskBrightness >= 200) {
        blend = 1.0;
      } else if (maskBrightness <= 40) {
        blend = 0.0;
      } else {
        blend = (maskBrightness - 40) / 160;
      }

      result[origIdx] = Math.round(aiRaw[aiIdx] * blend + src[origIdx] * (1 - blend));
      result[origIdx + 1] = Math.round(aiRaw[aiIdx + 1] * blend + src[origIdx + 1] * (1 - blend));
      result[origIdx + 2] = Math.round(aiRaw[aiIdx + 2] * blend + src[origIdx + 2] * (1 - blend));
      result[origIdx + 3] = 255;
    }
  }

  return sharp(result, { raw: { width: origW, height: origH, channels: 4 } })
    .png()
    .toBuffer();
}

// 图像编辑 API - 支持放大、擦除、蒙版修复、扩图、移除背景
export const maxDuration = 600; // 10分钟 - token link等API生图最久可达600s
export const dynamic = 'force-dynamic';

type EditAction = 'inpaint' | 'outpaint' | 'remove_background' | 'removebg' | 'upscale' | 'multi_angle';

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
  eraseModel?: string; // IOPaint erase model: lama/zits/anime-lama
  removeBgModel?: string; // IOPaint RemoveBG model: isnet-general-use / u2net / u2netp / silueta
  originalPrompt?: string; // 原图的生成提示词, 用于多角度场景上下文
  upscaleMode?: 'cpu' | 'ai'; // 放大模式: CPU本地 / AI云端
  outputFormat?: 'png' | 'jpg' | 'webp'; // 输出格式
  compression?: number; // 压缩质量 (0-100)
  engine?: 'auto' | 'ai' | 'local' | 'cpu'; // 引擎选择: 智能自动/云端AI/本地算法
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
  providerInfo?: { baseUrl?: string; requestStyle?: string; advancedParams?: Record<string, string>; model?: string } | null,
): Promise<{ taskId?: string; directUrl?: string; apiBaseUrl?: string; apiKey?: string; advancedParams?: Record<string, string> }> {
  // 解析兼容性档案 — 优先使用 resolveProfileForModel 来正确处理 Gemini 图像模型
  const modelId = providerInfo?.model || (typeof requestBody.model === 'string' ? requestBody.model : '');
  const profile = resolveProfileForModel(modelId, providerInfo);

  // ★ Gemini 图像模型专用路由：通过 /chat/completions 生图
  // 某些中转站（如4SAPI）的 Gemini 图像模型仅支持 /chat/completions 端点，
  // 不支持 /images/generations。需要将请求转换为 chat 格式。
  //
  // ⚠️ 但真正的 Gemini 图像模型通过 chat/completions 只能"参考"原图生成新图，
  // 无法做精确编辑操作。对于 outpaint/inpaint（扩展/擦除/蒙版）等需要像素级控制的操作，
  // Gemini 会变形/重绘而非精确扩展，应跳过此 provider 回退到支持 edits 的候选模型。
  // 注意：同一 provider 上的非 Gemini 模型（如 gpt-image-2-c）不应被拒绝，
  // 因为它们通过 chat/completions 也能做编辑。
  const isActualGeminiImageModel = isGeminiImageModel(modelId);
  const isEditOperation = endpoint === '/images/edits'
    || !!requestBody.mask
    || (typeof requestBody.strength === 'number' && requestBody.strength < 1)
    || (typeof requestBody.prompt === 'string' && (
      requestBody.prompt.includes('outpainting') ||
      requestBody.prompt.includes('expansion task') ||
      requestBody.prompt.includes('inpainting') ||
      requestBody.prompt.includes('erase') ||
      requestBody.prompt.includes('remove')
    ));

  if (profile.id === 'gemini-image' && isActualGeminiImageModel && isEditOperation) {
    // Gemini chat/completions 不支持精确图片编辑，跳过此 provider
    console.info(`[submitImageTask] Skipping gemini-image model "${modelId}" for edit operation, will try next candidate`);
    throw new Error('GEMINI_IMAGE_NOT_FOR_EDITS: Gemini 图像模型不支持精确编辑操作（扩展/擦除/蒙版），请使用其他图像模型');
  }

  if (profile.id === 'gemini-image' && !isEditOperation) {
    console.info(`[submitImageTask] Gemini image route detected for model="${modelId}", using /chat/completions`);
    const chatRequestBody = buildGeminiChatImageRequest(requestBody);
    const chatController = new AbortController();
    const chatTimeoutId = setTimeout(() => chatController.abort(), 600000); // 10分钟超时

    try {
      const chatResponse = await fetchWithV1Retry(
        apiBaseUrl,
        '/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chatRequestBody),
          signal: chatController.signal,
        }
      );

      clearTimeout(chatTimeoutId);

      if (!chatResponse.ok) {
        const errorText = await chatResponse.text();
        console.error('[submitImageTask] Gemini chat/completions error:', chatResponse.status, errorText);
        let errorMsg = `Gemini API 请求失败 (${chatResponse.status})`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) errorMsg = errorJson.error.message;
        } catch { /* ignore */ }
        throw new Error(translateApiError(errorMsg));
      }

      const chatResponseText = await chatResponse.text();
      let chatResult: Record<string, unknown>;
      try {
        chatResult = JSON.parse(chatResponseText);
      } catch {
        console.error('[submitImageTask] Gemini chat returned non-JSON, first 200 chars:', chatResponseText.substring(0, 200));
        throw new Error('Gemini API 返回了非 JSON 响应');
      }

      const extractedImageUrls = parseGeminiChatImageResponse(chatResult);
      if (extractedImageUrls.length > 0) {
        console.info(`[submitImageTask] Gemini image route: extracted ${extractedImageUrls.length} images`);
        return { directUrl: extractedImageUrls[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams };
      }

      // 没有提取到图片
      const choices = chatResult.choices as Array<Record<string, unknown>> | undefined;
      if (choices && choices.length > 0) {
        const content = (choices[0].message as Record<string, unknown>)?.content;
        console.error('[submitImageTask] Gemini chat response has choices but no extractable image. Content type:', typeof content, 'Content preview:', typeof content === 'string' ? content.substring(0, 200) : JSON.stringify(content).substring(0, 200));
      }

      throw new Error('Gemini 图像模型未返回图片结果');
    } finally {
      clearTimeout(chatTimeoutId);
    }
  }

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
  const timeoutMs = isDirectMode ? 600000 : 300000; // 直接模式600s(兼容token link等慢速API), 异步模式300s
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Debug: log key params for image-to-image verification
  const hasImageUrls = !!adjustedBody.image_urls;
  const urls = adjustedBody.image_urls as string[] | undefined;
  const str = adjustedBody.strength;
  const sz = adjustedBody.size;
  const pmt = String(adjustedBody.prompt || '').substring(0, 80);
  const hasImg = !!(adjustedBody.image || (Array.isArray(adjustedBody.images) && adjustedBody.images.length > 0));
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

    // If JSON request fails, try multipart form data as fallback
    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      const needsMultipart = errorText.includes('multipart') ||
        errorText.includes('form-data') ||
        errorText.includes('Content-Type') ||
        errorText.includes('expected multipart') ||
        errorText.includes('no file') ||
        errorText.includes('file required') ||
        errorText.includes('Missing image') ||
        errorText.includes('Invalid') ||
        errorText.includes('invalid');

      if (needsMultipart) {
        console.info(`[submitImageTask] JSON failed for edits endpoint, retrying with multipart form data...`);
        // Build multipart form data
        // If adjustRequestForProfile merged image → images[], extract first image back for multipart
        const multipartBody = { ...adjustedBody };
        if (!multipartBody.image && Array.isArray(multipartBody.images) && multipartBody.images.length > 0) {
          const firstImg = multipartBody.images[0] as Record<string, unknown>;
          if (firstImg?.image_url && typeof (firstImg.image_url as Record<string, unknown>)?.url === 'string') {
            multipartBody.image = (firstImg.image_url as Record<string, {url: string}>).url;
          } else if (typeof firstImg?.url === 'string') {
            multipartBody.image = firstImg.url;
          }
          // Remove first image from images[] to avoid duplication
          multipartBody.images = (multipartBody.images as unknown[]).slice(1);
          if ((multipartBody.images as unknown[]).length === 0) {
            delete multipartBody.images;
          }
        }
        const formData = new FormData();
        for (const [key, value] of Object.entries(multipartBody)) {
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
            // Arrays like images[] for multi-image edits
            for (let i = 0; i < value.length; i++) {
              const item = value[i];
              if (typeof item === 'object' && item !== null) {
                // OpenAI format: {image_url: {url: "data:..."}} or {image_url: {url: "https://..."}}
                const imgUrl = (item as Record<string, unknown>)?.image_url
                  ? ((item as Record<string, Record<string, unknown>>).image_url?.url as string)
                  : (item as Record<string, unknown>)?.url as string;
                if (imgUrl) {
                  if (imgUrl.startsWith('data:')) {
                    const match = imgUrl.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                      const mimeType = match[1];
                      const base64Data = match[2];
                      const binaryData = Buffer.from(base64Data, 'base64');
                      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
                      const file = new File([binaryData], `image_${i}.${ext}`, { type: mimeType });
                      formData.append(`${key}[${i}]`, file);
                    }
                  } else {
                    // HTTP URL - append as string
                    formData.append(`${key}[${i}][image_url][url]`, imgUrl);
                  }
                } else {
                  formData.append(`${key}[${i}]`, JSON.stringify(item));
                }
              } else {
                formData.append(key, String(item));
              }
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
              ...(() => {
                // Node.js 原生 fetch + 浏览器 FormData 需要手动设置 Content-Type
                // 让 fetch 自动处理 boundary
                return {};
              })(),
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
    // 当 /images/generations 携带 image_urls 时，增强 prompt 以确保 AI 使用参考图
    if (effectiveEndpoint === '/images/generations' && hasImageUrls) {
      if (!String(adjustedBody.prompt || '').includes('[IMAGE-TO-IMAGE MODE]') && !String(adjustedBody.prompt || '').includes('[REFERENCE IMAGE]')) {
        adjustedBody.prompt = `[IMAGE-TO-IMAGE MODE] You MUST use the provided reference image as the mandatory source/base for generation. Do NOT generate from scratch. ${String(adjustedBody.prompt || '')}`;
      }
    }
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
      errorMsg = errorJson.error?.message || errorJson.message || errorJson.msg || errorJson.detail || errorMsg;
    } catch { /* ignore */ }
    // 原始文本兜底：如果解析后的 errorMsg 仍为默认格式，尝试从原始文本提取关键信息
    if (errorMsg === `API 请求失败 (${submitResponse.status})`) {
      const lowerText = errorText.toLowerCase();
      if (lowerText.includes('no available channel')) errorMsg = errorText.trim();
      else if (lowerText.includes('model_not_found') || lowerText.includes('model not found')) errorMsg = errorText.trim();
    }

    // 自动回退：如果 /images/edits 端点不被支持，回退到 /images/generations
    // 使用原始响应文本(errorText)进行检测，而非清理后的 errorMsg
    if (effectiveEndpoint === '/images/edits' && isEditsEndpointRejected(submitResponse.status, errorText)) {
      console.log('[submitImageTask] /images/edits rejected, auto-falling back to /images/generations');
      const fallbackBody = stripEditsOnlyFields(adjustedBody);
      const fallbackEndpoint: ImageEndpoint = '/images/generations';

      // 增强 prompt：/images/generations 仅将 image_urls 视为可选参考，
      // 必须在 prompt 中明确指示 AI 使用参考图作为基础
      if (fallbackBody.image_urls && Array.isArray(fallbackBody.image_urls) && (fallbackBody.image_urls as string[]).length > 0) {
        const refCount = (fallbackBody.image_urls as string[]).length;
        fallbackBody.prompt = `[IMAGE-TO-IMAGE MODE] You MUST use the provided ${refCount > 1 ? `${refCount} reference images` : 'reference image'} as the mandatory source/base for generation. Do NOT generate from scratch. ${String(fallbackBody.prompt || '')}`;
      }

      try {
        const fallbackResponse = await fetchWithV1Retry(
          apiBaseUrl,
          fallbackEndpoint,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(fallbackBody),
            signal: AbortSignal.timeout(isChannelUnavailableError(errorText) ? 30000 : 60000),
          }
        );
        if (fallbackResponse.ok) {
          console.log('[submitImageTask] fallback to /images/generations succeeded');
          const fallbackText = await fallbackResponse.text();
          const fallbackJson = JSON.parse(fallbackText);
          const parsed = parseResponseForProfile(fallbackJson, profile);
          return {
            taskId: parsed.taskIds?.[0],
            directUrl: parsed.directImageUrls?.[0],
          };
        } else {
          const fallbackErrorText = await fallbackResponse.text();
          console.error('[submitImageTask] fallback also failed:', fallbackResponse.status, fallbackErrorText);

          // ★ Third fallback: try /chat/completions (for API proxies that only support models via chat)
          if (isChannelUnavailableError(`${fallbackErrorText} ${fallbackResponse.status}`)) {
            console.info('[submitImageTask] /images/generations also failed with channel error, trying /chat/completions fallback...');
            try {
              const chatImageUrls = await tryChatCompletionsImageFallback({
                baseUrl: apiBaseUrl,
                apiKey,
                model: modelId,
                prompt: String(adjustedBody.prompt || ''),
                imageBase64: (adjustedBody.image as string) || undefined,
                imageUrls: (adjustedBody.image_urls as string[]) || undefined,
                size: adjustedBody.size as string | undefined,
                originalError: fallbackErrorText,
                requestIdPrefix: 'image-edit',
                skipChannelCheck: true,
              });
              if (chatImageUrls && chatImageUrls.length > 0) {
                console.log('[submitImageTask] /chat/completions fallback succeeded, got', chatImageUrls.length, 'images');
                return { directUrl: chatImageUrls[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams };
              }
            } catch (chatErr) {
              console.warn('[submitImageTask] /chat/completions fallback error:', chatErr);
            }
          }
        }
      } catch (fallbackErr) {
        // /images/generations timed out → try /chat/completions immediately
        const isTimeout = fallbackErr instanceof Error && (fallbackErr.name === 'AbortError' || /timeout|aborted/i.test(fallbackErr.message));
        if (isTimeout) {
          console.info('[submitImageTask] /images/generations timed out, trying /chat/completions fallback...');
          try {
            const chatImageUrls = await tryChatCompletionsImageFallback({
              baseUrl: apiBaseUrl,
              apiKey,
              model: modelId,
              prompt: String(adjustedBody.prompt || ''),
              imageBase64: (adjustedBody.image as string) || undefined,
              imageUrls: (adjustedBody.image_urls as string[]) || undefined,
              size: adjustedBody.size as string | undefined,
              originalError: 'images/generations timeout',
              requestIdPrefix: 'image-edit',
              skipChannelCheck: true,
            });
            if (chatImageUrls && chatImageUrls.length > 0) {
              console.log('[submitImageTask] /chat/completions fallback succeeded (after generations timeout), got', chatImageUrls.length, 'images');
              return { directUrl: chatImageUrls[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams };
            }
          } catch (chatErr) {
            console.warn('[submitImageTask] /chat/completions fallback error (after generations timeout):', chatErr);
          }
        }
        console.error('[submitImageTask] fallback request error:', fallbackErr);
      }
    }

    // ★ 使用统一翻译函数翻译 API 错误信息
    const translatedMsg = translateApiError(errorMsg);

    // 模型能力错误（支持自动回退）
    if (errorMsg.includes('ratio or price') || errorMsg.includes('not configured') || errorMsg.includes('宽高比不在允许') || errorMsg.includes('aspect ratio is not in the allowed') || errorMsg.includes('Invalid aspect ratio') || errorMsg.includes('not a valid size')) {
      throw new ModelCapabilityError(translatedMsg);
    }
    if (errorMsg.includes('image_urls') || errorMsg.includes('mask_image') || errorMsg.includes('image editing')) {
      throw new ModelCapabilityError(translatedMsg);
    }
    if (errorMsg.includes('must be an URL') || errorMsg.includes('Invalid URL') || errorMsg.includes('data:')) {
      throw new ModelCapabilityError(translatedMsg);
    }
    if (errorMsg.includes('model_not_found') || errorMsg.includes('model not found') || errorMsg.includes('Model not found') || errorMsg.includes('No available channel') || errorMsg.includes('no available channel')) {
      throw new ModelCapabilityError(translatedMsg);
    }
    if (errorMsg.includes('_error') || errorMsg.includes('try again later')) {
      throw new ModelCapabilityError(translatedMsg);
    }
    // 5xx 服务器错误 / Cloudflare 524 超时 / 401 认证错误 → 先尝试 chat/completions 兜底
    if (errorMsg.includes('524') || errorMsg.includes('timeout occurred') || errorMsg.includes('bad_response_status_code') || (submitResponse.status >= 500 && submitResponse.status !== 501) || submitResponse.status === 401) {
      // ★ 尝试 /chat/completions 兜底（某些 API 代理仅通过 chat 端点支持模型）
      if (isChannelUnavailableError(`${errorMsg} ${errorText}`)) {
        console.info('[submitImageTask] 5xx channel error, trying /chat/completions fallback...');
        try {
          const chatImageUrls = await tryChatCompletionsImageFallback({
            baseUrl: apiBaseUrl,
            apiKey,
            model: modelId,
            prompt: String(adjustedBody.prompt || ''),
            imageBase64: (adjustedBody.image as string) || undefined,
            imageUrls: (adjustedBody.image_urls as string[]) || undefined,
            size: adjustedBody.size as string | undefined,
            originalError: `${errorMsg} ${errorText}`,
            requestIdPrefix: 'image-edit',
            skipChannelCheck: true,
          });
          if (chatImageUrls && chatImageUrls.length > 0) {
            console.log('[submitImageTask] /chat/completions fallback succeeded from 5xx handler');
            return { directUrl: chatImageUrls[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams };
          }
        } catch (chatErr) {
          console.warn('[submitImageTask] /chat/completions fallback (5xx) error:', chatErr);
        }
      }
      console.warn('[submitImageTask] retryable server error, will try fallback:', submitResponse.status, errorMsg);
      throw new ModelCapabilityError(translatedMsg);
    }

    throw new Error(translatedMsg);
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
    return { directUrl: parsed.directImageUrls[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams };
  }

  if (parsed.taskIds.length > 0) {
    return { taskId: parsed.taskIds[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams };
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
): Promise<{ taskId?: string; directUrl?: string; usedModel?: string; apiBaseUrl?: string; apiKey?: string; advancedParams?: Record<string, string> }> {
  const errors: string[] = [];
  let ratioRetryDone = false;
  
  for (const candidate of candidateModels) {
    try {
      console.log(`[image-edit] ${operation}: Trying model ${candidate.model} (source: ${candidate.source}, endpoint: ${endpoint})`);
      const requestBody = buildRequestBody(candidate.model);
      const result = await submitImageTask(candidate.apiBaseUrl, candidate.apiKey, requestBody, endpoint, {
        baseUrl: candidate.apiBaseUrl,
        advancedParams: candidate.advancedParams,
        model: candidate.model,
      });
      return { ...result, usedModel: candidate.model };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate.model}: ${errMsg}`);
      console.warn(`[image-edit] ${operation}: Model ${candidate.model} failed: ${errMsg}`);
      
      // ModelCapabilityError → 检查是否是宽高比问题，可以重试
      if (err instanceof ModelCapabilityError) {
        if (!ratioRetryDone && (errMsg.includes('ratio') || errMsg.includes('宽高比') || errMsg.includes('aspect'))) {
          // 宽高比不被支持，用 1:1 重试模型（跳过已失败的模型，避免双重API调用）
          console.warn(`[image-edit] ${operation}: Aspect ratio not supported, retrying with 1:1`);
          ratioRetryDone = true;
          // 记录当前及之前已失败的模型，避免对同一模型重复提交导致双重API调用
          const failedModelIndex = candidateModels.indexOf(candidate);
          const failedModelSet = new Set(candidateModels.slice(0, failedModelIndex + 1).map(c => c.model));
          // 用 1:1 比例重试尚未失败的候选模型
          for (const retryCandidate of candidateModels) {
            if (failedModelSet.has(retryCandidate.model)) {
              console.log(`[image-edit] ${operation}: Skipping already-failed model ${retryCandidate.model} in 1:1 retry`);
              continue;
            }
            try {
              const retryBody = buildRequestBody(retryCandidate.model);
              // 强制设置 size 为 1:1
              if (retryBody.size) retryBody.size = '1:1';
              const retryResult = await submitImageTask(retryCandidate.apiBaseUrl, retryCandidate.apiKey, retryBody, endpoint, {
                baseUrl: retryCandidate.apiBaseUrl,
                advancedParams: retryCandidate.advancedParams,
                model: retryCandidate.model,
              });
              return { ...retryResult, usedModel: retryCandidate.model };
            } catch (retryErr: unknown) {
              const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              errors.push(`${retryCandidate.model}(1:1): ${retryErrMsg}`);
              if (retryErr instanceof ModelCapabilityError) continue;
              const nr = retryErrMsg.includes('Invalid API key') || retryErrMsg.includes('invalid api_key');
              if (nr) throw retryErr;
              continue;
            }
          }
        }
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
    }), `${operation}(vision-fallback)`, '/images/generations');
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
  maxAttempts: number = 120,
  intervalMs: number = 1500,
): Promise<string> {
  // 使用兼容性档案确定轮询 URL
  const pollUrl = buildPollUrl(apiBaseUrl, taskId, profile);
  if (!pollUrl) {
    throw new Error(`Provider does not support polling for task ${taskId}`);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 动态轮询间隔: 前3次500ms快速检测，之后逐步增长
    const dynamicInterval = attempt < 3 ? 500 : attempt < 10 ? 1000 : attempt < 20 ? 1500 : 2000;
    await new Promise(r => setTimeout(r, dynamicInterval));

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
/**
 * 将 buffer 保存到持久化目录，并返回可访问的本地URL（/api/serve-upload/uploads/xxx）
 * 三级兜底: uploads持久化目录 → public/uploads(HMR) → data URL
 * 重要：URL统一使用 /api/serve-upload/uploads/ 前缀（生产环境唯一可访问的上传路径），
 * 不要写入 public/images/（Next.js生产构建后无法serve运行时新增文件）
 */
async function saveBufferToPublic(buffer: Buffer, filename: string): Promise<string> {
  const webPath = '/api/serve-upload/uploads';
  // S3 上传（仅作持久化备份，不直接用作访问路径）
  let s3Uploaded = false;
  if (isS3Available()) {
    try {
      const ext = (filename.split('.').pop() || 'png').toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : ext === 'svg' ? 'image/svg+xml'
        : 'image/png';
      const s3Result = await uploadImageToS3(buffer, filename, mime);
      if (s3Result) s3Uploaded = true;
    } catch (s3e) {
      console.warn('[saveBufferToPublic] S3 upload failed:', (s3e as Error).message);
    }
  }

  // 始终保存到本地并返回 serve-upload 路径（S3 仅作持久化备份）
  // 这样 URL 一定走 /api/serve-upload/ 路由，该路由支持本地文件 + S3 回退
  try {
    const { getServerDataRoot } = await import('@/lib/server-data-root');
    const uploadDir = path.join(getServerDataRoot(), 'uploads');
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    // 开发环境同时写入 public/uploads 供HMR直接访问
    if (process.env.COZE_PROJECT_ENV !== 'PROD') {
      try {
        const publicDir = path.join(process.cwd(), 'public', 'uploads');
        await mkdir(publicDir, { recursive: true });
        await copyFile(filePath, path.join(publicDir, filename));
      } catch { /* best effort */ }
    }

    return `${webPath}/${filename}`;
  } catch (e) {
    // 本地保存失败但 S3 成功时，仍尝试返回 serve-upload 路径
    // serve-upload 路由会自动从 S3 回退下载
    if (s3Uploaded) {
      console.warn('[saveBufferToPublic] Local save failed but S3 backup exists, using serve-upload path');
      return `${webPath}/${filename}`;
    }
    console.warn('[saveBufferToPublic] Failed to save to persistent uploads dir, fallback to public/uploads:', e);
  }

  // Fallback 2: public/uploads
  try {
    const publicDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(publicDir, { recursive: true });
    const publicPath = path.join(publicDir, filename);
    await writeFile(publicPath, buffer);
    return `/uploads/${filename}`;
  } catch (e) {
    console.error('[saveBufferToPublic] public/uploads fallback failed, using data URL:', e);
  }

  // Last resort: data URL
  const mimeType = filename.endsWith('.jpg') || filename.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export async function POST(request: NextRequest) {
  const opTimer = startTimer();
  let deductedCredits = 0;
  let sessionUser: any = null;
  try {
    const authResult = await requireApiAuthOrReject(request);
    if (authResult instanceof NextResponse) return authResult;
    const body: EditRequest = await request.json();
    sessionUser = await getSessionUser(request);
    deductedCredits = 0; // 跟踪已扣积分，用于失败退款
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
      originalPrompt = '',
      model: rawModel = 'gemini-2.5-flash-image-preview',
      providerId,
      engine: enginePref = 'auto',
    } = body;

    // 防御性处理：确保 model 是字符串（前端可能误传对象）
    let modelStr = typeof rawModel === 'string' ? rawModel : (rawModel as Record<string, unknown>)?.model as string || String(rawModel);
    // ★ 从 model 中提取纯 modelId（前端可能传 providerId::modelId 格式）
    const extractedProviderId = modelStr.includes('::') ? modelStr.split('::')[0] : '';
    if (modelStr.includes('::')) {
      modelStr = modelStr.split('::').pop()!;
      console.log(`[image-edit] Stripped provider prefix from model: "${rawModel}" → "${modelStr}" (providerId via field: "${providerId || 'none'}")`);
    }
    const effectiveProviderId = providerId || extractedProviderId || '';
    const engineMode = (enginePref === 'ai' || enginePref === 'local' || enginePref === 'cpu') ? enginePref : 'auto';

    // ★ 输入校验
    if (!action || !['erase', 'mask', 'upscale', 'extend', 'removebg', 'inpaint', 'outpaint', 'remove_background'].includes(action)) {
      return NextResponse.json({ success: false, error: '缺少或无效的 action 参数' }, { status: 400 });
    }
    if (imageUrl) {
      const urlError = validateImageUrl(imageUrl);
      if (urlError) {
        return NextResponse.json({ success: false, error: urlError }, { status: 400 });
      }
    }

    // ★ 模型别名规范化：将 gpt-image-2-2k → gpt-image-2 等别名映射为 API 可识别的基础模型名
    const normalized = normalizeModelForApi(modelStr);
    if (normalized.wasNormalized) {
      console.log(`[image-edit] 模型别名规范化: "${modelStr}" → "${normalized.apiModelName}"`);
      modelStr = normalized.apiModelName;
    }

    // Content safety check (for actions that accept prompt input)
    if (prompt && typeof prompt === 'string') {
      const safetyResult = checkPromptSafety(prompt);
      if (safetyResult.level === 'block') {
        return NextResponse.json({ success: false, error: safetyResult.reason }, { status: 400 });
      }
      if (safetyResult.level === 'warning') {
        logSafetyWarning(prompt, safetyResult);
      }
    }

    // 积分检查与扣除
    if (sessionUser) {
      const creditOp = action === 'upscale' ? 'image_upscale'
        : action === 'remove_background' ? 'image_remove_bg'
        : action === 'outpaint' ? 'image_edit'
        : 'image_edit';
      const creditResult = await consumeCredits(sessionUser.id, creditOp, undefined, undefined, modelStr);
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

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
    if (effectiveProviderId) {
      const specifiedProvider = await findProviderById(effectiveProviderId);
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
    
    // 1. 前端指定的模型（如果匹配到 provider，优先使用 providerId）
    const preferredProvider = await findProviderForModel(modelStr, 'image', effectiveProviderId || undefined)
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

    // 2.5 功能专用模型优先插入到候选列表首位（按action类型）:
    //   removebg: 优先使用管理员配置的 removebg 类型专用模型
    //   upscale: 优先使用管理员配置的 upscaler 类型专用模型
    if ((action as string) === 'removebg' || action === 'upscale') {
      const specialType = (action as string) === 'removebg' ? 'removebg' : 'upscaler';
      const { isRemoveBgModel, isUpscalerModel } = await import('@/lib/model-capabilities');
      const specialProviders = await findAllProvidersForType(specialType as any);
      const specialModels: typeof candidateModels = [];
      for (const entry of specialProviders) {
        for (const m of entry.models) {
          if (!triedModels.has(m)) {
            specialModels.push({
              model: m,
              apiKey: entry.provider.apiKey,
              apiBaseUrl: normalizeApiBaseUrl(entry.provider.baseUrl),
              source: `admin-special-${specialType}`,
              advancedParams: entry.provider.advancedParams,
            });
            triedModels.add(m);
          }
        }
      }
      // 对于 removebg/upscale 操作，在通用 image 模型中也检查是否为专用模型（关键词匹配）
      // 将通用image模型里匹配的专用模型也移到前面
      const isSpecialModel = (action as string) === 'removebg' ? isRemoveBgModel : isUpscalerModel;
      const matchedFromImage: typeof candidateModels = [];
      const restGeneral: typeof candidateModels = [];
      for (const c of candidateModels) {
        if (isSpecialModel(c.model)) {
          matchedFromImage.push(c);
        } else {
          restGeneral.push(c);
        }
      }
      // 重新组装：专用provider模型 → image中匹配的专用模型 → 其他通用image模型
      candidateModels.length = 0;
      candidateModels.push(...specialModels, ...matchedFromImage, ...restGeneral);
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

      // 本地 API 路径（/api/serve-upload/xxx 或 /uploads/xxx）优先走 localhost fetch
      // 这与顶层 resolveImage 函数保持一致，避免文件系统路径映射问题
      const localApiPrefixes = ['/api/serve-upload/', '/uploads/'];
      const isLocalApiPath = !url.startsWith('http') && localApiPrefixes.some(p => url.startsWith(p));
      const isLocalDomainUrl = url.startsWith('http') && (() => {
        const rawDomain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
        const domainBase = rawDomain.replace(/\/+$/, '');
        return url.startsWith(`${domainBase}/api/serve-upload/`) || url.startsWith(`${domainBase}/uploads/`);
      })();

      if (isLocalApiPath || isLocalDomainUrl) {
        // Extract the relative path
        let relPath = url;
        if (url.startsWith('http')) {
          const rawDomain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
          const domainBase = rawDomain.replace(/\/+$/, '');
          relPath = url.replace(`${domainBase}`, '');
        }
        // 优先尝试文件系统直接读取（/api/serve-upload/xxx → {dataRoot}/uploads/xxx）
        const dataRoot = await getServerDataRoot();
        const fsPath = relPath.replace(/^\/api\/serve-upload\//, '/uploads/').replace(/^\//, '');
        const fsSearchPaths = [
          path.join(dataRoot, fsPath),
          path.join(dataRoot, 'uploads', path.basename(relPath)),
        ];
        for (const fp of fsSearchPaths) {
          try {
            const buf = await fs.readFile(fp);
            const ext = path.extname(fp).slice(1).toLowerCase() || 'png';
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
            return `data:${mime};base64,${buf.toString('base64')}`;
          } catch {}
        }
        // 文件系统未找到则走 localhost fetch（兼容所有环境）
        // 注意：serve-upload 可能从 S3 恢复文件，需要较长时间（最多 30s），因此超时设为 45s
        const port = process.env.DEPLOY_RUN_PORT || 5000;
        const fetchUrl = relPath.startsWith('/') ? `http://localhost:${port}${relPath}` : `http://localhost:${port}/${relPath}`;
        // 重试最多 2 次，应对 S3 恢复延迟
        for (let retry = 0; retry < 2; retry++) {
          try {
            const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(45000) });
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              const ct = res.headers.get('content-type') || 'image/png';
              return `data:${ct};base64,${buf.toString('base64')}`;
            }
            if (res.status === 404) {
              // 404 不重试，文件确实不存在
              break;
            }
          } catch {
            // 超时或其他网络错误，等待后重试
            if (retry < 1) await new Promise(r => setTimeout(r, 2000));
          }
        }
        throw new Error(`Local image not found: ${url} (tried fs: ${fsSearchPaths.join(', ')}, fetch: ${fetchUrl})`);
      }

      if (url.startsWith('http://') || url.startsWith('https://')) {
        // External URL: fetch it
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get('content-type') || 'image/png';
        return `data:${ct};base64,${buf.toString('base64')}`;
      }
      // Other relative paths (e.g. /outpaint/xxx.png)
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
      // 文件系统未找到，尝试 localhost fetch 兜底
      const port = process.env.DEPLOY_RUN_PORT || 5000;
      const fetchUrl = url.startsWith('/') ? `http://localhost:${port}${url}` : `http://localhost:${port}/${url}`;
      try {
        const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const ct = res.headers.get('content-type') || 'image/png';
          return `data:${ct};base64,${buf.toString('base64')}`;
        }
      } catch {}
      throw new Error(`File not found: ${url} (searched ${searchPaths.join(', ')}, fetch: ${fetchUrl})`);
    };

    if (action === 'multi_angle') {
      // ============================================================
      // 多角度 (Multi-Angle) v8
      // ============================================================
      // 用户原则:
      // 1. 全场景3D视角变化, 不针对单一元素
      // 2. 不得出现元素偏移/分离
      // 3. 不得改变固有元素(颜色/造型/风格)
      // 4. 倾斜角度必须识别
      //
      // 技术分析:
      // - input_fidelity='high' → API只做微调 → 角度变化无效(v7的问题)
      // - input_fidelity='low'  → API自由创作 → 需靠prompt精确约束元素/风格
      // - input_fidelity='medium' → 折中 → 角度变化不足
      //
      // v8 策略:
      // - input_fidelity: 'low' (允许大幅度视角变换)
      // - prompt: 描述"新视角下的结果画面" + "保持所有元素外观不变"
      // - 倾斜描述使用视觉化语言(看到什么)而非技术术语
      // - 不传strength (避免不同提供商解释不一致)
      // ============================================================

      const absRot = Math.abs(rotation);
      const absTilt = Math.abs(tilt);

      // ── 倾斜 (Tilt/Pitch) — 精确描述新视角俯仰 ──
      // tilt>0 仰视(相机低于主体往上看)，tilt<0 俯视(相机高于主体往下看)
      // 范围 -30 ~ +60
      let tiltVisual = '';
      let tiltLabel = 'eye-level';
      if (tilt > 0) {
        if (absTilt <= 15) { tiltVisual = 'low-angle shot looking slightly upward, camera positioned slightly below the subject'; tiltLabel = 'slight low-angle'; }
        else if (absTilt <= 35) { tiltVisual = 'low-angle shot looking upward from below, camera positioned well below the subject, undersides and bottom edges become visible'; tiltLabel = 'low-angle'; }
        else { tiltVisual = 'extreme low-angle shot looking steeply upward from near ground level, camera far below subject pointing up, undersides dominate, sky/ceiling visible above'; tiltLabel = 'extreme low-angle'; }
      } else if (tilt < 0) {
        if (absTilt <= 15) { tiltVisual = 'high-angle shot looking slightly downward, camera positioned slightly above the subject'; tiltLabel = 'slight high-angle'; }
        else { tiltVisual = `high-angle shot looking down from above (${absTilt}° downward), camera positioned well above the subject looking down, tops of objects and ground clearly visible`; tiltLabel = 'high-angle'; }
      }

      // ── 旋转 (Rotation/Yaw) — 精确描述水平旋转角度 ──
      // 与前端CSS立方体/球体预览对齐：
      //   rotation > 0 (左转)：相机向右环绕(camera orbits right)→看到主体左侧面(Subject's left side visible)
      //   rotation < 0 (右转)：相机向左环绕(camera orbits left)→看到主体右侧面(Subject's right side visible)
      // 范围 -90 ~ +90
      let yawVisual = '';
      let facingLabel = 'front-facing';
      if (rotation > 0) {
        // 相机环绕到右侧，看到主体左侧面
        if (absRot <= 15) { yawVisual = `camera orbits ${absRot}° to the right around the subject, revealing a sliver of the subject's left cheek/side, subject still mostly front-facing with a subtle three-quarter turn to the left`; facingLabel = 'three-quarter front-left'; }
        else if (absRot <= 35) { yawVisual = `camera orbits ${absRot}° to the right around the subject (three-quarter view), subject turns to show their left side prominently, left cheek/left profile visible, original front now angled away toward the right of the frame`; facingLabel = 'three-quarter left'; }
        else if (absRot <= 65) { yawVisual = `camera orbits ${absRot}° to the right around the subject, subject is now in a near left-profile view with left side of face/body dominant, very little of the original front remains visible, subject's left shoulder/cheek faces camera`; facingLabel = 'near profile-left'; }
        else { yawVisual = `camera orbits ${absRot}° fully to the right side of the subject (full profile), subject is in complete left profile — the subject's left side faces the camera directly, original front face/chest is no longer visible`; facingLabel = 'profile left'; }
      } else if (rotation < 0) {
        // 相机环绕到左侧，看到主体右侧面
        if (absRot <= 15) { yawVisual = `camera orbits ${absRot}° to the left around the subject, revealing a sliver of the subject's right cheek/side, subject still mostly front-facing with a subtle three-quarter turn to the right`; facingLabel = 'three-quarter front-right'; }
        else if (absRot <= 35) { yawVisual = `camera orbits ${absRot}° to the left around the subject (three-quarter view), subject turns to show their right side prominently, right cheek/right profile visible, original front now angled away toward the left of the frame`; facingLabel = 'three-quarter right'; }
        else if (absRot <= 65) { yawVisual = `camera orbits ${absRot}° to the left around the subject, subject is now in a near right-profile view with right side of face/body dominant, very little of the original front remains visible, subject's right shoulder/cheek faces camera`; facingLabel = 'near profile-right'; }
        else { yawVisual = `camera orbits ${absRot}° fully to the left side of the subject (full profile), subject is in complete right profile — the subject's right side faces the camera directly, original front face/chest is no longer visible`; facingLabel = 'profile right'; }
      }

      // ── 缩放 (Zoom) ──
      const zoomIdx = typeof zoom === 'number' ? zoom : 1;
      let zoomVisual = '';
      let shotLabel = 'medium shot';
      if (zoomIdx === 0) { zoomVisual = ', tight close-up framing with the subject filling most of the frame'; shotLabel = 'close-up'; }
      else if (zoomIdx === 2) { zoomVisual = ', wide shot showing more of the surrounding environment, subject smaller in frame'; shotLabel = 'wide shot'; }

      // ── 组合视角描述 ──
      const viewClauses: string[] = [];
      if (tiltVisual) viewClauses.push(tiltVisual);
      if (yawVisual) viewClauses.push(yawVisual);

      const viewDescription = viewClauses.length > 0
        ? viewClauses.join('; ')
        : 'exact frontal eye-level view, same angle as original';

      // 视角数字标签（用于prompt头部强约束）
      const angleTag = `${facingLabel}, ${tiltLabel}, ${shotLabel}, yaw=${rotation}°, tilt=${tilt}°`;

      // v9 Prompt: 更精确的视角描述 + 明确角度数字 + 严格元素保持约束
      // 核心策略：用"camera position"描述新视角，明确告诉AI相机在主体的哪个方位
      // 避免使用模糊方向词，使用"camera orbits right/left"明确表示相机环绕方向
      const modeIntro = angleMode === 'camera'
        ? 'CAMERA DOLLY MODE: The camera physically moves (dollies) through the 3D scene to a new position, while all subjects/objects stay in place. Foreground objects shift significantly relative to background due to parallax.'
        : 'ORBIT MODE: The camera orbits around the central subject as if on a circular dolly track. The subject stays centered in frame but we see a new side/angle. Background shifts realistically.';

      const multiAnglePrompt = prompt || (
        `[ANGLE: ${angleTag}] ` +
        `${modeIntro}\n\n` +
        `Reproduce this EXACT scene from the new camera position described below:\n${viewDescription}${zoomVisual}.\n\n` +
        `CRITICAL COMPOSITION RULES — MUST follow ALL:\n` +
        `1. EVERY element present in the original (people, faces, bodies, objects, furniture, buildings, trees, background details, text, logos) MUST appear in this new view. Do NOT remove, add, or replace any element.\n` +
        `2. Each element must show its CORRECT side for this camera position. When the camera orbits to its RIGHT (viewer's right), we see the subject's LEFT side/cheek/profile. When the camera orbits to its LEFT (viewer's left), we see the subject's RIGHT side/cheek/profile. When looking up from below, we see undersides (chin, table undersides, eaves). When looking down, we see tops of heads/objects. Elements are NOT frozen facing forward while only the background rotates.\n` +
        `3. Maintain IDENTICAL colors, materials, lighting direction, textures, clothing, hairstyles, expressions, poses, and relative positions. Same lighting, same time of day, same atmosphere.\n` +
        `4. The scene behaves as a single rigid 3D world. When viewed from a new angle, every element shows the appropriate new perspective coherently. Foreground/background parallax must be correct: closer objects shift more relative to background.\n` +
        `5. Do NOT mirror/flip the image. Do NOT change aspect ratio. Do NOT change the image style (photograph stays photograph, illustration stays illustration, 3D render stays 3D render).\n` +
        `6. The yaw rotation is ${Math.abs(rotation)}° and tilt is ${tilt}° from eye-level — apply these exact angles to every element's perspective consistently.\n` +
        `This is the SAME scene viewed from a DIFFERENT camera position — not a different scene, not a rearrangement, not a different person/object.`
      );

      // Use original image aspect ratio
      const maOrigW = body.originalWidth || 1024;
      const maOrigH = body.originalHeight || 1024;
      const maAspectRatio = body.aspectRatio || findClosestAspectRatio(`${maOrigW}:${maOrigH}`);

      // Resolve image to base64 for maximum content preservation
      const multiAngleBase64 = await resolveImageToBase64(imageUrl);

      // Strategy selection based on angle magnitude:
      // - Small angles (<25° rotation AND <15° tilt): use /images/edits with medium fidelity (subtle change)
      // - Large angles: use /images/generations with image as reference (allows bigger viewpoint shift)
      const isSmallAngle = absRot < 25 && absTilt < 15;
      let result: { taskId?: string; directUrl?: string; usedModel?: string } | null = null;
      let usedEndpoint: '/images/edits' | '/images/generations' = isSmallAngle ? '/images/edits' : '/images/generations';

      // Try preferred endpoint first, fallback to the other
      const tryEdits = async () => {
        if (!multiAngleBase64) throw new ModelCapabilityError('No base64 image available for edits endpoint');
        return await autoTrySubmitImageTask(candidateModels, (m) => ({
          model: m,
          prompt: multiAnglePrompt,
          size: maAspectRatio,
          n: 1,
          image: multiAngleBase64,
          // Small angles: medium fidelity to preserve original while allowing subtle angle shift
          input_fidelity: 'medium' as const,
        }), '多角度(edits)', '/images/edits');
      };

      const tryGenerations = async () => {
        return await autoTrySubmitImageTask(candidateModels, (m) => ({
          model: m,
          prompt: multiAnglePrompt,
          size: maAspectRatio,
          n: 1,
          image_urls: [imageUrl],
          ...(multiAngleBase64 ? { image: multiAngleBase64 } : {}),
          // Large angles: low fidelity to allow significant perspective change
          input_fidelity: 'low' as const,
        }), '多角度(generations)');
      };

      try {
        if (isSmallAngle) {
          result = await tryEdits();
          console.info(`[multi-angle] Small angle (rot=${rotation}, tilt=${tilt}), tried /images/edits (medium fidelity) first`);
        } else {
          result = await tryGenerations();
          console.info(`[multi-angle] Large angle (rot=${rotation}, tilt=${tilt}), using /images/generations (low fidelity) for bigger viewpoint shift`);
        }
      } catch (primaryErr: unknown) {
        const primaryErrMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        console.warn(`[multi-angle] Primary endpoint ${usedEndpoint} failed: ${primaryErrMsg}, trying fallback`);
        try {
          if (isSmallAngle) {
            usedEndpoint = '/images/generations';
            result = await tryGenerations();
          } else {
            usedEndpoint = '/images/edits';
            result = await tryEdits();
          }
        } catch (fbErr: unknown) {
          const fbErrMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
          console.error(`[multi-angle] Fallback endpoint also failed: ${fbErrMsg}`);
          throw fbErr;
        }
      }

      if (result?.directUrl) {
        // ★ 持久化远程URL到本地，确保浏览器可靠加载（部分API代理URL需要认证或会过期，浏览器直接加载会失败）
        let persistedUrl = result.directUrl;
        try {
          const { persistRemoteImage } = await import('@/lib/s3-storage');
          const localUrl = await persistRemoteImage(result.directUrl, 'generate/multi-angle');
          if (localUrl) persistedUrl = localUrl;
        } catch {}
        return NextResponse.json({ success: true, imageUrl: persistedUrl, action, usedModel: result.usedModel, endpoint: usedEndpoint });
      }
      // ★ 注册异步多角度任务（存储提供商信息，供 poll-task 轮询远端API）
      if (result?.taskId) {
        const maCandidate = candidateModels.find(c => c.model === result.usedModel) || candidateModels[0];
        registerTask(result.taskId, 'multi-angle', '多角度旋转', sessionUser?.id);
        updateTaskProgress(result.taskId, {
          status: 'processing',
          progress: 10,
          result: {
            usedModel: result.usedModel || maCandidate?.model,
            apiBaseUrl: maCandidate?.apiBaseUrl,
            apiKey: maCandidate?.apiKey,
            advancedParams: maCandidate?.advancedParams,
          }
        });
      }
      return NextResponse.json({ success: true, taskId: result?.taskId, action, prompt: multiAnglePrompt, usedModel: result?.usedModel, endpoint: usedEndpoint });
    }

    if (action === 'upscale') {
      // ============================================================
      // 超清放大 (Upscale) — 云端API优先 + 本地upscayl保底
      //
      // 执行优先级 (P0改造后):
      //   1. 管理员配置的 upscaler 专用模型 (如 seedvr2-upscaler / real-esrgan)
      //      已在上方candidateModels中排到首位，走/images/edits + image参考图
      //   2. 通用image模型 (通过更大size参数 + 低strength忠实放大)
      //      走/images/generations + image参考图, AI智能补细节
      //   3. 本地upscayl-ncnn / Real-ESRGAN (cpu模式，像素级忠实)
      //      云端不可用时自动降级
      //
      // 用户可选模式:
      //   "auto" → 自动按优先级尝试（默认）
      //   "ai"   → 仅AI放大（云端API）
      //   "cpu"  → 仅本地CPU放大（不调云端）
      // ============================================================

      const scaleVal = body.scale || 2;
      let origW = body.originalWidth || 512;
      let origH = body.originalHeight || 512;
      
      // ★ 尝试从图片URL获取真实尺寸（前端可能传递的是画布显示尺寸而非真实像素尺寸）
      if (imageUrl && (origW < 512 || origH < 512 || origW === 512)) {
        try {
          const sharp = (await import('sharp')).default;
          const response = await fetch(imageUrl);
          const arrayBuffer = await response.arrayBuffer();
          const imageBuffer = Buffer.from(arrayBuffer);
          const metadata = await sharp(imageBuffer).metadata();
          if (metadata.width && metadata.height) {
            console.log(`[image-edit] upscale: loaded real image size from URL: ${metadata.width}x${metadata.height} (frontend passed: ${origW}x${origH})`);
            origW = metadata.width;
            origH = metadata.height;
          }
        } catch (e) {
          console.warn('[image-edit] upscale: failed to load image metadata from URL:', e);
        }
      }
      
      const targetW = targetWidth || origW * scaleVal;
      const targetH = targetHeight || origH * scaleVal;
      // engine 参数统一覆盖 upscaleMode：auto/ai/local(→cpu)
      const upscaleMode: 'auto' | 'ai' | 'cpu' =
        engineMode === 'ai' ? 'ai'
        : engineMode === 'local' || engineMode === 'cpu' ? 'cpu'
        : (body.upscaleMode as 'auto' | 'ai' | 'cpu') || 'auto';

      // 本地CPU放大的内部实现（复用原逻辑）
      const runLocalCpuUpscale = async () => {
        try {
          const { performUpscaleAuto } = await import('@/lib/image-tools/upscayl');
          const result = await performUpscaleAuto({
            imageUrl,
            scale: scaleVal,
            outputFormat: body.outputFormat || 'png',
            compression: body.compression || 90,
          });

          if (result.success && result.imageUrl) {
            const cpuOutputW = result.outputSize?.width || targetW;
            const cpuOutputH = result.outputSize?.height || targetH;

            if (cpuOutputW !== targetW || cpuOutputH !== targetH) {
              const { fetchImageBuffer: fetchBuf } = await import('@/lib/fetch-image-buffer');
              const cpuBuf = await fetchBuf(result.imageUrl);
              const resizedBuf = await sharp(cpuBuf)
                .resize(targetW, targetH, { kernel: 'lanczos3' })
                .png({ quality: 95 })
                .toBuffer();

              const timestamp = Date.now();
              const randomSuffix = Math.random().toString(36).substring(2, 8);
              const filename = `upscale_cpu_${timestamp}_${randomSuffix}.png`;
              const savedPath = await saveBufferToPublic(resizedBuf, filename);
              const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
              const domainBase = domain.startsWith('http') ? domain.replace(/\/+$/, '') : `https://${domain.replace(/\/+$/, '')}`;
              const normalizedPath = savedPath.startsWith('data:') || savedPath.startsWith('http') ? savedPath : (savedPath.startsWith('/') ? savedPath : `/${savedPath}`);
              const finalUrl = normalizedPath.startsWith('data:') || normalizedPath.startsWith('http') ? normalizedPath : `${domainBase}${normalizedPath}`;

              return NextResponse.json({
                success: true,
                imageUrl: finalUrl,
                action,
                engine: 'cpu-auto-resized',
                usedModel: result.model || 'realesrgan',
                scale: scaleVal,
                originalSize: result.originalSize || { width: origW, height: origH },
                outputSize: { width: targetW, height: targetH },
                outputWidth: targetW,
                outputHeight: targetH,
              });
            }

            return NextResponse.json({
              success: true,
              imageUrl: result.imageUrl,
              action,
              engine: result.engine || 'cpu-auto',
              usedModel: result.model || 'realesrgan',
              scale: scaleVal,
              originalSize: result.originalSize || { width: origW, height: origH },
              outputSize: result.outputSize || { width: targetW, height: targetH },
              outputWidth: result.outputSize?.width || targetW,
              outputHeight: result.outputSize?.height || targetH,
            });
          }
          return null;
        } catch (cpuError) {
          console.log(`[image-edit] upscale: CPU error:`, cpuError instanceof Error ? cpuError.message : cpuError);
          return null;
        }
      };

      // ---- 用户强制CPU模式: 仅本地upscayl ----
      if (upscaleMode === 'cpu') {
        const cpuRes = await runLocalCpuUpscale();
        if (cpuRes) return cpuRes;
        return NextResponse.json({ success: false, error: 'CPU本地放大失败，请检查upscayl模型是否已下载' }, { status: 500 });
      }

      // ---- AI放大路径 (auto/ai模式) ----
      // candidateModels已在上方重排序：upscaler专用模型优先 → 通用image模型
      // 专用upscaler模型走/images/edits端点(参考图编辑)，通用image模型走/images/generations
      console.log(`[image-edit] upscale: AI-first mode, target: ${targetW}x${targetH}, candidates: ${candidateModels.slice(0,3).map(c=>c.model).join(', ')}...`);

      // AI放大策略: 先用AI放大到API允许的最大尺寸，再用sharp精确调整到目标尺寸
      // 注意: 大多数API限制最大边长2048，所以AI放大最多到2048边长
      const maxApiEdge = 2048; // API最大边长限制
      const aiUpscaleSize = (() => {
        // 计算AI能生成的最大尺寸（不超过API限制）
        const origMaxEdge = Math.max(origW, origH);
        if (origMaxEdge >= maxApiEdge) {
          // 原图已达到API限制，AI无法放大，直接用sharp放大
          // 但仍请求一个接近原图比例的API尺寸，让AI增强画质
          const scaleDown = maxApiEdge / origMaxEdge;
          const aiW = Math.round(origW * scaleDown / 16) * 16;
          const aiH = Math.round(origH * scaleDown / 16) * 16;
          return `${aiW}x${aiH}`;
        } else {
          // 原图未达API限制，AI可放大到API限制
          const scaleUp = Math.min(2, Math.floor(maxApiEdge / origMaxEdge));
          const aiW = Math.min(Math.round(origW * scaleUp / 16) * 16, maxApiEdge);
          const aiH = Math.min(Math.round(origH * scaleUp / 16) * 16, maxApiEdge);
          return `${aiW}x${aiH}`;
        }
      })();
      
      console.log(`[image-edit] upscale: AI request size ${aiUpscaleSize}, final target ${targetW}x${targetH}`);
      
      // 获取参考图
      const imageBase64ForVision = await resolveImageToBase64(imageUrl);
      const descSnippet = prompt || '';

      // 判断是否有专用upscaler模型 → 不同prompt策略
      const hasSpecialUpscaler = candidateModels.some(c => {
        const id = c.model.toLowerCase();
        return id.includes('upscaler') || id.includes('upscale') || id.includes('real-esrgan') || id.includes('esrgan') || id.includes('seedvr') || id.includes('seed-vr');
      });

      // 专用upscaler模型: 极简单prompt（这些模型专门做超分，复杂prompt反而干扰）
      const upscalerPrompt = hasSpecialUpscaler
        ? 'Upscale this image to higher resolution, preserve all details, sharp, clean, high quality.'
        : [
            `High-fidelity upscale. CRITICAL: 1) This is a RESIZE operation, NOT creative generation. 2) Preserve EXACT content: identity, expression, facial geometry, eye/lip shape, composition, colors, lighting — ZERO alteration. 3) SHARPEN existing edges and details — do NOT invent new texture. 4) REMOVE all noise, compression artifacts, JPEG blocks, grain, speckles, color splotches. 5) Background must be pixel-identical — no new objects, no color shifts, no position drift. 6) Do NOT add skin pores, hair strands, or fabric threads that don't exist in the original. 7) Output should look like the same image captured at higher resolution, not a re-interpretation. Clean, sharp, faithful, noise-free, artifact-free.`,
            descSnippet ? `Original content: ${descSnippet.substring(0, 300)}.` : '',
          ].filter(Boolean).join(' ');

      const negativePrompt = '(worst quality, low quality, normal quality:2), blurry, pixelated, jpeg artifacts, painting, oil painting, illustration, cartoon, anime, over-smoothed, plastic skin, waxy, airbrushed, soft focus, smoothed, gaussian blur, changed content, new elements, different colors, altered composition, deformed, watermark, text, makeup change, flat, cartoonish, drawn, sketch, CG, 3d render, unnatural, noise, grain, speckle, color splotch, compression block, ringing, halo, chromatic aberration, moire, added texture, fake skin pores, fake hair strands, invented details, painted over, retouched, HDR, oversaturated, shifted, misaligned, moved, position change, content drift, creative interpretation, style change';

      // 分离候选: 专用upscaler模型走/images/edits(参考图编辑)，通用模型走/images/generations
      const { isUpscalerModel } = await import('@/lib/model-capabilities');
      const specialUpscalerCandidates = candidateModels.filter(c => isUpscalerModel(c.model));
      const generalImageCandidates = candidateModels.filter(c => !isUpscalerModel(c.model));

      let aiResult: any = null;
      let aiError: Error | null = null;

      // Step A: 先用专用upscaler模型尝试（如果有）
      // 注意: 专用upscaler模型API通常限制最大边长2048，需要先放大到2048边长
      // 如果原图已超过2048，直接跳过专用模型，使用通用模型
      const maxUpscalerEdge = 2048;
      const origMaxEdge = Math.max(origW, origH);
      const shouldUseDedicatedUpscaler = specialUpscalerCandidates.length > 0 && origMaxEdge <= maxUpscalerEdge;
      
      if (shouldUseDedicatedUpscaler) {
        try {
          console.log(`[image-edit] upscale: trying ${specialUpscalerCandidates.length} dedicated upscaler models first`);
          
          // 原图不超过2048，直接放大2倍（不超过2048）
          const upscalerScale = Math.min(2, Math.floor(maxUpscalerEdge / origMaxEdge));
          let upscalerTargetW = Math.min(origW * upscalerScale, maxUpscalerEdge);
          let upscalerTargetH = Math.min(origH * upscalerScale, maxUpscalerEdge);
          
          // 确保尺寸16对齐（API要求）
          upscalerTargetW = Math.round(upscalerTargetW / 16) * 16;
          upscalerTargetH = Math.round(upscalerTargetH / 16) * 16;
          
          const upscalerSize = `${upscalerTargetW}x${upscalerTargetH}`;
          console.log(`[image-edit] upscale: dedicated upscaler target size: ${upscalerSize} (limited to max edge 2048)`);
          
          // 专用超分模型走 /images/edits 端点（参考图编辑模式，参数更简单）
          aiResult = await autoTrySubmitImageTask(specialUpscalerCandidates, (m: string) => ({
            model: m,
            prompt: upscalerPrompt,
            n: 1,
            size: upscalerSize,
            image: imageBase64ForVision,
            image_urls: [imageBase64ForVision],
          }), '专用模型放大', '/images/edits');
          
          // 如果专用模型成功但尺寸未达到目标，需要二次放大
          if (aiResult && aiResult.imageUrl && (upscalerTargetW < targetW || upscalerTargetH < targetH)) {
            console.log(`[image-edit] upscale: dedicated upscaler produced ${upscalerTargetW}x${upscalerTargetH}, need secondary upscale to ${targetW}x${targetH}`);
            // 二次放大用通用AI模型或sharp
            // 这里先返回2048结果，后续可添加二次放大逻辑
          }
        } catch (err) {
          console.warn('[image-edit] upscale: dedicated upscaler models failed:', err instanceof Error ? err.message : err);
          aiError = err instanceof Error ? err : new Error(String(err));
        }
      } else if (specialUpscalerCandidates.length > 0 && origMaxEdge > maxUpscalerEdge) {
        console.log(`[image-edit] upscale: original image ${origW}x${origH} exceeds 2048 limit, skipping dedicated upscaler models`);
      }

      // Step B: 专用模型失败或不存在时，用通用image模型放大
      if (!aiResult && generalImageCandidates.length > 0) {
        try {
          console.log(`[image-edit] upscale: trying ${generalImageCandidates.length} general image models for upscale`);
          aiResult = await autoTrySubmitImageTask(generalImageCandidates, (m: string) => ({
            model: m,
            prompt: upscalerPrompt,
            size: aiUpscaleSize,
            n: 1,
            image: imageBase64ForVision,
            image_urls: [imageBase64ForVision],
            strength: hasSpecialUpscaler ? 0.6 : 0.25,
            input_fidelity: 'high',
            negative_prompt: negativePrompt,
          }), 'AI放大', '/images/generations');
        } catch (err) {
          console.warn('[image-edit] upscale: general image models failed:', err instanceof Error ? err.message : err);
          if (!aiError) aiError = err instanceof Error ? err : new Error(String(err));
        }
      }

      // Step C: 处理AI放大结果
      if (aiResult) {
        // AI结果尺寸后处理函数（原逻辑保留）
        const resizeAiResultToTarget = async (aiImageUrl: string): Promise<{ url: string; actualW: number; actualH: number }> => {
          let aiW = targetW;
          let aiH = targetH;
        try {
          // 下载 AI 生成的图片
          const aiBuffer = await fetchImageBuffer(aiImageUrl);
          const aiMeta = await sharp(aiBuffer).metadata();
          aiW = aiMeta.width || targetW;
          aiH = aiMeta.height || targetH;

          // 情况1: AI 输出 >= 目标尺寸 → 下采样 + 降噪 + 锐化
          if (aiW >= targetW && aiH >= targetH) {
            console.log(`[image-edit] AI upscale output ${aiW}x${aiH} >= target ${targetW}x${targetH}, downsampling + denoise + sharpen...`);
            // AI 放大输出通常不带 alpha 通道；如有 alpha，convolve+sharpen 在 RGBA 上也能正确处理
            const resizedBuffer = await sharp(aiBuffer)
              .resize(targetW, targetH, { kernel: sharp.kernel.lanczos3 })
              // AI 放大后处理：不做模糊降噪（会丢失微细节），两步锐化恢复纹理
              // Step 1: 中频纹理恢复
              .sharpen({ sigma: 1.2, m1: 0.8, m2: 0.4, x1: 2, y2: 4, y3: 10 })
              .png({ quality: 95 })
              .toBuffer();
            // Step 2: 微观边缘增强
            const finalResizedBuffer = await sharp(resizedBuffer)
              .sharpen({ sigma: 0.3, m1: 0.4, m2: 0.15, x1: 1, y2: 2, y3: 6 })
              .png({ quality: 95 })
              .toBuffer();

            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36).substring(2, 8);
            const filename = `upscale_ai_${timestamp}_${randomSuffix}.png`;
            const savedPath = await saveBufferToPublic(finalResizedBuffer, filename);

            const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
            const domainBase = domain.startsWith('http') ? domain.replace(/\/+$/, '') : `https://${domain.replace(/\/+$/, '')}`;
            // Ensure savedPath has leading / when it's a relative path (S3 key may return "images/xxx" without leading /)
            const normalizedPath = savedPath.startsWith('data:') || savedPath.startsWith('http') ? savedPath : (savedPath.startsWith('/') ? savedPath : `/${savedPath}`);
            const finalUrl = normalizedPath.startsWith('data:') || normalizedPath.startsWith('http') ? normalizedPath : `${domainBase}${normalizedPath}`;

            console.log(`[image-edit] AI upscale downsampled to ${targetW}x${targetH} (${(finalResizedBuffer.length / 1024).toFixed(0)}KB)`);
            return { url: finalUrl, actualW: targetW, actualH: targetH };
          }

          // 情况2: AI 输出 < 目标尺寸 → 用 Lanczos3 放大到目标尺寸
          // AI 已增强画质，再用高质量插值放大到用户设定的倍数
          console.log(`[image-edit] AI upscale output ${aiW}x${aiH} < target ${targetW}x${targetH}. Upscaling AI result to target with Lanczos3...`);

          // 对 AI 输出应用两步锐化增强，不做模糊降噪
          // Step 1: 中频纹理恢复
          const step1Buffer = await sharp(aiBuffer)
            .sharpen({ sigma: 1.2, m1: 0.8, m2: 0.4, x1: 2, y2: 4, y3: 10 })
            .png({ quality: 95 })
            .toBuffer();
          // Step 2: 微观边缘增强
          const sharpenedBuffer = await sharp(step1Buffer)
            .sharpen({ sigma: 0.3, m1: 0.4, m2: 0.15, x1: 1, y2: 2, y3: 6 })
            .png({ quality: 95 })
            .toBuffer();

          // Step 3: Lanczos3 放大到用户设定的目标尺寸
          const resizedBuffer = await sharp(sharpenedBuffer)
            .resize(targetW, targetH, { kernel: sharp.kernel.lanczos3 })
            .png({ quality: 95 })
            .toBuffer();

          const timestamp = Date.now();
          const randomSuffix = Math.random().toString(36).substring(2, 8);
          const filename = `upscale_ai_${timestamp}_${randomSuffix}.png`;
          const savedPath = await saveBufferToPublic(resizedBuffer, filename);

          const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
          const domainBase = domain.startsWith('http') ? domain.replace(/\/+$/, '') : `https://${domain.replace(/\/+$/, '')}`;
          const normalizedPath = savedPath.startsWith('data:') || savedPath.startsWith('http') ? savedPath : (savedPath.startsWith('/') ? savedPath : `/${savedPath}`);
          const finalUrl = normalizedPath.startsWith('data:') || normalizedPath.startsWith('http') ? normalizedPath : `${domainBase}${normalizedPath}`;

          console.log(`[image-edit] AI upscale result: ${aiW}x${aiH} → ${targetW}x${targetH} (AI enhanced + Lanczos3 upscale, ${resizedBuffer ? (resizedBuffer.length / 1024).toFixed(0) + 'KB' : 'N/A'})`);
          return { url: finalUrl, actualW: targetW, actualH: targetH };
        } catch (resizeErr) {
          console.error(`[image-edit] AI upscale resize failed:`, resizeErr instanceof Error ? resizeErr.message : resizeErr);
          // resize 失败时仍返回原始 URL，尺寸用 AI 实际输出尺寸
          return { url: aiImageUrl, actualW: aiW, actualH: aiH };
        }
      };

      if (aiResult?.directUrl) {
        const resized = await resizeAiResultToTarget(aiResult.directUrl);

        // AI 画质精修（带关键词约束，仅修复画质不改变内容）
        let finalUrl = resized.url;
        let enhanced = false;
        try {
          const enhanceResult = await enhanceViaAI(resized.url);
          if (enhanceResult.enhanced && enhanceResult.url) {
            finalUrl = enhanceResult.url;
            enhanced = true;
            console.log(`[image-edit] AI quality enhance applied after upscale`);
          } else {
            console.log(`[image-edit] AI enhance skipped/failed, using raw upscale result`);
          }
        } catch (enhanceErr) {
          console.warn('[image-edit] AI enhance error:', enhanceErr instanceof Error ? enhanceErr.message : enhanceErr);
        }

        return NextResponse.json({
          success: true,
          imageUrl: finalUrl,
          action,
          engine: 'ai-upscale-hq',
          usedModel: aiResult.usedModel,
          enhanced,
          originalSize: { width: origW, height: origH },
          outputSize: { width: resized.actualW, height: resized.actualH },
          outputWidth: resized.actualW,
          outputHeight: resized.actualH,
        });
      }

      // ★ 注册异步放大任务到 task-registry，确保 poll-task 能正确查询第三方 API
      // 异步任务完成后，前端 pollForResult 拿到 URL 时需要 resize
      // 通过在 task result 中标记 _needsResize + targetW/targetH，让 poll-task 完成后触发 resize
      if (aiResult?.taskId) {
        const regTaskId = registerTask(aiResult.taskId, 'upscale', 'AI放大', sessionUser?.id);
        updateTaskProgress(regTaskId.taskId, {
          status: 'processing',
          progress: 12,
          label: 'AI模型放大中...',
          result: {
            apiBaseUrl: aiResult.apiBaseUrl,
            apiKey: aiResult.apiKey,
            advancedParams: aiResult.advancedParams,
            usedModel: aiResult.usedModel,
            originalSize: { width: origW, height: origH },
            outputSize: { width: targetW, height: targetH },
            _needsResize: true,
            _model: modelStr,
          },
        });
      }

      return NextResponse.json({
        success: true,
        taskId: aiResult?.taskId,
        action,
        engine: 'ai-upscale',
        prompt: upscalerPrompt,
        usedModel: aiResult?.usedModel,
        originalSize: { width: origW, height: origH },
        outputSize: { width: targetW, height: targetH },
      });
    }

    // AI放大全部失败时，auto模式下自动降级到本地CPU放大
    if (upscaleMode === 'auto' && !aiResult && aiError) {
      console.log('[image-edit] upscale: All AI models failed, falling back to local CPU upscayl');
      const cpuRes = await runLocalCpuUpscale();
      if (cpuRes) return cpuRes;
    }

    // ai模式强制AI失败或auto模式CPU也失败 → 返回错误
    return NextResponse.json({
      success: false,
      error: upscaleMode === 'ai'
        ? `AI放大失败: ${aiError?.message || '所有AI模型均不可用，请检查API配置或切换到本地CPU模式'}`
        : '所有放大方式均失败，请检查API配置和本地upscayl模型',
    }, { status: 500 });
    }

    if (action === 'removebg' || action === 'remove_background') {
      const normalizedAction = 'remove_background';
      const bgSize = aspectRatio ? findClosestAspectRatio(aspectRatio) : '1:1';
      const imageBase64ForBg = await resolveImageToBase64(imageUrl).catch(() => null);
      
      // ─── 云端API优先路径1：专用removebg模型 + 通用image模型 ───
      // 支持background:'transparent'参数的AI模型（GPT-Image/Flux等），直接返回透明PNG
      // candidateModels已经在上方被重新排序：专用模型优先，通用模型在后
      const removeBgPrompt = [
        'Remove the background from this image.',
        'Preserve: All foreground subjects exactly as-is — every pixel of the main subject(s), including edges, colors, textures, details, proportions, and pose.',
        'Change only: The background becomes fully transparent (alpha = 0).',
        'Do not: Redraw, repaint, stylize, or modify the subject in any way. Do not add white fill, gray fill, checkerboard pattern, shadow, reflection, border, frame, text, watermark, vignette, or any new background.',
        'Output a PNG image with a real transparent alpha channel.',
      ].join(' ');

      const removeBgNegativePrompt = [
        'white background', 'gray background', 'solid color background', 'checkerboard',
        'new background', 'shadow', 'reflection', 'border', 'frame', 'watermark', 'text',
        'changed subject', 'distorted edges', 'halo', 'white fringe', 'repainted subject',
        'stylized subject', 'redrawn subject', 'low quality', 'blurry', 'artifact',
      ].join(', ');

      let aiSuccess = false;
      if (engineMode !== 'local') {
      try {
        console.log(`[remove_background] Trying AI path first (${candidateModels.length} models available: ${candidateModels.slice(0,3).map(c=>c.model).join(', ')}...)`);
        const submitResult = await autoTrySubmitImageTask(candidateModels, (m) => ({
          model: m,
          prompt: removeBgPrompt,
          negative_prompt: removeBgNegativePrompt,
          size: bgSize,
          n: 1,
          image: imageBase64ForBg || undefined,
          image_urls: [imageBase64ForBg || imageUrl],
          response_format: 'url',
          background: 'transparent',
          output_format: 'png',
          input_fidelity: 'high',
        }), '移除背景');
        const aiUsedModel = submitResult.usedModel;
        
        if (submitResult.directUrl) {
          // 同步模式：后处理提取蒙版→应用到原图→真正透明PNG
          try {
            const aiResult = await postProcessAIRemoveBG(submitResult.directUrl, imageUrl);
            if (aiResult) {
              aiSuccess = true;
              logOperation({
                action: OP_ACTIONS.IMAGE_EDIT,
                userId: sessionUser?.id,
                level: 'info',
                model: aiUsedModel || '',
                detail: `engine:ai-background-remove action:${action}`,
              });
              return NextResponse.json({ success: true, imageUrl: aiResult.imageUrl, maskUrl: aiResult.maskUrl || '', action, usedModel: aiUsedModel || '', engine: 'ai-background-remove' });
            }
            console.warn('[remove_background] AI post-processing returned null, not using raw AI result with checkerboard');
          } catch (postErr) {
            console.warn('[remove_background] AI post-processing failed (sync):', postErr instanceof Error ? postErr.message : postErr);
          }
        }
        
        if (submitResult.taskId) {
          // 异步模式：返回 taskId 给前端轮询，poll-task 会做后处理
          console.log(`[remove_background] AI returned taskId=${submitResult.taskId}, returning to frontend for polling`);
          const rbUsedCandidate = candidateModels.find(c => c.model === aiUsedModel) || candidateModels[0];
          aiSuccess = true;
          registerTask(submitResult.taskId, 'generate', 'AI 移除背景', sessionUser?.id);
          updateTaskProgress(submitResult.taskId, {
            status: 'processing',
            progress: 10,
            label: 'AI 正在识别主体并移除背景...',
            result: { engine: 'ai-background-remove', usedModel: aiUsedModel, originalImageUrl: imageUrl, apiBaseUrl: rbUsedCandidate?.apiBaseUrl, apiKey: rbUsedCandidate?.apiKey, advancedParams: rbUsedCandidate?.advancedParams },
          });
          return NextResponse.json({
            success: true,
            taskId: submitResult.taskId,
            action,
            engine: 'ai-background-remove',
            usedModel: aiUsedModel,
            prompt: removeBgPrompt,
          });
        }
      } catch (bgErr) {
        console.warn('[remove_background] AI remove background failed, falling back to local IOPaint:', bgErr instanceof Error ? bgErr.message : bgErr);
      }
      } // end if (engineMode !== 'local')

      // engineMode==='ai' 且 AI路径失败：直接返回错误，不降级
      if (engineMode === 'ai' && !aiSuccess) {
        logError(OP_ACTIONS.IMAGE_EDIT, new Error(`action:${action} engine:ai 所有AI模型失败`), {
          userId: sessionUser?.id,
          model: '',
        });
        return NextResponse.json({ error: 'AI 移除背景失败，已配置的模型均不可用。请检查API密钥或切换到本地/自动模式。' }, { status: 502 });
      }

      // ─── AI路径全部失败 → 降级到本地IOPaint RemoveBG ───
      // 本地模型（BiRefNet/u2net/silueta）生成黑白蒙版 → 应用到原图 → 真正透明PNG
      if (LOCAL_AI_ENABLED && !aiSuccess) {
        try {
          console.log(`[remove_background] Trying local IOPaint RemoveBG as fallback...`);
          const sourceBuffer = await fetchImageBuffer(imageUrl);
          
          const validRemoveBgModels: readonly string[] = REMOVEBG_MODELS.map(m => m.id);
          const rmbgModelName: string = validRemoveBgModels.includes(body.removeBgModel || '') ? body.removeBgModel! : DEFAULT_REMOVEBG_MODEL;
          console.log(`[remove_background] Using RemoveBG model: ${rmbgModelName}`);
          
          // 限时 60 秒：RemoveBG 首次使用时可能需要下载模型（100MB+）
          const IOPAINT_REMOVEBG_TIMEOUT = 60000;
          
          // 流程：本地模型生成蒙版+应用 → Python端完成所有处理 → RGBA PNG
          const maskResult = await Promise.race([
            generateRemoveBgMask(sourceBuffer, rmbgModelName),
            new Promise<null>((resolve) => setTimeout(() => {
              console.log(`[remove_background] Mask generation timed out after ${IOPAINT_REMOVEBG_TIMEOUT}ms`);
              resolve(null);
            }, IOPAINT_REMOVEBG_TIMEOUT)),
          ]);
          
          if (maskResult && maskResult.success && maskResult.rgbaBase64) {
            console.log(`[remove_background] Local RGBA result generated (model: ${maskResult.model}), saving...`);
            const removeBgResult = await postProcessLocalRemoveBG(maskResult.rgbaBase64, maskResult.maskBase64);
            if (removeBgResult) {
              console.log(`[remove_background] Local RemoveBG succeeded: ${removeBgResult.imageUrl}, mask: ${removeBgResult.maskUrl || 'N/A'}`);
              return NextResponse.json({
                success: true,
                imageUrl: removeBgResult.imageUrl,
                maskUrl: removeBgResult.maskUrl || '',
                action,
                engine: 'local-removebg',
              });
            }
            console.log(`[remove_background] postProcessLocalRemoveBG failed, falling back to simple edge detection`);
          } else {
            console.log(`[remove_background] Mask generation ${maskResult ? 'succeeded but no rgbaBase64' : 'failed/timed out'}, falling back to simple edge detection`);
          }
        } catch (rmbgErr) {
          console.warn(`[remove_background] IOPaint RemoveBG error:`, rmbgErr instanceof Error ? rmbgErr.message : rmbgErr);
        }
      }

      // ─── 所有路径均失败 → 本地透明化兜底（秒级完成） ───
      try {
        const sourceBuffer = await fetchImageBuffer(imageUrl);
        const localBuffer = await createLocalBackgroundAlpha(sourceBuffer);
        // 同时生成黑白蒙版图
        const localMaskBuffer = await createLocalBackgroundMask(sourceBuffer);
        const timestamp = Date.now();
        const rgbaFilename = `removebg-fallback-${timestamp}.png`;
        const maskFilename = `removebg-mask-${timestamp}.png`;
        const fallbackUrl = saveImageFile(localBuffer, rgbaFilename, 'removebg');
        const fallbackMaskUrl = localMaskBuffer ? saveImageFile(localMaskBuffer, maskFilename, 'removebg') : '';
        console.log(`[remove_background] Local fallback completed: ${fallbackUrl}, mask: ${fallbackMaskUrl || 'N/A'}`);
        return NextResponse.json({ success: true, imageUrl: fallbackUrl, maskUrl: fallbackMaskUrl || '', action, engine: 'local-background-alpha' });
      } catch (localErr) {
        console.error('[remove_background] local fallback failed:', localErr);
        return NextResponse.json({ success: false, error: '移除背景失败：AI模型不可用，且本地透明化兜底失败' }, { status: 500 });
      }
    }

    if (action === 'inpaint') {
      // ============================================================
      // 蒙版修复/擦除 - 双路径策略
      // 擦除 (无提示词): 本地 BFS 边界扩散 + 高斯平滑，速度快无黑白块
      // 蒙版修图 (有提示词): AI 智能修复 + 裁剪优化 + 合成回原图
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

      // 3. 检测蒙版是否为空 & 获取蒙版原始灰度数据
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

      // 4. 计算裁剪区域（减少送入模型的图片面积）
      const cropInfo = calculateInpaintCrop(origW, origH, minX, minY, maxX, maxY, isErase);
      console.log(`[inpaint] Crop region: ${cropInfo.cropW}x${cropInfo.cropH} at (${cropInfo.cropX},${cropInfo.cropY})`);

      // ★★★ 路径分叉：擦除走本地修复，蒙版修图走 AI 模型 ★★★
      if (isErase) {
        // ─── 擦除路径：优先使用 AI 模型智能擦除，本地 BFS 作为兜底 ───
        // 用户反馈：BFS 边界扩散效果不理想，结果与原图几乎一样
        // 改为优先使用 AI 模型（去除蒙版区域内容 + 周围纹理推断），AI 不可用时才降级到本地 BFS
        const maskGrayData = Buffer.alloc(origW * origH, 0);
        for (let p = 0; p < origW * origH; p++) {
          const idx = p * 4;
          const brightness = (maskRawData[idx] + maskRawData[idx + 1] + maskRawData[idx + 2]) / 3;
          maskGrayData[p] = brightness > 127 ? 255 : 0;
        }

        // 统计灰度蒙版信息
        let grayMaskPixels = 0;
        for (let p = 0; p < origW * origH; p++) { if (maskGrayData[p] > 127) grayMaskPixels++; }
        console.log(`[inpaint] ERASE path: grayMaskPixels=${grayMaskPixels}, totalPixels=${origW * origH}, ratio=${(grayMaskPixels / (origW * origH) * 100).toFixed(1)}%`);

        // 生成标准黑白蒙版（白色=需要修复区域，黑色=保留区域）— 供 AI 模型使用
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
        const eraseBinaryMaskBuffer = await sharp(binaryMaskPixels, { raw: { width: origW, height: origH, channels: 4 } })
          .grayscale()
          .threshold(127)
          .blur(2.2)
          .threshold(10)
          .png()
          .toBuffer();
        // eraseBinaryMaskBuffer 同时用于 IOPaint 和 AI 模型（已含柔化处理）
        const eraseMaskForAI = eraseBinaryMaskBuffer;

        // ─── 优先路径：IOPaint LaMa 本地擦除 ───
        // LaMa 是专业修复模型，效果优于 AI 生成式擦除和 BFS 边界扩散
        // 仅在 LOCAL_AI_ENABLED 且模型可用时尝试
        if (LOCAL_AI_ENABLED) {
          try {
            // 支持 lama / zits / anime-lama 模型选择
            const eraseModel: string = VALID_ERASE_MODELS.includes(body.eraseModel || '') ? body.eraseModel! : 'lama';
            console.log(`[inpaint] Attempting IOPaint erase (${eraseModel}): ${origW}x${origH}, mask pixels ${maskPixelCount}`);
            const lamaResult = await eraseWithLama(
              imageBuffer,
              eraseBinaryMaskBuffer,
              origW,
              origH,
              eraseModel,
            );
            if (lamaResult.success && lamaResult.imageUrl) {
              console.log(`[inpaint] IOPaint ${lamaResult.engine || 'iopaint'} erase succeeded: ${lamaResult.imageUrl}`);
              return NextResponse.json({
                success: true,
                imageUrl: lamaResult.imageUrl,
                action,
                engine: lamaResult.engine || 'iopaint-lama',
              });
            }
            console.log(`[inpaint] IOPaint erase failed: ${lamaResult.error}, falling back to AI API`);
          } catch (lamaErr) {
            console.warn(`[inpaint] IOPaint LaMa error:`, lamaErr instanceof Error ? lamaErr.message : lamaErr);
          }
        }

        // ─── 降级路径：AI 模型智能擦除 ───
        // 不裁剪！裁剪会导致 AI 看不到完整画面上下文，重新理解构图导致变形
        // 如果图片过大，等比缩放到 2048 以内，保证 AI 模型能处理
        const AI_MAX_DIM = 2048;
        let aiInputImageBuffer = imageBuffer;
        let aiInputMaskBuffer = eraseMaskForAI;
        let aiInputW = origW;
        let aiInputH = origH;

        if (origW > AI_MAX_DIM || origH > AI_MAX_DIM) {
          const scale = Math.min(AI_MAX_DIM / origW, AI_MAX_DIM / origH);
          aiInputW = Math.round(origW * scale);
          aiInputH = Math.round(origH * scale);
          // 确保尺寸为偶数（某些模型要求）
          aiInputW = aiInputW % 2 === 0 ? aiInputW : aiInputW - 1;
          aiInputH = aiInputH % 2 === 0 ? aiInputH : aiInputH - 1;
          aiInputImageBuffer = await sharp(imageBuffer)
            .resize(aiInputW, aiInputH, { fit: 'fill' })
            .jpeg({ quality: 85 })
            .toBuffer();
          aiInputMaskBuffer = await sharp(eraseMaskForAI)
            .resize(aiInputW, aiInputH, { fit: 'fill', kernel: 'nearest' })
            .png()
            .toBuffer();
          console.log(`[inpaint] Scaled down for AI: ${origW}x${origH} → ${aiInputW}x${aiInputH}`);
        }

        const eraseImageDataUrl = `data:image/png;base64,${aiInputImageBuffer.toString('base64')}`;
        const eraseMaskDataUrl = `data:image/png;base64,${aiInputMaskBuffer.toString('base64')}`;

        // 使用原图宽高比（不裁剪，保持完整上下文）
        const eraseGcd = gcd(origW, origH);
        const eraseAspectStr = `${origW / eraseGcd}:${origH / eraseGcd}`;
        const eraseEffectiveSize = aspectRatio ? findClosestAspectRatio(aspectRatio) : eraseAspectStr;

        // 尝试使用 AI 模型擦除
        let eraseUsedAI = false;
        if (candidateModels.length > 0) {
          try {
            const eraseRequestBody: Record<string, unknown> = {
              prompt: 'Remove only the white masked area. Completely erase the selected object/text/mark and naturally reconstruct the original background texture, lighting, perspective and pattern. Preserve every unmasked pixel and composition exactly.',
              negative_prompt: 'remaining object, ghost, shadow, duplicate, text, watermark, artifact, distortion, blurry, changed unmasked area, color shift, seam, hard edge',
              size: eraseEffectiveSize,
              n: 1,
              image_urls: [eraseImageDataUrl],
              mask_image: eraseMaskDataUrl,
              strength: 0.85,
            };

            console.log(`[inpaint] AI erase attempt: full image ${aiInputW}x${aiInputH}, size=${eraseEffectiveSize}, strength=0.85`);

            const eraseResult = await autoTrySubmitImageTask(
              candidateModels,
              (m: string) => ({ ...eraseRequestBody, model: m }),
              '擦除(AI)',
              '/images/edits',
            );

            // AI 模型成功：合成结果到原图
            if (eraseResult.directUrl) {
              const resultBuffer = await fetchImageBuffer(eraseResult.directUrl);
              const resultMeta = await sharp(resultBuffer).metadata();

              // 将 AI 结果等比缩放回原图尺寸
              let resultOrigSize: Buffer;
              const resW = resultMeta.width || aiInputW;
              const resH = resultMeta.height || aiInputH;
              if (resW !== origW || resH !== origH) {
                // 先缩放到 aiInputW×aiInputH（等比），再放大到 origW×origH
                let step1: Buffer;
                if (resW !== aiInputW || resH !== aiInputH) {
                  step1 = await sharp(resultBuffer)
                    .resize(aiInputW, aiInputH, { fit: 'fill' })
                    .png()
                    .toBuffer();
                } else {
                  step1 = resultBuffer;
                }
                // 如果 AI 输入是缩放过的，需要放大回原图尺寸
                if (aiInputW !== origW || aiInputH !== origH) {
                  resultOrigSize = await sharp(step1)
                    .resize(origW, origH, { fit: 'fill' })
                    .png()
                    .toBuffer();
                } else {
                  resultOrigSize = step1;
                }
              } else {
                resultOrigSize = resultBuffer;
              }

              // 直接使用 AI 返回的结果，不做蒙版合成
              // AI 模型（DALL-E/GPT Image等）返回的已经是完整修改后的图片
              const compositeJpeg = await sharp(resultOrigSize).jpeg({ quality: 92 }).toBuffer();
              const resultDataUrl = `data:image/jpeg;base64,${compositeJpeg.toString('base64')}`;
              console.log(`[inpaint] AI erase result (no composite): JPEG base64 (${(compositeJpeg.length / 1024).toFixed(0)}KB)`);
              eraseUsedAI = true;
              return NextResponse.json({ success: true, imageUrl: resultDataUrl, action, engine: 'ai-erase' });
            } else if (eraseResult.taskId) {
              // 异步模式：服务器端短时间轮询（30秒），超时则返回taskId让前端poll-task接管
              const ERASE_POLL_TIMEOUT_MS = 30_000; // 30秒服务器端轮询上限
              const ERASE_POLL_INTERVAL_MS = 3000; // 3秒轮询间隔
              console.log(`[inpaint] AI erase async: taskId=${eraseResult.taskId}, server-side polling for up to ${ERASE_POLL_TIMEOUT_MS / 1000}s`);

              // ★ 注册异步擦除任务（存储提供商信息，供 poll-task 轮询远端API）
              const eraseUsedCandidate = candidateModels.find(c => c.model === eraseResult.usedModel) || candidateModels[0];
              registerTask(eraseResult.taskId, 'erase', '擦除', sessionUser?.id);
              updateTaskProgress(eraseResult.taskId, {
                status: 'processing',
                progress: 10,
                result: {
                  usedModel: eraseResult.usedModel || eraseUsedCandidate?.model,
                  apiBaseUrl: eraseUsedCandidate?.apiBaseUrl,
                  apiKey: eraseUsedCandidate?.apiKey,
                  advancedParams: eraseUsedCandidate?.advancedParams,
                }
              });

              // 服务器端轮询：尝试在超时内获取结果
              let asyncEraseSucceeded = false;
              const pollStart = Date.now();

              try {
                // 查找provider用于轮询
                const eraseProvider = await findProviderForModel(eraseResult.usedModel || '', 'image')
                  || await findProviderForModel(eraseResult.usedModel || '', 'image');
                const eraseApiKey = eraseProvider?.apiKey;
                const eraseApiBaseUrl = normalizeApiBaseUrl(eraseProvider?.baseUrl || '');
                const eraseProfile = eraseProvider ? resolveCompatProfile(eraseProvider) : null;
                const erasePollUrl = eraseApiBaseUrl && eraseProfile ? buildPollUrl(eraseApiBaseUrl, eraseResult.taskId, eraseProfile) : null;

                if (erasePollUrl && eraseApiKey) {
                  while (Date.now() - pollStart < ERASE_POLL_TIMEOUT_MS) {
                    // 检查任务是否被取消
                    if (isTaskCancelled(eraseResult.taskId)) {
                      console.log(`[inpaint] AI erase task cancelled: ${eraseResult.taskId}`);
                      return NextResponse.json({ success: false, error: '任务已被取消' }, { status: 200 });
                    }

                    await new Promise(r => setTimeout(r, ERASE_POLL_INTERVAL_MS));

                    try {
                      const pollCtrl = new AbortController();
                      const pollTimer = setTimeout(() => pollCtrl.abort(), 15000);
                      const pollResp = await fetch(erasePollUrl, {
                        headers: { 'Authorization': `Bearer ${eraseApiKey}` },
                        signal: pollCtrl.signal,
                      });
                      clearTimeout(pollTimer);

                      if (!pollResp.ok) {
                        console.warn(`[inpaint] Erase poll HTTP ${pollResp.status}, continuing...`);
                        continue;
                      }

                      const pollData = (await pollResp.json()) as Record<string, unknown>;
                      const innerData = (pollData.data as Record<string, unknown>) || pollData;
                      const taskStatus = innerData.status as string;
                      const completedStatuses = ['completed', 'succeeded', 'success', 'done'];

                      if (completedStatuses.includes(taskStatus || '')) {
                        // 提取图片URL
                        let sourceUrl: string | null = null;
                        const images = (innerData.result as Record<string, unknown>)?.images as Array<Record<string, unknown>> | undefined;
                        if (images && images.length > 0) {
                          const rawUrl = images[0].url || images[0].image_url;
                          sourceUrl = Array.isArray(rawUrl) ? rawUrl[0] : (typeof rawUrl === 'string' ? rawUrl : null);
                        }
                        if (!sourceUrl) {
                          const result2 = innerData.result as Record<string, unknown> | undefined;
                          if (result2?.b64_json) sourceUrl = `data:image/png;base64,${result2.b64_json}`;
                        }

                        if (sourceUrl) {
                          console.log(`[inpaint] AI erase async completed in ${((Date.now() - pollStart) / 1000).toFixed(1)}s`);
                          // 下载结果并合成蒙版
                          const resultBuffer = await fetchImageBuffer(sourceUrl);
                          const resultMeta = await sharp(resultBuffer).metadata();
                          let resultOrigSize: Buffer;
                          const resW = resultMeta.width || aiInputW;
                          const resH = resultMeta.height || aiInputH;
                          if (resW !== origW || resH !== origH) {
                            let step1: Buffer;
                            if (resW !== aiInputW || resH !== aiInputH) {
                              step1 = await sharp(resultBuffer).resize(aiInputW, aiInputH, { fit: 'fill' }).png().toBuffer();
                            } else {
                              step1 = resultBuffer;
                            }
                            if (aiInputW !== origW || aiInputH !== origH) {
                              resultOrigSize = await sharp(step1).resize(origW, origH, { fit: 'fill' }).png().toBuffer();
                            } else {
                              resultOrigSize = step1;
                            }
                          } else {
                            resultOrigSize = resultBuffer;
                          }

                          // 直接使用 AI 返回的结果，不做蒙版合成
                          const compositeJpeg = await sharp(resultOrigSize).jpeg({ quality: 92 }).toBuffer();
                          const resultDataUrl = `data:image/jpeg;base64,${compositeJpeg.toString('base64')}`;
                          console.log(`[inpaint] AI erase async result (no composite): JPEG base64 (${(compositeJpeg.length / 1024).toFixed(0)}KB)`);

                          // 更新任务注册中心
                          updateTaskProgress(eraseResult.taskId, { status: 'completed', progress: 100, result: { imageUrl: resultDataUrl } });

                          asyncEraseSucceeded = true;
                          eraseUsedAI = true;
                          return NextResponse.json({ success: true, imageUrl: resultDataUrl, action, engine: 'ai-erase-async' });
                        }
                        break; // completed but no URL → fall through to BFS
                      } else if (taskStatus === 'failed') {
                        console.warn(`[inpaint] AI erase async task failed: ${JSON.stringify(innerData.error)}`);
                        break; // fall through to BFS
                      }
                      // still processing, continue polling
                      const elapsed = ((Date.now() - pollStart) / 1000).toFixed(0);
                      updateTaskProgress(eraseResult.taskId, { progress: Math.min(90, 30 + Math.round((Date.now() - pollStart) / ERASE_POLL_TIMEOUT_MS * 60)), label: `擦除中 (${elapsed}s)` });
                    } catch (pollErr) {
                      console.warn(`[inpaint] Erase poll error:`, pollErr instanceof Error ? pollErr.message : pollErr);
                      // continue polling
                    }
                  }
                }
              } catch (pollSetupErr) {
                console.warn(`[inpaint] Erase server-side poll setup error:`, pollSetupErr instanceof Error ? pollSetupErr.message : pollSetupErr);
              }

              if (!asyncEraseSucceeded) {
                const elapsed = ((Date.now() - pollStart) / 1000).toFixed(0);
                console.warn(`[inpaint] AI erase async server-side poll timed out after ${elapsed}s, returning taskId to client for continued polling`);

                // ★ 注册异步擦除任务（存储提供商信息，供 poll-task 轮询远端API）
                const eraseCandidate = candidateModels.find(c => c.model === eraseResult.usedModel) || candidateModels[0];
                registerTask(eraseResult.taskId, 'erase', 'AI擦除', sessionUser?.id);
                updateTaskProgress(eraseResult.taskId, {
                  status: 'processing',
                  progress: 30,
                  result: {
                    usedModel: eraseResult.usedModel || eraseCandidate?.model,
                    apiBaseUrl: eraseCandidate?.apiBaseUrl,
                    apiKey: eraseCandidate?.apiKey,
                    advancedParams: eraseCandidate?.advancedParams,
                  }
                });

                // ★ 不再直接降级到BFS，而是将taskId返回给前端继续轮询
                // AI返回的结果已经是完整的擦除图，无需蒙版合成
                return NextResponse.json({
                  success: true,
                  taskId: eraseResult.taskId,
                  action,
                  engine: 'ai-erase-async',
                  usedModel: eraseResult.usedModel,
                  // AI返回的结果已经是完整的擦除图，无需蒙版合成
                });
              }
            }
          } catch (aiErr) {
            console.warn(`[inpaint] AI erase failed, falling back to local BFS:`, aiErr instanceof Error ? aiErr.message : aiErr);
          }
        }

        // AI 模型不可用或失败时，降级到本地 BFS 边界扩散
        console.log(`[inpaint] Using local BFS erase fallback (no AI models available or all failed)`);
        try {
          const resultBuffer = await createLocalEraseInpaint(imageBuffer, maskGrayData, origW, origH, cropInfo);

          const resultJpeg = await sharp(resultBuffer).jpeg({ quality: 92 }).toBuffer();
          const resultDataUrl = `data:image/jpeg;base64,${resultJpeg.toString('base64')}`;
          console.log(`[inpaint] Local erase result: JPEG base64 (${(resultJpeg.length / 1024).toFixed(0)}KB)`);
          return NextResponse.json({ success: true, imageUrl: resultDataUrl, action, engine: 'local-erase' });
        } catch (localErr) {
          console.error('[inpaint] Local erase failed:', localErr);
          return NextResponse.json({ success: false, error: '擦除修复失败，请重试' }, { status: 500 });
        }
      }

      // ─── 蒙版修图路径：AI 模型 + 裁剪优化 + 合成回原图 ───

      // 5. 生成标准黑白蒙版（白色=需要修复区域，黑色=保留区域）
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

      // 6. 裁剪原图和蒙版到蒙版边界框区域，减少 AI 模型计算面积
      const croppedImageBuffer = await sharp(imageBuffer)
        .extract({ left: cropInfo.cropX, top: cropInfo.cropY, width: cropInfo.cropW, height: cropInfo.cropH })
        .png()
        .toBuffer();
      const croppedMaskBuffer = await sharp(binaryMaskBuffer)
        .extract({ left: cropInfo.cropX, top: cropInfo.cropY, width: cropInfo.cropW, height: cropInfo.cropH })
        .png()
        .toBuffer();

      // 7. 构建提示词
      const inpaintPrompt = (prompt || '').trim();

      // 8. 确保 imageUrl 是 API 可访问的完整 URL（使用裁剪后的图片）
      const croppedImageDataUrl = `data:image/png;base64,${croppedImageBuffer.toString('base64')}`;
      const croppedMaskDataUrl = `data:image/png;base64,${croppedMaskBuffer.toString('base64')}`;

      // 9. 计算宽高比（使用裁剪区域的比例）
      const cropGcd = gcd(cropInfo.cropW, cropInfo.cropH);
      const cropAspectStr = `${cropInfo.cropW / cropGcd}:${cropInfo.cropH / cropGcd}`;
      const effectiveSize = aspectRatio ? findClosestAspectRatio(aspectRatio) : cropAspectStr;

      // 10. 发送 AI 生成请求 - 使用裁剪后的图片和蒙版
      const requestBody: Record<string, unknown> = {
        prompt: inpaintPrompt,
        negative_prompt: 'low quality, blurry, distorted, deformed, watermark, text, signature',
        size: effectiveSize,
        n: 1,
        image_urls: [croppedImageDataUrl],
        mask_image: croppedMaskDataUrl,
        strength: 0.8,
      };

      console.log(`[inpaint] AI API request: crop ${cropInfo.cropW}x${cropInfo.cropH}, size=${effectiveSize}, strength=0.8`);

      let result: { taskId?: string; directUrl?: string; usedModel?: string };
      try {
        result = await autoTrySubmitImageTask(
          candidateModels,
          (m: string) => ({ ...requestBody, model: m }),
          '蒙版修图',
          '/images/edits',
        );
      } catch (autoTryErr: unknown) {
        console.log(`[inpaint] All image models failed, trying chat-vision fallback...`);
        const fallbackResult = await autoTryChatVisionFallback(
          croppedImageDataUrl, croppedMaskDataUrl, inpaintPrompt, 'inpaint'
        );
        if (fallbackResult) {
          result = fallbackResult as { taskId: string; directUrl?: string; usedModel?: string };
        } else {
          return NextResponse.json({ success: false, error: '图像编辑失败，当前无可用模型支持图像编辑，请在管理员系统中配置支持图生图的模型' }, { status: 500 });
        }
      }

      // 11. 处理结果
      if (result.directUrl) {
        try {
          // 下载 AI 生成的结果
          const resultBuffer = await fetchImageBuffer(result.directUrl);
          const resultMeta = await sharp(resultBuffer).metadata();

          // 将 AI 结果等比缩放到裁剪区域内（inside模式保留完整内容，避免cover裁切导致错位）
          let resizedResult: Buffer;
          if (resultMeta.width !== cropInfo.cropW || resultMeta.height !== cropInfo.cropH) {
            const innerResult = await sharp(resultBuffer)
              .resize(cropInfo.cropW, cropInfo.cropH, { fit: 'inside', withoutEnlargement: true })
              .png()
              .toBuffer();
            // 如果缩放后尺寸仍小于裁剪区域，用原图背景色填充边缘（居中放置）
            const innerMeta = await sharp(innerResult).metadata();
            const padX = Math.floor((cropInfo.cropW - (innerMeta.width || cropInfo.cropW)) / 2);
            const padY = Math.floor((cropInfo.cropH - (innerMeta.height || cropInfo.cropH)) / 2);
            if (padX > 0 || padY > 0) {
              resizedResult = await sharp({
                create: {
                  width: cropInfo.cropW,
                  height: cropInfo.cropH,
                  channels: 4,
                  background: { r: 0, g: 0, b: 0, alpha: 0 },
                }
              })
                .composite([{ input: innerResult, left: padX, top: padY, blend: 'over' }])
                .png()
                .toBuffer();
            } else {
              resizedResult = innerResult;
            }
          } else {
            resizedResult = resultBuffer;
          }

          // AI 返回的已经是正确的修图结果，直接贴回原图裁剪区域即可
          // 不再做蒙版alpha合成——AI模型已根据蒙版生成正确内容，蒙版合成会产生涂抹痕迹

          // 将裁剪区域的 AI 结果直接合成回原图（直接覆盖裁剪区域）
          const compositeResult = await sharp(imageBuffer)
            .composite([{ input: resizedResult, left: cropInfo.cropX, top: cropInfo.cropY }])
            .png()
            .toBuffer();

          const resultFileName = `inpaint_${Date.now()}.png`;

          // 直接返回 base64 data URL，彻底避免文件路径可达性问题
          // 输出用 JPEG 压缩减少传输体积
          const compositeJpeg = await sharp(compositeResult).jpeg({ quality: 92 }).toBuffer();
          const compositeDataUrl = `data:image/jpeg;base64,${compositeJpeg.toString('base64')}`;
          console.log(`[inpaint] AI composite result: JPEG base64 (${(compositeJpeg.length / 1024).toFixed(0)}KB, was PNG ${(compositeResult.length / 1024).toFixed(0)}KB)`);

          return NextResponse.json({ success: true, imageUrl: compositeDataUrl, action, engine: 'ai-crop-composite', cropInfo });
        } catch (compositeErr) {
          console.error('[inpaint] Composite failed, returning raw AI result as base64:', compositeErr);
          try {
            const rawBuf = await fetchImageBuffer(result.directUrl);
            const rawDataUrl = `data:image/png;base64,${rawBuf.toString('base64')}`;
            return NextResponse.json({ success: true, imageUrl: rawDataUrl, action, engine: 'ai-raw' });
          } catch {
            // ★ 最后兜底：尝试持久化远程URL，避免浏览器无法加载
            let fallbackUrl = result.directUrl;
            try {
              const { persistRemoteImage } = await import('@/lib/s3-storage');
              const localUrl = await persistRemoteImage(result.directUrl, 'generate/crop');
              if (localUrl) fallbackUrl = localUrl;
            } catch {}
            return NextResponse.json({ success: true, imageUrl: fallbackUrl, action, engine: 'ai-raw' });
          }
        }
      }

      // 异步结果 - 返回 taskId 给前端轮询，poll-task 会做蒙版合成
      // ★ 注册异步蒙版修图任务（存储提供商信息 + 合成所需数据，供 poll-task 轮询后做蒙版合成）
      if (result.taskId) {
        const usedCandidate = candidateModels.find(c => c.model === result.usedModel) || candidateModels[0];
        registerTask(result.taskId, 'mask', '蒙版修图', sessionUser?.id);
        updateTaskProgress(result.taskId, {
          status: 'processing',
          progress: 10,
          result: {
            usedModel: result.usedModel || usedCandidate?.model,
            apiBaseUrl: usedCandidate?.apiBaseUrl,
            apiKey: usedCandidate?.apiKey,
            advancedParams: usedCandidate?.advancedParams,
            cropInfo,
            // AI返回的结果已经是完整的修图结果，无需蒙版合成
            // 保留裁剪信息供前端将AI结果贴回原图位置
          }
        });
      }
      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        action,
        cropInfo,
        engine: 'ai-api',
        usedModel: result.usedModel,
      });
    }

    if (action === 'outpaint') {
      // ============================================================
      // 扩图 - 向外扩展画面
      // 支持两种模式：
      // 1. 即梦风格方向性扩展 (expandPadding): 指定 top/right/bottom/left 像素
      // 2. 传统比例扩展 (expandRatio + expandScale): 指定目标比例和倍率
      //
      // ★ 核心策略：直接发送原图作为参考 + 方向提示词
      // AI 模型收到原图后，根据提示词自然扩展画面内容
      // 不再使用灰色填充合成图（AI 会复制灰色区域导致灰色填充问题）
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

      // ============================================================
      // ★ 新策略：直接发送原图 + 方向提示词
      // 不再构建灰色填充合成图，避免 AI 复制灰色区域
      // ============================================================

      // 确定模型支持的最大尺寸
      const firstModel = candidateModels[0]?.model || '';
      let modelMaxPx = 1024;
      if (firstModel.toLowerCase().includes('gpt-image')) {
        modelMaxPx = 4096;
      } else if (firstModel.toLowerCase().includes('gemini')) {
        modelMaxPx = 2048;
      }

      // 计算目标尺寸是否需要缩小
      const needsDownscale = targetW > modelMaxPx || targetH > modelMaxPx;
      const scaleFactor = needsDownscale ? Math.min(modelMaxPx / targetW, modelMaxPx / targetH) : 1;

      // 计算生成尺寸（对齐到8的倍数，最大2MP）
      const maxTotalPixels = 2 * 1024 * 1024;
      let genW = needsDownscale ? Math.max(8, Math.ceil(targetW * scaleFactor / 8) * 8) : targetW;
      let genH = needsDownscale ? Math.max(8, Math.ceil(targetH * scaleFactor / 8) * 8) : targetH;
      if (genW * genH > maxTotalPixels) {
        const refScale = Math.sqrt(maxTotalPixels / (genW * genH));
        genW = Math.round(genW * refScale / 8) * 8;
        genH = Math.round(genH * refScale / 8) * 8;
      }

      console.log(`[outpaint] ${needsDownscale ? 'DOWNSCALE' : 'DIRECT'}: target ${targetW}x${targetH}, genSize ${genW}x${genH}`);

      // 构建原图参考（直接发送原图，不做灰色填充合成）
      const originalRefBuffer = await sharp(imageBuffer)
        .jpeg({ quality: 90 })
        .toBuffer();
      const originalBase64 = `data:image/jpeg;base64,${originalRefBuffer.toString('base64')}`;

      // 构建扩图方向的提示词
      const directionParts: string[] = [];
      const hasTop = offsetY > 0;
      const hasBottom = (offsetY + srcH) < targetH;
      const hasLeft = offsetX > 0;
      const hasRight = (offsetX + srcW) < targetW;

      if (hasTop) directionParts.push('upward (above the current top edge)');
      if (hasBottom) directionParts.push('downward (below the current bottom edge)');
      if (hasLeft) directionParts.push('to the left');
      if (hasRight) directionParts.push('to the right');

      const directionText = directionParts.length > 0
        ? `Expand the scene ${directionParts.join(' and ')}.`
        : 'Expand the scene outward in all directions.';

      // ★ 关键：提示词清晰说明这是扩展任务，AI 应自然延伸画面
      const outpaintPrompt = prompt || (
        `Image outpainting / expansion task. ${directionText} ` +
        `The provided image is the original content. Generate an expanded version at ${genW}x${genH} resolution ` +
        `that extends the scene naturally. The original content should appear at position approximately (${Math.round(offsetX * genW / targetW)}, ${Math.round(offsetY * genH / targetH)}) ` +
        `in the expanded image. Maintain the same style, lighting, colors, perspective, and atmosphere. ` +
        `The extended areas must seamlessly connect with the original content - no visible borders or color shifts. ` +
        `Generate rich, detailed content in all expanded areas that matches the original scene's context.`
      );

      const genSize = `${genW}x${genH}`;
      const genBody: Record<string, unknown> = {
        model: modelStr,
        prompt: outpaintPrompt,
        n: 1,
        size: genSize,
      };
      const outpaintNegPrompt = '(worst quality, low quality, normal quality:2), blurry, pixelated, jpeg artifacts, noise, grain, gray fill, solid gray, blank area, empty space, border, seam, visible edge';
      if (outpaintNegPrompt) genBody.negative_prompt = outpaintNegPrompt;

      // ★ 关键：直接发送原图作为参考（不使用灰色填充合成图）
      // AI 模型看到原图后，根据提示词中的方向和位置信息自然扩展
      // 避免灰色填充参考图导致 AI 复制灰色区域的问题
      genBody.image = originalBase64;
      genBody.image_urls = [originalBase64];
      genBody.strength = 0.65; // 保留原图风格，同时允许扩展

      // Submit to AI model API — 使用 autoTrySubmitImageTask 自动回退非 gemini-image 的候选模型
      const result = await autoTrySubmitImageTask(
        candidateModels,
        (model: string) => ({ ...genBody, model }),
        '扩展画面',
        '/images/edits',
      );
      const usedModel = result.usedModel || modelStr;

      // ★ 扩展结果持久化：直接保存 AI 生成结果
      // 不做原图合成，AI 已根据原图+方向提示词生成完整扩展图
      const persistOutpaintResult = async (resultBuffer: Buffer): Promise<{ url: string; w: number; h: number }> => {
        const resultMeta = await sharp(resultBuffer).metadata();
        const resultW = resultMeta.width || genW;
        const resultH = resultMeta.height || genH;

        console.log(`[outpaint] AI result size: ${resultW}x${resultH}, target: ${targetW}x${targetH}, genSize: ${genW}x${genH}`);

        // Resize AI result to target dimensions if needed
        let finalBuf = resultBuffer;
        if (resultW !== targetW || resultH !== targetH) {
          finalBuf = await sharp(resultBuffer)
            .resize(targetW, targetH, { fit: 'fill' })
            .jpeg({ quality: 92 })
            .toBuffer();
        } else {
          finalBuf = await sharp(resultBuffer).jpeg({ quality: 92 }).toBuffer();
        }

        const resultFileName = `outpaint_${Date.now()}.jpg`;
        let resultUrl: string = '';
        if (isS3Available()) {
          resultUrl = (await uploadImageToS3(finalBuf, resultFileName, 'image/jpeg')) || '';
        }
        if (!resultUrl) {
          resultUrl = `data:image/jpeg;base64,${finalBuf.toString('base64')}`;
        }
        return { url: resultUrl, w: targetW, h: targetH };
      };

      if (result.directUrl) {
        // 同步结果
        try {
          const resultBuffer = await fetchImageBuffer(result.directUrl);
          const { url: compositeResultUrl } = await persistOutpaintResult(resultBuffer);

          console.log(`[outpaint] Sync result saved`);

          return NextResponse.json({ success: true, imageUrl: compositeResultUrl, action, targetWidth: targetW, targetHeight: targetH });
        } catch (compositeErr) {
          console.error('[outpaint] Persist failed, trying to persist raw URL:', compositeErr);
          // ★ 尝试持久化远程URL，避免浏览器无法加载
          let fallbackUrl = result.directUrl;
          try {
            const { persistRemoteImage } = await import('@/lib/s3-storage');
            const localUrl = await persistRemoteImage(result.directUrl, 'generate/outpaint');
            if (localUrl) fallbackUrl = localUrl;
          } catch {}
          return NextResponse.json({ success: true, imageUrl: fallbackUrl, action, targetWidth: targetW, targetHeight: targetH });
        }
      }

      // 异步结果 - 返回 taskId，前端轮询后直接使用 AI 结果
      if (result.taskId) {
        registerTask(result.taskId, 'outpaint', '扩展画面', sessionUser?.id);
        updateTaskProgress(result.taskId, {
          status: 'processing',
          progress: 10,
          result: {
            outpaintInfo: { targetW, targetH, genW, genH },
            usedModel,
            apiBaseUrl: result.apiBaseUrl,
            apiKey: result.apiKey,
            advancedParams: result.advancedParams,
          }
        });
      }
      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        action,
        targetWidth: targetW,
        targetHeight: targetH,
      });
    }

    return NextResponse.json({ success: false, error: `不支持的操作: ${action}` }, { status: 400 });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Image edit error:', errMsg);
    // 记录操作日志 - 图片编辑失败
    logError(OP_ACTIONS.IMAGE_EDIT, error, {
      userId: sessionUser?.id || 'anonymous',
      userName: sessionUser?.name,
      targetType: 'image',
      durationMs: opTimer.end(),
    });
    // 退款：异常失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `图像编辑异常退款: ${errMsg.substring(0, 100)}`);
      } catch (refundErr) { console.error('[image-edit] Refund failed:', refundErr); }
    }
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  }
}

