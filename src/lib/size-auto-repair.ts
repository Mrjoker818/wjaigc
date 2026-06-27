/**
 * Size Auto-Repair — 运行时自动修正无效尺寸
 *
 * 参考 Image-Studio 的 repairSizeForOpenAIOptions 设计，
 * 当 API 返回 "Invalid size" 错误时，自动修正为合法尺寸并重试。
 *
 * 纯新增模块，不修改任何现有代码（零风险）。
 * 只在检测到 size 相关错误时才被调用，正常流程完全不受影响。
 */

import { calculateActualPixels } from './canvas-generation-group';

/** OpenAI 图像模型的尺寸约束 */
const SIZE_CONSTRAINTS = {
  /** 最小边长 */
  minSide: 64,
  /** 最大边长 */
  maxSide: 4096,
  /** 最大像素数 */
  maxPixels: 4194304, // 2048x2048
  /** 宽高比上限 */
  maxAspect: 3.0,
  /** 对齐要求（必须是此值的倍数） */
  alignment: 16,
} as const;

/** DALL-E 3 官方支持的尺寸 */
const DALLE3_VALID_SIZES = ['1024x1024', '1024x1792', '1792x1024'];

/** GPT-Image 系列支持的常见尺寸 */
const GPT_IMAGE_COMMON_SIZES = [
  '1024x1024', '1024x1536', '1536x1024',
  '1024x1792', '1792x1024',
  '512x512', '512x768', '768x512',
  '2048x2048', '2048x3072', '3072x2048',
];

/**
 * 检测错误消息是否包含尺寸无效信息
 */
