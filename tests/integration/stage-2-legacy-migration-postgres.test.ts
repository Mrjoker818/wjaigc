import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  LegacyMigrationError,
  migrateLegacyProjectOnWrite,
} from '@/lib/asset-core/legacy-migration';
import { readProjectSnapshot } from '@/lib/asset-core/project-readers';

import {
  type QueryFn,
  withIsolatedPostgres,
} from '../helpers/postgres-test-database';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;
const fixturesDirectory = resolve(process.cwd(), 'tests/fixtures/projects');

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; Stage 2 legacy migration PostgreSQL tests skipped.',
  );
}

function migrate(isolatedDatabaseUrl: string): void {
  const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: isolatedDatabaseUrl, PGDATABASE_URL: isolatedDatabaseUrl },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

function fixture(name: string, actorUserId: string, projectId: string): Record<string, unknown> {
  const value = JSON.parse(
    readFileSync(resolve(fixturesDirectory, name), 'utf8'),
  ) as Record<string, unknown>;
  return { ...value, id: projectId, userId: actorUserId };
}

async function seedLegacyProject(
  query: QueryFn,
  actorUserId: string,
  project: Record<string, unknown>,
): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS wujie_user_data (
      user_id TEXT NOT NULL,
      data_key TEXT NOT NULL,
      data_value JSONB,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, data_key)
    )
  `);
  await query(
    `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
     VALUES ($1, 'projects', $2::jsonb, $3)`,
    [actorUserId, JSON.stringify([project]), Date.now()],
  );
}

async function graphCounts(query: QueryFn, actorUserId: string, projectId: string): Promise<Record<string, string>> {
  const result = await query<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM wujie_projects WHERE owner_id = $1 AND id = $2)::text AS projects,
       (SELECT count(*) FROM wujie_assets WHERE owner_id = $1 AND project_id = $2)::text AS assets,
       (SELECT count(*) FROM wujie_asset_versions WHERE owner_id = $1 AND project_id = $2)::text AS versions,
       (SELECT count(*) FROM wujie_workspace_placements WHERE owner_id = $1 AND project_id = $2)::text AS placements,
       (SELECT count(*) FROM wujie_asset_migration_checkpoints WHERE owner_id = $1 AND project_id = $2)::text AS checkpoints`,
    [actorUserId, projectId],
  );
  return result.rows[0] ?? {};
}

