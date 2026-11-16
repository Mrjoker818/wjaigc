/**
 * APIMart video models documented at docs.apib.ai/cn/api-reference/videos/* (reviewed 2026-11-16)
 * that VIDEO_MODEL_REGISTRY does not describe, or describes for another gateway (kling-v3, viduq3 and
 * happyhorse-1.0 are AI Link entries there). Request field names live in getApiMartVideoSpec (video-api.ts);
 * this table lists the values each model accepts. Keys are lower-case model ids.
 */
import type { SupportedOperation } from '@/lib/task-core/model-capability-contract';

export interface ApiMartVideoModelSpec {
  durations: number[];
  /** Values the tools send (720p / 2K); the submit builder sends the case each model documents. */
  resolutions: string[];
  ratios: string[];
  operations: SupportedOperation[];
  maxImages: number;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

const TEXT_OR_IMAGE: SupportedOperation[] = ['text-to-video', 'image-to-video'];
const FRAMES: SupportedOperation[] = [...TEXT_OR_IMAGE, 'first-last-frame'];
const REFERENCES: SupportedOperation[] = [...TEXT_OR_IMAGE, 'multi-reference'];
const ALL: SupportedOperation[] = [...FRAMES, 'multi-reference'];
/** No text-only generation: the model needs at least one image. */
const IMAGE_ONLY: SupportedOperation[] = ['image-to-video'];
const IMAGE_OR_REFERENCES: SupportedOperation[] = ['image-to-video', 'multi-reference'];

const BASIC_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const WIDE_RATIOS = [...BASIC_RATIOS, '21:9'];
const KLING_RATIOS = ['16:9', '9:16', '1:1'];
const PIXVERSE_RATIOS = [...WIDE_RATIOS, '2:3', '3:2'];
const GROK_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
// Models without a ratio field: the frame follows the input image, the single entry only lets requests through.
const NO_RATIO = ['16:9'];

const HAILUO_2_3: ApiMartVideoModelSpec = {
  // 1080p only supports 6 seconds (checked by the submit builder)
  durations: [6, 10], resolutions: ['768p', '1080p'], ratios: NO_RATIO, operations: TEXT_OR_IMAGE, maxImages: 1,
};
const SKYREELS_V4: ApiMartVideoModelSpec = {
  // Only first_frame_image is wired; end_frame_image and the structured ref_images are not.
  durations: range(3, 15), resolutions: ['480p', '720p', '1080p'], ratios: BASIC_RATIOS, operations: TEXT_OR_IMAGE, maxImages: 1,
};
const HAPPYHORSE: ApiMartVideoModelSpec = {
  durations: range(3, 15), resolutions: ['720p', '1080p'], ratios: BASIC_RATIOS, operations: REFERENCES, maxImages: 9,
};
const WAN_2_6_I2V: ApiMartVideoModelSpec = {
  durations: range(2, 15), resolutions: ['720p', '1080p'], ratios: NO_RATIO, operations: IMAGE_ONLY, maxImages: 1,
};
const WAN_3_0: ApiMartVideoModelSpec = {
  durations: range(2, 30), resolutions: ['480p', '720p', '1080p'], ratios: WIDE_RATIOS, operations: ALL, maxImages: 10,
};
const VIDU_Q3_PRO: ApiMartVideoModelSpec = {
  durations: range(1, 16), resolutions: ['540p', '720p', '1080p'], ratios: BASIC_RATIOS, operations: FRAMES, maxImages: 2,
};
const PIXVERSE_V6: ApiMartVideoModelSpec = {
  // Image-to-video takes one image; first/last-frame transitions are not wired.
  durations: range(1, 15), resolutions: ['360p', '540p', '720p', '1080p'], ratios: PIXVERSE_RATIOS, operations: TEXT_OR_IMAGE, maxImages: 1,
};
const GEMINI_OMNI_RESOLUTIONS = ['360p', '720p', '1080p', '4K'];

export const APIMART_VIDEO_MODEL_SPECS: Readonly<Record<string, ApiMartVideoModelSpec>> = {
  // Frames and reference images cannot be mixed in one request.
  'apimart-zoe': {
    durations: range(4, 30), resolutions: ['480p', '720p', '1080p', '2K', '4K'], ratios: WIDE_RATIOS, operations: ALL, maxImages: 30,
  },
  'seedance-1-0-pro-fast': {
    durations: range(2, 12), resolutions: ['480p', '720p', '1080p'], ratios: WIDE_RATIOS, operations: TEXT_OR_IMAGE, maxImages: 1,
  },
  // last_frame is only supported by the quality model
  'seedance-1-0-pro-quality': {
    durations: range(2, 12), resolutions: ['480p', '720p', '1080p'], ratios: WIDE_RATIOS, operations: FRAMES, maxImages: 2,
  },
  'seedance-1-5-pro': {
    durations: range(4, 12), resolutions: ['480p', '720p', '1080p'], ratios: WIDE_RATIOS, operations: FRAMES, maxImages: 2,
  },
  'seedance-2-5-flash': {
    durations: range(4, 30), resolutions: ['480p', '720p'], ratios: WIDE_RATIOS, operations: ALL, maxImages: 10,
  },
  'minimax-hailuo-2.3': HAILUO_2_3,
  // "使用该模型时，first_frame_image 参数必须上传"
  'minimax-hailuo-2.3-fast': { ...HAILUO_2_3, operations: IMAGE_ONLY },
  'minimax-h3': {
    durations: range(4, 15), resolutions: ['768p', '2K'], ratios: WIDE_RATIOS, operations: ALL, maxImages: 9,
  },
  'minimax-h3-max': {
    durations: range(5, 15), resolutions: ['480p', '768p', '1080p'], ratios: WIDE_RATIOS, operations: ALL, maxImages: 9,
  },
  // image_urls are keyframes: the first starts the video and the last ends it
  'flux-3-video': {
    durations: range(5, 20), resolutions: ['720p', '1080p'], ratios: [...WIDE_RATIOS, '2:1'], operations: FRAMES, maxImages: 2,
  },
  'skyreels-v4-fast': SKYREELS_V4,
  'skyreels-v4-std': SKYREELS_V4,
  'happyhorse-1.0': HAPPYHORSE,
  'happyhorse-1.1': HAPPYHORSE,
  'wan2.6': {
    durations: [5, 10, 15], resolutions: ['720p', '1080p'], ratios: BASIC_RATIOS, operations: TEXT_OR_IMAGE, maxImages: 1,
  },
  'wan2.6-i2v': WAN_2_6_I2V,
  'wan2.6-i2v-flash': WAN_2_6_I2V,
  'wan2.7': {
    durations: range(2, 15), resolutions: ['720p', '1080p'], ratios: BASIC_RATIOS, operations: FRAMES, maxImages: 2,
  },
  'wan3.0-video': WAN_3_0,
  'wan3.0-video-prime': WAN_3_0,
  // mode std (720p) / pro (1080p); last frame and sound need pro and exclude each other
  'kling-v2-6': {
    durations: [5, 10], resolutions: ['720p', '1080p'], ratios: KLING_RATIOS, operations: FRAMES, maxImages: 2,
  },
  'kling-v3': {
    durations: range(3, 15), resolutions: ['720p', '1080p', '4K'], ratios: KLING_RATIOS, operations: FRAMES, maxImages: 2,
  },
  'kling-video-o1': {
    durations: [5, 10], resolutions: ['720p', '1080p'], ratios: KLING_RATIOS, operations: FRAMES, maxImages: 2,
  },
  'kling-v4': {
    durations: range(3, 30), resolutions: ['720p', '1080p'], ratios: [...KLING_RATIOS, '21:9'], operations: ALL, maxImages: 10,
  },
  // no last frame
  'kling-v4-flash': {
    durations: range(3, 20), resolutions: ['720p'], ratios: [...KLING_RATIOS, '21:9'], operations: REFERENCES, maxImages: 10,
  },
  'viduq3-pro': VIDU_Q3_PRO,
  'viduq3-turbo': VIDU_Q3_PRO,
  // 1-7 reference images are required
  'viduq3': {
    durations: range(3, 16), resolutions: ['540p', '720p', '1080p'], ratios: BASIC_RATIOS, operations: IMAGE_OR_REFERENCES, maxImages: 7,
  },
  'viduq3-mix': {
    durations: range(1, 16), resolutions: ['720p', '1080p'], ratios: BASIC_RATIOS, operations: IMAGE_OR_REFERENCES, maxImages: 7,
  },
  // "不支持无图文生视频或首尾帧"
  'viduq4-preview': {
    durations: range(3, 16), resolutions: ['540p', '720p', '1080p', '2K', '4K'], ratios: BASIC_RATIOS, operations: IMAGE_OR_REFERENCES, maxImages: 15,
  },
  'pixverse-v6': PIXVERSE_V6,
  'pixverse-v6-max': PIXVERSE_V6,
  // image_urls are references; the docs set no fixed limit, 7 matches grok-imagine-1.5-video-ext.
  'grok-imagine-video': {
    durations: range(1, 15), resolutions: ['480p', '720p'], ratios: GROK_RATIOS, operations: REFERENCES, maxImages: 7,
  },
  'grok-imagine-video-1.5': {
    durations: range(1, 15), resolutions: ['480p', '720p', '1080p'], ratios: GROK_RATIOS, operations: REFERENCES, maxImages: 7,
  },
  // No duration field: the model picks 3-10 seconds, billed at the nominal 10 seconds.
  'gemini-omni-1.1-flash': {
    durations: [10], resolutions: GEMINI_OMNI_RESOLUTIONS, ratios: ['16:9', '9:16'], operations: ALL, maxImages: 10,
  },
  // first/last-frame interpolation only supports 3-10 seconds (checked by the submit builder)
  'gemini-omni-1.2-flash': {
    durations: range(3, 15), resolutions: GEMINI_OMNI_RESOLUTIONS, ratios: ['16:9', '9:16'], operations: ALL, maxImages: 10,
  },
};

export function getApiMartVideoModelSpec(modelId: string): ApiMartVideoModelSpec | undefined {
  const key = modelId.trim().toLowerCase();
  return Object.hasOwn(APIMART_VIDEO_MODEL_SPECS, key) ? APIMART_VIDEO_MODEL_SPECS[key] : undefined;
}
