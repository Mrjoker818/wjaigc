import type { ApiKind, ModelInfo } from './universal-api-types';

export type ThreeOhTwoUpscaleModelId = '302-super-upscale-v2' | '302-upscale-v6' | '302-image-upscale' | '302-esrgan';

interface ThreeOhTwoUpscaleModelDefinition {
  id: ThreeOhTwoUpscaleModelId;
  name: string;
  displayName: string;
  category: '302';
  endpoint: '/302/submit/super-upscale-v2' | '/302/submit/upscale-v6' | '/302/submit/image-upscale' | '/302/submit/esrgan';
  description: string;
}

export const THREE_O_TWO_UPSCALE_MODELS: readonly ThreeOhTwoUpscaleModelDefinition[] = [
  {
    id: '302-super-upscale-v2',
    name: '302 Super-Upscale V2',
    displayName: '302 | Super-Upscale V2 (AI超分)',
    category: '302',
    endpoint: '/302/submit/super-upscale-v2',
    description: 'AI驱动超级放大，支持创意增强和细节修复',
  },
  {
    id: '302-upscale-v6',
    name: '302 Upscale V6',
    displayName: '302 | Upscale V6 (标准放大)',
    category: '302',
    endpoint: '/302/submit/upscale-v6',
    description: '标准放大，无AI想象，价格更便宜',
  },
  {
    id: '302-image-upscale',
    name: '302 Image Upscale',
    displayName: '302 | Image Upscale (基础放大)',
    category: '302',
    endpoint: '/302/submit/image-upscale',
    description: '基础图像放大，速度快，适合日常使用',
  },
  {
    id: '302-esrgan',
    name: '302 ESRGAN',
    displayName: '302 | ESRGAN (高清增强)',
    category: '302',
    endpoint: '/302/submit/esrgan',
    description: 'ESRGAN高清放大，增强细节和纹理',
  },
] as const;

/**
 * Older provider rows used one catch-all `302` selection. Preserve that
 * legacy configuration without silently exposing unverified variants.
 */
const DEFAULT_302_UPSCALE_MODEL_IDS: readonly ThreeOhTwoUpscaleModelId[] = [
  '302-super-upscale-v2',
  '302-upscale-v6',
] as const;

const UPSCALE_MODEL_ALIASES: Record<string, ThreeOhTwoUpscaleModelId> = {
  '302-super-upscale-v2': '302-super-upscale-v2',
  'super-upscale-v2': '302-super-upscale-v2',
  '302-upscale-v6': '302-upscale-v6',
  'upscale-v6': '302-upscale-v6',
  '302-image-upscale': '302-image-upscale',
  'image-upscale': '302-image-upscale',
  '302-esrgan': '302-esrgan',
  'esrgan': '302-esrgan',
};

export function resolve302UpscaleModelId(modelId: string): ThreeOhTwoUpscaleModelId | null {
  return UPSCALE_MODEL_ALIASES[modelId.trim().toLowerCase()] || null;
}

export function is302AiUpscaleBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === '302.ai'
      || host.endsWith('.302.ai')
      || host === '302ai.cn'
      || host.endsWith('.302ai.cn');
  } catch {
    return false;
  }
}

export function resolve302UpscaleModelSelection(
  baseUrl: string,
  selectedModels: readonly string[],
): string[] | null {
  if (!is302AiUpscaleBaseUrl(baseUrl)) return null;

  if (selectedModels.length === 0) return [...DEFAULT_302_UPSCALE_MODEL_IDS];

  const normalizedSelections: string[] = [];
  for (const selectedModel of selectedModels) {
    const trimmed = selectedModel.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === '302') {
      normalizedSelections.push(...DEFAULT_302_UPSCALE_MODEL_IDS);
      continue;
    }
    normalizedSelections.push(resolve302UpscaleModelId(trimmed) || trimmed);
  }
  return [...new Set(normalizedSelections)];
}

export function get302UpscaleModelsForProvider(baseUrl: string, modelType: ApiKind): ModelInfo[] {
  if (modelType !== 'upscaler' || !is302AiUpscaleBaseUrl(baseUrl)) return [];

  return THREE_O_TWO_UPSCALE_MODELS.map(model => ({
    id: model.id,
    name: model.name,
    displayName: model.displayName,
    providerId: 'probe',
    type: 'upscaler',
    description: model.description || `302.AI ${model.endpoint}`,
  }));
}
