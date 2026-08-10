import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withIsolatedPostgres } from '../helpers/postgres-test-database';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;
const migrationVersion = '20260810_wj_stable_s2_assets.sql';
const migrationPath = resolve(process.cwd(), 'migrations', migrationVersion);

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

function migrateConcurrently(isolatedDatabaseUrl: string): Promise<{
  status: number | null;
  stderr: string;
  stdout: string;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [resolve(process.cwd(), 'scripts/run-migrations.mjs')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: isolatedDatabaseUrl,
          PGDATABASE_URL: isolatedDatabaseUrl,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', rejectPromise);
    child.once('close', (status) => resolvePromise({ status, stderr, stdout }));
  });
}

describe('Stage 2 asset schema migration', () => {
  postgresIt('creates the asset graph tables and enforces their database invariants', async () => {
    await withIsolatedPostgres('stage-2-asset-schema', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      migrate(databaseUrl);

      const migrationBytes = await readFile(migrationPath);
      const migrationChecksum = createHash('sha256').update(migrationBytes).digest('hex');
      const ledger = await query<{ checksum: string }>(
        'SELECT checksum FROM wujie_schema_migrations WHERE version = $1',
        [migrationVersion],
      );
      expect(ledger.rows).toEqual([{ checksum: migrationChecksum }]);

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
        `INSERT INTO wujie_workspace_placements(
          id, owner_id, project_id, asset_id, asset_version_id,
          workspace_kind, workspace_id, entity_type, entity_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(), ownerId, projectId, firstAssetId, firstVersionId,
          'canvas', 'canvas-1', 'chat-result', 'entity-1',
        ],
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

  postgresIt('serializes concurrent runners and records each migration once', async () => {
    await withIsolatedPostgres('stage-2-asset-schema-concurrent', async ({ databaseUrl, query }) => {
      const [first, second] = await Promise.all([
        migrateConcurrently(databaseUrl),
        migrateConcurrently(databaseUrl),
      ]);

      expect(first.status, first.stderr || first.stdout).toBe(0);
      expect(second.status, second.stderr || second.stdout).toBe(0);
      const ledger = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM wujie_schema_migrations WHERE version = $1',
        [migrationVersion],
      );
      expect(ledger.rows).toEqual([{ count: '1' }]);
    });
  });

  postgresIt('exits with a checksum mismatch when an applied migration is altered', async () => {
    await withIsolatedPostgres('stage-2-asset-schema-checksum', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      await query(
        'UPDATE wujie_schema_migrations SET checksum = $2 WHERE version = $1',
        [migrationVersion, 'not-the-migration-sha256'],
      );

      const result = spawnSync(
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

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Migration checksum mismatch for ${migrationVersion}`);
    });
  });
});
