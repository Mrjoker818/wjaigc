import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectAssetGraphDoctorFacts,
  summarizeAssetGraphDoctor,
} from '../../scripts/doctor-asset-status.mjs';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

function migrate(databaseUrl: string): void {
  const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    timeout: 20_000,
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

describe('Stage 2 Doctor PostgreSQL projection audit', () => {
  postgresIt('verifies exact graph identities and excludes protected assets from unregistered GC candidates', async () => {
    await withIsolatedPostgres('doctor_asset_projection', async ({ databaseUrl, query }) => {
      migrate(databaseUrl);
      await query(
        `CREATE TABLE wujie_user_data (
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
      const imageId = 'legacy-image-a';
      const fileUrl = '/api/serve-upload/uploads/doctor-a.png';
      const transform = {
        x: 10,
        y: 20,
        width: 320,
        height: 240,
        originalWidth: 640,
        originalHeight: 480,
        rotation: 0,
        zIndex: 1,
      };
      const legacyProject = {
        id: projectId,
        userId: ownerId,
        images: [{ id: imageId, url: '/uploads/doctor-a.png', ...transform }],
      };

      await query(
        `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
         VALUES ($1, 'projects', $2::jsonb, 1)`,
        [ownerId, JSON.stringify([legacyProject])],
      );
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name, status, schema_version)
         VALUES ($1, $2, 'Doctor audit', 'active', 3)`,
        [projectId, ownerId],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ($1, $2, $3, 'image', 'active')`,
        [assetId, ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, storage_key, availability
         ) VALUES ($1, $2, $3, $4, $5, 'uploads/doctor-a.png', 'ready')`,
        [versionId, assetId, ownerId, projectId, fileUrl],
      );
      await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, versionId]);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind, workspace_id,
           entity_type, entity_id, status, transform
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', $3, 'canvas-image', $6, 'active', $7::jsonb)`,
        [placementId, ownerId, projectId, assetId, versionId, imageId, JSON.stringify(transform)],
      );
      await query(
        `INSERT INTO wujie_asset_migration_checkpoints(
           id, owner_id, project_id, legacy_project_id, status, checkpoint
         ) VALUES ($1, $2, $3, $3, 'completed', $4::jsonb)`,
        [checkpointId, ownerId, projectId, JSON.stringify({
          sourceSchemaVersion: 1,
          legacyImageMappings: { [imageId]: { assetId, versionId, placementId } },
        })],
      );

      const client = { query };
      const healthy = summarizeAssetGraphDoctor(await collectAssetGraphDoctorFacts(client, { mode: 'asset-v3' }));
      expect(healthy.queryErrors).toEqual([]);
      expect(healthy.releaseReady).toBe(true);
      expect(healthy.shadowComparison).toMatchObject({ matchingProjects: 1, mismatchedProjects: 0 });

      await query(
        `UPDATE wujie_asset_versions
         SET file_url = '/v1/images/proxy/img_expired', storage_key = NULL,
             recovery_source_url = NULL, availability = 'ready'
         WHERE id = $1`,
        [versionId],
      );
      const falseReady = summarizeAssetGraphDoctor(await collectAssetGraphDoctorFacts(client, { mode: 'asset-v3' }));
      expect(falseReady.media).toMatchObject({
        falseReadyCurrentVersions: 1,
        falseReadyActivePlacements: 1,
      });
      expect(falseReady.assetV3Blockers).toContain('non-durable-ready-media');
      expect(falseReady.releaseReady).toBe(false);

      await query(
        `UPDATE wujie_asset_versions
         SET file_url = $2, storage_key = 'uploads/doctor-a.png'
         WHERE id = $1`,
        [versionId, fileUrl],
      );

      await query(
        `UPDATE wujie_workspace_placements
         SET transform = jsonb_set(transform, '{x}', '999'::jsonb)
         WHERE id = $1`,
        [placementId],
      );
      const wrongTransform = summarizeAssetGraphDoctor(await collectAssetGraphDoctorFacts(client, { mode: 'asset-v3' }));
      expect(wrongTransform.releaseReady).toBe(false);
      expect(wrongTransform.shadowComparison.mismatchedProjects).toBe(1);

      await query(
        `UPDATE wujie_workspace_placements
         SET status = 'trashed', deleted_at = now(), transform = $2::jsonb
         WHERE id = $1`,
        [placementId, JSON.stringify(transform)],
      );
      await query("UPDATE wujie_assets SET status = 'trashed' WHERE id = $1", [assetId]);
      await query(
        `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
         VALUES ($1, 'workflow', $2::jsonb, 2)`,
        [ownerId, JSON.stringify({ referencedImage: fileUrl })],
      );
      const protectedGc = await collectAssetGraphDoctorFacts(client, { mode: 'asset-v3' });
      expect(protectedGc.queryErrors).toEqual([]);
      expect(protectedGc.unregisteredGcCandidates).toBe(0);

      await query("DELETE FROM wujie_user_data WHERE user_id = $1 AND data_key = 'workflow'", [ownerId]);
      await query(
        `UPDATE wujie_user_data
         SET data_value = $2::jsonb
         WHERE user_id = $1 AND data_key = 'projects'`,
        [ownerId, JSON.stringify([{ ...legacyProject, userId: 'different-owner' }])],
      );
      const conflictingOwner = await collectAssetGraphDoctorFacts(client, { mode: 'asset-v3' });
      expect(conflictingOwner.queryErrors).toEqual([]);
      expect(conflictingOwner.unregisteredGcCandidates).toBe(0);
    });
  }, 30_000);
});
