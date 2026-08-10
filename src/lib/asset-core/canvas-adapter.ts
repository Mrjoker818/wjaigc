import type { CanvasImage as CanvasViewImage } from '@/components/infinite-canvas';
import type { CanvasImage as PersistedCanvasImage } from '@/lib/user-types';

import type { AssetGraphMode, MediaAvailability } from './types';

export type AssetGraphReadStrategy = 'legacy-authoritative' | 'asset-authoritative';

type CanvasPlacementImage = PersistedCanvasImage | CanvasViewImage;

function mediaAvailabilityFor(image: CanvasPlacementImage): MediaAvailability {
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

export function isManagedCanvasMedia(image: CanvasPlacementImage): boolean {
  return Boolean(image.assetId || image.assetVersionId);
}

export function shouldPersistCanvasPlacement(image: PersistedCanvasImage): boolean {
  return image.mediaAvailability === 'missing'
    || Boolean(image.url || image.videoUrl || image.svgDataUrl || image.isProcessingPlaceholder);
}

export function getCanvasMediaFilename(image: CanvasPlacementImage): string {
  const source = image.sourceUrl || image.url;
  const filename = source.split('/').pop()?.split('?')[0];
  return filename || 'unavailable-media';
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
