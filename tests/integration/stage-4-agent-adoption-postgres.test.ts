import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createSameTaskAgentAdapter,
  type SameTaskAgentAdapterDependencies,
} from '@/lib/agent-runtime/same-task-adapter';
import {
  appendAdoptedAgentEvent,
  appendShadowAgentEvent,
  claimAdoptedAgentExecution,
  completeAdoptedAgentExecution,
  listAgentEventStreamsForActor,
  listAgentEventsForActor,
  observeAdoptedAgentTaskTerminal,
  releaseAdoptedAgentExecution,
  prepareAgentDownstreamOperation,
  completeAgentDownstreamOperation,
  getAgentDownstreamOperation,
  markAgentDownstreamOperationAccepted,
  markAgentDownstreamOperationSubmitted,
  markAgentDownstreamSubmissionUnknown,
  releaseAgentDownstreamOperation,
} from '@/lib/agent-runtime/event-storage';
import {
  createAgentDownstreamOperationIdentity,
  executeDurableAgentDownstreamOperation,
} from '@/lib/agent-runtime/downstream-operations';
import { cancelAgentRun } from '@/lib/agent-runtime/service';
import { getCloudTaskForUser } from '@/lib/cloud-task-storage';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { transitionTask } from '@/lib/task-core/task-service';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { User } from '@/lib/user-types';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; same-task Agent adoption tests skipped.',
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
  expect(result.status, String(result.stderr || result.stdout)).toBe(0);
}

function actor(userId: string): User {
  return {
    id: userId,
    name: 'Adopted task owner',
    role: 'user',
    status: 'active',
    productType: 'canvas',
    createdAt: 1,
    updatedAt: 1,
  };
}

function request(projectId: string, taskId: string): AgentRunRequest {
  return {
    projectId,
    workspace: 'canvas',
    workspaceId: 'canvas-1',
    mode: 'agent',
    providerId: 'provider-image',
    modelId: 'model-image',
    prompt: 'Create one image',
    sourceVersionIds: [],
    allowedToolIds: ['generate_image'],
    idempotencyKey: taskId,
    context: {
      selectedEntityIds: [],
      visibleVersionIds: [],
      locale: 'zh-CN',
    },
  };
}

