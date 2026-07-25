export type UpscaleTargetPreset = '2x' | '4x' | '4k' | '8k';

export interface UpscaleTargetPresetDefinition {
  id: UpscaleTargetPreset;
  label: string;
  shortLabel: string;
  mode: 'multiplier' | 'resolution';
  multiplier?: 2 | 4;
  targetLongEdge?: 4096 | 8192;
}

export interface UpscaleTargetDimensions {
  width: number;
  height: number;
  scale: number;
  engineScale: 2 | 4;
  mode: 'multiplier' | 'resolution';
  targetLongEdge?: number;
  canUpscale: boolean;
}

export const MAX_UPSCALE_EDGE = 8192;
export const MAX_UPSCALE_PIXELS = MAX_UPSCALE_EDGE * MAX_UPSCALE_EDGE;

export const UPSCALE_TARGET_PRESETS: readonly UpscaleTargetPresetDefinition[] = [
  {
    id: '2x',
    label: '2x 倍率',
    shortLabel: '2x',
    mode: 'multiplier',
    multiplier: 2,
  },
  {
    id: '4x',
    label: '4x 倍率',
    shortLabel: '4x',
    mode: 'multiplier',
    multiplier: 4,
  },
  {
    id: '4k',
    label: '4K 长边',
    shortLabel: '4K',
    mode: 'resolution',
    targetLongEdge: 4096,
  },
  {
    id: '8k',
    label: '8K 长边',
    shortLabel: '8K',
    mode: 'resolution',
    targetLongEdge: 8192,
  },
] as const;

function assertSourceDimensions(width: number, height: number): void {
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    throw new RangeError('原图尺寸无效');
  }
}

function roundToEight(value: number): number {
  return Math.max(8, Math.round(value / 8) * 8);
}

export function calculateUpscaleTargetDimensions(
  originalWidth: number,
  originalHeight: number,
  presetId: UpscaleTargetPreset,
): UpscaleTargetDimensions {
  assertSourceDimensions(originalWidth, originalHeight);

  const preset = UPSCALE_TARGET_PRESETS.find(item => item.id === presetId);
  if (!preset) {
    throw new RangeError(`不支持的放大预设: ${presetId}`);
  }

  if (preset.mode === 'multiplier') {
    const multiplier = preset.multiplier ?? 2;
    return {
      width: Math.round(originalWidth * multiplier),
      height: Math.round(originalHeight * multiplier),
      scale: multiplier,
      engineScale: multiplier,
      mode: preset.mode,
      canUpscale: true,
    };
  }

  const targetLongEdge = preset.targetLongEdge ?? 4096;
  const originalLongEdge = Math.max(originalWidth, originalHeight);
  if (originalLongEdge >= targetLongEdge) {
    return {
      width: Math.round(originalWidth),
      height: Math.round(originalHeight),
      scale: 1,
      engineScale: 2,
      mode: preset.mode,
      targetLongEdge,
      canUpscale: false,
    };
  }

  const scale = targetLongEdge / originalLongEdge;
  const isLandscape = originalWidth >= originalHeight;
  const width = isLandscape
    ? targetLongEdge
    : roundToEight(originalWidth * scale);
  const height = isLandscape
    ? roundToEight(originalHeight * scale)
    : targetLongEdge;

  return {
    width,
    height,
    scale,
    engineScale: scale <= 2 ? 2 : 4,
    mode: preset.mode,
    targetLongEdge,
    canUpscale: true,
  };
}

export function validateUpscaleTargetDimensions(
  originalWidth: number,
  originalHeight: number,
  targetWidth: number,
  targetHeight: number,
): string | null {
  const dimensions = [originalWidth, originalHeight, targetWidth, targetHeight];
  if (dimensions.some(value => !Number.isInteger(value) || value <= 0)) {
    return '原图和目标尺寸必须为正整数';
  }

  if (targetWidth > MAX_UPSCALE_EDGE || targetHeight > MAX_UPSCALE_EDGE) {
    return `目标尺寸不能超过 ${MAX_UPSCALE_EDGE} x ${MAX_UPSCALE_EDGE}`;
  }

  if (targetWidth * targetHeight > MAX_UPSCALE_PIXELS) {
    return `目标图片不能超过 ${MAX_UPSCALE_PIXELS} 像素`;
  }

  if (targetWidth < originalWidth || targetHeight < originalHeight) {
    return '放大目标尺寸不能小于原图';
  }

  const sourceRatio = originalWidth / originalHeight;
  const targetRatio = targetWidth / targetHeight;
  const ratioDifference = Math.abs(targetRatio - sourceRatio) / sourceRatio;
  if (ratioDifference > 0.01) {
    return '目标尺寸必须保持原图宽高比';
  }

  return null;
}
