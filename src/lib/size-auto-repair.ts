/**
 * Size Auto-Repair — 运行时自动修正无效尺寸
 *
 * v3.4.1 升级：从仅支持 GPT-Image 扩展为覆盖所有主流图像模型。
 *
 * 参考 Image-Studio 的 normalizeOpenAIImageSize 多约束优化算法，
 * 结合 model-capabilities.ts 的模型能力注册表，按模型家族精确修正尺寸。
 *
 * 纯增量模块，不修改任何现有代码（零风险）。
 * 只在检测到 size 相关错误时才被调用，正常流程完全不受影响。
 */

import { calculateActualPixels, calculateActualPixelsFromRatio } from './canvas-generation-group';
import { getModelCapabilities, classifyModelFamily, type ModelFamily } from './model-capabilities';

/** 向后兼容的旧模型族类型 */
type LegacyModelFamily = 'dalle3' | 'gpt-image' | 'other';

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

  // 匹配 Flux/SD 的 "dimensions must be multiples of 8"
  if (lower.includes('multiples of') && lower.includes('dimension')) {
    const sizeInMsg = lower.match(/(\d{3,4}x\d{3,4})/);
    if (sizeInMsg) return sizeInMsg[1];
  }

  // 匹配 Seedream 的 "分辨率不在支持范围"
  if (lower.includes('分辨率') && (lower.includes('不支持') || lower.includes('范围'))) {
    const sizeInMsg = lower.match(/(\d{3,4}x\d{3,4})/);
    if (sizeInMsg) return sizeInMsg[1];
  }

  return null;
}

/**
 * 将宽度和高度对齐到 alignment 的倍数
 */
function alignTo(n: number, alignment: number): number {
  if (alignment <= 0) return n;
  return Math.round(n / alignment) * alignment;
}

/**
 * 修正尺寸为合法值 — 通用版本（支持所有模型家族）
 *
 * @param originalSize 原始尺寸字符串 (如 "1024x768")
 * @param modelFamilyOrId 模型家族名或模型 ID
 * @returns 修正后的尺寸字符串，或 null 表示无需修正
 */
export function repairSize(
  originalSize: string,
  modelFamilyOrId?: LegacyModelFamily | string,
): string | null {
  // 解析原始尺寸
  const parts = originalSize.split('x');
  if (parts.length !== 2) return null;

  const origW = parseInt(parts[0], 10);
  const origH = parseInt(parts[1], 10);
  if (isNaN(origW) || isNaN(origH) || origW <= 0 || origH <= 0) return null;

  // 获取模型能力
  const modelId = modelFamilyOrId || 'other';
  const caps = getModelCapabilities(modelId);

  // 固定尺寸模型：直接映射到允许列表
  if (caps.fixedSizesOnly && caps.allowedSizes.length > 0) {
    return findClosestSizeFromList(origW, origH, caps.allowedSizes);
  }

  // 多约束优化修正
  return multiConstraintRepairSize(origW, origH, caps);
}

/**
 * 多约束优化尺寸修正
 *
 * 参考 Image-Studio 的 normalizeOpenAIImageSize 算法：
 * 1. 宽高比约束
 * 2. 边长约束 (minSide ~ maxSide)
 * 3. 像素总数约束 (maxPixels)
 * 4. 对齐约束 (sizeAlignment)
 * 5. 多候选值三重评分（欧氏距离 + 宽高比距离 + 面积距离）
 */
