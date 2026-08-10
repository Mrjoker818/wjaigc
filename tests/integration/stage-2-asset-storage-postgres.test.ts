import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  type QueryFn,
  withIsolatedPostgres,
} from '../helpers/postgres-test-database';

type WorkspaceEntityType =
  | 'canvas-image'
  | 'workflow-input'
  | 'workflow-output'
  | 'chat-attachment'
  | 'chat-result';

interface TransferVersionInput {
  actorUserId: string;
  sourceVersionId: string;
  targetProjectId: string;
  targetWorkspaceId: string;
  entityType: WorkspaceEntityType;
  entityId: string;
  idempotencyKey: string;
  requestDigest: string;
  transform?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface CreatedGraph {
  asset: { id: string; ownerId: string; projectId: string };
  version: { id: string; assetId: string; projectId: string };
  reused: boolean;
}

interface AssetService {
  createAssetVersion(input: Record<string, unknown>): Promise<CreatedGraph>;
  createWorkspacePlacement(input: {
    actorUserId: string;
    projectId: string;
    assetVersionId: string;
    workspace: 'canvas' | 'workflow' | 'chat';
    workspaceId: string;
    entityType: WorkspaceEntityType;
    entityId: string;
  }): Promise<{
    placement: { id: string; assetId: string; assetVersionId: string; status: string };
    reused: boolean;
  }>;
  sendVersionToWorkspace(input: TransferVersionInput): Promise<{
    version: { id: string; assetId: string; projectId: string };
    placement: { id: string; assetId: string; assetVersionId: string; ownerId: string; status: string };
    reused: boolean;
  }>;
  trashPlacement(input: { actorUserId: string; projectId: string; placementId: string }): Promise<{
    placementTrashed: boolean;
    assetTrashed: boolean;
  }>;
  restorePlacement(input: { actorUserId: string; projectId: string; placementId: string }): Promise<{
    placement: { id: string; status: string };
    asset: { id: string; status: string };
  }>;
}

interface AssetServiceModule {
  createAssetService(): AssetService;
}

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;
const migrationsDirectory = resolve(process.cwd(), 'migrations');
const lineageMigration = '20260811_wj_stable_s2_transfer_lineage_invariants.sql';

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

async function applyMigration(query: QueryFn, migration: string): Promise<void> {
  const sql = await readFile(resolve(migrationsDirectory, migration), 'utf8');
  await query(sql);
}

async function loadService(): Promise<AssetServiceModule> {
  return import('@/lib/asset-core/service') as unknown as Promise<AssetServiceModule>;
}

async function seedProject(query: QueryFn, ownerId: string, projectId: string): Promise<void> {
  await query(
    'INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, $3)',
    [projectId, ownerId, 'Asset storage test'],
  );
}

async function createVersion(
  service: AssetService,
  actorUserId: string,
  projectId: string,
  suffix: string,
): Promise<CreatedGraph> {
  return service.createAssetVersion({
    actorUserId,
    projectId,
    kind: 'image',
    file: { url: `https://example.test/${suffix}.png`, availability: 'ready' },
    idempotencyKey: `version-${suffix}`,
    requestDigest: `digest-${suffix}`,
  });
}

function errorCode(result: PromiseSettledResult<unknown>): unknown {
  if (result.status === 'fulfilled') return undefined;
  return result.reason instanceof Object && 'code' in result.reason
    ? result.reason.code
    : undefined;
}

async function waitForBlockedAssetLock(query: QueryFn, blockerPid: number): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await query<{ pid: number }>(
      `SELECT activity.pid
       FROM pg_stat_activity activity
       WHERE activity.datname = current_database()
         AND activity.pid <> pg_backend_pid()
         AND activity.wait_event_type = 'Lock'
         AND activity.query LIKE '%FROM wujie_assets%'
         AND activity.query LIKE '%FOR UPDATE%'
         AND $1 = ANY(pg_blocking_pids(activity.pid))
       LIMIT 1`,
      [blockerPid],
    );
    const blockedPid = blocked.rows[0]?.pid;
    if (blockedPid) return blockedPid;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  const diagnostics = await query<{
    blockers: number[];
    pid: number;
    query: string;
    wait_event: string | null;
    wait_event_type: string | null;
  }>(
    `SELECT activity.pid, activity.wait_event_type, activity.wait_event, activity.query,
            pg_blocking_pids(activity.pid) AS blockers
     FROM pg_stat_activity activity
     WHERE activity.datname = current_database()
       AND activity.pid <> pg_backend_pid()
     ORDER BY activity.pid`,
  );
  throw new Error(
    `No asset-lock waiter observed for blocker PID ${blockerPid}: ${JSON.stringify(diagnostics.rows)}`,
  );
}