export function detectInvalidSizeError(errorMsg: string): string | null {
  if (!errorMsg) return null;
  const lower = errorMsg.toLowerCase();

  // 匹配 "Invalid size '1024x768'" 之类
  const sizeMatch = lower.match(/invalid size\s+['"]?(\d+x\d+)['"]?/);
  if (sizeMatch) return sizeMatch[1];

  // 匹配 "must be divisible by 16"
  if (lower.includes('must be divisible by') && lower.includes('size')) {
    // 尝试从错误消息中提取尺寸
    const sizeInMsg = lower.match(/(\d{3,4}x\d{3,4})/);
    if (sizeInMsg) return sizeInMsg[1];
  }

  // 匹配 "size is not supported" 或 "unsupported size"
  if (
    (lower.includes('size') && lower.includes('not supported')) ||
    lower.includes('unsupported size')
  ) {
    const sizeInMsg = lower.match(/(\d{3,4}x\d{3,4})/);
    if (sizeInMsg) return sizeInMsg[1];
  }

  return null;
}

/**
 * 将宽度和高度对齐到 alignment 的倍数
 */
function alignTo(n: number, alignment: number): number {
  return Math.round(n / alignment) * alignment;
}

/**
 * 修正尺寸为合法值
 *
 * 算法：
 * 1. 对齐到 16 的倍数
 * 2. 约束在 minSide ~ maxSide 范围内
 * 3. 约束宽高比在 1:3 ~ 3:1 范围内
 * 4. 约束总像素数不超过 maxPixels
 * 5. 在多个候选值中选择最接近原始尺寸的
 *
 * @returns 修正后的尺寸字符串（如 "1024x1024"），或 null 表示无法修正
 */
export function repairSize(
  originalSize: string,
  modelFamily?: 'dalle3' | 'gpt-image' | 'other',
): string | null {
  // 解析原始尺寸
  const parts = originalSize.split('x');
  if (parts.length !== 2) return null;

  const origW = parseInt(parts[0], 10);
  const origH = parseInt(parts[1], 10);
  if (isNaN(origW) || isNaN(origH) || origW <= 0 || origH <= 0) return null;

  // DALL-E 3 只支持 3 个固定尺寸，直接映射
  if (modelFamily === 'dalle3') {
    return findClosestDalle3Size(origW, origH);
  }

  // GPT-Image 系列：先尝试已知尺寸，再走通用修正
  if (modelFamily === 'gpt-image') {
    const closest = findClosestSize(origW, origH, GPT_IMAGE_COMMON_SIZES);
    if (closest) return closest;
  }

  // 通用修正
  return genericRepairSize(origW, origH);
}

/**
 * 在已知尺寸列表中找最接近的
 */
function findClosestSize(
  targetW: number,
  targetH: number,
  sizeList: string[],
): string | null {
  let bestDist = Infinity;
  let bestSize: string | null = null;

  for (const size of sizeList) {
    const [w, h] = size.split('x').map(Number);
    if (isNaN(w) || isNaN(h)) continue;
    const dist = Math.abs(w - targetW) + Math.abs(h - targetH);
    if (dist < bestDist) {
      bestDist = dist;
      bestSize = size;
    }
  }
  return bestSize;
}

/**
 * DALL-E 3 尺寸映射：选择最接近的官方支持尺寸
 */
function findClosestDalle3Size(w: number, h: number): string {
  // 计算宽高比
  const aspect = w / h;
  if (aspect > 1.3) return '1792x1024';  // 横屏
  if (aspect < 0.77) return '1024x1792';  // 竖屏
  return '1024x1024';                     // 方屏
}

/**
 * 通用尺寸修正
 *
 * 参考 Image-Studio 的 normalizeOpenAIImageSize 算法
 */
function genericRepairSize(origW: number, origH: number): string | null {
  const { minSide, maxSide, maxPixels, maxAspect, alignment } = SIZE_CONSTRAINTS;

  let targetW = origW;
  let targetH = origH;

  // 约束宽高比
  let aspect = targetW / targetH;
  if (aspect > maxAspect) {
    aspect = maxAspect;
    targetW = targetH * aspect;
  } else if (aspect < 1 / maxAspect) {
    aspect = 1 / maxAspect;
    targetW = targetH * aspect;
  }

  // 约束最大边
  const maxEdge = Math.max(targetW, targetH);
  if (maxEdge > maxSide) {
    const scale = maxSide / maxEdge;
    targetW *= scale;
    targetH *= scale;
  }

  // 约束总像素数
  const pixels = targetW * targetH;
  if (pixels > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixels);
    targetW *= scale;
    targetH *= scale;
  }

  // 对齐到 alignment 的倍数
  let alignedW = alignTo(Math.round(targetW), alignment);
  let alignedH = alignTo(Math.round(targetH), alignment);

  // 确保在合法范围内
  alignedW = Math.max(minSide, Math.min(maxSide, alignedW));
  alignedH = Math.max(minSide, Math.min(maxSide, alignedH));

  // 验证约束
  if (alignedW * alignedH > maxPixels) {
    // 降级到 1024x1024
    alignedW = 1024;
    alignedH = 1024;
  }

  const repaired = `${alignedW}x${alignedH}`;
  // 如果修正结果和原始一样，说明原始尺寸本身就没问题
  if (repaired === `${origW}x${origH}`) return null;

  return repaired;
}

/**
 * 检测模型族系
 */
export function classifyImageModelFamily(modelId: string): 'dalle3' | 'gpt-image' | 'other' {
  const lower = modelId.toLowerCase();
  if (lower.includes('dall-e-3') || lower === 'dall-e-3') return 'dalle3';
  if (
    lower.includes('gpt-image') ||
    lower.includes('chatgpt-image')
  ) return 'gpt-image';
  return 'other';
}

/**
 * 从比例格式（如 "16:9"）和 quality 计算合法像素尺寸
 * 用于在 size 错误后重新计算
 */
export function recalculatePixelSize(
  aspectRatio: string,
  quality: string,
): string | null {
  try {
    const pixelSize = calculateActualPixels(aspectRatio, quality);
    if (pixelSize) {
      // 验证尺寸合法
      const [w, h] = pixelSize.split('x').map(Number);
      if (w >= SIZE_CONSTRAINTS.minSide && h >= SIZE_CONSTRAINTS.minSide) {
        return pixelSize;
      }
    }
  } catch {
    // calculateActualPixels 可能抛异常
  }
  return null;
}
