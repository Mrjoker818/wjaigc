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

export function normalizeImageOutputRequestBody<T extends Record<string, unknown>>(
  body: T,
  modelId: string,
): Omit<T, 'background' | 'backgroundMode' | 'output_format' | 'outputFormat'> & {
  background?: ImageBackgroundMode;
  output_format?: ImageOutputFormat;
} {
  const hasExplicitBackground = body.background !== undefined || body.backgroundMode !== undefined;
  const inferredBackground = !hasExplicitBackground && typeof body.prompt === 'string'
    ? detectTransparentBackgroundIntent(body.prompt)
    : undefined;
  const rawBackground = body.background ?? body.backgroundMode ?? inferredBackground;
  const background: ImageBackgroundMode = ['transparent', 'opaque'].includes(String(rawBackground))
    ? rawBackground as ImageBackgroundMode
    : 'auto';
  const rawOutputFormat = body.output_format ?? body.outputFormat;
  const outputFormat: ImageOutputFormat = ['png', 'jpeg', 'webp'].includes(String(rawOutputFormat))
    ? rawOutputFormat as ImageOutputFormat
    : 'png';
  const base = { ...body } as Record<string, unknown>;
  delete base.background;
  delete base.backgroundMode;
  delete base.output_format;
  delete base.outputFormat;

  return withImageOutputPreference(base, modelId, { background, outputFormat }) as
    Omit<T, 'background' | 'backgroundMode' | 'output_format' | 'outputFormat'> & {
      background?: ImageBackgroundMode;
      output_format?: ImageOutputFormat;
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

export function getTransparentOutputWarning(payload: Record<string, unknown>): string | undefined {
  const nestedResult = payload.result && typeof payload.result === 'object'
    ? payload.result as Record<string, unknown>
    : undefined;
  const verification = (payload.alphaVerification || nestedResult?.alphaVerification) as
    | Record<string, unknown>
    | undefined;
  if (!verification || !['opaque', 'invalid'].includes(String(verification.status))) {
    return undefined;
  }
  return '模型未返回真实透明背景，原始图片已保留。需要时请选中图片并使用“移除背景”；该操作会单独创建任务并计费。';
}