async function observeBlockedAssetLock(
  isolatedDatabaseUrl: string,
  blockerPid: number,
): Promise<number> {
  const observer = new Client({ connectionString: isolatedDatabaseUrl });
  await observer.connect();
  try {
    const observerQuery: QueryFn = (text, values) => observer.query(text, values);
    return await waitForBlockedAssetLock(observerQuery, blockerPid);
  } finally {
    await observer.end();
  }
}

describe('Stage 2 asset storage on real PostgreSQL', () => {
  postgresIt('stores source identity and defines the exact transfer idempotency index scope', async () => {
    await withIsolatedPostgres('stage-2-transfer-index', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);

      const columns = await query<{ column_name: string; attnotnull: boolean }>(
        `SELECT attribute.attname::text AS column_name, attribute.attnotnull
         FROM pg_attribute attribute
         JOIN pg_class relation ON relation.oid = attribute.attrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = current_schema()
           AND relation.relname = 'wujie_workspace_placements'
           AND attribute.attname IN ('idempotency_key', 'request_digest', 'source_version_id')`,
      );
      expect(columns.rows.sort((left, right) => left.column_name.localeCompare(right.column_name))).toEqual([
        { column_name: 'idempotency_key', attnotnull: false },
        { column_name: 'request_digest', attnotnull: false },
        { column_name: 'source_version_id', attnotnull: false },
      ]);

      const index = await query<{ columns: string[]; predicate: string; indisunique: boolean }>(
        `SELECT array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns,
                pg_get_expr(index.indpred, index.indrelid) AS predicate,
                index.indisunique
         FROM pg_class index_class
         JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
         JOIN pg_index index ON index.indexrelid = index_class.oid
         JOIN LATERAL unnest(index.indkey) WITH ORDINALITY AS key(attnum, ordinality) ON true
         JOIN pg_attribute attribute
           ON attribute.attrelid = index.indrelid AND attribute.attnum = key.attnum
         WHERE namespace.nspname = current_schema()
           AND index_class.relname = 'wujie_workspace_placements_transfer_source_idempotency_unique'
         GROUP BY index.indpred, index.indrelid, index.indisunique`,
      );
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0]?.indisunique).toBe(true);
      expect(index.rows[0]?.columns).toEqual([
        'owner_id',
        'source_version_id',
        'project_id',
        'workspace_id',
        'entity_type',
        'entity_id',
        'idempotency_key',
      ]);
      expect(index.rows[0]?.predicate).toContain('idempotency_key IS NOT NULL');
      expect(index.rows[0]?.predicate).not.toContain('source_version_id IS NOT NULL');

      const supersededIndex = await query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM pg_class index_class
         JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
         WHERE namespace.nspname = current_schema()
           AND index_class.relname = 'wujie_workspace_placements_transfer_idempotency_unique'`,
      );
      expect(supersededIndex.rows).toEqual([{ count: '0' }]);
    });
  });

  postgresIt('upgrades old transfer rows and enforces conditional owner-consistent lineage', async () => {
    await withIsolatedPostgres('stage-2-transfer-lineage-upgrade', async ({ query }) => {
      await applyMigration(query, '20260810_wj_stable_s2_assets.sql');
      await applyMigration(query, '20260810_wj_stable_s2_workspace_entity_pairs.sql');
      await applyMigration(query, '20260811_wj_stable_s2_asset_transfer_idempotency.sql');

      const ownerId = randomUUID();
      const projectId = randomUUID();
      const assetId = randomUUID();
      const versionId = randomUUID();
      const oldPlacementId = randomUUID();
      await seedProject(query, ownerId, projectId);
      await query(
        'INSERT INTO wujie_assets(id, owner_id, project_id, kind) VALUES ($1, $2, $3, $4)',
        [assetId, ownerId, projectId, 'image'],
      );
      await query(
        `INSERT INTO wujie_asset_versions(id, asset_id, owner_id, project_id, file_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [versionId, assetId, ownerId, projectId, 'https://example.test/legacy-transfer.png'],
      );
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
           workspace_id, entity_type, entity_id, idempotency_key, request_digest
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)`,
        [
          oldPlacementId,
          ownerId,
          projectId,
          assetId,
          versionId,
          'canvas',
          'legacy-canvas',
          'canvas-image',
          'legacy-image',
          'legacy-transfer-key',
        ],
      );
      await applyMigration(query, '20260811_wj_stable_s2_cross_project_transfer.sql');
      await query(
        'UPDATE wujie_workspace_placements SET source_version_id = NULL WHERE id = $1',
        [oldPlacementId],
      );

      await applyMigration(query, lineageMigration);

      const backfilled = await query<{ source_version_id: string; request_digest: string }>(
        'SELECT source_version_id, request_digest FROM wujie_workspace_placements WHERE id = $1',
        [oldPlacementId],
      );
      expect(backfilled.rows[0]?.source_version_id).toBe(versionId);
      expect(backfilled.rows[0]?.request_digest).toBe(`legacy-transfer:${oldPlacementId}`);

      const lineageCheck = await query<{ definition: string }>(
        `SELECT pg_get_constraintdef(constraint_row.oid) AS definition
         FROM pg_constraint constraint_row
         JOIN pg_class relation ON relation.oid = constraint_row.conrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = current_schema()
           AND constraint_row.conname = 'wujie_workspace_placements_transfer_lineage_check'`,
      );
      expect(lineageCheck.rows).toHaveLength(1);
      expect(lineageCheck.rows[0]?.definition).toContain('idempotency_key IS NULL');
      expect(lineageCheck.rows[0]?.definition).toContain('source_version_id IS NOT NULL');
      expect(lineageCheck.rows[0]?.definition).toContain('request_digest IS NOT NULL');

      const lineageForeignKey = await query<{
        local_columns: string[];
        referenced_columns: string[];
      }>(
        `SELECT
           ARRAY(
             SELECT attribute.attname::text
             FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ordinality)
             JOIN pg_attribute attribute
               ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = key.attnum
             ORDER BY key.ordinality
           ) AS local_columns,
           ARRAY(
             SELECT attribute.attname::text
             FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, ordinality)
             JOIN pg_attribute attribute
               ON attribute.attrelid = constraint_row.confrelid AND attribute.attnum = key.attnum
             ORDER BY key.ordinality
           ) AS referenced_columns
         FROM pg_constraint constraint_row
         JOIN pg_class relation ON relation.oid = constraint_row.conrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = current_schema()
           AND constraint_row.conname = 'wujie_workspace_placements_source_version_owner_fk'
           AND constraint_row.contype = 'f'`,
      );
      expect(lineageForeignKey.rows).toEqual([{
        local_columns: ['source_version_id', 'owner_id'],
        referenced_columns: ['id', 'owner_id'],
      }]);

      await expect(query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
           workspace_id, entity_type, entity_id
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', $6, 'canvas-image', $7)`,
        [randomUUID(), ownerId, projectId, assetId, versionId, 'ordinary-canvas', 'ordinary-image'],
      )).resolves.toBeDefined();
      await expect(query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
           workspace_id, entity_type, entity_id, idempotency_key, request_digest
         ) VALUES ($1, $2, $3, $4, $5, 'canvas', $6, 'canvas-image', $7, $8, $9)`,
        [randomUUID(), ownerId, projectId, assetId, versionId, 'missing-source', 'missing-source', 'key-a', 'digest-a'],
      )).rejects.toMatchObject({ code: '23514' });
      await expect(query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, source_version_id,
           workspace_kind, workspace_id, entity_type, entity_id, idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, $5, 'canvas', $6, 'canvas-image', $7, $8)`,
        [randomUUID(), ownerId, projectId, assetId, versionId, 'missing-digest', 'missing-digest', 'key-b'],
      )).rejects.toMatchObject({ code: '23514' });

      const foreignOwnerId = randomUUID();
      const foreignProjectId = randomUUID();
      const foreignAssetId = randomUUID();
      const foreignVersionId = randomUUID();
      await seedProject(query, foreignOwnerId, foreignProjectId);
      await query(
        'INSERT INTO wujie_assets(id, owner_id, project_id, kind) VALUES ($1, $2, $3, $4)',
        [foreignAssetId, foreignOwnerId, foreignProjectId, 'image'],
      );
      await query(
        `INSERT INTO wujie_asset_versions(id, asset_id, owner_id, project_id, file_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [foreignVersionId, foreignAssetId, foreignOwnerId, foreignProjectId, 'https://example.test/foreign-lineage.png'],
      );
      await expect(query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, source_version_id,
           workspace_kind, workspace_id, entity_type, entity_id, idempotency_key, request_digest
         ) VALUES ($1, $2, $3, $4, $5, $6, 'canvas', $7, 'canvas-image', $8, $9, $10)`,
        [
          randomUUID(), ownerId, projectId, assetId, versionId, foreignVersionId,
          'foreign-source-owner', 'foreign-source-owner', 'key-c', 'digest-c',
        ],
      )).rejects.toMatchObject({ code: '23503' });
    });
  });

  postgresIt('serializes createAssetVersion idempotency and safely persists caller metadata', async () => {
    await withIsolatedPostgres('stage-2-version-idempotency', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);
      const actorUserId = randomUUID();
      const projectId = randomUUID();
      const otherProjectId = randomUUID();
      await seedProject(query, actorUserId, projectId);
      await seedProject(query, actorUserId, otherProjectId);
      const { createAssetService } = await loadService();
      const service = createAssetService();
      await query(`
        CREATE FUNCTION delay_concurrent_version_insert() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.idempotency_key = 'concurrent-version-key' THEN
            PERFORM pg_sleep(0.15);
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await query(`
        CREATE TRIGGER delay_concurrent_version_insert
        BEFORE INSERT ON wujie_asset_versions
        FOR EACH ROW EXECUTE FUNCTION delay_concurrent_version_insert()
      `);
      const input = {
        actorUserId,
        projectId,
        kind: 'image',
        file: { url: 'https://example.test/concurrent-version.png', availability: 'ready' },
        idempotencyKey: 'concurrent-version-key',
        requestDigest: 'concurrent-version-digest',
        metadata: { requestDigest: 'caller-spoof', provenance: 'postgres-test' },
      };

      const sameDigest = await Promise.all(
        Array.from({ length: 20 }, () => service.createAssetVersion(input)),
      );
      expect(new Set(sameDigest.map((result) => result.version.id)).size).toBe(1);
      expect(sameDigest.filter((result) => !result.reused)).toHaveLength(1);
      const storedVersion = await query<{ metadata: Record<string, unknown> }>(
        'SELECT metadata FROM wujie_asset_versions WHERE owner_id = $1 AND project_id = $2 AND idempotency_key = $3',
        [actorUserId, projectId, input.idempotencyKey],
      );
      expect(storedVersion.rows).toEqual([{ metadata: {
        provenance: 'postgres-test',
        requestDigest: 'concurrent-version-digest',
      } }]);

      const differentDigest = await Promise.allSettled([
        service.createAssetVersion({ ...input, idempotencyKey: 'different-digest-key', requestDigest: 'digest-a' }),
        service.createAssetVersion({ ...input, idempotencyKey: 'different-digest-key', requestDigest: 'digest-b' }),
      ]);
      expect(differentDigest.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(differentDigest.filter((result) => errorCode(result) === 'ASSET_IDEMPOTENCY_CONFLICT')).toHaveLength(1);
      const physicalVersions = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM wujie_asset_versions WHERE owner_id = $1 AND project_id = $2 AND idempotency_key = $3',
        [actorUserId, projectId, 'different-digest-key'],
      );
      expect(physicalVersions.rows).toEqual([{ count: '1' }]);

      const foreignProjectVersion = await createVersion(service, actorUserId, otherProjectId, 'other-project');
      await expect(service.createWorkspacePlacement({
        actorUserId,
        projectId,
        assetVersionId: foreignProjectVersion.version.id,
        workspace: 'canvas',
        workspaceId: 'canvas-scoped-lookup',
        entityType: 'canvas-image',
        entityId: 'image-scoped-lookup',
      })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    });
  });

  postgresIt('copies one source version into one target graph for twenty concurrent cross-project sends', async () => {
    await withIsolatedPostgres('stage-2-cross-project-send', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);
      const actorUserId = randomUUID();
      const sourceProjectId = randomUUID();
      const targetProjectId = randomUUID();
      const foreignUserId = randomUUID();
      const foreignProjectId = randomUUID();
      await seedProject(query, actorUserId, sourceProjectId);
      await seedProject(query, actorUserId, targetProjectId);
      await seedProject(query, foreignUserId, foreignProjectId);
      const { createAssetService } = await loadService();
      const service = createAssetService();
      const source = await createVersion(service, actorUserId, sourceProjectId, 'cross-project-source');
      const transfer: TransferVersionInput = {
        actorUserId,
        sourceVersionId: source.version.id,
        targetProjectId,
        targetWorkspaceId: 'canvas-cross-project',
        entityType: 'canvas-image',
        entityId: 'image-cross-project',
        idempotencyKey: 'cross-project-transfer-key',
        requestDigest: 'cross-project-transfer-digest',
        metadata: { purpose: 'cross-project-test' },
      };

      const results = await Promise.all(
        Array.from({ length: 20 }, () => service.sendVersionToWorkspace(transfer)),
      );
      expect(new Set(results.map((result) => result.placement.id)).size).toBe(1);
      expect(new Set(results.map((result) => result.version.id)).size).toBe(1);
      expect(results.filter((result) => !result.reused)).toHaveLength(1);
      expect(results[0]?.version.id).not.toBe(source.version.id);
      expect(results[0]?.version.projectId).toBe(targetProjectId);
      expect(results[0]?.placement.assetVersionId).toBe(results[0]?.version.id);

      const physicalGraph = await query<{
        source_version_id: string;
        target_version_id: string;
        target_asset_id: string;
        version_project_id: string;
        asset_project_id: string;
        count: string;
      }>(
        `SELECT placement.source_version_id,
                placement.asset_version_id AS target_version_id,
                placement.asset_id AS target_asset_id,
                version.project_id AS version_project_id,
                asset.project_id AS asset_project_id,
                count(*) OVER ()::text AS count
         FROM wujie_workspace_placements placement
         JOIN wujie_asset_versions version ON version.id = placement.asset_version_id
         JOIN wujie_assets asset ON asset.id = placement.asset_id
         WHERE placement.owner_id = $1
           AND placement.source_version_id = $2
           AND placement.project_id = $3
           AND placement.workspace_id = $4
           AND placement.entity_type = $5
           AND placement.entity_id = $6
           AND placement.idempotency_key = $7`,
        [
          actorUserId,
          source.version.id,
          targetProjectId,
          transfer.targetWorkspaceId,
          transfer.entityType,
          transfer.entityId,
          transfer.idempotencyKey,
        ],
      );
      expect(physicalGraph.rows).toHaveLength(1);
      expect(physicalGraph.rows[0]).toMatchObject({
        source_version_id: source.version.id,
        version_project_id: targetProjectId,
        asset_project_id: targetProjectId,
        count: '1',
      });
      expect(physicalGraph.rows[0]?.target_version_id).not.toBe(source.version.id);
      expect(physicalGraph.rows[0]?.target_asset_id).not.toBe(source.asset.id);
      const targetAssets = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM wujie_assets WHERE owner_id = $1 AND project_id = $2',
        [actorUserId, targetProjectId],
      );
      const targetVersions = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM wujie_asset_versions WHERE owner_id = $1 AND project_id = $2',
        [actorUserId, targetProjectId],
      );
      const targetPlacements = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM wujie_workspace_placements WHERE owner_id = $1 AND project_id = $2',
        [actorUserId, targetProjectId],
      );
      expect(targetAssets.rows).toEqual([{ count: '1' }]);
      expect(targetVersions.rows).toEqual([{ count: '1' }]);
      expect(targetPlacements.rows).toEqual([{ count: '1' }]);
      const sourceGraph = await query<{ asset_count: string; version_count: string }>(
        `SELECT
           (SELECT count(*) FROM wujie_assets WHERE id = $1 AND project_id = $2)::text AS asset_count,
           (SELECT count(*) FROM wujie_asset_versions WHERE id = $3 AND project_id = $2)::text AS version_count`,
        [source.asset.id, sourceProjectId, source.version.id],
      );
      expect(sourceGraph.rows).toEqual([{ asset_count: '1', version_count: '1' }]);

      await expect(service.sendVersionToWorkspace({ ...transfer, actorUserId: foreignUserId }))
        .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
      await expect(service.sendVersionToWorkspace({ ...transfer, targetProjectId: foreignProjectId }))
        .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
      await expect(service.sendVersionToWorkspace({ ...transfer, sourceVersionId: randomUUID() }))
        .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    });
  });

  postgresIt('returns one transfer and one stable conflict for concurrent different digests', async () => {
    await withIsolatedPostgres('stage-2-transfer-digest-race', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);
      const actorUserId = randomUUID();
      const sourceProjectId = randomUUID();
      const targetProjectId = randomUUID();
      await seedProject(query, actorUserId, sourceProjectId);
      await seedProject(query, actorUserId, targetProjectId);
      const { createAssetService } = await loadService();
      const service = createAssetService();
      const source = await createVersion(service, actorUserId, sourceProjectId, 'digest-race-source');
      const transfer: TransferVersionInput = {
        actorUserId,
        sourceVersionId: source.version.id,
        targetProjectId,
        targetWorkspaceId: 'canvas-digest-race',
        entityType: 'canvas-image',
        entityId: 'image-digest-race',
        idempotencyKey: 'digest-race-key',
        requestDigest: 'digest-a',
      };

      const results = await Promise.allSettled([
        service.sendVersionToWorkspace(transfer),
        service.sendVersionToWorkspace({ ...transfer, requestDigest: 'digest-b' }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => errorCode(result) === 'ASSET_IDEMPOTENCY_CONFLICT')).toHaveLength(1);
      const physicalPlacements = await query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM wujie_workspace_placements
         WHERE owner_id = $1 AND source_version_id = $2 AND project_id = $3
           AND workspace_id = $4 AND entity_type = $5 AND entity_id = $6 AND idempotency_key = $7`,
        [
          actorUserId,
          source.version.id,
          targetProjectId,
          transfer.targetWorkspaceId,
          transfer.entityType,
          transfer.entityId,
          transfer.idempotencyKey,
        ],
      );
      expect(physicalPlacements.rows).toEqual([{ count: '1' }]);
    });
  });

  postgresIt('serializes create and send against final-placement trash with the asset lifecycle lock', async () => {
    await withIsolatedPostgres('stage-2-placement-lifecycle-race', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);
      const actorUserId = randomUUID();
      const projectId = randomUUID();
      await seedProject(query, actorUserId, projectId);
      const { createAssetService } = await loadService();
      const service = createAssetService();

      const createSource = await createVersion(service, actorUserId, projectId, 'create-race-source');
      const finalPlacement = await service.createWorkspacePlacement({
        actorUserId,
        projectId,
        assetVersionId: createSource.version.id,
        workspace: 'canvas',
        workspaceId: 'canvas-create-race',
        entityType: 'canvas-image',
        entityId: 'image-final-create-race',
      });
      await query('BEGIN');
      await query('SELECT id FROM wujie_assets WHERE id = $1 FOR UPDATE', [createSource.asset.id]);
      const concurrentCreate = service.createWorkspacePlacement({
        actorUserId,
        projectId,
        assetVersionId: createSource.version.id,
        workspace: 'canvas',
        workspaceId: 'canvas-create-race',
        entityType: 'canvas-image',
        entityId: 'image-new-create-race',
      });
      const createBlocker = await query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const blockedCreatePid = await observeBlockedAssetLock(
        isolatedDatabaseUrl,
        createBlocker.rows[0]?.pid ?? 0,
      );
      expect(blockedCreatePid).toBeGreaterThan(0);
      const trashForCreate = service.trashPlacement({
        actorUserId,
        projectId,
        placementId: finalPlacement.placement.id,
      });
      await query('COMMIT');
      await Promise.all([trashForCreate, concurrentCreate]);

      const createInvariant = await query<{ status: string; active_count: string }>(
        `SELECT asset.status,
                count(placement.id) FILTER (WHERE placement.status = 'active')::text AS active_count
         FROM wujie_assets asset
         LEFT JOIN wujie_workspace_placements placement ON placement.asset_id = asset.id
         WHERE asset.id = $1
         GROUP BY asset.id`,
        [createSource.asset.id],
      );
      expect(createInvariant.rows).toEqual([{ status: 'active', active_count: '1' }]);

      const sendSource = await createVersion(service, actorUserId, projectId, 'send-race-source');
      const finalSendPlacement = await service.createWorkspacePlacement({
        actorUserId,
        projectId,
        assetVersionId: sendSource.version.id,
        workspace: 'canvas',
        workspaceId: 'canvas-send-race',
        entityType: 'canvas-image',
        entityId: 'image-final-send-race',
      });
      await query('BEGIN');
      await query('SELECT id FROM wujie_assets WHERE id = $1 FOR UPDATE', [sendSource.asset.id]);
      const concurrentSend = service.sendVersionToWorkspace({
        actorUserId,
        sourceVersionId: sendSource.version.id,
        targetProjectId: projectId,
        targetWorkspaceId: 'canvas-send-race',
        entityType: 'canvas-image',
        entityId: 'image-new-send-race',
        idempotencyKey: 'send-race-key',
        requestDigest: 'send-race-digest',
      });
      const sendBlocker = await query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const blockedSendPid = await observeBlockedAssetLock(
        isolatedDatabaseUrl,
        sendBlocker.rows[0]?.pid ?? 0,
      );
      expect(blockedSendPid).toBeGreaterThan(0);
      const trashForSend = service.trashPlacement({
        actorUserId,
        projectId,
        placementId: finalSendPlacement.placement.id,
      });
      await query('COMMIT');
      await Promise.all([trashForSend, concurrentSend]);

      const sendInvariant = await query<{ status: string; active_count: string }>(
        `SELECT asset.status,
                count(placement.id) FILTER (WHERE placement.status = 'active')::text AS active_count
         FROM wujie_assets asset
         LEFT JOIN wujie_workspace_placements placement ON placement.asset_id = asset.id
         WHERE asset.id = $1
         GROUP BY asset.id`,
        [sendSource.asset.id],
      );
      expect(sendInvariant.rows).toEqual([{ status: 'active', active_count: '1' }]);
    });
  }, 15_000);

  postgresIt('maps sequential and concurrent restore collisions to ASSET_PLACEMENT_CONFLICT', async () => {
    await withIsolatedPostgres('stage-2-restore-conflict', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);
      const actorUserId = randomUUID();
      const projectId = randomUUID();
      await seedProject(query, actorUserId, projectId);
      const { createAssetService } = await loadService();
      const service = createAssetService();

      const first = await createVersion(service, actorUserId, projectId, 'restore-first');
      const firstPlacement = await service.createWorkspacePlacement({
        actorUserId,
        projectId,
        assetVersionId: first.version.id,
        workspace: 'canvas',
        workspaceId: 'canvas-restore',
        entityType: 'canvas-image',
        entityId: 'image-sequential-conflict',
      });
      await service.trashPlacement({ actorUserId, projectId, placementId: firstPlacement.placement.id });
      const second = await createVersion(service, actorUserId, projectId, 'restore-second');
      await service.createWorkspacePlacement({
        actorUserId,
        projectId,
        assetVersionId: second.version.id,
        workspace: 'canvas',
        workspaceId: 'canvas-restore',
        entityType: 'canvas-image',
        entityId: 'image-sequential-conflict',
      });

      await expect(service.restorePlacement({ actorUserId, projectId, placementId: firstPlacement.placement.id }))
        .rejects.toMatchObject({ code: 'ASSET_PLACEMENT_CONFLICT' });
      const rolledBack = await query<{ placement_status: string; asset_status: string }>(
        `SELECT placement.status AS placement_status, asset.status AS asset_status
         FROM wujie_workspace_placements placement
         JOIN wujie_assets asset ON asset.id = placement.asset_id
         WHERE placement.id = $1`,
        [firstPlacement.placement.id],
      );
      expect(rolledBack.rows).toEqual([{ placement_status: 'trashed', asset_status: 'trashed' }]);

      const third = await createVersion(service, actorUserId, projectId, 'restore-third');
      const thirdPlacement = await service.createWorkspacePlacement({
        actorUserId,
        projectId,
        assetVersionId: third.version.id,
        workspace: 'canvas',
        workspaceId: 'canvas-restore',
        entityType: 'canvas-image',
        entityId: 'image-concurrent-conflict',
      });
      await service.trashPlacement({ actorUserId, projectId, placementId: thirdPlacement.placement.id });
      const fourth = await createVersion(service, actorUserId, projectId, 'restore-fourth');
      const fourthPlacement = await service.createWorkspacePlacement({
        actorUserId,
        projectId,
        assetVersionId: fourth.version.id,
        workspace: 'canvas',
        workspaceId: 'canvas-restore',
        entityType: 'canvas-image',
        entityId: 'image-concurrent-conflict',
      });
      await service.trashPlacement({ actorUserId, projectId, placementId: fourthPlacement.placement.id });

      const concurrent = await Promise.allSettled([
        service.restorePlacement({ actorUserId, projectId, placementId: thirdPlacement.placement.id }),
        service.restorePlacement({ actorUserId, projectId, placementId: fourthPlacement.placement.id }),
      ]);
      expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(concurrent.filter((result) => errorCode(result) === 'ASSET_PLACEMENT_CONFLICT')).toHaveLength(1);
      const activeRows = await query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM wujie_workspace_placements
         WHERE owner_id = $1 AND project_id = $2 AND workspace_id = $3
           AND entity_type = $4 AND entity_id = $5 AND status = 'active'`,
        [actorUserId, projectId, 'canvas-restore', 'canvas-image', 'image-concurrent-conflict'],
      );
      expect(activeRows.rows).toEqual([{ count: '1' }]);
      const assetStatuses = await query<{ status: string; count: string }>(
        `SELECT status, count(*)::text AS count
         FROM wujie_assets
         WHERE id = ANY($1::text[])
         GROUP BY status
         ORDER BY status`,
        [[third.asset.id, fourth.asset.id]],
      );
      expect(assetStatuses.rows).toEqual([
        { status: 'active', count: '1' },
        { status: 'trashed', count: '1' },
      ]);
    });
  });
});
