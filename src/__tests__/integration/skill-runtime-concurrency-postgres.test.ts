import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';

vi.mock('server-only', () => ({}));

const hasPostgresTestDatabase = Boolean(process.env.POSTGRES_TEST_DATABASE_URL?.trim());
const postgresIt = hasPostgresTestDatabase ? it : it.skip;

if (!hasPostgresTestDatabase) {
  console.warn('[BLOCKED] Unified Skill Runtime Task 6 PostgreSQL concurrency was not verified: POSTGRES_TEST_DATABASE_URL is missing.');
}

describe('Skill runtime PostgreSQL concurrency', () => {
  function descriptor(providerId: string, modelId: string, kind: 'chat' | 'image'): TaskModelDescriptor {
    return {
      providerId, modelId, kind, sourceType: kind,
      protocol: kind === 'chat' ? 'chat-completions' : 'images',
      executionMode: kind === 'chat' ? 'sync' : 'async',
      allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
      supportsReferenceImages: false, supportsMask: false,
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
    const [runRequest, skillService, agentService, taskStorage] = await Promise.all([
      import('@/lib/skill-runtime/run-request'),
      import('@/lib/skill-runtime/service'),
      import('@/lib/agent-runtime/service'),
      import('@/lib/cloud-task-storage'),
    ]);
    const authorizeContext = async ({ request }: { request: AgentRunRequest }) => ({
      snapshot: request.context, mediaByVersionId: {}, selectedEntityVersionIds: {},
    });
    const createAuthorizedSkillRun: typeof runRequest.createSkillRun = (value) => (
      runRequest.createSkillRun(value, {
        resolveTaskModel: async (providerId, modelId) => descriptor(
          providerId, modelId, providerId === 'pear-chat' ? 'chat' : 'image',
        ),
        authorizeContext,
        calculateCreditCost: async operation => operation === 'chat' ? 1 : 3,
        createAgentRun: agentService.createAgentRun,
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
    await withIsolatedPostgres('skill_runtime_create_concurrency', async ({ query }) => {
      const { createBillableTask } = await import('@/lib/task-core/billing-service');
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const { ensureCloudTaskTables } = await import('@/lib/cloud-task-storage');
      await Promise.all([ensureCoreTables(), ensureCloudTaskTables()]);
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
    await withIsolatedPostgres('skill_runtime_terminal_race', async ({ query }) => {
      const { createBillableTask, settleFailedTask } = await import('@/lib/task-core/billing-service');
      const { completeCloudTask, ensureCloudTaskTables } = await import('@/lib/cloud-task-storage');
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await Promise.all([ensureCoreTables(), ensureCloudTaskTables()]);
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
    await withIsolatedPostgres('skill_runtime_service_concurrency', async ({ query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const { ensureCloudTaskTables } = await import('@/lib/cloud-task-storage');
      await Promise.all([ensureCoreTables(), ensureCloudTaskTables()]);
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

      await expect(createThroughSkillService({
        ...input,
        request: { ...input.request, inputValues: { product: '不同请求', features: '冲突' } },
      })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    });
  }, 60_000);

  postgresIt('real Agent events and Skill executor settle one quality refund and fence late completion', async () => {
    await withIsolatedPostgres('skill_runtime_executor_quality_fence', async ({ query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const taskStorage = await import('@/lib/cloud-task-storage');
      const agentService = await import('@/lib/agent-runtime/service');
      const sameTask = await import('@/lib/agent-runtime/same-task-adapter');
      const skillService = await import('@/lib/skill-runtime/service');
      await Promise.all([ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
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

  postgresIt('real cancellation wins a concurrent late quality failure with one refund', async () => {
    await withIsolatedPostgres('skill_runtime_cancel_quality_race', async ({ query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const taskStorage = await import('@/lib/cloud-task-storage');
      const agentService = await import('@/lib/agent-runtime/service');
      const sameTask = await import('@/lib/agent-runtime/same-task-adapter');
      const skillService = await import('@/lib/skill-runtime/service');
      await Promise.all([ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
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
});
