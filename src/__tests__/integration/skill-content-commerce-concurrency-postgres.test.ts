import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import { LOVART_CONTENT_COMMERCE_SKILLS } from '@/lib/skill-runtime/content-commerce-presets';
import { skillExecutionSteps } from '@/lib/skill-runtime/cost-estimator';
import { resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';

vi.mock('server-only', () => ({}));

const hasPostgresTestDatabase = Boolean(process.env.POSTGRES_TEST_DATABASE_URL?.trim());
const postgresIt = hasPostgresTestDatabase ? it : it.skip;
const batchSku = LOVART_CONTENT_COMMERCE_SKILLS.find(
  skill => skill.id === 'preset-batch-sku-assets',
)!;

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

function descriptor(
  providerId: string,
  modelId: string,
  kind: 'chat' | 'image',
): TaskModelDescriptor {
  return {
    providerId,
    modelId,
    kind,
    sourceType: kind,
    protocol: kind === 'chat' ? 'chat-completions' : 'images',
    executionMode: kind === 'chat' ? 'sync' : 'async',
    allowedRatios: [],
    allowedSizes: [],
    qualityOptions: [],
    maxOutputs: 1,
    supportsReferenceImages: kind === 'image',
    supportsMask: false,
    ...(kind === 'image' ? { maxReferenceImages: 6 } : {}),
    outputKinds: kind === 'chat' ? ['text'] : ['png'],
    capabilitySources: {},
  };
}

function rows(): Array<Record<string, string>> {
  return [
    { sku: 'SKU-A', name: '黑色耳机', sellingPoints: '主动降噪', variant: '黑色', headline: '安静通勤' },
    { sku: 'SKU-B', name: '白色耳机', sellingPoints: '轻量佩戴', variant: '白色', headline: '全天舒适' },
    { sku: 'SKU-C', name: '蓝色耳机', sellingPoints: '长续航', variant: '蓝色', headline: '持续聆听' },
  ];
}

function runtimeInput(userId: string, idempotencyKey: string): {
  actor: User;
  request: SkillRunRequest;
} {
  return {
    actor: {
      id: userId,
      name: 'Content commerce PostgreSQL user',
      role: 'user',
      status: 'active',
      productType: 'canvas,chat',
      createdAt: 1,
      updatedAt: 1,
    },
    request: {
      skillId: batchSku.id,
      skillVersion: batchSku.version,
      surface: 'canvas',
      projectId: 'content-commerce-project',
      workspaceId: 'content-commerce-canvas',
      inputValues: {
        sourceImages: ['source-version'],
        rows: rows(),
        platform: '通用电商',
        assetType: '主图',
        aspectRatio: '1:1',
        brandTone: '清晰、可信',
        negativeConstraints: '禁止虚构参数',
      },
      sourceVersionIds: ['source-version'],
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
    snapshot: request.context,
    mediaByVersionId: {},
    selectedEntityVersionIds: {},
  });
  const resolveTestModel = async (providerId: string, modelId: string) => descriptor(
    providerId,
    modelId,
    providerId === 'pear-chat' ? 'chat' : 'image',
  );
  const runtime = agentService.createAgentRuntimeService({
    randomUUID,
    now: Date.now,
    resolveTaskModel: resolveTestModel,
    authorizeContext,
    calculateCreditCost: async operation => operation === 'chat' ? 2 : 7,
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
  const createAuthorizedSkillRun: typeof runRequest.createSkillRun = value => (
    runRequest.createSkillRun(value, {
      resolveTaskModel: resolveTestModel,
      authorizeContext,
      calculateCreditCost: async operation => operation === 'chat' ? 2 : 7,
      createAgentRun: runtime.createRun,
    })
  );
  return skillService.createSkillRuntimeService({
    createAuthorizedSkillRun,
    getTaskForUser: taskStorage.getCloudTaskForUser,
    listTasks: taskStorage.listCloudTasks,
    listEvents: agentService.listAgentRunEvents,
    getProjection: agentService.getAgentRunProjection,
    pauseRun: agentService.pauseAgentRun,
    resumeRun: agentService.resumeAgentRun,
    cancelRun: agentService.cancelAgentRun,
  }).create(input);
}

async function seedCredits(
  query: Parameters<Parameters<typeof withIsolatedPostgres>[1]>[0]['query'],
  userId: string,
): Promise<void> {
  const now = Date.now();
  await query(
    `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
     VALUES ($1, $2, 100, 100, 0, $3, $3)`,
    [`credits-${randomUUID()}`, userId, now],
  );
}

async function waitUntil(assertion: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await assertion())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for persisted Skill state');
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
  }
}

if (!hasPostgresTestDatabase) {
  console.warn('[BLOCKED] Content-commerce PostgreSQL concurrency was not verified: POSTGRES_TEST_DATABASE_URL is missing.');
}

describe('Lovart content-commerce PostgreSQL concurrency', () => {
  postgresIt('coalesces duplicate submissions, persists one operation per SKU, bills once, and restores stable order', async () => {
    await withIsolatedPostgres('content_commerce_create_execute_recover', async ({ databaseUrl, query }) => {
      const core = await import('@/lib/db-storage');
      const taskStorage = await import('@/lib/cloud-task-storage');
      const agentService = await import('@/lib/agent-runtime/service');
      const sameTask = await import('@/lib/agent-runtime/same-task-adapter');
      const skillService = await import('@/lib/skill-runtime/service');
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);

      const userId = `content-commerce-${randomUUID()}`;
      await seedCredits(query, userId);
      const input = runtimeInput(userId, `content-commerce-key-${randomUUID()}`);
      const attempts = await Promise.all(Array.from({ length: 20 }, () => createThroughSkillService(input)));
      expect(new Set(attempts.map(attempt => attempt.runId)).size).toBe(1);
      expect(attempts.filter(attempt => !attempt.reused)).toHaveLength(1);

      const runId = attempts[0]!.runId;
      const [events, projection] = await Promise.all([
        agentService.listAgentRunEvents({ actorUserId: userId, runId }),
        agentService.getAgentRunProjection({ actorUserId: userId, runId }),
      ]);
      const compiled = skillExecutionSteps(batchSku, resolveSkillInputs(batchSku, input.request.inputValues));
      const skuStepIds = compiled.slice(1).map(step => step.id);

      await sameTask.executeAdoptedAgentTask({
        adoption: {
          runId,
          reused: false,
          claimed: true,
          projection,
          tools: [],
          actorUserId: userId,
          projectId: input.request.projectId,
          workspace: 'canvas',
          toolId: 'sku-plan',
          requestDigest: String(events.find(event => event.type === 'run.created')?.payload.requestDigest),
        },
        execute: context => skillService.executeSkillRun({
          actor: input.actor,
          request: input.request,
          runId,
          operationContext: context,
          stepAdapters: {
            chat: async () => ({ assetVersionIds: [], media: [], text: '批次规则有效' }),
            img2img: async step => ({
              assetVersionIds: [`asset:${step.step.id}`],
              media: [{ width: 1200, height: 1200 }],
            }),
          },
        }),
      });

      const service = skillService.createSkillRuntimeService();
      const [persisted, restoredFirst, restoredSecond, operations, ledger, credits] = await Promise.all([
        taskStorage.getCloudTaskForUser(runId, userId),
        service.get({ actorUserId: userId, runId }),
        service.get({ actorUserId: userId, runId }),
        query<{ operation_key: string; step_id: string }>(
          `SELECT operation_key, step_id FROM wujie_agent_downstream_operations
           WHERE task_id = $1 AND tool_id = 'img2img' ORDER BY created_at, step_id`,
          [runId],
        ),
        query<{ type: string; amount: number }>(
          'SELECT type, amount FROM wujie_credit_transactions WHERE task_id = $1 ORDER BY created_at',
          [runId],
        ),
        query<{ balance: number; total_used: number }>(
          'SELECT balance, total_used FROM wujie_credits WHERE user_id = $1',
          [userId],
        ),
      ]);

      expect(operations.rows.map(row => row.step_id).sort()).toEqual([...skuStepIds].sort());
      expect(new Set(operations.rows.map(row => row.operation_key)).size).toBe(3);
      expect(persisted).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 23 });
      expect(persisted?.result?.assetVersionIds).toEqual(skuStepIds.map(stepId => `asset:${stepId}`));
      expect(restoredFirst.assetVersionIds).toEqual(skuStepIds.map(stepId => `asset:${stepId}`));
      expect(restoredSecond.assetVersionIds).toEqual(restoredFirst.assetVersionIds);
      expect(restoredSecond.steps.map(step => step.id)).toEqual(compiled.map(step => step.id));
      expect(ledger.rows).toEqual([{ type: 'consume', amount: -23 }]);
      expect(credits.rows[0]).toEqual({ balance: 77, total_used: 23 });
    });
  }, 90_000);

  postgresIt('keeps one successful SKU charge, refunds unfinished rows once, and fences late results after cancellation', async () => {
    await withIsolatedPostgres('content_commerce_cancel_late_result', async ({ databaseUrl, query }) => {
      const core = await import('@/lib/db-storage');
      const taskStorage = await import('@/lib/cloud-task-storage');
      const agentService = await import('@/lib/agent-runtime/service');
      const sameTask = await import('@/lib/agent-runtime/same-task-adapter');
      const skillService = await import('@/lib/skill-runtime/service');
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);

      const userId = `content-commerce-cancel-${randomUUID()}`;
      await seedCredits(query, userId);
      const input = runtimeInput(userId, `content-commerce-cancel-key-${randomUUID()}`);
      const created = await createThroughSkillService(input);
      const [events, projection] = await Promise.all([
        agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
        agentService.getAgentRunProjection({ actorUserId: userId, runId: created.runId }),
      ]);
      const compiled = skillExecutionSteps(batchSku, resolveSkillInputs(batchSku, input.request.inputValues));
      const skuStepIds = compiled.slice(1).map(step => step.id);
      let releaseLateRows!: () => void;
      const lateRows = new Promise<void>(resolvePromise => { releaseLateRows = resolvePromise; });

      const execution = sameTask.executeAdoptedAgentTask({
        adoption: {
          runId: created.runId,
          reused: false,
          claimed: true,
          projection,
          tools: [],
          actorUserId: userId,
          projectId: input.request.projectId,
          workspace: 'canvas',
          toolId: 'sku-plan',
          requestDigest: String(events.find(event => event.type === 'run.created')?.payload.requestDigest),
        },
        execute: context => skillService.executeSkillRun({
          actor: input.actor,
          request: input.request,
          runId: created.runId,
          operationContext: context,
          stepAdapters: {
            chat: async () => ({ assetVersionIds: [], media: [], text: '批次规则有效' }),
            img2img: async step => {
              if (step.step.id === skuStepIds[0]) {
                return {
                  assetVersionIds: [`asset:${step.step.id}`],
                  media: [{ width: 1200, height: 1200 }],
                };
              }
              await lateRows;
              if (step.step.id === skuStepIds[1]) throw new Error('late provider failure');
              return {
                assetVersionIds: [`late:${step.step.id}`],
                media: [{ width: 1200, height: 1200 }],
              };
            },
          },
        }),
      });

      await waitUntil(async () => {
        const [current, operationCount] = await Promise.all([
          agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
          query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM wujie_agent_downstream_operations
             WHERE task_id = $1 AND tool_id = 'img2img'`,
            [created.runId],
          ),
        ]);
        return operationCount.rows[0]?.count === '3' && current.some(event => (
          event.type === 'tool.completed' && event.payload.stepId === skuStepIds[0]
        ));
      });
      await agentService.cancelAgentRun({ actorUserId: userId, runId: created.runId });
      releaseLateRows();
      await expect(execution).rejects.toBeDefined();
      await expect(taskStorage.completeCloudTask(created.runId, {
        assetVersionIds: skuStepIds.map(stepId => `late:${stepId}`),
      })).resolves.toBe(false);

      const runtimeService = skillService.createSkillRuntimeService();
      const [persisted, restored, operations, ledger, credits, persistedEvents] = await Promise.all([
        taskStorage.getCloudTaskForUser(created.runId, userId),
        runtimeService.get({ actorUserId: userId, runId: created.runId }),
        query<{ step_id: string }>(
          `SELECT step_id FROM wujie_agent_downstream_operations
           WHERE task_id = $1 AND tool_id = 'img2img' ORDER BY created_at, step_id`,
          [created.runId],
        ),
        query<{ type: string; amount: number }>(
          'SELECT type, amount FROM wujie_credit_transactions WHERE task_id = $1 ORDER BY created_at',
          [created.runId],
        ),
        query<{ balance: number; total_used: number }>(
          'SELECT balance, total_used FROM wujie_credits WHERE user_id = $1',
          [userId],
        ),
        agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
      ]);

      expect(operations.rows.map(row => row.step_id).sort()).toEqual([...skuStepIds].sort());
      expect(persisted).toMatchObject({ status: 'cancelled', creditStatus: 'charged', creditCost: 23 });
      expect(persisted?.result?.assetVersionIds).toBeUndefined();
      expect(restored.assetVersionIds).toEqual([`asset:${skuStepIds[0]}`]);
      expect(ledger.rows).toEqual([
        { type: 'consume', amount: -23 },
        { type: 'refund', amount: 14 },
      ]);
      expect(credits.rows[0]).toEqual({ balance: 91, total_used: 9 });
      expect(persistedEvents.filter(event => event.type === 'run.cancelled')).toHaveLength(1);
      expect(persistedEvents.filter(event => event.type === 'run.completed')).toHaveLength(0);
      expect(persistedEvents.filter(event => (
        event.type === 'asset.created' && String(event.payload.assetVersionId).startsWith('late:')
      ))).toHaveLength(0);
    });
  }, 90_000);
});
