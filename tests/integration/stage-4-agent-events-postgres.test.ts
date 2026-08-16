import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { reduceAgentEvents } from '@/lib/agent-runtime/event-reducer';
import {
  AgentEventConflictError,
  AgentEventNotFoundError,
  appendAgentEvent,
  listAgentEventStreamsForActor,
  listAgentEventsForActor,
} from '@/lib/agent-runtime/event-storage';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;
const migrationVersion = '20260816_wj_stable_s4_agent_events.sql';
const migrationPath = resolve(process.cwd(), 'migrations', migrationVersion);

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; Stage 4 Agent event PostgreSQL tests skipped.',
  );
}

function runMigrations(isolatedDatabaseUrl: string): {
  status: number | null;
  stderr: string;
  stdout: string;
} {
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
  return {
    status: result.status,
    stderr: String(result.stderr || ''),
    stdout: String(result.stdout || ''),
  };
}

function runMigrationsAsync(isolatedDatabaseUrl: string): Promise<{
  status: number | null;
  stderr: string;
  stdout: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(process.cwd(), 'scripts/run-migrations.mjs')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: isolatedDatabaseUrl,
          PGDATABASE_URL: isolatedDatabaseUrl,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.once('error', reject);
    child.once('close', status => resolvePromise({ status, stderr, stdout }));
  });
}

async function createScopedRun(input: {
  ownerId: string;
  projectId: string;
  runId: string;
}): Promise<void> {
  const { createCloudTask } = await import('@/lib/cloud-task-storage');
  const now = Date.now();
  await createCloudTask({
    id: input.runId,
    userId: input.ownerId,
    projectId: input.projectId,
    type: 'agent-run',
    status: 'processing',
    progress: 0,
    creditStatus: 'not-applicable',
    createdAt: now,
    updatedAt: now,
    revision: 0,
  });
}

