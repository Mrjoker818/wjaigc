export type UpscaleProductMode = 'auto' | 'ai-only' | 'fidelity';
export type UpscaleProviderKind = 'dedicated-ai' | 'local-ai';
export type UpscaleExecutionEngine = UpscaleProviderKind | 'fidelity';

export interface UpscaleProviderCapability {
  id: string;
  kind: UpscaleProviderKind;
  maxInputEdge: number;
  maxScale: number;
  supportsTiling: boolean;
  available?: boolean;
}

export interface UpscaleExecutionPlanInput {
  mode: UpscaleProductMode;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  providers: readonly UpscaleProviderCapability[];
  tileSize?: number;
  overlap?: number;
}

export interface UpscaleExecutionPlan {
  engine: UpscaleExecutionEngine;
  providerId: string | null;
  tiled: boolean;
  tileSize: number;
  overlap: number;
  fallbackAllowed: boolean;
  fallbackReason: string | null;
  targetScale: number;
}

/**
 * A user-selected 302 model is an explicit provider choice, not a preference.
 * It must never silently fall back to the local fidelity path after charging.
 */
export function resolveUpscaleProductMode(
  requestedMode: string | undefined,
  hasExact302Selection: boolean,
): UpscaleProductMode {
  if (hasExact302Selection) return 'ai-only';
  if (requestedMode === 'ai' || requestedMode === 'ai-only') return 'ai-only';
  if (
    requestedMode === 'cpu'
    || requestedMode === 'local'
    || requestedMode === 'fidelity'
  ) {
    return 'fidelity';
  }
  return 'auto';
}

function assertDimensions(input: UpscaleExecutionPlanInput): void {
  const dimensions = [input.sourceWidth, input.sourceHeight, input.targetWidth, input.targetHeight];
  if (dimensions.some(value => !Number.isInteger(value) || value <= 0)) {
    throw new RangeError('超分编排尺寸必须为正整数');
  }
  if (input.targetWidth < input.sourceWidth || input.targetHeight < input.sourceHeight) {
    throw new RangeError('超分目标尺寸不能小于原图');
  }
}

export function createUpscaleExecutionPlan(
  input: UpscaleExecutionPlanInput,
): UpscaleExecutionPlan {
  assertDimensions(input);

  const tileSize = input.tileSize ?? 768;
  const overlap = input.overlap ?? 64;
  const targetScale = Math.max(
    input.targetWidth / input.sourceWidth,
    input.targetHeight / input.sourceHeight,
  );

  if (input.mode === 'fidelity') {
    return {
      engine: 'fidelity',
      providerId: null,
      tiled: false,
      tileSize,
      overlap,
      fallbackAllowed: false,
      fallbackReason: '用户选择保真放大',
      targetScale,
    };
  }

  const availableProviders = input.providers.filter(provider => provider.available !== false);
  const provider = availableProviders.find(item => item.kind === 'dedicated-ai')
    ?? availableProviders.find(item => item.kind === 'local-ai');

  if (!provider) {
    if (input.mode === 'ai-only') {
      throw new Error('AI 超分模型不可用，AI 超分模式不会静默降级为 CPU 插值');
    }
    return {
      engine: 'fidelity',
      providerId: null,
      tiled: false,
      tileSize,
      overlap,
      fallbackAllowed: true,
      fallbackReason: '未配置可用的 AI 超分模型，已降级为保真放大',
      targetScale,
    };
  }

  const sourceLongEdge = Math.max(input.sourceWidth, input.sourceHeight);
  const targetLongEdge = Math.max(input.targetWidth, input.targetHeight);
  const requiresTiling = provider.supportsTiling && (
    targetLongEdge >= 8192
    || sourceLongEdge > provider.maxInputEdge
    || targetScale > provider.maxScale
  );

  return {
    engine: provider.kind,
    providerId: provider.id,
    tiled: requiresTiling,
    tileSize,
    overlap,
    fallbackAllowed: input.mode === 'auto',
    fallbackReason: null,
    targetScale,
  };
}
