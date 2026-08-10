import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withIsolatedPostgres } from '../helpers/postgres-test-database';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; Stage 2 asset schema PostgreSQL tests skipped.',
  );
}

function migrate(isolatedDatabaseUrl: string): void {
  const result = spawnSync(
    process.execPath,
    [resolve(process.cwd(), 'scripts/run-migrations.mjs')],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: isolatedDatabaseUrl,
        PGDATABASE_URL: isolatedDatabaseUrl,
      },
    },
  );

  expect(result.status, result.stderr || result.stdout).toBe(0);
}

describe('Stage 2 asset schema migration', () => {
  postgresIt('creates the asset graph tables and enforces their database invariants', async () => {
    await withIsolatedPostgres('stage-2-asset-schema', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      migrate(databaseUrl);

      const tableExists = async (tableName: string): Promise<boolean> => {
        const result = await query(
          'SELECT to_regclass(current_schema() || $1)::text AS relation',
          [`.${tableName}`],
        );
        return result.rows[0]?.relation === tableName;
      };

      await expect(tableExists('wujie_projects')).resolves.toBe(true);
      await expect(tableExists('wujie_assets')).resolves.toBe(true);
      await expect(tableExists('wujie_asset_versions')).resolves.toBe(true);
      await expect(tableExists('wujie_asset_version_parents')).resolves.toBe(true);
      await expect(tableExists('wujie_workspace_placements')).resolves.toBe(true);
      await expect(tableExists('wujie_asset_migration_checkpoints')).resolves.toBe(true);
      await expect(tableExists('wujie_media_gc_candidates')).resolves.toBe(true);

      const ownerId = randomUUID();
      const projectId = randomUUID();
      const firstAssetId = randomUUID();
      const secondAssetId = randomUUID();
      const firstVersionId = randomUUID();
      const secondVersionId = randomUUID();

      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Asset schema test', 'active'],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, $4, $5), ($6, $2, $3, $4, $5)`,
        [firstAssetId, ownerId, projectId, 'image', 'active', secondAssetId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
          id, asset_id, owner_id, project_id, file_url, availability, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $9, $3, $4, $10, $6, $11)`,
        [
          firstVersionId,
          firstAssetId,
          ownerId,
          projectId,
          'https://example.test/first.png',
          'ready',
          'first-key',
          secondVersionId,
          secondAssetId,
          'https://example.test/second.png',
          'second-key',
        ],
      );

      await expect(query(
        'INSERT INTO wujie_assets(id, owner_id, project_id, kind, status) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), ownerId, projectId, 'invalid-kind', 'active'],
      )).rejects.toThrow();
      await expect(query(
        'INSERT INTO wujie_assets(id, owner_id, project_id, kind, status) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), ownerId, projectId, 'image', 'invalid-status'],
      )).rejects.toThrow();
      await expect(query(
        `INSERT INTO wujie_asset_version_parents(
          asset_id, owner_id, project_id, version_id, parent_version_id, parent_order
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [firstAssetId, ownerId, projectId, firstVersionId, secondVersionId, 0],
      )).rejects.toThrow();
      await expect(query(
        `INSERT INTO wujie_asset_versions(
          id, asset_id, owner_id, project_id, file_url, availability, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), firstAssetId, ownerId, projectId, 'https://example.test/duplicate.png', 'ready', 'first-key'],
      )).rejects.toThrow();
      await expect(query(
        `INSERT INTO wujie_schema_migrations(version, checksum)
         VALUES ($1, $2)`,
        ['20260810_wj_stable_s2_assets.sql', 'different-checksum'],
      )).rejects.toThrow();
    });
  });
});
