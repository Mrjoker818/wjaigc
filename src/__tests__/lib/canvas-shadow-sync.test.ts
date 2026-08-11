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

  it('executes append-only reconciliation with lineage, current, placement, and checkpoint in one transaction state', async () => {
    const previousMapping = {
      assetId: 'asset-a',
      versionId: 'version-old',
      placementId: 'placement-a',
    };
    const rawProject = project([image('retained', {
      url: '/media/replacement.png',
      sourceUrl: 'https://recovery.test/replacement.png',
      originalWidth: 1200,
      originalHeight: 800,
    })]);
    const oldVersion = {
      id: 'version-old',
      file_url: '/media/original.png',
      storage_key: 'original-key',
      checksum: 'old-checksum',
      mime_type: 'image/png',
      byte_size: '1234',
      width: 600,
      height: 400,
      availability: 'ready' as const,
      recovery_source_url: 'https://recovery.test/original.png',
      metadata: { immutable: 'old-version-metadata' },
    };
    const originalVersionSnapshot = structuredClone(oldVersion);
    const state: {
      childVersion?: { id: string; assetId: string; fileUrl: string; metadata: unknown };
      parent?: { versionId: string; parentVersionId: string };
      currentVersionId?: string;
      placementVersionId?: string;
      checkpointMapping?: { assetId: string; versionId: string; placementId: string };
    } = {};
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT legacy.value AS legacy_project')) return { rows: [{ legacy_project: rawProject }], rowCount: 1 };
      if (sql.includes('FROM wujie_asset_migration_checkpoints') && sql.includes('SELECT status')) {
        return {
          rows: [{
            status: 'completed',
            checkpoint: { sourceSchemaVersion: 1, legacyImageMappings: { retained: previousMapping } },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT schema_version, metadata') && sql.includes('FROM wujie_projects')) {
        return { rows: [{ schema_version: 3, metadata: {} }], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_assets') && sql.includes('SET kind =')) return { rows: [], rowCount: 1 };
      if (sql.includes('FROM wujie_asset_versions') && sql.includes('FOR UPDATE')) {
        return { rows: [oldVersion], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO wujie_asset_versions')) {
        state.childVersion = {
          id: String(params[0]),
          assetId: String(params[1]),
          fileUrl: String(params[4]),
          metadata: JSON.parse(String(params[14])),
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO wujie_asset_version_parents')) {
        state.parent = { versionId: String(params[3]), parentVersionId: String(params[4]) };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_assets SET current_version_id')) {
        state.currentVersionId = String(params[3]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_workspace_placements')) {
        state.placementVersionId = String(params[3]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_asset_migration_checkpoints')) {
        const checkpoint = JSON.parse(String(params[3])) as {
          legacyImageMappings: Record<string, { assetId: string; versionId: string; placementId: string }>;
        };
        state.checkpointMapping = checkpoint.legacyImageMappings.retained;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_projects SET name')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query } as unknown as Parameters<typeof legacyMigration.migrateLegacyProjectOnWriteInTransaction>[0];

    const result = await legacyMigration.migrateLegacyProjectOnWriteInTransaction(client, {
      actorUserId: 'user-1',
      projectId: 'project-1',
    });

    expect(oldVersion).toEqual(originalVersionSnapshot);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE wujie_asset_versions'))).toBe(false);
    expect(state.childVersion).toMatchObject({
      assetId: 'asset-a',
      fileUrl: '/media/replacement.png',
      metadata: expect.objectContaining({ legacyImageId: 'retained' }),
    });
    expect(state.childVersion?.id).not.toBe('version-old');
    expect(state.parent).toEqual({ versionId: state.childVersion?.id, parentVersionId: 'version-old' });
    expect(state.currentVersionId).toBe(state.childVersion?.id);
    expect(state.placementVersionId).toBe(state.childVersion?.id);
    expect(state.checkpointMapping).toEqual({
      assetId: 'asset-a',
      versionId: state.childVersion?.id,
      placementId: 'placement-a',
    });
    expect(result.mappings.retained).toEqual(state.checkpointMapping);
  });

  it('persists data URLs before opening the atomic database transaction', async () => {
    let transactionStarted = false;
    let synchronizedMedia: Pick<CanvasImage, 'url' | 'sourceUrl' | 'thumbnailUrl'> | undefined;
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        transactionStarted = true;
        return callback({
          async writeProjects() {},
          async syncProject(nextProject) {
            synchronizedMedia = nextProject.canvasImages[0];
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
    const persistMedia = vi.fn(async ({ dataUrl }: { dataUrl: string }) => ({
      url: `/api/serve-upload/uploads/${dataUrl.slice(-4).toLowerCase()}.png`,
    }));

    await executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [project([image('encoded', {
        url: 'data:image/png;base64,AAAA',
        sourceUrl: 'data:image/png;base64,BBBB',
        thumbnailUrl: 'data:image/png;base64,CCCC',
      })])],
      persistMedia,
    } as Parameters<typeof executeCanvasProjectSync>[0] & { persistMedia: typeof persistMedia }, storage);

    expect(persistMedia).toHaveBeenCalledTimes(3);
    expect(transactionStarted).toBe(true);
    expect(synchronizedMedia).toMatchObject({
      url: '/api/serve-upload/uploads/aaaa.png',
      sourceUrl: '/api/serve-upload/uploads/bbbb.png',
      thumbnailUrl: '/api/serve-upload/uploads/cccc.png',
    });
    expect(JSON.stringify(synchronizedMedia)).not.toContain('data:image');
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

  it('preserves missing primary availability when only recovery media needs persistence', async () => {
    let synchronizedImage: CanvasImage | undefined;
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        return callback({
          async writeProjects() {},
          async syncProject(nextProject) {
            synchronizedImage = nextProject.canvasImages[0];
            return {
              project: nextProject,
              sourceSchemaVersion: 3,
              migrated: false,
              reused: true,
              mappings: {
                missing: { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' },
              },
            };
          },
        });
      },
    };

    await executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [project([image('missing', {
        url: '',
        sourceUrl: 'data:image/png;base64,BBBB',
        mediaAvailability: 'missing',
        mediaErrorCode: 'MEDIA_LOAD_FAILED',
      })])],
      persistMedia: async () => ({ url: '/api/serve-upload/uploads/recovery.png' }),
    }, storage);

    expect(synchronizedImage).toMatchObject({
      url: '',
      sourceUrl: '/api/serve-upload/uploads/recovery.png',
      mediaAvailability: 'missing',
      mediaErrorCode: 'MEDIA_LOAD_FAILED',
    });
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
