import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

describe('multi-platform export PostgreSQL concurrency', () => {
  it('persists one idempotent image, two documents, and no credit ledger rows', async () => {
    const databaseUrl = process.env.TEST_PGDATABASE_URL?.trim();
    expect(databaseUrl, [
      'TEST_PGDATABASE_URL is required for this dedicated Task 6 integration test.',
      'Do not point it at PGDATABASE_URL or a production database.',
    ].join(' ')).toBeTruthy();
    expect(databaseUrl).not.toBe(process.env.PGDATABASE_URL);
    process.env.POSTGRES_TEST_DATABASE_URL = databaseUrl;

    await withIsolatedPostgres('mpe_task_6_concurrency', async ({ databaseUrl: isolatedUrl, query }) => {
      const migration = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
        cwd: process.cwd(), encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: isolatedUrl, PGDATABASE_URL: isolatedUrl },
      });
      expect(migration.status, migration.stderr || migration.stdout).toBe(0);
      const [core, taskStorage, artifacts] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/multi-platform-export/artifacts'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      const userId = `mpe-user-${randomUUID()}`;
      const projectId = `mpe-project-${randomUUID()}`;
      const sourceId = `version-source-${randomUUID()}`;
      const now = Date.now();
      await query(
        `INSERT INTO wujie_users(id, name, password_hash, role, status, product_type, storage_folder, created_at, updated_at)
         VALUES ($1, 'MPE test', 'test-only', 'user', 'active', 'canvas', $2, $3, $3)`,
        [userId, `data/users/${userId}`, now],
      );
      await query('INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, $3)', [projectId, userId, 'MPE project']);
      const sourceBytes = Buffer.from('source');
      const sourceChecksum = createHash('sha256').update(sourceBytes).digest('hex');
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status, current_version_id)
         VALUES ($1, $2, $3, 'image', 'active', NULL)`,
        [`asset-${sourceId}`, userId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(id, asset_id, owner_id, project_id, file_url, availability, mime_type,
           byte_size, checksum, idempotency_key, request_digest, metadata)
         VALUES ($1, $2, $3, $4, $5, 'ready', 'image/png', $6, $7, $8, $9, '{}'::jsonb)`,
        [sourceId, `asset-${sourceId}`, userId, projectId,
          `data:image/png;base64,${sourceBytes.toString('base64')}`, sourceBytes.length,
          sourceChecksum, `seed-${sourceId}`, 'e'.repeat(64)],
      );
      await query('UPDATE wujie_assets SET current_version_id = $1 WHERE id = $2', [sourceId, `asset-${sourceId}`]);

      const imageBytes = Buffer.from('derived-image');
      const checksum = createHash('sha256').update(imageBytes).digest('hex');
      const persistBytes = vi.fn(async ({ bytes, filename, mimeType }: { bytes: Buffer; filename: string; mimeType: string }) => ({
        url: `data:${mimeType};base64,${bytes.toString('base64')}`, availability: 'ready' as const,
        mimeType, byteSize: bytes.length, checksum, storageKey: `test/${filename}`,
      }));
      const imageInput = {
        actorUserId: userId, projectId, runId: 'run-mpe', sourceAssetVersionId: sourceId,
        presetId: 'instagram-post', presetVersion: 1, platform: 'instagram', usage: 'post',
        width: 10, height: 10, fit: 'cover' as const, outputFormat: 'png' as const,
        outputFilename: 'mpe-post.png', requestDigest: 'a'.repeat(64),
        transformed: { bytes: imageBytes, mimeType: 'image/png' as const, sha256: checksum }, persistBytes,
      };
      const concurrent = await Promise.all(Array.from({ length: 12 }, () => artifacts.persistExportImageVersion(imageInput)));
      expect(new Set(concurrent.map(result => result.version.id))).toHaveLength(1);
      expect(concurrent.filter(result => !result.reused)).toHaveLength(1);
      const version = concurrent[0]!.version;
      const artifactPersist = vi.fn(async ({ bytes, filename, mimeType }: { bytes: Buffer; filename: string; mimeType: string }) => ({
        url: `data:${mimeType};base64,${bytes.toString('base64')}`, availability: 'ready' as const,
        mimeType, byteSize: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex'),
        storageKey: `test/${filename}`,
      }));
      await artifacts.persistExportArtifacts({
        actorUserId: userId, projectId, runId: 'run-mpe', requestDigest: 'a'.repeat(64),
        createdAt: '2026-09-09T00:00:00.000Z', frozenParameters: {}, failures: [],
        images: [{
          version, filename: 'mpe-post.png', bytes: imageBytes, sourceAssetVersionId: sourceId,
          platform: 'instagram', usage: 'post', width: 10, height: 10,
          mimeType: 'image/png', sha256: checksum,
        }], persistBytes: artifactPersist,
      });
      const counts = await query<{ kind: string; count: string }>(
        `SELECT a.kind, COUNT(*)::text AS count FROM wujie_asset_versions v
         JOIN wujie_assets a ON a.id = v.asset_id WHERE v.owner_id = $1 AND v.project_id = $2
         GROUP BY a.kind ORDER BY a.kind`, [userId, projectId],
      );
      expect(counts.rows).toEqual([{ kind: 'document', count: '2' }, { kind: 'image', count: '2' }]);
      const ledger = await query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM wujie_credit_transactions WHERE user_id = $1', [userId],
      );
      expect(ledger.rows[0]?.count).toBe('0');
    });
  }, 60_000);
});
