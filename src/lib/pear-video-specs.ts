/**
 * PearAPI video model specs, transcribed from the official model table:
 * https://pearapi.apifox.cn/api-525698888 (POST /v1/video/generations)
 *
 * Only PearAPI providers use this table. Other providers keep VIDEO_MODEL_REGISTRY.
 */

export type PearVideoMode = 'text2video' | 'image2video' | 'imageend2video' | 'reference2video' | 'video2video';

export interface PearVideoModelSpec {
  /** Official model id. Matching is exact first, then longest prefix. */
  id: string;
  name: string;
  /** Official resolution values, in the documented casing (e.g. "720P"). */
  resolutions: string[];
  defaultResolution: string;
  aspectRatios: string[];
  durations: number[];
  modes: PearVideoMode[];
  maxImages: number;
  maxVideos: number;
  maxAudios: number;
  /** Model rejects text-only requests (e.g. hailuo-2.3 first-frame only). */
  requiresImage?: boolean;
  /** Model needs an audio track (lip-sync digital human). */
  requiresAudio?: boolean;
  /**
   * Per-model single-clip ceiling that overrides PLATFORM_VIDEO_MAX_DURATION_SECONDS (15s).
   * Only set for models whose official range goes beyond the platform default.
   */
  maxDurationSeconds?: number;
}

/** Single-clip ceiling for a PearAPI model; falls back to the platform default. */
export function getPearMaxDuration(spec: PearVideoModelSpec | null | undefined, platformDefault: number): number {
  return spec?.maxDurationSeconds && spec.maxDurationSeconds > platformDefault ? spec.maxDurationSeconds : platformDefault;
}

const RANGE_4_15 = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const RANGE_5_15 = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const RANGE_4_30 = Array.from({ length: 27 }, (_, i) => i + 4);
const RATIOS_5 = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const RATIOS_6 = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const SEEDANCE_2_MODES: PearVideoMode[] = ['text2video', 'image2video', 'imageend2video', 'reference2video', 'video2video'];

