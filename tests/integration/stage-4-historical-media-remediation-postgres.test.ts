import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
    counts: { versions: number; activePlacements: number };
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
       WHEN 'asset-managed' THEN 'version-managed'
       WHEN 'asset-other-owner' THEN 'version-other-owner'
     END
     WHERE id IN (
       'asset-chat-empty', 'asset-canvas-bridge', 'asset-false-ready',
       'asset-managed', 'asset-other-owner'
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
          { id: 'entity-managed', url: '/api/serve-upload/managed.png' },
          { id: 'entity-unrelated', url: '/api/serve-upload/unrelated.png' },
        ],
        updatedAt: 1000,
      },
    ])],
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

  postgresIt('discovers only bounded current broken media without changing database state', async () => {
    await withIsolatedPostgres('historical-media-discovery', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const before = await readArchiveState(query);
      const service = await loadHistoricalMediaService();

      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });

      expect(discovery.counts).toEqual({ versions: 3, activePlacements: 4 });
      expect(discovery.candidates.flatMap(item => item.placements)).toHaveLength(4);
      expect(discovery.candidates.map(item => item.assetId)).toEqual([
        'asset-canvas-bridge',
        'asset-chat-empty',
        'asset-false-ready',
      ]);
      expect(discovery.candidates.some(item => item.assetId === 'asset-managed')).toBe(false);
      expect(discovery.candidates.every(item => item.ownerId === OWNER_ID)).toBe(true);
      expect(discovery.candidates.every(item => /^[a-f0-9]{64}$/.test(item.candidateDigest))).toBe(true);
      expect(await readArchiveState(query)).toEqual(before);
    });
  });

  postgresIt('serializes identical archives, reuses one result and rejects a changed request', async () => {
    await withIsolatedPostgres('historical-media-concurrent-archive', async ({ databaseUrl: isolatedUrl, query }) => {
      await prepareHistoricalMediaDatabase(isolatedUrl, query);
      const service = await loadHistoricalMediaService();
      const discovery = await service.discoverHistoricalMediaArchiveCandidates({ limit: 20 });
      const command = createArchiveCommand(discovery.candidates);

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
        rows: [{ assets: 5, versions: 6, placements: 6, request_results: 1, audits: 1 }],
      });
    });
  });

  postgresIt('rejects changed placements, recovered sources and non-current versions as stale', async () => {
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
        discovery.candidates,
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
