import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setImmediate as yieldImmediate } from 'node:timers/promises';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import type {
  HistoricalMediaArchiveRequest,
  HistoricalMediaArchiveResult,
  HistoricalMediaCandidate,
} from '../../src/lib/asset-core/historical-media-remediation';
import {
  type QueryFn,
  withIsolatedPostgres,
} from '../helpers/postgres-test-database';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;
const migrationVersion = '20260821_wj_stable_s4_historical_media_remediations.sql';
const migrationPath = resolve(process.cwd(), 'migrations', migrationVersion);
const OWNER_ID = 'owner-historical-media';
const OTHER_OWNER_ID = 'owner-historical-media-other';
const PROJECT_ID = 'project-historical-media';
const OTHER_PROJECT_ID = 'project-historical-media-other';
const ACTOR_USER_ID = 'administrator-historical-media';
const SELECTED_PLACEMENT_IDS = [
  'placement-canvas-bridge',
  'placement-chat-empty',
  'placement-false-ready-canvas',
  'placement-false-ready-workflow',
] as const;
const SELECTED_VERSION_IDS = [
  'version-canvas-bridge',
  'version-chat-empty',
  'version-false-ready',
] as const;
const SECRET_MARKERS = [
  'do-not-store-this-prompt',
  'sk-do-not-store-this-key',
  'do-not-store-this-token',
  'https://private.example.test/complete/provider/url',
] as const;

interface HistoricalMediaService {
  discoverHistoricalMediaArchiveCandidates(input?: { limit?: number }): Promise<{
    candidates: HistoricalMediaCandidate[];
    counts: {
      versions: number;
      activePlacements: number;
      currentVersions: number;
      nonCurrentVersions: number;
    };
    coverage: {
      eligibleBlockingPlacements: number;
      candidatePlacements: number;
      uncoveredBlockingPlacements: number;
      complete: boolean;
    };
  }>;
  archiveHistoricalMedia(input: {
    actorUserId: string;
    actorUserName: string;
    ipAddress: string | null;
    request: HistoricalMediaArchiveRequest;
  }): Promise<HistoricalMediaArchiveResult>;
}

interface ArchiveCommand {
  actorUserId: string;
  actorUserName: string;
  ipAddress: string | null;
  request: HistoricalMediaArchiveRequest;
}

interface AssetLifecycleService {
  trashPlacement(input: {
    actorUserId: string;
    projectId: string;
    placementId: string;
    assetId?: string;
  }): Promise<{
    placementTrashed: boolean;
    assetTrashed: boolean;
    projectRevision?: number;
  }>;
  restorePlacement(input: {
    actorUserId: string;
    projectId: string;
    placementId: string;
    assetId?: string;
  }): Promise<{
    placement: { id: string; status: string };
    asset: { id: string; status: string };
    projectRevision?: number;
  }>;
}

interface ArchiveState {
  assets: unknown[];
  audit: unknown[];
  ledger: unknown[];
  placements: unknown[];
  projects: unknown[];
  revision: unknown[];
  versions: unknown[];
}

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; historical media remediation PostgreSQL tests skipped.',
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

async function loadHistoricalMediaService(): Promise<HistoricalMediaService> {
  return import('../../src/lib/asset-core/historical-media-remediation') as unknown as Promise<HistoricalMediaService>;
}

async function loadAssetLifecycleService(): Promise<AssetLifecycleService> {
  const { createAssetService } = await import('../../src/lib/asset-core/service');
  return createAssetService();
}

function boundedPostgresUrl(isolatedDatabaseUrl: string): string {
  const parsed = new URL(isolatedDatabaseUrl);
  const existingOptions = parsed.searchParams.get('options')?.trim() || '';
  parsed.searchParams.set(
    'options',
    [
      existingOptions,
      '-cstatement_timeout=8000',
      '-clock_timeout=7500',
      '-cdeadlock_timeout=100ms',
    ].filter(Boolean).join(' '),
  );
  return parsed.toString();
}

function bindBoundedBusinessDatabase(isolatedDatabaseUrl: string): string {
  const databaseUrl = boundedPostgresUrl(isolatedDatabaseUrl);
  process.env.DATABASE_URL = databaseUrl;
  process.env.PGDATABASE_URL = databaseUrl;
  return databaseUrl;
}

async function connectIsolatedClient(databaseUrl: string): Promise<Client> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  return client;
}

async function closeTestClients(clients: Client[]): Promise<void> {
  await Promise.all(clients.map(async client => {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }));
}

async function waitForBlockedQuery(
  monitor: Client,
  queryFragments: string[],
  excludedPids: number[] = [],
): Promise<{ pid: number; query: string }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await monitor.query<{ pid: number; query: string }>(
      `SELECT pid, query
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND NOT (pid = ANY($2::int[]))
         AND EXISTS (
           SELECT 1 FROM unnest($1::text[]) AS fragment
           WHERE position(fragment IN query) > 0
         )
       ORDER BY query_start, pid
       LIMIT 1`,
      [queryFragments, excludedPids],
    );
    if (result.rows[0]) return result.rows[0];
    await yieldImmediate();
  }
  throw new Error(`Timed out waiting for PostgreSQL lock state: ${queryFragments.join(' | ')}`);
}

function unwrapFulfilled<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

async function createRuntimeTables(query: QueryFn): Promise<void> {
  await query(
    `CREATE TABLE wujie_user_data (
       user_id TEXT NOT NULL,
       data_key TEXT NOT NULL,
       data_value JSONB,
       updated_at BIGINT NOT NULL,
       PRIMARY KEY (user_id, data_key)
     )`,
  );
  await query(
    `CREATE TABLE wujie_audit_log (
       id TEXT PRIMARY KEY,
       user_id TEXT NOT NULL DEFAULT '',
       user_name TEXT,
       action TEXT NOT NULL DEFAULT '',
       target_type TEXT,
       target_id TEXT,
       detail TEXT,
       ip_address TEXT,
       created_at BIGINT NOT NULL,
       level TEXT DEFAULT 'info',
       error_message TEXT DEFAULT '',
       stack_trace TEXT DEFAULT '',
       request_data JSONB DEFAULT '{}',
       response_status INTEGER DEFAULT 0,
       duration_ms INTEGER DEFAULT 0,
       model TEXT DEFAULT '',
       provider_id TEXT DEFAULT '',
       resolution_status TEXT DEFAULT 'none',
       resolution_detail TEXT DEFAULT '',
       resolved_at BIGINT,
       resolved_by TEXT DEFAULT ''
     )`,
  );
}

