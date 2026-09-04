import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transferCanvasSkillAsset } from '@/lib/skill-runtime/canvas-client';
import type { CanvasImage } from '@/lib/user-types';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('Skill placement recovery against isolated PostgreSQL', () => {
  const ownerId = `skill-restore-owner-${randomUUID()}`;
  const projectId = `skill-restore-project-${randomUUID()}`;
  const assetId = randomUUID();
  const versionId = randomUUID();
  const runId = randomUUID();
  let pool: Pool;
  let service: ReturnType<typeof import('@/lib/asset-core/service').createAssetService>;
  let adopt: typeof import('@/lib/asset-core/legacy-migration').adoptManagedCanvasMapping;
  let placementId: string;
  const calls: string[] = [];

  beforeAll(async () => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    pool = new Pool({ connectionString: databaseUrl });
    const { createAssetService } = await import('@/lib/asset-core/service');
    const { createPostgresAssetStorage } = await import('@/lib/asset-core/storage');
    ({ adoptManagedCanvasMapping: adopt } = await import('@/lib/asset-core/legacy-migration'));
    service = createAssetService(createPostgresAssetStorage(pool));
    await pool.query(`CREATE TABLE IF NOT EXISTS wujie_user_data (
      user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
      updated_at BIGINT NOT NULL, PRIMARY KEY(user_id, data_key))`);
    await pool.query(`INSERT INTO wujie_projects(id, owner_id, name, status, schema_version, metadata)
      VALUES ($1,$2,'Skill recovery fixture','active',3,'{}'::jsonb)`, [projectId, ownerId]);
    await pool.query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ($1,'projects',$2::jsonb,$3)`, [ownerId, JSON.stringify([{
        id: projectId, userId: ownerId, name: 'Skill recovery fixture',
        createdAt: Date.now(), updatedAt: Date.now(), canvasImages: [], settings: {},
      }]), Date.now()]);
    await pool.query(`INSERT INTO wujie_assets(id,owner_id,project_id,kind,status,metadata)
      VALUES ($1,$2,$3,'image','active','{}'::jsonb)`, [assetId, ownerId, projectId]);
    await pool.query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,width,height,availability,metadata)
      VALUES ($1,$2,$3,$4,'/fixture/cake.png',1254,1254,'ready','{}'::jsonb)`,
    [versionId, assetId, ownerId, projectId]);
    await pool.query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1', [assetId, versionId]);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM wujie_workspace_placements WHERE owner_id=$1', [ownerId]);
    await pool.query('UPDATE wujie_assets SET current_version_id=NULL WHERE owner_id=$1', [ownerId]);
    await pool.query('DELETE FROM wujie_asset_versions WHERE owner_id=$1', [ownerId]);
    await pool.query('DELETE FROM wujie_assets WHERE owner_id=$1', [ownerId]);
    await pool.query('DELETE FROM wujie_projects WHERE owner_id=$1', [ownerId]);
    await pool.query('DELETE FROM wujie_user_data WHERE user_id=$1', [ownerId]);
    await pool.end();
  });

  // Transport is in-process; every asset transition and snapshot write uses real PostgreSQL.
  const fetcher: typeof fetch = async (url, init) => {
    calls.push(String(url));
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    if (url === '/api/assets/transfer') {
      const result = await service.sendVersionToWorkspace({
        actorUserId: ownerId, sourceVersionId: body.sourceVersion!, targetProjectId: body.targetProject!,
        targetWorkspaceId: body.targetWorkspace!, entityType: 'canvas-image', entityId: body.entityId!,
        idempotencyKey: body.idempotencyKey!, requestDigest: 'fixed-fixture-digest',
      });
      return Response.json({ assetId: result.version.assetId, assetVersionId: result.version.id,
        placementId: result.placement.id, placementStatus: result.placement.status,
        placementRevision: result.placement.lifecycleRevision,
        entityId: result.placement.entityId, url: result.version.file.url, reused: result.reused });
    }
    expect(url).toBe(`/api/assets/${assetId}/restore`);
    return Response.json(await service.restorePlacement({
      actorUserId: ownerId, projectId: body.projectId!, placementId: body.placementId!, assetId,
      expectedPlacementRevision: body.expectedPlacementRevision,
    }));
  };

  it('restores the original version and placement then passes the actual snapshot integrity check', async () => {
    const input = { reference: { assetId, assetVersionId: versionId, url: '/fixture/cake.png' },
      projectId, runId, sourceVersionIds: [], fetcher };
    const first = await transferCanvasSkillAsset(input);
    placementId = first.placementId!;
    await service.trashPlacement({ actorUserId: ownerId, projectId, placementId, assetId });
    await expect(transferCanvasSkillAsset(input)).rejects.toThrow('已删除');
    const restored = await transferCanvasSkillAsset({ ...input, restoreDeletedPlacement: true });
    expect(restored.placementId).toBe(placementId);
    expect(restored.assetVersionId).toBe(versionId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const image: CanvasImage = { id: restored.entityId!, url: restored.url, assetId,
        assetVersionId: versionId, placementId, x: 0, y: 0, width: 300, height: 300,
        originalWidth: 1254, originalHeight: 1254, rotation: 0, zIndex: 1, createdAt: Date.now() };
      await expect(adopt(client, { actorUserId: ownerId, projectId }, image)).resolves.not.toBeNull();
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); }
    const snapshot = await pool.query('SELECT data_value FROM wujie_user_data WHERE user_id=$1 AND data_key=\'projects\'', [ownerId]);
    expect(snapshot.rows[0].data_value[0].canvasImages).toHaveLength(1);
    expect(snapshot.rows[0].data_value[0].canvasImages[0].assetVersionId).toBe(versionId);
    await transferCanvasSkillAsset({ ...input, restoreDeletedPlacement: true });
    expect(calls.filter(url => url.endsWith('/restore'))).toHaveLength(1);
    const counts = await pool.query(`SELECT
      (SELECT count(*)::int FROM wujie_asset_versions WHERE owner_id=$1) AS versions,
      (SELECT count(*)::int FROM wujie_workspace_placements WHERE owner_id=$1 AND status='active') AS placements`, [ownerId]);
    expect(counts.rows[0]).toEqual({ versions: 1, placements: 1 });
  });

  it('serializes concurrent explicit restores without duplicating the placement or snapshot image', async () => {
    await service.trashPlacement({ actorUserId: ownerId, projectId, placementId, assetId });
    const input = { reference: { assetId, assetVersionId: versionId, url: '/fixture/cake.png' },
      projectId, runId, sourceVersionIds: [], fetcher, restoreDeletedPlacement: true };
    const results = await Promise.allSettled([transferCanvasSkillAsset(input), transferCanvasSkillAsset(input)]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    const placements = await pool.query('SELECT status FROM wujie_workspace_placements WHERE owner_id=$1', [ownerId]);
    expect(placements.rows).toEqual([{ status: 'active' }]);
    const snapshot = await pool.query('SELECT data_value FROM wujie_user_data WHERE user_id=$1 AND data_key=\'projects\'', [ownerId]);
    expect(snapshot.rows[0].data_value[0].canvasImages).toHaveLength(1);
  });

  it('does not let a delayed historical restore undo another completed restore-delete cycle', async () => {
    await service.trashPlacement({ actorUserId: ownerId, projectId, placementId, assetId });
    const delayedFetcher: typeof fetch = async (url, init) => {
      const response = await fetcher(url, init);
      if (url === '/api/assets/transfer') {
        await service.restorePlacement({ actorUserId: ownerId, projectId, placementId, assetId });
        await service.trashPlacement({ actorUserId: ownerId, projectId, placementId, assetId });
      }
      return response;
    };
    await expect(transferCanvasSkillAsset({
      reference: { assetId, assetVersionId: versionId, url: '/fixture/cake.png' },
      projectId, runId, sourceVersionIds: [], fetcher: delayedFetcher, restoreDeletedPlacement: true,
    })).rejects.toMatchObject({ code: 'ASSET_PLACEMENT_CONFLICT' });
    const placements = await pool.query('SELECT status FROM wujie_workspace_placements WHERE id=$1', [placementId]);
    expect(placements.rows).toEqual([{ status: 'trashed' }]);
    const snapshot = await pool.query('SELECT data_value FROM wujie_user_data WHERE user_id=$1 AND data_key=\'projects\'', [ownerId]);
    expect(snapshot.rows[0].data_value[0].canvasImages).toHaveLength(0);
  });

  it('retains ownership and retention-window restrictions for explicit restores', async () => {
    await service.trashPlacement({ actorUserId: ownerId, projectId, placementId, assetId });
    await expect(service.restorePlacement({ actorUserId: 'unrelated-user', projectId, placementId, assetId }))
      .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await pool.query(`UPDATE wujie_workspace_placements SET deleted_at=NOW()-INTERVAL '365 days' WHERE id=$1`, [placementId]);
    await expect(service.restorePlacement({ actorUserId: ownerId, projectId, placementId, assetId }))
      .rejects.toMatchObject({ code: 'ASSET_RESTORE_NOT_ALLOWED' });
    const placements = await pool.query('SELECT status FROM wujie_workspace_placements WHERE id=$1', [placementId]);
    expect(placements.rows).toEqual([{ status: 'trashed' }]);
  });
});
