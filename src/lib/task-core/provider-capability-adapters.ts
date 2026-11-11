import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import type { CapabilityLayer, SupportedOperation } from './model-capability-contract';
import { PEAR_IMAGE_MAX_OUTPUTS, getPearImageModelSpec } from '@/lib/pear-image-models';
import { PEAR_VIDEO_GENERATE_OPERATIONS, getPearVideoModelSpec } from '@/lib/pear-video-models';

export type ProviderCapabilityFamily = 'pear' | 'apib' | '4s' | 'ai-link' | '302';

const APIMART_GPT_IMAGE_2_RATIOS = [
  '1:1', '3:2', '2:3', '4:3', '3:4',
  '5:4', '4:5', '16:9', '9:16', '2:1',
  '1:2', '3:1', '1:3', '21:9', '9:21',
] as const;

const APIMART_GEMINI_IMAGE_RATIOS = [
  'auto', '1:1', '2:3', '3:2', '3:4', '4:3',
  '4:5', '5:4', '9:16', '16:9', '21:9',
] as const;

const APIMART_GROK_IMAGE_RATIOS = [
  'auto', '1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2',
  '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1',
] as const;

const APIMART_SEEDREAM_5_RATIOS = [
  '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9',
] as const;

const IMAGE_OPERATIONS = ['text-to-image', 'image-to-image'] as const;

/** APIMart image models documented at docs.apib.ai/cn/api-reference/images/* (reviewed 2026-11-09). */
function apimartImage(layer: CapabilityLayer): CapabilityLayer {
  return {
    qualityOptions: [],
    supportsReferenceImages: true,
    supportedOperations: [...IMAGE_OPERATIONS],
    ...layer,
  };
}