async function seedHistoricalMediaFixture(query: QueryFn): Promise<void> {
  await query(
    `INSERT INTO wujie_projects(id, owner_id, name)
     VALUES ($1, $2, 'Historical media'), ($3, $4, 'Other owner')`,
    [PROJECT_ID, OWNER_ID, OTHER_PROJECT_ID, OTHER_OWNER_ID],
  );
  await query(
    `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
     VALUES
       ('asset-chat-empty', $1, $2, 'image', 'active'),
       ('asset-canvas-bridge', $1, $2, 'image', 'active'),
       ('asset-false-ready', $1, $2, 'image', 'active'),
       ('asset-non-current-broken', $1, $2, 'image', 'active'),
       ('asset-managed', $1, $2, 'image', 'active'),
       ('asset-other-owner', $3, $4, 'image', 'active')`,
    [OWNER_ID, PROJECT_ID, OTHER_OWNER_ID, OTHER_PROJECT_ID],
  );
  await query(
    `INSERT INTO wujie_asset_versions(
       id, asset_id, owner_id, project_id, file_url, storage_key,
       availability, recovery_source_url, metadata
     ) VALUES
       ('version-chat-empty', 'asset-chat-empty', $1, $2, '   ', NULL,
        'missing', NULL, '{}'::jsonb),
       ('version-canvas-bridge', 'asset-canvas-bridge', $1, $2,
        '/v1/images/proxy/canvas-expired', NULL, 'missing', NULL, '{}'::jsonb),
       ('version-false-ready', 'asset-false-ready', $1, $2,
        '/v1/images/proxy/false-ready-expired', NULL, 'ready', NULL,
        jsonb_build_object(
          'prompt', $5::text,
          'apiKey', $6::text,
          'token', $7::text,
          'remoteUrl', $8::text
        )),
       ('version-false-ready-older', 'asset-false-ready', $1, $2,
         '/api/serve-upload/older.png', 'uploads/older.png', 'ready', NULL, '{}'::jsonb),
       ('version-non-current-healthy', 'asset-non-current-broken', $1, $2,
        '/api/serve-upload/non-current-healthy.png', 'uploads/non-current-healthy.png',
        'ready', NULL, '{}'::jsonb),
       ('version-non-current-broken', 'asset-non-current-broken', $1, $2,
        '/v1/images/proxy/non-current-expired', NULL, 'missing', NULL, '{}'::jsonb),
       ('version-managed', 'asset-managed', $1, $2,
        '/api/serve-upload/managed.png', 'uploads/managed.png', 'ready', NULL, '{}'::jsonb),
       ('version-other-owner', 'asset-other-owner', $3, $4,
        '/api/serve-upload/other.png', 'uploads/other.png', 'ready', NULL, '{}'::jsonb)`,
    [
      OWNER_ID,
      PROJECT_ID,
      OTHER_OWNER_ID,
      OTHER_PROJECT_ID,
      ...SECRET_MARKERS,
    ],
  );
  await query(
    `UPDATE wujie_assets
     SET current_version_id = CASE id
       WHEN 'asset-chat-empty' THEN 'version-chat-empty'
       WHEN 'asset-canvas-bridge' THEN 'version-canvas-bridge'
       WHEN 'asset-false-ready' THEN 'version-false-ready'
       WHEN 'asset-non-current-broken' THEN 'version-non-current-healthy'
       WHEN 'asset-managed' THEN 'version-managed'
       WHEN 'asset-other-owner' THEN 'version-other-owner'
     END
     WHERE id IN (
       'asset-chat-empty', 'asset-canvas-bridge', 'asset-false-ready',
       'asset-non-current-broken', 'asset-managed', 'asset-other-owner'
     )`,
  );
  await query(
    `INSERT INTO wujie_workspace_placements(
       id, owner_id, project_id, asset_id, asset_version_id,
       workspace_kind, workspace_id, entity_type, entity_id
     ) VALUES
       ('placement-chat-empty', $1, $2, 'asset-chat-empty', 'version-chat-empty',
        'chat', 'chat-empty', 'chat-result', 'entity-chat-empty'),
       ('placement-canvas-bridge', $1, $2, 'asset-canvas-bridge', 'version-canvas-bridge',
        'canvas', $2, 'canvas-image', 'entity-canvas-bridge'),
       ('placement-false-ready-canvas', $1, $2, 'asset-false-ready', 'version-false-ready',
        'canvas', $2, 'canvas-image', 'entity-false-ready-canvas'),
       ('placement-false-ready-workflow', $1, $2, 'asset-false-ready', 'version-false-ready',
        'workflow', 'workflow-false-ready', 'workflow-output', 'entity-false-ready-workflow'),
       ('placement-false-ready-older', $1, $2, 'asset-false-ready', 'version-false-ready-older',
         'chat', 'chat-older', 'chat-attachment', 'entity-false-ready-older'),
       ('placement-non-current-healthy', $1, $2, 'asset-non-current-broken', 'version-non-current-healthy',
        'canvas', $2, 'canvas-image', 'entity-non-current-healthy'),
       ('placement-non-current-broken', $1, $2, 'asset-non-current-broken', 'version-non-current-broken',
        'canvas', $2, 'canvas-image', 'entity-non-current-broken'),
       ('placement-managed', $1, $2, 'asset-managed', 'version-managed',
        'canvas', $2, 'canvas-image', 'entity-managed')`,
    [OWNER_ID, PROJECT_ID],
  );
  await query(
    `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
     VALUES
       ($1, 'projects', $2::jsonb, 1000),
       ($1, '__asset_graph_projects_revision', '10'::jsonb, 1000)`,
    [OWNER_ID, JSON.stringify([
      {
        id: PROJECT_ID,
        canvasImages: [
          { id: 'entity-canvas-bridge', url: '/v1/images/proxy/canvas-expired' },
           { id: 'entity-false-ready-canvas', url: '/v1/images/proxy/false-ready-expired' },
           { id: 'entity-non-current-healthy', url: '/api/serve-upload/non-current-healthy.png' },
           { id: 'entity-non-current-broken', url: '/v1/images/proxy/non-current-expired' },
           { id: 'entity-managed', url: '/api/serve-upload/managed.png' },
          { id: 'entity-unrelated', url: '/api/serve-upload/unrelated.png' },
        ],
        updatedAt: 1000,
      },
    ])],
  );
}

async function seedOversizedDiscoveryCandidate(
  query: QueryFn,
  placementCount: number,
): Promise<void> {
  await query(
    `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
     VALUES ('asset-000-oversized', $1, $2, 'image', 'active')`,
    [OWNER_ID, PROJECT_ID],
  );
  await query(
    `INSERT INTO wujie_asset_versions(
       id, asset_id, owner_id, project_id, file_url, storage_key,
       availability, recovery_source_url, metadata
     ) VALUES (
       'version-000-oversized', 'asset-000-oversized', $1, $2,
       '/v1/images/proxy/oversized', NULL, 'missing', NULL, '{}'::jsonb
     )`,
    [OWNER_ID, PROJECT_ID],
  );
  await query(
    `UPDATE wujie_assets
     SET current_version_id = 'version-000-oversized'
     WHERE id = 'asset-000-oversized'`,
  );
  await query(
    `INSERT INTO wujie_workspace_placements(
       id, owner_id, project_id, asset_id, asset_version_id,
       workspace_kind, workspace_id, entity_type, entity_id
     )
     SELECT
       lpad(position::text, 3, '0') || repeat($4, 253),
       $1,
       $2,
       'asset-000-oversized',
       'version-000-oversized',
       'chat',
       lpad(position::text, 3, '0') || repeat($4, 253),
       'chat-result',
       lpad(position::text, 3, '0') || repeat($4, 253)
     FROM generate_series(1, $3) AS position`,
    [OWNER_ID, PROJECT_ID, placementCount, '\uFFFF'],
  );
}

async function growCandidatePlacements(
  query: QueryFn,
  placementCount: number,
): Promise<void> {
  await query(
    `INSERT INTO wujie_workspace_placements(
       id, owner_id, project_id, asset_id, asset_version_id,
       workspace_kind, workspace_id, entity_type, entity_id
     )
     SELECT
       lpad(position::text, 3, '0') || repeat($4, 253),
       $1,
       $2,
       'asset-chat-empty',
       'version-chat-empty',
       'chat',
       lpad(position::text, 3, '0') || repeat($4, 253),
       'chat-result',
       lpad(position::text, 3, '0') || repeat($4, 253)
     FROM generate_series(1, $3) AS position`,
    [OWNER_ID, PROJECT_ID, placementCount, '\uFFFE'],
  );
}

