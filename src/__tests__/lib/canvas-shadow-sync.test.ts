import { describe, expect, it } from 'vitest';

import {
  executeCanvasProjectSync,
  hydrateAssetV3Projects,
  planCanvasShadowReconciliation,
  type CanvasProjectSyncStorage,
} from '@/lib/asset-core/canvas-project-sync';
import type { CanvasImage, Project } from '@/lib/user-types';

const image = (id: string, overrides: Partial<CanvasImage> = {}): CanvasImage => ({
  id,
  url: `/media/${id}.png`,
  x: 10,
  y: 20,
  width: 300,
  height: 200,
  originalWidth: 600,
  originalHeight: 400,
  rotation: 0,
  zIndex: 1,
  createdAt: 1700000000000,
  ...overrides,
});

const project = (canvasImages: CanvasImage[]): Project => ({
  id: 'project-1',
  userId: 'user-1',
  name: 'Project',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  canvasImages,
  settings: {},
});

describe('continuous canvas shadow synchronization', () => {
  it('plans geometry updates, additions, and deletions after the initial checkpoint', () => {
    const previousMappings = {
      retained: { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' },
      removed: { assetId: 'asset-b', versionId: 'version-b', placementId: 'placement-b' },
    };

    const plan = planCanvasShadowReconciliation({
      actorUserId: 'user-1',
      projectId: 'project-1',
      previousMappings,
      images: [
        image('retained', { x: 91, y: 72, rotation: 25, zIndex: 8 }),
        image('added'),
      ],
    });

    expect(plan.updates).toEqual([
      expect.objectContaining({
        image: expect.objectContaining({ id: 'retained', x: 91, rotation: 25, zIndex: 8 }),
        mapping: previousMappings.retained,
      }),
    ]);
    expect(plan.additions).toEqual([
      expect.objectContaining({ image: expect.objectContaining({ id: 'added' }) }),
    ]);
    expect(plan.removals).toEqual([previousMappings.removed]);
    expect(plan.activeMappings).toEqual(expect.objectContaining({
      retained: previousMappings.retained,
      added: expect.objectContaining({ assetId: expect.any(String), placementId: expect.any(String) }),
    }));
  });

  it('does not commit the legacy snapshot when graph synchronization fails', async () => {
    let committedProjects = [project([image('before')])];
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        let draftProjects = structuredClone(committedProjects);
        const result = await callback({
          async writeProjects(projects) {
            draftProjects = structuredClone(projects);
          },
          async syncProject() {
            throw new Error('graph write failed');
          },
        });
        committedProjects = draftProjects;
        return result;
      },
    };

    await expect(executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [project([image('after')])],
    }, storage)).rejects.toThrow('graph write failed');
    expect(committedProjects[0].canvasImages.map((item) => item.id)).toEqual(['before']);
  });

  it('hydrates asset-v3 canvas images from graph placement/version state', () => {
    const [hydrated] = hydrateAssetV3Projects([project([image('legacy')])], {
      'project-1': [{
        entityId: 'graph-image',
        assetId: 'asset-graph',
        assetVersionId: 'version-graph',
        placementId: 'placement-graph',
        fileUrl: '',
        availability: 'missing',
        recoverySourceUrl: 'https://recovery.test/graph-image.png',
        transform: { x: 44, y: 55, width: 640, height: 480, rotation: 12, zIndex: 7 },
        metadata: { legacyImage: image('graph-image') },
      }],
    });

    expect(hydrated.canvasImages).toEqual([
      expect.objectContaining({
        id: 'graph-image',
        url: '',
        x: 44,
        rotation: 12,
        zIndex: 7,
        assetId: 'asset-graph',
        assetVersionId: 'version-graph',
        placementId: 'placement-graph',
        mediaAvailability: 'missing',
      }),
    ]);
  });
});