const EXACT_MODEL_CAPABILITIES: Readonly<Record<string, CapabilityLayer>> = {
  // https://docs.apib.ai/cn/api-reference/images/gpt-image-2/generation
  'apib::gpt-image-2': {
    protocol: 'apimart',
    executionMode: 'async',
    allowedRatios: [...APIMART_GPT_IMAGE_2_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    qualityOptions: [],
    supportsReferenceImages: true,
    maxReferenceImages: 16,
    supportedOperations: ['text-to-image', 'image-to-image'],
  },
  // images/gpt-image-2/official: quality auto/low/medium/high, n 1-4
  'apib::gpt-image-2-official': apimartImage({
    allowedRatios: [...APIMART_GPT_IMAGE_2_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    qualityOptions: ['auto', 'low', 'medium', 'high'],
    maxOutputs: 4,
    maxReferenceImages: 16,
  }),
  // images/gpt-image-2.5/generation: size also accepts auto; xhigh/max only on 2.5+
  'apib::gpt-image-2.5-flare': apimartImage({
    allowedRatios: ['auto', ...APIMART_GPT_IMAGE_2_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    qualityOptions: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    maxOutputs: 4,
    maxReferenceImages: 16,
  }),
  'apib::gpt-image-2.5-sunburst': apimartImage({
    allowedRatios: ['auto', ...APIMART_GPT_IMAGE_2_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    qualityOptions: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    maxOutputs: 4,
    maxReferenceImages: 16,
  }),
  // images/gemini-3-pro/generation: n fixed at 1, up to 14 reference images
  'apib::gemini-3-pro-image-preview': apimartImage({
    allowedRatios: [...APIMART_GEMINI_IMAGE_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    maxOutputs: 1,
    maxReferenceImages: 14,
  }),
  // images/gemini-3.1-flash/generation: adds 1:4/4:1/1:8/8:1
  'apib::gemini-3.1-flash-image-preview': apimartImage({
    allowedRatios: [...APIMART_GEMINI_IMAGE_RATIOS, '1:4', '4:1', '1:8', '8:1'],
    allowedSizes: ['1K', '2K', '4K'],
    maxOutputs: 1,
    maxReferenceImages: 14,
  }),
  // images/gemini-3.1-flash/generation-lite: 1K only (no tier control), n 1-4
  'apib::gemini-3.1-flash-lite-image': apimartImage({
    allowedRatios: [...APIMART_GEMINI_IMAGE_RATIOS],
    allowedSizes: [],
    maxOutputs: 4,
    maxReferenceImages: 14,
  }),
  // images/gemini-2.5-flash/generation: 1K only, n fixed at 1
  'apib::gemini-2.5-flash-image-preview': apimartImage({
    allowedRatios: [...APIMART_GEMINI_IMAGE_RATIOS],
    allowedSizes: [],
    maxOutputs: 1,
    maxReferenceImages: 14,
  }),
  // images/seedream-5-0-pro/generation: 1K/1.5K/2K (1.5K is not a UI tier), n fixed at 1
  'apib::seedream-5-0-pro': apimartImage({
    allowedRatios: ['auto', ...APIMART_SEEDREAM_5_RATIOS],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 1,
    maxReferenceImages: 10,
  }),
  // images/seedream-5-lite/generation: 2K/3K/4K, no 1K; reference images + n <= 15
  'apib::seedream-5-0-lite': apimartImage({
    allowedRatios: [...APIMART_SEEDREAM_5_RATIOS],
    allowedSizes: ['2K', '3K', '4K'],
    maxOutputs: 15,
    maxReferenceImages: 14,
  }),
  // images/qwen-image-3.0/generation: 1K/2K, n 1-6, 1-3 reference images
  'apib::qwen-image-3.0-pro': apimartImage({
    allowedRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 6,
    maxReferenceImages: 3,
  }),
  'apib::qwen-image-3.0': apimartImage({
    allowedRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 6,
    maxReferenceImages: 3,
  }),
  // images/grok-imagine-2.0-ext/generation: text-to-image only, no tier, n 1-12
  'apib::grok-imagine-2.0-ext': apimartImage({
    allowedRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'],
    allowedSizes: [],
    maxOutputs: 12,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    supportedOperations: ['text-to-image'],
  }),
  // images/grok-imagine-2.0-ext/official: aspect_ratio field, 1k/2k, n 1-10, 1-3 reference images
  'apib::grok-imagine-image-2.0': apimartImage({
    allowedRatios: [...APIMART_GROK_IMAGE_RATIOS],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 10,
    maxReferenceImages: 3,
  }),
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

/**
 * PearAPI image/video models documented at pearapi.apifox.cn (reviewed 2026-11-09).
 * Ids the docs do not list (e.g. local -4k aliases) keep the name-based fallback.
 */
function pearCapabilities(modelId: string): CapabilityLayer | undefined {
  const image = getPearImageModelSpec(modelId);
  if (image) {
    const operations: SupportedOperation[] = image.editOnly
      ? ['image-to-image']
      : image.maxImages > 0 ? [...IMAGE_OPERATIONS] : ['text-to-image'];
    return {
      // grok-imagine-image-2.0 has no size field; the single entry only lets requests through.
      allowedRatios: image.ratios.length > 0 ? [...image.ratios] : ['1:1'],
      // 0.5K is not a tier the tools can send yet.
      allowedSizes: image.resolutions.filter(value => value !== '0.5K'),
      qualityOptions: [...image.qualities],
      maxOutputs: PEAR_IMAGE_MAX_OUTPUTS,
      supportsReferenceImages: image.maxImages > 0,
      maxReferenceImages: image.maxImages,
      supportedOperations: operations,
    };
  }
  const video = getPearVideoModelSpec(modelId);
  if (!video) return undefined;
  const operations = video.modes.flatMap(mode => {
    const operation = PEAR_VIDEO_GENERATE_OPERATIONS[mode];
    return operation ? [operation] : [];
  });
  const maxReferenceImages = operations.includes('multi-reference') ? video.maxImages : Math.min(1, video.maxImages);
  return {
    allowedRatios: [...video.ratios],
    // The tools use lower-case p; the submit builder sends the documented upper-case value.
    allowedSizes: video.resolutions.map(value => value.replace(/P$/, 'p')),
    qualityOptions: [],
    allowedDurationsSeconds: [...video.durations],
    maxDurationSeconds: Math.max(...video.durations),
    supportsReferenceImages: maxReferenceImages > 0,
    maxReferenceImages,
    supportedOperations: operations,
  };
}

const PRESET_FAMILIES: Readonly<Record<string, ProviderCapabilityFamily>> = {
  pear: 'pear',
  pearapi: 'pear',
  'pearapi-video': 'pear',
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
  if (layer) return cloneLayer(layer);
  return family === 'pear' ? pearCapabilities(model.id) : undefined;
}