describe('Stage 4 Agent event migration', () => {
  postgresIt('is additive, checksum-managed, and idempotent', async () => {
    await withIsolatedPostgres('stage-4-agent-event-migration', async ({ databaseUrl, query }) => {
      await query('CREATE TABLE preexisting_stage4_marker(id text primary key)');
      await query("INSERT INTO preexisting_stage4_marker(id) VALUES ('preserved')");

      const first = runMigrations(databaseUrl);
      const second = runMigrations(databaseUrl);
      expect(first.status, first.stderr || first.stdout).toBe(0);
      expect(second.status, second.stderr || second.stdout).toBe(0);

      const bytes = await readFile(migrationPath);
      const expectedChecksum = createHash('sha256').update(bytes).digest('hex');
      const ledger = await query<{ checksum: string }>(
        'SELECT checksum FROM wujie_schema_migrations WHERE version = $1',
        [migrationVersion],
      );
      const columns = await query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'wujie_agent_events'
         ORDER BY ordinal_position`,
      );
      const marker = await query('SELECT id FROM preexisting_stage4_marker');

      expect(ledger.rows).toEqual([{ checksum: expectedChecksum }]);
      expect(columns.rows.map(row => row.column_name)).toEqual(expect.arrayContaining([
        'event_id',
        'task_id',
        'owner_id',
        'project_id',
        'workspace',
        'sequence',
        'event_type',
        'request_digest',
        'payload',
        'created_at',
      ]));
      expect(marker.rows).toEqual([{ id: 'preserved' }]);
    });
  });

  postgresIt('serializes concurrent migration runners and records one exact checksum', async () => {
    await withIsolatedPostgres('stage-4-agent-event-migration-concurrency', async ({ databaseUrl, query }) => {
      const [first, second] = await Promise.all([
        runMigrationsAsync(databaseUrl),
        runMigrationsAsync(databaseUrl),
      ]);
      expect(first.status, first.stderr || first.stdout).toBe(0);
      expect(second.status, second.stderr || second.stdout).toBe(0);

      const bytes = await readFile(migrationPath);
      const expectedChecksum = createHash('sha256').update(bytes).digest('hex');
      const ledger = await query<{ checksum: string; count: string }>(
        `SELECT min(checksum) AS checksum, count(*)::text AS count
         FROM wujie_schema_migrations
         WHERE version = $1`,
        [migrationVersion],
      );
      expect(ledger.rows).toEqual([{ checksum: expectedChecksum, count: '1' }]);
    });
  });

  postgresIt('rejects a recorded checksum that differs from the migration bytes', async () => {
    await withIsolatedPostgres('stage-4-agent-event-migration-checksum', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      await query(
        'UPDATE wujie_schema_migrations SET checksum = $1 WHERE version = $2',
        ['0'.repeat(64), migrationVersion],
      );

      const result = runMigrations(databaseUrl);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Migration checksum mismatch for ${migrationVersion}`);
    });
  });

  postgresIt('does not record a partial migration when an incompatible table makes it fail', async () => {
    await withIsolatedPostgres('stage-4-agent-event-migration-rollback', async ({ databaseUrl, query }) => {
      await query('CREATE TABLE wujie_agent_events(id integer primary key)');

      const result = runMigrations(databaseUrl);
      expect(result.status).not.toBe(0);

      const ledgerExists = await query<{ relation: string | null }>(
        "SELECT to_regclass('wujie_schema_migrations')::text AS relation",
      );
      const columns = await query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'wujie_agent_events'`,
      );
      expect(ledgerExists.rows[0]?.relation).toBeNull();
      expect(columns.rows).toEqual([{ column_name: 'id' }]);
    });
  });

  postgresIt('is reported by doctor with its exact checksum and storage contract', async () => {
    await withIsolatedPostgres('stage-4-agent-event-doctor', async ({ databaseUrl }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);

      const result = spawnSync(
        process.execPath,
        [resolve(process.cwd(), 'scripts/doctor.mjs')],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            PGDATABASE_URL: databaseUrl,
            POSTGRES_TEST_DATABASE_URL: databaseUrl,
            DOCTOR_SKIP_ENV_FILE: '1',
          },
          timeout: 30_000,
        },
      );

      expect(result.stdout).toContain(
        `[PASS] agent-event-migration:${migrationVersion}: checksum and table contract verified`,
      );
    });
  });
});

describe('Stage 4 Agent event storage on real PostgreSQL', () => {
  postgresIt('assigns twenty concurrent appends one contiguous unique sequence', async () => {
    await withIsolatedPostgres('stage-4-agent-event-concurrency', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const runId = randomUUID();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Agent event concurrency', 'active'],
      );
      await createScopedRun({ ownerId, projectId, runId });

      const appended = await Promise.all(Array.from({ length: 20 }, (_, index) => (
        appendAgentEvent({
          actorUserId: ownerId,
          projectId,
          runId,
          eventId: `concurrent-event-${index}`,
          workspace: 'canvas',
          type: index === 0 ? 'run.created' : 'tool.progress',
          payload: { progress: index },
        })
      )));

      expect(appended.map(event => event.sequence).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, index) => index + 1),
      );
      const rows = await query<{ sequence: number }>(
        'SELECT sequence FROM wujie_agent_events WHERE task_id = $1 ORDER BY sequence',
        [runId],
      );
      expect(rows.rows.map(row => row.sequence)).toEqual(
        Array.from({ length: 20 }, (_, index) => index + 1),
      );
    });
  });

  postgresIt('returns the original event only for the same canonical event request', async () => {
    await withIsolatedPostgres('stage-4-agent-event-idempotency', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const runId = randomUUID();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Agent event idempotency', 'active'],
      );
      await createScopedRun({ ownerId, projectId, runId });

      const first = await appendAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'stable-event-id',
        workspace: 'workflow',
        type: 'tool.progress',
        payload: { nested: { beta: 2, alpha: 1 }, progress: 10 },
      });
      const retried = await appendAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'stable-event-id',
        workspace: 'workflow',
        type: 'tool.progress',
        payload: { progress: 10, nested: { alpha: 1, beta: 2 } },
      });

      expect(retried).toEqual(first);
      await expect(appendAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'stable-event-id',
        workspace: 'workflow',
        type: 'tool.progress',
        payload: { progress: 11, nested: { alpha: 1, beta: 2 } },
      })).rejects.toBeInstanceOf(AgentEventConflictError);

      const count = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM wujie_agent_events WHERE event_id = $1',
        ['stable-event-id'],
      );
      expect(count.rows).toEqual([{ count: '1' }]);
    });
  });

  postgresIt('fails closed for cross-user and cross-project reads and appends', async () => {
    await withIsolatedPostgres('stage-4-agent-event-isolation', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      const projectId = randomUUID();
      const otherProjectId = randomUUID();
      const runId = randomUUID();
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name, status)
         VALUES ($1, $2, 'Owner project', 'active'), ($3, $2, 'Other project', 'active')`,
        [projectId, ownerId, otherProjectId],
      );
      await createScopedRun({ ownerId, projectId, runId });
      await appendAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'owner-event',
        workspace: 'chat',
        type: 'run.created',
        payload: {},
      });

      await expect(listAgentEventsForActor({
        actorUserId: otherOwnerId,
        projectId,
        runId,
      })).resolves.toEqual([]);
      await expect(listAgentEventsForActor({
        actorUserId: ownerId,
        projectId: otherProjectId,
        runId,
      })).resolves.toEqual([]);
      await expect(appendAgentEvent({
        actorUserId: otherOwnerId,
        projectId,
        runId,
        eventId: 'cross-owner-event',
        workspace: 'chat',
        type: 'tool.started',
        payload: {},
      })).rejects.toBeInstanceOf(AgentEventNotFoundError);
      await expect(appendAgentEvent({
        actorUserId: ownerId,
        projectId: otherProjectId,
        runId,
        eventId: 'cross-project-event',
        workspace: 'chat',
        type: 'tool.started',
        payload: {},
      })).rejects.toBeInstanceOf(AgentEventNotFoundError);
    });
  });

  postgresIt('lists only the current owner recent Agent event streams', async () => {
    await withIsolatedPostgres('stage-4-agent-event-run-list', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      const projectId = randomUUID();
      const otherProjectId = randomUUID();
      const runId = randomUUID();
      const otherRunId = randomUUID();
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name, status)
         VALUES ($1, $2, 'Agent list owner', 'active'),
                ($3, $4, 'Agent list other', 'active')`,
        [projectId, ownerId, otherProjectId, otherOwnerId],
      );
      await createScopedRun({ ownerId, projectId, runId });
      await createScopedRun({ ownerId: otherOwnerId, projectId: otherProjectId, runId: otherRunId });
      await appendAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'owner-created',
        workspace: 'canvas',
        type: 'run.created',
        payload: {},
      });
      await appendAgentEvent({
        actorUserId: otherOwnerId,
        projectId: otherProjectId,
        runId: otherRunId,
        eventId: 'other-created',
        workspace: 'chat',
        type: 'run.created',
        payload: {},
      });

      const streams = await listAgentEventStreamsForActor({ actorUserId: ownerId, limit: 10 });

      expect(streams).toHaveLength(1);
      expect(streams[0]?.map(item => item.runId)).toEqual([runId]);
    });
  });

  postgresIt('orders terminal races and never persists rejected sensitive payloads', async () => {
    await withIsolatedPostgres('stage-4-agent-event-terminal-safety', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const runId = randomUUID();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Agent terminal safety', 'active'],
      );
      await createScopedRun({ ownerId, projectId, runId });
      await appendAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'created-event',
        workspace: 'canvas',
        type: 'run.created',
        payload: {},
      });

      await Promise.all([
        appendAgentEvent({
          actorUserId: ownerId,
          projectId,
          runId,
          eventId: 'failed-terminal',
          workspace: 'canvas',
          type: 'run.failed',
          payload: { error: { code: 'FAILED', message: 'failed', retryable: true } },
        }),
        appendAgentEvent({
          actorUserId: ownerId,
          projectId,
          runId,
          eventId: 'completed-terminal',
          workspace: 'canvas',
          type: 'run.completed',
          payload: { result: { imageUrl: '/late.png' } },
        }),
      ]);
      await appendAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'late-asset',
        workspace: 'canvas',
        type: 'asset.created',
        payload: { assetVersionId: 'late-version' },
      });

      const events = await listAgentEventsForActor({ actorUserId: ownerId, projectId, runId });
      const projection = reduceAgentEvents(events);
      expect(['failed', 'completed']).toContain(projection.status);
      expect(projection.lastSequence).toBe(2);
      expect(projection.assetVersionIds).toEqual([]);
      expect(projection.ignoredEventIds).toHaveLength(2);

      await expect(appendAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'secret-event',
        workspace: 'canvas',
        type: 'tool.progress',
        payload: { nested: { apiToken: 'never-persist-this' } },
      })).rejects.toThrow('Agent event payload contains sensitive data');
      const secretRows = await query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM wujie_agent_events
         WHERE payload::text LIKE '%never-persist-this%'`,
      );
      expect(secretRows.rows).toEqual([{ count: '0' }]);
    });
  });

  postgresIt('reuses durable billing settlement for concurrent cancellation and ignores late completion', async () => {
    await withIsolatedPostgres('stage-4-agent-event-billing-cancel', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const runId = randomUUID();
      const now = Date.now();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Agent billing cancellation', 'active'],
      );
      await query(
        `INSERT INTO wujie_credits(
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [randomUUID(), ownerId, now],
      );

      const { createAgentRuntimeService } = await import('@/lib/agent-runtime/service');
      const { getCloudTaskForUser } = await import('@/lib/cloud-task-storage');
      const { createBillableTask, settleFailedTask } = await import(
        '@/lib/task-core/billing-service'
      );
      const { transitionTask } = await import('@/lib/task-core/task-service');
      const service = createAgentRuntimeService({
        randomUUID: () => runId,
        now: () => now,
        resolveTaskModel: async () => ({
          providerId: 'provider-exact',
          modelId: 'model-exact',
          kind: 'image',
          protocol: 'images',
          executionMode: 'async',
          allowedRatios: [],
          allowedSizes: [],
          qualityOptions: [],
          maxOutputs: 1,
          supportsReferenceImages: false,
          supportsMask: false,
          outputKinds: ['png'],
        }),
        authorizeContext: async ({ request }) => request.context,
        calculateCreditCost: async () => 7,
        createBillableTask,
        appendEvent: appendAgentEvent,
        listEvents: listAgentEventsForActor,
        listRunEventStreams: listAgentEventStreamsForActor,
        getTaskForUser: getCloudTaskForUser,
        transitionTask,
        settleFailedTask,
        abortTaskExecution: () => false,
      });
      const runRequest = {
        projectId,
        workspace: 'canvas' as const,
        workspaceId: 'canvas-1',
        mode: 'agent' as const,
        providerId: 'provider-exact',
        modelId: 'model-exact',
        prompt: 'Create an image',
        sourceVersionIds: [],
        allowedToolIds: ['generate_image'],
        idempotencyKey: 'billing-cancel-request',
        context: {
          selectedEntityIds: [],
          visibleVersionIds: [],
          locale: 'zh-CN' as const,
        },
      };

      await expect(service.createRun({
        actor: {
          id: ownerId,
          name: 'Billing owner',
          role: 'user',
          status: 'active',
          productType: 'canvas',
          createdAt: now,
          updatedAt: now,
        },
        request: runRequest,
      })).resolves.toMatchObject({ runId, charged: true, reused: false });

      await expect(service.createRun({
        actor: {
          id: ownerId,
          name: 'Billing owner',
          role: 'user',
          status: 'active',
          productType: 'canvas',
          createdAt: now,
          updatedAt: now,
        },
        request: runRequest,
      })).resolves.toMatchObject({ runId, charged: false, reused: true });

      await expect(service.createRun({
        actor: {
          id: ownerId,
          name: 'Billing owner',
          role: 'user',
          status: 'active',
          productType: 'canvas',
          createdAt: now,
          updatedAt: now,
        },
        request: { ...runRequest, prompt: 'A different request under the same key' },
      })).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
        status: 409,
      });

      const cancellations = await Promise.all(
        Array.from({ length: 20 }, () => service.cancelRun({
          actorUserId: ownerId,
          runId,
        })),
      );
      expect(cancellations.every(result => result.projection.status === 'cancelled')).toBe(true);

      const late = await service.appendEvent({
        actorUserId: ownerId,
        runId,
        eventId: 'late-completion-after-cancel',
        type: 'run.completed',
        payload: { result: { imageUrl: '/late.png', assetVersionId: 'late-version' } },
      });
      expect(late).toMatchObject({
        accepted: false,
        projection: {
          status: 'cancelled',
          assetVersionIds: [],
        },
      });

      const facts = await query<{
        balance: number;
        total_used: number;
        status: string;
        credit_status: string;
        result: Record<string, unknown>;
        charges: string;
        refunds: string;
        asset_versions: string;
      }>(
        `SELECT credits.balance,
                credits.total_used,
                task.status,
                task.credit_status,
                task.result,
                (SELECT count(*)::text FROM wujie_credit_transactions
                 WHERE task_id = task.id AND type = 'consume') AS charges,
                (SELECT count(*)::text FROM wujie_credit_transactions
                 WHERE task_id = task.id AND type = 'refund') AS refunds,
                (SELECT count(*)::text FROM wujie_asset_versions
                 WHERE task_id = task.id) AS asset_versions
         FROM cloud_tasks task
         JOIN wujie_credits credits ON credits.user_id = task.user_id
         WHERE task.id = $1`,
        [runId],
      );
      expect(facts.rows[0]).toMatchObject({
        balance: 100,
        total_used: 0,
        status: 'cancelled',
        credit_status: 'refunded',
        charges: '1',
        refunds: '1',
        asset_versions: '0',
      });
      expect(JSON.stringify(facts.rows[0]?.result)).not.toContain('/late.png');
    });
  });
});
