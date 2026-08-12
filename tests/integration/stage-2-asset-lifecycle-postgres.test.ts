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

describe('stage 2 asset lifecycle PostgreSQL contract', () => {
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
});
