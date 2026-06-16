/**
 * 图像分析器 — 矢量化管线前置分析
 * 分析图像特征（颜色数量、渐变、线稿、复杂度），
 * 自动推荐最优矢量化引擎。
 */
import type { VectorizeEngine } from './vectorize-pipeline';

export interface ImageAnalysis {
  /** 图片宽度 */
  width: number;
  /** 图片高度 */
  height: number;
  /** 去重后颜色数量 */
  uniqueColors: number;
  /** 是否含有渐变 */
  hasGradient: boolean;
  /** 是否为线稿（黑白为主） */
  isLineArt: boolean;
  /** 是否为简单图形（颜色少、边缘清晰） */
  isSimpleGraphic: boolean;
  /** 是否为卡通/吉祥物风格 */
  isCartoon: boolean;
  /** 推荐引擎（按优先级） */
  recommendedEngines: VectorizeEngine[];
  /** 推荐理由 */
  recommendationReason: string;
}

/**
 * 从 SVG 数据中提取基本分析信息（无需 sharp）
 * 通过图片 URL 获取元信息并分析
 */
export function analyzeFromMetadata(
  width: number,
  height: number,
  mode?: string,
  customHint?: string,
): Pick<ImageAnalysis, 'recommendedEngines' | 'recommendationReason'> {
  // 如果用户指定了模式，直接根据模式推荐
  if (mode === 'bw' || mode === 'cutting' || mode === 'engraving' || mode === 'lineart') {
    return {
      recommendedEngines: ['vtracer-bw'],
      recommendationReason: '用户指定黑白/线稿模式，使用 potrace 黑白矢量化',
    };
  }

  // 如果用户提供了自定义提示，可以引导到 VLM
  if (customHint) {
    return {
      recommendedEngines: ['recraft', 'vtracer', 'vlm'],
      recommendationReason: '用户提供了自定义提示，优先使用 Recraft 矢量模型',
    };
  }

  // 默认推荐链
  return {
    recommendedEngines: ['recraft', 'vtracer', 'vlm'],
    recommendationReason: '默认推荐链：Recraft 专业矢量化 → vtracer 传统描摹 → VLM 视觉模型 fallback',
  };
}

/**
 * 基于 sharp 的图像分析（服务端专用）
 * 分析颜色数量、渐变、线稿特征等
 */
export async function analyzeWithSharp(
  imageBuffer: Buffer,
  width: number,
  height: number,
): Promise<ImageAnalysis> {
  // 延迟导入 sharp，避免在客户端加载
  const sharp = (await import('sharp')).default;

  const { data, info } = await sharp(imageBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const pixelCount = width * height;

  // 1. 颜色统计（量化到 5bit 减少颜色数）
  const colorSet = new Set<string>();
  const sampleStep = Math.max(1, Math.floor(pixelCount / 50000)); // 最多采样 5万像素
  for (let i = 0; i < pixelCount; i += sampleStep) {
    const offset = i * channels;
    const r = data[offset]! >> 3;
    const g = data[offset + 1]! >> 3;
    const b = data[offset + 2]! >> 3;
    colorSet.add(`${r},${g},${b}`);
  }
  const uniqueColors = colorSet.size;

  // 2. 渐变检测 — 采样相邻像素色差
  let gradientScore = 0;
  const gradientSamples = Math.min(1000, pixelCount);
  for (let i = 0; i < gradientSamples; i++) {
    const idx = Math.floor(Math.random() * (pixelCount - 1));
    const offset1 = idx * channels;
    const offset2 = (idx + 1) * channels;
    const dr = Math.abs(data[offset1]! - data[offset2]!);
    const dg = Math.abs(data[offset1 + 1]! - data[offset2 + 1]!);
    const db = Math.abs(data[offset1 + 2]! - data[offset2 + 2]!);
    const diff = dr + dg + db;
    if (diff > 5 && diff < 60) gradientScore++; // 渐变：色差小但不为零
  }
  const hasGradient = gradientScore / gradientSamples > 0.3;

  // 3. 线稿检测 — 黑白像素占比
  let darkPixels = 0;
  let lightPixels = 0;
  for (let i = 0; i < pixelCount; i += sampleStep) {
    const offset = i * channels;
    const brightness = (data[offset]! + data[offset + 1]! + data[offset + 2]!) / 3;
    if (brightness < 40) darkPixels++;
    else if (brightness > 220) lightPixels++;
  }
  const darkRatio = darkPixels / (pixelCount / sampleStep);
  const lightRatio = lightPixels / (pixelCount / sampleStep);
  const isLineArt = darkRatio < 0.3 && lightRatio > 0.6 && uniqueColors < 50;

  // 4. 简单图形判断 — 颜色少且无渐变
  const isSimpleGraphic = uniqueColors < 30 && !hasGradient;

  // 5. 卡通风格判断 — 颜色中等、无明显渐变
  const isCartoon = uniqueColors >= 10 && uniqueColors <= 200 && !hasGradient;

  // 6. 推荐引擎
  let recommendedEngines: VectorizeEngine[];
  let recommendationReason: string;

  if (isLineArt) {
    recommendedEngines = ['vtracer-bw', 'recraft', 'vtracer'];
    recommendationReason = '检测为线稿图像，优先使用 potrace 黑白矢量化';
  } else if (isSimpleGraphic) {
    recommendedEngines = ['recraft', 'vtracer', 'vlm'];
    recommendationReason = '检测为简单图形（颜色少、无渐变），Recraft 可达到接近 1:1 还原';
  } else if (isCartoon) {
    recommendedEngines = ['recraft', 'vtracer', 'vlm'];
    recommendationReason = '检测为卡通/吉祥物风格，Recraft 语义分组效果最优';
  } else if (hasGradient) {
    recommendedEngines = ['recraft', 'vtracer', 'vlm'];
    recommendationReason = '检测到渐变，Recraft 处理渐变效果最佳，vtracer 可能产生色带';
  } else {
    recommendedEngines = ['recraft', 'vtracer', 'vlm'];
    recommendationReason = '默认推荐链：Recraft 专业矢量化 → vtracer 传统描摹 → VLM 视觉模型';
  }

  return {
    width,
    height,
    uniqueColors,
    hasGradient,
    isLineArt,
    isSimpleGraphic,
    isCartoon,
    recommendedEngines,
    recommendationReason,
  };
}
