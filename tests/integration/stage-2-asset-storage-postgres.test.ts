import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client, Pool } from 'pg';
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
  createVersionWithPlacement(input: {
    actorUserId: string;
    projectId: string;
    kind: 'image';
    resolveFile: () => Promise<{ url: string; availability: 'ready'; checksum?: string }>;
    idempotencyKey: string;
    requestDigest: string;
    metadata?: Record<string, unknown>;
    placement: {
      workspace: 'chat';
      workspaceId: string;
      entityType: 'chat-attachment' | 'chat-result';
      entityId: string;
      metadata?: Record<string, unknown>;
    };
  }): Promise<{
    asset: { id: string; projectId: string };
    version: { id: string; assetId: string; projectId: string };
    placement: { id: string; assetVersionId: string; status: string };
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
    projectRevision?: number;
  }>;
  restorePlacement(input: { actorUserId: string; projectId: string; placementId: string }): Promise<{
    placement: { id: string; status: string };
    asset: { id: string; status: string };
    projectRevision?: number;
  }>;
}

interface AssetServiceModule {
  createAssetService(storage?: unknown): AssetService;
}

interface AssetStorageModule {
  createPostgresAssetStorage(pool: Pool): unknown;
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

async function seedCanvasProjectSnapshot(
  query: QueryFn,
  ownerId: string,
  projectId: string,
  imageIds: string[],
): Promise<void> {
  await query(
    `CREATE TABLE IF NOT EXISTS wujie_user_data (
       user_id TEXT NOT NULL,
       data_key TEXT NOT NULL,
       data_value JSONB NOT NULL,
       updated_at BIGINT NOT NULL,
       PRIMARY KEY (user_id, data_key)
     )`,
  );
  await query(
    `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
     VALUES ($1, 'projects', $2::jsonb, 1)
     ON CONFLICT (user_id, data_key) DO UPDATE SET
       data_value = EXCLUDED.data_value,
       updated_at = EXCLUDED.updated_at`,
    [ownerId, JSON.stringify([{
      id: projectId,
      userId: ownerId,
      name: 'Asset storage test',
      createdAt: 1,
      updatedAt: 1,
      canvasImages: imageIds.map(id => ({ id, url: `/uploads/${id}.png` })),
      settings: {},
    }])],
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

function normalizeCatalogExpression(expression: string): string {
  return expression.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
}

function withApplicationName(connectionString: string, applicationName: string): string {
  const parsed = new URL(connectionString);
  parsed.searchParams.set('application_name', applicationName);
  return parsed.toString();
}

async function bounded<T>(promise: Promise<T>, label: string, timeoutMs = 5_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForBlockedAssetLock(
  query: QueryFn,
  blockerPid: number,
  applicationName: string,
): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await query<{ pid: number }>(
      `SELECT activity.pid
       FROM pg_stat_activity activity
       WHERE activity.datname = current_database()
         AND activity.pid <> pg_backend_pid()
         AND activity.application_name = $2
         AND activity.wait_event_type = 'Lock'
         AND activity.query LIKE '%FROM wujie_assets%'
         AND activity.query LIKE '%FOR UPDATE%'
         AND $1 = ANY(pg_blocking_pids(activity.pid))
       LIMIT 1`,
      [blockerPid, applicationName],
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
       AND activity.application_name = $1
     ORDER BY activity.pid`,
    [applicationName],
  );
  throw new Error(
    `No asset-lock waiter observed for blocker PID ${blockerPid}: ${JSON.stringify(diagnostics.rows)}`,
  );
}

async function exerciseAssetLockBarrier(input: {
  applicationName: string;
  assetId: string;
  isolatedDatabaseUrl: string;
  startBlockedOperation: () => Promise<unknown>;
  startConcurrentOperation: () => Promise<unknown>;
}): Promise<number> {
  const clientConfig = {
    connectionString: input.isolatedDatabaseUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  };
  const helper = new Client(clientConfig);
  const observer = new Client(clientConfig);
  const operations: Promise<unknown>[] = [];
  const cleanupErrors: unknown[] = [];
  let blockerPid = 0;
  let blockedPid = 0;
  let helperConnected = false;
  let observerConnected = false;
  let transactionOpen = false;
  let operationError: unknown;

  try {
    await bounded(helper.connect(), 'asset-lock helper connection');
    helperConnected = true;
    await bounded(observer.connect(), 'asset-lock observer connection');
    observerConnected = true;
    await helper.query('BEGIN');
    transactionOpen = true;
    await helper.query('SELECT id FROM wujie_assets WHERE id = $1 FOR UPDATE', [input.assetId]);
    const blocker = await helper.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    blockerPid = blocker.rows[0]?.pid ?? 0;

    operations.push(input.startBlockedOperation());
    const observerQuery: QueryFn = (text, values) => observer.query(text, values);
    blockedPid = await waitForBlockedAssetLock(observerQuery, blockerPid, input.applicationName);
    expect(blockedPid).toBeGreaterThan(0);

    operations.push(input.startConcurrentOperation());
    await bounded(helper.query('COMMIT'), 'asset-lock helper commit');
    transactionOpen = false;
    await bounded(Promise.all(operations), 'asset-lock service operations');
  } catch (error) {
    operationError = error;
  } finally {
    if (transactionOpen) {
      try {
        await bounded(helper.query('ROLLBACK'), 'asset-lock helper rollback');
        transactionOpen = false;
      } catch (error) {
        cleanupErrors.push(error);
        if (observerConnected && blockerPid > 0) {
          await bounded(
            observer.query('SELECT pg_terminate_backend($1)', [blockerPid]),
            'asset-lock blocker termination',
          ).catch((terminateError) => cleanupErrors.push(terminateError));
        }
      }
    }

    if (operations.length > 0) {
      try {
        await bounded(Promise.allSettled(operations), 'asset-lock operation settlement');
      } catch (error) {
        cleanupErrors.push(error);
        if (observerConnected) {
          await bounded(
            observer.query(
              `SELECT pg_terminate_backend(pid)
               FROM pg_stat_activity
               WHERE datname = current_database()
                 AND application_name = $1
                 AND pid <> pg_backend_pid()`,
              [input.applicationName],
            ),
            'asset-lock service backend termination',
          ).catch((terminateError) => cleanupErrors.push(terminateError));
          await bounded(
            Promise.allSettled(operations),
            'aborted asset-lock operation settlement',
          ).catch((settleError) => {
            cleanupErrors.push(settleError);
          });
        }
      }
    }

    if (helperConnected) {
      await bounded(helper.end(), 'asset-lock helper release').catch((error) => cleanupErrors.push(error));
    }
    if (observerConnected) {
      await bounded(observer.end(), 'asset-lock observer release').catch((error) => cleanupErrors.push(error));
    }
  }

  if (operationError) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError([operationError, ...cleanupErrors], 'Asset-lock barrier and cleanup failed');
    }
    throw operationError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Asset-lock barrier cleanup failed');
  }
  return blockedPid;
}

async function waitForVersionInsertBarrier(
  query: QueryFn,
  applicationName: string,
  blockerPid: number,
  expectedWaiters: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const observed = await query<{ direct_insert_waiters: number; lock_waiters: number }>(
      `SELECT
         count(*) FILTER (
           WHERE activity.wait_event_type = 'Lock'
             AND EXISTS (
               SELECT 1 FROM pg_locks pending_lock
               WHERE pending_lock.pid = activity.pid
                 AND pending_lock.locktype = 'advisory'
                 AND pending_lock.granted = false
             )
         )::int AS lock_waiters,
         count(*) FILTER (
           WHERE activity.wait_event_type = 'Lock'
             AND activity.query LIKE '%INSERT INTO wujie_asset_versions%'
             AND $2 = ANY(pg_blocking_pids(activity.pid))
             AND EXISTS (
               SELECT 1 FROM pg_locks pending_lock
               WHERE pending_lock.pid = activity.pid
                 AND pending_lock.locktype = 'advisory'
                 AND pending_lock.granted = false
             )
         )::int AS direct_insert_waiters
       FROM pg_stat_activity activity
       WHERE activity.datname = current_database()
         AND activity.application_name = $1`,
      [applicationName, blockerPid],
    );
    if (
      observed.rows[0]?.lock_waiters === expectedWaiters
      && (observed.rows[0]?.direct_insert_waiters ?? 0) > 0
    ) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }

  const diagnostics = await query<{
    blockers: number[];
    has_pending_advisory_lock: boolean;
    pid: number;
    query: string;
    wait_event: string | null;
    wait_event_type: string | null;
  }>(
    `SELECT activity.pid, activity.wait_event_type, activity.wait_event, activity.query,
            pg_blocking_pids(activity.pid) AS blockers,
            EXISTS (
              SELECT 1 FROM pg_locks pending_lock
              WHERE pending_lock.pid = activity.pid
                AND pending_lock.locktype = 'advisory'
                AND pending_lock.granted = false
            ) AS has_pending_advisory_lock
     FROM pg_stat_activity activity
     WHERE activity.datname = current_database()
       AND activity.application_name = $1
     ORDER BY activity.pid`,
    [applicationName],
  );
  throw new Error(
    `Version insert barrier did not observe ${expectedWaiters} lock waiters for blocker PID ${blockerPid}: ${JSON.stringify(diagnostics.rows)}`,
  );
}

async function exerciseVersionInsertBarrier(input: {
  applicationName: string;
  isolatedDatabaseUrl: string;
  operationCount: number;
  startOperation: () => Promise<CreatedGraph>;
}): Promise<CreatedGraph[]> {
  const clientConfig = {
    connectionString: input.isolatedDatabaseUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  };
  const helper = new Client(clientConfig);
  const observer = new Client(clientConfig);
  const operations: Promise<CreatedGraph>[] = [];
  const cleanupErrors: unknown[] = [];
  let barrierHeld = false;
  let blockerPid = 0;
  let helperConnected = false;
  let observerConnected = false;
  let operationError: unknown;
  let results: CreatedGraph[] | undefined;

  try {
    await bounded(helper.connect(), 'version barrier helper connection');
    helperConnected = true;
    await bounded(observer.connect(), 'version barrier observer connection');
    observerConnected = true;
    const blocker = await helper.query<{ pid: number }>(
      `SELECT pg_backend_pid() AS pid,
              pg_advisory_lock(hashtextextended('asset-test-version-insert:' || current_schema(), 0))`,
    );
    blockerPid = blocker.rows[0]?.pid ?? 0;
    barrierHeld = true;

    for (let index = 0; index < input.operationCount; index += 1) {
      operations.push(input.startOperation());
    }
    const observerQuery: QueryFn = (text, values) => observer.query(text, values);
    await waitForVersionInsertBarrier(
      observerQuery,
      input.applicationName,
      blockerPid,
      input.operationCount,
    );

    const unlocked = await bounded(
      helper.query<{ unlocked: boolean }>(
        `SELECT pg_advisory_unlock(
           hashtextextended('asset-test-version-insert:' || current_schema(), 0)
         ) AS unlocked`,
      ),
      'version insert barrier release',
    );
    expect(unlocked.rows[0]?.unlocked).toBe(true);
    barrierHeld = false;
    results = await bounded(Promise.all(operations), 'version barrier service operations', 10_000);
  } catch (error) {
    operationError = error;
  } finally {
    if (barrierHeld) {
      try {
        const unlocked = await bounded(
          helper.query<{ unlocked: boolean }>(
            `SELECT pg_advisory_unlock(
               hashtextextended('asset-test-version-insert:' || current_schema(), 0)
             ) AS unlocked`,
          ),
          'version insert barrier cleanup release',
        );
        if (unlocked.rows[0]?.unlocked !== true) {
          throw new Error('Version insert barrier cleanup did not release the advisory lock');
        }
        barrierHeld = false;
      } catch (error) {
        cleanupErrors.push(error);
        if (observerConnected && blockerPid > 0) {
          await bounded(
            observer.query('SELECT pg_terminate_backend($1)', [blockerPid]),
            'version barrier blocker termination',
          ).catch((terminateError) => cleanupErrors.push(terminateError));
        }
      }
    }

    if (operations.length > 0) {
      try {
        await bounded(Promise.allSettled(operations), 'version barrier operation settlement', 10_000);
      } catch (error) {
        cleanupErrors.push(error);
        if (observerConnected) {
          await bounded(
            observer.query(
              `SELECT pg_terminate_backend(pid)
               FROM pg_stat_activity
               WHERE datname = current_database()
                 AND application_name = $1
                 AND pid <> pg_backend_pid()`,
              [input.applicationName],
            ),
            'version barrier service backend termination',
          ).catch((terminateError) => cleanupErrors.push(terminateError));
          await bounded(
            Promise.allSettled(operations),
            'aborted version barrier operation settlement',
            10_000,
          ).catch((settleError) => cleanupErrors.push(settleError));
        }
      }
    }

    if (helperConnected) {
      await bounded(helper.end(), 'version barrier helper release')
        .catch((error) => cleanupErrors.push(error));
    }
    if (observerConnected) {
      await bounded(observer.end(), 'version barrier observer release')
        .catch((error) => cleanupErrors.push(error));
    }
  }

  if (operationError) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...cleanupErrors],
        'Version insert barrier and cleanup failed',
      );
    }
    throw operationError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Version insert barrier cleanup failed');
  }
  return results ?? [];
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
      expect(normalizeCatalogExpression(index.rows[0]?.predicate ?? '')).toBe(
        'idempotency_key IS NOT NULL',
      );

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

      const lineageCheck = await query<{ convalidated: boolean; definition: string }>(
        `SELECT constraint_row.convalidated,
                pg_get_constraintdef(constraint_row.oid) AS definition
         FROM pg_constraint constraint_row
         JOIN pg_class relation ON relation.oid = constraint_row.conrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = current_schema()
           AND constraint_row.conname = 'wujie_workspace_placements_transfer_lineage_check'`,
      );
      expect(lineageCheck.rows).toHaveLength(1);
      expect(lineageCheck.rows[0]?.convalidated).toBe(true);
      expect(lineageCheck.rows[0]?.definition).toContain('idempotency_key IS NULL');
      expect(lineageCheck.rows[0]?.definition).toContain('source_version_id IS NOT NULL');
      expect(lineageCheck.rows[0]?.definition).toContain('request_digest IS NOT NULL');

      const lineageForeignKey = await query<{
        convalidated: boolean;
        local_columns: string[];
        referenced_columns: string[];
      }>(
        `SELECT
           constraint_row.convalidated,
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
        convalidated: true,
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

  postgresIt('fails the lineage migration closed for a pre-existing cross-owner source', async () => {
    await withIsolatedPostgres('stage-2-cross-owner-lineage-upgrade', async ({ query }) => {
      await applyMigration(query, '20260810_wj_stable_s2_assets.sql');
      await applyMigration(query, '20260810_wj_stable_s2_workspace_entity_pairs.sql');
      await applyMigration(query, '20260811_wj_stable_s2_asset_transfer_idempotency.sql');
      await applyMigration(query, '20260811_wj_stable_s2_cross_project_transfer.sql');

      const targetOwnerId = randomUUID();
      const targetProjectId = randomUUID();
      const targetAssetId = randomUUID();
      const targetVersionId = randomUUID();
      const sourceOwnerId = randomUUID();
      const sourceProjectId = randomUUID();
      const sourceAssetId = randomUUID();
      const sourceVersionId = randomUUID();
      await seedProject(query, targetOwnerId, targetProjectId);
      await seedProject(query, sourceOwnerId, sourceProjectId);
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind)
         VALUES ($1, $2, $3, 'image'), ($4, $5, $6, 'image')`,
        [targetAssetId, targetOwnerId, targetProjectId, sourceAssetId, sourceOwnerId, sourceProjectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(id, asset_id, owner_id, project_id, file_url)
         VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
        [
          targetVersionId,
          targetAssetId,
          targetOwnerId,
          targetProjectId,
          'https://example.test/target.png',
          sourceVersionId,
          sourceAssetId,
          sourceOwnerId,
          sourceProjectId,
          'https://example.test/cross-owner-source.png',
        ],
      );
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id, source_version_id,
           workspace_kind, workspace_id, entity_type, entity_id, idempotency_key, request_digest
         ) VALUES ($1, $2, $3, $4, $5, $6, 'canvas', $7, 'canvas-image', $8, $9, $10)`,
        [
          randomUUID(),
          targetOwnerId,
          targetProjectId,
          targetAssetId,
          targetVersionId,
          sourceVersionId,
          'pre-existing-cross-owner',
          'pre-existing-cross-owner',
          'pre-existing-cross-owner-key',
          'pre-existing-cross-owner-digest',
        ],
      );

      await expect(applyMigration(query, lineageMigration)).rejects.toMatchObject({ code: '23503' });
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
      const applicationName = `stage2-version-barrier-${randomUUID()}`;
      const servicePool = new Pool({
        connectionString: withApplicationName(isolatedDatabaseUrl, applicationName),
        connectionTimeoutMillis: 5_000,
        max: 20,
      });
      const storageModule = await import('@/lib/asset-core/storage') as unknown as AssetStorageModule;
      const service = createAssetService(storageModule.createPostgresAssetStorage(servicePool));
      await query(`
        CREATE FUNCTION wait_for_concurrent_version_insert() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.idempotency_key = 'concurrent-version-key' THEN
            PERFORM pg_advisory_xact_lock(
              hashtextextended('asset-test-version-insert:' || current_schema(), 0)
            );
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await query(`
        CREATE TRIGGER wait_for_concurrent_version_insert
        BEFORE INSERT ON wujie_asset_versions
        FOR EACH ROW EXECUTE FUNCTION wait_for_concurrent_version_insert()
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

      try {
        const sameDigest = await exerciseVersionInsertBarrier({
          applicationName,
          isolatedDatabaseUrl,
          operationCount: 20,
          startOperation: () => service.createAssetVersion(input),
        });
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
      } finally {
        await bounded(servicePool.end(), 'version barrier service pool cleanup', 10_000);
      }
    });
  }, 30_000);

  postgresIt('atomically creates version plus placement and serializes media resolution by registration key', async () => {
    await withIsolatedPostgres('stage-2-atomic-version-placement', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);
      const actorUserId = randomUUID();
      const projectId = randomUUID();
      await seedProject(query, actorUserId, projectId);
      const { createAssetService } = await loadService();
      const servicePool = new Pool({
        connectionString: isolatedDatabaseUrl,
        connectionTimeoutMillis: 5_000,
        max: 10,
      });
      const storageModule = await import('@/lib/asset-core/storage') as unknown as AssetStorageModule;
      const service = createAssetService(storageModule.createPostgresAssetStorage(servicePool));
      expect(service.createVersionWithPlacement).toBeTypeOf('function');
      if (typeof service.createVersionWithPlacement !== 'function') return;
      let mediaResolutionCount = 0;
      const input = {
        actorUserId,
        projectId,
        kind: 'image' as const,
        resolveFile: async () => {
          mediaResolutionCount += 1;
          return {
            url: '/api/serve-upload/uploads/content-addressed.png',
            availability: 'ready' as const,
            checksum: 'sha256:original-data-url-content',
          };
        },
        idempotencyKey: 'atomic-chat-registration',
        requestDigest: 'stable-original-data-url-digest',
        metadata: { source: 'standalone-chat' },
        placement: {
          workspace: 'chat' as const,
          workspaceId: 'standalone-chat:project-a',
          entityType: 'chat-result' as const,
          entityId: 'message-a:0',
        },
      };

      try {
        const results = await Promise.all(
          Array.from({ length: 10 }, () => service.createVersionWithPlacement(input)),
        );
        expect(new Set(results.map(result => result.version.id)).size).toBe(1);
        expect(new Set(results.map(result => result.placement.id)).size).toBe(1);
        expect(results.filter(result => !result.reused)).toHaveLength(1);
        expect(mediaResolutionCount).toBe(1);

        const graph = await query<{ assets: string; versions: string; placements: string }>(
          `SELECT
             (SELECT count(*) FROM wujie_assets WHERE owner_id = $1 AND project_id = $2)::text AS assets,
             (SELECT count(*) FROM wujie_asset_versions WHERE owner_id = $1 AND project_id = $2)::text AS versions,
             (SELECT count(*) FROM wujie_workspace_placements WHERE owner_id = $1 AND project_id = $2)::text AS placements`,
          [actorUserId, projectId],
        );
        expect(graph.rows).toEqual([{ assets: '1', versions: '1', placements: '1' }]);

        await expect(service.createVersionWithPlacement({
          ...input,
          idempotencyKey: 'placement-conflict-registration',
          requestDigest: 'placement-conflict-digest',
          resolveFile: async () => ({
            url: '/api/serve-upload/uploads/must-rollback.png',
            availability: 'ready' as const,
          }),
        })).rejects.toMatchObject({ code: 'ASSET_PLACEMENT_CONFLICT' });
        const rolledBack = await query<{ count: string }>(
          `SELECT count(*)::text AS count FROM wujie_asset_versions
           WHERE owner_id = $1 AND project_id = $2 AND idempotency_key = $3`,
          [actorUserId, projectId, 'placement-conflict-registration'],
        );
        expect(rolledBack.rows).toEqual([{ count: '0' }]);
      } finally {
        await bounded(servicePool.end(), 'atomic version placement pool cleanup', 10_000);
      }
    });
  }, 30_000);

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

      await expect(service.sendVersionToWorkspace({
        ...transfer,
        actorUserId: foreignUserId,
        targetProjectId: foreignProjectId,
      }))
        .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
      const forgedOwnerTransfer = {
        ...transfer,
        actorUserId: foreignUserId,
        targetProjectId: foreignProjectId,
        ownerId: actorUserId,
      };
      await expect(service.sendVersionToWorkspace(forgedOwnerTransfer))
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

  postgresIt('scopes transfer idempotency globally by actor across target semantics', async () => {
    await withIsolatedPostgres('stage-2-transfer-actor-idempotency', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);
      const actorUserId = randomUUID();
      const otherActorUserId = randomUUID();
      const sourceProjectId = randomUUID();
      const firstTargetProjectId = randomUUID();
      const secondTargetProjectId = randomUUID();
      const otherSourceProjectId = randomUUID();
      const otherTargetProjectId = randomUUID();
      await seedProject(query, actorUserId, sourceProjectId);
      await seedProject(query, actorUserId, firstTargetProjectId);
      await seedProject(query, actorUserId, secondTargetProjectId);
      await seedProject(query, otherActorUserId, otherSourceProjectId);
      await seedProject(query, otherActorUserId, otherTargetProjectId);
      const { createAssetService } = await loadService();
      const service = createAssetService();
      const source = await createVersion(service, actorUserId, sourceProjectId, 'actor-global-source');
      const otherSource = await createVersion(service, otherActorUserId, otherSourceProjectId, 'other-actor-source');
      const transfer: TransferVersionInput = {
        actorUserId,
        sourceVersionId: source.version.id,
        targetProjectId: firstTargetProjectId,
        targetWorkspaceId: 'canvas-first',
        entityType: 'canvas-image',
        entityId: 'image-first',
        idempotencyKey: 'actor-global-key',
        requestDigest: 'same-digest',
      };

      const first = await service.sendVersionToWorkspace(transfer);
      await expect(service.sendVersionToWorkspace({
        ...transfer,
        targetProjectId: secondTargetProjectId,
      })).rejects.toMatchObject({ code: 'ASSET_IDEMPOTENCY_CONFLICT' });
      await expect(service.sendVersionToWorkspace({
        ...transfer,
        targetWorkspaceId: 'canvas-second',
      })).rejects.toMatchObject({ code: 'ASSET_IDEMPOTENCY_CONFLICT' });
      await expect(service.sendVersionToWorkspace({
        ...transfer,
        entityId: 'image-second',
      })).rejects.toMatchObject({ code: 'ASSET_IDEMPOTENCY_CONFLICT' });

      const otherActor = await service.sendVersionToWorkspace({
        ...transfer,
        actorUserId: otherActorUserId,
        sourceVersionId: otherSource.version.id,
        targetProjectId: otherTargetProjectId,
      });
      expect(otherActor.placement.id).not.toBe(first.placement.id);
      const placements = await query<{ owner_id: string; count: string }>(
        `SELECT owner_id, count(*)::text AS count
         FROM wujie_workspace_placements
         WHERE idempotency_key = $1
         GROUP BY owner_id
         ORDER BY owner_id`,
        [transfer.idempotencyKey],
      );
      expect(placements.rows).toEqual(expect.arrayContaining([
        { owner_id: actorUserId, count: '1' },
        { owner_id: otherActorUserId, count: '1' },
      ]));
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
      const applicationName = `stage2-asset-lock-${randomUUID()}`;
      const lockPool = new Pool({
        connectionString: withApplicationName(isolatedDatabaseUrl, applicationName),
        connectionTimeoutMillis: 5_000,
        max: 2,
      });
      const storageModule = await import('@/lib/asset-core/storage') as unknown as AssetStorageModule;
      const lockService = createAssetService(storageModule.createPostgresAssetStorage(lockPool));

      try {
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
        await seedCanvasProjectSnapshot(
          query,
          actorUserId,
          projectId,
          ['image-final-create-race'],
        );
        await exerciseAssetLockBarrier({
          applicationName,
          assetId: createSource.asset.id,
          isolatedDatabaseUrl,
          startBlockedOperation: () => lockService.createWorkspacePlacement({
            actorUserId,
            projectId,
            assetVersionId: createSource.version.id,
            workspace: 'canvas',
            workspaceId: 'canvas-create-race',
            entityType: 'canvas-image',
            entityId: 'image-new-create-race',
          }),
          startConcurrentOperation: () => lockService.trashPlacement({
            actorUserId,
            projectId,
            placementId: finalPlacement.placement.id,
          }),
        });

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
        const createSnapshot = await query<{ canvas_images: unknown; revision: string }>(
          `SELECT project.value->'canvasImages' AS canvas_images,
                  revision.data_value #>> '{}' AS revision
           FROM wujie_user_data projects
           CROSS JOIN LATERAL jsonb_array_elements(projects.data_value) project(value)
           JOIN wujie_user_data revision
             ON revision.user_id = projects.user_id
            AND revision.data_key = '__asset_graph_projects_revision'
           WHERE projects.user_id = $1
             AND projects.data_key = 'projects'
             AND project.value->>'id' = $2`,
          [actorUserId, projectId],
        );
        expect(createSnapshot.rows).toEqual([{ canvas_images: [], revision: '1' }]);

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
        await seedCanvasProjectSnapshot(
          query,
          actorUserId,
          projectId,
          ['image-final-send-race'],
        );
        await exerciseAssetLockBarrier({
          applicationName,
          assetId: sendSource.asset.id,
          isolatedDatabaseUrl,
          startBlockedOperation: () => lockService.sendVersionToWorkspace({
            actorUserId,
            sourceVersionId: sendSource.version.id,
            targetProjectId: projectId,
            targetWorkspaceId: 'canvas-send-race',
            entityType: 'canvas-image',
            entityId: 'image-new-send-race',
            idempotencyKey: 'send-race-key',
            requestDigest: 'send-race-digest',
          }),
          startConcurrentOperation: () => lockService.trashPlacement({
            actorUserId,
            projectId,
            placementId: finalSendPlacement.placement.id,
          }),
        });

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
        const sendSnapshot = await query<{ canvas_images: unknown; revision: string }>(
          `SELECT project.value->'canvasImages' AS canvas_images,
                  revision.data_value #>> '{}' AS revision
           FROM wujie_user_data projects
           CROSS JOIN LATERAL jsonb_array_elements(projects.data_value) project(value)
           JOIN wujie_user_data revision
             ON revision.user_id = projects.user_id
            AND revision.data_key = '__asset_graph_projects_revision'
           WHERE projects.user_id = $1
             AND projects.data_key = 'projects'
             AND project.value->>'id' = $2`,
          [actorUserId, projectId],
        );
        expect(sendSnapshot.rows).toEqual([{ canvas_images: [], revision: '2' }]);
      } finally {
        await bounded(lockPool.end(), 'asset-lock service pool cleanup');
      }
    });
  }, 30_000);

  postgresIt('maps sequential and concurrent restore collisions to ASSET_PLACEMENT_CONFLICT', async () => {
    await withIsolatedPostgres('stage-2-restore-conflict', async ({ databaseUrl: isolatedDatabaseUrl, query }) => {
      migrate(isolatedDatabaseUrl);
      const actorUserId = randomUUID();
      const projectId = randomUUID();
      await seedProject(query, actorUserId, projectId);
      await seedCanvasProjectSnapshot(query, actorUserId, projectId, []);
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
      const firstTrash = await service.trashPlacement({ actorUserId, projectId, placementId: firstPlacement.placement.id });
      await query(
        `UPDATE wujie_user_data
         SET data_value = to_jsonb('2'::text)
         WHERE user_id = $1 AND data_key = '__asset_graph_projects_revision'`,
        [actorUserId],
      );
      const retriedTrash = await service.trashPlacement({ actorUserId, projectId, placementId: firstPlacement.placement.id });
      expect(firstTrash.projectRevision).toBe(1);
      expect(retriedTrash).toEqual({
        placementTrashed: false,
        assetTrashed: false,
        projectRevision: 1,
      });
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
      const concurrentSummary = concurrent.map((result) => result.status === 'fulfilled'
        ? { status: result.status }
        : {
            status: result.status,
            code: errorCode(result),
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
      expect(
        concurrent.filter((result) => result.status === 'fulfilled'),
        `Unexpected concurrent restore results: ${JSON.stringify(concurrentSummary)}`,
      ).toHaveLength(1);
      expect(concurrent.filter((result) => errorCode(result) === 'ASSET_PLACEMENT_CONFLICT')).toHaveLength(1);
      const successfulRestore = concurrent.find((result) => result.status === 'fulfilled');
      expect(successfulRestore?.status === 'fulfilled' ? successfulRestore.value : null).toEqual(
        expect.objectContaining({ projectRevision: 5 }),
      );
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