async function seedMultiOwnerBatchFixture(query: QueryFn): Promise<void> {
  await query(
    `INSERT INTO wujie_projects(id, owner_id, name) VALUES
       ('project-batch-a', $1, 'Batch A'),
       ('project-batch-b', $2, 'Batch B'),
       ('project-batch-c', $2, 'Batch C'),
       ('project-batch-d', $1, 'Batch D')`,
    [OWNER_ID, OTHER_OWNER_ID],
  );
  await query(
    `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status) VALUES
       ('asset-batch-a', $1, 'project-batch-a', 'image', 'active'),
       ('asset-batch-b', $2, 'project-batch-b', 'image', 'active'),
       ('asset-batch-c', $2, 'project-batch-c', 'image', 'active'),
       ('asset-batch-d', $1, 'project-batch-d', 'image', 'active')`,
    [OWNER_ID, OTHER_OWNER_ID],
  );
  await query(
    `INSERT INTO wujie_asset_versions(
       id, asset_id, owner_id, project_id, file_url, availability, metadata
     ) VALUES
       ('version-batch-a', 'asset-batch-a', $1, 'project-batch-a', '/v1/images/proxy/a', 'missing', '{}'::jsonb),
       ('version-batch-b', 'asset-batch-b', $2, 'project-batch-b', '/v1/images/proxy/b', 'missing', '{}'::jsonb),
       ('version-batch-c', 'asset-batch-c', $2, 'project-batch-c', '/v1/images/proxy/c', 'missing', '{}'::jsonb),
       ('version-batch-d', 'asset-batch-d', $1, 'project-batch-d', '/v1/images/proxy/d', 'missing', '{}'::jsonb)`,
    [OWNER_ID, OTHER_OWNER_ID],
  );
  await query(
    `UPDATE wujie_assets
     SET current_version_id = replace(id, 'asset-', 'version-')
     WHERE id LIKE 'asset-batch-%'`,
  );
  await query(
    `INSERT INTO wujie_workspace_placements(
       id, owner_id, project_id, asset_id, asset_version_id,
       workspace_kind, workspace_id, entity_type, entity_id
     ) VALUES
       ('placement-batch-a', $1, 'project-batch-a', 'asset-batch-a', 'version-batch-a',
        'canvas', 'project-batch-a', 'canvas-image', 'entity-batch-a'),
       ('placement-batch-b', $2, 'project-batch-b', 'asset-batch-b', 'version-batch-b',
        'canvas', 'project-batch-b', 'canvas-image', 'entity-batch-b'),
       ('placement-batch-c', $2, 'project-batch-c', 'asset-batch-c', 'version-batch-c',
        'canvas', 'project-batch-c', 'canvas-image', 'entity-batch-c'),
       ('placement-batch-d', $1, 'project-batch-d', 'asset-batch-d', 'version-batch-d',
        'canvas', 'project-batch-d', 'canvas-image', 'entity-batch-d')`,
    [OWNER_ID, OTHER_OWNER_ID],
  );
  await query(
    `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at) VALUES
       ($1, 'projects', $3::jsonb, 1000),
       ($1, '__asset_graph_projects_revision', '0'::jsonb, 1000),
       ($2, 'projects', $4::jsonb, 1000),
       ($2, '__asset_graph_projects_revision', '0'::jsonb, 1000)`,
    [
      OWNER_ID,
      OTHER_OWNER_ID,
      JSON.stringify([
        { id: 'project-batch-a', canvasImages: [{ id: 'entity-batch-a' }], updatedAt: 1000 },
        { id: 'project-batch-d', canvasImages: [{ id: 'entity-batch-d' }], updatedAt: 1000 },
      ]),
      JSON.stringify([
        { id: 'project-batch-b', canvasImages: [{ id: 'entity-batch-b' }], updatedAt: 1000 },
        { id: 'project-batch-c', canvasImages: [{ id: 'entity-batch-c' }], updatedAt: 1000 },
      ]),
    ],
  );
}

async function prepareHistoricalMediaDatabase(
  isolatedDatabaseUrl: string,
  query: QueryFn,
): Promise<void> {
  runMigrations(isolatedDatabaseUrl);
  await createRuntimeTables(query);
  await seedHistoricalMediaFixture(query);
}

function createArchiveCommand(
  candidates: HistoricalMediaCandidate[],
  idempotencyKey: string = 'historical-media-request-001',
): ArchiveCommand {
  return {
    actorUserId: ACTOR_USER_ID,
    actorUserName: 'Historical Media Administrator',
    ipAddress: '127.0.0.1',
    request: {
      action: 'archive-unrecoverable',
      idempotencyKey,
      reason: 'Historical media bytes are unavailable after review',
      candidates: candidates.map(candidate => ({
        projectId: candidate.projectId,
        assetId: candidate.assetId,
        assetVersionId: candidate.assetVersionId,
        candidateDigest: candidate.candidateDigest,
      })),
    },
  };
}

async function readArchiveState(query: QueryFn): Promise<ArchiveState> {
  const [assets, audit, ledger, placements, projects, revision, versions] = await Promise.all([
    query(
      `SELECT id, status, current_version_id
       FROM wujie_assets ORDER BY id`,
    ),
    query(
      `SELECT id, user_id, user_name, action, target_type, target_id, detail, ip_address
       FROM wujie_audit_log ORDER BY id`,
    ),
    query(
      `SELECT id, actor_user_id, idempotency_key, request_digest, action,
              reason, before_state, result, status
       FROM wujie_asset_media_remediations ORDER BY id`,
    ),
    query(
      `SELECT id, status, deleted_at, metadata
       FROM wujie_workspace_placements ORDER BY id`,
    ),
    query(
      `SELECT data_value
       FROM wujie_user_data
       WHERE user_id = $1 AND data_key = 'projects'`,
      [OWNER_ID],
    ),
    query(
      `SELECT data_value
       FROM wujie_user_data
       WHERE user_id = $1 AND data_key = '__asset_graph_projects_revision'`,
      [OWNER_ID],
    ),
    query(
      `SELECT id, availability, storage_key, recovery_source_url
       FROM wujie_asset_versions ORDER BY id`,
    ),
  ]);
  return {
    assets: assets.rows,
    audit: audit.rows,
    ledger: ledger.rows,
    placements: placements.rows,
    projects: projects.rows,
    revision: revision.rows,
    versions: versions.rows,
  };
}

async function readNonCurrentArchiveState(query: QueryFn): Promise<Record<string, unknown>> {
  const [
    asset,
    audit,
    badPlacement,
    badVersion,
    healthyCurrentVersion,
    healthyPlacement,
    ledger,
    project,
    revision,
  ] = await Promise.all([
    query(`SELECT * FROM wujie_assets WHERE id = 'asset-non-current-broken'`),
    query('SELECT * FROM wujie_audit_log ORDER BY id'),
    query(`SELECT * FROM wujie_workspace_placements WHERE id = 'placement-non-current-broken'`),
    query(`SELECT * FROM wujie_asset_versions WHERE id = 'version-non-current-broken'`),
    query(`SELECT * FROM wujie_asset_versions WHERE id = 'version-non-current-healthy'`),
    query(`SELECT * FROM wujie_workspace_placements WHERE id = 'placement-non-current-healthy'`),
    query('SELECT * FROM wujie_asset_media_remediations ORDER BY id'),
    query(
      `SELECT * FROM wujie_user_data
       WHERE user_id = $1 AND data_key = 'projects'`,
      [OWNER_ID],
    ),
    query(
      `SELECT * FROM wujie_user_data
       WHERE user_id = $1 AND data_key = '__asset_graph_projects_revision'`,
      [OWNER_ID],
    ),
  ]);
  return {
    asset: asset.rows[0],
    audit: audit.rows,
    badPlacement: badPlacement.rows[0],
    badVersion: badVersion.rows[0],
    healthyCurrentVersion: healthyCurrentVersion.rows[0],
    healthyPlacement: healthyPlacement.rows[0],
    ledger: ledger.rows,
    project: project.rows[0],
    revision: revision.rows[0],
  };
}

async function installFailureTrigger(
  query: QueryFn,
  input: {
    functionName: string;
    tableName: 'wujie_audit_log' | 'wujie_user_data';
    timing: 'INSERT' | 'UPDATE';
    message: string;
  },
): Promise<void> {
  await query(
    `CREATE FUNCTION ${input.functionName}() RETURNS trigger
     LANGUAGE plpgsql AS $trigger$
     BEGIN
       RAISE EXCEPTION '${input.message}';
     END;
     $trigger$`,
  );
  await query(
    `CREATE TRIGGER ${input.functionName}_trigger
     BEFORE ${input.timing} ON ${input.tableName}
     FOR EACH ROW EXECUTE FUNCTION ${input.functionName}()`,
  );
}

async function expectNotFoundWithoutOwnerLeak(operation: Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await operation;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code: 'HISTORICAL_MEDIA_NOT_FOUND' });
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  expect(message).not.toContain(OWNER_ID);
  expect(message).not.toContain(OTHER_OWNER_ID);
}

