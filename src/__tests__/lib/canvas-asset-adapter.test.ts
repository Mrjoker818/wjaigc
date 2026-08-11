import { describe, expect, it } from 'vitest';

import {
  getCanvasMediaFailureAction,
  getAssetGraphReadStrategy,
  hydrateCanvasPlacements,
  serializeCanvasPlacements,
  serializeCanvasWorkspacePlacements,
  shouldWriteAssetShadow,
} from '@/lib/asset-core/canvas-adapter';
import * as canvasAdapter from '@/lib/asset-core/canvas-adapter';
import type { CanvasImage } from '@/lib/user-types';

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

  it('keeps graph placements authoritative only in explicit asset-v3 client merges', () => {
    const selectSnapshot = Reflect.get(canvasAdapter, 'selectCanvasPlacementSnapshot') as undefined | (<T>(
      mode: 'legacy' | 'shadow' | 'asset-v3',
      server: T[],
      legacyMerge: () => T[],
    ) => T[]);
    expect(selectSnapshot).toBeTypeOf('function');

    const server = [{ id: 'graph-only', x: 44 }];
    const legacyMerged = [{ id: 'graph-only', x: 999 }, { id: 'local-only', x: 1 }];
    let legacyMergeCalls = 0;
    const mergeLegacy = () => {
      legacyMergeCalls += 1;
      return legacyMerged;
    };

    expect(selectSnapshot!('asset-v3', server, mergeLegacy)).toEqual(server);
    expect(legacyMergeCalls).toBe(0);
    expect(selectSnapshot!('legacy', server, mergeLegacy)).toEqual(legacyMerged);
    expect(selectSnapshot!('shadow', server, mergeLegacy)).toEqual(legacyMerged);
    expect(legacyMergeCalls).toBe(2);
  });

  it('drives thumbnail then original failure into managed missing state without a legacy retry', () => {
    const handleFailure = Reflect.get(canvasAdapter, 'handleCanvasMediaElementFailure') as undefined | ((input: {
      image: CanvasImage;
      element: { src: string; dataset: Record<string, string | undefined> };
      markMissing: (imageId: string, code: string) => void;
    }) => string);
    expect(handleFailure).toBeTypeOf('function');

    let state: CanvasImage = {
      ...persistedImage,
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      mediaAvailability: 'ready',
    };
    const element: { src: string; dataset: Record<string, string | undefined> } = {
      src: '/media/thumb.png',
      dataset: { canvasMediaSource: 'thumbnail' },
    };
    const markMissing = (imageId: string, code: string) => {
      expect(imageId).toBe(state.id);
      state = { ...state, mediaAvailability: 'missing', mediaErrorCode: code };
    };

    expect(handleFailure!({ image: state, element, markMissing })).toBe('fallback-original');
    expect(element).toEqual({
      src: state.url,
      dataset: { canvasMediaSource: 'original' },
    });
    expect(handleFailure!({ image: state, element, markMissing })).toBe('mark-missing');
    expect(state).toMatchObject({
      mediaAvailability: 'missing',
      mediaErrorCode: 'MEDIA_LOAD_FAILED',
    });
    expect(element.dataset.retried).toBeUndefined();
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

  it('retains managed and unmanaged empty/blob media as explicit broken placements', () => {
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
      expect.objectContaining({ id: 'unmanaged-empty', url: '', mediaAvailability: 'missing' }),
      expect.objectContaining({ id: 'unmanaged-blob', url: 'blob:expired', mediaAvailability: 'missing' }),
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