describe('legacy project copy-on-write migration', () => {
  postgresIt('creates no graph rows when a legacy project is only opened for reading', async () => {
    await withIsolatedPostgres('stage-2-legacy-read-only', async ({ databaseUrl: isolatedUrl, query }) => {
      migrate(isolatedUrl);
      const actorUserId = randomUUID();
      const projectId = randomUUID();
      const legacy = fixture('v1-images-alias.json', actorUserId, projectId);
      await seedLegacyProject(query, actorUserId, legacy);

      expect(readProjectSnapshot(legacy).sourceSchemaVersion).toBe(1);
      await expect(graphCounts(query, actorUserId, projectId)).resolves.toEqual({
        projects: '0', assets: '0', versions: '0', placements: '0', checkpoints: '0',
      });
    });
  });

  postgresIt('creates project, assets, versions, placements, and checkpoint in the first write transaction', async () => {
    await withIsolatedPostgres('stage-2-legacy-first-write', async ({ databaseUrl: isolatedUrl, query }) => {
      migrate(isolatedUrl);
      const actorUserId = randomUUID();
      const projectId = randomUUID();
      const legacy = fixture('v1-images-alias.json', actorUserId, projectId);
      await seedLegacyProject(query, actorUserId, legacy);

      const result = await migrateLegacyProjectOnWrite({ actorUserId, projectId });

      expect(result).toMatchObject({ migrated: true, reused: false, sourceSchemaVersion: 1 });
      expect(result.project.schemaVersion).toBe(3);
      await expect(graphCounts(query, actorUserId, projectId)).resolves.toEqual({
        projects: '1', assets: '1', versions: '1', placements: '1', checkpoints: '1',
      });
      const stored = await query<{
        schema_version: number;
        metadata: { legacyAuditPayload?: unknown };
        status: string;
      }>(
        'SELECT schema_version, metadata, status FROM wujie_projects WHERE owner_id = $1 AND id = $2',
        [actorUserId, projectId],
      );
      expect(stored.rows[0]).toMatchObject({ schema_version: 3, status: 'active' });
      expect(stored.rows[0]?.metadata.legacyAuditPayload).toEqual(legacy);
      const source = await query<{ data_value: unknown }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = 'projects'`,
        [actorUserId],
      );
      expect(source.rows[0]?.data_value).toEqual([legacy]);
    });
  });

  postgresIt('reuses checkpoint mappings by legacy image ID and never merges shared URLs', async () => {
    await withIsolatedPostgres('stage-2-legacy-rerun', async ({ databaseUrl: isolatedUrl, query }) => {
      migrate(isolatedUrl);
      const actorUserId = randomUUID();
      const projectId = randomUUID();
      const legacy = fixture('v1-shared-placement.json', actorUserId, projectId);
      await seedLegacyProject(query, actorUserId, legacy);

      const first = await migrateLegacyProjectOnWrite({ actorUserId, projectId });
      const second = await migrateLegacyProjectOnWrite({ actorUserId, projectId });

      expect(first.mappings).toEqual(second.mappings);
      expect(second).toMatchObject({ migrated: false, reused: true });
      expect(Object.keys(second.mappings)).toEqual(['legacy-shared-a', 'legacy-shared-b']);
      expect(new Set(Object.values(second.mappings).map((mapping) => mapping.assetId)).size).toBe(2);
      await expect(graphCounts(query, actorUserId, projectId)).resolves.toEqual({
        projects: '1', assets: '2', versions: '2', placements: '2', checkpoints: '1',
      });
    });
  });

  postgresIt('rolls back every graph row and keeps the v1 reader after media persistence failure', async () => {
    await withIsolatedPostgres('stage-2-legacy-rollback', async ({ databaseUrl: isolatedUrl, query }) => {
      migrate(isolatedUrl);
      const actorUserId = randomUUID();
      const projectId = randomUUID();
      const legacy = fixture('v1-data-url.json', actorUserId, projectId);
      await seedLegacyProject(query, actorUserId, legacy);
      const persistMedia = vi.fn(async () => {
        throw new Error('fixture persistence failure');
      });

      await expect(migrateLegacyProjectOnWrite({ actorUserId, projectId, persistMedia }))
        .rejects.toMatchObject({
          code: 'LEGACY_MEDIA_PERSIST_FAILED',
        } satisfies Partial<LegacyMigrationError>);
      await expect(graphCounts(query, actorUserId, projectId)).resolves.toEqual({
        projects: '0', assets: '0', versions: '0', placements: '0', checkpoints: '0',
      });
      const source = await query<{ data_value: Record<string, unknown>[] }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = 'projects'`,
        [actorUserId],
      );
      expect(readProjectSnapshot(source.rows[0]?.data_value[0]).sourceSchemaVersion).toBe(1);
    });
  });

  postgresIt('reuses deterministic mappings after partial external persistence and full database rollback', async () => {
    await withIsolatedPostgres('stage-2-legacy-retry-stable-mapping', async ({ databaseUrl: isolatedUrl, query }) => {
      migrate(isolatedUrl);
      const actorUserId = randomUUID();
      const projectId = randomUUID();
      const legacy = fixture('v1-data-url.json', actorUserId, projectId);
      const firstImage = (legacy.canvasImages as Record<string, unknown>[])[0];
      legacy.canvasImages = [
        { ...firstImage, id: 'legacy-data-first' },
        { ...firstImage, id: 'legacy-data-second', x: 80 },
      ];
      await seedLegacyProject(query, actorUserId, legacy);

      const failedAttemptMappings = new Map<string, unknown>();
      const retryMappings = new Map<string, unknown>();
      let attempt: 'failing' | 'retry' = 'failing';
      const persistMedia = vi.fn(async (input) => {
        const target = attempt === 'failing' ? failedAttemptMappings : retryMappings;
        target.set(input.legacyImageId, input.mapping);
        if (attempt === 'failing' && input.legacyImageId === 'legacy-data-second') {
          throw new Error('fixture second persistence failure');
        }
        return {
          url: `/api/serve-upload/uploads/${input.legacyImageId}.png`,
          storageKey: `uploads/${input.legacyImageId}.png`,
          mimeType: 'image/png',
        };
      });

      await expect(migrateLegacyProjectOnWrite({ actorUserId, projectId, persistMedia }))
        .rejects.toMatchObject({
          code: 'LEGACY_MEDIA_PERSIST_FAILED',
        } satisfies Partial<LegacyMigrationError>);
      expect(persistMedia).toHaveBeenCalledTimes(2);
      await expect(graphCounts(query, actorUserId, projectId)).resolves.toEqual({
        projects: '0', assets: '0', versions: '0', placements: '0', checkpoints: '0',
      });

      attempt = 'retry';
      const retried = await migrateLegacyProjectOnWrite({ actorUserId, projectId, persistMedia });

      expect(persistMedia).toHaveBeenCalledTimes(4);
      expect(retryMappings).toEqual(failedAttemptMappings);
      expect(Object.fromEntries(retryMappings)).toEqual(retried.mappings);
      await expect(graphCounts(query, actorUserId, projectId)).resolves.toEqual({
        projects: '1', assets: '2', versions: '2', placements: '2', checkpoints: '1',
      });
      const distinct = await query<{ assets: string; versions: string; placements: string }>(
        `SELECT
           count(DISTINCT asset.id)::text AS assets,
           count(DISTINCT version.id)::text AS versions,
           count(DISTINCT placement.id)::text AS placements
         FROM wujie_assets asset
         JOIN wujie_asset_versions version
           ON version.asset_id = asset.id AND version.owner_id = $1 AND version.project_id = $2
         JOIN wujie_workspace_placements placement
           ON placement.asset_id = asset.id AND placement.owner_id = $1 AND placement.project_id = $2
         WHERE asset.owner_id = $1 AND asset.project_id = $2`,
        [actorUserId, projectId],
      );
      expect(distinct.rows).toEqual([{ assets: '2', versions: '2', placements: '2' }]);
    });
  });

  postgresIt('persists data media but never downloads remote recovery URLs', async () => {
    await withIsolatedPostgres('stage-2-legacy-media-policy', async ({ databaseUrl: isolatedUrl, query }) => {
      migrate(isolatedUrl);
      const actorUserId = randomUUID();
      const dataProjectId = randomUUID();
      const remoteProjectId = randomUUID();
      const dataProject = fixture('v1-data-url.json', actorUserId, dataProjectId);
      const remoteProject = fixture('v1-source-url-recovery.json', actorUserId, remoteProjectId);
      await seedLegacyProject(query, actorUserId, dataProject);
      const sourceRow = await query<{ data_value: Record<string, unknown>[] }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = 'projects'`,
        [actorUserId],
      );
      await query(
        `UPDATE wujie_user_data SET data_value = $2::jsonb
         WHERE user_id = $1 AND data_key = 'projects'`,
        [actorUserId, JSON.stringify([...(sourceRow.rows[0]?.data_value ?? []), remoteProject])],
      );
      const persistMedia = vi.fn(async () => ({
        url: '/api/serve-upload/uploads/persisted.png',
        storageKey: 'uploads/persisted.png',
        mimeType: 'image/png',
      }));

      await migrateLegacyProjectOnWrite({ actorUserId, projectId: dataProjectId, persistMedia });
      await migrateLegacyProjectOnWrite({ actorUserId, projectId: remoteProjectId, persistMedia });

      expect(persistMedia).toHaveBeenCalledTimes(1);
      const versions = await query<{
        project_id: string;
        file_url: string;
        availability: string;
        recovery_source_url: string | null;
      }>(
        `SELECT project_id, file_url, availability, recovery_source_url
         FROM wujie_asset_versions WHERE owner_id = $1 ORDER BY project_id`,
        [actorUserId],
      );
      expect(versions.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          project_id: dataProjectId,
          file_url: '/api/serve-upload/uploads/persisted.png',
          availability: 'ready',
        }),
        expect.objectContaining({
          project_id: remoteProjectId,
          file_url: '',
          availability: 'missing',
          recovery_source_url: 'https://media.example.invalid/original.png',
        }),
      ]));
    });
  });

  postgresIt('fails closed for an actor who does not own the requested legacy project', async () => {
    await withIsolatedPostgres('stage-2-legacy-authorization', async ({ databaseUrl: isolatedUrl, query }) => {
      migrate(isolatedUrl);
      const ownerId = randomUUID();
      const attackerId = randomUUID();
      const projectId = randomUUID();
      await seedLegacyProject(query, ownerId, fixture('v1-images-alias.json', ownerId, projectId));

      await expect(migrateLegacyProjectOnWrite({ actorUserId: attackerId, projectId }))
        .rejects.toMatchObject({
          code: 'LEGACY_PROJECT_NOT_FOUND',
        } satisfies Partial<LegacyMigrationError>);
      await expect(graphCounts(query, attackerId, projectId)).resolves.toEqual({
        projects: '0', assets: '0', versions: '0', placements: '0', checkpoints: '0',
      });
    });
  });
});
