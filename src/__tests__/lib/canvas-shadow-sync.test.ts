import { describe, expect, it, vi } from 'vitest';

import {
  executeCanvasProjectSync,
  hydrateAssetV3Projects,
  planCanvasShadowReconciliation,
  type CanvasProjectSyncStorage,
} from '@/lib/asset-core/canvas-project-sync';
import * as legacyMigration from '@/lib/asset-core/legacy-migration';
import type { AssetFile } from '@/lib/asset-core/types';
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

  it('appends a child version for media identity changes and reuses the version for geometry only', () => {
    const planVersion = Reflect.get(legacyMigration, 'planCanvasAssetVersionUpdate') as undefined | ((input: {
      actorUserId: string;
      projectId: string;
      imageId: string;
      mapping: { assetId: string; versionId: string; placementId: string };
      currentFile: AssetFile;
      nextFile: AssetFile;
    }) => {
      action: 'reuse' | 'append';
      mapping: { assetId: string; versionId: string; placementId: string };
      parentVersionIds: string[];
    });
    expect(planVersion).toBeTypeOf('function');

    const mapping = { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' };
    const currentFile: AssetFile = {
      url: '/media/original.png',
      availability: 'ready',
      recoverySourceUrl: 'https://recovery.test/original.png',
      checksum: 'old-checksum',
      width: 600,
      height: 400,
    };
    const geometryOnly = planVersion!({
      actorUserId: 'user-1', projectId: 'project-1', imageId: 'retained', mapping,
      currentFile,
      nextFile: { ...currentFile },
    });
    expect(geometryOnly).toEqual({ action: 'reuse', mapping, parentVersionIds: [] });

    const changed = planVersion!({
      actorUserId: 'user-1', projectId: 'project-1', imageId: 'retained', mapping,
      currentFile,
      nextFile: { ...currentFile, url: '/media/replacement.png', availability: 'missing', width: 1200 },
    });
    expect(changed.action).toBe('append');
    expect(changed.mapping).toMatchObject({ assetId: mapping.assetId, placementId: mapping.placementId });
    expect(changed.mapping.versionId).not.toBe(mapping.versionId);
    expect(changed.parentVersionIds).toEqual([mapping.versionId]);
    expect(currentFile).toEqual(expect.objectContaining({
      url: '/media/original.png', availability: 'ready', width: 600,
    }));
  });

  it('persists data URLs before opening the atomic database transaction', async () => {
    let transactionStarted = false;
    let synchronizedUrl = '';
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        transactionStarted = true;
        return callback({
          async writeProjects() {},
          async syncProject(nextProject) {
            synchronizedUrl = nextProject.canvasImages[0].url;
            return {
              project: nextProject,
              sourceSchemaVersion: 3,
              migrated: false,
              reused: true,
              mappings: {
                encoded: { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' },
              },
            };
          },
        });
      },
    };
    const persistMedia = vi.fn().mockResolvedValue({ url: '/api/serve-upload/uploads/persisted.png' });

    await executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [project([image('encoded', { url: 'data:image/png;base64,AAAA' })])],
      persistMedia,
    } as Parameters<typeof executeCanvasProjectSync>[0] & { persistMedia: typeof persistMedia }, storage);

    expect(persistMedia).toHaveBeenCalledOnce();
    expect(transactionStarted).toBe(true);
    expect(synchronizedUrl).toBe('/api/serve-upload/uploads/persisted.png');
  });

  it('returns persistence failure without beginning or partially writing a database transaction', async () => {
    let transactionStarted = false;
    const storage: CanvasProjectSyncStorage = {
      async transaction() {
        transactionStarted = true;
        throw new Error('transaction must not start');
      },
    };
    const persistMedia = vi.fn().mockRejectedValue(new Error('persist failed'));

    await expect(executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [project([image('encoded', { url: 'data:image/png;base64,AAAA' })])],
      persistMedia,
    } as Parameters<typeof executeCanvasProjectSync>[0] & { persistMedia: typeof persistMedia }, storage))
      .rejects.toThrow('LEGACY_MEDIA_PERSIST_FAILED');
    expect(transactionStarted).toBe(false);
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
