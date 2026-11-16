import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import type { CapabilityLayer, SupportedOperation } from './model-capability-contract';
import { PEAR_IMAGE_MAX_OUTPUTS, getPearImageModelSpec } from '@/lib/pear-image-models';
import { PEAR_VIDEO_GENERATE_OPERATIONS, getPearVideoModelSpec } from '@/lib/pear-video-models';
import { getApiMartVideoModelSpec } from '@/lib/apimart-video-models';

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

// gpt-image-2.5-ext / 2.6-ext: "auto 或以下 10 种比例"
const APIMART_GPT_IMAGE_EXT_RATIOS = [
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9',
] as const;

const APIMART_GEMINI_EXTREME_RATIOS = [...APIMART_GEMINI_IMAGE_RATIOS, '1:4', '4:1', '1:8', '8:1'] as const;

// seedream-4 / 4.5: auto needs image_urls, so it is left out as for 5-0-lite.
const APIMART_SEEDREAM_4_RATIOS = [
  '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9', '9:21',
] as const;

const APIMART_BASIC_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] as const;

const APIMART_FLUX_RATIOS = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'] as const;

const APIMART_FLUX_3_RATIOS = [
  'auto', '21:9', '2:1', '16:9', '3:2', '7:5', '4:3', '5:4', '1:1',
  '4:5', '3:4', '5:7', '2:3', '9:16', '1:2', '9:21',
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

// https://docs.apib.ai/cn/api-reference/images/gpt-image-2/generation:
// size also accepts auto, n "取值：1", "最多 15 张参考图", no mask_url. Alias gpt-image-2-ext.
const APIMART_GPT_IMAGE_2_LAYER: CapabilityLayer = {
  protocol: 'apimart',
  executionMode: 'async',
  allowedRatios: ['auto', ...APIMART_GPT_IMAGE_2_RATIOS],
  allowedSizes: ['1K', '2K', '4K'],
  qualityOptions: [],
  maxOutputs: 1,
  supportsReferenceImages: true,
  maxReferenceImages: 15,
  supportsMask: false,
  supportedOperations: ['text-to-image', 'image-to-image'],
};

// images/gemini-*/generation: the nano-banana names are documented aliases of the same models.
const APIMART_GEMINI_3_PRO_LAYER = apimartImage({
  allowedRatios: [...APIMART_GEMINI_IMAGE_RATIOS],
  allowedSizes: ['1K', '2K', '4K'],
  maxOutputs: 1,
  maxReferenceImages: 14,
});
const APIMART_GEMINI_3_1_FLASH_LAYER = apimartImage({
  allowedRatios: [...APIMART_GEMINI_EXTREME_RATIOS],
  allowedSizes: ['1K', '2K', '4K'],
  maxOutputs: 1,
  maxReferenceImages: 14,
});
// generation-lite: 1K only (no tier control), n 1-4
const APIMART_GEMINI_3_1_FLASH_LITE_LAYER = apimartImage({
  allowedRatios: [...APIMART_GEMINI_IMAGE_RATIOS],
  allowedSizes: [],
  maxOutputs: 4,
  maxReferenceImages: 14,
});
// gemini-2.5-flash: 1K only, n fixed at 1
const APIMART_GEMINI_2_5_FLASH_LAYER = apimartImage({
  allowedRatios: [...APIMART_GEMINI_IMAGE_RATIOS],
  allowedSizes: [],
  maxOutputs: 1,
  maxReferenceImages: 14,
});

const EXACT_MODEL_CAPABILITIES: Readonly<Record<string, CapabilityLayer>> = {
  'apib::gpt-image-2': APIMART_GPT_IMAGE_2_LAYER,
  'apib::gpt-image-2-ext': APIMART_GPT_IMAGE_2_LAYER,
  // images/gpt-image-2/official: size also accepts auto, quality auto/low/medium/high, n 1-4, mask_url
  'apib::gpt-image-2-official': apimartImage({
    allowedRatios: ['auto', ...APIMART_GPT_IMAGE_2_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    qualityOptions: ['auto', 'low', 'medium', 'high'],
    maxOutputs: 4,
    maxReferenceImages: 16,
    supportsMask: true,
  }),
  // images/gpt-image-2.5/generation: size also accepts auto; xhigh/max only on 2.5+; mask_url
  'apib::gpt-image-2.5-flare': apimartImage({
    allowedRatios: ['auto', ...APIMART_GPT_IMAGE_2_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    qualityOptions: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    maxOutputs: 4,
    maxReferenceImages: 16,
    supportsMask: true,
  }),
  'apib::gpt-image-2.5-sunburst': apimartImage({
    allowedRatios: ['auto', ...APIMART_GPT_IMAGE_2_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    qualityOptions: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    maxOutputs: 4,
    maxReferenceImages: 16,
    supportsMask: true,
  }),
  // images/gpt-image-2.5-ext/generation: auto + 10 ratios, 1K/2K/4K, n 1-4, no quality, no mask
  'apib::gpt-image-2.5-ext': apimartImage({
    allowedRatios: [...APIMART_GPT_IMAGE_EXT_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    maxOutputs: 4,
    maxReferenceImages: 16,
  }),
  // images/gpt-image-2.6/generation: as 2.5, plus mask_url
  'apib::gpt-image-2.6-flare': apimartImage({
    allowedRatios: ['auto', ...APIMART_GPT_IMAGE_2_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    qualityOptions: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    maxOutputs: 4,
    maxReferenceImages: 16,
    supportsMask: true,
  }),
  'apib::gpt-image-2.6-sunburst': apimartImage({
    allowedRatios: ['auto', ...APIMART_GPT_IMAGE_2_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    qualityOptions: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    maxOutputs: 4,
    maxReferenceImages: 16,
    supportsMask: true,
  }),
  // images/gpt-image-2.6-ext/generation: "当前请使用整数 1"
  'apib::gpt-image-2.6-ext': apimartImage({
    allowedRatios: [...APIMART_GPT_IMAGE_EXT_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    qualityOptions: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    maxOutputs: 1,
    maxReferenceImages: 16,
  }),
  // images/gpt-image-1/generation: 3 ratios, no resolution, n 1-4, 15 references, mask_url
  'apib::gpt-image-1-official': apimartImage({
    allowedRatios: ['1:1', '3:2', '2:3'],
    allowedSizes: [],
    qualityOptions: ['auto', 'low', 'medium', 'high'],
    maxOutputs: 4,
    maxReferenceImages: 15,
    supportsMask: true,
  }),
  'apib::gpt-image-1.5-official': apimartImage({
    allowedRatios: ['1:1', '3:2', '2:3'],
    allowedSizes: [],
    qualityOptions: ['auto', 'low', 'medium', 'high'],
    maxOutputs: 4,
    maxReferenceImages: 15,
    supportsMask: true,
  }),
  // images/gemini-3-pro/generation: n fixed at 1, up to 14 reference images
  'apib::gemini-3-pro-image-preview': APIMART_GEMINI_3_PRO_LAYER,
  'apib::gemini-3-pro-image-preview-official': APIMART_GEMINI_3_PRO_LAYER,
  'apib::nano-banana-pro-ext': APIMART_GEMINI_3_PRO_LAYER,
  'apib::nano-banana-pro': APIMART_GEMINI_3_PRO_LAYER,
  // images/gemini-3.1-flash/generation: adds 1:4/4:1/1:8/8:1
  'apib::gemini-3.1-flash-image-preview': APIMART_GEMINI_3_1_FLASH_LAYER,
  'apib::gemini-3.1-flash-image-preview-official': APIMART_GEMINI_3_1_FLASH_LAYER,
  'apib::nano-banana-2-ext': APIMART_GEMINI_3_1_FLASH_LAYER,
  'apib::nano-banana-2': APIMART_GEMINI_3_1_FLASH_LAYER,
  'apib::gemini-3.1-flash-lite-image': APIMART_GEMINI_3_1_FLASH_LITE_LAYER,
  'apib::gemini-3.1-flash-lite-image-ext': APIMART_GEMINI_3_1_FLASH_LITE_LAYER,
  'apib::nano-banana-2-lite': APIMART_GEMINI_3_1_FLASH_LITE_LAYER,
  'apib::nano-banana-2-lite-ext': APIMART_GEMINI_3_1_FLASH_LITE_LAYER,
  'apib::gemini-2.5-flash-image-preview': APIMART_GEMINI_2_5_FLASH_LAYER,
  'apib::gemini-2.5-flash-image-preview-official': APIMART_GEMINI_2_5_FLASH_LAYER,
  'apib::nano-banana-ext': APIMART_GEMINI_2_5_FLASH_LAYER,
  'apib::nano-banana': APIMART_GEMINI_2_5_FLASH_LAYER,
  // images/gemini-nano-banana-2.1/generation: 1K/2K/4K ("不支持 0.5K"), n 1-4; -ext "仅 1 张".
  // No documented reference cap; the Gemini value is used.
  'apib::gemini-nano-banana-2.1': apimartImage({
    allowedRatios: [...APIMART_GEMINI_EXTREME_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    maxOutputs: 4,
    maxReferenceImages: 14,
  }),
  'apib::gemini-nano-banana-2.1-ext': apimartImage({
    allowedRatios: [...APIMART_GEMINI_EXTREME_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
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
  // images/grok-imagine/generation: grok-imagine-image 0-5 refs, -quality 0-3 refs, 1k/2k, n 1-10, no quality
  'apib::grok-imagine-image': apimartImage({
    allowedRatios: [...APIMART_GROK_IMAGE_RATIOS],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 10,
    maxReferenceImages: 5,
  }),
  'apib::grok-imagine-image-quality': apimartImage({
    allowedRatios: [...APIMART_GROK_IMAGE_RATIOS],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 10,
    maxReferenceImages: 3,
  }),
  // Same page: grok-imagine-1.5-apimart (alias grok-imagine-1.5-ext), 5 ratios, no resolution, 1-5 refs
  'apib::grok-imagine-1.5-apimart': apimartImage({
    allowedRatios: ['1:1', '16:9', '9:16', '3:2', '2:3'],
    allowedSizes: [],
    maxOutputs: 10,
    maxReferenceImages: 5,
  }),
  'apib::grok-imagine-1.5-ext': apimartImage({
    allowedRatios: ['1:1', '16:9', '9:16', '3:2', '2:3'],
    allowedSizes: [],
    maxOutputs: 10,
    maxReferenceImages: 5,
  }),
  // images/seedream-4/generation: 1K/2K/4K, n 1-15
  'apib::seedream-4.0': apimartImage({
    allowedRatios: [...APIMART_SEEDREAM_4_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    maxOutputs: 15,
    maxReferenceImages: 14,
  }),
  // images/seedream-4.5/generation: "Seedream-4.5 不支持 1K 分辨率"
  'apib::seedream-4.5': apimartImage({
    allowedRatios: [...APIMART_SEEDREAM_4_RATIOS],
    allowedSizes: ['2K', '4K'],
    maxOutputs: 15,
    maxReferenceImages: 14,
  }),
  // images/seedream-5-0-flash and seedream-5-5: 1K/1.5K/2K (1.5K is not a UI tier), "不支持 3K / 4K", n 1
  'apib::seedream-5-0-flash': apimartImage({
    allowedRatios: ['auto', ...APIMART_SEEDREAM_5_RATIOS],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 1,
    maxReferenceImages: 10,
  }),
  'apib::seedream-5-5': apimartImage({
    allowedRatios: ['auto', ...APIMART_SEEDREAM_5_RATIOS],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 1,
    maxReferenceImages: 10,
  }),
  // images/qwen-image/generation: 1K/2K, n up to 6; no documented reference cap, the 3.0 value is used
  'apib::qwen-image-2.0': apimartImage({
    allowedRatios: [...APIMART_BASIC_RATIOS],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 6,
    maxReferenceImages: 3,
  }),
  'apib::qwen-image-2.0-pro': apimartImage({
    allowedRatios: [...APIMART_BASIC_RATIOS],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 6,
    maxReferenceImages: 3,
  }),
  // images/wan2.7-image/generation: up to 9 refs; 4K only for wan2.7-image-pro text-to-image
  'apib::wan2.7-image-pro': apimartImage({
    allowedRatios: [...APIMART_BASIC_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    maxOutputs: 4,
    maxReferenceImages: 9,
  }),
  'apib::wan2.7-image': apimartImage({
    allowedRatios: [...APIMART_BASIC_RATIOS],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 4,
    maxReferenceImages: 9,
  }),
  // images/z-image-turbo/generation: 1K/2K, "固定 1 张", no image_urls documented
  'apib::z-image-turbo': apimartImage({
    allowedRatios: [...APIMART_BASIC_RATIOS],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 1,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    supportedOperations: ['text-to-image'],
  }),
  // images/flux-2/generation: n "只能为 1", "最多支持 8 张图片"; 1K/2K/4K are documented aliases of 2/3/4MP
  'apib::flux-2-flex': apimartImage({ allowedRatios: [...APIMART_FLUX_RATIOS], allowedSizes: ['1K', '2K', '4K'], maxOutputs: 1, maxReferenceImages: 8 }),
  'apib::flux-2-pro': apimartImage({ allowedRatios: [...APIMART_FLUX_RATIOS], allowedSizes: ['1K', '2K', '4K'], maxOutputs: 1, maxReferenceImages: 8 }),
  'apib::flux-2-max': apimartImage({ allowedRatios: [...APIMART_FLUX_RATIOS], allowedSizes: ['1K', '2K', '4K'], maxOutputs: 1, maxReferenceImages: 8 }),
  // images/flux-3-image(-klein)/generation: n 1, "最多支持 10 张", lower-case 1k/2k/4k
  'apib::flux-3-image': apimartImage({ allowedRatios: [...APIMART_FLUX_3_RATIOS], allowedSizes: ['1K', '2K', '4K'], maxOutputs: 1, maxReferenceImages: 10 }),
  'apib::flux-3-image-klein': apimartImage({ allowedRatios: [...APIMART_FLUX_3_RATIOS], allowedSizes: ['1K', '2K', '4K'], maxOutputs: 1, maxReferenceImages: 10 }),
  // images/flux-kontext/generation: "resolution 对 Kontext 不生效", 4 refs, n 1
  'apib::flux-kontext-pro': apimartImage({ allowedRatios: [...APIMART_FLUX_RATIOS], allowedSizes: [], maxOutputs: 1, maxReferenceImages: 4 }),
  'apib::flux-kontext-max': apimartImage({ allowedRatios: [...APIMART_FLUX_RATIOS], allowedSizes: [], maxOutputs: 1, maxReferenceImages: 4 }),
  // images/hy-image-v3.5-preview/generation: "最多 5 张参考图、1K / 2K / 4K", n 1
  'apib::hy-image-v3.5-preview': apimartImage({
    allowedRatios: [...APIMART_GEMINI_IMAGE_RATIOS],
    allowedSizes: ['1K', '2K', '4K'],
    maxOutputs: 1,
    maxReferenceImages: 5,
  }),
  // images/imagen-4.0-apimart/generation: text-to-image only, no resolution, n 1
  'apib::imagen-4.0-apimart': apimartImage({
    allowedRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
    allowedSizes: [],
    maxOutputs: 1,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    supportedOperations: ['text-to-image'],
  }),
  // images/mai-image-2.6/generation: integer ratios 1:4..4:1 plus auto, 1K/2K, 5 refs, n 1
  'apib::mai-image-2.6': apimartImage({
    allowedRatios: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9', '4:1', '1:4'],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 1,
    maxReferenceImages: 5,
  }),
  'apib::mai-image-2.6-flash': apimartImage({
    allowedRatios: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9', '4:1', '1:4'],
    allowedSizes: ['1K', '2K'],
    maxOutputs: 1,
    maxReferenceImages: 5,
  }),
  // images/minimax-h3-image(-highspeed)/generation: ratios within 1:3..3:1, 1K/2K/4K (default 4K), n 1-10, 16 refs
  'apib::minimax-h3-image': apimartImage({
    allowedRatios: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9', '3:1', '1:3'],
    allowedSizes: ['1K', '2K', '4K'],
    maxOutputs: 10,
    maxReferenceImages: 16,
  }),
  'apib::minimax-h3-image-highspeed': apimartImage({
    allowedRatios: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9', '3:1', '1:3'],
    allowedSizes: ['1K', '2K', '4K'],
    maxOutputs: 10,
    maxReferenceImages: 16,
  }),
  // images/muse-image-ext/generation: aspect_ratio only, "不要发送非空 resolution", n 1, 9 refs
  'apib::muse-image-ext': apimartImage({
    allowedRatios: [...APIMART_BASIC_RATIOS],
    allowedSizes: [],
    maxOutputs: 1,
    maxReferenceImages: 9,
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

/** APIMart video models listed in apimart-video-models.ts (docs.apib.ai/cn, reviewed 2026-11-16). */
function apimartVideoCapabilities(modelId: string): CapabilityLayer | undefined {
  const video = getApiMartVideoModelSpec(modelId);
  if (!video) return undefined;
  return {
    allowedRatios: [...video.ratios],
    allowedSizes: [...video.resolutions],
    qualityOptions: [],
    allowedDurationsSeconds: [...video.durations],
    maxDurationSeconds: Math.max(...video.durations),
    supportsReferenceImages: video.maxImages > 0,
    maxReferenceImages: video.maxImages,
    supportedOperations: [...video.operations],
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
  if (family === 'pear') return pearCapabilities(model.id);
  return family === 'apib' ? apimartVideoCapabilities(model.id) : undefined;
}
