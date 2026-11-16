/**
 * PearAPI image models as documented at https://pearapi.apifox.cn (图像生成, reviewed 2026-11-09).
 * POST /v1/images/generations and /v1/images/edits take size (ratio), resolution, images[] and n (1-4);
 * each model only accepts the fields and values listed here.
 */
export interface PearImageModelSpec {
  /** Empty when the model has no size/aspect_ratio field. */
  ratios: string[];
  /** Empty when the model has no resolution field. */
  resolutions: string[];
  /** Empty when the model has no quality field. */
  qualities: string[];
  /** 0 for text-only models. */
  maxImages: number;
  /** Only /v1/images/edits is documented (images required). */
  editOnly?: boolean;
  /** output_format values the model page lists. */
  outputFormats?: string[];
  /** GIF frame fields (frame_count / frame_duration_ms / fps / loop) are documented. */
  gif?: boolean;
}

/** gpt-image-2.6 图像生成（api-533519601）：GIF 帧参数的取值范围，超出范围时不发送。 */
export const PEAR_GIF_FIELD_RANGES: Readonly<Record<'frame_count' | 'frame_duration_ms' | 'fps', [number, number]>> = {
  frame_count: [1, 600],
  frame_duration_ms: [20, 10000],
  fps: [1, 60],
};

export const PEAR_IMAGE_MAX_OUTPUTS = 4;

const GPT_RATIOS = ['9:16', '16:9', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '2:1', '1:2', '21:9', '9:21'];
const NANO_RATIOS = ['9:16', '16:9', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '21:9', '1:4', '4:1', '1:8', '8:1'];
const SEEDREAM_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
const BASIC_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];
const GPT_QUALITIES = ['auto', 'low', 'medium', 'high'];

const GPT_IMAGE: PearImageModelSpec = {
  ratios: GPT_RATIOS, resolutions: ['1K', '2K', '4K'], qualities: GPT_QUALITIES, maxImages: 16,
  outputFormats: ['png', 'jpeg', 'webp'],
};
// 2.5/2.6: xhigh and max are documented as 需模型支持.
const GPT_IMAGE_HIGH: PearImageModelSpec = { ...GPT_IMAGE, qualities: [...GPT_QUALITIES, 'xhigh', 'max'] };
const NANO: PearImageModelSpec = { ratios: NANO_RATIOS, resolutions: ['1K', '2K', '4K'], qualities: [], maxImages: 14 };
const SEEDREAM: PearImageModelSpec = { ratios: SEEDREAM_RATIOS, resolutions: ['2K'], qualities: [], maxImages: 10 };

export const PEAR_IMAGE_MODEL_SPECS: Readonly<Record<string, PearImageModelSpec>> = {
  'gpt-image-2': GPT_IMAGE,
  'gpt-image-2.5': GPT_IMAGE_HIGH,
  'gpt-image-2.6': { ...GPT_IMAGE_HIGH, outputFormats: ['png', 'jpeg', 'webp', 'gif'], gif: true },
  'nano-banana': { ...NANO, resolutions: ['1K'] },
  'nano-banana-2': { ...NANO, resolutions: ['0.5K', '1K', '2K', '4K'] },
  'nano-banana-2.1': NANO,
  'nano-banana-pro': NANO,
  'nano-banana-2-lite': { ...NANO, resolutions: ['0.5K', '1K'] },
  'boogu-image-0.1': { ratios: GPT_RATIOS, resolutions: [], qualities: [], maxImages: 1 },
  'doubao-seedream-4-0-250828': SEEDREAM,
  'doubao-seedream-4-5-251128': SEEDREAM,
  'doubao-seedream-5-0-260128': SEEDREAM,
  'doubao-seedream-5-0-pro-260628': SEEDREAM,
  'firered-image-edit1.1': { ratios: GPT_RATIOS, resolutions: [], qualities: [], maxImages: 3, editOnly: true },
  'flux2-klein-9b': { ratios: BASIC_RATIOS, resolutions: [], qualities: [], maxImages: 0 },
  'grok-imagine-image-2.0': { ratios: [], resolutions: [], qualities: [], maxImages: 1 },
  'wan2.7-image': { ratios: BASIC_RATIOS, resolutions: ['2K'], qualities: [], maxImages: 9 },
  'z-image': { ratios: BASIC_RATIOS, resolutions: [], qualities: [], maxImages: 0 },
};

/**
 * Pear 图片工具模型（https://pearapi.apifox.cn「图片工具」，api-533519649/51/53/55）：只走 /v1/images/edits，
 * 请求体只有 model（小写枚举）、images（必填，最多 1 张）、n、response_format、task_type，没有 prompt/size。
 */
export const PEAR_IMAGE_TOOL_MODELS: Readonly<Record<string, { maxInputLongEdge?: number }>> = {
  'image-layered': {},
  // 「输入图片长边不超过 1024 像素」
  'real-esrgan': { maxInputLongEdge: 1024 },
  'rmbg-2.0': {},
  'seedvr2-upscaler': {},
};

export const PEAR_REAL_ESRGAN_MAX_INPUT_EDGE = 1024;

/** 返回文档中的小写模型名；不是 Pear 图片工具时返回 undefined。 */
export function getPearImageToolModel(modelId: string): string | undefined {
  const id = modelId.trim().toLowerCase();
  return Object.hasOwn(PEAR_IMAGE_TOOL_MODELS, id) ? id : undefined;
}

export function getPearImageModelSpec(modelId: string): PearImageModelSpec | undefined {
  const id = modelId.trim().toLowerCase();
  return Object.hasOwn(PEAR_IMAGE_MODEL_SPECS, id) ? PEAR_IMAGE_MODEL_SPECS[id] : undefined;
}
