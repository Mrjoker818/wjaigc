/**
 * PearAPI video model endpoints are indexed at https://pearapi.apifox.cn/llms.txt.
 * POST /v1/videos/generations takes duration, resolution (upper-case P), ratio/aspect_ratio,
 * generation_mode and reference material; each model only accepts the values listed here.
 */
export type PearVideoGenerationMode = 'text2video' | 'image2video' | 'reference2video' | 'video2video';

/** Operations exposed by /api/video/generate. */
export const PEAR_VIDEO_GENERATE_OPERATIONS = {
  text2video: 'text-to-video',
  image2video: 'image-to-video',
  reference2video: 'multi-reference',
  video2video: undefined,
} as const;

export interface PearVideoModelSpec {
  durations: number[];
  /** Values the API accepts, e.g. 720P / 768P / 2K. */
  resolutions: string[];
  ratios: string[];
  modes: PearVideoGenerationMode[];
  maxImages: number;
  maxVideos: number;
  /** Override the general guidance to use multiple materials for reference2video. */
  minReferenceImages?: number;
  /** These model schemas document separate media arrays only. */
  referenceArrays?: true;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

const STANDARD_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const ALL_MODES: PearVideoGenerationMode[] = ['text2video', 'image2video', 'reference2video', 'video2video'];
export const PEAR_VIDEO_DEFAULT_DURATIONS = range(4, 15);

const SEEDANCE_2: PearVideoModelSpec = {
  durations: PEAR_VIDEO_DEFAULT_DURATIONS,
  resolutions: ['720P', '480P'],
  ratios: STANDARD_RATIOS,
  modes: ALL_MODES,
  maxImages: 9,
  maxVideos: 3,
};

export const PEAR_VIDEO_MODEL_SPECS: Readonly<Record<string, PearVideoModelSpec>> = {
  'doubao-seedance-2-0-260128': SEEDANCE_2,
  'doubao-seedance-2-0-fast-260128': SEEDANCE_2,
  'doubao-seedance-2-0-mini-260615': { ...SEEDANCE_2, resolutions: ['720P'], maxImages: 10, maxVideos: 10 },
  'doubao-seedance-2-5-260628': { ...SEEDANCE_2, durations: range(4, 30), resolutions: ['480P', '720P', '1080P'] },
  // 海螺：必须提供 1 张图片；不支持纯文字生成、视频或音频参考。
  'hailuo-2.3': {
    durations: [6, 10], resolutions: ['768P'], ratios: STANDARD_RATIOS,
    modes: ['image2video'], maxImages: 1, maxVideos: 0,
  },
  'happyhorse-1.0': {
    durations: range(5, 15), resolutions: ['720P'], ratios: ['16:9', '9:16', '1:1'],
    modes: ALL_MODES, maxImages: 9, maxVideos: 1, minReferenceImages: 1,
  },
  'minimax-h3': {
    durations: range(5, 15), resolutions: ['768P', '2K', '480P', '720P'], ratios: STANDARD_RATIOS,
    modes: ['text2video', 'image2video', 'reference2video'], maxImages: 9, maxVideos: 3,
  },
  'seedance-1.0-pro': {
    durations: [5, 10, 12], resolutions: ['720P'], ratios: [...STANDARD_RATIOS, '21:9'],
    modes: ['text2video', 'image2video'], maxImages: 12, maxVideos: 0, referenceArrays: true,
  },
  'seedance-1.5-pro': {
    durations: [5, 10, 12], resolutions: ['720P'], ratios: [...STANDARD_RATIOS, '21:9'],
    modes: ['text2video', 'image2video'], maxImages: 9, maxVideos: 0, referenceArrays: true,
  },
  // The models below are marked 维护中 in the docs.
  'gemini-omni': {
    durations: [10], resolutions: ['720P'], ratios: ['16:9', '9:16'],
    modes: ['text2video', 'image2video', 'video2video'], maxImages: 5, maxVideos: 1, referenceArrays: true,
  },
  'grok-imagine-video-1.5': {
    durations: [6, 8, 10, 12, 15], resolutions: ['720P', '1080P'], ratios: ['16:9', '9:16'],
    modes: ['text2video', 'image2video'], maxImages: 1, maxVideos: 0, referenceArrays: true,
  },
  'veo-3.1': {
    durations: [8], resolutions: ['720P'], ratios: ['16:9', '9:16'],
    modes: ['text2video', 'image2video'], maxImages: 2, maxVideos: 0, referenceArrays: true,
  },
  'veo-3.1-fast': {
    durations: [8], resolutions: ['720P'], ratios: ['16:9', '9:16'],
    modes: ['text2video', 'image2video'], maxImages: 2, maxVideos: 0, referenceArrays: true,
  },
};

export function getPearVideoModelSpec(modelId: string): PearVideoModelSpec | undefined {
  const key = modelId.trim().toLowerCase();
  return Object.hasOwn(PEAR_VIDEO_MODEL_SPECS, key) ? PEAR_VIDEO_MODEL_SPECS[key] : undefined;
}
