import { describe, expect, it } from 'vitest';

import {
  getCanvasMediaFailureAction,
  getAssetGraphReadStrategy,
  hydrateCanvasPlacements,
  serializeCanvasPlacements,
  serializeCanvasWorkspacePlacements,
  shouldWriteAssetShadow,
} from '@/lib/asset-core/canvas-adapter';

describe('canvas asset adapter', () => {
  const persistedImage = {
    id: 'canvas-image-1',
    url: '/api/serve-upload/cat.png',
    sourceUrl: 'https://cdn.example.test/cat.png',
    x: 120,
    y: 80,
    width: 640,
    height: 480,
    originalWidth: 1280,
    originalHeight: 960,
    rotation: 15,
    zIndex: 3,
    createdAt: 1700000000000,
    assetId: 'asset-1',
    assetVersionId: 'version-1',
    placementId: 'placement-1',
  } as const;

  it('keeps legacy reads legacy-authoritative and does not enable shadow writes', () => {
    expect(getAssetGraphReadStrategy('legacy')).toBe('legacy-authoritative');
    expect(shouldWriteAssetShadow('legacy')).toBe(false);
  });

  it('keeps asset-v3 strategy support without changing the shadow write policy', () => {
    expect(getAssetGraphReadStrategy('asset-v3')).toBe('asset-authoritative');
    expect(shouldWriteAssetShadow('shadow')).toBe(true);
    expect(shouldWriteAssetShadow('asset-v3')).toBe(true);
  });

  it('round-trips geometry, recovery URL, and placement identity for a shadow placement', () => {
    const hydrated = hydrateCanvasPlacements([persistedImage], 'shadow');
    const serialized = serializeCanvasPlacements(hydrated, 'shadow');

    expect(serialized).toHaveLength(1);
    expect(serialized[0]).toMatchObject(persistedImage);
  });

  it('retains a missing managed placement in the legacy-compatible canvas payload', () => {
    const [hydrated] = hydrateCanvasPlacements([{ ...persistedImage, mediaAvailability: 'missing', mediaErrorCode: 'MEDIA_LOAD_FAILED' }], 'shadow');
    const serialized = serializeCanvasPlacements([hydrated], 'shadow');

    expect(serialized).toHaveLength(1);
    expect(serialized[0]).toMatchObject({
      id: persistedImage.id,
      mediaAvailability: 'missing',
      mediaErrorCode: 'MEDIA_LOAD_FAILED',
    });
  });

  it('preserves rotation and z-index at the shared workspace persistence boundary', () => {
    const [serialized] = serializeCanvasWorkspacePlacements([{
      ...persistedImage,
      rotation: 37,
      zIndex: 11,
    }]);

    expect(serialized).toMatchObject({ rotation: 37, zIndex: 11 });
  });

  it('retains empty managed media but drops empty/blob unmanaged legacy remnants', () => {
    const managedMissing = { ...persistedImage, url: '', mediaAvailability: 'missing' as const };
    const unmanagedMissing = {
      ...persistedImage,
      id: 'unmanaged-empty',
      url: '',
      assetId: undefined,
      assetVersionId: undefined,
      placementId: undefined,
      mediaAvailability: 'missing' as const,
    };
    const unmanagedBlob = { ...unmanagedMissing, id: 'unmanaged-blob', url: 'blob:expired' };

    expect(serializeCanvasWorkspacePlacements([
      managedMissing,
      unmanagedMissing,
      unmanagedBlob,
    ])).toEqual([
      expect.objectContaining({ id: persistedImage.id, url: '', mediaAvailability: 'missing' }),
    ]);
  });

  it('falls back from a thumbnail once, then marks final managed-original failure missing', () => {
    expect(getCanvasMediaFailureAction(persistedImage, {
      failedSource: 'thumbnail',
      legacyRetryAttempted: false,
    })).toBe('fallback-original');
    expect(getCanvasMediaFailureAction(persistedImage, {
      failedSource: 'original',
      legacyRetryAttempted: false,
    })).toBe('mark-missing');
  });
});
