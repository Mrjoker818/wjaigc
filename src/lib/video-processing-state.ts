export type VideoGenerationMode =
  | 'text2video'
  | 'image2video-first'
  | 'image2video-firstlast'
  | 'image2video-ref'
  | 'video-extend'
  | 'multi-shot';

export interface VideoRetryPayload {
  prompt: string;
  model: string;
  mode: VideoGenerationMode;
  aspectRatio: string;
  duration: number;
  quality: string;
  imageUrl?: string;
  videoUrl?: string;
  extendDuration?: number;
  generateAudio?: boolean;
  providerId?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImages?: string[];
  resolution?: string;
  cameraControl?: { type: string; angle?: number; speed?: number };
  motionBrush?: {
    maskDataUrl: string;
    trajectories: Array<{
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      speed?: number;
    }>;
  };
  characterReferences?: string[];
  motionStrength?: number;
  seed?: number;
  negativePrompt?: string;
  multiShotScenes?: Array<{
    id: string;
    prompt: string;
    duration: number;
    cameraControl?: { type: string; angle?: number; speed?: number };
  }>;
  chainContinuity?: boolean;
  useGlobalReferences?: boolean;
  useDirector?: boolean;
  directorStyle?: string;
  compiledPrompt?: string;
  compiledNegative?: string;
  shotPlan?: unknown[];
  shotId?: string;
  shotIndex?: number;
  directorMode?: boolean;
  directorIntent?: string;
  _vgenReqId?: string;
}

export interface VideoProcessingState {
  label: string;
  status: string;
  progress: number;
  taskId?: string;
  sourceUrl?: string;
  error?: string;
  startTime?: number;
  retryable?: boolean;
  retryPayload?: VideoRetryPayload;
}

export interface CompletedVideoCanvasMedia {
  url: string;
  videoUrl: string;
  videoThumbnailUrl?: string;
  mediaAvailability: 'ready';
  mediaErrorCode: undefined;
}

export function buildCompletedVideoCanvasMedia(input: {
  videoUrl: string;
  thumbnailUrl?: string;
}): CompletedVideoCanvasMedia {
  const thumbnailUrl = input.thumbnailUrl && input.thumbnailUrl !== input.videoUrl
    ? input.thumbnailUrl
    : undefined;
  return {
    url: thumbnailUrl || '',
    videoUrl: input.videoUrl,
    videoThumbnailUrl: thumbnailUrl,
    mediaAvailability: 'ready',
    mediaErrorCode: undefined,
  };
}

interface PersistableVideoMedia {
  url: string;
  mediaType?: 'image' | 'video';
  videoUrl?: string;
  videoThumbnailUrl?: string;
  thumbnailUrl?: string;
}

export function applyPersistedVideoMediaUrl<TMedia extends PersistableVideoMedia>(
  media: TMedia,
  originalUrl: string,
  localUrl: string,
): TMedia {
  const isVideo = media.mediaType === 'video' || Boolean(media.videoUrl);
  const videoMatches = media.videoUrl === originalUrl;
  return {
    ...media,
    ...(isVideo ? { mediaType: 'video' as const } : {}),
    ...(media.url === originalUrl
      ? { url: isVideo && videoMatches ? '' : localUrl }
      : {}),
    ...(videoMatches ? { videoUrl: localUrl } : {}),
    ...(media.videoThumbnailUrl === originalUrl ? { videoThumbnailUrl: localUrl } : {}),
    ...(media.thumbnailUrl === originalUrl ? { thumbnailUrl: localUrl } : {}),
  };
}

function copyStringArray(value: string[] | undefined): string[] | undefined {
  return value?.length ? [...value] : undefined;
}

/**
 * Captures only the serializable inputs needed to submit the same video again.
 * The generated canvas placeholder ID is intentionally excluded.
 */
export function createVideoRetryPayload(params: VideoRetryPayload): VideoRetryPayload {
  return {
    prompt: params.prompt,
    model: params.model,
    mode: params.mode,
    aspectRatio: params.aspectRatio,
    duration: params.duration,
    quality: params.quality,
    imageUrl: params.imageUrl,
    videoUrl: params.videoUrl,
    extendDuration: params.extendDuration,
    generateAudio: params.generateAudio,
    providerId: params.providerId,
    firstFrameUrl: params.firstFrameUrl,
    lastFrameUrl: params.lastFrameUrl,
    referenceImages: copyStringArray(params.referenceImages),
    resolution: params.resolution,
    cameraControl: params.cameraControl ? { ...params.cameraControl } : undefined,
    motionBrush: params.motionBrush
      ? {
        maskDataUrl: params.motionBrush.maskDataUrl,
        trajectories: params.motionBrush.trajectories.map((trajectory) => ({ ...trajectory })),
      }
      : undefined,
    characterReferences: copyStringArray(params.characterReferences),
    motionStrength: params.motionStrength,
    seed: params.seed,
    negativePrompt: params.negativePrompt,
    multiShotScenes: params.multiShotScenes?.map((scene) => ({
      ...scene,
      cameraControl: scene.cameraControl ? { ...scene.cameraControl } : undefined,
    })),
    chainContinuity: params.chainContinuity,
    useGlobalReferences: params.useGlobalReferences,
    useDirector: params.useDirector,
    directorStyle: params.directorStyle,
    compiledPrompt: params.compiledPrompt,
    compiledNegative: params.compiledNegative,
    shotPlan: params.shotPlan ? [...params.shotPlan] : undefined,
    shotId: params.shotId,
    shotIndex: params.shotIndex,
    directorMode: params.directorMode,
    directorIntent: params.directorIntent,
  };
}

export function buildVideoFailureProcessing(
  processing: VideoProcessingState | undefined,
  message: string | null | undefined,
  label = '视频生成失败',
): VideoProcessingState {
  return {
    ...processing,
    label,
    status: 'failed',
    progress: 100,
    error: message?.trim() || label,
    retryable: true,
  };
}

export function isTerminalProcessingFailure(
  processing: Pick<VideoProcessingState, 'status' | 'progress'> | undefined,
): boolean {
  return processing?.status === 'failed'
    || processing?.status === 'cancelled'
    || processing?.status === 'timeout'
    || processing?.progress === -1;
}
