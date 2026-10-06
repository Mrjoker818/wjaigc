import { describe, expect, it, vi } from 'vitest';
import { hydrateAssetV3Projects, type AssetV3CanvasPlacement } from '@/lib/asset-core/canvas-project-sync';
import type { Project } from '@/lib/user-types';

const VERSION = '11111111-1111-4111-8111-111111111111';
function hydrate(metadata: Record<string, unknown> = {}, assetVersionId = VERSION): Project {
  const project = { id: 'shared', userId: 'owner', name: 'Shared', canvasImages: [],
    createdAt: 1, updatedAt: 1, settings: {} } as Project;
  const placement: AssetV3CanvasPlacement = {
    entityId: 'entity-a', assetId: 'asset-a', assetVersionId, placementId: 'placement-a', kind: 'image',
    fileUrl: '/api/serve-upload/images/source.png', availability: 'ready', transform: {}, metadata,
  };
  return hydrateAssetV3Projects([project], { shared: [placement] })[0];
}

describe('canonical annotation source identity', () => {
  it('does not turn a read-time timestamp into a content version and changes identity on an asset revision', () => {
    const clock = vi.spyOn(Date, 'now');
    try {
      clock.mockReturnValueOnce(1000).mockReturnValueOnce(2000);
      const first = hydrate().canvasImages[0];
      const second = hydrate().canvasImages[0];
      expect(first.annotationVersionId).toBe(`entity-a:asset:${VERSION}`);
      expect(second.annotationVersionId).toBe(`entity-a:asset:${VERSION}`);
      expect(hydrate({}, '22222222-2222-4222-8222-222222222222').canvasImages[0].annotationVersionId)
        .toBe('entity-a:asset:22222222-2222-4222-8222-222222222222');
    } finally { clock.mockRestore(); }
  });

  it('preserves persisted legacy annotation identity instead of rewriting existing annotations', () => {
    expect(hydrate({ legacyImage: { annotationVersionId: 'persisted-old-v1', createdAt: 50 } })
      .canvasImages[0].annotationVersionId).toBe('persisted-old-v1');
    const old = hydrate({ legacyImage: { createdAt: 50 } }).canvasImages[0];
    expect(old.createdAt).toBe(50);
    expect(old.annotationVersionId).toBeUndefined();
  });
});
