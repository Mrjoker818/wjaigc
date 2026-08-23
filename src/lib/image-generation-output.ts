import { getModelCapabilities } from '@/lib/model-capabilities';

export type ImageBackgroundMode = 'auto' | 'transparent' | 'opaque';
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

export interface ImageOutputPreference {
  background: ImageBackgroundMode;
  outputFormat: ImageOutputFormat;
}

export interface ResolvedImageOutputPreference extends ImageOutputPreference {
  supportsBackground: boolean;
}

export class UnsupportedTransparentBackgroundError extends Error {
  readonly code = 'TRANSPARENT_BACKGROUND_UNSUPPORTED';

  constructor(modelId: string) {
    super(`模型 ${modelId} 不支持原生透明背景生成`);
    this.name = 'UnsupportedTransparentBackgroundError';
  }
}

export function resolveImageOutputPreference(
  modelId: string,
  requested: ImageOutputPreference,
): ResolvedImageOutputPreference {
  const capabilities = getModelCapabilities(modelId);
  return {
    background: requested.background,
    outputFormat: requested.background === 'transparent' ? 'png' : requested.outputFormat,
    supportsBackground: capabilities.supportsBackground,
  };
}

export function withImageOutputPreference<T extends Record<string, unknown>>(
  body: T,
  modelId: string,
  requested: ImageOutputPreference,
): T & { background?: ImageBackgroundMode; output_format?: ImageOutputFormat } {
  const resolved = resolveImageOutputPreference(modelId, requested);
  if (resolved.background === 'transparent' && !resolved.supportsBackground) {
    throw new UnsupportedTransparentBackgroundError(modelId);
  }

  if (resolved.background === 'auto' || !resolved.supportsBackground) {
    return { ...body };
  }

  return {
    ...body,
    background: resolved.background,
    output_format: resolved.outputFormat,
  };
}

export function detectTransparentBackgroundIntent(text: string): 'transparent' | undefined {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return undefined;

  const transparentPatterns = [
    /透明背景/,
    /透明底/,
    /无背景/,
    /去背景/,
    /移除背景/,
    /抠图/,
    /transparent\s+(?:png|background)/,
    /(?:remove|without|no)\s+(?:the\s+)?background/,
  ];

  return transparentPatterns.some((pattern) => pattern.test(normalized))
    ? 'transparent'
    : undefined;
}
