import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import type { CapabilityLayer } from './model-capability-contract';

export type ProviderCapabilityFamily = 'pear' | 'apib' | '4s' | 'ai-link' | '302';

const APIMART_GPT_IMAGE_2_RATIOS = [
  '1:1', '3:2', '2:3', '4:3', '3:4',
  '5:4', '4:5', '16:9', '9:16', '2:1',
  '1:2', '3:1', '1:3', '21:9', '9:21',
] as const;

const EXACT_MODEL_CAPABILITIES: Readonly<Record<string, CapabilityLayer>> = {
  // https://docs.apib.ai/cn/api-reference/images/gpt-image-2/generation
  'apib::gpt-image-2': {
    protocol: 'apimart',
    executionMode: 'async',
    allowedRatios: [...APIMART_GPT_IMAGE_2_RATIOS],
    qualityOptions: ['1K', '2K', '4K'],
    supportsReferenceImages: true,
    maxReferenceImages: 16,
    supportedOperations: ['text-to-image', 'image-to-image'],
  },
  // https://4sapi.apifox.cn/447631659e0
  '4s::gpt-image-2': {
    protocol: '4sapi',
    executionMode: 'sync',
    maxOutputs: 1,
    supportsReferenceImages: true,
    maxReferenceImages: 1,
    supportsMask: true,
    supportedOperations: ['text-to-image', 'image-to-image'],
  },
  // https://pearapi.apifox.cn/api-493268181
  'pear::Image-Layered': {
    protocol: 'pearapi-layer',
    executionMode: 'async',
    supportsReferenceImages: true,
    maxReferenceImages: 1,
    outputKinds: ['zip', 'psd'],
  },
  // https://docs.ai-link.shop - POST /v1/videos
  'ai-link::kling-v3': {
    protocol: 'ai-link',
    executionMode: 'async',
    outputKinds: ['mp4'],
  },
  // https://doc.302.ai/373009524e0
  '302::302-upscale-v6': {
    protocol: '302-upscale-v6',
    executionMode: 'sync',
    supportsReferenceImages: true,
    maxReferenceImages: 1,
    outputKinds: ['jpeg'],
  },
  // https://doc.302.ai/205808838e0
  '302::302-super-upscale-v2': {
    protocol: '302-super-upscale-v2',
    executionMode: 'sync',
    supportsReferenceImages: true,
    maxReferenceImages: 1,
    outputKinds: ['png'],
  },
};

const PRESET_FAMILIES: Readonly<Record<string, ProviderCapabilityFamily>> = {
  pear: 'pear',
  pearapi: 'pear',
  apib: 'apib',
  apimart: 'apib',
  '4s': '4s',
  '4sapi': '4s',
  'ai-link': 'ai-link',
  ailink: 'ai-link',
  '302': '302',
  '302ai': '302',
};

function familyFromHost(host: string): ProviderCapabilityFamily | null {
  if (host === 'pearapi.ai' || host.endsWith('.pearapi.ai')) return 'pear';
  if (
    host === 'apimart.ai'
    || host.endsWith('.apimart.ai')
    || host === 'apib.ai'
    || host.endsWith('.apib.ai')
  ) return 'apib';
  if (host === '4sapi.com' || host.endsWith('.4sapi.com')) return '4s';
  if (host === 'ai-link.shop' || host.endsWith('.ai-link.shop')) return 'ai-link';
  if (
    host === '302.ai'
    || host.endsWith('.302.ai')
    || host === '302ai.cn'
    || host.endsWith('.302ai.cn')
  ) return '302';
  return null;
}

function explicitFamily(provider: ApiProvider): ProviderCapabilityFamily | null {
  const candidates = [
    provider.providerPreset,
    provider.advancedParams?.compatProfile,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const family = PRESET_FAMILIES[candidate.trim().toLowerCase()];
    if (family) return family;
  }
  return null;
}

export function classifyProviderCapabilityFamily(
  provider: ApiProvider,
): ProviderCapabilityFamily | null {
  const configured = explicitFamily(provider);
  if (configured) return configured;
  try {
    return familyFromHost(new URL(provider.baseUrl).hostname.toLowerCase());
  } catch {
    return null;
  }
}

function cloneLayer(layer: CapabilityLayer): CapabilityLayer {
  return Object.fromEntries(Object.entries(layer).map(([key, value]) => [
    key,
    Array.isArray(value) ? [...value] : value,
  ])) as CapabilityLayer;
}

export function resolveProviderCapabilityAdapter(
  provider: ApiProvider,
  model: ModelInfo,
): CapabilityLayer | undefined {
  const family = classifyProviderCapabilityFamily(provider);
  if (!family) return undefined;
  const layer = EXACT_MODEL_CAPABILITIES[`${family}::${model.id}`];
  return layer ? cloneLayer(layer) : undefined;
}