describe('historical media remediation ledger on real PostgreSQL', () => {
  postgresIt('applies the immutable remediation ledger once with an exact checksum', async () => {
    await withIsolatedPostgres('historical-media-ledger', async ({ databaseUrl: isolatedUrl, query }) => {
      runMigrations(isolatedUrl);
      runMigrations(isolatedUrl);

      const columns = await query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'wujie_asset_media_remediations'
         ORDER BY ordinal_position`,
      );
      expect(columns.rows.map(row => row.column_name)).toEqual([
        'id',
        'actor_user_id',
        'idempotency_key',
        'request_digest',
        'action',
        'reason',
        'before_state',
        'result',
        'status',
        'created_at',
        'completed_at',
      ]);

      const checksum = createHash('sha256').update(await readFile(migrationPath)).digest('hex');
      await expect(query(
        'SELECT checksum FROM wujie_schema_migrations WHERE version = $1',
        [migrationVersion],
      )).resolves.toMatchObject({ rows: [{ checksum }] });

      const actorUserId = randomUUID();
      const idempotencyKey = randomUUID();
      const row = [
        randomUUID(),
        actorUserId,
        idempotencyKey,
        'a'.repeat(64),
        'archive-unrecoverable',
        'historical media cannot be recovered',
        JSON.stringify({ availability: 'unrecoverable' }),
        JSON.stringify({ archive: 'recorded' }),
        'completed',
      ];
      const insert = `INSERT INTO wujie_asset_media_remediations(
        id, actor_user_id, idempotency_key, request_digest, action,
        reason, before_state, result, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`;
      await query(insert, row);
      await expect(query(insert, [randomUUID(), ...row.slice(1)])).rejects.toThrow();

      await expect(query(insert, [
        randomUUID(), randomUUID(), randomUUID(), 'b'.repeat(64), 'archive-recoverable',
        'invalid action', '{}', '{}', 'completed',
      ])).rejects.toThrow();
      await expect(query(insert, [
        randomUUID(), randomUUID(), randomUUID(), 'c'.repeat(64), 'archive-unrecoverable',
        'invalid status', '{}', '{}', 'pending',
      ])).rejects.toThrow();
      await expect(query(insert, [
        randomUUID(), randomUUID(), randomUUID(), 'not-a-digest', 'archive-unrecoverable',
        'invalid digest', '{}', '{}', 'completed',
      ])).rejects.toThrow();
    });
  });

  postgresIt('discovers bounded current and non-current broken media without changing database state', async () => {
    await withIsolatedPostgres('historical-media-discovery', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const before = await readArchiveState(query);
      const service = await loadHistoricalMediaService();

      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const readinessBlockers = await query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM wujie_workspace_placements placement
         JOIN wujie_asset_versions version
           ON version.id = placement.asset_version_id
          AND version.asset_id = placement.asset_id
          AND version.owner_id = placement.owner_id
          AND version.project_id = placement.project_id
         WHERE placement.status = 'active'
           AND (
             version.availability IN ('missing', 'unrecoverable')
             OR (
               version.availability = 'ready'
               AND (
                 btrim(coalesce(version.file_url, '')) = ''
                 OR version.file_url LIKE '/v1/images/proxy/%'
               )
               AND nullif(btrim(coalesce(version.storage_key, '')), '') IS NULL
               AND nullif(btrim(coalesce(version.recovery_source_url, '')), '') IS NULL
             )
           )`,
      );

      expect(readinessBlockers.rows).toEqual([{ count: 5 }]);
      expect(discovery.counts).toEqual({
        versions: 4,
        activePlacements: 5,
        currentVersions: 3,
        nonCurrentVersions: 1,
      });
      expect(discovery.coverage).toEqual({
        eligibleBlockingPlacements: 5,
        candidatePlacements: 5,
        uncoveredBlockingPlacements: 0,
        complete: true,
      });
      expect(discovery.candidates.flatMap(item => item.placements)).toHaveLength(5);
      expect(discovery.candidates.map(item => item.assetId)).toEqual([
        'asset-canvas-bridge',
        'asset-chat-empty',
        'asset-false-ready',
        'asset-non-current-broken',
      ]);
      expect(discovery.candidates.find(
        item => item.assetVersionId === 'version-non-current-broken',
      )).toMatchObject({ isCurrentVersion: false });
      expect(discovery.candidates.some(item => item.assetId === 'asset-managed')).toBe(false);
      expect(discovery.candidates.every(item => item.ownerId === OWNER_ID)).toBe(true);
      expect(discovery.candidates.every(item => /^[a-f0-9]{64}$/.test(item.candidateDigest))).toBe(true);
      expect(await readArchiveState(query)).toEqual(before);
    });
  });

  postgresIt('keeps current and non-current broken versions of one asset as separate candidates', async () => {
    await withIsolatedPostgres('historical-media-same-asset-versions', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, storage_key,
           availability, recovery_source_url, metadata
         ) VALUES (
           'version-false-ready-extra-broken', 'asset-false-ready', $1, $2,
           '/v1/images/proxy/false-ready-extra-expired', NULL, 'missing', NULL, '{}'::jsonb
         )`,
        [OWNER_ID, PROJECT_ID],
      );
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id,
           workspace_kind, workspace_id, entity_type, entity_id
         ) VALUES (
           'placement-false-ready-extra-broken', $1, $2, 'asset-false-ready',
           'version-false-ready-extra-broken', 'canvas', $2, 'canvas-image',
           'entity-false-ready-extra-broken'
         )`,
        [OWNER_ID, PROJECT_ID],
      );

      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const sameAssetCandidates = discovery.candidates.filter(
        candidate => candidate.assetId === 'asset-false-ready',
      );

      expect(sameAssetCandidates).toHaveLength(2);
      expect(sameAssetCandidates.map(candidate => ({
        assetVersionId: candidate.assetVersionId,
        isCurrentVersion: candidate.isCurrentVersion,
        placementIds: candidate.placements.map(placement => placement.id),
      }))).toEqual([
        {
          assetVersionId: 'version-false-ready',
          isCurrentVersion: true,
          placementIds: ['placement-false-ready-canvas', 'placement-false-ready-workflow'],
        },
        {
          assetVersionId: 'version-false-ready-extra-broken',
          isCurrentVersion: false,
          placementIds: ['placement-false-ready-extra-broken'],
        },
      ]);
      expect(new Set(sameAssetCandidates.map(candidate => candidate.candidateDigest)).size).toBe(2);
      expect(discovery.counts).toEqual({
        versions: 5,
        activePlacements: 6,
        currentVersions: 3,
        nonCurrentVersions: 2,
      });
      expect(discovery.coverage).toEqual({
        eligibleBlockingPlacements: 6,
        candidatePlacements: 6,
        uncoveredBlockingPlacements: 0,
        complete: true,
      });
    });
  });

  postgresIt('computes discovery candidates and coverage from one PostgreSQL statement snapshot', async () => {
    await withIsolatedPostgres('historical-media-discovery-snapshot', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const databaseUrl = bindBoundedBusinessDatabase(isolatedUrl);
      const barrier = await connectIsolatedClient(databaseUrl);
      const writer = await connectIsolatedClient(databaseUrl);
      const monitor = await connectIsolatedClient(databaseUrl);
      const gateClass = 178735;
      const gateKey = 2202;

      try {
        await query(
          `CREATE FUNCTION historical_media_discovery_snapshot_gate() RETURNS boolean
           LANGUAGE plpgsql VOLATILE AS $gate$
           BEGIN
             PERFORM pg_advisory_xact_lock(${gateClass}, ${gateKey});
             RETURN true;
           END;
           $gate$`,
        );
        await query(
          'ALTER TABLE wujie_workspace_placements RENAME TO wujie_workspace_placements_snapshot_base',
        );
        await query(
          `CREATE VIEW wujie_workspace_placements AS
           SELECT placement.*
           FROM wujie_workspace_placements_snapshot_base placement
           WHERE historical_media_discovery_snapshot_gate()`,
        );

        const barrierPid = Number((await barrier.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid);
        const writerPid = Number((await writer.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid);
        await barrier.query('SELECT pg_advisory_lock($1, $2)', [gateClass, gateKey]);

        const service = await loadHistoricalMediaService();
        const discoveryPromise = service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
        await waitForBlockedQuery(
          monitor,
          ['eligible_blocking_placements', 'wujie_workspace_placements'],
          [barrierPid, writerPid],
        );

        await writer.query(
          `INSERT INTO wujie_asset_versions(
             id, asset_id, owner_id, project_id, file_url, storage_key,
             availability, recovery_source_url, metadata
           ) VALUES (
             'version-concurrent-broken', 'asset-managed', $1, $2,
             '/v1/images/proxy/concurrent-expired', NULL, 'missing', NULL, '{}'::jsonb
           )`,
          [OWNER_ID, PROJECT_ID],
        );
        await writer.query(
          `INSERT INTO wujie_workspace_placements_snapshot_base(
             id, owner_id, project_id, asset_id, asset_version_id,
             workspace_kind, workspace_id, entity_type, entity_id
           ) VALUES (
             'placement-concurrent-broken', $1, $2, 'asset-managed',
             'version-concurrent-broken', 'canvas', $2, 'canvas-image',
             'entity-concurrent-broken'
           )`,
          [OWNER_ID, PROJECT_ID],
        );
        await barrier.query('SELECT pg_advisory_unlock($1, $2)', [gateClass, gateKey]);

        const discovery = await discoveryPromise;
        expect(discovery.coverage.eligibleBlockingPlacements).toBe(
          discovery.coverage.candidatePlacements,
        );
        expect(discovery.coverage).toMatchObject({
          uncoveredBlockingPlacements: 0,
          complete: true,
        });
      } finally {
        await barrier.query('SELECT pg_advisory_unlock($1, $2)', [gateClass, gateKey]).catch(() => undefined);
        await closeTestClients([barrier, writer, monitor]);
      }
    });
  }, 20_000);

  postgresIt('reports incomplete coverage when the discovery limit omits eligible placements', async () => {
    await withIsolatedPostgres('historical-media-limited-discovery', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const service = await loadHistoricalMediaService();

      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 2 });

      expect(discovery.counts).toEqual({
        versions: 2,
        activePlacements: 2,
        currentVersions: 2,
        nonCurrentVersions: 0,
      });
      expect(discovery.coverage).toEqual({
        eligibleBlockingPlacements: 5,
        candidatePlacements: 2,
        uncoveredBlockingPlacements: 3,
        complete: false,
      });
    });
  });

  postgresIt('skips an oversized database candidate while preserving bounded discovery counts', async () => {
    await withIsolatedPostgres('historical-media-oversized-discovery', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      await seedOversizedDiscoveryCandidate(query, 100);
      const service = await loadHistoricalMediaService();

      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });

      expect(discovery.candidates.map(candidate => candidate.assetId)).toEqual([
        'asset-canvas-bridge',
        'asset-chat-empty',
        'asset-false-ready',
        'asset-non-current-broken',
      ]);
      expect(discovery.candidates.some(candidate => candidate.assetId === 'asset-000-oversized')).toBe(false);
      expect(discovery.counts).toEqual({
        versions: 4,
        activePlacements: 5,
        currentVersions: 3,
        nonCurrentVersions: 1,
      });
      expect(discovery.coverage).toEqual({
        eligibleBlockingPlacements: 105,
        candidatePlacements: 5,
        uncoveredBlockingPlacements: 100,
        complete: false,
      });
    });
  });

  postgresIt('fails stale when locked placement facts grow beyond the reviewed canonical bound', async () => {
    await withIsolatedPostgres('historical-media-oversized-stale', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const candidate = discovery.candidates.find(
        item => item.assetId === 'asset-chat-empty',
      ) as HistoricalMediaCandidate;
      await growCandidatePlacements(query, 100);

      await expect(service.archiveHistoricalMedia(createArchiveCommand(
        [candidate],
        'historical-media-oversized-stale',
      ))).rejects.toMatchObject({ code: 'HISTORICAL_MEDIA_CANDIDATE_STALE' });

      await expect(query(
        `SELECT
           (SELECT count(*)::int FROM wujie_asset_media_remediations) AS ledger,
           (SELECT count(*)::int FROM wujie_audit_log) AS audit,
           (SELECT count(*)::int FROM wujie_workspace_placements WHERE status = 'trashed') AS trashed`,
      )).resolves.toMatchObject({ rows: [{ ledger: 0, audit: 0, trashed: 0 }] });
    });
  });

  postgresIt('archives only a non-current broken version while preserving healthy current media', async () => {
    await withIsolatedPostgres('historical-media-non-current-archive', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const candidate = discovery.candidates.find(
        item => item.assetVersionId === 'version-non-current-broken',
      ) as HistoricalMediaCandidate;
      const before = await readNonCurrentArchiveState(query);

      const result = await service.archiveHistoricalMedia(createArchiveCommand(
        [candidate],
        'historical-media-non-current-archive',
      ));
      const after = await readNonCurrentArchiveState(query);

      expect(result).toMatchObject({
        reused: false,
        archivedVersionCount: 1,
        archivedPlacementCount: 1,
        projectRevisions: { [PROJECT_ID]: 11 },
      });
      expect(after.asset).toEqual(before.asset);
      expect(after.healthyCurrentVersion).toEqual(before.healthyCurrentVersion);
      expect(after.healthyPlacement).toEqual(before.healthyPlacement);
      expect(after.badVersion).toMatchObject({
        ...(before.badVersion as Record<string, unknown>),
        availability: 'unrecoverable',
      });
      const {
        status: _beforeStatus,
        deleted_at: _beforeDeletedAt,
        metadata: beforeMetadata,
        updated_at: beforeUpdatedAt,
        ...beforeStableBadPlacement
      } = before.badPlacement as Record<string, unknown>;
      const {
        status: afterStatus,
        deleted_at: afterDeletedAt,
        metadata: afterMetadata,
        updated_at: afterUpdatedAt,
        ...afterStableBadPlacement
      } = after.badPlacement as Record<string, unknown>;
      expect(_beforeStatus).toBe('active');
      expect(_beforeDeletedAt).toBeNull();
      expect(afterStableBadPlacement).toEqual(beforeStableBadPlacement);
      expect(afterMetadata).toEqual({
        ...(beforeMetadata as Record<string, unknown>),
        canvasTrashProjectRevision: 11,
      });
      expect(afterStatus).toBe('trashed');
      expect(afterDeletedAt).toBeInstanceOf(Date);
      expect(afterUpdatedAt).toBeInstanceOf(Date);
      expect((afterUpdatedAt as Date).getTime()).toBeGreaterThanOrEqual(
        (beforeUpdatedAt as Date).getTime(),
      );
      expect((after.asset as Record<string, unknown>).current_version_id).toBe(
        'version-non-current-healthy',
      );
      expect((after.project as { data_value: Array<{ canvasImages: Array<{ id: string }> }> })
        .data_value[0]?.canvasImages.map(image => image.id)).toEqual([
        'entity-canvas-bridge',
        'entity-false-ready-canvas',
        'entity-non-current-healthy',
        'entity-managed',
        'entity-unrelated',
      ]);
      expect((after.revision as { data_value: number }).data_value).toBe(11);
      expect(after.ledger).toEqual([
        expect.objectContaining({
          actor_user_id: ACTOR_USER_ID,
          idempotency_key: 'historical-media-non-current-archive',
          before_state: expect.objectContaining({
            candidateCount: 1,
            placementCount: 1,
            candidates: [expect.objectContaining({
              assetVersionId: 'version-non-current-broken',
              isCurrentVersion: false,
            })],
          }),
        }),
      ]);
      expect(after.audit).toEqual([
        expect.objectContaining({
          user_id: ACTOR_USER_ID,
          action: 'historical_media_archive',
          target_type: 'asset_media_remediation',
        }),
      ]);
    });
  });

  postgresIt('serializes identical archives, reuses one result and rejects a changed request', async () => {
    await withIsolatedPostgres('historical-media-concurrent-archive', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const command = createArchiveCommand(
        discovery.candidates.filter(candidate => candidate.isCurrentVersion),
      );

      const concurrent = await Promise.all([
        service.archiveHistoricalMedia(command),
        service.archiveHistoricalMedia(command),
      ]);

      expect(concurrent.map(result => result.reused).sort()).toEqual([false, true]);
      expect(new Set(concurrent.map(result => result.remediationId)).size).toBe(1);
      expect(concurrent[0]?.remediationId).toBeTruthy();
      const created = concurrent.find(result => !result.reused);
      expect(created).toMatchObject({
        archivedVersionCount: 3,
        archivedPlacementCount: 4,
        projectRevisions: { [PROJECT_ID]: 12 },
      });

      const normalizedRetry = await service.archiveHistoricalMedia({
        ...command,
        actorUserId: `  ${ACTOR_USER_ID}  `,
        request: {
          ...command.request,
          idempotencyKey: `  ${command.request.idempotencyKey}  `,
          reason: `  ${command.request.reason}  `,
          candidates: [...command.request.candidates].reverse().map(candidate => ({
            ...candidate,
            projectId: ` ${candidate.projectId} `,
          })),
        },
      });
      expect(normalizedRetry).toEqual({ ...created, reused: true });

      await expect(service.archiveHistoricalMedia({
        ...command,
        request: { ...command.request, reason: 'Different reviewed reason' },
      })).rejects.toMatchObject({ code: 'HISTORICAL_MEDIA_IDEMPOTENCY_CONFLICT' });

      const archivedPlacements = await query<{
        id: string;
        status: string;
        deleted: boolean;
      }>(
        `SELECT id, status, deleted_at IS NOT NULL AS deleted
         FROM wujie_workspace_placements
         WHERE id = ANY($1::text[]) ORDER BY id`,
        [[...SELECTED_PLACEMENT_IDS]],
      );
      expect(archivedPlacements.rows).toEqual(
        [...SELECTED_PLACEMENT_IDS].sort().map(id => ({ id, status: 'trashed', deleted: true })),
      );

      const archivedVersions = await query<{ id: string; availability: string }>(
        `SELECT id, availability FROM wujie_asset_versions
         WHERE id = ANY($1::text[]) ORDER BY id`,
        [[...SELECTED_VERSION_IDS]],
      );
      expect(archivedVersions.rows).toEqual(
        [...SELECTED_VERSION_IDS].sort().map(id => ({ id, availability: 'unrecoverable' })),
      );

      const retained = await query<{ id: string; status: string; availability: string }>(
        `SELECT asset.id, asset.status, version.availability
         FROM wujie_assets asset
         JOIN wujie_asset_versions version ON version.id = asset.current_version_id
         WHERE asset.id = 'asset-managed'`,
      );
      expect(retained.rows).toEqual([{ id: 'asset-managed', status: 'active', availability: 'ready' }]);

      const assetStatuses = await query<{ id: string; status: string }>(
        `SELECT id, status FROM wujie_assets
         WHERE id = ANY($1::text[]) ORDER BY id`,
        [['asset-canvas-bridge', 'asset-chat-empty', 'asset-false-ready']],
      );
      expect(assetStatuses.rows).toEqual([
        { id: 'asset-canvas-bridge', status: 'trashed' },
        { id: 'asset-chat-empty', status: 'trashed' },
        { id: 'asset-false-ready', status: 'active' },
      ]);
      await expect(query(
        `SELECT status FROM wujie_workspace_placements
         WHERE id = 'placement-false-ready-older'`,
      )).resolves.toMatchObject({ rows: [{ status: 'active' }] });

      const projectSnapshot = await query<{ data_value: Array<{ id: string; canvasImages: Array<{ id: string }> }> }>(
        `SELECT data_value FROM wujie_user_data
         WHERE user_id = $1 AND data_key = 'projects'`,
        [OWNER_ID],
      );
      expect(projectSnapshot.rows[0]?.data_value[0]?.canvasImages.map(image => image.id)).toEqual([
        'entity-non-current-healthy',
        'entity-non-current-broken',
        'entity-managed',
        'entity-unrelated',
      ]);
      await expect(query(
        `SELECT data_value #>> '{}' AS revision FROM wujie_user_data
         WHERE user_id = $1 AND data_key = '__asset_graph_projects_revision'`,
        [OWNER_ID],
      )).resolves.toMatchObject({ rows: [{ revision: '12' }] });

      const ledger = await query<{
        id: string;
        actor_user_id: string;
        idempotency_key: string;
        request_digest: string;
        before_state: Record<string, unknown>;
        result: HistoricalMediaArchiveResult;
      }>(
        `SELECT id, actor_user_id, idempotency_key, request_digest, before_state, result
         FROM wujie_asset_media_remediations`,
      );
      expect(ledger.rows).toHaveLength(1);
      expect(ledger.rows[0]).toMatchObject({
        id: created?.remediationId,
        actor_user_id: ACTOR_USER_ID,
        idempotency_key: command.request.idempotencyKey,
        request_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        before_state: { candidateCount: 3, placementCount: 4 },
        result: created,
      });

      const audit = await query<{
        user_id: string;
        action: string;
        target_type: string;
        target_id: string;
        detail: string;
      }>('SELECT user_id, action, target_type, target_id, detail FROM wujie_audit_log');
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        user_id: ACTOR_USER_ID,
        action: 'historical_media_archive',
        target_type: 'asset_media_remediation',
        target_id: created?.remediationId,
      });
      expect(JSON.parse(audit.rows[0]?.detail ?? '{}')).toEqual({
        remediationId: created?.remediationId,
        candidateCount: 3,
        placementCount: 4,
      });

      const persistedSummaries = JSON.stringify({ ledger: ledger.rows, audit: audit.rows });
      for (const secret of SECRET_MARKERS) expect(persistedSummaries).not.toContain(secret);
      expect(audit.rows[0]?.detail).not.toContain(command.request.idempotencyKey);

      await expect(query(
        `SELECT
           (SELECT count(*)::int FROM wujie_assets) AS assets,
           (SELECT count(*)::int FROM wujie_asset_versions) AS versions,
           (SELECT count(*)::int FROM wujie_workspace_placements) AS placements,
           (SELECT count(*)::int FROM wujie_asset_media_remediations) AS request_results,
           (SELECT count(*)::int FROM wujie_audit_log) AS audits`,
      )).resolves.toMatchObject({
        rows: [{ assets: 6, versions: 8, placements: 8, request_results: 1, audits: 1 }],
      });
    });
  });

  postgresIt('serializes archive before overlapping Canvas trash without deadlock or partial state', async () => {
    await withIsolatedPostgres('historical-media-canvas-trash-overlap', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const databaseUrl = bindBoundedBusinessDatabase(isolatedUrl);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const candidate = discovery.candidates.find(
        item => item.assetId === 'asset-canvas-bridge',
      ) as HistoricalMediaCandidate;
      const lifecycle = await loadAssetLifecycleService();
      const [assetBarrier, monitor] = await Promise.all([
        connectIsolatedClient(databaseUrl),
        connectIsolatedClient(databaseUrl),
      ]);
      const operations: Promise<unknown>[] = [];

      try {
        await assetBarrier.query('BEGIN');
        await assetBarrier.query(
          `SELECT id FROM wujie_assets
           WHERE id = 'asset-canvas-bridge' FOR UPDATE`,
        );

        const archive = service.archiveHistoricalMedia(createArchiveCommand(
          [candidate],
          'historical-media-canvas-trash-overlap',
        ));
        operations.push(archive);
        const archiveActivity = await waitForBlockedQuery(
          monitor,
          ['FOR UPDATE OF asset, version'],
        );

        const trash = lifecycle.trashPlacement({
          actorUserId: OWNER_ID,
          projectId: PROJECT_ID,
          placementId: 'placement-canvas-bridge',
          assetId: 'asset-canvas-bridge',
        });
        operations.push(trash);
        await waitForBlockedQuery(
          monitor,
          ['pg_advisory_xact_lock(hashtext($1), hashtext($2))'],
          [archiveActivity.pid],
        );

        await assetBarrier.query('COMMIT');
        const [archiveSettled, trashSettled] = await Promise.allSettled([archive, trash]);
        const archiveResult = unwrapFulfilled(archiveSettled);
        const trashResult = unwrapFulfilled(trashSettled);

        expect(archiveResult).toMatchObject({
          archivedVersionCount: 1,
          archivedPlacementCount: 1,
          projectRevisions: { [PROJECT_ID]: 11 },
        });
        expect(trashResult).toEqual({
          placementTrashed: false,
          assetTrashed: false,
          projectRevision: 11,
        });
        await expect(query(
          `SELECT
             (SELECT status FROM wujie_assets WHERE id = 'asset-canvas-bridge') AS asset_status,
             (SELECT availability FROM wujie_asset_versions WHERE id = 'version-canvas-bridge') AS availability,
             (SELECT status FROM wujie_workspace_placements WHERE id = 'placement-canvas-bridge') AS placement_status,
             (SELECT data_value #>> '{}' FROM wujie_user_data
               WHERE user_id = $1 AND data_key = '__asset_graph_projects_revision') AS revision,
             (SELECT count(*)::int FROM wujie_asset_media_remediations) AS ledger,
             (SELECT count(*)::int FROM wujie_audit_log) AS audit`,
          [OWNER_ID],
        )).resolves.toMatchObject({
          rows: [{
            asset_status: 'trashed',
            availability: 'unrecoverable',
            placement_status: 'trashed',
            revision: '11',
            ledger: 1,
            audit: 1,
          }],
        });
      } finally {
        await assetBarrier.query('ROLLBACK').catch(() => undefined);
        await Promise.allSettled(operations);
        await closeTestClients([assetBarrier, monitor]);
      }
    });
  }, 20_000);

  postgresIt('serializes archive before overlapping Canvas restore without deadlock or partial state', async () => {
    await withIsolatedPostgres('historical-media-canvas-restore-overlap', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id,
           workspace_kind, workspace_id, entity_type, entity_id,
           status, deleted_at, transform, metadata
         ) VALUES (
           'placement-canvas-restore', $1, $2, 'asset-canvas-bridge', 'version-canvas-bridge',
           'canvas', $2, 'canvas-image', 'entity-canvas-restore',
           'trashed', now(), '{"x":40,"y":50}'::jsonb,
           '{"legacyImage":{"name":"Restored historical image"}}'::jsonb
         )`,
        [OWNER_ID, PROJECT_ID],
      );
      const databaseUrl = bindBoundedBusinessDatabase(isolatedUrl);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const candidate = discovery.candidates.find(
        item => item.assetId === 'asset-canvas-bridge',
      ) as HistoricalMediaCandidate;
      const lifecycle = await loadAssetLifecycleService();
      const [assetBarrier, monitor] = await Promise.all([
        connectIsolatedClient(databaseUrl),
        connectIsolatedClient(databaseUrl),
      ]);
      const operations: Promise<unknown>[] = [];

      try {
        await assetBarrier.query('BEGIN');
        await assetBarrier.query(
          `SELECT id FROM wujie_assets
           WHERE id = 'asset-canvas-bridge' FOR UPDATE`,
        );

        const archive = service.archiveHistoricalMedia(createArchiveCommand(
          [candidate],
          'historical-media-canvas-restore-overlap',
        ));
        operations.push(archive);
        const archiveActivity = await waitForBlockedQuery(
          monitor,
          ['FOR UPDATE OF asset, version'],
        );

        const restore = lifecycle.restorePlacement({
          actorUserId: OWNER_ID,
          projectId: PROJECT_ID,
          placementId: 'placement-canvas-restore',
          assetId: 'asset-canvas-bridge',
        });
        operations.push(restore);
        await waitForBlockedQuery(
          monitor,
          ['pg_advisory_xact_lock(hashtext($1), hashtext($2))'],
          [archiveActivity.pid],
        );

        await assetBarrier.query('COMMIT');
        const [archiveSettled, restoreSettled] = await Promise.allSettled([archive, restore]);
        const archiveResult = unwrapFulfilled(archiveSettled);

        expect(archiveResult).toMatchObject({
          archivedVersionCount: 1,
          archivedPlacementCount: 1,
          projectRevisions: { [PROJECT_ID]: 11 },
        });
        expect(restoreSettled).toMatchObject({
          status: 'rejected',
          reason: { code: 'ASSET_MEDIA_UNRECOVERABLE' },
        });
        const state = await query<{
          asset_status: string;
          archived_status: string;
          restored_status: string;
          availability: string;
          revision: string;
          snapshot: Array<{ canvasImages: Array<{ id: string }> }>;
          ledger: number;
          audit: number;
        }>(
          `SELECT
             (SELECT status FROM wujie_assets WHERE id = 'asset-canvas-bridge') AS asset_status,
             (SELECT status FROM wujie_workspace_placements WHERE id = 'placement-canvas-bridge') AS archived_status,
             (SELECT status FROM wujie_workspace_placements WHERE id = 'placement-canvas-restore') AS restored_status,
             (SELECT availability FROM wujie_asset_versions WHERE id = 'version-canvas-bridge') AS availability,
             (SELECT data_value #>> '{}' FROM wujie_user_data
               WHERE user_id = $1 AND data_key = '__asset_graph_projects_revision') AS revision,
             (SELECT data_value FROM wujie_user_data
               WHERE user_id = $1 AND data_key = 'projects') AS snapshot,
             (SELECT count(*)::int FROM wujie_asset_media_remediations) AS ledger,
             (SELECT count(*)::int FROM wujie_audit_log) AS audit`,
          [OWNER_ID],
        );
        expect(state.rows[0]).toMatchObject({
          asset_status: 'trashed',
          archived_status: 'trashed',
          restored_status: 'trashed',
          availability: 'unrecoverable',
          revision: '11',
          ledger: 1,
          audit: 1,
        });
        const imageIds = state.rows[0]?.snapshot[0]?.canvasImages.map(image => image.id) ?? [];
        expect(imageIds).not.toContain('entity-canvas-bridge');
        expect(imageIds).not.toContain('entity-canvas-restore');
      } finally {
        await assetBarrier.query('ROLLBACK').catch(() => undefined);
        await Promise.allSettled(operations);
        await closeTestClients([assetBarrier, monitor]);
      }
    });
  }, 20_000);

  postgresIt('serializes reversed different-key multi-owner batches in database-derived owner order', async () => {
    await withIsolatedPostgres('historical-media-multi-owner-overlap', async ({ databaseUrl: isolatedUrl, query }) => {
      runMigrations(isolatedUrl);
      await createRuntimeTables(query);
      await seedMultiOwnerBatchFixture(query);
      const databaseUrl = bindBoundedBusinessDatabase(isolatedUrl);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const byAsset = new Map(discovery.candidates.map(candidate => [candidate.assetId, candidate]));
      const firstCommand = createArchiveCommand([
        byAsset.get('asset-batch-a') as HistoricalMediaCandidate,
        byAsset.get('asset-batch-c') as HistoricalMediaCandidate,
      ], 'historical-media-multi-owner-first');
      const secondCommand = createArchiveCommand([
        byAsset.get('asset-batch-b') as HistoricalMediaCandidate,
        byAsset.get('asset-batch-d') as HistoricalMediaCandidate,
      ], 'historical-media-multi-owner-second');
      const [firstBarrier, secondBarrier, monitor] = await Promise.all([
        connectIsolatedClient(databaseUrl),
        connectIsolatedClient(databaseUrl),
        connectIsolatedClient(databaseUrl),
      ]);
      const operations: Promise<unknown>[] = [];

      try {
        await firstBarrier.query('BEGIN');
        await firstBarrier.query(
          `SELECT id FROM wujie_assets WHERE id = 'asset-batch-c' FOR UPDATE`,
        );
        await secondBarrier.query('BEGIN');
        await secondBarrier.query(
          `SELECT id FROM wujie_assets WHERE id = 'asset-batch-d' FOR UPDATE`,
        );

        const firstArchive = service.archiveHistoricalMedia(firstCommand);
        operations.push(firstArchive);
        const firstActivity = await waitForBlockedQuery(
          monitor,
          ['FOR UPDATE OF asset, version'],
        );

        const secondArchive = service.archiveHistoricalMedia(secondCommand);
        operations.push(secondArchive);
        await waitForBlockedQuery(
          monitor,
          [
            'FOR UPDATE OF asset, version',
            'pg_advisory_xact_lock(hashtext($1), hashtext($2))',
          ],
          [firstActivity.pid],
        );

        await Promise.all([
          firstBarrier.query('COMMIT'),
          secondBarrier.query('COMMIT'),
        ]);
        const [firstSettled, secondSettled] = await Promise.allSettled([
          firstArchive,
          secondArchive,
        ]);
        const firstResult = unwrapFulfilled(firstSettled);
        const secondResult = unwrapFulfilled(secondSettled);

        expect(firstResult).toMatchObject({
          archivedVersionCount: 2,
          archivedPlacementCount: 2,
          projectRevisions: {
            'project-batch-a': 1,
            'project-batch-c': 1,
          },
        });
        expect(secondResult).toMatchObject({
          archivedVersionCount: 2,
          archivedPlacementCount: 2,
          projectRevisions: {
            'project-batch-b': 2,
            'project-batch-d': 2,
          },
        });
        await expect(query(
          `SELECT
             (SELECT count(*)::int FROM wujie_assets
               WHERE id LIKE 'asset-batch-%' AND status = 'trashed') AS assets,
             (SELECT count(*)::int FROM wujie_asset_versions
               WHERE id LIKE 'version-batch-%' AND availability = 'unrecoverable') AS versions,
             (SELECT count(*)::int FROM wujie_workspace_placements
               WHERE id LIKE 'placement-batch-%' AND status = 'trashed') AS placements,
             (SELECT count(*)::int FROM wujie_asset_media_remediations) AS ledger,
             (SELECT count(*)::int FROM wujie_audit_log) AS audit,
             (SELECT data_value #>> '{}' FROM wujie_user_data
               WHERE user_id = $1 AND data_key = '__asset_graph_projects_revision') AS first_revision,
             (SELECT data_value #>> '{}' FROM wujie_user_data
               WHERE user_id = $2 AND data_key = '__asset_graph_projects_revision') AS second_revision`,
          [OWNER_ID, OTHER_OWNER_ID],
        )).resolves.toMatchObject({
          rows: [{
            assets: 4,
            versions: 4,
            placements: 4,
            ledger: 2,
            audit: 2,
            first_revision: '2',
            second_revision: '2',
          }],
        });
      } finally {
        await Promise.all([
          firstBarrier.query('ROLLBACK').catch(() => undefined),
          secondBarrier.query('ROLLBACK').catch(() => undefined),
        ]);
        await Promise.allSettled(operations);
        await closeTestClients([firstBarrier, secondBarrier, monitor]);
      }
    });
  }, 20_000);

  postgresIt('rejects changed placements, recovered sources and current-version identity changes as stale', async () => {
    await withIsolatedPostgres('historical-media-stale-candidates', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const byAsset = new Map(discovery.candidates.map(candidate => [candidate.assetId, candidate]));

      await query(
        `INSERT INTO wujie_workspace_placements(
           id, owner_id, project_id, asset_id, asset_version_id,
           workspace_kind, workspace_id, entity_type, entity_id
         ) VALUES (
           'placement-chat-empty-added', $1, $2, 'asset-chat-empty', 'version-chat-empty',
           'chat', 'chat-empty', 'chat-attachment', 'entity-chat-empty-added'
         )`,
        [OWNER_ID, PROJECT_ID],
      );
      await expect(service.archiveHistoricalMedia(createArchiveCommand(
        [byAsset.get('asset-chat-empty') as HistoricalMediaCandidate],
        'historical-media-stale-placement',
      ))).rejects.toMatchObject({ code: 'HISTORICAL_MEDIA_CANDIDATE_STALE' });

      await query(
        `UPDATE wujie_asset_versions
         SET storage_key = 'uploads/recovered-canvas.png'
         WHERE id = 'version-canvas-bridge'`,
      );
      await expect(service.archiveHistoricalMedia(createArchiveCommand(
        [byAsset.get('asset-canvas-bridge') as HistoricalMediaCandidate],
        'historical-media-stale-recovered',
      ))).rejects.toMatchObject({ code: 'HISTORICAL_MEDIA_CANDIDATE_STALE' });

      await query(
        `UPDATE wujie_assets
         SET current_version_id = 'version-false-ready-older'
         WHERE id = 'asset-false-ready'`,
      );
      await expect(service.archiveHistoricalMedia(createArchiveCommand(
        [byAsset.get('asset-false-ready') as HistoricalMediaCandidate],
        'historical-media-stale-current-version',
      ))).rejects.toMatchObject({ code: 'HISTORICAL_MEDIA_CANDIDATE_STALE' });

      await query(
        `UPDATE wujie_assets
         SET current_version_id = 'version-non-current-broken'
         WHERE id = 'asset-non-current-broken'`,
      );
      await expect(service.archiveHistoricalMedia(createArchiveCommand(
        [byAsset.get('asset-non-current-broken') as HistoricalMediaCandidate],
        'historical-media-stale-promoted-current-version',
      ))).rejects.toMatchObject({ code: 'HISTORICAL_MEDIA_CANDIDATE_STALE' });

      await expect(query(
        `SELECT count(*)::int AS count FROM wujie_workspace_placements
         WHERE id = ANY($1::text[]) AND status = 'trashed'`,
        [[...SELECTED_PLACEMENT_IDS]],
      )).resolves.toMatchObject({ rows: [{ count: 0 }] });
      await expect(query(
        `SELECT
           (SELECT count(*)::int FROM wujie_asset_media_remediations) AS ledger,
           (SELECT count(*)::int FROM wujie_audit_log) AS audit`,
      )).resolves.toMatchObject({ rows: [{ ledger: 0, audit: 0 }] });
    });
  });

  postgresIt('rolls back the whole archive when the Canvas snapshot update fails', async () => {
    await withIsolatedPostgres('historical-media-snapshot-rollback', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const before = await readArchiveState(query);
      await installFailureTrigger(query, {
        functionName: 'fail_historical_media_snapshot',
        tableName: 'wujie_user_data',
        timing: 'UPDATE',
        message: 'injected snapshot failure',
      });

      await expect(service.archiveHistoricalMedia(createArchiveCommand(
        discovery.candidates,
        'historical-media-snapshot-rollback',
      ))).rejects.toThrow('injected snapshot failure');

      expect(await readArchiveState(query)).toEqual(before);
    });
  });

  postgresIt('rolls back graph, snapshot, revision and ledger when the administrator audit fails', async () => {
    await withIsolatedPostgres('historical-media-audit-rollback', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const before = await readArchiveState(query);
      await installFailureTrigger(query, {
        functionName: 'fail_historical_media_audit',
        tableName: 'wujie_audit_log',
        timing: 'INSERT',
        message: 'injected audit failure',
      });

      await expect(service.archiveHistoricalMedia(createArchiveCommand(
        discovery.candidates.filter(candidate => candidate.isCurrentVersion),
        'historical-media-audit-rollback',
      ))).rejects.toThrow('injected audit failure');

      expect(await readArchiveState(query)).toEqual(before);
    });
  });

  postgresIt('fails closed on mismatched project, asset and version identities without owner leakage', async () => {
    await withIsolatedPostgres('historical-media-cross-boundary', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const candidate = discovery.candidates.find(item => item.assetId === 'asset-chat-empty') as HistoricalMediaCandidate;

      const invalidSelections = [
        { ...candidate, projectId: OTHER_PROJECT_ID },
        { ...candidate, assetId: 'asset-canvas-bridge' },
        { ...candidate, assetVersionId: 'version-canvas-bridge' },
      ];
      for (const [index, invalid] of invalidSelections.entries()) {
        const command = createArchiveCommand([candidate], `historical-media-not-found-${index}`);
        command.request.candidates = [{
          projectId: invalid.projectId,
          assetId: invalid.assetId,
          assetVersionId: invalid.assetVersionId,
          candidateDigest: invalid.candidateDigest,
        }];
        await expectNotFoundWithoutOwnerLeak(service.archiveHistoricalMedia(command));
      }

      await expect(query(
        `SELECT
           (SELECT count(*)::int FROM wujie_asset_media_remediations) AS ledger,
           (SELECT count(*)::int FROM wujie_audit_log) AS audit,
           (SELECT count(*)::int FROM wujie_workspace_placements WHERE status = 'trashed') AS trashed`,
      )).resolves.toMatchObject({ rows: [{ ledger: 0, audit: 0, trashed: 0 }] });
    });
  });
});
