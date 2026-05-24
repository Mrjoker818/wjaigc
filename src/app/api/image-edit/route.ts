import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById, findProviderForFeature, findAllProvidersForType, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, convertAspectRatioToSize, buildPollUrl, isEditsEndpointRejected, stripEditsOnlyFields, type ApiCompatProfile, type ImageEndpoint } from '@/lib/api-compatibility';
import { saveImageFile } from '@/lib/server-data-root';
import sharp from 'sharp';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { getServerDataRoot } from '@/lib/server-data-root';
import { isS3Available, uploadImageToS3 } from '@/lib/s3-storage';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';
import { eraseWithLama, removeBgWithIOPaint, generateRemoveBgMask, DEFAULT_REMOVEBG_MODEL, VALID_ERASE_MODELS, REMOVEBG_MODELS } from '@/lib/image-tools/iopaint-client';
import { LOCAL_AI_ENABLED } from '@/lib/image-tools/config';
import { postProcessAIRemoveBG, postProcessLocalRemoveBG } from '@/lib/remove-bg-postprocess';
import { fetchImageBuffer } from '@/lib/fetch-image-buffer';

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
      let minDistToEdge = featherRadius;
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
  eraseModel?: string; // IOPaint erase model: lama/zits/anime-lama
  removeBgModel?: string; // IOPaint RemoveBG model: isnet-general-use / u2net / u2netp / silueta
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
      if (errorJson.error?.message) errorMsg = errorJson.error.message;
    } catch { /* ignore */ }

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
            signal: AbortSignal.timeout(60000),
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
        }
      } catch (fallbackErr) {
        console.error('[submitImageTask] fallback request error:', fallbackErr);
      }
    }

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
async function saveBufferToPublic(buffer: Buffer, filename: string): Promise<string> {
  if (isS3Available()) {
    const s3Url = await uploadImageToS3(buffer, filename, 'image/png');
    if (s3Url) return s3Url;
  }
  // 直接返回 base64 data URL，彻底避免文件路径可达性问题
  return `data:image/png;base64,${buffer.toString('base64')}`;
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
        const port = process.env.DEPLOY_RUN_PORT || 5000;
        const fetchUrl = relPath.startsWith('/') ? `http://localhost:${port}${relPath}` : `http://localhost:${port}/${relPath}`;
        try {
          const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const ct = res.headers.get('content-type') || 'image/png';
            return `data:${ct};base64,${buf.toString('base64')}`;
          }
        } catch {}
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

      // Use original image aspect ratio for multi-angle generation
      const maOrigW = body.originalWidth || 1024;
      const maOrigH = body.originalHeight || 1024;
      const maAspectRatio = body.aspectRatio || findClosestAspectRatio(`${maOrigW}:${maOrigH}`);

      // Build optimized prompt for multi-angle rotation
      // angleMode === 'image': 只旋转主体，背景不变
      // angleMode === 'camera': 虚拟摄像机运动，整个场景重新渲染
      const multiAnglePrompt = prompt || (angleMode === 'image'
        ? `Edit this image to show the main subject as if it has been physically rotated ${yawText} in 3D space, viewed from ${pitchText}, with ${dollyText}. The subject is a real 3D object — reconstruct its unseen sides based on context. Keep the same identity, face, clothing, product, design, materials, labels, text, colors, proportions, and lighting style. IMPORTANT: Only rotate the main subject itself, the background and surroundings must remain completely unchanged. Do NOT rotate the entire image canvas.`
        : `Edit this image as if moving a virtual camera around the scene: camera orbits to yaw ${yawText}, pitch ${pitchText}, ${dollyText}. The scene and subject remain fixed in place. Re-render the entire scene from this new camera position, preserving all subjects, objects, materials, colors, environment, and mood. Infer unseen geometry and surfaces based on the visible context. Do NOT rotate the 2D image canvas.`);

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
            size: maAspectRatio,
            n: 1,
            image: multiAngleBase64,
            input_fidelity: angleMode === 'image' ? 'medium' : 'high',
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
          size: maAspectRatio,
          n: 1,
          image_urls: [imageUrl],
          ...(multiAngleBase64 ? { image: multiAngleBase64 } : {}),
          input_fidelity: angleMode === 'image' ? 'medium' : 'high',
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

        // saveBufferToPublic 返回 data URL 或 S3 URL，直接使用
        const resultUrl = savedPath.startsWith('data:') ? savedPath : (() => {
          const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
          const domainBase = domain.startsWith('http') ? domain.replace(/\/+$/, '') : `https://${domain.replace(/\/+$/, '')}`;
          return `${domainBase}${savedPath}`;
        })();

        console.log(`[image-edit] upscale: upscayl tile upscale complete. (${(mergedBuffer.length / 1024).toFixed(0)}KB)`);

        return NextResponse.json({
          success: true,
          imageUrl: resultUrl,
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

      // Step 1: 获取参考图（直接传原图给模型，跳过冗余的 vision 描述调用以节省 3-10 秒）
      // input_fidelity: 'high' + image 参数已经把原图发给模型，模型会自行理解内容
      const imageBase64ForVision = await resolveImageToBase64(imageUrl);
      // 仅在用户提供了描述性 prompt 时使用，否则用通用放大指令
      const descSnippet = prompt || '';

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
      const imageBase64ForBg = await resolveImageToBase64(imageUrl).catch(() => null);
      
      // ─── 优先路径1：本地 rembg 去背景（推荐） ───
      // 本地模型（ISNet/u2net/silueta/u2netp）生成黑白蒙版 → 应用到原图 → 真正透明PNG
      // AI 路径虽然主体识别好，但 AI 输出的"透明背景"实际上是棋盘格像素（不是真alpha=0），
      // 后处理也难以完美提取蒙版，所以本地模型蒙版法是更可靠的透明PNG方案
      if (LOCAL_AI_ENABLED) {
        try {
          console.log(`[remove_background] Trying local IOPaint RemoveBG first...`);
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
            console.log(`[remove_background] RGBA result generated (model: ${maskResult.model}), saving...`);
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
            console.log(`[remove_background] postProcessLocalRemoveBG failed, falling back to AI path`);
          } else {
            console.log(`[remove_background] Mask generation ${maskResult ? 'succeeded but no rgbaBase64' : 'failed/timed out'}, falling back to AI path`);
          }
        } catch (rmbgErr) {
          console.warn(`[remove_background] IOPaint RemoveBG error:`, rmbgErr instanceof Error ? rmbgErr.message : rmbgErr);
        }
      }

      // ─── 优先路径2：AI 模型去背景（本地不可用时降级） ───
      // AI 生成模型（GPT-4o/Gemini）返回的结果通常含棋盘格/白底（非真透明alpha），
      // 需要后处理提取蒙版再应用到原图
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

      try {
        const result = await autoTrySubmitImageTask(candidateModels, (m) => ({
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
        
        if (result.directUrl) {
          // 同步模式：后处理提取蒙版→应用到原图→真正透明PNG
          try {
            const aiResult = await postProcessAIRemoveBG(result.directUrl, imageUrl);
            if (aiResult) {
              return NextResponse.json({ success: true, imageUrl: aiResult.imageUrl, maskUrl: aiResult.maskUrl || '', action, usedModel: result.usedModel, engine: 'ai-background-remove' });
            }
            // postProcessAIRemoveBG 返回 null，不用原始 AI 结果（含棋盘格）
            console.warn('[remove_background] AI post-processing returned null, not using raw AI result with checkerboard');
          } catch (postErr) {
            console.warn('[remove_background] AI post-processing failed (sync):', postErr instanceof Error ? postErr.message : postErr);
          }
          // AI 后处理失败，继续往下走降级路径
        }
        
        if (result.taskId) {
          // 异步模式：返回 taskId 给前端轮询，poll-task 会做后处理
          console.log(`[remove_background] AI returned taskId=${result.taskId}, returning to frontend for polling`);
          registerTask(result.taskId, 'generate', 'AI 移除背景');
          updateTaskProgress(result.taskId, {
            status: 'processing',
            progress: 10,
            label: 'AI 正在识别主体并移除背景...',
            result: { engine: 'ai-background-remove', usedModel: result.usedModel, originalImageUrl: imageUrl },
          });
          return NextResponse.json({
            success: true,
            taskId: result.taskId,
            action,
            engine: 'ai-background-remove',
            usedModel: result.usedModel,
            prompt: removeBgPrompt,
          });
        }
      } catch (bgErr) {
        console.warn('[remove_background] AI remove failed, using local background-alpha fallback:', bgErr instanceof Error ? bgErr.message : bgErr);
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
              strength: 0.72,
            };

            console.log(`[inpaint] AI erase attempt: full image ${aiInputW}x${aiInputH}, size=${eraseEffectiveSize}, strength=0.72`);

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

              // 蒙版合成：仅将 AI 结果应用到蒙版区域，保留非蒙版区域
              // 全图模式：cropInfo 覆盖整个图片
              const fullCropInfo: InpaintCropInfo = { cropX: 0, cropY: 0, cropW: origW, cropH: origH, origW, origH };
              const compositeResult = await compositeAIResultToOriginal(
                imageBuffer, resultOrigSize, eraseMaskForAI, origW, origH, fullCropInfo
              );

              // 输出用 JPEG 压缩减少传输体积（比 PNG 小 60-80%）
              const compositeJpeg = await sharp(compositeResult).jpeg({ quality: 92 }).toBuffer();
              const resultDataUrl = `data:image/jpeg;base64,${compositeJpeg.toString('base64')}`;
              console.log(`[inpaint] AI erase result: JPEG base64 (${(compositeJpeg.length / 1024).toFixed(0)}KB, was PNG ${(compositeResult.length / 1024).toFixed(0)}KB)`);
              eraseUsedAI = true;
              return NextResponse.json({ success: true, imageUrl: resultDataUrl, action, engine: 'ai-erase' });
            } else if (eraseResult.taskId) {
              // 异步模式：尝试服务器端轮询（最多3分钟），超时则降级到BFS
              const ERASE_POLL_TIMEOUT_MS = 180_000; // 3分钟服务器端轮询上限
              const ERASE_POLL_INTERVAL_MS = 3000; // 3秒轮询间隔
              console.log(`[inpaint] AI erase async: taskId=${eraseResult.taskId}, server-side polling for up to ${ERASE_POLL_TIMEOUT_MS / 1000}s`);

              // ★ 注册异步擦除任务
              registerTask(eraseResult.taskId, 'erase', '擦除');

              // 服务器端轮询：尝试在超时内获取结果
              let asyncEraseSucceeded = false;
              const pollStart = Date.now();

              try {
                // 查找provider用于轮询
                const eraseProvider = await findProviderForModel(eraseResult.usedModel || '', 'image')
                  || await findProviderForModel(eraseResult.usedModel || '', 'imageEdit');
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

                          // 蒙版合成
                          const fullCropInfo: InpaintCropInfo = { cropX: 0, cropY: 0, cropW: origW, cropH: origH, origW, origH };
                          const compositeResult = await compositeAIResultToOriginal(
                            imageBuffer, resultOrigSize, eraseMaskForAI, origW, origH, fullCropInfo
                          );
                          const compositeJpeg = await sharp(compositeResult).jpeg({ quality: 92 }).toBuffer();
                          const resultDataUrl = `data:image/jpeg;base64,${compositeJpeg.toString('base64')}`;
                          console.log(`[inpaint] AI erase async result: JPEG base64 (${(compositeJpeg.length / 1024).toFixed(0)}KB)`);

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

                // ★ 不再直接降级到BFS，而是将taskId返回给前端继续轮询
                // 前端会在轮询到结果后进行蒙版合成
                return NextResponse.json({
                  success: true,
                  taskId: eraseResult.taskId,
                  action,
                  engine: 'ai-erase-async',
                  usedModel: eraseResult.usedModel,
                  // 蒙版合成信息：前端轮询到结果后需要这些信息来合成
                  compositeInfo: {
                    aiInputW,
                    aiInputH,
                    origW,
                    origH,
                    maskDataUrl: eraseMaskDataUrl,
                  },
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

          // 用裁剪区域的蒙版做柔边合成（增大模糊半径使过渡更自然，避免硬边错位感）
          const croppedSoftMask = await sharp(croppedMaskBuffer)
            .threshold(127)
            .blur(12)
            .grayscale()
            .raw()
            .toBuffer();

          const aiRaw = await sharp(resizedResult).ensureAlpha().raw().toBuffer();
          for (let i = 0; i < cropInfo.cropW * cropInfo.cropH; i++) {
            aiRaw[i * 4 + 3] = croppedSoftMask[i];
          }
          const aiWithAlpha = await sharp(aiRaw, { raw: { width: cropInfo.cropW, height: cropInfo.cropH, channels: 4 } }).png().toBuffer();

          // 将裁剪区域的 AI 结果合成回原图
          const compositeResult = await sharp(imageBuffer)
            .composite([{ input: aiWithAlpha, left: cropInfo.cropX, top: cropInfo.cropY, blend: 'over' }])
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
            return NextResponse.json({ success: true, imageUrl: result.directUrl, action, engine: 'ai-raw' });
          }
        }
      }

      // 异步结果 - 返回 taskId 给前端轮询，前端做蒙版合成
      // ★ 注册异步蒙版修图任务
      if (result.taskId) registerTask(result.taskId, 'mask', '蒙版修图');
      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        action,
        cropInfo,
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

      // 构建发送给AI的参考图（使用JPEG压缩+尺寸限制，避免请求体过大被代理拒绝）
      const maxRefEdge = 1024;
      const compositeRefBuffer = await sharp(compositeImage)
        .resize(maxRefEdge, maxRefEdge, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      const compositeBase64 = `data:image/jpeg;base64,${compositeRefBuffer.toString('base64')}`;
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

      // ★ 关键修复：将合成图（原图+灰色边框）作为参考图发送给 AI
      // 如果不发送参考图，AI 不知道原图内容，会生成与原图完全无关的内容
      //
      // 对于 /images/edits 端点（标准 OpenAI）:
      //   - `image` 字段是必须的（AI 必须编辑这张图）
      //   - `mask` 字段告诉 AI 哪里需要生成（白色=生成区域）
      //
      // 对于 /images/generations 端点（代理适配器）:
      //   - `image` 和 `mask` 会被兼容层自动移除（代理拒绝 "direct image relay"）
      //   - 仅通过 `image_urls` 传递参考图
      //   - 提示词中已包含扩展指引，AI 根据参考图+提示词理解任务
      genBody.image = compositeBase64;
      genBody.image_urls = [compositeBase64];
      genBody.mask = maskFileBase64;
      genBody.strength = 0.7;

      // Submit to AI model API
      // 兼容层会根据 profile 的 editEndpoint 决定最终端点:
      //   - OpenAI profile → /images/edits（保留 image + mask）
      //   - Proxy adapter profile → /images/generations（自动删除 image + mask，仅用 image_urls）
      const cm = candidateModels[0];
      const result = await submitImageTask(
        cm.apiBaseUrl, cm.apiKey, genBody, '/images/edits',
        { baseUrl: cm.apiBaseUrl, advancedParams: cm.advancedParams }
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
          // 输出用 JPEG 压缩减少传输体积
          const finalJpeg = await sharp(finalBuffer).jpeg({ quality: 92 }).toBuffer();
          compositeResultUrl = `data:image/jpeg;base64,${finalJpeg.toString('base64')}`;
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
      // ★ 注册异步 outpaint 任务到 task-registry，存储合成信息供 poll-task 使用
      if (result.taskId) {
        registerTask(result.taskId, 'outpaint', '扩展画面');
        updateTaskProgress(result.taskId, {
          status: 'processing',
          progress: 10,
          result: {
            outpaintInfo: { offsetX, offsetY, srcW, srcH, targetW, targetH, origW, origH, scaleFactor, scaledTargetW, scaledTargetH, scaledOffsetX, scaledOffsetY, scaledSrcW, scaledSrcH },
            originalImageUrl: imageUrl,
          }
        });
      }
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
