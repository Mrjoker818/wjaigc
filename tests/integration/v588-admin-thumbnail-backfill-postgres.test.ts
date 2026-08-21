import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createPostgresThumbnailBackfillDependencies } from '@/lib/asset-core/thumbnail-backfill';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;
const migrationVersion = '20260821_v588_admin_thumbnail_variants.sql';
const migrationPath = resolve(process.cwd(), 'migrations', migrationVersion);

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; V5.8.8 thumbnail backfill PostgreSQL tests skipped.',
  );
}

function runMigrations(isolatedDatabaseUrl: string): void {
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

async function seedImageVersion(query: Parameters<Parameters<typeof withIsolatedPostgres>[1]>[0]['query']) {
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const assetId = randomUUID();
  const versionId = randomUUID();
  await query(
    'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
    [projectId, ownerId, 'Thumbnail backfill', 'active'],
  );
  await query(
    `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
     VALUES ($1, $2, $3, 'image', 'active')`,
    [assetId, ownerId, projectId],
  );
  await query(
    `INSERT INTO wujie_asset_versions(
       id, asset_id, owner_id, project_id, file_url, availability,
       width, height, idempotency_key
     ) VALUES ($1, $2, $3, $4, $5, 'ready', 2048, 1024, $6)`,
    [versionId, assetId, ownerId, projectId, 'https://example.test/source.png', randomUUID()],
  );
  return { ownerId, projectId, assetId, versionId };
}

const readyResult = {
  fileUrl: '/api/serve-upload/thumbnails/version/512.webp',
  storageKey: 'thumbnail-version-512.webp',
  checksum: `sha256:${'a'.repeat(64)}`,
  mimeType: 'image/webp' as const,
  byteSize: 1234,
  width: 512,
  height: 256,
};

describe('V5.8.8 admin thumbnail variants on real PostgreSQL', () => {
  postgresIt('applies the checksum-managed migration and enforces one row per version and size', async () => {
    await withIsolatedPostgres('v588-thumbnail-schema', async ({ databaseUrl: isolatedUrl, query }) => {
      runMigrations(isolatedUrl);
      runMigrations(isolatedUrl);
      const expectedChecksum = createHash('sha256')
        .update(await readFile(migrationPath))
        .digest('hex');
      const ledger = await query<{ checksum: string }>(
        'SELECT checksum FROM wujie_schema_migrations WHERE version = $1',
        [migrationVersion],
      );
      expect(ledger.rows).toEqual([{ checksum: expectedChecksum }]);

      const seeded = await seedImageVersion(query);
      await query(
        `INSERT INTO wujie_asset_thumbnail_variants(
           asset_version_id, size, asset_id, owner_id, project_id
         ) VALUES ($1, 512, $2, $3, $4)`,
        [seeded.versionId, seeded.assetId, seeded.ownerId, seeded.projectId],
      );
      await expect(query(
        `INSERT INTO wujie_asset_thumbnail_variants(
           asset_version_id, size, asset_id, owner_id, project_id
         ) VALUES ($1, 512, $2, $3, $4)`,
        [seeded.versionId, seeded.assetId, seeded.ownerId, seeded.projectId],
      )).rejects.toThrow();
    });
  });

  postgresIt('serializes concurrent claims and rejects a stale lease finalization', async () => {
    await withIsolatedPostgres('v588-thumbnail-lease', async ({ databaseUrl: isolatedUrl, query }) => {
      runMigrations(isolatedUrl);
      const seeded = await seedImageVersion(query);
      const deps = createPostgresThumbnailBackfillDependencies();
      await expect(deps.discover({ dryRun: false, limit: 2 })).resolves.toBe(2);

      const expiry = new Date(Date.now() + 60_000);
      const [first, second] = await Promise.all([
        deps.claim({ leaseOwner: 'worker-a', leaseExpiresAt: expiry, limit: 2 }),
        deps.claim({ leaseOwner: 'worker-b', leaseExpiresAt: expiry, limit: 2 }),
      ]);
      const claimed = [...first, ...second];
      expect(claimed).toHaveLength(2);
      expect(new Set(claimed.map(item => `${item.assetVersionId}:${item.size}`)).size).toBe(2);

      const staleTarget = claimed.find(item => item.size === 512) ?? claimed[0];
      await query(
        `UPDATE wujie_asset_thumbnail_variants
         SET lease_expires_at = now() - interval '1 second'
         WHERE asset_version_id = $1 AND size = $2`,
        [staleTarget.assetVersionId, staleTarget.size],
      );
      const [replacement] = await deps.claim({
        leaseOwner: 'worker-replacement',
        leaseExpiresAt: new Date(Date.now() + 60_000),
        limit: 1,
      });
      expect(replacement).toEqual(expect.objectContaining({
        assetVersionId: seeded.versionId,
        size: staleTarget.size,
        leaseOwner: 'worker-replacement',
      }));
      await expect(deps.complete(staleTarget, readyResult)).resolves.toBe(false);
      await expect(deps.complete(replacement, readyResult)).resolves.toBe(true);

      const row = await query<{ status: string; lease_owner: string | null }>(
        `SELECT status, lease_owner FROM wujie_asset_thumbnail_variants
         WHERE asset_version_id = $1 AND size = $2`,
        [replacement.assetVersionId, replacement.size],
      );
      expect(row.rows).toEqual([{ status: 'ready', lease_owner: null }]);
    });
  });
});
