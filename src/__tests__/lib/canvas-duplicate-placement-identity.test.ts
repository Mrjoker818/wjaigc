import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { releaseDuplicatePlacementIdentities } from '@/lib/asset-core/canvas-adapter';
import type { CanvasImage } from '@/lib/user-types';

// Regression: Ctrl+D copies kept the source placementId. The project snapshot
// then failed validation (PROJECT_SYNC_PROJECT_PAYLOAD_INVALID), sync stalled,
// deleted copies came back on reload and deleting a copy trashed the original.
const image = (id: string, placementId?: string): CanvasImage => ({
  id, url: '/api/serve-upload/uploads/a.png', x: 0, y: 0, width: 10, height: 10,
  originalWidth: 10, originalHeight: 10, rotation: 0, zIndex: 0, createdAt: 1,
  ...(placementId ? { assetId: 'asset-1', assetVersionId: 'version-1', placementId } : {}),
} as CanvasImage);

describe('canvas duplicate placement identity', () => {
  it('keeps the first holder and turns later holders into unmanaged copies', () => {
    const [original, copy, other] = releaseDuplicatePlacementIdentities([
      image('a', 'p1'), image('b', 'p1'), image('c', 'p2'),
    ]);
    expect(original.placementId).toBe('p1');
    expect(original.assetId).toBe('asset-1');
    expect(copy).toMatchObject({ id: 'b', assetId: undefined, assetVersionId: undefined, placementId: undefined });
    expect(other.placementId).toBe('p2');
  });

  it('returns the same array when identities are already unique', () => {
    const images = [image('a', 'p1'), image('b')];
    expect(releaseDuplicatePlacementIdentities(images)).toBe(images);
  });

  it('Ctrl+D copies and server load both release shared placement identities', () => {
    const canvas = readFileSync(path.resolve('src/components/infinite-canvas.tsx'), 'utf8');
    const duplicate = canvas.slice(canvas.indexOf("e.code === 'KeyD'"), canvas.indexOf("type: 'duplicate'"));
    expect(duplicate).toMatch(/assetId: undefined,\s+assetVersionId: undefined,\s+placementId: undefined/);
    const manager = readFileSync(path.resolve('src/lib/user-manager.ts'), 'utf8');
    expect(manager.match(/p\.canvasImages = releaseDuplicatePlacementIdentities\(p\.canvasImages\);/g)).toHaveLength(2);
  });
});
