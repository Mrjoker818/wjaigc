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
  createAgentEventRequestDigest,
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
        workspace: 'canvas' as const,
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

      const failedTerminal = {
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'failed-terminal',
        workspace: 'canvas' as const,
        type: 'run.failed' as const,
        payload: { error: { code: 'FAILED', message: 'failed', retryable: true } },
      };
      await query(
        `UPDATE cloud_tasks
         SET status = 'failed', terminal_event_id = $2,
             terminal_event_digest = $3, terminal_event_type = $4,
             revision = revision + 1
         WHERE id = $1`,
        [
          runId,
          failedTerminal.eventId,
          createAgentEventRequestDigest(failedTerminal),
          failedTerminal.type,
        ],
      );
      await appendAgentEvent(failedTerminal);
      await expect(appendAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'completed-terminal',
        workspace: 'canvas',
        type: 'run.completed',
        payload: { result: { imageUrl: '/late.png' } },
      })).rejects.toBeInstanceOf(AgentEventConflictError);
      await expect(appendAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId,
        eventId: 'late-asset',
        workspace: 'canvas',
        type: 'asset.created',
        payload: { assetVersionId: 'late-version' },
      })).rejects.toBeInstanceOf(AgentEventConflictError);

      const events = await listAgentEventsForActor({ actorUserId: ownerId, projectId, runId });
      const projection = reduceAgentEvents(events);
      expect(projection.status).toBe('failed');
      expect(projection.lastSequence).toBe(2);
      expect(projection.assetVersionIds).toEqual([]);
      expect(projection.ignoredEventIds).toHaveLength(0);

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
      vi.resetModules();
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
          sourceType: 'image',
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
        authorizeContext: async ({ request }) => ({ snapshot: request.context, mediaByVersionId: {}, selectedEntityVersionIds: {} }),
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

  postgresIt('never resurrects a refunded initialization failure on idempotent retry', async () => {
    await withIsolatedPostgres('stage-4-agent-init-retry', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const runId = randomUUID();
      const now = Date.now();
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Agent initialization retry', 'active'],
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
      let appendAttempts = 0;
      const service = createAgentRuntimeService({
        randomUUID: () => runId,
        now: () => now,
        resolveTaskModel: async () => ({
          providerId: 'provider-exact', modelId: 'model-exact', kind: 'image',
          sourceType: 'image', protocol: 'images', executionMode: 'async',
          allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
          supportsReferenceImages: false, supportsMask: false, outputKinds: ['png'],
        }),
        authorizeContext: async ({ request }) => ({ snapshot: request.context, mediaByVersionId: {}, selectedEntityVersionIds: {} }),
        calculateCreditCost: async () => 7,
        createBillableTask,
        appendEvent: async input => {
          appendAttempts += 1;
          if (appendAttempts === 1) throw new Error('forced initialization event failure');
          return appendAgentEvent(input);
        },
        listEvents: listAgentEventsForActor,
        listRunEventStreams: listAgentEventStreamsForActor,
        getTaskForUser: getCloudTaskForUser,
        transitionTask,
        settleFailedTask,
        abortTaskExecution: () => false,
      });
      const actor = {
        id: ownerId, name: 'Retry owner', role: 'user' as const, status: 'active' as const,
        productType: 'canvas', createdAt: now, updatedAt: now,
      };
      const request = {
        projectId, workspace: 'canvas' as const, workspaceId: 'canvas-1',
        mode: 'agent' as const, providerId: 'provider-exact', modelId: 'model-exact',
        prompt: 'Create an image', sourceVersionIds: [], allowedToolIds: ['generate_image'],
        idempotencyKey: 'failed-init-retry',
        context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' as const },
      };

      await expect(service.createRun({ actor, request })).rejects.toThrow(
        'forced initialization event failure',
      );
      await expect(service.createRun({ actor, request })).rejects.toMatchObject({
        code: 'AGENT_RUN_TERMINAL',
        status: 409,
      });

      const facts = await query<{
        status: string; credit_status: string; charges: string; refunds: string; events: string;
      }>(
        `SELECT task.status, task.credit_status,
                (SELECT count(*)::text FROM wujie_credit_transactions
                 WHERE task_id = task.id AND type = 'consume') AS charges,
                (SELECT count(*)::text FROM wujie_credit_transactions
                 WHERE task_id = task.id AND type = 'refund') AS refunds,
                (SELECT count(*)::text FROM wujie_agent_events
                 WHERE task_id = task.id) AS events
         FROM cloud_tasks task WHERE task.id = $1`,
        [runId],
      );
      expect(facts.rows[0]).toEqual({
        status: 'failed', credit_status: 'refunded', charges: '1', refunds: '1', events: '0',
      });
      expect(appendAttempts).toBe(1);
    });
  });

  postgresIt('rejects and never persists a terminal event that loses the authoritative task race', async () => {
    await withIsolatedPostgres('stage-4-agent-terminal-race', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const runId = randomUUID();
      const now = Date.now();
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Agent terminal race', 'active'],
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
          providerId: 'provider-exact', modelId: 'model-exact', kind: 'image',
          sourceType: 'image', protocol: 'images', executionMode: 'async',
          allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
          supportsReferenceImages: false, supportsMask: false, outputKinds: ['png'],
        }),
        authorizeContext: async ({ request }) => ({ snapshot: request.context, mediaByVersionId: {}, selectedEntityVersionIds: {} }),
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
      const actor = {
        id: ownerId, name: 'Race owner', role: 'user' as const, status: 'active' as const,
        productType: 'canvas', createdAt: now, updatedAt: now,
      };
      const request = {
        projectId, workspace: 'canvas' as const, workspaceId: 'canvas-1',
        mode: 'agent' as const, providerId: 'provider-exact', modelId: 'model-exact',
        prompt: 'Create an image', sourceVersionIds: [], allowedToolIds: ['generate_image'],
        idempotencyKey: 'terminal-race',
        context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' as const },
      };
      await service.createRun({ actor, request });
      await settleFailedTask({
        taskId: runId,
        status: 'cancelled',
        error: { code: 'CANCELLED', message: 'Cancelled first', retryable: false },
      });

      const losingCompletion = {
        actorUserId: ownerId,
        runId,
        eventId: 'losing-completion',
        type: 'run.completed' as const,
        payload: { result: { imageUrl: '/must-not-persist.png' } },
      };
      await expect(service.appendEvent(losingCompletion)).rejects.toMatchObject({
        code: 'AGENT_RUN_TERMINAL_CONFLICT',
        status: 409,
      });
      await expect(service.appendEvent(losingCompletion)).rejects.toMatchObject({
        code: 'AGENT_RUN_TERMINAL_CONFLICT',
        status: 409,
      });

      const facts = await query<{ status: string; completed_events: string; result: unknown }>(
        `SELECT task.status, task.result,
                (SELECT count(*)::text FROM wujie_agent_events
                 WHERE task_id = task.id AND event_type = 'run.completed') AS completed_events
         FROM cloud_tasks task WHERE task.id = $1`,
        [runId],
      );
      expect(facts.rows[0]).toMatchObject({ status: 'cancelled', completed_events: '0' });
      expect(JSON.stringify(facts.rows[0]?.result)).not.toContain('/must-not-persist.png');
    });
  });

  postgresIt('binds concurrent same-status completions to one task result and one terminal event', async () => {
    await withIsolatedPostgres('stage-4-agent-terminal-identity-race', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const runId = randomUUID();
      const now = Date.now();
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Agent terminal identity race', 'active'],
      );
      await query(
        `INSERT INTO wujie_credits(
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [randomUUID(), ownerId, now],
      );

      const { createAgentRuntimeService } = await import('@/lib/agent-runtime/service');
      const { getCloudTaskForUser } = await import('@/lib/cloud-task-storage');
      const { createBillableTask, settleFailedTask } = await import('@/lib/task-core/billing-service');
      const { transitionTask } = await import('@/lib/task-core/task-service');
      const service = createAgentRuntimeService({
        randomUUID: () => runId,
        now: () => now,
        resolveTaskModel: async () => ({
          providerId: 'provider-exact', modelId: 'model-exact', kind: 'image',
          sourceType: 'image', protocol: 'images', executionMode: 'async',
          allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
          supportsReferenceImages: false, supportsMask: false, outputKinds: ['png'],
        }),
        authorizeContext: async ({ request }) => ({ snapshot: request.context, mediaByVersionId: {}, selectedEntityVersionIds: {} }),
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
      const actor = {
        id: ownerId, name: 'Identity owner', role: 'user' as const, status: 'active' as const,
        productType: 'canvas', createdAt: now, updatedAt: now,
      };
      await service.createRun({
        actor,
        request: {
          projectId, workspace: 'canvas', workspaceId: 'canvas-1', mode: 'agent',
          providerId: 'provider-exact', modelId: 'model-exact', prompt: 'Create an image',
          sourceVersionIds: [], allowedToolIds: ['generate_image'], idempotencyKey: 'terminal-identity-race',
          context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
        },
      });

      const outcomes = await Promise.allSettled([
        service.appendEvent({
          actorUserId: ownerId, runId, eventId: 'completion-a', type: 'run.completed',
          payload: { result: { imageUrl: '/result-a.png' } },
        }),
        service.appendEvent({
          actorUserId: ownerId, runId, eventId: 'completion-b', type: 'run.completed',
          payload: { result: { imageUrl: '/result-b.png' } },
        }),
      ]);
      const acceptedOutcomes = outcomes.filter(
        outcome => outcome.status === 'fulfilled' && outcome.value.accepted,
      );
      expect(acceptedOutcomes).toHaveLength(1);

      const events = await listAgentEventsForActor({ actorUserId: ownerId, projectId, runId });
      const projection = reduceAgentEvents(events);
      const facts = await query<{
        result: Record<string, unknown>;
        terminal_event_id: string;
        terminal_event_digest: string;
        terminal_event_type: string;
        terminal_events: string;
      }>(
        `SELECT task.result, task.terminal_event_id, task.terminal_event_digest,
                task.terminal_event_type,
                (SELECT count(*)::text FROM wujie_agent_events
                 WHERE task_id = task.id AND event_type = 'run.completed') AS terminal_events
         FROM cloud_tasks task WHERE task.id = $1`,
        [runId],
      );
      expect(facts.rows[0]?.terminal_events).toBe('1');
      expect(facts.rows[0]?.terminal_event_type).toBe('run.completed');
      expect(facts.rows[0]?.terminal_event_id).toBe(
        events.find(item => item.type === 'run.completed')?.eventId,
      );
      expect(facts.rows[0]?.terminal_event_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(facts.rows[0]?.result).toEqual(projection.result);
    });
  });

  postgresIt('rejects an invalid terminal payload without changing task, events, or billing', async () => {
    await withIsolatedPostgres('stage-4-agent-invalid-terminal', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const runId = randomUUID();
      const now = Date.now();
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Agent invalid terminal', 'active'],
      );
      await query(
        `INSERT INTO wujie_credits(
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [randomUUID(), ownerId, now],
      );

      const { createAgentRuntimeService } = await import('@/lib/agent-runtime/service');
      const { getCloudTaskForUser } = await import('@/lib/cloud-task-storage');
      const { createBillableTask, settleFailedTask } = await import('@/lib/task-core/billing-service');
      const { transitionTask } = await import('@/lib/task-core/task-service');
      const service = createAgentRuntimeService({
        randomUUID: () => runId,
        now: () => now,
        resolveTaskModel: async () => ({
          providerId: 'provider-exact', modelId: 'model-exact', kind: 'image',
          sourceType: 'image', protocol: 'images', executionMode: 'async',
          allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
          supportsReferenceImages: false, supportsMask: false, outputKinds: ['png'],
        }),
        authorizeContext: async ({ request }) => ({ snapshot: request.context, mediaByVersionId: {}, selectedEntityVersionIds: {} }),
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
      const actor = {
        id: ownerId, name: 'Invalid terminal owner', role: 'user' as const, status: 'active' as const,
        productType: 'canvas', createdAt: now, updatedAt: now,
      };
      await service.createRun({
        actor,
        request: {
          projectId, workspace: 'canvas', workspaceId: 'canvas-1', mode: 'agent',
          providerId: 'provider-exact', modelId: 'model-exact', prompt: 'Create an image',
          sourceVersionIds: [], allowedToolIds: ['generate_image'], idempotencyKey: 'invalid-terminal',
          context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
        },
      });

      const snapshot = async () => (await query<{
        status: string;
        result: Record<string, unknown>;
        credit_status: string;
        terminal_event_id: string;
        terminal_event_digest: string;
        terminal_event_type: string;
        balance: string;
        charges: string;
        refunds: string;
        events: string;
      }>(
        `SELECT task.status, task.result, task.credit_status,
                task.terminal_event_id, task.terminal_event_digest, task.terminal_event_type,
                credits.balance::text AS balance,
                (SELECT count(*)::text FROM wujie_credit_transactions
                 WHERE task_id = task.id AND type = 'consume') AS charges,
                (SELECT count(*)::text FROM wujie_credit_transactions
                 WHERE task_id = task.id AND type = 'refund') AS refunds,
                (SELECT count(*)::text FROM wujie_agent_events
                 WHERE task_id = task.id) AS events
         FROM cloud_tasks task
         JOIN wujie_credits credits ON credits.user_id = task.user_id
         WHERE task.id = $1`,
        [runId],
      )).rows[0];
      const before = await snapshot();

      await expect(service.appendEvent({
        actorUserId: ownerId,
        runId,
        eventId: 'invalid-completion',
        type: 'run.completed',
        payload: { result: { apiKey: 'never-persist-this' } },
      })).rejects.toMatchObject({ code: 'AGENT_EVENT_PAYLOAD_REJECTED', status: 400 });

      expect(await snapshot()).toEqual(before);
    });
  });

  postgresIt('reconciles run.created committed before an ambiguous response without refunding or charging twice', async () => {
    await withIsolatedPostgres('stage-4-agent-created-ambiguous-response', async ({ databaseUrl, query }) => {
      expect(runMigrations(databaseUrl).status).toBe(0);
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const runId = randomUUID();
      const now = Date.now();
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Agent ambiguous initialization', 'active'],
      );
      await query(
        `INSERT INTO wujie_credits(
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [randomUUID(), ownerId, now],
      );

      const { createAgentRuntimeService } = await import('@/lib/agent-runtime/service');
      const { getCloudTaskForUser } = await import('@/lib/cloud-task-storage');
      const { createBillableTask, settleFailedTask } = await import('@/lib/task-core/billing-service');
      const { transitionTask } = await import('@/lib/task-core/task-service');
      let loseResponse = true;
      const service = createAgentRuntimeService({
        randomUUID: () => runId,
        now: () => now,
        resolveTaskModel: async () => ({
          providerId: 'provider-exact', modelId: 'model-exact', kind: 'image',
          sourceType: 'image', protocol: 'images', executionMode: 'async',
          allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
          supportsReferenceImages: false, supportsMask: false, outputKinds: ['png'],
        }),
        authorizeContext: async ({ request }) => ({ snapshot: request.context, mediaByVersionId: {}, selectedEntityVersionIds: {} }),
        calculateCreditCost: async () => 7,
        createBillableTask,
        appendEvent: async input => {
          const persisted = await appendAgentEvent(input);
          if (input.type === 'run.created' && loseResponse) {
            loseResponse = false;
            throw new Error('run.created response lost after commit');
          }
          return persisted;
        },
        listEvents: listAgentEventsForActor,
        listRunEventStreams: listAgentEventStreamsForActor,
        getTaskForUser: getCloudTaskForUser,
        transitionTask,
        settleFailedTask,
        abortTaskExecution: () => false,
      });
      const actor = {
        id: ownerId, name: 'Ambiguous owner', role: 'user' as const, status: 'active' as const,
        productType: 'canvas', createdAt: now, updatedAt: now,
      };
      const request = {
        projectId, workspace: 'canvas' as const, workspaceId: 'canvas-1', mode: 'agent' as const,
        providerId: 'provider-exact', modelId: 'model-exact', prompt: 'Create an image',
        sourceVersionIds: [], allowedToolIds: ['generate_image'], idempotencyKey: 'ambiguous-created',
        context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' as const },
      };

      await expect(service.createRun({ actor, request })).resolves.toMatchObject({
        runId, reused: false, charged: true, projection: { status: 'created' },
      });
      await expect(service.createRun({ actor, request })).resolves.toMatchObject({
        runId, reused: true, charged: false, projection: { status: 'created' },
      });

      const facts = await query<{
        status: string; credit_status: string; revision: number;
        charges: string; refunds: string; created_events: string;
      }>(
        `SELECT task.status, task.credit_status, task.revision,
                (SELECT count(*)::text FROM wujie_credit_transactions
                 WHERE task_id = task.id AND type = 'consume') AS charges,
                (SELECT count(*)::text FROM wujie_credit_transactions
                 WHERE task_id = task.id AND type = 'refund') AS refunds,
                (SELECT count(*)::text FROM wujie_agent_events
                 WHERE task_id = task.id AND event_type = 'run.created') AS created_events
         FROM cloud_tasks task WHERE task.id = $1`,
        [runId],
      );
      expect(facts.rows[0]).toMatchObject({
        status: 'processing', credit_status: 'pending', charges: '1', refunds: '0', created_events: '1',
      });
      expect(facts.rows[0]?.revision).toBeGreaterThanOrEqual(1);
    });
  });
});