export const PEAR_VIDEO_MODEL_SPECS: PearVideoModelSpec[] = [
  { id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0', resolutions: ['480P', '720P'], defaultResolution: '720P', aspectRatios: RATIOS_5, durations: RANGE_4_15, modes: SEEDANCE_2_MODES, maxImages: 9, maxVideos: 3, maxAudios: 3 },
  { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', resolutions: ['480P', '720P'], defaultResolution: '720P', aspectRatios: RATIOS_5, durations: RANGE_4_15, modes: SEEDANCE_2_MODES, maxImages: 9, maxVideos: 3, maxAudios: 3 },
  { id: 'doubao-seedance-2-0-mini-260615', name: 'Seedance 2.0 Mini', resolutions: ['720P'], defaultResolution: '720P', aspectRatios: RATIOS_5, durations: RANGE_4_15, modes: SEEDANCE_2_MODES, maxImages: 10, maxVideos: 10, maxAudios: 10 },
  // PearAPI console (model detail page): 4–30s, up to 30 images / 10 videos / 10 audios,
  // modes text/image/reference/video-edit. 1080P is only offered on the discounted channel.
  { id: 'doubao-seedance-2-5-260628', name: 'Seedance 2.5', resolutions: ['480P', '720P', '1080P'], defaultResolution: '720P', aspectRatios: RATIOS_5, durations: RANGE_4_30, modes: [...SEEDANCE_2_MODES], maxImages: 30, maxVideos: 10, maxAudios: 10, maxDurationSeconds: 30 },
  { id: 'gemini-omni', name: 'Gemini Omni', resolutions: ['720P'], defaultResolution: '720P', aspectRatios: ['16:9', '9:16'], durations: [10], modes: ['text2video', 'image2video', 'reference2video', 'video2video'], maxImages: 5, maxVideos: 1, maxAudios: 0 },
  { id: 'grok-imagine-video-1.5', name: 'Grok Imagine Video 1.5', resolutions: ['720P'], defaultResolution: '720P', aspectRatios: ['16:9', '9:16'], durations: [6, 8, 10, 12, 15], modes: ['text2video', 'image2video'], maxImages: 1, maxVideos: 0, maxAudios: 0 },
  { id: 'hailuo-2.3', name: '海螺 2.3', resolutions: ['768P'], defaultResolution: '768P', aspectRatios: RATIOS_5, durations: [6, 10], modes: ['image2video'], maxImages: 1, maxVideos: 0, maxAudios: 0, requiresImage: true },
  { id: 'happyhorse-1.0', name: 'HappyHorse 1.0', resolutions: ['720P'], defaultResolution: '720P', aspectRatios: ['16:9', '9:16', '1:1'], durations: RANGE_5_15, modes: ['text2video', 'image2video', 'reference2video', 'video2video'], maxImages: 9, maxVideos: 3, maxAudios: 3 },
  { id: 'ltx-digitalhuman', name: 'LTX 数字人', resolutions: ['720P'], defaultResolution: '720P', aspectRatios: ['9:16', '16:9', '1:1'], durations: [0], modes: ['image2video'], maxImages: 1, maxVideos: 0, maxAudios: 1, requiresImage: true, requiresAudio: true },
  { id: 'minimax-h3', name: 'MiniMax H3', resolutions: ['480P', '720P', '768P', '2K'], defaultResolution: '720P', aspectRatios: RATIOS_5, durations: RANGE_5_15, modes: ['text2video', 'image2video', 'reference2video'], maxImages: 9, maxVideos: 3, maxAudios: 3 },
  { id: 'seedance-1.0-pro', name: 'Seedance 1.0 Pro', resolutions: ['720P'], defaultResolution: '720P', aspectRatios: RATIOS_6, durations: [5, 10, 12], modes: ['text2video', 'image2video', 'imageend2video'], maxImages: 12, maxVideos: 0, maxAudios: 0 },
  { id: 'seedance-1.5-pro', name: 'Seedance 1.5 Pro', resolutions: ['720P'], defaultResolution: '720P', aspectRatios: RATIOS_6, durations: [5, 10, 12], modes: ['text2video', 'image2video', 'imageend2video'], maxImages: 9, maxVideos: 0, maxAudios: 0 },
  { id: 'veo-3.1', name: 'Veo 3.1', resolutions: ['720P'], defaultResolution: '720P', aspectRatios: ['16:9', '9:16'], durations: [8], modes: ['text2video', 'image2video'], maxImages: 2, maxVideos: 0, maxAudios: 0 },
  { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', resolutions: ['720P'], defaultResolution: '720P', aspectRatios: ['16:9', '9:16'], durations: [8], modes: ['text2video', 'image2video'], maxImages: 2, maxVideos: 0, maxAudios: 0 },
];

/** Exact (case-insensitive) match first, then the longest official id that prefixes the model id. */
export function findPearVideoSpec(modelId: string | undefined | null): PearVideoModelSpec | null {
  if (!modelId) return null;
  const lower = (modelId.includes('::') ? modelId.split('::').pop()! : modelId).trim().toLowerCase();
  const exact = PEAR_VIDEO_MODEL_SPECS.find(spec => spec.id === lower);
  if (exact) return exact;
  let best: PearVideoModelSpec | null = null;
  for (const spec of PEAR_VIDEO_MODEL_SPECS) {
    if (lower.startsWith(spec.id) && (!best || spec.id.length > best.id.length)) best = spec;
  }
  return best;
}

/** PearAPI providers are recognised by base URL or display name. */
export function isPearVideoProvider(provider: { name?: string; displayName?: string; baseUrl?: string; providerName?: string } | string | undefined | null): boolean {
  if (!provider) return false;
  const text = typeof provider === 'string'
    ? provider
    : [provider.baseUrl, provider.name, provider.displayName, provider.providerName].filter(Boolean).join(' ');
  return text.toLowerCase().includes('pearapi') || /\bpear\b/i.test(text);
}

/** Normalise "720p" / "720P" / "2k" to the documented casing; returns null when the model does not list it. */
export function normalizePearResolution(spec: PearVideoModelSpec, resolution: string | undefined | null): string | null {
  if (!resolution) return null;
  const upper = resolution.trim().toUpperCase();
  return spec.resolutions.find(r => r.toUpperCase() === upper) ?? null;
}

/**
 * Map a source video's pixel size to a resolution tier (by its short side).
 * Returns undefined when the size is unknown, so the model default is used.
 */
export function inferVideoResolutionTier(width?: number, height?: number): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const shortSide = Math.min(width, height);
  if (shortSide >= 1440) return '2K';
  if (shortSide >= 1000) return '1080P';
  if (shortSide >= 760) return '768P';
  if (shortSide >= 600) return '720P';
  return '480P';
}

/** Panel-facing capability flags derived from the official spec. */
export function pearSpecToPanelFeatures(spec: PearVideoModelSpec) {
  return {
    firstLastFrame: spec.modes.includes('imageend2video'),
    multiReference: spec.modes.includes('reference2video') && spec.maxImages > 1,
    videoEdit: spec.modes.includes('video2video'),
    // PearAPI has no extend endpoint, camera control, motion brush or audio toggle.
    videoExtend: false,
    audio: false,
    cameraControl: false,
    motionBrush: false,
    characterConsistency: spec.modes.includes('reference2video'),
    multiShot: false,
    maxDuration: Math.max(...spec.durations),
    /** Single-clip ceiling override; undefined means the platform default (15s). */
    maxDurationSeconds: spec.maxDurationSeconds,
    maxAudios: spec.maxAudios,
    requiresAudio: Boolean(spec.requiresAudio),
    durations: spec.durations.filter(d => d > 0),
    aspectRatios: [...spec.aspectRatios],
    resolutions: [...spec.resolutions],
  };
}

export function pickPearDuration(spec: PearVideoModelSpec, duration: number | undefined): number {
  const allowed = spec.durations;
  if (allowed.length === 1 || duration === undefined || !Number.isFinite(duration)) return allowed.includes(duration as number) ? duration as number : allowed[0];
  return allowed.reduce((nearest, candidate) => Math.abs(candidate - duration) < Math.abs(nearest - duration) ? candidate : nearest);
}