function adapterDependencies(): SameTaskAgentAdapterDependencies {
  return {
    getTaskForUser: getCloudTaskForUser,
    resolveTaskModel: vi.fn().mockResolvedValue({
      providerId: 'provider-image',
      modelId: 'model-image',
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
    authorizeContext: vi.fn().mockImplementation(async ({ request: runRequest }) => (
      runRequest.context
    )),
    appendAdoptedEvent: appendAdoptedAgentEvent,
    observeTerminal: observeAdoptedAgentTaskTerminal,
    listEvents: listAgentEventsForActor,
    claimExecution: claimAdoptedAgentExecution,
    completeExecution: completeAdoptedAgentExecution,
    releaseExecution: releaseAdoptedAgentExecution,
  };
}

async function createChargedTask(input: {
  ownerId: string;
  projectId: string;
  taskId: string;
}): Promise<void> {
  const now = Date.now();
  await createBillableTask({
    userId: input.ownerId,
    idempotencyKey: `adopt:${input.taskId}`,
    requestDigest: randomUUID().replaceAll('-', ''),
    creditCost: 7,
    task: {
      id: input.taskId,
      projectId: input.projectId,
      type: 'generate-async',
      status: 'processing',
      providerId: 'provider-image',
      model: 'model-image',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    },
  });
}

describe('same-task Agent adoption on real PostgreSQL', () => {
  postgresIt('recovers the same provider task after crashing immediately after acceptance', async () => {
    await withIsolatedPostgres('stage-4-agent-provider-acceptance-crash', async ({ databaseUrl, query }) => {
      runMigrations(databaseUrl);
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const taskId = randomUUID();
      const now = Date.now();
      await query('INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Provider acceptance crash', 'active']);
      await query(`INSERT INTO wujie_credits(
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`, [randomUUID(), ownerId, now]);
      await query(`CREATE TABLE task2_controlled_provider_tasks(
        id BIGSERIAL PRIMARY KEY, idempotency_key TEXT NOT NULL, provider_task_id TEXT NOT NULL
      )`);
      await createChargedTask({ ownerId, projectId, taskId });
      const operationInput = {
        actorUserId: ownerId, projectId, runId: taskId, toolId: 'generate_image',
        requestDigest: 'b'.repeat(64),
      };
      const provider = vi.fn(async (idempotencyKey: string) => {
        await query(`INSERT INTO task2_controlled_provider_tasks(idempotency_key, provider_task_id)
          VALUES ($1, $2)`,
        [idempotencyKey, 'provider-task-1']);
        return { taskId: 'provider-task-1' };
      });
      const dependencies = {
        prepare: prepareAgentDownstreamOperation,
        complete: completeAgentDownstreamOperation,
        markSubmitted: markAgentDownstreamOperationSubmitted,
        markAccepted: markAgentDownstreamOperationAccepted,
        markSubmissionUnknown: markAgentDownstreamSubmissionUnknown,
        read: getAgentDownstreamOperation,
        release: releaseAgentDownstreamOperation,
      };
      await expect(executeDurableAgentDownstreamOperation(
        operationInput,
        async context => {
          await context.beginSubmission();
          const accepted = await provider(context.idempotencyKey);
          await context.recordAccepted(accepted.taskId);
          throw new Error('simulated process crash after provider acceptance');
        },
        dependencies,
      )).rejects.toThrow('simulated process crash after provider acceptance');
      const recoverySubmit = vi.fn(async () => ({ taskId: 'must-not-submit' }));
      const retries = await Promise.all(Array.from({ length: 20 }, () => (
        executeDurableAgentDownstreamOperation(
          operationInput,
          recoverySubmit,
          dependencies,
          { reconcile: async providerTaskId => {
            await transitionTask({
              taskId,
              from: ['processing'],
              to: 'completed',
              creditStatus: 'charged',
              result: { downstreamTaskId: providerTaskId },
            });
            return { taskId: providerTaskId };
          } },
        )
      )));
      expect(retries).toEqual(Array.from({ length: 20 }, () => ({ taskId: 'provider-task-1' })));

      const facts = await query<{
        operations: string; provider_tasks: string; charges: string;
        status: string; task_status: string;
      }>(`SELECT
          (SELECT count(*)::text FROM wujie_agent_downstream_operations WHERE task_id = $1) operations,
          (SELECT count(*)::text FROM task2_controlled_provider_tasks) provider_tasks,
          (SELECT count(*)::text FROM wujie_credit_transactions WHERE task_id = $1 AND type = 'consume') charges,
          (SELECT status FROM wujie_agent_downstream_operations WHERE task_id = $1) status,
          (SELECT status FROM cloud_tasks WHERE id = $1) task_status`, [taskId]);
      expect(facts.rows[0]).toEqual({
        operations: '1', provider_tasks: '1', charges: '1',
        status: 'completed', task_status: 'completed',
      });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(recoverySubmit).not.toHaveBeenCalled();
    });
  });

  postgresIt('recovers an expired crash claim and invokes one stable downstream operation', async () => {
    await withIsolatedPostgres('stage-4-agent-adoption-crash-recovery', async ({ databaseUrl, query }) => {
      runMigrations(databaseUrl);
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const taskId = randomUUID();
      const now = Date.now();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Adoption crash recovery', 'active'],
      );
      await query(
        `INSERT INTO wujie_credits(
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [randomUUID(), ownerId, now],
      );
      await query(
        `CREATE TABLE task2_provider_invocations(
          stable_key TEXT PRIMARY KEY,
          invocation_count INTEGER NOT NULL DEFAULT 1
        )`,
      );
      await createChargedTask({ ownerId, projectId, taskId });

      const adapter = createSameTaskAgentAdapter(adapterDependencies());
      const adoption = await adapter.adopt({
        actor: actor(ownerId),
        taskId,
        request: request(projectId, taskId),
        toolId: 'generate_image',
      });
      const crashedClaim = await claimAdoptedAgentExecution({
        actorUserId: ownerId,
        projectId,
        runId: taskId,
        toolId: 'generate_image',
        leaseOwner: 'crashed-worker',
        now: 1,
        leaseDurationMs: 1,
      });
      expect(crashedClaim).toMatchObject({ claimed: true, leaseOwner: 'crashed-worker' });

      const providerInvocation = vi.fn(async () => {
        const inserted = await query(
          `INSERT INTO task2_provider_invocations(stable_key)
           VALUES ($1) ON CONFLICT (stable_key) DO NOTHING`,
          [taskId],
        );
        expect(inserted.rowCount).toBe(1);
        return 'provider-task-created';
      });
      const retries = await Promise.all(Array.from({ length: 20 }, () => (
        adapter.executeAdoption({ adoption, execute: providerInvocation })
      )));

      expect(providerInvocation).toHaveBeenCalledTimes(1);
      expect(retries.filter(result => result.executed)).toHaveLength(1);
      const facts = await query<{
        tasks: string;
        charges: string;
        provider_invocations: string;
        attempts: number;
        completed_at: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM cloud_tasks WHERE id = $1) AS tasks,
           (SELECT count(*)::text FROM wujie_credit_transactions
            WHERE task_id = $1 AND type = 'consume') AS charges,
           (SELECT count(*)::text FROM task2_provider_invocations
            WHERE stable_key = $1) AS provider_invocations,
           lease.attempt_count AS attempts,
           lease.completed_at::text AS completed_at
         FROM wujie_agent_execution_leases lease WHERE lease.task_id = $1`,
        [taskId],
      );
      expect(facts.rows[0]).toMatchObject({
        tasks: '1',
        charges: '1',
        provider_invocations: '1',
        attempts: 2,
      });
      expect(Number(facts.rows[0]?.completed_at)).toBeGreaterThan(0);
    });
  });

  postgresIt('fails closed after an unreconciled submit without resubmitting or recharging', async () => {
    await withIsolatedPostgres('stage-4-agent-submission-unknown', async ({ databaseUrl, query }) => {
      runMigrations(databaseUrl);
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const taskId = randomUUID();
      const now = Date.now();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Unknown provider submission', 'active'],
      );
      await query(`INSERT INTO wujie_credits(
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`, [randomUUID(), ownerId, now]);
      await query(`CREATE TABLE task2_unknown_provider_calls(
        id BIGSERIAL PRIMARY KEY, idempotency_key TEXT NOT NULL
      )`);
      await createChargedTask({ ownerId, projectId, taskId });
      const operationInput = {
        actorUserId: ownerId, projectId, runId: taskId, toolId: 'image_edit',
        requestDigest: 'd'.repeat(64),
      };
      const dependencies = {
        prepare: prepareAgentDownstreamOperation,
        complete: completeAgentDownstreamOperation,
        markSubmitted: markAgentDownstreamOperationSubmitted,
        markAccepted: markAgentDownstreamOperationAccepted,
        markSubmissionUnknown: markAgentDownstreamSubmissionUnknown,
        read: getAgentDownstreamOperation,
        release: releaseAgentDownstreamOperation,
      };
      const provider = vi.fn(async (idempotencyKey: string) => {
        await query('INSERT INTO task2_unknown_provider_calls(idempotency_key) VALUES ($1)', [idempotencyKey]);
        throw new Error('connection lost after provider submit');
      });

      await expect(executeDurableAgentDownstreamOperation(
        operationInput,
        async context => {
          await context.beginSubmission();
          return provider(context.idempotencyKey);
        },
        dependencies,
      )).rejects.toThrow('connection lost after provider submit');
      await transitionTask({
        taskId,
        from: ['processing'],
        to: 'failed',
        creditStatus: 'charged',
        error: {
          code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN',
          message: 'Provider submission requires manual reconciliation',
        },
      });
      await expect(executeDurableAgentDownstreamOperation(
        operationInput,
        async context => provider(context.idempotencyKey),
        dependencies,
      )).rejects.toMatchObject({ code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN' });

      const facts = await query<{
        operation_status: string; provider_calls: string; charges: string; task_status: string;
      }>(`SELECT
          (SELECT status FROM wujie_agent_downstream_operations WHERE task_id = $1) operation_status,
          (SELECT count(*)::text FROM task2_unknown_provider_calls) provider_calls,
          (SELECT count(*)::text FROM wujie_credit_transactions WHERE task_id = $1 AND type = 'consume') charges,
          (SELECT status FROM cloud_tasks WHERE id = $1) task_status`, [taskId]);
      expect(facts.rows[0]).toEqual({
        operation_status: 'submission_unknown', provider_calls: '1', charges: '1', task_status: 'failed',
      });
      expect(provider).toHaveBeenCalledTimes(1);
    });
  });

  postgresIt('persists shadow events without changing the parent task revision or timestamp', async () => {
    await withIsolatedPostgres('stage-4-agent-shadow-parent-stability', async ({ databaseUrl, query }) => {
      runMigrations(databaseUrl);
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const taskId = randomUUID();
      const now = Date.now();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Shadow parent stability', 'active'],
      );
      await query(
        `INSERT INTO wujie_credits(
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [randomUUID(), ownerId, now],
      );
      await createChargedTask({ ownerId, projectId, taskId });
      const before = (await query<{ revision: number; updated_at: string }>(
        'SELECT revision, updated_at::text FROM cloud_tasks WHERE id = $1',
        [taskId],
      )).rows[0];

      await appendShadowAgentEvent({
        actorUserId: ownerId,
        projectId,
        runId: taskId,
        eventId: `shadow:${taskId}:created`,
        workspace: 'canvas',
        type: 'run.created',
        payload: { observed: true },
      });

      const after = await query<{
        revision: number;
        updated_at: string;
        shadow_events: string;
      }>(
        `SELECT task.revision, task.updated_at::text,
           (SELECT count(*)::text FROM wujie_agent_events WHERE task_id = task.id) AS shadow_events
         FROM cloud_tasks task WHERE task.id = $1`,
        [taskId],
      );
      expect(after.rows[0]).toMatchObject({
        revision: before?.revision,
        updated_at: before?.updated_at,
        shadow_events: '1',
      });
    });
  });

  postgresIt('claims one executor across twenty retries without another charge or refund', async () => {
    await withIsolatedPostgres('stage-4-agent-adoption-concurrency', async ({ databaseUrl, query }) => {
      runMigrations(databaseUrl);
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const taskId = randomUUID();
      const now = Date.now();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Adoption concurrency', 'active'],
      );
      await query(
        `INSERT INTO wujie_credits(
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [randomUUID(), ownerId, now],
      );
      await createChargedTask({ ownerId, projectId, taskId });

      let releaseExecution!: () => void;
      const executionGate = new Promise<void>(resolvePromise => {
        releaseExecution = resolvePromise;
      });
      const execute = vi.fn(async () => {
        await executionGate;
        return 'provider-request-once';
      });
      const adapter = createSameTaskAgentAdapter(adapterDependencies());
      const attempts = Array.from({ length: 20 }, () => adapter.adoptAndExecute({
        actor: actor(ownerId),
        taskId,
        request: request(projectId, taskId),
        toolId: 'generate_image',
        execute,
      }));

      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
      releaseExecution();
      const results = await Promise.all(attempts);

      expect(execute).toHaveBeenCalledTimes(1);
      expect(results.filter(result => result.executed)).toHaveLength(1);
      const facts = await query<{
        charges: string;
        refunds: string;
        started_events: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM wujie_credit_transactions
            WHERE task_id = task.id AND type = 'consume') AS charges,
           (SELECT count(*)::text FROM wujie_credit_transactions
            WHERE task_id = task.id AND type = 'refund') AS refunds,
           (SELECT count(*)::text FROM wujie_agent_events
            WHERE task_id = task.id AND event_type = 'tool.started') AS started_events
         FROM cloud_tasks task WHERE task.id = $1`,
        [taskId],
      );
      expect(facts.rows).toEqual([{ charges: '1', refunds: '0', started_events: '1' }]);
    });
  });

  postgresIt('keeps cancellation terminal and rejects the executor late completion', async () => {
    await withIsolatedPostgres('stage-4-agent-adoption-cancel', async ({ databaseUrl, query }) => {
      runMigrations(databaseUrl);
      vi.resetModules();
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const taskId = randomUUID();
      const now = Date.now();
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name, status) VALUES ($1, $2, $3, $4)',
        [projectId, ownerId, 'Adoption cancellation', 'active'],
      );
      await query(
        `INSERT INTO wujie_credits(
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [randomUUID(), ownerId, now],
      );
      await createChargedTask({ ownerId, projectId, taskId });

      let releaseExecution!: () => void;
      const executionGate = new Promise<void>(resolvePromise => {
        releaseExecution = resolvePromise;
      });
      let lateTransition: Awaited<ReturnType<typeof transitionTask>> | undefined;
      const execution = createSameTaskAgentAdapter(adapterDependencies()).adoptAndExecute({
        actor: actor(ownerId),
        taskId,
        request: request(projectId, taskId),
        toolId: 'generate_image',
        execute: async () => {
          await executionGate;
          lateTransition = await transitionTask({
            taskId,
            from: ['processing'],
            to: 'completed',
            creditStatus: 'charged',
            result: { imageUrl: '/late-result.png' },
          });
          return 'late-result';
        },
      });
      await vi.waitFor(async () => {
        const events = await listAgentEventsForActor({ actorUserId: ownerId, projectId, runId: taskId });
        expect(events.some(event => event.type === 'tool.started')).toBe(true);
      });

      const cancelled = await cancelAgentRun({ actorUserId: ownerId, runId: taskId });
      expect(cancelled.projection.status).toBe('cancelled');
      releaseExecution();
      const result = await execution;

      expect(result.projection.status).toBe('cancelled');
      expect(lateTransition?.transitioned).toBe(false);
      const facts = await query<{
        status: string;
        result: Record<string, unknown> | null;
        charges: string;
        refunds: string;
        completed_events: string;
      }>(
        `SELECT task.status, task.result,
           (SELECT count(*)::text FROM wujie_credit_transactions
            WHERE task_id = task.id AND type = 'consume') AS charges,
           (SELECT count(*)::text FROM wujie_credit_transactions
            WHERE task_id = task.id AND type = 'refund') AS refunds,
           (SELECT count(*)::text FROM wujie_agent_events
            WHERE task_id = task.id AND event_type = 'run.completed') AS completed_events
         FROM cloud_tasks task WHERE task.id = $1`,
        [taskId],
      );
      expect(facts.rows[0]).toMatchObject({
        status: 'cancelled',
        charges: '1',
        refunds: '1',
        completed_events: '0',
      });
      expect(JSON.stringify(facts.rows[0]?.result)).not.toContain('/late-result.png');
      expect(await listAgentEventStreamsForActor({ actorUserId: ownerId, limit: 10 })).toHaveLength(1);
    });
  });
});
