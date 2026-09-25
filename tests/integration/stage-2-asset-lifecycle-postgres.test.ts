import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { closePool } from '../../src/lib/db-client';
import {
  type QueryFn,
  withIsolatedPostgres,
} from '../helpers/postgres-test-database';

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

function migrate(databaseUrl: string): void {
  const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

function withApplicationName(databaseUrl: string, applicationName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('application_name', applicationName);
  return url.toString();
}

async function waitForPurgeLock(query: QueryFn, applicationName: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const activity = await query<{ wait_event_type: string | null }>(
      `SELECT wait_event_type
       FROM pg_stat_activity
       WHERE application_name = $1 AND wait_event_type = 'Lock'`,
      [applicationName],
    );
    if (activity.rows.length > 0) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error('purge did not wait on the asset lifecycle row lock');
}

async function waitForApplicationLockCount(
  query: QueryFn,
  applicationName: string,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const activity = await query<{ waiting: string }>(
      `SELECT count(*)::text AS waiting
       FROM pg_stat_activity
       WHERE application_name = $1 AND wait_event_type = 'Lock'`,
      [applicationName],
    );
    if (Number(activity.rows[0]?.waiting ?? 0) >= expected) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error(`expected ${expected} governed recovery lock waiters`);
}

describe('stage 2 asset lifecycle PostgreSQL contract', () => {
  postgresIt('atomically restores a canvas placement into the shadow snapshot and advances its revision', async () => {
    await withIsolatedPostgres('asset_lifecycle_shadow_restore', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      await query(
        `CREATE TABLE IF NOT EXISTS wujie_user_data (
           user_id TEXT NOT NULL,
           data_key TEXT NOT NULL,
           data_value JSONB NOT NULL,
           updated_at BIGINT NOT NULL,
           PRIMARY KEY (user_id, data_key)
         )`,
      );
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const versionId = randomUUID();
      const placementId = randomUUID();
      const imageId = 'restored-image';
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Shadow restore')`,
        [projectId, ownerId],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'trashed')`,
        [assetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, availability
         ) VALUES ($1, $2, $3, $4, '/api/serve-upload/uploads/restored.png', 'ready')`,
        [versionId, assetId, ownerId, projectId],
      );
      await query(
        'UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1',
        [assetId, versionId],
      );
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status, deleted_at, transform, metadata
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', $3, 'canvas-image', $6, 'trashed', now(),
                   $7::jsonb, $8::jsonb)`,
        [
          placementId,
          ownerId,
          projectId,
          assetId,
          versionId,
          imageId,
          JSON.stringify({ x: 41, y: 52, width: 640, height: 480, rotation: 0, zIndex: 3 }),
          JSON.stringify({
            legacyImage: {
              id: imageId,
              url: '/api/serve-upload/uploads/restored.png',
              x: 41,
              y: 52,
              width: 640,
              height: 480,
              originalWidth: 640,
              originalHeight: 480,
              rotation: 0,
              zIndex: 3,
              createdAt: 1,
            },
          }),
        ],
      );
      await query(
        `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
         VALUES ($1, 'projects', $2::jsonb, 1),
                ($1, '__asset_graph_projects_revision', '7'::jsonb, 1)`,
        [ownerId, JSON.stringify([{
          id: projectId,
          userId: ownerId,
          name: 'Shadow restore',
          createdAt: 1,
          updatedAt: 1,
          canvasImages: [],
          settings: {},
        }])],
      );

      await closePool();
      process.env.DATABASE_URL = databaseUrl;
      process.env.PGDATABASE_URL = databaseUrl;
      const { createAssetService } = await import('../../src/lib/asset-core/service');
      await createAssetService().restorePlacement({
        actorUserId: ownerId,
        projectId,
        assetId,
        placementId,
      });

      const placement = await query<{ status: string }>(
        'SELECT status FROM wujie_workspace_placements WHERE id = $1',
        [placementId],
      );
      const snapshot = await query<{ data_key: string; data_value: unknown }>(
        `SELECT data_key, data_value FROM wujie_user_data
         WHERE user_id = $1 AND data_key IN ('projects', '__asset_graph_projects_revision')`,
        [ownerId],
      );
      const values = Object.fromEntries(snapshot.rows.map(row => [row.data_key, row.data_value]));
      const projects = values.projects as Array<{ canvasImages: Array<Record<string, unknown>> }>;
      expect(placement.rows[0]?.status).toBe('active');
      expect(values.__asset_graph_projects_revision).toBe(8);
      expect(projects[0]?.canvasImages).toEqual([
        expect.objectContaining({
          id: imageId,
          url: '/api/serve-upload/uploads/restored.png',
          x: 41,
          assetId,
          assetVersionId: versionId,
          placementId,
        }),
      ]);

      await query(`INSERT INTO wujie_project_document_settings
        (project_id, owner_id, enabled, authority_revision)
        VALUES ($1, $2, true, 8)`, [projectId, ownerId]);
      await expect(createAssetService().trashPlacement({
        actorUserId: ownerId, projectId, placementId,
      })).rejects.toThrow('DOCUMENT_AUTHORITY_CONFLICT');
      const afterRejectedTrash = await query<{ status: string }>(
        'SELECT status FROM wujie_workspace_placements WHERE id = $1', [placementId],
      );
      expect(afterRejectedTrash.rows[0]?.status).toBe('active');
      const afterRejectedSnapshot = await query<{ data_value: unknown }>(
        `SELECT data_value FROM wujie_user_data
          WHERE user_id = $1 AND data_key = 'projects'`, [ownerId],
      );
      expect(afterRejectedSnapshot.rows[0]?.data_value).toEqual(values.projects);
    });
  }, 30_000);

  postgresIt('installs lifecycle audit storage so concurrent restore/trash/purge checks can share one transaction boundary', async () => {
    await withIsolatedPostgres('asset_lifecycle', async ({ databaseUrl, query }) => {
      const migration = resolve(process.cwd(), 'migrations/20260812_wj_stable_s2_asset_lifecycle.sql');
      migrate(databaseUrl);
      const source = await readFile(migration, 'utf8');
      expect(source).toContain('wujie_asset_media_recovery_attempts');
      const table = await query<{ exists: boolean }>(
        "SELECT to_regclass('wujie_asset_media_recovery_attempts') IS NOT NULL AS exists",
      );
      expect(table.rows[0]?.exists).toBe(true);
    });
  });

  postgresIt('waits on the asset lifecycle lock and rechecks changed version facts before deferred purge', async () => {
    await withIsolatedPostgres('asset_lifecycle_purge_recheck', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      await query(
        `CREATE TABLE IF NOT EXISTS wujie_user_data (
           user_id TEXT NOT NULL,
           data_key TEXT NOT NULL,
           data_value JSONB NOT NULL,
           updated_at BIGINT NOT NULL,
           PRIMARY KEY (user_id, data_key)
         )`,
      );
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const versionId = randomUUID();
      const placementId = randomUUID();
      const checkpointId = randomUUID();
      const deletedAt = '2026-06-01T00:00:00.000Z';
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Lifecycle')`,
        [projectId, ownerId],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'trashed')`,
        [assetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, storage_key, byte_size, availability
         ) VALUES ($1, $2, $3, $4, $5, $6, 64, 'ready')`,
        [versionId, assetId, ownerId, projectId, '/api/serve-upload/a.png', 'images/a.png'],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, versionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status, deleted_at
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-a', 'canvas-image', 'image-a', 'trashed', $6)`,
        [placementId, ownerId, projectId, assetId, versionId, deletedAt],
      );
      await query(
        `INSERT INTO wujie_asset_migration_checkpoints(
           id, owner_id, project_id, legacy_project_id, status
         ) VALUES ($1, $2, $3, $3, 'completed')`,
        [checkpointId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
         VALUES ($1, 'projects', $2::jsonb, 1)`,
        [ownerId, JSON.stringify([{ id: projectId, userId: ownerId, canvasImages: [] }])],
      );

      const applicationName = `asset-purge-${randomUUID()}`;
      const businessUrl = withApplicationName(databaseUrl, applicationName);
      await closePool();
      process.env.DATABASE_URL = businessUrl;
      process.env.PGDATABASE_URL = businessUrl;
      const { purgeEligibleAsset, scanMediaHealth } = await import('../../src/lib/asset-core/media-health');
      const scan = await scanMediaHealth({ dryRun: false });
      const candidate = scan.candidates[0];
      expect(candidate).toMatchObject({ assetId });

      const lockClient = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
      await lockClient.connect();
      try {
        await lockClient.query('BEGIN');
        await lockClient.query('SELECT id FROM wujie_assets WHERE id = $1 FOR UPDATE', [assetId]);
        await lockClient.query(
          "UPDATE wujie_asset_versions SET availability = 'missing' WHERE id = $1",
          [versionId],
        );
        const purgePromise = purgeEligibleAsset({
          assetId,
          candidateId: candidate.candidateId,
          confirmationDigest: candidate.confirmationDigest,
        });
        await waitForPurgeLock(query, applicationName);
        await lockClient.query('COMMIT');

        const purge = await purgePromise;
        expect(purge.eligible).toBe(false);
        expect(purge.physicalPurgeDisabled).toBe(true);
        expect(purge.reasons).toContain('CONFIRMATION_DIGEST_STALE');
      } finally {
        await lockClient.query('ROLLBACK').catch(() => undefined);
        await lockClient.end();
      }
    });
  }, 30_000);

  postgresIt('serializes both governed recovery paths in asset-version-placement order without deadlock', async () => {
    await withIsolatedPostgres('asset_lifecycle_recovery_lock_order', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const versionId = randomUUID();
      const placementId = randomUUID();
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Recovery locks')`,
        [projectId, ownerId],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'trashed')`,
        [assetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, storage_key, availability
         ) VALUES ($1, $2, $3, $4, '/api/serve-upload/uploads/concurrent.png',
                   'uploads/concurrent.png', 'missing')`,
        [versionId, assetId, ownerId, projectId],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, versionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status, deleted_at
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-recovery',
                   'canvas-image', 'image-recovery', 'trashed', now())`,
        [placementId, ownerId, projectId, assetId, versionId],
      );

      const applicationName = `asset-recovery-${randomUUID()}`;
      const businessUrl = withApplicationName(databaseUrl, applicationName);
      await closePool();
      process.env.DATABASE_URL = businessUrl;
      process.env.PGDATABASE_URL = businessUrl;
      const { recordLegacyRecoveryOutcome, recoverAssetMedia } = await import('../../src/lib/asset-core/media-health');

      const lockClient = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
      await lockClient.connect();
      try {
        await lockClient.query('BEGIN');
        await lockClient.query('SELECT id FROM wujie_assets WHERE id = $1 FOR UPDATE', [assetId]);
        const recoveryPromise = recoverAssetMedia({
          actorUserId: ownerId,
          projectId,
          assetVersionId: versionId,
          assetId,
          placementId,
        }, {
          executeRecovery: async () => ({
            success: true,
            method: 'managed-storage',
            url: '/api/serve-upload/uploads/concurrent.png',
            storageKey: 'uploads/concurrent.png',
          }),
        });
        const legacyPromise = recordLegacyRecoveryOutcome({
          localPath: 'uploads/concurrent.png',
          success: true,
          method: 's3',
        });
        await waitForApplicationLockCount(query, applicationName, 2);
        await lockClient.query('COMMIT');

        const settled = await Promise.allSettled([recoveryPromise, legacyPromise]);
        expect(settled[1]).toMatchObject({ status: 'fulfilled' });
        for (const result of settled) {
          if (result.status !== 'rejected') continue;
          expect((result.reason as { code?: string }).code).not.toBe('40P01');
          expect(String(result.reason)).not.toMatch(/deadlock/i);
        }
        const version = await query<{ availability: string }>(
          'SELECT availability FROM wujie_asset_versions WHERE id = $1',
          [versionId],
        );
        expect(version.rows[0]?.availability).toBe('ready');
      } finally {
        await lockClient.query('ROLLBACK').catch(() => undefined);
        await lockClient.end();
      }
    });
  }, 30_000);

  postgresIt('persists active canvas media recovery and its attempt as a ready terminal', async () => {
    await withIsolatedPostgres('asset_lifecycle_active_recovery', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const versionId = randomUUID();
      const placementId = randomUUID();
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Active recovery')`,
        [projectId, ownerId],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status, metadata)
         VALUES ($1, $2, $3, 'image', 'active', $4::jsonb)`,
        [assetId, ownerId, projectId, JSON.stringify({ legacyImage: { mediaAvailability: 'missing' } })],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, recovery_source_url, availability
         ) VALUES ($1, $2, $3, $4, '/api/serve-upload/uploads/active.png',
                   'https://source.test/active.png', 'missing')`,
        [versionId, assetId, ownerId, projectId],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, versionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-active',
                   'canvas-image', 'image-active', 'active')`,
        [placementId, ownerId, projectId, assetId, versionId],
      );

      await closePool();
      process.env.DATABASE_URL = databaseUrl;
      process.env.PGDATABASE_URL = databaseUrl;
      const { recoverAssetMedia } = await import('../../src/lib/asset-core/media-health');
      await expect(recoverAssetMedia({
        actorUserId: ownerId,
        projectId,
        assetVersionId: versionId,
        assetId,
        placementId,
      }, {
        executeRecovery: async () => ({
          success: true,
          method: 'managed-storage',
          url: '/api/serve-upload/uploads/active.png',
          storageKey: 'images/uploads/active.png',
        }),
      })).resolves.toEqual({
        recovered: true,
        availability: 'ready',
        deferred: false,
        url: '/api/serve-upload/uploads/active.png',
      });

      const version = await query<{ availability: string; storage_key: string | null }>(
        'SELECT availability, storage_key FROM wujie_asset_versions WHERE id = $1',
        [versionId],
      );
      expect(version.rows[0]).toEqual({
        availability: 'ready',
        storage_key: 'images/uploads/active.png',
      });
      const asset = await query<{ availability: string }>(
        `SELECT metadata->'legacyImage'->>'mediaAvailability' AS availability
         FROM wujie_assets WHERE id = $1`,
        [assetId],
      );
      expect(asset.rows[0]?.availability).toBe('ready');
      const attempts = await query<{ status: string; detail: string }>(
        `SELECT status, detail FROM wujie_asset_media_recovery_attempts
         WHERE asset_id = $1 ORDER BY created_at`,
        [assetId],
      );
      expect(attempts.rows).toHaveLength(1);
      expect(attempts.rows[0]).toMatchObject({
        status: 'succeeded',
        detail: expect.stringContaining('managed-storage'),
      });
    });
  }, 30_000);

  postgresIt('runs only one media worker while concurrent recovery requests share the active lease', async () => {
    await withIsolatedPostgres('asset_lifecycle_concurrent_active_recovery', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const versionId = randomUUID();
      const placementId = randomUUID();
      await query(`INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Concurrent recovery')`, [projectId, ownerId]);
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'active')`,
        [assetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, recovery_source_url, availability
         ) VALUES ($1, $2, $3, $4, '/api/serve-upload/uploads/concurrent-active.png',
                   'https://source.test/concurrent-active.png', 'missing')`,
        [versionId, assetId, ownerId, projectId],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, versionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-concurrent-active',
                   'canvas-image', 'image-concurrent-active', 'active')`,
        [placementId, ownerId, projectId, assetId, versionId],
      );

      await closePool();
      process.env.DATABASE_URL = databaseUrl;
      process.env.PGDATABASE_URL = databaseUrl;
      const { recoverAssetMedia } = await import('../../src/lib/asset-core/media-health');
      let releaseWorker!: () => void;
      const workerGate = new Promise<void>((resolveWorker) => { releaseWorker = resolveWorker; });
      let workerCalls = 0;
      const executeRecovery = async () => {
        workerCalls += 1;
        await workerGate;
        return {
          success: true as const,
          method: 'managed-storage',
          url: '/api/serve-upload/uploads/concurrent-active.png',
        };
      };
      const input = { actorUserId: ownerId, projectId, assetVersionId: versionId, assetId, placementId };
      const first = recoverAssetMedia(input, { executeRecovery });
      for (let attempt = 0; attempt < 40 && workerCalls === 0; attempt += 1) {
        await new Promise(resolveWait => setTimeout(resolveWait, 25));
      }
      expect(workerCalls).toBe(1);
      const secondPromise = recoverAssetMedia(input, { executeRecovery });
      const second = await Promise.race([
        secondPromise,
        new Promise<'blocked'>(resolveWait => setTimeout(() => resolveWait('blocked'), 1_000)),
      ]);
      releaseWorker();
      if (second === 'blocked') await secondPromise;
      expect(second).toEqual({ recovered: false, availability: 'recovering', deferred: true });
      expect(workerCalls).toBe(1);
      await expect(first).resolves.toMatchObject({ recovered: true, availability: 'ready' });

      const attempts = await query<{ status: string }>(
        'SELECT status FROM wujie_asset_media_recovery_attempts WHERE asset_version_id = $1',
        [versionId],
      );
      expect(attempts.rows).toEqual([{ status: 'succeeded' }]);
    });
  }, 30_000);

  postgresIt('expires a stale recovery lease before a new worker owns the terminal write', async () => {
    await withIsolatedPostgres('asset_lifecycle_expired_recovery_lease', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const versionId = randomUUID();
      const placementId = randomUUID();
      const staleAttemptId = randomUUID();
      await query(`INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Expired recovery lease')`, [projectId, ownerId]);
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'active')`,
        [assetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, recovery_source_url, availability
         ) VALUES ($1, $2, $3, $4, '/api/serve-upload/uploads/expired.png',
                   'https://source.test/expired.png', 'recovering')`,
        [versionId, assetId, ownerId, projectId],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, versionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-expired',
                   'canvas-image', 'image-expired', 'active')`,
        [placementId, ownerId, projectId, assetId, versionId],
      );
      await query(
        `INSERT INTO wujie_asset_media_recovery_attempts(
           id, asset_version_id, asset_id, owner_id, project_id, source_url, status, detail, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'https://source.test/expired.png', 'deferred', 'stale', now() - interval '10 minutes')`,
        [staleAttemptId, versionId, assetId, ownerId, projectId],
      );

      await closePool();
      process.env.DATABASE_URL = databaseUrl;
      process.env.PGDATABASE_URL = databaseUrl;
      const { recoverAssetMedia } = await import('../../src/lib/asset-core/media-health');
      await expect(recoverAssetMedia({
        actorUserId: ownerId,
        projectId,
        assetVersionId: versionId,
        assetId,
        placementId,
      }, {
        executeRecovery: async () => ({
          success: true,
          method: 'managed-storage',
          url: '/api/serve-upload/uploads/expired.png',
        }),
      })).resolves.toMatchObject({ recovered: true, availability: 'ready' });

      const attempts = await query<{ id: string; status: string; detail: string }>(
        `SELECT id, status, detail FROM wujie_asset_media_recovery_attempts
         WHERE asset_version_id = $1 ORDER BY created_at`,
        [versionId],
      );
      expect(attempts.rows).toHaveLength(2);
      expect(attempts.rows[0]).toMatchObject({
        id: staleAttemptId,
        status: 'failed',
        detail: expect.stringContaining('lease expired'),
      });
      expect(attempts.rows[1]?.status).toBe('succeeded');
    });
  }, 30_000);

  postgresIt('fences a still-running expired worker after the replacement worker commits', async () => {
    await withIsolatedPostgres('asset_lifecycle_running_expired_worker', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const versionId = randomUUID();
      const placementId = randomUUID();
      await query(`INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Running expired worker')`, [projectId, ownerId]);
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'active')`,
        [assetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, recovery_source_url, availability
         ) VALUES ($1, $2, $3, $4, '/api/serve-upload/uploads/running-expired.png',
                   'https://source.test/running-expired.png', 'missing')`,
        [versionId, assetId, ownerId, projectId],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, versionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-running-expired',
                   'canvas-image', 'image-running-expired', 'active')`,
        [placementId, ownerId, projectId, assetId, versionId],
      );

      await closePool();
      process.env.DATABASE_URL = databaseUrl;
      process.env.PGDATABASE_URL = databaseUrl;
      const { recoverAssetMedia } = await import('../../src/lib/asset-core/media-health');
      const input = { actorUserId: ownerId, projectId, assetVersionId: versionId, assetId, placementId };
      let releaseOldWorker!: () => void;
      let oldWorkerStarted!: () => void;
      const oldStarted = new Promise<void>(resolve => { oldWorkerStarted = resolve; });
      const oldGate = new Promise<void>(resolve => { releaseOldWorker = resolve; });
      const oldRecovery = recoverAssetMedia(input, {
        executeRecovery: async (target) => {
          oldWorkerStarted();
          await oldGate;
          return {
            success: true,
            method: 'source-url',
            url: `/api/serve-upload/recovery/${versionId}/${target.attemptId}.png`,
            storageKey: `images/recovery/${versionId}/${target.attemptId}.png`,
          };
        },
      });
      await oldStarted;
      const oldAttempt = await query<{ id: string }>(
        `UPDATE wujie_asset_media_recovery_attempts
         SET created_at = now() - interval '10 minutes'
         WHERE asset_version_id = $1 AND status = 'deferred'
         RETURNING id`,
        [versionId],
      );
      expect(oldAttempt.rows).toHaveLength(1);

      let replacementAttemptId = '';
      const replacement = await recoverAssetMedia(input, {
        executeRecovery: async (target) => {
          replacementAttemptId = target.attemptId;
          return {
            success: true,
            method: 'source-url',
            url: `/api/serve-upload/recovery/${versionId}/${target.attemptId}.png`,
            storageKey: `images/recovery/${versionId}/${target.attemptId}.png`,
          };
        },
      });
      expect(replacement).toMatchObject({ recovered: true, availability: 'ready' });
      releaseOldWorker();
      await expect(oldRecovery).resolves.toEqual({ recovered: false, availability: 'recovering', deferred: true });

      const version = await query<{ file_url: string; storage_key: string; availability: string }>(
        `SELECT file_url, storage_key, availability FROM wujie_asset_versions WHERE id = $1`,
        [versionId],
      );
      expect(version.rows).toEqual([{
        file_url: `/api/serve-upload/recovery/${versionId}/${replacementAttemptId}.png`,
        storage_key: `images/recovery/${versionId}/${replacementAttemptId}.png`,
        availability: 'ready',
      }]);
      const attempts = await query<{ id: string; status: string }>(
        `SELECT id, status FROM wujie_asset_media_recovery_attempts
         WHERE asset_version_id = $1 ORDER BY created_at, id`,
        [versionId],
      );
      expect(attempts.rows).toEqual(expect.arrayContaining([
        { id: oldAttempt.rows[0]!.id, status: 'failed' },
        { id: replacementAttemptId, status: 'succeeded' },
      ]));
    });
  }, 30_000);

  postgresIt('physically probes an already-ready active version before confirming recovery', async () => {
    await withIsolatedPostgres('asset_lifecycle_ready_recovery', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const versionId = randomUUID();
      const placementId = randomUUID();
      await query(`INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Ready recovery')`, [projectId, ownerId]);
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'active')`,
        [assetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, storage_key, availability
         ) VALUES ($1, $2, $3, $4, '/api/serve-upload/uploads/ready.png',
                   'images/uploads/ready.png', 'ready')`,
        [versionId, assetId, ownerId, projectId],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, versionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-ready',
                   'canvas-image', 'image-ready', 'active')`,
        [placementId, ownerId, projectId, assetId, versionId],
      );

      await closePool();
      process.env.DATABASE_URL = databaseUrl;
      process.env.PGDATABASE_URL = databaseUrl;
      const { recoverAssetMedia } = await import('../../src/lib/asset-core/media-health');
      let workerCalls = 0;
      await expect(recoverAssetMedia({
        actorUserId: ownerId,
        projectId,
        assetVersionId: versionId,
        assetId,
        placementId,
      }, {
        executeRecovery: async () => {
          workerCalls += 1;
          return {
            success: true,
            method: 'managed-storage',
            url: '/api/serve-upload/uploads/ready.png',
            storageKey: 'images/uploads/ready.png',
          };
        },
      })).resolves.toEqual({
        recovered: true,
        availability: 'ready',
        deferred: false,
        url: '/api/serve-upload/uploads/ready.png',
      });
      expect(workerCalls).toBe(1);
      const attempts = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM wujie_asset_media_recovery_attempts WHERE asset_version_id = $1',
        [versionId],
      );
      expect(attempts.rows[0]?.count).toBe('1');
    });
  }, 30_000);

  postgresIt('does not overwrite current asset metadata when another version becomes current during recovery', async () => {
    await withIsolatedPostgres('asset_lifecycle_current_version_fence', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const oldVersionId = randomUUID();
      const newVersionId = randomUUID();
      const placementId = randomUUID();
      await query(`INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Current version fence')`, [projectId, ownerId]);
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status, metadata)
         VALUES ($1, $2, $3, 'image', 'active', $4::jsonb)`,
        [assetId, ownerId, projectId, JSON.stringify({ legacyImage: { mediaAvailability: 'missing' } })],
      );
      await query(
        `INSERT INTO wujie_asset_versions(id, asset_id, owner_id, project_id, file_url, recovery_source_url, availability)
         VALUES ($1, $2, $3, $4, '/api/serve-upload/uploads/old.png', 'https://source.test/old.png', 'missing'),
                ($5, $2, $3, $4, '/api/serve-upload/uploads/new.png', null, 'ready')`,
        [oldVersionId, assetId, ownerId, projectId, newVersionId],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, oldVersionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-version-fence',
                   'canvas-image', 'image-version-fence', 'active')`,
        [placementId, ownerId, projectId, assetId, oldVersionId],
      );

      await closePool();
      process.env.DATABASE_URL = databaseUrl;
      process.env.PGDATABASE_URL = databaseUrl;
      const { recoverAssetMedia } = await import('../../src/lib/asset-core/media-health');
      let releaseWorker!: () => void;
      let startedWorker!: () => void;
      const started = new Promise<void>(resolve => { startedWorker = resolve; });
      const gate = new Promise<void>(resolve => { releaseWorker = resolve; });
      const recovery = recoverAssetMedia({
        actorUserId: ownerId,
        projectId,
        assetVersionId: oldVersionId,
        assetId,
        placementId,
      }, {
        executeRecovery: async () => {
          startedWorker();
          await gate;
          return {
            success: true,
            method: 'source-url',
            url: '/api/serve-upload/recovery/version-old/attempt.png',
          };
        },
      });
      await started;
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, newVersionId]);
      releaseWorker();
      await expect(recovery).resolves.toMatchObject({ recovered: true, availability: 'ready' });

      const state = await query<{ current_version_id: string; availability: string | null }>(
        `SELECT current_version_id, metadata->'legacyImage'->>'mediaAvailability' AS availability
         FROM wujie_assets WHERE id = $1`,
        [assetId],
      );
      expect(state.rows).toEqual([{ current_version_id: newVersionId, availability: 'missing' }]);
    });
  }, 30_000);

  postgresIt('persists a thrown media worker error as missing instead of leaving a recovery lease', async () => {
    await withIsolatedPostgres('asset_lifecycle_thrown_recovery', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const versionId = randomUUID();
      const placementId = randomUUID();
      await query(`INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Thrown recovery')`, [projectId, ownerId]);
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'active')`,
        [assetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, recovery_source_url, availability
         ) VALUES ($1, $2, $3, $4, '/api/serve-upload/uploads/thrown.png',
                   'https://source.test/thrown.png', 'missing')`,
        [versionId, assetId, ownerId, projectId],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, versionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-thrown',
                   'canvas-image', 'image-thrown', 'active')`,
        [placementId, ownerId, projectId, assetId, versionId],
      );

      await closePool();
      process.env.DATABASE_URL = databaseUrl;
      process.env.PGDATABASE_URL = databaseUrl;
      const { recoverAssetMedia } = await import('../../src/lib/asset-core/media-health');
      await expect(recoverAssetMedia({
        actorUserId: ownerId,
        projectId,
        assetVersionId: versionId,
        assetId,
        placementId,
      }, {
        executeRecovery: async () => { throw new Error('worker crashed'); },
      })).resolves.toEqual({
        recovered: false,
        availability: 'missing',
        deferred: false,
        error: 'worker crashed',
      });
      const state = await query<{ availability: string; status: string; detail: string }>(
        `SELECT version.availability, attempt.status, attempt.detail
         FROM wujie_asset_versions version
         JOIN wujie_asset_media_recovery_attempts attempt ON attempt.asset_version_id = version.id
         WHERE version.id = $1`,
        [versionId],
      );
      expect(state.rows).toEqual([{
        availability: 'missing',
        status: 'failed',
        detail: 'worker crashed',
      }]);
    });
  }, 30_000);

  postgresIt('rechecks exact-path versions added after the candidate snapshot while waiting for the asset lock', async () => {
    await withIsolatedPostgres('asset_lifecycle_recovery_candidate_recheck', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const initialVersionId = randomUUID();
      const arrivedVersionId = randomUUID();
      const initialPlacementId = randomUUID();
      const arrivedPlacementId = randomUUID();
      const managedUrl = '/api/serve-upload/uploads/candidate-race.png';
      const storageKey = 'uploads/candidate-race.png';
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Recovery candidate recheck')`,
        [projectId, ownerId],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'trashed')`,
        [assetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, storage_key, availability
         ) VALUES ($1, $2, $3, $4, $5, $6, 'missing')`,
        [initialVersionId, assetId, ownerId, projectId, managedUrl, storageKey],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, initialVersionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status, deleted_at
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-candidate-initial',
                   'canvas-image', 'image-candidate-initial', 'trashed', now())`,
        [initialPlacementId, ownerId, projectId, assetId, initialVersionId],
      );

      const applicationName = `asset-candidate-${randomUUID()}`;
      const businessUrl = withApplicationName(databaseUrl, applicationName);
      await closePool();
      process.env.DATABASE_URL = businessUrl;
      process.env.PGDATABASE_URL = businessUrl;
      const { recordLegacyRecoveryOutcome } = await import('../../src/lib/asset-core/media-health');

      const lockClient = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
      await lockClient.connect();
      try {
        await lockClient.query('BEGIN');
        await lockClient.query('UPDATE wujie_assets SET updated_at = clock_timestamp() WHERE id = $1', [assetId]);
        const outcomePromise = recordLegacyRecoveryOutcome({
          localPath: storageKey,
          success: true,
          method: 's3',
        });
        await waitForApplicationLockCount(query, applicationName, 1);

        await query(
          `INSERT INTO wujie_asset_versions(
             id, asset_id, owner_id, project_id, file_url, storage_key, availability
           ) VALUES ($1, $2, $3, $4, $5, $6, 'missing')`,
          [arrivedVersionId, assetId, ownerId, projectId, managedUrl, storageKey],
        );
        await query(
          `INSERT INTO wujie_workspace_placements(
             id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
             entity_type, entity_id, status, deleted_at
           ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-candidate-arrived',
                     'canvas-image', 'image-candidate-arrived', 'trashed', now())`,
          [arrivedPlacementId, ownerId, projectId, assetId, arrivedVersionId],
        );
        await lockClient.query('COMMIT');

        await expect(outcomePromise).resolves.toEqual({
          matchedVersions: 2,
          ready: 2,
          missing: 0,
          unrecoverable: 0,
        });
        const versions = await query<{ id: string; availability: string }>(
          `SELECT id, availability
           FROM wujie_asset_versions
           WHERE id = ANY($1::text[])
           ORDER BY id`,
          [[initialVersionId, arrivedVersionId]],
        );
        expect(versions.rows).toEqual([
          { id: initialVersionId, availability: 'ready' },
          { id: arrivedVersionId, availability: 'ready' },
        ].sort((left, right) => left.id.localeCompare(right.id)));
      } finally {
        await lockClient.query('ROLLBACK').catch(() => undefined);
        await lockClient.end();
      }
    });
  }, 30_000);

  postgresIt('retries before version updates when a different exact-path asset arrives during the asset lock wait', async () => {
    await withIsolatedPostgres('asset_lifecycle_recovery_new_asset_retry', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const initialAssetId = randomUUID();
      const arrivedAssetId = randomUUID();
      const initialVersionId = randomUUID();
      const arrivedVersionId = randomUUID();
      const initialPlacementId = randomUUID();
      const arrivedPlacementId = randomUUID();
      const managedUrl = '/api/serve-upload/uploads/different-asset-race.png';
      const storageKey = 'uploads/different-asset-race.png';
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Recovery new asset retry')`,
        [projectId, ownerId],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'trashed')`,
        [initialAssetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, storage_key, availability
         ) VALUES ($1, $2, $3, $4, $5, $6, 'missing')`,
        [initialVersionId, initialAssetId, ownerId, projectId, managedUrl, storageKey],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [initialAssetId, initialVersionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status, deleted_at
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-new-asset-initial',
                   'canvas-image', 'image-new-asset-initial', 'trashed', now())`,
        [initialPlacementId, ownerId, projectId, initialAssetId, initialVersionId],
      );

      const applicationName = `asset-new-candidate-${randomUUID()}`;
      const businessUrl = withApplicationName(databaseUrl, applicationName);
      await closePool();
      process.env.DATABASE_URL = businessUrl;
      process.env.PGDATABASE_URL = businessUrl;
      const { recordLegacyRecoveryOutcome } = await import('../../src/lib/asset-core/media-health');

      const raceClient = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
      await raceClient.connect();
      try {
        await raceClient.query('BEGIN');
        await raceClient.query(
          'UPDATE wujie_assets SET updated_at = clock_timestamp() WHERE id = $1',
          [initialAssetId],
        );
        const outcomePromise = recordLegacyRecoveryOutcome({
          localPath: storageKey,
          success: true,
          method: 's3',
        });
        await waitForApplicationLockCount(query, applicationName, 1);

        await raceClient.query(
          `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
           VALUES ($1, $2, $3, 'image', 'trashed')`,
          [arrivedAssetId, ownerId, projectId],
        );
        await raceClient.query(
          `INSERT INTO wujie_asset_versions(
             id, asset_id, owner_id, project_id, file_url, storage_key, availability
           ) VALUES ($1, $2, $3, $4, $5, $6, 'missing')`,
          [arrivedVersionId, arrivedAssetId, ownerId, projectId, managedUrl, storageKey],
        );
        await raceClient.query(
          'UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1',
          [arrivedAssetId, arrivedVersionId],
        );
        await raceClient.query(
          `INSERT INTO wujie_workspace_placements(
             id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
             entity_type, entity_id, status, deleted_at
           ) VALUES ($1, $2, $3, $4, $5, 'canvas', 'canvas-new-asset-arrived',
                     'canvas-image', 'image-new-asset-arrived', 'trashed', now())`,
          [arrivedPlacementId, ownerId, projectId, arrivedAssetId, arrivedVersionId],
        );
        await raceClient.query('COMMIT');

        await expect(outcomePromise).resolves.toEqual({
          matchedVersions: 2,
          ready: 2,
          missing: 0,
          unrecoverable: 0,
        });
        const versions = await query<{ id: string; asset_id: string; availability: string }>(
          `SELECT id, asset_id, availability
           FROM wujie_asset_versions
           WHERE id = ANY($1::text[])
           ORDER BY asset_id, id`,
          [[initialVersionId, arrivedVersionId]],
        );
        expect(versions.rows).toEqual([
          { id: initialVersionId, asset_id: initialAssetId, availability: 'ready' },
          { id: arrivedVersionId, asset_id: arrivedAssetId, availability: 'ready' },
        ].sort((left, right) => left.asset_id.localeCompare(right.asset_id) || left.id.localeCompare(right.id)));
        const attempts = await query<{ asset_version_id: string; status: string }>(
          `SELECT asset_version_id, status
           FROM wujie_asset_media_recovery_attempts
           WHERE asset_version_id = ANY($1::text[])
           ORDER BY asset_version_id`,
          [[initialVersionId, arrivedVersionId]],
        );
        expect(attempts.rows).toEqual([
          { asset_version_id: initialVersionId, status: 'succeeded' },
          { asset_version_id: arrivedVersionId, status: 'succeeded' },
        ].sort((left, right) => left.asset_version_id.localeCompare(right.asset_version_id)));
      } finally {
        await raceClient.query('ROLLBACK').catch(() => undefined);
        await raceClient.end();
      }
    });
  }, 30_000);
});
