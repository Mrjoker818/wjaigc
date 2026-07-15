import type { ApiKind, ModelInfo } from './universal-api-types';

export type ThreeOhTwoUpscaleModelId = '302-super-upscale-v2' | '302-upscale-v6';

interface ThreeOhTwoUpscaleModelDefinition {
  id: ThreeOhTwoUpscaleModelId;
  name: string;
  displayName: string;
  category: '302';
  endpoint: '/302/submit/super-upscale-v2' | '/302/submit/upscale-v6';
}

export const THREE_O_TWO_UPSCALE_MODELS: readonly ThreeOhTwoUpscaleModelDefinition[] = [
  {
    id: '302-super-upscale-v2',
    name: '302 Super-Upscale V2',
    displayName: '302 | Super-Upscale V2',
    category: '302',
    endpoint: '/302/submit/super-upscale-v2',
  },
  {
    id: '302-upscale-v6',
    name: '302 Upscale V6',
    displayName: '302 | Upscale V6',
    category: '302',
    endpoint: '/302/submit/upscale-v6',
  },
] as const;

const UPSCALE_MODEL_ALIASES: Record<string, ThreeOhTwoUpscaleModelId> = {
  '302-super-upscale-v2': '302-super-upscale-v2',
  'super-upscale-v2': '302-super-upscale-v2',
  '302-upscale-v6': '302-upscale-v6',
  'upscale-v6': '302-upscale-v6',
};

export function resolve302UpscaleModelId(modelId: string): ThreeOhTwoUpscaleModelId | null {
  return UPSCALE_MODEL_ALIASES[modelId.trim().toLowerCase()] || null;
}

export function is302AiUpscaleBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === '302.ai' || host.endsWith('.302.ai');
  } catch {
    return false;
  }
}

export function get302UpscaleModelsForProvider(baseUrl: string, modelType: ApiKind): ModelInfo[] {
  if (modelType !== 'upscaler' || !is302AiUpscaleBaseUrl(baseUrl)) return [];

  return THREE_O_TWO_UPSCALE_MODELS.map(model => ({
    id: model.id,
    name: model.name,
    displayName: model.displayName,
    providerId: 'probe',
    type: 'upscaler',
    description: `302.AI ${model.endpoint}`,
  }));
}
