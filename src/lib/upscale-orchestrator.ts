export type UpscaleProductMode = 'auto' | 'ai-only';
export type UpscaleProviderKind = 'dedicated-ai';
export type UpscaleExecutionEngine = UpscaleProviderKind;

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
 * A user-selected upscaler model is an explicit provider choice, not a preference.
 * Legacy local engine modes (cpu/local/fidelity) normalize to auto: the local
 * Real-ESRGAN engine has been removed and requests route through cloud AI.
 */
export function resolveUpscaleProductMode(
  requestedMode: string | undefined,
  hasExplicitUpscaleSelection: boolean,
): UpscaleProductMode {
  if (hasExplicitUpscaleSelection) return 'ai-only';
  if (requestedMode === 'ai' || requestedMode === 'ai-only') return 'ai-only';
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

  const availableProviders = input.providers.filter(provider => provider.available !== false);
  const provider = availableProviders.find(item => item.kind === 'dedicated-ai');

  if (!provider) {
    // 本地保真引擎已移除：无论 auto 还是 ai-only，无可用 AI 模型时直接报错，不静默降级。
    throw new Error('AI 超分模型不可用，请检查 API 配置');
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
    // 本地保真引擎已移除，AI 失败后没有降级目标。
    fallbackAllowed: false,
    fallbackReason: null,
    targetScale,
  };
}
