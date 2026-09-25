import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('server-only', () => ({}));

import {
  executeCanvasProjectSync,
  executeLegacyCanvasProjectSync,
  adoptTaskProjectedCanvasMapping,
  hydrateAssetV3Projects,
  planCanvasShadowReconciliation,
  selectCanvasImagesForAssetGraph,
  reconcileDeletedCanvasProjectsInTransaction,
  type CanvasProjectSyncTransaction,
  type CanvasProjectSyncStorage,
} from '@/lib/asset-core/canvas-project-sync';
import * as legacyMigration from '@/lib/asset-core/legacy-migration';
import { serializeCanvasWorkspacePlacements } from '@/lib/asset-core/canvas-adapter';
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
  it('adopts a complete managed canvas reference instead of creating a duplicate placement', async () => {
    const adoptManagedCanvasMapping = (
      legacyMigration as typeof legacyMigration & {
        adoptManagedCanvasMapping?: (
          client: { query: typeof query },
          input: { actorUserId: string; projectId: string },
          candidate: CanvasImage,
        ) => Promise<{ assetId: string; versionId: string; placementId: string } | null>;
      }
    ).adoptManagedCanvasMapping;
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM wujie_assets asset')) {
        expect(params).toEqual(['asset-transfer', 'user-1', 'project-1']);
        return { rows: [{ id: 'asset-transfer' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_asset_versions')) {
        expect(params).toEqual(['version-transfer', 'asset-transfer', 'user-1', 'project-1']);
        return { rows: [{ asset_id: 'asset-transfer', asset_version_id: 'version-transfer' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_workspace_placements')) {
        expect(params).toEqual([
          'placement-transfer', 'user-1', 'project-1', 'asset-transfer', 'version-transfer', 'chat-image',
        ]);
        return {
          rows: [{
            asset_id: 'asset-transfer',
            asset_version_id: 'version-transfer',
            placement_id: 'placement-transfer',
          }],
          rowCount: 1,
        };
      }
      expect(sql).toContain('UPDATE wujie_workspace_placements');
      return { rows: [], rowCount: 1 };
    });

    expect(adoptManagedCanvasMapping).toBeTypeOf('function');
    if (!adoptManagedCanvasMapping) return;
    await expect(adoptManagedCanvasMapping(
      { query },
      { actorUserId: 'user-1', projectId: 'project-1' },
      image('chat-image', {
        assetId: 'asset-transfer',
        assetVersionId: 'version-transfer',
        placementId: 'placement-transfer',
      }),
    )).resolves.toEqual({
      assetId: 'asset-transfer',
      versionId: 'version-transfer',
      placementId: 'placement-transfer',
    });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('recovers a missing asset ID only from the matching active canvas placement', async () => {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('JOIN wujie_workspace_placements placement')) {
        expect(params).toEqual([
          'placement-transfer', 'version-transfer', 'user-1', 'project-1', 'chat-image', null,
        ]);
        expect(sql).toContain("placement.status = 'active'");
        expect(sql).toContain('placement.entity_id = $5');
        return { rows: [{ id: 'asset-transfer', entity_id: 'chat-image' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_assets asset')) {
        expect(params).toEqual(['asset-transfer', 'user-1', 'project-1']);
        return { rows: [{ id: 'asset-transfer' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_asset_versions')) {
        expect(params).toEqual(['version-transfer', 'asset-transfer', 'user-1', 'project-1']);
        return { rows: [{ asset_id: 'asset-transfer', asset_version_id: 'version-transfer' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_workspace_placements')) {
        expect(params).toEqual([
          'placement-transfer', 'user-1', 'project-1', 'asset-transfer', 'version-transfer', 'chat-image',
        ]);
        return { rows: [{ asset_id: 'asset-transfer', asset_version_id: 'version-transfer', placement_id: 'placement-transfer' }], rowCount: 1 };
      }
      expect(sql).toContain('UPDATE wujie_workspace_placements');
      return { rows: [], rowCount: 1 };
    });

    await expect(legacyMigration.adoptManagedCanvasMapping(
      { query } as never,
      { actorUserId: 'user-1', projectId: 'project-1' },
      image('chat-image', { assetVersionId: 'version-transfer', placementId: 'placement-transfer' }),
    )).resolves.toEqual({ assetId: 'asset-transfer', versionId: 'version-transfer', placementId: 'placement-transfer' });
    expect(query).toHaveBeenCalledTimes(5);
  });

  it('rejects a partial managed reference when no matching placement proves its asset ID', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    await expect(legacyMigration.adoptManagedCanvasMapping(
      { query } as never,
      { actorUserId: 'user-1', projectId: 'project-1' },
      image('chat-image', { assetVersionId: 'version-transfer', placementId: 'placement-transfer' }),
    )).rejects.toMatchObject({ code: 'LEGACY_MIGRATION_INTEGRITY_CONFLICT' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('adopts a generated placeholder alias only when its task projection proves the same asset', async () => {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('JOIN wujie_workspace_placements placement')) {
        expect(params).toEqual([
          'placement-transfer', 'version-transfer', 'user-1', 'project-1',
          'gen-ph-old', 'task-1',
        ]);
        expect(sql).toContain("version.metadata->>'outputIndex' = '0'");
        return { rows: [{ id: 'asset-transfer', entity_id: 'task-1:0' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_assets asset')) return { rows: [{ id: 'asset-transfer' }], rowCount: 1 };
      if (sql.includes('FROM wujie_asset_versions')) return { rows: [{ asset_id: 'asset-transfer', asset_version_id: 'version-transfer' }], rowCount: 1 };
      if (sql.includes('FROM wujie_workspace_placements')) {
        expect(params?.[5]).toBe('task-1:0');
        return { rows: [{ asset_id: 'asset-transfer', asset_version_id: 'version-transfer', placement_id: 'placement-transfer' }], rowCount: 1 };
      }
      expect(sql).toContain('SET entity_id = $9');
      expect(params?.[7]).toBe('task-1:0');
      expect(params?.[8]).toBe('gen-ph-old');
      return { rows: [], rowCount: 1 };
    });
    await expect(legacyMigration.adoptManagedCanvasMapping(
      { query } as never,
      { actorUserId: 'user-1', projectId: 'project-1' },
      image('gen-ph-old', {
        generationTaskId: 'task-1', assetVersionId: 'version-transfer', placementId: 'placement-transfer',
      }),
    )).resolves.toEqual({ assetId: 'asset-transfer', versionId: 'version-transfer', placementId: 'placement-transfer' });
  });

  it('fails closed when a complete managed reference does not match its canvas placement', async () => {
    const adoptManagedCanvasMapping = (
      legacyMigration as typeof legacyMigration & {
        adoptManagedCanvasMapping?: (
          client: { query: typeof query },
          input: { actorUserId: string; projectId: string },
          candidate: CanvasImage,
        ) => Promise<unknown>;
      }
    ).adoptManagedCanvasMapping;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM wujie_assets asset')) {
        return { rows: [{ id: 'asset-transfer' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_asset_versions')) {
        return { rows: [{ asset_id: 'asset-transfer', asset_version_id: 'version-transfer' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_workspace_placements')) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    expect(adoptManagedCanvasMapping).toBeTypeOf('function');
    if (!adoptManagedCanvasMapping) return;
    await expect(adoptManagedCanvasMapping(
      { query },
      { actorUserId: 'user-1', projectId: 'project-1' },
      image('chat-image', {
        assetId: 'asset-transfer',
        assetVersionId: 'version-transfer',
        placementId: 'placement-transfer',
      }),
    )).rejects.toMatchObject({ code: 'LEGACY_MIGRATION_INTEGRITY_CONFLICT' });
  });

  it('locks a managed asset before its version and requires a project canvas workspace', () => {
    const migrationSource = readFileSync(
      resolve(process.cwd(), 'src/lib/asset-core/legacy-migration.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const adoptionStart = migrationSource.indexOf('export async function adoptManagedCanvasMapping');
    const adoptionEnd = migrationSource.indexOf('\nexport async function adoptTaskProjectedCanvasMapping', adoptionStart);
    const adoptionSource = migrationSource.slice(adoptionStart, adoptionEnd);
    const assetLock = adoptionSource.indexOf('FROM wujie_assets asset');
    const versionLock = adoptionSource.indexOf('FROM wujie_asset_versions');
    const placementLock = adoptionSource.indexOf('FROM wujie_workspace_placements');

    expect(assetLock).toBeGreaterThan(-1);
    expect(versionLock).toBeGreaterThan(-1);
    expect(placementLock).toBeGreaterThan(-1);
    expect(assetLock).toBeLessThan(versionLock);
    expect(versionLock).toBeLessThan(placementLock);
    expect(adoptionSource).toContain("workspace_id IN ($3, 'canvas:' || $3)");
  });

  it('keeps processing placeholders out of the asset graph', () => {
    const placeholder = image('pending-task', {
      url: '',
      isProcessingPlaceholder: true,
      processing: {
        label: 'Generating',
        status: 'processing',
        progress: 10,
        taskId: 'task-1',
      },
    });
    const completed = image('completed-image');

    expect(selectCanvasImagesForAssetGraph([placeholder, completed])).toEqual([completed]);

    const plan = planCanvasShadowReconciliation({
      actorUserId: 'user-1',
      projectId: 'project-1',
      previousMappings: {},
      images: [placeholder, completed],
    });

    expect(plan.additions.map(({ image: candidate }) => candidate.id)).toEqual(['completed-image']);
    expect(plan.activeMappings).not.toHaveProperty('pending-task');
    expect(plan.checkpointMappings).not.toHaveProperty('pending-task');
  });

  it('adopts an existing task projection instead of creating a duplicate legacy asset', async () => {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM wujie_asset_versions')) {
        if (sql.includes('FOR UPDATE OF asset')) {
          expect(params).toEqual(['user-1', 'project-1', 'task-1', 0]);
        } else {
          expect(params).toEqual(['version-task', 'asset-task', 'user-1', 'project-1', 'task-1', 0]);
        }
        return {
          rows: [{ asset_id: 'asset-task', asset_version_id: 'version-task' }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM wujie_workspace_placements placement')) {
        expect(params).toEqual(['user-1', 'project-1', 'task-1:0', 'asset-task', 'version-task']);
        return {
          rows: [{
            asset_id: 'asset-task',
            asset_version_id: 'version-task',
            placement_id: 'placement-task',
          }],
          rowCount: 1,
        };
      }
      expect(sql).toContain('UPDATE wujie_workspace_placements');
      expect(params[0]).toBe('placement-task');
      expect(params[1]).toBe('user-1');
      expect(params[2]).toBe('project-1');
      return { rows: [], rowCount: 1 };
    });

    const mapping = await adoptTaskProjectedCanvasMapping(
      { query } as never,
      { actorUserId: 'user-1', projectId: 'project-1' },
      image('task-1:0', { generationTaskId: 'task-1' }),
    );

    expect(mapping).toEqual({
      assetId: 'asset-task',
      versionId: 'version-task',
      placementId: 'placement-task',
    });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('adopts the exact output index when one task projects multiple versions', async () => {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM wujie_asset_versions')) {
        expect(sql).toContain("metadata->>'outputIndex'");
        expect(params).toEqual(['user-1', 'project-1', 'task-multi', 2]);
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(adoptTaskProjectedCanvasMapping(
      { query } as never,
      { actorUserId: 'user-1', projectId: 'project-1' },
      image('task-multi:2', { generationTaskId: 'task-multi' }),
    )).resolves.toBeNull();
  });

  it('rejects malformed task projection entity ids before querying the graph', async () => {
    const query = vi.fn();

    await expect(adoptTaskProjectedCanvasMapping(
      { query } as never,
      { actorUserId: 'user-1', projectId: 'project-1' },
      image('task-multi:2-extra', { generationTaskId: 'task-multi' }),
    )).resolves.toBeNull();

    expect(query).not.toHaveBeenCalled();
  });

  it('locks a projected task asset before its version and project canvas placement', () => {
    const migrationSource = readFileSync(
      resolve(process.cwd(), 'src/lib/asset-core/legacy-migration.ts'),
      'utf8',
    );
    const adoptionStart = migrationSource.indexOf('export async function adoptTaskProjectedCanvasMapping');
    const adoptionEnd = migrationSource.indexOf('\nexport ', adoptionStart + 1);
    const adoptionSource = migrationSource.slice(adoptionStart, adoptionEnd);
    const assetLock = adoptionSource.indexOf('FOR UPDATE OF asset');
    const versionLock = adoptionSource.indexOf('FOR UPDATE', assetLock + 'FOR UPDATE OF asset'.length);
    const placementLock = adoptionSource.indexOf('FOR UPDATE OF placement');

    expect(adoptionStart).toBeGreaterThan(-1);
    expect(assetLock).toBeGreaterThan(-1);
    expect(versionLock).toBeGreaterThan(-1);
    expect(placementLock).toBeGreaterThan(-1);
    expect(assetLock).toBeLessThan(versionLock);
    expect(versionLock).toBeLessThan(placementLock);
    expect(adoptionSource).toContain("placement.workspace_id IN ($2, 'canvas:' || $2)");
  });

  it('retains unmanaged blob and missing broken-media placements during autosave', () => {
    const serialized = serializeCanvasWorkspacePlacements([
      image('blob-media', { url: 'blob:expired-session-media' }),
      image('missing-media', {
        url: '',
        mediaAvailability: 'missing',
        mediaErrorCode: 'MEDIA_LOAD_FAILED',
      }),
    ]);

    expect(serialized).toHaveLength(2);
    expect(serialized).toEqual([
      expect.objectContaining({
        id: 'blob-media',
        url: 'blob:expired-session-media',
        mediaAvailability: 'missing',
      }),
      expect.objectContaining({
        id: 'missing-media',
        url: '',
        mediaAvailability: 'missing',
        mediaErrorCode: 'MEDIA_LOAD_FAILED',
      }),
    ]);
  });

  it('tombstones whole-project graph state owner-scoped and preserves assets with a live reference', async () => {
    const state = {
      placements: [
        { id: 'placement-deleted-only', ownerId: 'user-1', projectId: 'deleted-project', assetId: 'asset-deleted-only', status: 'active' },
        { id: 'placement-shared-deleted', ownerId: 'user-1', projectId: 'deleted-project', assetId: 'asset-shared', status: 'active' },
        { id: 'placement-shared-live', ownerId: 'user-1', projectId: 'active-project', assetId: 'asset-shared', status: 'active' },
        { id: 'placement-document-shared-live', ownerId: 'user-1', projectId: 'active-project', assetId: 'asset-deleted-document-shared', status: 'active' },
        { id: 'placement-other-owner', ownerId: 'user-2', projectId: 'deleted-project', assetId: 'asset-other-owner', status: 'active' },
      ],
      assets: [
        { id: 'asset-deleted-only', ownerId: 'user-1', projectId: 'deleted-project', status: 'active' },
        { id: 'asset-shared', ownerId: 'user-1', projectId: 'deleted-project', status: 'active' },
        { id: 'asset-deleted-document', ownerId: 'user-1', projectId: 'deleted-project', status: 'active' },
        { id: 'asset-deleted-workflow', ownerId: 'user-1', projectId: 'deleted-project', status: 'active' },
        { id: 'asset-deleted-psd', ownerId: 'user-1', projectId: 'deleted-project', status: 'active' },
        { id: 'asset-deleted-video', ownerId: 'user-1', projectId: 'deleted-project', status: 'active' },
        { id: 'asset-deleted-document-shared', ownerId: 'user-1', projectId: 'deleted-project', status: 'active' },
        { id: 'asset-report-document', ownerId: 'user-1', projectId: 'active-project', status: 'active' },
        { id: 'asset-other-owner', ownerId: 'user-2', projectId: 'deleted-project', status: 'active' },
      ],
      projects: [
        { id: 'deleted-project', ownerId: 'user-1', status: 'active' },
        { id: 'active-project', ownerId: 'user-1', status: 'active' },
        { id: 'deleted-project', ownerId: 'user-2', status: 'active' },
      ],
      versions: ['version-deleted-only', 'version-shared'],
    };
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      const ownerId = String(params[0]);
      const activeIds = new Set((params[1] as string[] | undefined) ?? []);
      if (sql.includes('SELECT id FROM wujie_assets') && sql.includes('FOR UPDATE')) {
        return { rows: state.assets.filter(asset => asset.ownerId === ownerId), rowCount: 2 };
      }
      if (sql.includes('UPDATE wujie_workspace_placements')) {
        for (const placement of state.placements) {
          if (placement.ownerId === ownerId && !activeIds.has(placement.projectId) && placement.status === 'active') {
            placement.status = 'trashed';
          }
        }
        return { rows: [], rowCount: 2 };
      }
      if (sql.includes('UPDATE wujie_assets')) {
        const selectsDeletedProjectAssets = sql.includes('NOT (asset.project_id = ANY($2::text[]))');
        const limitsToCanvasAssets = sql.includes("canvas_placement.workspace_kind = 'canvas'")
          && sql.includes("canvas_placement.entity_type = 'canvas-image'");
        for (const asset of state.assets) {
          const hasLiveReference = state.placements.some((placement) => (
            placement.ownerId === ownerId && placement.assetId === asset.id && placement.status === 'active'
          ));
          const hasCanvasReference = state.placements.some((placement) => (
            placement.ownerId === ownerId && placement.assetId === asset.id
          ));
          if (
            asset.ownerId === ownerId
            && (
              (selectsDeletedProjectAssets && !activeIds.has(asset.projectId))
              || (limitsToCanvasAssets && hasCanvasReference)
            )
            && !hasLiveReference
          ) asset.status = 'trashed';
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_projects')) {
        for (const graphProject of state.projects) {
          if (graphProject.ownerId === ownerId && !activeIds.has(graphProject.id) && graphProject.status === 'active') {
            graphProject.status = 'trashed';
          }
        }
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await reconcileDeletedCanvasProjectsInTransaction(
      { query } as unknown as Parameters<typeof reconcileDeletedCanvasProjectsInTransaction>[0],
      'user-1',
      ['active-project'],
    );

    expect(state.placements.find((item) => item.id === 'placement-deleted-only')?.status).toBe('trashed');
    expect(state.placements.find((item) => item.id === 'placement-other-owner')?.status).toBe('active');
    expect(state.assets.find((item) => item.id === 'asset-deleted-only')?.status).toBe('trashed');
    expect(state.assets.find((item) => item.id === 'asset-shared')?.status).toBe('active');
    expect(state.assets.find((item) => item.id === 'asset-deleted-document')?.status).toBe('trashed');
    expect(state.assets.find((item) => item.id === 'asset-deleted-workflow')?.status).toBe('trashed');
    expect(state.assets.find((item) => item.id === 'asset-deleted-psd')?.status).toBe('trashed');
    expect(state.assets.find((item) => item.id === 'asset-deleted-video')?.status).toBe('trashed');
    expect(state.assets.find((item) => item.id === 'asset-deleted-document-shared')?.status).toBe('active');
    expect(state.assets.find((item) => item.id === 'asset-report-document')?.status).toBe('active');
    expect(state.assets.find((item) => item.id === 'asset-other-owner')?.status).toBe('active');
    expect(state.projects.find((item) => item.ownerId === 'user-1' && item.id === 'deleted-project')?.status).toBe('trashed');
    expect(state.projects.find((item) => item.ownerId === 'user-2' && item.id === 'deleted-project')?.status).toBe('active');
    expect(state.versions).toEqual(['version-deleted-only', 'version-shared']);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('wujie_asset_versions'))).toBe(false);
  });

  it('runs whole-project reconciliation in the same atomic sync transaction', async () => {
    const transactionEvents: string[] = [];
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        transactionEvents.push('begin');
        const result = await callback({
          async writeProjects() {
            transactionEvents.push('write-projects');
          },
          async syncProject(nextProject) {
            transactionEvents.push(`sync:${nextProject.id}`);
            return {
              project: nextProject,
              sourceSchemaVersion: 3,
              migrated: false,
              reused: true,
              mappings: {},
            };
          },
          async reconcileDeletedProjects(activeProjectIds: string[]) {
            transactionEvents.push(`reconcile:${activeProjectIds.join(',')}`);
          },
        } as CanvasProjectSyncTransaction & {
          reconcileDeletedProjects(activeProjectIds: string[]): Promise<void>;
        });
        transactionEvents.push('commit');
        return result;
      },
    };

    await executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [{ ...project([]), id: 'active-project' }],
    }, storage);

    expect(transactionEvents).toEqual([
      'begin',
      'write-projects',
      'sync:active-project',
      'reconcile:active-project',
      'write-projects',
      'commit',
    ]);
  });

  it('skips unchanged 300-node graph reconciliation while retaining complete mappings', async () => {
    const images = Array.from({ length: 300 }, (_, index) => image(`node-${index}`, {
      assetId: `asset-${index}`,
      assetVersionId: `version-${index}`,
      placementId: `placement-${index}`,
      x: 80 + (index % 20) * 132,
      y: 80 + Math.floor(index / 20) * 132,
    }));
    const unchangedProject = project(images);
    const syncProject = vi.fn(async () => {
      throw new Error('unchanged graph must not be reconciled node by node');
    });
    const writeProjects = vi.fn(async () => undefined);
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        return callback({
          claimRevision: async expectedRevision => expectedRevision + 1,
          readProjects: async () => structuredClone([unchangedProject]),
          verifyProjectMappings: async () => true,
          writeProjects,
          syncProject,
          reconcileDeletedProjects: async () => undefined,
        });
      },
    };

    const result = await executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [structuredClone(unchangedProject)],
      expectedRevision: 7,
    }, storage);

    expect(syncProject).not.toHaveBeenCalled();
    expect(writeProjects).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.mappings['project-1'] ?? {})).toHaveLength(300);
    expect(result.mappings['project-1']?.['node-299']).toEqual({
      assetId: 'asset-299',
      versionId: 'version-299',
      placementId: 'placement-299',
    });
  });

  it('adopts an exact managed canvas-video placement for continuous shadow sync', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM wujie_assets asset')) return { rows: [{ id: 'asset-video' }], rowCount: 1 };
      if (sql.includes('FROM wujie_asset_versions')) {
        return { rows: [{ asset_id: 'asset-video', asset_version_id: 'version-video' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_workspace_placements')) {
        return sql.includes("entity_type = 'canvas-video'")
          ? { rows: [{ asset_id: 'asset-video', asset_version_id: 'version-video', placement_id: 'placement-video' }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE wujie_workspace_placements')) {
        expect(sql).toContain("entity_type = 'canvas-video'");
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(legacyMigration.adoptManagedCanvasMapping(
      { query } as never,
      { actorUserId: 'user-1', projectId: 'project-1' },
      image('chat-video', {
        url: '/media/poster.jpg', mediaType: 'video', videoUrl: '/media/final.mp4',
        assetId: 'asset-video', assetVersionId: 'version-video', placementId: 'placement-video',
      }),
    )).resolves.toEqual({
      assetId: 'asset-video', versionId: 'version-video', placementId: 'placement-video',
    });
  });

  it.each(['workspace', 'entity', 'version'] as const)(
    'fails closed when a managed canvas-video has a %s mismatch',
    async (mismatch) => {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('FROM wujie_assets asset')) return { rows: [{ id: 'asset-video' }], rowCount: 1 };
        if (sql.includes('FROM wujie_asset_versions')) {
          return { rows: [{ asset_id: 'asset-video', asset_version_id: 'version-video' }], rowCount: 1 };
        }
        if (sql.includes('FROM wujie_workspace_placements')) return { rows: [], rowCount: 0 };
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      await expect(legacyMigration.adoptManagedCanvasMapping(
        { query } as never,
        { actorUserId: 'user-1', projectId: 'project-1' },
        image(`chat-video-${mismatch}`, {
          mediaType: 'video', videoUrl: '/media/final.mp4', assetId: 'asset-video',
          assetVersionId: 'version-video', placementId: 'placement-video',
        }),
      )).rejects.toMatchObject({ code: 'LEGACY_MIGRATION_INTEGRITY_CONFLICT' });
    },
  );

  it('reconciles unchanged graph data when the project schema version changes', async () => {
    const retained = image('retained', {
      assetId: 'asset-retained',
      assetVersionId: 'version-retained',
      placementId: 'placement-retained',
    });
    const previousProject = { ...project([retained]), schemaVersion: 1 as const };
    const nextProject = { ...project([retained]), schemaVersion: 3 as const };
    const syncProject = vi.fn(async (candidate: Project) => ({
      project: candidate,
      sourceSchemaVersion: 3 as const,
      migrated: false,
      reused: true,
      mappings: {
        retained: {
          assetId: 'asset-retained',
          versionId: 'version-retained',
          placementId: 'placement-retained',
        },
      },
    }));
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        return callback({
          claimRevision: async expectedRevision => expectedRevision + 1,
          readProjects: async () => structuredClone([previousProject]),
          verifyProjectMappings: async () => true,
          writeProjects: async () => undefined,
          syncProject,
          reconcileDeletedProjects: async () => undefined,
        });
      },
    };

    await executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [structuredClone(nextProject)],
      expectedRevision: 13,
    }, storage);

    expect(syncProject).toHaveBeenCalledOnce();
  });

  it('reconciles an unchanged snapshot when the batch graph integrity check fails', async () => {
    const retained = image('retained', {
      assetId: 'asset-retained',
      assetVersionId: 'version-retained',
      placementId: 'placement-retained',
    });
    const unchangedProject = project([retained]);
    const syncProject = vi.fn(async (nextProject: Project) => ({
      project: nextProject,
      sourceSchemaVersion: 3 as const,
      migrated: false,
      reused: true,
      mappings: {
        retained: {
          assetId: 'asset-retained',
          versionId: 'version-retained',
          placementId: 'placement-retained',
        },
      },
    }));
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        return callback({
          claimRevision: async expectedRevision => expectedRevision + 1,
          readProjects: async () => structuredClone([unchangedProject]),
          verifyProjectMappings: async () => false,
          writeProjects: async () => undefined,
          syncProject,
          reconcileDeletedProjects: async () => undefined,
        });
      },
    };

    await executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [structuredClone(unchangedProject)],
      expectedRevision: 11,
    }, storage);

    expect(syncProject).toHaveBeenCalledOnce();
  });

  it('keeps the PostgreSQL fast path gated by the completed checkpoint schema', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/asset-core/canvas-project-sync.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    expect(source).toContain('FROM wujie_asset_migration_checkpoints');
    expect(source).toContain("checkpointRow?.status !== 'completed'");
    expect(source).toContain('checkpointSourceSchemaVersion(checkpointRow.checkpoint) !== (project.schemaVersion ?? 1)');
  });

  it('uses asset-version-placement lock order shared with task projection', () => {
    const migrationSource = readFileSync(
      resolve(process.cwd(), 'src/lib/asset-core/legacy-migration.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const serviceSource = readFileSync(
      resolve(process.cwd(), 'src/lib/asset-core/service.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const updateStart = migrationSource.indexOf('async function updateGraphForImage');
    const updateEnd = migrationSource.indexOf('async function trashGraphForImage', updateStart);
    const updateGraphSource = migrationSource.slice(updateStart, updateEnd);
    const versionLock = updateGraphSource.indexOf('FROM wujie_asset_versions');
    const placementLock = updateGraphSource.indexOf('FROM wujie_workspace_placements');
    const assetMutation = updateGraphSource.indexOf('UPDATE wujie_assets\n     SET kind =');
    const lifecycleStart = serviceSource.indexOf('async trashPlacement(input: PlacementCommand)');
    const lifecycleEnd = serviceSource.indexOf('async restorePlacement(input: PlacementCommand)', lifecycleStart);
    const lifecycleSource = serviceSource.slice(lifecycleStart, lifecycleEnd);

    expect(updateStart).toBeGreaterThan(-1);
    expect(versionLock).toBeGreaterThan(-1);
    expect(placementLock).toBeGreaterThan(-1);
    expect(assetMutation).toBeGreaterThan(placementLock);
    expect(updateGraphSource).toMatch(
      /SELECT asset_id, asset_version_id, owner_id, project_id[\s\S]*WHERE id = \$1[\s\S]*FOR UPDATE/,
    );
    expect(updateGraphSource).toContain('placementRow.asset_id !== mapping.assetId');
    expect(updateGraphSource).toContain('placementRow.asset_version_id !== mapping.versionId');
    expect(updateGraphSource).toContain('placementRow.owner_id !== input.actorUserId');
    expect(updateGraphSource).toContain('placementRow.project_id !== input.projectId');
    expect(lifecycleSource.indexOf('transaction.lockAsset(')).toBeLessThan(
      lifecycleSource.indexOf('transaction.lockPlacement('),
    );
    expect(updateGraphSource.indexOf('FROM wujie_assets')).toBeLessThan(placementLock);
    expect(versionLock).toBeLessThan(placementLock);
  });

  it('locks the completed project asset set before adoption can lock versions or placements', () => {
    const migrationSource = readFileSync(
      resolve(process.cwd(), 'src/lib/asset-core/legacy-migration.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const migrationStart = migrationSource.indexOf('async function existingCompletedMigration');
    const migrationEnd = migrationSource.indexOf('async function insertGraphForImage', migrationStart);
    const completedSource = migrationSource.slice(migrationStart, migrationEnd);
    const projectAssetLock = completedSource.indexOf('await lockProjectAssetsForReconciliation');
    const firstGraphMutation = completedSource.indexOf('for (const { image, mapping } of plan.updates)');

    expect(projectAssetLock).toBeGreaterThan(-1);
    expect(firstGraphMutation).toBeGreaterThan(-1);
    expect(projectAssetLock).toBeLessThan(firstGraphMutation);
  });

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
    expect(plan.removals).toEqual([{ imageId: 'removed', mapping: previousMappings.removed }]);
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

  it('reuses the current version when a canvas snapshot omits server-only file metadata', () => {
    const mapping = { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' };
    const currentFile: AssetFile = {
      url: '/api/serve-upload/uploads/original.png',
      availability: 'ready',
      storageKey: 'uploads/original.png',
      checksum: 'sha256:original',
      mimeType: 'image/png',
      byteSize: 1234,
      width: 64,
      height: 64,
    };

    expect(legacyMigration.planCanvasAssetVersionUpdate({
      actorUserId: 'user-1',
      projectId: 'project-1',
      imageId: 'retained',
      mapping,
      currentFile,
      nextFile: {
        url: currentFile.url,
        availability: 'ready',
        width: 64,
        height: 64,
      },
    })).toEqual({ action: 'reuse', mapping, parentVersionIds: [] });
  });

  it('repairs an incomplete mapped version append-only and switches every graph pointer', async () => {
    const previousMapping = {
      assetId: 'asset-a',
      versionId: 'version-old',
      placementId: 'placement-a',
    };
    const rawProject = project([image('retained', {
      url: '/api/serve-upload/uploads/original.png',
      originalWidth: 2,
      originalHeight: 2,
    })]);
    const oldVersion = {
      id: 'version-old',
      file_url: '/api/serve-upload/uploads/original.png',
      storage_key: 'original-key',
      checksum: 'old-checksum',
      mime_type: null,
      byte_size: null,
      width: 2,
      height: 2,
      availability: 'ready' as const,
      recovery_source_url: 'https://recovery.test/original.png',
      metadata: { immutable: 'old-version-metadata' },
    };
    const originalVersionSnapshot = structuredClone(oldVersion);
    const state: {
      childVersion?: {
        id: string;
        assetId: string;
        fileUrl: string;
        mimeType: unknown;
        byteSize: unknown;
        metadata: unknown;
      };
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
      if (sql.includes('SELECT asset.id AS locked_asset_id')) {
        return { rows: [{ locked_asset_id: 'asset-a' }], rowCount: 1 };
      }
      if (sql.includes('SELECT asset_id') && sql.includes('FROM wujie_workspace_placements')) {
        return {
          rows: [{
            asset_id: 'asset-a', asset_version_id: 'version-old', owner_id: 'user-1', project_id: 'project-1',
            workspace_kind: 'canvas', workspace_id: 'project-1', entity_type: 'canvas-image', entity_id: 'retained',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT id, owner_id, project_id') && sql.includes('FROM wujie_assets')) {
        return {
          rows: [{
            id: 'asset-a',
            owner_id: 'user-1',
            project_id: 'project-1',
            current_version_id: 'version-old',
          }],
          rowCount: 1,
        };
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
          mimeType: params[7],
          byteSize: params[8],
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
      if (sql.includes('SELECT asset.id') && sql.includes("entity_type = 'canvas-image'")) {
        return { rows: [{ id: 'asset-a' }], rowCount: 1 };
      }
      if (sql.includes('SELECT id, asset_id') && sql.includes("entity_type = 'canvas-image'")) {
        return { rows: [{ id: 'placement-a', asset_id: 'asset-a' }], rowCount: 1 };
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
      verifiedMediaByImageId: {
        retained: {
          url: '/api/serve-upload/uploads/original.png',
          mimeType: 'image/png',
          byteSize: 72,
          width: 2,
          height: 2,
        },
      },
    });

    expect(oldVersion).toEqual(originalVersionSnapshot);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE wujie_asset_versions'))).toBe(false);
    expect(state.childVersion).toMatchObject({
      assetId: 'asset-a',
      fileUrl: '/api/serve-upload/uploads/original.png',
      mimeType: 'image/png',
      byteSize: 72,
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

  it('tombstones active canvas placements missing from both the checkpoint and current project snapshot', async () => {
    const mapping = { assetId: 'asset-current', versionId: 'version-current', placementId: 'placement-current' };
    const rawProject = project([image('current')]);
    const state = {
      placements: [
        { id: 'placement-current', assetId: 'asset-current', status: 'active' },
        { id: 'placement-stale', assetId: 'asset-stale', status: 'active' },
      ],
      assets: [
        { id: 'asset-current', status: 'active' },
        { id: 'asset-stale', status: 'active' },
      ],
    };
    const sqlLog: string[] = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      sqlLog.push(sql);
      if (sql.includes('SELECT legacy.value AS legacy_project')) {
        return { rows: [{ legacy_project: rawProject }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_asset_migration_checkpoints') && sql.includes('SELECT status')) {
        return {
          rows: [{
            status: 'completed',
            checkpoint: { sourceSchemaVersion: 1, legacyImageMappings: { current: mapping } },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT schema_version, metadata') && sql.includes('FROM wujie_projects')) {
        return { rows: [{ schema_version: 3, metadata: {}, status: 'active' }], rowCount: 1 };
      }
      if (sql.includes('SELECT asset.id AS locked_asset_id')) {
        return { rows: [{ locked_asset_id: 'asset-current' }, { locked_asset_id: 'asset-stale' }], rowCount: 2 };
      }
      if (sql.includes('SELECT id, owner_id, project_id') && sql.includes('FROM wujie_assets')) {
        return {
          rows: [{
            id: 'asset-current', owner_id: 'user-1', project_id: 'project-1',
            current_version_id: 'version-current',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM wujie_asset_versions') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            file_url: '/media/current.png', storage_key: null, checksum: null, mime_type: null,
            byte_size: null, width: 600, height: 400, availability: 'ready', recovery_source_url: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT asset_id, asset_version_id') && sql.includes('FROM wujie_workspace_placements')) {
        return {
          rows: [{
            asset_id: 'asset-current', asset_version_id: 'version-current', owner_id: 'user-1', project_id: 'project-1',
            workspace_kind: 'canvas', workspace_id: 'project-1', entity_type: 'canvas-image', entity_id: 'current',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('UPDATE wujie_assets') && sql.includes('SET kind =')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_workspace_placements') && sql.includes('SET asset_version_id')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT asset.id') && sql.includes("entity_type = 'canvas-image'")) {
        return {
          rows: state.assets
            .filter(asset => asset.status === 'active')
            .map(asset => ({ id: asset.id })),
          rowCount: state.assets.filter(asset => asset.status === 'active').length,
        };
      }
      if (sql.includes('SELECT id, asset_id') && sql.includes("entity_type = 'canvas-image'")) {
        return {
          rows: state.placements
            .filter(placement => placement.status === 'active')
            .map(placement => ({ id: placement.id, asset_id: placement.assetId })),
          rowCount: state.placements.filter(placement => placement.status === 'active').length,
        };
      }
      if (sql.includes('UPDATE wujie_workspace_placements') && sql.includes('id = ANY')) {
        const stalePlacementIds = new Set(params[2] as string[]);
        for (const placement of state.placements) {
          if (stalePlacementIds.has(placement.id) && placement.status === 'active') placement.status = 'trashed';
        }
        return { rows: [], rowCount: stalePlacementIds.size };
      }
      if (sql.includes('UPDATE wujie_assets asset') && sql.includes('id = ANY')) {
        const staleAssetIds = new Set(params[2] as string[]);
        for (const asset of state.assets) {
          const hasActivePlacement = state.placements.some(placement => (
            placement.assetId === asset.id && placement.status === 'active'
          ));
          if (staleAssetIds.has(asset.id) && !hasActivePlacement) asset.status = 'trashed';
        }
        return { rows: [], rowCount: staleAssetIds.size };
      }
      if (sql.includes('UPDATE wujie_asset_migration_checkpoints')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE wujie_projects SET name')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query } as unknown as Parameters<typeof legacyMigration.migrateLegacyProjectOnWriteInTransaction>[0];

    await legacyMigration.migrateLegacyProjectOnWriteInTransaction(client, {
      actorUserId: 'user-1',
      projectId: 'project-1',
    });

    expect(state.placements).toEqual([
      { id: 'placement-current', assetId: 'asset-current', status: 'active' },
      { id: 'placement-stale', assetId: 'asset-stale', status: 'trashed' },
    ]);
    expect(state.assets).toEqual([
      { id: 'asset-current', status: 'active' },
      { id: 'asset-stale', status: 'trashed' },
    ]);
    expect(sqlLog.some(sql => /^\s*DELETE\s/i.test(sql))).toBe(false);
    expect(sqlLog.some(sql => /(UPDATE|DELETE FROM) wujie_asset_versions/.test(sql))).toBe(false);
  });

  it('fails closed when a removed checkpoint mapping aliases a workflow placement', async () => {
    const mapping = { assetId: 'asset-shared', versionId: 'version-shared', placementId: 'placement-collision' };
    const state = { placementStatus: 'active', assetStatus: 'active' };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT legacy.value AS legacy_project')) {
        return { rows: [{ legacy_project: project([]) }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_asset_migration_checkpoints') && sql.includes('SELECT status')) {
        return {
          rows: [{
            status: 'completed',
            checkpoint: { sourceSchemaVersion: 1, legacyImageMappings: { removed: mapping } },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT schema_version, metadata') && sql.includes('FROM wujie_projects')) {
        return { rows: [{ schema_version: 3, metadata: {}, status: 'active' }], rowCount: 1 };
      }
      if (sql.includes('SELECT asset.id AS locked_asset_id')) {
        return { rows: [{ locked_asset_id: 'asset-shared' }], rowCount: 1 };
      }
      if (sql.includes('SELECT id FROM wujie_assets') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'asset-shared' }], rowCount: 1 };
      }
      if (sql.includes('SELECT asset_id') && sql.includes('FROM wujie_workspace_placements')) {
        return {
          rows: [{
            asset_id: 'asset-shared',
            workspace_kind: 'workflow',
            workspace_id: 'project-1',
            entity_type: 'workflow-input',
            entity_id: 'workflow-node-1',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('UPDATE wujie_workspace_placements')) {
        state.placementStatus = 'trashed';
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_assets asset')) {
        state.assetStatus = 'trashed';
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT asset.id') && sql.includes("entity_type = 'canvas-image'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT id, asset_id') && sql.includes("entity_type = 'canvas-image'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE wujie_asset_migration_checkpoints')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE wujie_projects SET name')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query } as unknown as Parameters<typeof legacyMigration.migrateLegacyProjectOnWriteInTransaction>[0];

    await expect(legacyMigration.migrateLegacyProjectOnWriteInTransaction(client, {
      actorUserId: 'user-1',
      projectId: 'project-1',
    })).rejects.toMatchObject({ code: 'LEGACY_MIGRATION_INTEGRITY_CONFLICT' });
    expect(state).toEqual({ placementStatus: 'active', assetStatus: 'active' });
  });

  it('recreates only a missing placement after placement and asset locks', async () => {
    const mapping = { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' };
    const rawProject = project([image('retained')]);
    const sqlOrder: string[] = [];
    const query = vi.fn(async (sql: string) => {
      sqlOrder.push(sql);
      if (sql.includes('SELECT legacy.value AS legacy_project')) return { rows: [{ legacy_project: rawProject }], rowCount: 1 };
      if (sql.includes('FROM wujie_asset_migration_checkpoints') && sql.includes('SELECT status')) {
        return { rows: [{ status: 'completed', checkpoint: { sourceSchemaVersion: 1, legacyImageMappings: { retained: mapping } } }], rowCount: 1 };
      }
      if (sql.includes('SELECT schema_version, metadata')) return { rows: [{ schema_version: 3, metadata: {} }], rowCount: 1 };
      if (sql.includes('FROM wujie_workspace_placements') && sql.includes('FOR UPDATE')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM wujie_assets') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'asset-a', owner_id: 'user-1', project_id: 'project-1' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_asset_versions') && sql.includes('FOR UPDATE')) {
        return { rows: [{
          file_url: '/media/retained.png', storage_key: null, checksum: null, mime_type: null,
          byte_size: null, width: 600, height: 400, availability: 'ready', recovery_source_url: null,
        }], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_assets') && sql.includes('SET kind =')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO wujie_workspace_placements')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE wujie_asset_migration_checkpoints')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE wujie_projects SET name')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query } as unknown as Parameters<typeof legacyMigration.migrateLegacyProjectOnWriteInTransaction>[0];

    const result = await legacyMigration.migrateLegacyProjectOnWriteInTransaction(client, {
      actorUserId: 'user-1',
      projectId: 'project-1',
    });

    expect(result.mappings.retained).toEqual(mapping);
    expect(sqlOrder.findIndex((sql) => sql.includes('FROM wujie_assets') && sql.includes('FOR UPDATE'))).toBeLessThan(
      sqlOrder.findIndex((sql) => sql.includes('FROM wujie_workspace_placements')),
    );
    expect(sqlOrder.some((sql) => sql.includes('INSERT INTO wujie_assets'))).toBe(false);
    expect(sqlOrder.some((sql) => sql.includes('INSERT INTO wujie_asset_versions'))).toBe(false);
    expect(sqlOrder.filter((sql) => sql.includes('INSERT INTO wujie_workspace_placements'))).toHaveLength(1);
  });

  it('rejects a checkpoint placement that belongs to another asset or ownership scope', async () => {
    const mapping = { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT legacy.value AS legacy_project')) return { rows: [{ legacy_project: project([image('retained')]) }], rowCount: 1 };
      if (sql.includes('FROM wujie_asset_migration_checkpoints') && sql.includes('SELECT status')) {
        return { rows: [{ status: 'completed', checkpoint: { sourceSchemaVersion: 1, legacyImageMappings: { retained: mapping } } }], rowCount: 1 };
      }
      if (sql.includes('SELECT schema_version, metadata')) return { rows: [{ schema_version: 3, metadata: {} }], rowCount: 1 };
      if (sql.includes('FROM wujie_assets') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'asset-a', owner_id: 'user-1', project_id: 'project-1' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_asset_versions') && sql.includes('FOR UPDATE')) {
        return { rows: [{
          file_url: '/media/retained.png', storage_key: null, checksum: null, mime_type: null,
          byte_size: null, width: 600, height: 400, availability: 'ready', recovery_source_url: null,
        }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_workspace_placements') && sql.includes('FOR UPDATE')) {
        return { rows: [{ asset_id: 'asset-other', owner_id: 'user-other', project_id: 'project-other' }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query } as unknown as Parameters<typeof legacyMigration.migrateLegacyProjectOnWriteInTransaction>[0];

    await expect(legacyMigration.migrateLegacyProjectOnWriteInTransaction(client, {
      actorUserId: 'user-1',
      projectId: 'project-1',
    })).rejects.toMatchObject({ code: 'LEGACY_MIGRATION_INTEGRITY_CONFLICT' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE wujie_assets'))).toBe(false);
  });

  it('restores a tombstoned same-ID project from its completed checkpoint without replacing graph identities', async () => {
    const mapping = { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' };
    const rawProject = project([image('retained')]);
    const state = {
      projectStatus: 'active',
      placementStatus: 'active',
      assetStatus: 'active',
      versionIds: ['version-a'],
    };
    const sqlLog: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      sqlLog.push({ sql, params });
      if (sql.includes('SELECT id FROM wujie_assets') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'asset-a' }], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_workspace_placements') && sql.includes('NOT (project_id = ANY')) {
        state.placementStatus = 'trashed';
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_assets asset') && sql.includes('NOT (asset.project_id = ANY')) {
        state.assetStatus = 'trashed';
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_projects') && sql.includes('NOT (id = ANY')) {
        state.projectStatus = 'trashed';
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT legacy.value AS legacy_project')) {
        return { rows: [{ legacy_project: rawProject }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_asset_migration_checkpoints') && sql.includes('SELECT status')) {
        return {
          rows: [{
            status: 'completed',
            checkpoint: { sourceSchemaVersion: 1, legacyImageMappings: { retained: mapping } },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT schema_version, metadata') && sql.includes('FROM wujie_projects')) {
        if (sql.includes("status = 'active'") && state.projectStatus !== 'active') {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [{ schema_version: 3, metadata: {}, status: state.projectStatus }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT asset.id AS locked_asset_id')) {
        return { rows: [{ locked_asset_id: 'asset-a' }], rowCount: 1 };
      }
      if (sql.includes('SELECT asset_id') && sql.includes('FROM wujie_workspace_placements')) {
        return {
          rows: [{
            asset_id: 'asset-a', asset_version_id: 'version-a', owner_id: 'user-1', project_id: 'project-1',
            workspace_kind: 'canvas', workspace_id: 'project-1', entity_type: 'canvas-image', entity_id: 'retained',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT id, owner_id, project_id') && sql.includes('FROM wujie_assets')) {
        return {
          rows: [{
            id: 'asset-a', owner_id: 'user-1', project_id: 'project-1', current_version_id: 'version-a',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('UPDATE wujie_assets') && sql.includes("SET kind = $4, status = 'active'")) {
        expect(params.slice(0, 3)).toEqual(['asset-a', 'user-1', 'project-1']);
        state.assetStatus = 'active';
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_asset_versions') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            file_url: '/media/retained.png',
            storage_key: null,
            checksum: null,
            mime_type: null,
            byte_size: null,
            width: 600,
            height: 400,
            availability: 'ready',
            recovery_source_url: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('UPDATE wujie_workspace_placements') && sql.includes("status = 'active'")) {
        expect(params.slice(0, 3)).toEqual(['placement-a', 'user-1', 'project-1']);
        state.placementStatus = 'active';
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT asset.id') && sql.includes("entity_type = 'canvas-image'")) {
        return { rows: [{ id: 'asset-a' }], rowCount: 1 };
      }
      if (sql.includes('SELECT id, asset_id') && sql.includes("entity_type = 'canvas-image'")) {
        return { rows: [{ id: 'placement-a', asset_id: 'asset-a' }], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_asset_migration_checkpoints')) {
        expect(params.slice(0, 3)).toEqual(['user-1', 'project-1', 'project-1']);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_projects SET name')) {
        expect(params.slice(0, 2)).toEqual(['user-1', 'project-1']);
        state.projectStatus = 'active';
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query } as unknown as Parameters<typeof legacyMigration.migrateLegacyProjectOnWriteInTransaction>[0];

    await reconcileDeletedCanvasProjectsInTransaction(client, 'user-1', []);
    expect(state).toMatchObject({
      projectStatus: 'trashed',
      placementStatus: 'trashed',
      assetStatus: 'trashed',
    });

    const restored = await legacyMigration.migrateLegacyProjectOnWriteInTransaction(client, {
      actorUserId: 'user-1',
      projectId: 'project-1',
    });

    expect(restored).toMatchObject({
      migrated: false,
      reused: true,
      mappings: { retained: mapping },
    });
    expect(state).toEqual({
      projectStatus: 'active',
      placementStatus: 'active',
      assetStatus: 'active',
      versionIds: ['version-a'],
    });
    expect(sqlLog.some(({ sql }) => /INSERT INTO wujie_(projects|assets|workspace_placements|asset_versions)/.test(sql))).toBe(false);
    expect(sqlLog.some(({ sql }) => /(UPDATE|DELETE FROM) wujie_asset_versions/.test(sql))).toBe(false);
    expect(sqlLog.some(({ sql }) => /^\s*DELETE\s/i.test(sql))).toBe(false);
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

  it('resolves controlled canvas image metadata before opening the database transaction', async () => {
    const verified = {
      url: '/api/serve-upload/uploads/uploaded.png',
      mimeType: 'image/png',
      byteSize: 72,
      width: 2,
      height: 2,
    };
    let transactionStarted = false;
    let receivedMedia: Record<string, typeof verified> | undefined;
    const inspectManagedMedia = vi.fn(async (input: { url: string; kind: 'image' | 'video' }) => {
      expect(transactionStarted).toBe(false);
      expect(input).toEqual({ url: verified.url, kind: 'image' });
      return verified;
    });
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        transactionStarted = true;
        return callback({
          async writeProjects() {},
          async syncProject(nextProject: Project, media?: Record<string, typeof verified>) {
            receivedMedia = media;
            return {
              project: nextProject,
              sourceSchemaVersion: 3,
              migrated: false,
              reused: true,
              mappings: {
                uploaded: { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' },
              },
            };
          },
        } as CanvasProjectSyncTransaction);
      },
    };

    await executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [project([{
        ...image('uploaded', {
          url: verified.url,
          originalWidth: 2,
          originalHeight: 2,
          assetId: 'asset-a',
          assetVersionId: 'version-a',
          placementId: 'placement-a',
        }),
        mediaMetadataUrl: verified.url,
        mediaMimeType: 'image/png',
        mediaByteSize: 72,
      } as CanvasImage])],
      inspectManagedMedia,
    } as Parameters<typeof executeCanvasProjectSync>[0] & {
      inspectManagedMedia: typeof inspectManagedMedia;
    }, storage);

    expect(inspectManagedMedia).toHaveBeenCalledOnce();
    expect(receivedMedia).toEqual({ uploaded: verified });
  });

  it('reuses verified persistence metadata without reading the managed file twice', async () => {
    const verified = {
      url: '/api/serve-upload/uploads/persisted.png',
      mimeType: 'image/png',
      byteSize: 72,
      width: 2,
      height: 2,
    };
    const persistMedia = vi.fn().mockResolvedValue(verified);
    const inspectManagedMedia = vi.fn();
    let receivedMedia: Record<string, typeof verified> | undefined;
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        return callback({
          async writeProjects() {},
          async syncProject(nextProject: Project, media?: Record<string, typeof verified>) {
            receivedMedia = media;
            return {
              project: nextProject,
              sourceSchemaVersion: 3,
              migrated: false,
              reused: true,
              mappings: {
                uploaded: { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' },
              },
            };
          },
        } as CanvasProjectSyncTransaction);
      },
    };

    await executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [project([image('uploaded', { url: 'data:image/png;base64,AAAA' })])],
      persistMedia,
      inspectManagedMedia,
    } as Parameters<typeof executeCanvasProjectSync>[0], storage);

    expect(inspectManagedMedia).not.toHaveBeenCalled();
    expect(receivedMedia).toEqual({ uploaded: verified });
  });

  it('fails closed when managed media changes after preflight verification', async () => {
    const rawProject = project([image('uploaded', {
      url: '/api/serve-upload/uploads/new.png',
      originalWidth: 2,
      originalHeight: 2,
    })]);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT legacy.value AS legacy_project')) {
        return { rows: [{ legacy_project: rawProject }], rowCount: 1 };
      }
      if (sql.includes('SELECT status, checkpoint')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT schema_version, metadata')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const client = { query } as unknown as Parameters<
      typeof legacyMigration.migrateLegacyProjectOnWriteInTransaction
    >[0];

    await expect(legacyMigration.migrateLegacyProjectOnWriteInTransaction(client, {
      actorUserId: 'user-1',
      projectId: 'project-1',
      verifiedMediaByImageId: {
        uploaded: {
          url: '/api/serve-upload/uploads/old.png',
          mimeType: 'image/png',
          byteSize: 72,
        },
      },
    })).rejects.toMatchObject({ code: 'LEGACY_MEDIA_PERSIST_FAILED' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO wujie_asset_versions'))).toBe(false);
  });

  it('allows non-ready controlled media to remain fail-closed without blocking migration', async () => {
    const rawProject = project([image('missing', {
      url: '/api/serve-upload/uploads/missing.png',
      mediaAvailability: 'missing',
      mediaErrorCode: 'MEDIA_LOAD_FAILED',
    })]);
    const inspectManagedMedia = vi.fn();
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [{ legacy_project: rawProject }], rowCount: 1 }),
    };

    await expect(legacyMigration.prepareVerifiedLegacyProjectMedia({
      actorUserId: 'user-1',
      projectId: 'project-1',
      inspectManagedMedia,
    }, database as never)).resolves.toEqual({});
    expect(inspectManagedMedia).not.toHaveBeenCalled();

    const transactionQuery = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT legacy.value AS legacy_project')) {
        return { rows: [{ legacy_project: rawProject }], rowCount: 1 };
      }
      if (sql.includes('SELECT status, checkpoint')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT schema_version, metadata')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const client = { query: transactionQuery } as unknown as Parameters<
      typeof legacyMigration.migrateLegacyProjectOnWriteInTransaction
    >[0];

    await expect(legacyMigration.migrateLegacyProjectOnWriteInTransaction(client, {
      actorUserId: 'user-1',
      projectId: 'project-1',
    })).resolves.toMatchObject({ migrated: true });
  });

  it('writes verified controlled image metadata into the immutable asset version', async () => {
    const verified = {
      url: '/api/serve-upload/uploads/uploaded.png',
      mimeType: 'image/png',
      byteSize: 72,
      width: 2,
      height: 2,
    };
    const rawProject = project([image('uploaded', {
      url: verified.url,
      originalWidth: 2,
      originalHeight: 2,
    })]);
    let versionFile: {
      url: unknown;
      mimeType: unknown;
      byteSize: unknown;
      width: unknown;
      height: unknown;
    } | undefined;
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT legacy.value AS legacy_project')) {
        return { rows: [{ legacy_project: rawProject }], rowCount: 1 };
      }
      if (sql.includes('SELECT status, checkpoint')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT schema_version, metadata')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO wujie_asset_versions')) {
        versionFile = {
          url: params[4],
          mimeType: params[7],
          byteSize: params[8],
          width: params[9],
          height: params[10],
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const client = { query } as unknown as Parameters<
      typeof legacyMigration.migrateLegacyProjectOnWriteInTransaction
    >[0];

    await legacyMigration.migrateLegacyProjectOnWriteInTransaction(client, {
      actorUserId: 'user-1',
      projectId: 'project-1',
      verifiedMediaByImageId: { uploaded: verified },
    } as Parameters<typeof legacyMigration.migrateLegacyProjectOnWriteInTransaction>[1] & {
      verifiedMediaByImageId: Record<string, typeof verified>;
    });

    expect(versionFile).toEqual({
      url: verified.url,
      mimeType: 'image/png',
      byteSize: 72,
      width: 2,
      height: 2,
    });
  });

  it('rejects an older pre-transaction sync after a newer deletion commits', async () => {
    const originalProject = project([image('retained', { url: 'data:image/png;base64,AAAA' })]);
    const deletedProject = project([]);
    const state = {
      revision: 0,
      projects: [originalProject],
      activeImageIds: ['retained'],
    };
    let releaseOldPersistence!: () => void;
    const oldPersistenceGate = new Promise<void>((resolve) => {
      releaseOldPersistence = resolve;
    });
    let markOldPersistenceStarted!: () => void;
    const oldPersistenceStarted = new Promise<void>((resolve) => {
      markOldPersistenceStarted = resolve;
    });

    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        const draft = structuredClone(state);
        const transaction = {
          async claimRevision(expectedRevision: number): Promise<number> {
            if (expectedRevision !== state.revision) {
              throw Object.assign(new Error('stale canvas project revision'), {
                code: 'CANVAS_PROJECT_SYNC_CONFLICT',
                currentRevision: state.revision,
              });
            }
            draft.revision = expectedRevision + 1;
            return draft.revision;
          },
          async writeProjects(projects: Project[]): Promise<void> {
            draft.projects = structuredClone(projects);
          },
          async syncProject(nextProject: Project) {
            draft.activeImageIds = nextProject.canvasImages.map((item) => item.id);
            return {
              project: nextProject,
              sourceSchemaVersion: 3,
              migrated: false,
              reused: true,
              mappings: Object.fromEntries(nextProject.canvasImages.map((item) => [item.id, {
                assetId: `asset-${item.id}`,
                versionId: `version-${item.id}`,
                placementId: `placement-${item.id}`,
              }])),
            };
          },
        } satisfies CanvasProjectSyncTransaction;

        const result = await callback(transaction);
        state.revision = draft.revision;
        state.projects = draft.projects;
        state.activeImageIds = draft.activeImageIds;
        return result;
      },
    };

    const olderSync = executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [originalProject],
      expectedRevision: 0,
      persistMedia: async ({ dataUrl }) => {
        markOldPersistenceStarted();
        await oldPersistenceGate;
        return { url: `/media/persisted-${dataUrl.slice(-4).toLowerCase()}.png` };
      },
    }, storage);

    await oldPersistenceStarted;
    const newerSync = await executeCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [deletedProject],
      expectedRevision: 0,
      persistMedia: async ({ dataUrl }) => ({ url: dataUrl }),
    }, storage);
    releaseOldPersistence();

    await expect(olderSync).rejects.toMatchObject({
      code: 'CANVAS_PROJECT_SYNC_CONFLICT',
      currentRevision: 1,
    });
    expect(newerSync).toMatchObject({ revision: 1 });
    expect(state.revision).toBe(1);
    expect(state.projects[0]?.canvasImages).toEqual([]);
    expect(state.activeImageIds).toEqual([]);
  });

  it('claims a revision and writes a legacy snapshot without touching asset graph records', async () => {
    const writeProjects = vi.fn(async () => undefined);
    const syncProject = vi.fn();
    const reconcileDeletedProjects = vi.fn();
    const storage: CanvasProjectSyncStorage = {
      async transaction(callback) {
        return callback({
          claimRevision: async expectedRevision => expectedRevision + 1,
          writeProjects,
          syncProject,
          reconcileDeletedProjects,
        });
      },
    };

    const result = await executeLegacyCanvasProjectSync({
      actorUserId: 'user-1',
      projects: [project([image('legacy')])],
      expectedRevision: 8,
    }, storage);

    expect(result).toMatchObject({ revision: 9, mappings: {} });
    expect(writeProjects).toHaveBeenCalledOnce();
    expect(syncProject).not.toHaveBeenCalled();
    expect(reconcileDeletedProjects).not.toHaveBeenCalled();
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
        kind: 'image',
        fileUrl: '',
        thumbnailUrl: '/media/thumbnails/version-graph/512.webp',
        availability: 'missing',
        recoverySourceUrl: 'https://recovery.test/graph-image.png',
        transform: { x: 44, y: 55, width: 640, height: 480, rotation: 12, zIndex: 7 },
        metadata: {
          legacyImage: image('graph-image', {
            thumbnailUrl: '/media/thumbnails/legacy.webp',
          }),
        },
      }],
    });

    expect(hydrated.canvasImages).toEqual([
      expect.objectContaining({
        id: 'graph-image',
        url: '',
        thumbnailUrl: '/media/thumbnails/version-graph/512.webp',
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

  it('keeps the legacy thumbnail when the asset graph has no ready thumbnail variant', () => {
    const [hydrated] = hydrateAssetV3Projects([
      project([image('graph-image', { thumbnailUrl: '/media/thumbnails/legacy.webp' })]),
    ], {
      'project-1': [{
        entityId: 'graph-image',
        assetId: 'asset-graph',
        assetVersionId: 'version-graph',
        placementId: 'placement-graph',
        kind: 'image',
        fileUrl: '/media/graph-image.png',
        availability: 'ready',
        transform: { x: 10, y: 20, width: 300, height: 200 },
        metadata: {},
      }],
    });

    expect(hydrated.canvasImages[0].thumbnailUrl).toBe('/media/thumbnails/legacy.webp');
  });

  it('hydrates authoritative source trace from asset-v3 placement metadata', () => {
    const sourceTrace = {
      source: 'canvas-skill' as const, runId: 'run-1', skillId: 'skill-000000000000000000000001',
      skillVersion: 2, sourceVersionIds: ['source-version-1'], createdAt: '2026-09-02T00:00:00.000Z',
    };
    const [hydrated] = hydrateAssetV3Projects([project([image('graph-image', {
      sourceTrace: { ...sourceTrace, runId: 'stale-run' },
    })])], {
      'project-1': [{
        entityId: 'graph-image', assetId: 'asset-graph', assetVersionId: 'version-graph',
        placementId: 'placement-graph', kind: 'image', fileUrl: '/media/graph-image.png',
        availability: 'ready', transform: { x: 10, y: 20, width: 300, height: 200 },
        metadata: { sourceTrace },
      }],
    });

    expect(hydrated.canvasImages[0].sourceTrace).toEqual(sourceTrace);
    expect(Object.isFrozen(hydrated.canvasImages[0].sourceTrace)).toBe(true);
  });

  it('hydrates an asset-v3 video with separate playable and poster URLs', () => {
    const [hydrated] = hydrateAssetV3Projects([project([])], {
      'project-1': [{
        entityId: 'graph-video',
        assetId: 'asset-video',
        assetVersionId: 'version-video',
        placementId: 'placement-video',
        kind: 'video',
        fileUrl: '/media/video/result.mp4',
        thumbnailUrl: '/media/video/poster.jpg',
        availability: 'ready',
        transform: { x: 10, y: 20, width: 640, height: 360 },
        metadata: {},
      }],
    });

    expect(hydrated.canvasImages[0]).toEqual(expect.objectContaining({
      mediaType: 'video',
      videoUrl: '/media/video/result.mp4',
      videoThumbnailUrl: '/media/video/poster.jpg',
      url: '/media/video/poster.jpg',
      mediaAvailability: 'ready',
    }));
  });

  it('keeps a posterless asset-v3 video ready without treating the MP4 as an image', () => {
    const [hydrated] = hydrateAssetV3Projects([project([])], {
      'project-1': [{
        entityId: 'graph-video',
        assetId: 'asset-video',
        assetVersionId: 'version-video',
        placementId: 'placement-video',
        kind: 'video',
        fileUrl: '/media/video/result.mp4',
        availability: 'ready',
        transform: { x: 10, y: 20, width: 640, height: 360 },
        metadata: {},
      }],
    });

    expect(hydrated.canvasImages[0]).toEqual(expect.objectContaining({
      mediaType: 'video',
      videoUrl: '/media/video/result.mp4',
      url: '',
      mediaAvailability: 'ready',
    }));
  });

  it('reads the asset kind when hydrating graph placements', () => {
    const syncSource = readFileSync(
      resolve(process.cwd(), 'src/lib/asset-core/canvas-project-sync.ts'),
      'utf8',
    );

    expect(syncSource).toContain('asset.kind AS asset_kind');
    expect(syncSource).toContain('JOIN wujie_assets asset');
    expect(syncSource).toContain('kind: row.asset_kind');
  });

  it('stores the playable video URL during legacy graph migration instead of its poster', () => {
    const selectLegacyCanvasMediaUrl = (
      legacyMigration as typeof legacyMigration & {
        selectLegacyCanvasMediaUrl?: (candidate: CanvasImage) => string;
      }
    ).selectLegacyCanvasMediaUrl;
    const migrationSource = readFileSync(
      resolve(process.cwd(), 'src/lib/asset-core/legacy-migration.ts'),
      'utf8',
    );
    const fileStart = migrationSource.indexOf('async function fileForImage');
    const fileEnd = migrationSource.indexOf('function readCompletedProject', fileStart);
    const fileSource = migrationSource.slice(fileStart, fileEnd);

    expect(selectLegacyCanvasMediaUrl).toBeTypeOf('function');
    if (!selectLegacyCanvasMediaUrl) return;
    expect(selectLegacyCanvasMediaUrl(image('legacy-video', {
      url: '/media/video/poster.jpg',
      videoUrl: '/media/video/result.mp4',
      mediaType: undefined,
    }))).toBe('/media/video/result.mp4');
    expect(fileSource).toContain('selectLegacyCanvasMediaUrl(image)');
    expect(fileSource).toContain('url: mediaUrl');
  });

  it('keeps an unmigrated legacy project readable until its first copy-on-write save', () => {
    const legacy = { ...project([image('legacy')]), schemaVersion: 1 as const };
    const [hydrated] = hydrateAssetV3Projects([legacy], {});

    expect(hydrated.schemaVersion).toBe(1);
    expect(hydrated.canvasImages).toEqual([expect.objectContaining({ id: 'legacy' })]);
  });

  it('treats an empty graph as authoritative for an already migrated v3 project', () => {
    const migrated = { ...project([image('removed')]), schemaVersion: 3 as const };
    const [hydrated] = hydrateAssetV3Projects([migrated], {});

    expect(hydrated.schemaVersion).toBe(3);
    expect(hydrated.canvasImages).toEqual([]);
  });
});
