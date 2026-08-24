import type { CanvasImage as CanvasViewImage } from '@/components/infinite-canvas';
import { isTerminalGenerationStatus } from '@/lib/generation-batch';
import type { CanvasImage as PersistedCanvasImage } from '@/lib/user-types';

import type { AssetGraphMode, MediaAvailability } from './types';

export type AssetGraphReadStrategy = 'legacy-authoritative' | 'asset-authoritative';
export type CanvasMediaFailureAction = 'fallback-original' | 'fallback-video' | 'mark-missing' | 'legacy-fallback' | 'ignore';
export type CanvasMediaRenderDecision = 'broken-media' | 'image' | 'video' | 'none';

type CanvasPlacementImage = PersistedCanvasImage | CanvasViewImage;

function mediaAvailabilityFor(image: CanvasPlacementImage): MediaAvailability {
  if (image.mediaType === 'video' && image.videoUrl && image.mediaAvailability !== 'unrecoverable') {
    return 'ready';
  }
  if (image.mediaAvailability) return image.mediaAvailability;
  if (image.url.startsWith('data:')) return 'pending-persist';
  if (image.url.startsWith('blob:') || image.url.length === 0) return 'missing';
  return 'ready';
}

export function getAssetGraphReadStrategy(mode: AssetGraphMode): AssetGraphReadStrategy {
  return mode === 'asset-v3' ? 'asset-authoritative' : 'legacy-authoritative';
}

export function shouldWriteAssetShadow(mode: AssetGraphMode): boolean {
  return mode === 'shadow' || mode === 'asset-v3';
}

export function selectCanvasPlacementSnapshot<T>(
  mode: AssetGraphMode,
  serverPlacements: T[],
  mergeLegacyPlacements: () => T[],
): T[] {
  return getAssetGraphReadStrategy(mode) === 'asset-authoritative'
    ? serverPlacements
    : mergeLegacyPlacements();
}

export function isManagedCanvasMedia(image: CanvasPlacementImage): boolean {
  return Boolean(image.assetId || image.assetVersionId);
}

export function getCanvasMediaRenderDecision(
  image: CanvasPlacementImage,
): CanvasMediaRenderDecision {
  if (image.mediaType === 'video') {
    if (image.videoUrl && image.mediaAvailability !== 'unrecoverable') return 'video';
    return 'broken-media';
  }
  if (
    image.mediaAvailability === 'missing'
    || image.mediaAvailability === 'unrecoverable'
    || image.url.length === 0
  ) {
    return 'broken-media';
  }
  return image.url ? 'image' : 'none';
}

export function shouldPersistCanvasPlacement(image: CanvasPlacementImage): boolean {
  if (image.isProcessingPlaceholder) {
    return !isTerminalGenerationStatus(image.processing?.status);
  }
  if (image.mediaAvailability === 'missing') return true;
  return Boolean(image.url || image.videoUrl || image.svgDataUrl);
}

export function shouldRetainCanvasPlacementDuringMerge(image: CanvasPlacementImage): boolean {
  return shouldPersistCanvasPlacement(image);
}

export function getCanvasMediaFailureAction(
  image: CanvasPlacementImage,
  state: { failedSource: 'thumbnail' | 'original'; legacyRetryAttempted: boolean },
): CanvasMediaFailureAction {
  if (image.mediaAvailability === 'unrecoverable') return 'ignore';
  if (image.mediaType === 'video' && image.videoUrl) return 'fallback-video';
  if (state.failedSource === 'thumbnail') return 'fallback-original';
  if (
    isManagedCanvasMedia(image)
    || image.mediaAvailability === 'missing'
    || image.url.startsWith('blob:')
    || image.url.length === 0
  ) return 'mark-missing';
  return state.legacyRetryAttempted ? 'ignore' : 'legacy-fallback';
}

export function handleCanvasMediaElementFailure(input: {
  image: CanvasPlacementImage;
  element: { src: string; dataset: Record<string, string | undefined> };
  markMissing: (imageId: string, errorCode: string) => void;
}): CanvasMediaFailureAction {
  const action = getCanvasMediaFailureAction(input.image, {
    failedSource: input.element.dataset.canvasMediaSource === 'thumbnail' ? 'thumbnail' : 'original',
    legacyRetryAttempted: input.element.dataset.retried === '1',
  });
  if (action === 'fallback-original') {
    input.element.dataset.canvasMediaSource = 'original';
    input.element.src = input.image.url;
  } else if (action === 'mark-missing') {
    input.markMissing(input.image.id, 'MEDIA_LOAD_FAILED');
  }
  return action;
}

export function clearFailedCanvasVideoPoster<TImage extends CanvasPlacementImage>(image: TImage): TImage {
  if (image.mediaType !== 'video' || !image.videoUrl) return image;
  return {
    ...image,
    url: '',
    thumbnailUrl: undefined,
    videoThumbnailUrl: undefined,
  };
}

export function getCanvasMediaFilename(image: CanvasPlacementImage): string {
  const source = image.mediaType === 'video'
    ? image.videoUrl || image.sourceUrl || image.url
    : image.sourceUrl || image.url;
  const filename = source.split('/').pop()?.split('?')[0];
  return filename || 'unavailable-media';
}

export function applyRecoveredCanvasMedia<TImage extends CanvasPlacementImage>(
  image: TImage,
  result: {
    recovered: boolean;
    availability: MediaAvailability;
    url?: string;
    error?: string;
  },
): TImage {
  const recoveredUrl = result.url || '';
  const isVideo = image.mediaType === 'video';
  return {
    ...image,
    ...(isVideo && recoveredUrl ? { videoUrl: recoveredUrl } : {}),
    ...(!isVideo && recoveredUrl ? { url: recoveredUrl } : {}),
    mediaAvailability: result.availability,
    mediaErrorCode: result.recovered || result.availability === 'recovering'
      ? undefined
      : result.error || 'MEDIA_RECOVERY_FAILED',
  };
}

export function hydrateCanvasPlacements(
  images: PersistedCanvasImage[],
  _mode: AssetGraphMode = 'legacy',
): CanvasViewImage[] {
  return images.map((image) => ({
    ...image,
    width: image.width || 256,
    height: image.height || 256,
    originalWidth: image.originalWidth || image.width || 512,
    originalHeight: image.originalHeight || image.height || 512,
    mediaAvailability: mediaAvailabilityFor(image),
  }));
}

export function serializeCanvasPlacements(
  images: CanvasViewImage[],
  _mode: AssetGraphMode = 'legacy',
): PersistedCanvasImage[] {
  return images.map((image) => ({
    ...image,
    originalWidth: image.originalWidth || image.width,
    originalHeight: image.originalHeight || image.height,
    rotation: image.rotation ?? 0,
    zIndex: image.zIndex ?? 0,
    createdAt: image.createdAt || Date.now(),
    mediaAvailability: mediaAvailabilityFor(image),
  }));
}

export function serializeCanvasWorkspacePlacements(
  images: CanvasViewImage[],
  mode: AssetGraphMode = 'legacy',
): PersistedCanvasImage[] {
  return serializeCanvasPlacements(images, mode).filter(shouldPersistCanvasPlacement);
}
