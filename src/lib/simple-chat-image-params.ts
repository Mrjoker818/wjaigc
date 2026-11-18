// Parses image size / ratio / quality requests from a chat instruction and fits them to
// what the selected image model actually supports (same spec tables as the canvas panel).
import {
  getModelParamType,
  getProviderAspectRatios,
  getQualityLevelOptions,
  getResolutionTierOptions,
} from '@/lib/canvas-generation-group';

export interface RequestedImageParams {
  aspectRatio?: string;
  resolution?: '1K' | '2K' | '4K';
  quality?: 'low' | 'medium' | 'high';
  width?: number;
  height?: number;
}

export interface FittedImageParams {
  aspectRatio: string;
  /** Value for /api/generate `quality` (tier for resolution models, level for quality models). */
  quality?: string;
  /** Value for /api/generate `resolution`. */
  resolution?: string;
  notes: string[];
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function tierFromPixels(longSide: number): '1K' | '2K' | '4K' {
  if (longSide <= 1280) return '1K';
  if (longSide <= 2560) return '2K';
  return '4K';
}

/** Extracts explicit size, ratio, resolution and quality requirements from user text. */
export function parseImageRequest(text: string): RequestedImageParams {
  const result: RequestedImageParams = {};
  const source = text || '';

  const pixel = source.match(/(?<!\d)(\d{3,5})\s*[x×*X]\s*(\d{3,5})(?!\d)/);
  if (pixel) {
    const width = Number(pixel[1]);
    const height = Number(pixel[2]);
    if (width >= 256 && height >= 256) {
      const d = gcd(width, height);
      result.width = width;
      result.height = height;
      result.aspectRatio = `${width / d}:${height / d}`;
      result.resolution = tierFromPixels(Math.max(width, height));
    }
  }

  if (!result.aspectRatio) {
    const ratio = source.match(/(?<!\d)(\d{1,2})\s*[:：]\s*(\d{1,2})(?!\d)|(?<!\d)(\d{1,2})\s*比\s*(\d{1,2})(?!\d)/);
    const w = Number(ratio?.[1] || ratio?.[3]);
    const h = Number(ratio?.[2] || ratio?.[4]);
    if (w > 0 && h > 0 && w <= 32 && h <= 32) result.aspectRatio = `${w}:${h}`;
  }
  if (!result.aspectRatio) {
    if (/竖版|竖屏|竖图|手机壁纸|海报竖|portrait/i.test(source)) result.aspectRatio = '9:16';
    else if (/横版|横屏|横图|宽屏|电脑壁纸|banner|landscape/i.test(source)) result.aspectRatio = '16:9';
    else if (/正方形|方图|方形|头像|square/i.test(source)) result.aspectRatio = '1:1';
  }

  const tier = source.match(/(?<![\dA-Za-z])([124])\s*[kK](?![A-Za-z])/);
  if (tier) result.resolution = `${tier[1]}K` as '1K' | '2K' | '4K';
  else if (!result.resolution) {
    if (/超高清|超清|8k|最高分辨率/i.test(source)) result.resolution = '4K';
    else if (/高清|高分辨率|\bhd\b/i.test(source)) result.resolution = '2K';
  }

  if (/最高质量|高质量|高品质|精细|细节丰富|极致画质|high quality/i.test(source)) result.quality = 'high';
  else if (/中等质量|标准质量|medium quality/i.test(source)) result.quality = 'medium';
  else if (/低质量|草图|快速出图|草稿|low quality/i.test(source)) result.quality = 'low';

  return result;
}

const TIER_ORDER = ['1K', '2K', '4K'];
const LEVEL_ORDER = ['low', 'medium', 'high'];

function nearestOption(wanted: string, options: string[], order: string[]): string | undefined {
  if (options.length === 0) return undefined;
  if (options.includes(wanted)) return wanted;
  const target = order.indexOf(wanted);
  const ranked = options
    .filter(o => order.includes(o))
    .sort((a, b) => Math.abs(order.indexOf(a) - target) - Math.abs(order.indexOf(b) - target) || order.indexOf(b) - order.indexOf(a));
  return ranked[0];
}

function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number);
  return w > 0 && h > 0 ? w / h : NaN;
}

function nearestRatio(wanted: string, options: string[]): string | undefined {
  const numeric = options.filter(o => !Number.isNaN(ratioValue(o)));
  if (numeric.includes(wanted)) return wanted;
  const target = ratioValue(wanted);
  if (Number.isNaN(target) || numeric.length === 0) return undefined;
  return [...numeric].sort((a, b) => Math.abs(Math.log(ratioValue(a) / target)) - Math.abs(Math.log(ratioValue(b) / target)))[0];
}
/**
 * Maps requested params onto the model's real spec. Unsupported values fall back to the
 * nearest supported one and a note explains the adjustment to the user.
 */
export function fitImageParams(
  requested: RequestedImageParams,
  toolAspectRatio: string,
  modelId: string,
  providerHint: string,
): FittedImageParams {
  const notes: string[] = [];
  const supportedRatios = getProviderAspectRatios(modelId, providerHint);
  const wantedRatio = requested.aspectRatio || toolAspectRatio || '1:1';
  let aspectRatio = wantedRatio;
  if (supportedRatios.length > 0) {
    const fitted = nearestRatio(wantedRatio, supportedRatios) || supportedRatios.find(r => r !== 'auto') || '1:1';
    if (fitted !== wantedRatio) notes.push(`模型不支持 ${wantedRatio}，已改用最接近的 ${fitted}`);
    aspectRatio = fitted;
  }

  const paramType = getModelParamType(modelId, providerHint);
  const tiers = getResolutionTierOptions(modelId, providerHint).map(t => t.toUpperCase());
  const levels = getQualityLevelOptions(modelId, providerHint).map(l => l.toLowerCase());
  let quality: string | undefined;
  let resolution: string | undefined;

  if (requested.resolution) {
    if (paramType === 'resolution' || paramType === 'both') {
      const tier = nearestOption(requested.resolution, tiers, TIER_ORDER);
      if (tier) {
        if (tier !== requested.resolution) notes.push(`模型最高支持 ${tier}，已从 ${requested.resolution} 调整`);
        resolution = tier;
        if (paramType === 'resolution') quality = tier;
      }
    } else {
      notes.push(`当前模型不支持分辨率档位，已忽略 ${requested.resolution}`);
    }
  }

  if (requested.quality) {
    if (paramType === 'quality' || paramType === 'both') {
      const level = nearestOption(requested.quality, levels, LEVEL_ORDER);
      if (level) quality = level;
    } else if (paramType === 'resolution' && !resolution) {
      // Resolution-only models express quality through the tier.
      const wantedTier = requested.quality === 'high' ? '4K' : requested.quality === 'medium' ? '2K' : '1K';
      const tier = nearestOption(wantedTier, tiers, TIER_ORDER);
      if (tier) { resolution = tier; quality = tier; }
    }
  }

  if (requested.width && requested.height) {
    notes.push(`按 ${requested.width}×${requested.height} 映射为 ${aspectRatio}${resolution ? ` / ${resolution}` : ''}，实际像素以模型输出为准`);
  }

  return { aspectRatio, quality, resolution, notes };
}

/** Short human-readable summary of the parameters actually sent. */
export function describeFittedParams(params: FittedImageParams): string {
  const parts = [`比例 ${params.aspectRatio}`];
  if (params.resolution) parts.push(`分辨率 ${params.resolution}`);
  if (params.quality && params.quality !== params.resolution) parts.push(`质量 ${params.quality}`);
  return parts.join('，');
}
