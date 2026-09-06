import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';
import type { SkillRunExecutionDispatchDependencies } from '@/lib/skill-runtime/service';
import { LOVART_MARKETING_SKILLS } from '@/lib/skill-runtime/marketing-presets';

vi.mock('server-only', () => ({}));

const hasPostgresTestDatabase = Boolean(process.env.POSTGRES_TEST_DATABASE_URL?.trim());
const postgresIt = hasPostgresTestDatabase ? it : it.skip;

if (!hasPostgresTestDatabase) {
  console.warn('[BLOCKED] Unified Skill Runtime Task 6 PostgreSQL concurrency was not verified: POSTGRES_TEST_DATABASE_URL is missing.');
}

describe('Skill runtime PostgreSQL concurrency', () => {
  function migrate(databaseUrl: string): void {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/run-migrations.mjs')],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PGDATABASE_URL: databaseUrl,
        },
      },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
  }

  function descriptor(providerId: string, modelId: string, kind: 'chat' | 'image'): TaskModelDescriptor {
    return {
      providerId, modelId, kind, sourceType: kind,
      protocol: kind === 'chat' ? 'chat-completions' : 'images',
      executionMode: kind === 'chat' ? 'sync' : 'async',
      allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
      supportsReferenceImages: kind === 'image', supportsMask: false,
      ...(kind === 'image' ? { maxReferenceImages: 6 } : {}),
      outputKinds: kind === 'chat' ? ['text'] : ['png'], capabilitySources: {},
    };
  }

  function runtimeInput(userId: string, idempotencyKey: string): {
    actor: User;
    request: SkillRunRequest;
  } {
    return {
      actor: {
        id: userId, name: 'Postgres Skill user', role: 'user', status: 'active',
        productType: 'canvas,chat', createdAt: 1, updatedAt: 1,
      },
      request: {
        skillId: 'preset-ecommerce-listing', skillVersion: 1, surface: 'canvas',
        projectId: 'project-1', workspaceId: 'canvas-1',
        inputValues: { product: '耳机', features: '降噪' }, sourceVersionIds: [],
        modelBindings: {
          orchestrator: { providerId: 'pear-chat', modelId: 'chat-model' },
          image: { providerId: 'pear-image', modelId: 'image-model' },
        },
        idempotencyKey,
      },
    };
  }

  async function createThroughSkillService(input: ReturnType<typeof runtimeInput>) {
    const [runRequest, skillService, agentService, eventStorage, taskStorage, billing, taskService] = await Promise.all([
      import('@/lib/skill-runtime/run-request'),
      import('@/lib/skill-runtime/service'),
      import('@/lib/agent-runtime/service'),
      import('@/lib/agent-runtime/event-storage'),
      import('@/lib/cloud-task-storage'),
      import('@/lib/task-core/billing-service'),
      import('@/lib/task-core/task-service'),
    ]);
    const authorizeContext = async ({ request }: { request: AgentRunRequest }) => ({
      snapshot: request.context, mediaByVersionId: {}, selectedEntityVersionIds: {},
    });
    const resolveTestModel = async (providerId: string, modelId: string) => descriptor(
      providerId, modelId, providerId === 'pear-chat' ? 'chat' : 'image',
    );
    const runtime = agentService.createAgentRuntimeService({
      randomUUID,
      now: Date.now,
      resolveTaskModel: resolveTestModel,
      authorizeContext,
      calculateCreditCost: async operation => operation === 'chat' ? 1 : 3,
      createBillableTask: billing.createBillableTask,
      appendEvent: eventStorage.appendAgentEvent,
      transitionControl: eventStorage.transitionAgentRunControl,
      listEvents: eventStorage.listAgentEventsForActor,
      observeAdoptedTerminal: eventStorage.observeAdoptedAgentTaskTerminal,
      listRunEventStreams: eventStorage.listAgentEventStreamsForActor,
      getTaskForUser: taskStorage.getCloudTaskForUser,
      transitionTask: taskService.transitionTask,
      settleFailedTask: billing.settleFailedTask,
      abortTaskExecution: () => false,
    });
    const createAuthorizedSkillRun: typeof runRequest.createSkillRun = (value) => (
      runRequest.createSkillRun(value, {
        resolveTaskModel: resolveTestModel,
        authorizeContext,
        calculateCreditCost: async operation => operation === 'chat' ? 1 : 3,
        createAgentRun: runtime.createRun,
      })
    );
    const service = skillService.createSkillRuntimeService({
      createAuthorizedSkillRun,
      getTaskForUser: taskStorage.getCloudTaskForUser,
      listTasks: taskStorage.listCloudTasks,
      listEvents: agentService.listAgentRunEvents,
      getProjection: agentService.getAgentRunProjection,
      pauseRun: agentService.pauseAgentRun,
      resumeRun: agentService.resumeAgentRun,
      cancelRun: agentService.cancelAgentRun,
    });
    return service.create(input);
  }

  postgresIt('same actor and idempotency key creates one Skill run and one charge', async () => {
    await withIsolatedPostgres('skill_runtime_create_concurrency', async ({ databaseUrl, query }) => {
      const { createBillableTask } = await import('@/lib/task-core/billing-service');
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const { ensureCloudTaskTables } = await import('@/lib/cloud-task-storage');
      await Promise.all([ensureCoreTables(), ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const now = Date.now();
      const userId = `skill-user-${randomUUID()}`;
      const idempotencyKey = `skill-key-${randomUUID()}`;
      const requestDigest = 'a'.repeat(64);
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const attempts = await Promise.all(Array.from({ length: 20 }, (_, index) => createBillableTask({
        userId, idempotencyKey, requestDigest, creditCost: 7,
        task: {
          id: `skill-run-${index}-${randomUUID()}`, projectId: 'project-1', type: 'agent-run',
          status: 'processing', progress: 0,
          result: { skillId: 'preset-ecommerce-listing', skillVersion: 1 },
          createdAt: now + index, updatedAt: now + index,
        },
      })));
      const runIds = new Set(attempts.map(attempt => attempt.task.id));
      expect(runIds.size).toBe(1);
      expect(attempts.filter(attempt => !attempt.reused)).toHaveLength(1);
      expect(attempts.filter(attempt => attempt.charged)).toHaveLength(1);
      const runId = [...runIds][0];
      const ledger = await query<{ type: string }>(
        'SELECT type FROM wujie_credit_transactions WHERE task_id = $1', [runId],
      );
      const credits = await query<{ balance: number }>(
        'SELECT balance FROM wujie_credits WHERE user_id = $1', [userId],
      );
      expect(ledger.rows).toEqual([{ type: 'consume' }]);
      expect(credits.rows[0]?.balance).toBe(93);
      await expect(createBillableTask({
        userId, idempotencyKey, requestDigest: 'b'.repeat(64), creditCost: 7,
        task: {
          id: `skill-conflict-${randomUUID()}`, projectId: 'project-1', type: 'agent-run',
          status: 'processing', progress: 0, createdAt: now + 100, updatedAt: now + 100,
        },
      })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    });
  }, 60_000);

  postgresIt('failure or cancellation refunds once and a late completion cannot cross the terminal state', async () => {
    await withIsolatedPostgres('skill_runtime_terminal_race', async ({ databaseUrl, query }) => {
      const { createBillableTask, settleFailedTask } = await import('@/lib/task-core/billing-service');
      const { completeCloudTask, ensureCloudTaskTables } = await import('@/lib/cloud-task-storage');
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await Promise.all([ensureCoreTables(), ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const now = Date.now();
      const userId = `skill-terminal-${randomUUID()}`;
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const created = await createBillableTask({
        userId, idempotencyKey: randomUUID(), requestDigest: 'c'.repeat(64), creditCost: 9,
        task: {
          id: `skill-run-${randomUUID()}`, projectId: 'project-1', type: 'agent-run',
          status: 'processing', progress: 0, createdAt: now, updatedAt: now,
        },
      });
      const settlements = await Promise.all([
        settleFailedTask({
          taskId: created.task.id, status: 'failed',
          error: { code: 'SKILL_QUALITY_FAILED', message: 'quality failed', retryable: false },
        }),
        settleFailedTask({
          taskId: created.task.id, status: 'cancelled',
          error: { code: 'AGENT_RUN_CANCELLED', message: 'cancelled', retryable: false },
        }),
      ]);
      expect(settlements.filter(result => result.transitioned)).toHaveLength(1);
      expect(settlements.filter(result => result.refunded)).toHaveLength(1);
      await expect(completeCloudTask(created.task.id, {
        assetVersionIds: ['late-version'],
      })).resolves.toBe(false);
      const task = await query<{ status: string; credit_status: string }>(
        'SELECT status, credit_status FROM cloud_tasks WHERE id = $1', [created.task.id],
      );
      const refunds = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM wujie_credit_transactions
         WHERE task_id = $1 AND type = 'refund'`, [created.task.id],
      );
      expect(['failed', 'cancelled']).toContain(task.rows[0]?.status);
      expect(task.rows[0]?.credit_status).toBe('refunded');
      expect(refunds.rows[0]?.count).toBe('1');
    });
  }, 60_000);

  postgresIt('real Skill service coalesces 20 creates and rejects a different digest', async () => {
    await withIsolatedPostgres('skill_runtime_service_concurrency', async ({ databaseUrl, query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const { ensureCloudTaskTables } = await import('@/lib/cloud-task-storage');
      await Promise.all([ensureCoreTables(), ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `skill-service-${randomUUID()}`;
      const idempotencyKey = `skill-service-key-${randomUUID()}`;
      const now = Date.now();
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const input = runtimeInput(userId, idempotencyKey);
      const attempts = await Promise.all(Array.from({ length: 20 }, () => (
        createThroughSkillService(input)
      )));
      expect(new Set(attempts.map(result => result.runId)).size).toBe(1);
      expect(attempts.filter(result => !result.reused)).toHaveLength(1);
      const runId = attempts[0]!.runId;
      const ledger = await query<{ type: string }>(
        'SELECT type FROM wujie_credit_transactions WHERE task_id = $1', [runId],
      );
      expect(ledger.rows).toEqual([{ type: 'consume' }]);

      const [eventStorage, taskStorage, agentService, skillService, catalog] = await Promise.all([
        import('@/lib/agent-runtime/event-storage'),
        import('@/lib/cloud-task-storage'),
        import('@/lib/agent-runtime/service'),
        import('@/lib/skill-runtime/service'),
        import('@/lib/skill-runtime/catalog'),
      ]);
      const persistedTask = await taskStorage.getCloudTaskForUser(runId, userId);
      expect(persistedTask).not.toBeNull();
      let executeAdoptedCalls = 0;
      let providerSubmissions = 0;
      const dispatchDependencies: SkillRunExecutionDispatchDependencies = {
        getTaskForUser: taskStorage.getCloudTaskForUser,
        getRecoverableDispatch: eventStorage.getRecoverableAgentExecutionDispatch,
        loadContinuation: async () => ({
          actor: input.actor,
          request: input.request,
          definition: catalog.requireSkillForSurface(input.request.skillId, input.request.surface),
          workspace: 'canvas',
          requestDigest: persistedTask!.requestDigest!,
          toolId: 'plan',
          execute: async () => { providerSubmissions += 1; },
        }),
        claimExecution: eventStorage.claimAdoptedAgentExecution,
        claimDispatch: eventStorage.claimResumedAgentExecutionDispatch,
        getProjection: agentService.getAgentRunProjection,
        executeAdopted: (async dispatchInput => {
          executeAdoptedCalls += 1;
          await dispatchInput.execute({} as never);
          return {
            runId, reused: false, executed: true,
            projection: await agentService.getAgentRunProjection({ actorUserId: userId, runId }),
            tools: [],
          };
        }) as SkillRunExecutionDispatchDependencies['executeAdopted'],
        failDispatch: eventStorage.failResumedAgentExecutionDispatch,
      };
      const dispatches = await Promise.all(Array.from({ length: 20 }, () => (
        skillService.dispatchSkillRunExecution({
          actorUserId: userId,
          runId,
          recoveryOnly: true,
        }, dispatchDependencies)
      )));
      await Promise.all(dispatches.flatMap(dispatch => dispatch.completion ? [dispatch.completion] : []));
      expect(dispatches.filter(dispatch => dispatch.started)).toHaveLength(1);
      expect(executeAdoptedCalls).toBe(1);
      expect(providerSubmissions).toBe(1);

      const dispatchState = await query<{ dispatch_attempt_count: number }>(
        'SELECT dispatch_attempt_count FROM wujie_agent_execution_leases WHERE task_id = $1',
        [runId],
      );
      expect(Number(dispatchState.rows[0]?.dispatch_attempt_count)).toBe(1);

      await expect(createThroughSkillService({
        ...input,
        request: { ...input.request, inputValues: { product: '不同请求', features: '冲突' } },
      })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    });
  }, 60_000);

  postgresIt('reclaims an expired dispatch through the high-level Skill dispatcher without duplicate submission or charge', async () => {
    await withIsolatedPostgres('skill_runtime_expired_dispatch_recovery', async ({ databaseUrl, query }) => {
      const [core, taskStorage, eventStorage, agentService, skillService, catalog] = await Promise.all([
        import('@/lib/db-storage'),
        import('@/lib/cloud-task-storage'),
        import('@/lib/agent-runtime/event-storage'),
        import('@/lib/agent-runtime/service'),
        import('@/lib/skill-runtime/service'),
        import('@/lib/skill-runtime/catalog'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `skill-recovery-${randomUUID()}`;
      const now = Date.now();
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const input = runtimeInput(userId, `skill-recovery-key-${randomUUID()}`);
      const created = await createThroughSkillService(input);
      const task = await taskStorage.getCloudTaskForUser(created.runId, userId);
      expect(task).not.toBeNull();

      const execution = await eventStorage.claimAdoptedAgentExecution({
        actorUserId: userId,
        projectId: input.request.projectId,
        runId: created.runId,
        toolId: 'plan',
      });
      expect(execution.claimed).toBe(true);
      const lostDispatch = await eventStorage.claimResumedAgentExecutionDispatch({
        actorUserId: userId,
        projectId: input.request.projectId,
        runId: created.runId,
        leaseOwner: execution.leaseOwner,
        generation: execution.generation!,
      });
      expect(lostDispatch.claimed).toBe(true);
      await query(
        'UPDATE wujie_agent_execution_leases SET dispatch_lease_expires_at = 0 WHERE task_id = $1',
        [created.runId],
      );

      let executeAdoptedCalls = 0;
      let providerSubmissions = 0;
      const dependencies: SkillRunExecutionDispatchDependencies = {
        getTaskForUser: taskStorage.getCloudTaskForUser,
        getRecoverableDispatch: eventStorage.getRecoverableAgentExecutionDispatch,
        loadContinuation: async () => ({
          actor: input.actor,
          request: input.request,
          definition: catalog.requireSkillForSurface(input.request.skillId, input.request.surface),
          workspace: 'canvas',
          requestDigest: task!.requestDigest!,
          toolId: 'plan',
          execute: async () => { providerSubmissions += 1; },
        }),
        claimExecution: eventStorage.claimAdoptedAgentExecution,
        claimDispatch: eventStorage.claimResumedAgentExecutionDispatch,
        getProjection: agentService.getAgentRunProjection,
        executeAdopted: (async dispatchInput => {
          executeAdoptedCalls += 1;
          await dispatchInput.execute({} as never);
          return {
            runId: created.runId, reused: true, executed: true,
            projection: await agentService.getAgentRunProjection({ actorUserId: userId, runId: created.runId }),
            tools: [],
          };
        }) as SkillRunExecutionDispatchDependencies['executeAdopted'],
        failDispatch: eventStorage.failResumedAgentExecutionDispatch,
      };
      const recoveries = await Promise.all(Array.from({ length: 20 }, () => (
        skillService.dispatchSkillRunExecution({
          actorUserId: userId,
          runId: created.runId,
          recoveryOnly: true,
        }, dependencies)
      )));
      await Promise.all(recoveries.flatMap(recovery => recovery.completion ? [recovery.completion] : []));

      expect(recoveries.filter(recovery => recovery.started)).toHaveLength(1);
      expect(executeAdoptedCalls).toBe(1);
      expect(providerSubmissions).toBe(1);
      const persistedLease = await query<{ dispatch_attempt_count: number }>(
        'SELECT dispatch_attempt_count FROM wujie_agent_execution_leases WHERE task_id = $1',
        [created.runId],
      );
      expect(Number(persistedLease.rows[0]?.dispatch_attempt_count)).toBe(2);
      const ledger = await query<{ type: string }>(
        'SELECT type FROM wujie_credit_transactions WHERE task_id = $1',
        [created.runId],
      );
      expect(ledger.rows).toEqual([{ type: 'consume' }]);
    });
  }, 60_000);

  postgresIt('real Agent events and Skill executor settle one quality refund and fence late completion', async () => {
    await withIsolatedPostgres('skill_runtime_executor_quality_fence', async ({ databaseUrl, query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const taskStorage = await import('@/lib/cloud-task-storage');
      const agentService = await import('@/lib/agent-runtime/service');
      const sameTask = await import('@/lib/agent-runtime/same-task-adapter');
      const skillService = await import('@/lib/skill-runtime/service');
      await Promise.all([ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `skill-quality-${randomUUID()}`;
      const now = Date.now();
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const input = runtimeInput(userId, `skill-quality-key-${randomUUID()}`);
      const created = await createThroughSkillService(input);
      const [task, events, projection] = await Promise.all([
        taskStorage.getCloudTaskForUser(created.runId, userId),
        agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
        agentService.getAgentRunProjection({ actorUserId: userId, runId: created.runId }),
      ]);
      expect(task).not.toBeNull();
      const createdEvent = events.find(event => event.type === 'run.created')!;
      let capturedFence: { runId: string; leaseOwner: string; generation: number } | undefined;
      await expect(sameTask.executeAdoptedAgentTask({
        adoption: {
          runId: created.runId, reused: false, claimed: true, projection, tools: [],
          actorUserId: userId, projectId: input.request.projectId, workspace: 'canvas',
          toolId: 'generate_image', requestDigest: String(createdEvent.payload.requestDigest),
        },
        execute: async context => {
          capturedFence = context.executionFence;
          await skillService.executeSkillRun({
            actor: input.actor, request: input.request, runId: created.runId,
            operationContext: context,
            stepAdapters: {
              generate_image: async step => step.step.modelRole === 'orchestrator'
                ? { assetVersionIds: [], media: [], html: '规划完成' }
                : { assetVersionIds: [], media: [] },
            },
          });
        },
      })).rejects.toMatchObject({ code: 'SKILL_QUALITY_FAILED' });
      expect(capturedFence).toBeDefined();

      const late = await agentService.appendAgentRunEvent({
        actorUserId: userId, runId: created.runId,
        eventId: `late-completed-${randomUUID()}`, type: 'run.completed',
        payload: { generation: capturedFence!.generation, result: { assetVersionIds: ['late'] } },
        executionFence: capturedFence,
      });
      expect(late.accepted).toBe(false);
      const persisted = await taskStorage.getCloudTaskForUser(created.runId, userId);
      expect(persisted).toMatchObject({ status: 'failed', creditStatus: 'refunded' });
      const refunds = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM wujie_credit_transactions
         WHERE task_id = $1 AND type = 'refund'`, [created.runId],
      );
      expect(refunds.rows[0]?.count).toBe('1');
    });
  }, 60_000);

  postgresIt('successful native Skill execution settles its lease without a synthetic completion', async () => {
    await withIsolatedPostgres('skill_runtime_native_success_lease', async ({ databaseUrl, query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const taskStorage = await import('@/lib/cloud-task-storage');
      const agentService = await import('@/lib/agent-runtime/service');
      const sameTask = await import('@/lib/agent-runtime/same-task-adapter');
      const skillService = await import('@/lib/skill-runtime/service');
      await Promise.all([ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `skill-success-${randomUUID()}`;
      const now = Date.now();
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const input = runtimeInput(userId, `skill-success-key-${randomUUID()}`);
      const created = await createThroughSkillService(input);
      const [events, projection] = await Promise.all([
        agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
        agentService.getAgentRunProjection({ actorUserId: userId, runId: created.runId }),
      ]);

      await sameTask.executeAdoptedAgentTask({
        adoption: {
          runId: created.runId, reused: false, claimed: true, projection, tools: [],
          actorUserId: userId, projectId: input.request.projectId, workspace: 'canvas',
          toolId: 'conversation-1',
          requestDigest: String(events.find(event => event.type === 'run.created')?.payload.requestDigest),
        },
        execute: context => skillService.executeSkillRun({
          actor: input.actor, request: input.request, runId: created.runId,
          operationContext: context,
          stepAdapters: {
            generate_image: async step => step.step.modelRole === 'orchestrator'
              ? { assetVersionIds: [], media: [], html: '规划完成' }
              : { assetVersionIds: ['asset-version-success'], media: [{}] },
          },
        }),
      });

      const [persisted, lease, ledger, persistedEvents] = await Promise.all([
        taskStorage.getCloudTaskForUser(created.runId, userId),
        query<{ completed_at: string; lease_owner: string }>(
          'SELECT completed_at::text, lease_owner FROM wujie_agent_execution_leases WHERE task_id = $1',
          [created.runId],
        ),
        query<{ type: string }>(
          'SELECT type FROM wujie_credit_transactions WHERE task_id = $1 ORDER BY created_at',
          [created.runId],
        ),
        agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
      ]);
      expect(persisted).toMatchObject({ status: 'completed', creditStatus: 'charged' });
      expect(Number(lease.rows[0]?.completed_at)).toBeGreaterThan(0);
      expect(lease.rows[0]?.lease_owner).toBe('');
      expect(ledger.rows).toEqual([{ type: 'consume' }]);
      expect(persistedEvents.filter(event => (
        event.type === 'tool.completed' && event.payload.stepId === undefined
      ))).toHaveLength(0);
      expect(persistedEvents.filter(event => event.type === 'run.completed')).toHaveLength(1);
    });
  }, 60_000);

  postgresIt('persists one independent operation per parallel marketing output and aggregates AssetVersions', async () => {
    await withIsolatedPostgres('skill_runtime_marketing_parallel_operations', async ({ databaseUrl, query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const taskStorage = await import('@/lib/cloud-task-storage');
      const agentService = await import('@/lib/agent-runtime/service');
      const sameTask = await import('@/lib/agent-runtime/same-task-adapter');
      const skillService = await import('@/lib/skill-runtime/service');
      await Promise.all([ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `skill-marketing-${randomUUID()}`;
      const now = Date.now();
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const base = runtimeInput(userId, `skill-marketing-key-${randomUUID()}`);
      const skill = LOVART_MARKETING_SKILLS[0];
      const input = {
        actor: base.actor,
        request: {
          ...base.request,
          skillId: skill.id,
          skillVersion: skill.version,
          inputValues: {
            sourceImages: ['source-a', 'source-b'], campaignName: 'Launch', product: 'Headphones',
            audience: 'Commuters', sellingPoints: 'Quiet travel', objective: '购买', channel: '信息流',
            tone: '清晰、可信、具有行动感', aspectRatio: '1:1', negativeConstraints: '无',
            hypothesis: '强调通勤降噪利益是否提升购买意愿',
          },
          sourceVersionIds: ['source-a', 'source-b'],
        },
      };
      const created = await createThroughSkillService(input);
      const [events, projection] = await Promise.all([
        agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
        agentService.getAgentRunProjection({ actorUserId: userId, runId: created.runId }),
      ]);

      await sameTask.executeAdoptedAgentTask({
        adoption: {
          runId: created.runId, reused: false, claimed: true, projection, tools: [],
          actorUserId: userId, projectId: input.request.projectId, workspace: 'canvas',
          toolId: 'plan',
          requestDigest: String(events.find(event => event.type === 'run.created')?.payload.requestDigest),
        },
        execute: context => skillService.executeSkillRun({
          actor: input.actor, request: input.request, runId: created.runId,
          operationContext: context,
          stepAdapters: {
            chat: async () => ({ assetVersionIds: [], media: [], text: 'plan' }),
            img2img: async step => ({
              assetVersionIds: [step.step.id === 'variant-a' ? 'asset-a' : 'asset-b'], media: [{}],
            }),
          },
        }),
      });

      const [persisted, operations, ledger] = await Promise.all([
        taskStorage.getCloudTaskForUser(created.runId, userId),
        query<{ operation_key: string; step_id: string }>(
          `SELECT operation_key, step_id FROM wujie_agent_downstream_operations
           WHERE task_id = $1 AND tool_id = 'img2img' ORDER BY step_id`,
          [created.runId],
        ),
        query<{ type: string }>(
          'SELECT type FROM wujie_credit_transactions WHERE task_id = $1 ORDER BY created_at',
          [created.runId],
        ),
      ]);
      expect(operations.rows.map(row => row.step_id)).toEqual(['variant-a', 'variant-b']);
      expect(new Set(operations.rows.map(row => row.operation_key)).size).toBe(2);
      expect(persisted?.result?.assetVersionIds).toEqual(['asset-a', 'asset-b']);
      expect(ledger.rows).toEqual([{ type: 'consume' }]);
    });
  }, 60_000);

  postgresIt('real cancellation wins a concurrent late quality failure with one refund', async () => {
    await withIsolatedPostgres('skill_runtime_cancel_quality_race', async ({ databaseUrl, query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const taskStorage = await import('@/lib/cloud-task-storage');
      const agentService = await import('@/lib/agent-runtime/service');
      const sameTask = await import('@/lib/agent-runtime/same-task-adapter');
      const skillService = await import('@/lib/skill-runtime/service');
      await Promise.all([ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `skill-cancel-${randomUUID()}`;
      const now = Date.now();
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const input = runtimeInput(userId, `skill-cancel-key-${randomUUID()}`);
      const created = await createThroughSkillService(input);
      const [events, projection] = await Promise.all([
        agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
        agentService.getAgentRunProjection({ actorUserId: userId, runId: created.runId }),
      ]);
      let releaseLateQuality!: () => void;
      const lateQuality = new Promise<void>(resolve => { releaseLateQuality = resolve; });
      let enteredQualityStep!: () => void;
      const qualityStepStarted = new Promise<void>(resolve => { enteredQualityStep = resolve; });
      const execution = sameTask.executeAdoptedAgentTask({
        adoption: {
          runId: created.runId, reused: false, claimed: true, projection, tools: [],
          actorUserId: userId, projectId: input.request.projectId, workspace: 'canvas',
          toolId: 'conversation-1',
          requestDigest: String(events.find(event => event.type === 'run.created')?.payload.requestDigest),
        },
        execute: context => skillService.executeSkillRun({
          actor: input.actor, request: input.request, runId: created.runId,
          operationContext: context,
          stepAdapters: {
            generate_image: async step => {
              if (step.step.modelRole === 'orchestrator') {
                return { assetVersionIds: [], media: [], html: '规划完成' };
              }
              enteredQualityStep();
              await lateQuality;
              return { assetVersionIds: [], media: [] };
            },
          },
        }),
      });
      await qualityStepStarted;
      await agentService.cancelAgentRun({ actorUserId: userId, runId: created.runId });
      releaseLateQuality();
      await expect(execution).rejects.toBeDefined();

      const persisted = await taskStorage.getCloudTaskForUser(created.runId, userId);
      expect(persisted).toMatchObject({ status: 'cancelled', creditStatus: 'refunded' });
      const refunds = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM wujie_credit_transactions
         WHERE task_id = $1 AND type = 'refund'`, [created.runId],
      );
      expect(refunds.rows[0]?.count).toBe('1');
    });
  }, 60_000);

  postgresIt('an active Agent fence protects its run without blocking child task lineage updates', async () => {
    await withIsolatedPostgres('skill_runtime_child_task_fence', async ({ databaseUrl, query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const taskStorage = await import('@/lib/cloud-task-storage');
      const { withAgentExecutionFence } = await import('@/lib/agent-runtime/execution-fence');
      await Promise.all([ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);

      const now = Date.now();
      const ownerId = `skill-fence-${randomUUID()}`;
      const projectId = `project-${randomUUID()}`;
      const runId = `run-${randomUUID()}`;
      const childTaskId = `child-${randomUUID()}`;
      await query(
        `INSERT INTO cloud_tasks(id, user_id, project_id, type, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'agent-run', 'processing', $5, $5),
                ($4, $2, $3, 'generate-async', 'processing', $5, $5)`,
        [runId, ownerId, projectId, childTaskId, now],
      );
      await query(
        `INSERT INTO wujie_agent_execution_leases(
           task_id, owner_id, project_id, tool_id, lease_owner, lease_expires_at,
           completed_at, updated_at, generation, paused_at
         ) VALUES ($1, $2, $3, 'generate_image', 'worker-current', $4, 0, $5, 2, 0)`,
        [runId, ownerId, projectId, now + 60_000, now],
      );

      const fence = { runId, leaseOwner: 'worker-current', generation: 2 };
      const [childUpdated, parentUpdated] = await withAgentExecutionFence(fence, () => Promise.all([
        taskStorage.updateCloudTask(childTaskId, { result: { lineageFrozen: true } }),
        taskStorage.updateCloudTask(runId, { progress: 40 }),
      ]));

      expect(childUpdated).toBe(true);
      expect(parentUpdated).toBe(true);
      const rows = await query<{ id: string; progress: number; result: Record<string, unknown> }>(
        'SELECT id, progress, result FROM cloud_tasks WHERE id = ANY($1::text[]) ORDER BY id',
        [[childTaskId, runId]],
      );
      expect(rows.rows.find(row => row.id === childTaskId)?.result).toMatchObject({ lineageFrozen: true });
      expect(rows.rows.find(row => row.id === runId)?.progress).toBe(40);
    });
  }, 60_000);
});
