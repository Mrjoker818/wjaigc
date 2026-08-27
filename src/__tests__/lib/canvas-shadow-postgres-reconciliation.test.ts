import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

import type { LegacyImageMapping } from '@/lib/asset-core/legacy-migration';
import type { CanvasImage, Project } from '@/lib/user-types';

const databaseUrl = process.env.TEST_POSTGRES_URL;
const suite = databaseUrl ? describe : describe.skip;

function canvasImage(id: string): CanvasImage {
  return {
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
  };
}

suite('canvas shadow PostgreSQL reconciliation', () => {
  const suffix = randomUUID();
  const ownerId = `shadow-owner-${suffix}`;
  const otherOwnerId = `shadow-other-owner-${suffix}`;
  const projectId = `shadow-project-${suffix}`;
  const otherProjectId = `shadow-other-project-${suffix}`;
  const otherOwnerProjectId = `shadow-owner-project-${suffix}`;
  const assetIds = {
    adopted: `asset-adopted-${suffix}`,
    current: `asset-current-${suffix}`,
    stale: `asset-stale-${suffix}`,
    shared: `asset-shared-${suffix}`,
    otherProject: `asset-other-project-${suffix}`,
    otherOwner: `asset-other-owner-${suffix}`,
  };
  const versionIds = Object.fromEntries(
    Object.entries(assetIds).map(([key, assetId]) => [key, `version-${assetId}`]),
  ) as Record<keyof typeof assetIds, string>;
  const placementIds = {
    adopted: `placement-adopted-${suffix}`,
    current: `placement-current-${suffix}`,
    stale: `placement-stale-${suffix}`,
    sharedCurrent: `placement-shared-current-${suffix}`,
    sharedStale: `placement-shared-stale-${suffix}`,
    workflow: `placement-workflow-${suffix}`,
    otherProject: `placement-other-project-${suffix}`,
    otherOwner: `placement-other-owner-${suffix}`,
  };
  const checkpointId = `checkpoint-${suffix}`;
  let pool: Pool;
  let migrateLegacyProjectOnWriteInTransaction: typeof import('@/lib/asset-core/legacy-migration').migrateLegacyProjectOnWriteInTransaction;
  let adoptManagedCanvasMapping: typeof import('@/lib/asset-core/legacy-migration').adoptManagedCanvasMapping;
  let adoptTaskProjectedCanvasMapping: typeof import('@/lib/asset-core/legacy-migration').adoptTaskProjectedCanvasMapping;

  async function waitForLockWait(processId: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const activity = await pool.query<{ wait_event_type: string | null }>(
        `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
        [processId],
      );
      if (activity.rows[0]?.wait_event_type === 'Lock') return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for the migration transaction to reach the asset lock');
  }

  async function insertAssetGraph(
    client: PoolClient,
    input: { assetId: string; versionId: string; ownerId: string; projectId: string; url: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status, metadata)
       VALUES ($1, $2, $3, 'image', 'active', '{}'::jsonb)`,
      [input.assetId, input.ownerId, input.projectId],
    );
    await client.query(
      `INSERT INTO wujie_asset_versions(
         id, asset_id, owner_id, project_id, file_url, width, height, availability, metadata
       ) VALUES ($1, $2, $3, $4, $5, 600, 400, 'ready', '{}'::jsonb)`,
      [input.versionId, input.assetId, input.ownerId, input.projectId, input.url],
    );
    await client.query(
      `UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1`,
      [input.assetId, input.versionId],
    );
  }

  async function insertPlacement(
    client: PoolClient,
    input: {
      id: string;
      ownerId: string;
      projectId: string;
      assetId: string;
      versionId: string;
      workspaceKind?: 'canvas' | 'workflow';
      workspaceId?: string;
      entityType?: 'canvas-image' | 'workflow-input';
      entityId: string;
    },
  ): Promise<void> {
    const workspaceKind = input.workspaceKind ?? 'canvas';
    const entityType = input.entityType ?? 'canvas-image';
    await client.query(
      `INSERT INTO wujie_workspace_placements(
         id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
         entity_type, entity_id, status, transform, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', '{}'::jsonb, '{}'::jsonb)`,
      [
        input.id,
        input.ownerId,
        input.projectId,
        input.assetId,
        input.versionId,
        workspaceKind,
        input.workspaceId ?? input.projectId,
        entityType,
        input.entityId,
      ],
    );
  }

  beforeAll(async () => {
    const migration = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/run-migrations.mjs')],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PGDATABASE_URL: databaseUrl,
        },
      },
    );
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    process.env.PGDATABASE_URL = databaseUrl;
    ({
      migrateLegacyProjectOnWriteInTransaction,
      adoptManagedCanvasMapping,
      adoptTaskProjectedCanvasMapping,
    } = await import('@/lib/asset-core/legacy-migration'));
    pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `CREATE TABLE IF NOT EXISTS wujie_user_data (
           user_id TEXT NOT NULL,
           data_key TEXT NOT NULL,
           data_value JSONB,
           updated_at BIGINT NOT NULL,
           PRIMARY KEY (user_id, data_key)
         )`,
      );
      await client.query(
        `INSERT INTO wujie_projects(id, owner_id, name, status, schema_version, metadata)
         VALUES ($1, $2, 'Current', 'active', 3, '{}'::jsonb),
                ($3, $2, 'Other project', 'active', 3, '{}'::jsonb),
                ($4, $5, 'Other owner', 'active', 3, '{}'::jsonb)`,
        [projectId, ownerId, otherProjectId, otherOwnerProjectId, otherOwnerId],
      );
      const snapshot: Project = {
        id: projectId,
        userId: ownerId,
        name: 'Current',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        canvasImages: [
          canvasImage('current'),
          canvasImage('shared-current'),
          {
            ...canvasImage('managed-new'),
            assetId: assetIds.adopted,
            assetVersionId: versionIds.adopted,
            placementId: placementIds.adopted,
          },
        ],
        settings: {},
      };
      await client.query(
        `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
         VALUES ($1, 'projects', $2::jsonb, $3)`,
        [ownerId, JSON.stringify([snapshot]), Date.now()],
      );
      await insertAssetGraph(client, {
        assetId: assetIds.adopted,
        versionId: versionIds.adopted,
        ownerId,
        projectId,
        url: '/media/managed-new.png',
      });
      await insertAssetGraph(client, {
        assetId: assetIds.current, versionId: versionIds.current, ownerId, projectId, url: '/media/current.png',
      });
      await insertAssetGraph(client, {
        assetId: assetIds.stale, versionId: versionIds.stale, ownerId, projectId, url: '/media/stale.png',
      });
      await insertAssetGraph(client, {
        assetId: assetIds.shared, versionId: versionIds.shared, ownerId, projectId, url: '/media/shared-current.png',
      });
      await insertAssetGraph(client, {
        assetId: assetIds.otherProject,
        versionId: versionIds.otherProject,
        ownerId,
        projectId: otherProjectId,
        url: '/media/other-project.png',
      });
      await insertAssetGraph(client, {
        assetId: assetIds.otherOwner,
        versionId: versionIds.otherOwner,
        ownerId: otherOwnerId,
        projectId: otherOwnerProjectId,
        url: '/media/other-owner.png',
      });
      await insertPlacement(client, {
        id: placementIds.adopted,
        ownerId,
        projectId,
        assetId: assetIds.adopted,
        versionId: versionIds.adopted,
        entityId: 'managed-new',
      });
      await insertPlacement(client, {
        id: placementIds.current, ownerId, projectId, assetId: assetIds.current,
        versionId: versionIds.current, entityId: 'current',
      });
      await insertPlacement(client, {
        id: placementIds.stale, ownerId, projectId, assetId: assetIds.stale,
        versionId: versionIds.stale, entityId: 'stale',
      });
      await insertPlacement(client, {
        id: placementIds.sharedCurrent, ownerId, projectId, assetId: assetIds.shared,
        versionId: versionIds.shared, entityId: 'shared-current',
      });
      await insertPlacement(client, {
        id: placementIds.sharedStale, ownerId, projectId, assetId: assetIds.shared,
        versionId: versionIds.shared, entityId: 'shared-stale',
      });
      await insertPlacement(client, {
        id: placementIds.workflow, ownerId, projectId, assetId: assetIds.current,
        versionId: versionIds.current, workspaceKind: 'workflow', entityType: 'workflow-input', entityId: 'workflow',
      });
      await insertPlacement(client, {
        id: placementIds.otherProject, ownerId, projectId: otherProjectId, assetId: assetIds.otherProject,
        versionId: versionIds.otherProject, entityId: 'other-project',
      });
      await insertPlacement(client, {
        id: placementIds.otherOwner, ownerId: otherOwnerId, projectId: otherOwnerProjectId,
        assetId: assetIds.otherOwner, versionId: versionIds.otherOwner, entityId: 'other-owner',
      });
      await client.query(
        `INSERT INTO wujie_asset_migration_checkpoints(
           id, owner_id, project_id, legacy_project_id, status, checkpoint
         ) VALUES ($1, $2, $3, $3, 'completed', $4::jsonb)`,
        [
          checkpointId,
          ownerId,
          projectId,
          JSON.stringify({
            sourceSchemaVersion: 1,
            legacyImageMappings: {
              current: {
                assetId: assetIds.current,
                versionId: versionIds.current,
                placementId: placementIds.current,
              },
              'shared-current': {
                assetId: assetIds.shared,
                versionId: versionIds.shared,
                placementId: placementIds.sharedCurrent,
              },
            },
          }),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM wujie_workspace_placements WHERE id = ANY($1::text[])', [Object.values(placementIds)]);
    await pool.query('DELETE FROM wujie_asset_migration_checkpoints WHERE id = $1', [checkpointId]);
    await pool.query('UPDATE wujie_assets SET current_version_id = NULL WHERE id = ANY($1::text[])', [Object.values(assetIds)]);
    await pool.query('DELETE FROM wujie_asset_versions WHERE id = ANY($1::text[])', [Object.values(versionIds)]);
    await pool.query('DELETE FROM wujie_assets WHERE id = ANY($1::text[])', [Object.values(assetIds)]);
    await pool.query('DELETE FROM wujie_projects WHERE id = ANY($1::text[])', [[projectId, otherProjectId, otherOwnerProjectId]]);
    await pool.query('DELETE FROM wujie_user_data WHERE user_id = $1 AND data_key = $2', [ownerId, 'projects']);
    await pool.end();
  });

  it('soft-deletes only stale same-project canvas placements and preserves shared or foreign graph state', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migrateLegacyProjectOnWriteInTransaction(client, { actorUserId: ownerId, projectId });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const placements = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM wujie_workspace_placements
       WHERE id = ANY($1::text[]) ORDER BY id`,
      [Object.values(placementIds)],
    );
    const placementStatuses = Object.fromEntries(placements.rows.map(row => [row.id, row.status]));
    expect(placementStatuses).toMatchObject({
      [placementIds.adopted]: 'active',
      [placementIds.current]: 'active',
      [placementIds.stale]: 'trashed',
      [placementIds.sharedCurrent]: 'active',
      [placementIds.sharedStale]: 'trashed',
      [placementIds.workflow]: 'active',
      [placementIds.otherProject]: 'active',
      [placementIds.otherOwner]: 'active',
    });

    const assets = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM wujie_assets WHERE id = ANY($1::text[]) ORDER BY id`,
      [Object.values(assetIds)],
    );
    const assetStatuses = Object.fromEntries(assets.rows.map(row => [row.id, row.status]));
    expect(assetStatuses).toMatchObject({
      [assetIds.adopted]: 'active',
      [assetIds.current]: 'active',
      [assetIds.stale]: 'trashed',
      [assetIds.shared]: 'active',
      [assetIds.otherProject]: 'active',
      [assetIds.otherOwner]: 'active',
    });
  });

  it('prefers a namespaced current canvas mapping over a stale checkpoint alias', async () => {
    const localSuffix = randomUUID();
    const localOwnerId = `shadow-current-owner-${localSuffix}`;
    const localProjectId = `shadow-current-project-${localSuffix}`;
    const imageId = `shadow-current-image-${localSuffix}`;
    const currentAssetId = `shadow-current-asset-${localSuffix}`;
    const currentVersionId = `shadow-current-version-${localSuffix}`;
    const currentPlacementId = `shadow-current-placement-${localSuffix}`;
    const staleAssetId = `shadow-stale-asset-${localSuffix}`;
    const staleVersionId = `shadow-stale-version-${localSuffix}`;
    const stalePlacementId = `shadow-stale-placement-${localSuffix}`;
    const localCheckpointId = `shadow-current-checkpoint-${localSuffix}`;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO wujie_projects(id, owner_id, name, status, schema_version, metadata)
         VALUES ($1, $2, 'Current mapping', 'active', 3, '{}'::jsonb)`,
        [localProjectId, localOwnerId],
      );
      const snapshot: Project = {
        id: localProjectId,
        userId: localOwnerId,
        name: 'Current mapping',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        canvasImages: [{
          ...canvasImage(imageId),
          url: '/media/current-managed.png',
          assetId: currentAssetId,
          assetVersionId: currentVersionId,
          placementId: currentPlacementId,
        }],
        settings: {},
      };
      await client.query(
        `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
         VALUES ($1, 'projects', $2::jsonb, $3)`,
        [localOwnerId, JSON.stringify([snapshot]), Date.now()],
      );
      await insertAssetGraph(client, {
        assetId: currentAssetId,
        versionId: currentVersionId,
        ownerId: localOwnerId,
        projectId: localProjectId,
        url: '/media/current-managed.png',
      });
      await insertPlacement(client, {
        id: currentPlacementId,
        ownerId: localOwnerId,
        projectId: localProjectId,
        assetId: currentAssetId,
        versionId: currentVersionId,
        workspaceId: `canvas:${localProjectId}`,
        entityId: imageId,
      });
      await insertAssetGraph(client, {
        assetId: staleAssetId,
        versionId: staleVersionId,
        ownerId: localOwnerId,
        projectId: localProjectId,
        url: '/media/stale-managed.png',
      });
      await insertPlacement(client, {
        id: stalePlacementId,
        ownerId: localOwnerId,
        projectId: localProjectId,
        assetId: staleAssetId,
        versionId: staleVersionId,
        entityId: 'stale-checkpoint-alias',
      });
      await client.query(
        `INSERT INTO wujie_asset_migration_checkpoints(
           id, owner_id, project_id, legacy_project_id, status, checkpoint
         ) VALUES ($1, $2, $3, $3, 'completed', $4::jsonb)`,
        [
          localCheckpointId,
          localOwnerId,
          localProjectId,
          JSON.stringify({
            sourceSchemaVersion: 1,
            legacyImageMappings: {
              [imageId]: {
                assetId: staleAssetId,
                versionId: staleVersionId,
                placementId: stalePlacementId,
              },
            },
          }),
        ],
      );
      await client.query('COMMIT');

      await client.query('BEGIN');
      const result = await migrateLegacyProjectOnWriteInTransaction(client, {
        actorUserId: localOwnerId,
        projectId: localProjectId,
      });
      await client.query('COMMIT');

      expect(result.mappings[imageId]).toEqual({
        assetId: currentAssetId,
        versionId: currentVersionId,
        placementId: currentPlacementId,
      });
      await expect(pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM wujie_workspace_placements
         WHERE id = ANY($1::text[]) ORDER BY id`,
        [[currentPlacementId, stalePlacementId]],
      )).resolves.toMatchObject({
        rows: expect.arrayContaining([
          { id: currentPlacementId, status: 'active' },
          { id: stalePlacementId, status: 'trashed' },
        ]),
      });
      const checkpoint = await pool.query<{ checkpoint: { legacyImageMappings: Record<string, unknown> } }>(
        `SELECT checkpoint FROM wujie_asset_migration_checkpoints WHERE id = $1`,
        [localCheckpointId],
      );
      expect(checkpoint.rows[0]?.checkpoint.legacyImageMappings[imageId]).toEqual({
        assetId: currentAssetId,
        versionId: currentVersionId,
        placementId: currentPlacementId,
      });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await pool.query('DELETE FROM wujie_workspace_placements WHERE id = ANY($1::text[])', [[
        currentPlacementId,
        stalePlacementId,
      ]]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_asset_migration_checkpoints WHERE id = $1', [localCheckpointId]).catch(() => undefined);
      await pool.query('UPDATE wujie_assets SET current_version_id = NULL WHERE id = ANY($1::text[])', [[
        currentAssetId,
        staleAssetId,
      ]]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_asset_versions WHERE id = ANY($1::text[])', [[
        currentVersionId,
        staleVersionId,
      ]]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_assets WHERE id = ANY($1::text[])', [[
        currentAssetId,
        staleAssetId,
      ]]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_projects WHERE id = $1', [localProjectId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_user_data WHERE user_id = $1 AND data_key = $2', [
        localOwnerId,
        'projects',
      ]).catch(() => undefined);
      client.release();
    }
  });

  it('appends a local child version when a managed canvas result was persisted after task projection', async () => {
    const localSuffix = randomUUID();
    const localOwnerId = `shadow-persisted-owner-${localSuffix}`;
    const localProjectId = `shadow-persisted-project-${localSuffix}`;
    const taskId = `async-${localSuffix}`;
    const imageId = `${taskId}:0`;
    const assetId = `shadow-persisted-asset-${localSuffix}`;
    const remoteVersionId = `shadow-persisted-version-${localSuffix}`;
    const placementId = `shadow-persisted-placement-${localSuffix}`;
    const checkpointId = `shadow-persisted-checkpoint-${localSuffix}`;
    const remoteUrl = `https://cdn.example.test/${localSuffix}.png`;
    const localUrl = `/api/serve-upload/uploads/${localSuffix}.png`;
    const nextLocalUrl = `/api/serve-upload/uploads/${localSuffix}-v2.png`;
    const siblingVersionId = `shadow-persisted-sibling-${localSuffix}`;
    const client = await pool.connect();
    let projectorReplay: PoolClient | undefined;

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO wujie_projects(id, owner_id, name, status, schema_version, metadata)
         VALUES ($1, $2, 'Persisted task result', 'active', 3, '{}'::jsonb)`,
        [localProjectId, localOwnerId],
      );
      const snapshot: Project = {
        id: localProjectId,
        userId: localOwnerId,
        name: 'Persisted task result',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        schemaVersion: 3,
        canvasImages: [{
          ...canvasImage(imageId),
          url: localUrl,
          sourceUrl: remoteUrl,
          generationTaskId: taskId,
          assetId,
          assetVersionId: remoteVersionId,
          placementId,
        }],
        settings: {},
      };
      await client.query(
        `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
         VALUES ($1, 'projects', $2::jsonb, $3)`,
        [localOwnerId, JSON.stringify([snapshot]), Date.now()],
      );
      await insertAssetGraph(client, {
        assetId,
        versionId: remoteVersionId,
        ownerId: localOwnerId,
        projectId: localProjectId,
        url: remoteUrl,
      });
      await insertPlacement(client, {
        id: placementId,
        ownerId: localOwnerId,
        projectId: localProjectId,
        assetId,
        versionId: remoteVersionId,
        workspaceId: `canvas:${localProjectId}`,
        entityId: imageId,
      });
      await client.query(
        `INSERT INTO wujie_asset_migration_checkpoints(
           id, owner_id, project_id, legacy_project_id, status, checkpoint
         ) VALUES ($1, $2, $3, $3, 'completed', $4::jsonb)`,
        [
          checkpointId,
          localOwnerId,
          localProjectId,
          JSON.stringify({
            sourceSchemaVersion: 3,
            legacyImageMappings: {
              [imageId]: { assetId, versionId: remoteVersionId, placementId },
            },
          }),
        ],
      );
      await client.query('COMMIT');

      projectorReplay = await pool.connect();
      await projectorReplay.query('BEGIN');
      await projectorReplay.query(
        `SELECT id FROM wujie_asset_versions WHERE id = $1 FOR UPDATE`,
        [remoteVersionId],
      );
      const migrationProcess = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await client.query('BEGIN');
      const migration = migrateLegacyProjectOnWriteInTransaction(client, {
        actorUserId: localOwnerId,
        projectId: localProjectId,
      });
      await waitForLockWait(migrationProcess.rows[0].pid);
      await projectorReplay.query(
        `SELECT id FROM wujie_workspace_placements WHERE id = $1 FOR UPDATE`,
        [placementId],
      );
      await projectorReplay.query('COMMIT');
      const result = await migration;
      await client.query('COMMIT');

      const activeMapping = result.mappings[imageId];
      expect(activeMapping).toMatchObject({ assetId, placementId });
      expect(activeMapping?.versionId).not.toBe(remoteVersionId);
      await expect(pool.query<{ id: string; file_url: string; metadata: Record<string, unknown> }>(
        `SELECT id, file_url, metadata FROM wujie_asset_versions
         WHERE asset_id = $1 ORDER BY created_at, id`,
        [assetId],
      )).resolves.toMatchObject({
        rowCount: 2,
        rows: [
          { id: remoteVersionId, file_url: remoteUrl, metadata: {} },
          { id: activeMapping?.versionId, file_url: localUrl },
        ],
      });
      await expect(pool.query<{ version_id: string; parent_version_id: string }>(
        `SELECT version_id, parent_version_id
         FROM wujie_asset_version_parents WHERE asset_id = $1`,
        [assetId],
      )).resolves.toMatchObject({
        rows: [{ version_id: activeMapping?.versionId, parent_version_id: remoteVersionId }],
      });
      await expect(pool.query<{ current_version_id: string }>(
        `SELECT current_version_id FROM wujie_assets WHERE id = $1`,
        [assetId],
      )).resolves.toMatchObject({ rows: [{ current_version_id: activeMapping?.versionId }] });
      await expect(pool.query<{ asset_version_id: string }>(
        `SELECT asset_version_id FROM wujie_workspace_placements WHERE id = $1`,
        [placementId],
      )).resolves.toMatchObject({ rows: [{ asset_version_id: activeMapping?.versionId }] });
      const checkpoint = await pool.query<{ checkpoint: { legacyImageMappings: Record<string, LegacyImageMapping> } }>(
        `SELECT checkpoint FROM wujie_asset_migration_checkpoints WHERE id = $1`,
        [checkpointId],
      );
      expect(checkpoint.rows[0]?.checkpoint.legacyImageMappings[imageId]).toEqual(activeMapping);

      await client.query('BEGIN');
      const replay = await migrateLegacyProjectOnWriteInTransaction(client, {
        actorUserId: localOwnerId,
        projectId: localProjectId,
      });
      await client.query('COMMIT');
      expect(replay.mappings[imageId]).toEqual(activeMapping);
      await expect(pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM wujie_asset_versions WHERE asset_id = $1`,
        [assetId],
      )).resolves.toMatchObject({ rows: [{ count: '2' }] });

      await pool.query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, width, height, availability, metadata
         ) VALUES ($1, $2, $3, $4, $5, 600, 400, 'ready', '{"source":"newer-branch"}'::jsonb)`,
        [siblingVersionId, assetId, localOwnerId, localProjectId, `/media/${localSuffix}-sibling.png`],
      );
      await pool.query(
        `UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1`,
        [assetId, siblingVersionId],
      );
      const changedSnapshot: Project = {
        ...snapshot,
        canvasImages: [{
          ...snapshot.canvasImages[0],
          url: nextLocalUrl,
        }],
      };
      await pool.query(
        `UPDATE wujie_user_data SET data_value = $2::jsonb, updated_at = $3
         WHERE user_id = $1 AND data_key = 'projects'`,
        [localOwnerId, JSON.stringify([changedSnapshot]), Date.now()],
      );

      await client.query('BEGIN');
      const branched = await migrateLegacyProjectOnWriteInTransaction(client, {
        actorUserId: localOwnerId,
        projectId: localProjectId,
      });
      await client.query('COMMIT');
      const branchedMapping = branched.mappings[imageId];
      expect(branchedMapping).toMatchObject({ assetId, placementId });
      expect(branchedMapping?.versionId).not.toBe(activeMapping?.versionId);
      await expect(pool.query<{ current_version_id: string }>(
        `SELECT current_version_id FROM wujie_assets WHERE id = $1`,
        [assetId],
      )).resolves.toMatchObject({ rows: [{ current_version_id: siblingVersionId }] });
      await expect(pool.query<{ asset_version_id: string }>(
        `SELECT asset_version_id FROM wujie_workspace_placements WHERE id = $1`,
        [placementId],
      )).resolves.toMatchObject({ rows: [{ asset_version_id: branchedMapping?.versionId }] });
      await expect(pool.query<{ version_id: string; parent_version_id: string }>(
        `SELECT version_id, parent_version_id
         FROM wujie_asset_version_parents
         WHERE asset_id = $1 AND version_id = $2`,
        [assetId, branchedMapping?.versionId],
      )).resolves.toMatchObject({
        rows: [{ version_id: branchedMapping?.versionId, parent_version_id: activeMapping?.versionId }],
      });
    } finally {
      await projectorReplay?.query('ROLLBACK').catch(() => undefined);
      projectorReplay?.release();
      await client.query('ROLLBACK').catch(() => undefined);
      await pool.query('DELETE FROM wujie_workspace_placements WHERE id = $1', [placementId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_asset_migration_checkpoints WHERE id = $1', [checkpointId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_asset_version_parents WHERE asset_id = $1', [assetId]).catch(() => undefined);
      await pool.query('UPDATE wujie_assets SET current_version_id = NULL WHERE id = $1', [assetId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_asset_versions WHERE asset_id = $1', [assetId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_assets WHERE id = $1', [assetId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_projects WHERE id = $1', [localProjectId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_user_data WHERE user_id = $1 AND data_key = $2', [
        localOwnerId,
        'projects',
      ]).catch(() => undefined);
      client.release();
    }
  });

  it('rolls back stale-placement cleanup with the surrounding transaction', async () => {
    await pool.query(
      `UPDATE wujie_workspace_placements
       SET status = 'active', deleted_at = NULL, updated_at = now()
       WHERE id = $1`,
      [placementIds.stale],
    );
    await pool.query(`UPDATE wujie_assets SET status = 'active', updated_at = now() WHERE id = $1`, [assetIds.stale]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migrateLegacyProjectOnWriteInTransaction(client, { actorUserId: ownerId, projectId });
      const inside = await client.query<{ status: string }>(
        `SELECT status FROM wujie_workspace_placements WHERE id = $1`,
        [placementIds.stale],
      );
      expect(inside.rows[0]?.status).toBe('trashed');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    await expect(pool.query<{ status: string }>(
      `SELECT status FROM wujie_workspace_placements WHERE id = $1`,
      [placementIds.stale],
    )).resolves.toMatchObject({ rows: [{ status: 'active' }] });
    await expect(pool.query<{ status: string }>(
      `SELECT status FROM wujie_assets WHERE id = $1`,
      [assetIds.stale],
    )).resolves.toMatchObject({ rows: [{ status: 'active' }] });
  });

  it('keeps asset-before-placement lock order during managed adoption under contention', async () => {
    await pool.query(
      `UPDATE wujie_asset_migration_checkpoints
       SET checkpoint = $4::jsonb, updated_at = now()
       WHERE owner_id = $1 AND project_id = $2 AND legacy_project_id = $3`,
      [
        ownerId,
        projectId,
        projectId,
        JSON.stringify({
          sourceSchemaVersion: 1,
          legacyImageMappings: {
            current: {
              assetId: assetIds.current,
              versionId: versionIds.current,
              placementId: placementIds.current,
            },
            'shared-current': {
              assetId: assetIds.shared,
              versionId: versionIds.shared,
              placementId: placementIds.sharedCurrent,
            },
          },
        }),
      ],
    );

    const migrationClient = await pool.connect();
    const lifecycleClient = await pool.connect();
    let migrationOpen = false;
    let lifecycleOpen = false;
    try {
      await lifecycleClient.query('BEGIN');
      lifecycleOpen = true;
      await lifecycleClient.query(`SET LOCAL lock_timeout = '5s'`);
      await lifecycleClient.query(`SELECT id FROM wujie_assets WHERE id = $1 FOR UPDATE`, [assetIds.adopted]);

      await migrationClient.query('BEGIN');
      migrationOpen = true;
      const backend = await migrationClient.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const migration = migrateLegacyProjectOnWriteInTransaction(migrationClient, {
        actorUserId: ownerId,
        projectId,
      });
      await waitForLockWait(backend.rows[0].pid);

      await lifecycleClient.query(
        `SELECT id FROM wujie_workspace_placements WHERE id = $1 FOR UPDATE`,
        [placementIds.adopted],
      );
      await lifecycleClient.query('COMMIT');
      lifecycleOpen = false;

      await migration;
      await migrationClient.query('COMMIT');
      migrationOpen = false;
    } finally {
      if (lifecycleOpen) await lifecycleClient.query('ROLLBACK').catch(() => undefined);
      if (migrationOpen) await migrationClient.query('ROLLBACK').catch(() => undefined);
      lifecycleClient.release();
      migrationClient.release();
    }

    await expect(pool.query<{ status: string }>(
      `SELECT status FROM wujie_workspace_placements WHERE id = $1`,
      [placementIds.adopted],
    )).resolves.toMatchObject({ rows: [{ status: 'active' }] });
  }, 15_000);

  it('rejects a managed placement from another canvas workspace in the same project', async () => {
    const localSuffix = randomUUID();
    const assetId = `asset-foreign-workspace-${localSuffix}`;
    const versionId = `version-foreign-workspace-${localSuffix}`;
    const placementId = `placement-foreign-workspace-${localSuffix}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await insertAssetGraph(client, {
        assetId, versionId, ownerId, projectId, url: '/media/foreign-workspace.png',
      });
      await insertPlacement(client, {
        id: placementId,
        ownerId,
        projectId,
        assetId,
        versionId,
        workspaceId: 'another-canvas-workspace',
        entityId: 'foreign-workspace-image',
      });
      await client.query('COMMIT');

      await client.query('BEGIN');
      await expect(adoptManagedCanvasMapping(client, { actorUserId: ownerId, projectId }, {
        ...canvasImage('foreign-workspace-image'),
        assetId,
        assetVersionId: versionId,
        placementId,
      })).rejects.toMatchObject({ code: 'LEGACY_MIGRATION_INTEGRITY_CONFLICT' });
      await client.query('ROLLBACK');
    } finally {
      await pool.query('DELETE FROM wujie_workspace_placements WHERE id = $1', [placementId]).catch(() => undefined);
      await pool.query('UPDATE wujie_assets SET current_version_id = NULL WHERE id = $1', [assetId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_asset_versions WHERE id = $1', [versionId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_assets WHERE id = $1', [assetId]).catch(() => undefined);
      client.release();
    }
  });

  it('locks a newly visible task asset before its version and placement', async () => {
    const localSuffix = randomUUID();
    const taskId = `task-phantom-${localSuffix}`;
    const imageId = `${taskId}:0`;
    const assetId = `asset-phantom-${localSuffix}`;
    const versionId = `version-phantom-${localSuffix}`;
    const placementId = `placement-phantom-${localSuffix}`;
    const setup = await pool.connect();
    const adoptionClient = await pool.connect();
    const lifecycleClient = await pool.connect();
    let adoptionOpen = false;
    let lifecycleOpen = false;
    try {
      await setup.query('BEGIN');
      await insertAssetGraph(setup, {
        assetId, versionId, ownerId, projectId, url: '/media/phantom.png',
      });
      await setup.query(
        `UPDATE wujie_asset_versions
         SET task_id = $2, metadata = jsonb_build_object('outputIndex', 0)
         WHERE id = $1`,
        [versionId, taskId],
      );
      await insertPlacement(setup, {
        id: placementId, ownerId, projectId, assetId, versionId, entityId: imageId,
      });
      await setup.query('COMMIT');

      await lifecycleClient.query('BEGIN');
      lifecycleOpen = true;
      await lifecycleClient.query(`SET LOCAL lock_timeout = '5s'`);
      await lifecycleClient.query('SELECT id FROM wujie_assets WHERE id = $1 FOR UPDATE', [assetId]);

      await adoptionClient.query('BEGIN');
      adoptionOpen = true;
      const backend = await adoptionClient.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const adoption = adoptTaskProjectedCanvasMapping(
        adoptionClient,
        { actorUserId: ownerId, projectId },
        { ...canvasImage(imageId), generationTaskId: taskId },
      );
      const firstOutcome = await Promise.race([
        waitForLockWait(backend.rows[0].pid).then(() => 'asset-lock-wait' as const),
        adoption.then(() => 'adoption-completed' as const),
      ]);
      expect(firstOutcome).toBe('asset-lock-wait');

      await lifecycleClient.query('SELECT id FROM wujie_asset_versions WHERE id = $1 FOR UPDATE', [versionId]);
      await lifecycleClient.query('SELECT id FROM wujie_workspace_placements WHERE id = $1 FOR UPDATE', [placementId]);
      await lifecycleClient.query('COMMIT');
      lifecycleOpen = false;

      await expect(adoption).resolves.toEqual({ assetId, versionId, placementId });
      await adoptionClient.query('ROLLBACK');
      adoptionOpen = false;
    } finally {
      if (lifecycleOpen) await lifecycleClient.query('ROLLBACK').catch(() => undefined);
      if (adoptionOpen) await adoptionClient.query('ROLLBACK').catch(() => undefined);
      await pool.query('DELETE FROM wujie_workspace_placements WHERE id = $1', [placementId]).catch(() => undefined);
      await pool.query('UPDATE wujie_assets SET current_version_id = NULL WHERE id = $1', [assetId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_asset_versions WHERE id = $1', [versionId]).catch(() => undefined);
      await pool.query('DELETE FROM wujie_assets WHERE id = $1', [assetId]).catch(() => undefined);
      lifecycleClient.release();
      adoptionClient.release();
      setup.release();
    }
  }, 15_000);
});
