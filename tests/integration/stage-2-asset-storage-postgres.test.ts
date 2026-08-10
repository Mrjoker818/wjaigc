import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withIsolatedPostgres } from '../helpers/postgres-test-database';

type TransferVersionInput = {
  actorUserId: string;
  sourceVersionId: string;
  targetProjectId: string;
  targetWorkspaceId: string;
  entityType: 'canvas-image' | 'workflow-input' | 'workflow-output' | 'chat-attachment' | 'chat-result';
  entityId: string;
  idempotencyKey: string;
  requestDigest: string;
  transform?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type AssetService = {
  createAssetVersion(input: Record<string, unknown>): Promise<{
    asset: { id: string; ownerId: string };
    version: { id: string };
  }>;
  sendVersionToWorkspace(input: TransferVersionInput): Promise<{
    placement: { id: string; ownerId: string; status: string };
    reused: boolean;
  }>;
  trashPlacement(input: { actorUserId: string; projectId: string; placementId: string }): Promise<{
    placementTrashed: boolean;
    assetTrashed: boolean;
  }>;
  restorePlacement(input: { actorUserId: string; projectId: string; placementId: string }): Promise<{
    placement: { status: string };
  }>;
};

type AssetServiceModule = {
  createAssetService(): AssetService;
};

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; Stage 2 asset storage PostgreSQL tests skipped.',
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

async function loadService(): Promise<AssetServiceModule> {
  return import('@/lib/asset-core/service') as unknown as Promise<AssetServiceModule>;
}

async function seedProject(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
  ownerId: string,
  projectId: string,
): Promise<void> {
  await query(
    'INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, $3)',
    [projectId, ownerId, 'Asset storage test'],
  );
}

describe('Stage 2 asset storage on real PostgreSQL', () => {
  postgresIt('requires transfer idempotency columns before the service can preserve exact key and digest semantics', async () => {
    await withIsolatedPostgres('stage-2-asset-storage-schema-red', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);
      const columns = await query as (text: string, values?: unknown[]) => Promise<{ rows: Array<{ column_name: string }> }>;
      const result = await columns(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'wujie_workspace_placements'
           AND column_name IN ('idempotency_key', 'request_digest')`,
      );
      expect(result.rows.map((row) => row.column_name).sort()).toEqual([
        'idempotency_key',
        'request_digest',
      ]);
    });
  });

  postgresIt('deduplicates twenty concurrent transfers, rejects foreign ownership, and serializes delete and restore', async () => {
    await withIsolatedPostgres('stage-2-asset-storage', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);
      const actorUserId = randomUUID();
      const targetProjectId = randomUUID();
      const foreignUserId = randomUUID();
      const foreignProjectId = randomUUID();
      await seedProject(query, actorUserId, targetProjectId);
      await seedProject(query, foreignUserId, foreignProjectId);

      const { createAssetService } = await loadService();
      const service = createAssetService();
      const created = await service.createAssetVersion({
        actorUserId,
        projectId: targetProjectId,
        kind: 'image',
        file: { url: 'https://example.test/source.png', availability: 'ready' },
        idempotencyKey: 'source-version',
        requestDigest: 'source-digest',
        ownerId: foreignUserId,
      });
      expect(created.asset.ownerId).toBe(actorUserId);

      const foreignAsset = await service.createAssetVersion({
        actorUserId: foreignUserId,
        projectId: foreignProjectId,
        kind: 'image',
        file: { url: 'https://example.test/foreign.png', availability: 'ready' },
        idempotencyKey: 'foreign-version',
        requestDigest: 'foreign-digest',
      });
      await expect(service.createAssetVersion({
        actorUserId,
        projectId: targetProjectId,
        assetId: foreignAsset.asset.id,
        kind: 'image',
        file: { url: 'https://example.test/forged-asset.png', availability: 'ready' },
        idempotencyKey: 'forged-asset-version',
        requestDigest: 'forged-asset-digest',
      })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

      const transfer: TransferVersionInput = {
        actorUserId,
        sourceVersionId: created.version.id,
        targetProjectId,
        targetWorkspaceId: 'canvas-1',
        entityType: 'canvas-image',
        entityId: 'image-1',
        idempotencyKey: 'transfer-key',
        requestDigest: 'transfer-digest',
      };
      const results = await Promise.all(
        Array.from({ length: 20 }, () => service.sendVersionToWorkspace(transfer)),
      );
      expect(new Set(results.map((result) => result.placement.id)).size).toBe(1);
      expect(results.filter((result) => !result.reused)).toHaveLength(1);

      const workflowTransfer = await service.sendVersionToWorkspace({
        ...transfer,
        targetWorkspaceId: 'workflow-1',
        entityType: 'workflow-input',
        entityId: 'input-1',
        idempotencyKey: 'workflow-transfer-key',
        requestDigest: 'workflow-transfer-digest',
      });
      expect(workflowTransfer.placement.id).toBeDefined();

      await expect(service.sendVersionToWorkspace({ ...transfer, requestDigest: 'other-digest' }))
        .rejects.toMatchObject({ code: 'ASSET_IDEMPOTENCY_CONFLICT' });
      await expect(service.sendVersionToWorkspace({ ...transfer, actorUserId: foreignUserId }))
        .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
      await expect(service.sendVersionToWorkspace({ ...transfer, targetProjectId: foreignProjectId }))
        .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

      const placementId = results[0]?.placement.id;
      expect(placementId).toBeDefined();
      const concurrentTrash = await Promise.all([
        service.trashPlacement({ actorUserId, projectId: targetProjectId, placementId: placementId ?? '' }),
        service.trashPlacement({ actorUserId, projectId: targetProjectId, placementId: workflowTransfer.placement.id }),
      ]);
      expect(concurrentTrash.filter((result) => result.assetTrashed)).toHaveLength(1);
      const assetStatus = await query<{ status: string }>(
        'SELECT status FROM wujie_assets WHERE id = $1 AND owner_id = $2 AND project_id = $3',
        [created.asset.id, actorUserId, targetProjectId],
      );
      expect(assetStatus.rows).toEqual([{ status: 'trashed' }]);
      await service.restorePlacement({ actorUserId, projectId: targetProjectId, placementId: placementId ?? '' });

      const lifecycle = await Promise.allSettled([
        service.trashPlacement({ actorUserId, projectId: targetProjectId, placementId: placementId ?? '' }),
        service.restorePlacement({ actorUserId, projectId: targetProjectId, placementId: placementId ?? '' }),
      ]);
      expect(lifecycle.every((result) => result.status === 'fulfilled')).toBe(true);
      const restored = await service.restorePlacement({ actorUserId, projectId: targetProjectId, placementId: placementId ?? '' });
      expect(restored.placement.status).toBe('active');
    });
  });
});