function multiConstraintRepairSize(
  origW: number,
  origH: number,
  caps: { minSide: number; maxSide: number; maxPixels: number; maxAspectRatio: number; sizeAlignment: number },
): string | null {
  const { minSide, maxSide, maxPixels, maxAspectRatio, sizeAlignment } = caps;

  let targetW = origW;
  let targetH = origH;

  // 约束宽高比
  let aspect = targetW / targetH;
  if (aspect > maxAspectRatio) {
    aspect = maxAspectRatio;
    targetW = targetH * aspect;
  } else if (aspect < 1 / maxAspectRatio) {
    targetW = targetH / maxAspectRatio;
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

  // 如果有对齐约束，使用三重评分算法
  if (sizeAlignment > 0) {
    return alignedRepairWithScoring(origW, origH, targetW, targetH, caps);
  }

  // 无对齐约束：直接取整
  let finalW = Math.max(minSide, Math.min(maxSide, Math.round(targetW)));
  let finalH = Math.max(minSide, Math.min(maxSide, Math.round(targetH)));

  // 最终验证
  if (finalW * finalH > maxPixels) {
    const scale = Math.sqrt(maxPixels / (finalW * finalH));
    finalW = Math.max(minSide, Math.round(finalW * scale));
    finalH = Math.max(minSide, Math.round(finalH * scale));
  }

  const repaired = `${finalW}x${finalH}`;
  return repaired !== `${origW}x${origH}` ? repaired : null;
}

/**
 * 对齐约束下的三重评分算法
 *
 * 参考 Image-Studio 的 alignedDimensionCandidates + sizeDistance 逻辑：
 * 对宽和高分别生成 3 个候选值（nearest/floor/ceil 对齐），
 * 然后遍历所有组合，按 (距离, 宽高比距离, 面积距离) 三重评分选最优。
 */
function alignedRepairWithScoring(
  origW: number,
  origH: number,
  targetW: number,
  targetH: number,
  caps: { minSide: number; maxSide: number; maxPixels: number; maxAspectRatio: number; sizeAlignment: number },
): string | null {
  const { minSide, maxSide, maxPixels, maxAspectRatio, sizeAlignment } = caps;

  const wCandidates = alignedDimensionCandidates(targetW, minSide, maxSide, sizeAlignment);
  const hCandidates = alignedDimensionCandidates(targetH, minSide, maxSide, sizeAlignment);

  let bestW = 0;
  let bestH = 0;
  let bestDistance = Infinity;
  let bestAspectDistance = Infinity;
  let bestAreaDistance = Infinity;

  for (const w of wCandidates) {
    for (const h of hCandidates) {
      // 验证约束
      if (w < minSide || h < minSide || w > maxSide || h > maxSide) continue;
      if (w * h > maxPixels) continue;
      const aspect = w / h;
      if (aspect > maxAspectRatio || aspect < 1 / maxAspectRatio) continue;

      // 三重评分
      const distance = Math.abs(w - targetW) / Math.max(targetW, 1) +
                       Math.abs(h - targetH) / Math.max(targetH, 1);
      const aspectDistance = Math.abs(aspect - (targetW / targetH));
      const areaDistance = Math.abs(w * h - targetW * targetH) / Math.max(targetW * targetH, 1);

      if (
        distance < bestDistance ||
        (distance === bestDistance && aspectDistance < bestAspectDistance) ||
        (distance === bestDistance && aspectDistance === bestAspectDistance && areaDistance < bestAreaDistance)
      ) {
        bestW = w;
        bestH = h;
        bestDistance = distance;
        bestAspectDistance = aspectDistance;
        bestAreaDistance = areaDistance;
      }
    }
  }

  if (bestW === 0 || bestH === 0) {
    // 降级到 1024x1024
    bestW = 1024;
    bestH = 1024;
  }

  const repaired = `${bestW}x${bestH}`;
  return repaired !== `${origW}x${origH}` ? repaired : null;
}

/**
 * 生成对齐候选值（nearest/floor/ceil），去重排序
 */
function alignedDimensionCandidates(
  value: number,
  min: number,
  max: number,
  alignment: number,
): number[] {
  const clamped = Math.max(min, Math.min(max, value));
  const candidates = [
    Math.round(clamped / alignment) * alignment,
    Math.floor(clamped / alignment) * alignment,
    Math.ceil(clamped / alignment) * alignment,
  ].map(c => Math.max(min, Math.min(max, c)));

  // 去重并按距离排序
  const unique = [...new Set(candidates)];
  unique.sort((a, b) => Math.abs(a - clamped) - Math.abs(b - clamped) || b - a);
  return unique;
}

/**
 * 在已知尺寸列表中找最接近的
 */
function findClosestSizeFromList(
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

  return bestSize !== `${targetW}x${targetH}` ? bestSize : null;
}

/**
 * 检测模型族系 — 向后兼容
 * @deprecated 建议使用 model-capabilities.ts 的 classifyModelFamily()
 */
export function classifyImageModelFamily(modelId: string): LegacyModelFamily {
  const family = classifyModelFamily(modelId);
  if (family === 'dalle3') return 'dalle3';
  if (family === 'gpt-image') return 'gpt-image';
  return 'other';
}

/**
 * 从比例格式（如 "16:9"）和 quality 计算合法像素尺寸
 * 用于在 size 错误后重新计算
 * ★ 优先使用后端规范表（传入 modelId），确保与 API 官方文档一致
 */
export function recalculatePixelSize(
  aspectRatio: string,
  quality: string,
  modelId?: string,
): string | null {
  // 优先使用后端规范表（更准确，已对照 API 官方文档校验）
  if (modelId) {
    try {
      const pixelSize = calculateActualPixelsFromRatio(aspectRatio, quality, modelId);
      if (pixelSize) {
        const [w, h] = pixelSize.split('x').map(Number);
        if (w >= 64 && h >= 64) {
          return pixelSize;
        }
      }
    } catch {
      // fall through to frontend table
    }
  }
  // 兜底：使用前端像素表
  try {
    const pixelSize = calculateActualPixels(aspectRatio, quality, modelId);
    if (pixelSize) {
      const [w, h] = pixelSize.split('x').map(Number);
      if (w >= 64 && h >= 64) {
        return pixelSize;
      }
    }
  } catch {
    // calculateActualPixels 可能抛异常
  }
  return null;
}
