import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';
import { canonicalComplianceReportJson } from '@/lib/platform-compliance/report-schema';
import { validReport } from '@/__tests__/helpers/platform-compliance-fixtures';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

function migrate(databaseUrl: string): void {
  const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

function descriptor(providerId: string, modelId: string): TaskModelDescriptor {
  return {
    providerId, modelId, kind: 'chat', sourceType: 'vlm', protocol: 'chat-completions',
    executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [],
    maxOutputs: 1, supportsReferenceImages: true, supportsMask: false,
    maxReferenceImages: 20, outputKinds: ['text'], capabilitySources: {},
  };
}

function complianceInput(userId: string, idempotencyKey: string): {
  actor: User;
  request: SkillRunRequest;
} {
  return {
    actor: {
      id: userId, name: 'Compliance PostgreSQL user', role: 'user', status: 'active',
      productType: 'canvas,chat', createdAt: 1, updatedAt: 1,
    },
    request: {
      skillId: 'preset-platform-compliance-audit', skillVersion: 1, surface: 'canvas',
      projectId: 'project-compliance', workspaceId: 'canvas-compliance',
      inputValues: {
        sourceImages: ['source-a', 'source-b', 'source-c'], platform: 'Amazon', region: 'US',
        assetType: 'main', productCategory: '', productFacts: '事实', claims: '声明',
        reportLanguage: '中文',
      },
      sourceVersionIds: ['source-a', 'source-b', 'source-c'],
      modelBindings: {
        orchestrator: { providerId: 'pear-vision', modelId: 'vision-model' },
        vision: { providerId: 'pear-vision', modelId: 'vision-model' },
      },
      idempotencyKey,
    },
  };
}

async function createHarness() {
  const [skillModule, agentModule, events, tasks, billing, taskService, taskAbort, catalog, compiler] = await Promise.all([
    import('@/lib/skill-runtime/service'),
    import('@/lib/agent-runtime/service'), import('@/lib/agent-runtime/event-storage'),
    import('@/lib/cloud-task-storage'), import('@/lib/task-core/billing-service'),
    import('@/lib/task-core/task-service'), import('@/lib/task-core/task-abort'),
    import('@/lib/skill-runtime/catalog'),
    import('@/lib/skill-runtime/cost-estimator'),
  ]);
  const resolveTaskModel = async (providerId: string, modelId: string) => descriptor(providerId, modelId);
  const authorizeContext = async ({ request }: { request: AgentRunRequest }) => ({
    snapshot: request.context, mediaByVersionId: {}, selectedEntityVersionIds: {},
  });
  const runtime = agentModule.createAgentRuntimeService({
    randomUUID, now: Date.now, resolveTaskModel, authorizeContext,
    calculateCreditCost: async () => 5,
    createBillableTask: billing.createBillableTask,
    appendEvent: events.appendAgentEvent,
    transitionControl: events.transitionAgentRunControl,
    listEvents: events.listAgentEventsForActor,
    observeAdoptedTerminal: events.observeAdoptedAgentTaskTerminal,
    listRunEventStreams: events.listAgentEventStreamsForActor,
    getTaskForUser: tasks.getCloudTaskForUser,
    transitionTask: taskService.transitionTask,
    settleFailedTask: billing.settleFailedTask,
    abortTaskExecution: taskAbort.abortTaskExecution,
  });
  const createAuthorizedSkillRun = async (value: ReturnType<typeof complianceInput>) => {
    const definition = catalog.requireSkillForSurface(value.request.skillId, value.request.surface);
    const steps = compiler.skillExecutionSteps(definition, value.request.inputValues);
    const requestDigest = createHash('sha256').update(JSON.stringify(value.request)).digest('hex');
    const now = Date.now();
    const created = await billing.createBillableTask({
      userId: value.actor.id,
      idempotencyKey: value.request.idempotencyKey,
      requestDigest,
      creditCost: steps.length * 5,
      task: {
        id: randomUUID(), projectId: value.request.projectId, type: 'agent-run',
        status: 'processing', providerId: 'pear-vision', model: 'vision-model',
        progress: 0, label: 'Compliance audit', createdAt: now, updatedAt: now,
      },
    });
    const runId = created.task.id;
    const event = await events.appendAgentEvent({
      actorUserId: value.actor.id, projectId: value.request.projectId, runId,
      eventId: `agent:${runId}:created`, workspace: 'canvas', type: 'run.created',
      payload: {
        workspace: 'canvas', workspaceId: value.request.workspaceId, mode: 'agent',
        providerId: 'pear-vision', modelId: 'vision-model', prompt: 'compliance audit',
        sourceVersionIds: value.request.sourceVersionIds,
        allowedToolIds: ['compliance_audit'], context: {}, requestDigest,
        skill: {
          skillId: value.request.skillId, skillVersion: value.request.skillVersion,
          inputValues: value.request.inputValues, modelBindings: value.request.modelBindings,
        },
        skillSnapshot: {
          executionContextVersion: definition.executionContextVersion,
          systemPrompt: definition.systemPrompt,
          inputs: definition.inputs,
          id: definition.id, version: definition.version, name: definition.name,
          steps: steps.map(step => ({ ...step, cost: 5 })),
        },
      },
    });
    return {
      runId, reused: created.reused, charged: created.charged, event,
      projection: await runtime.getRun({ actorUserId: value.actor.id, runId }), tools: [],
    };
  };
  return {
    runtime,
    skill: skillModule.createSkillRuntimeService({
      createAuthorizedSkillRun: createAuthorizedSkillRun as never,
      getTaskForUser: tasks.getCloudTaskForUser,
      listTasks: tasks.listCloudTasks,
      listEvents: runtime.listEvents,
      getProjection: runtime.getRun,
      pauseRun: runtime.pauseRun,
      resumeRun: runtime.resumeRun,
      cancelRun: runtime.cancelRun,
    }),
  };
}

async function seedCredits(
  query: (sql: string, values?: unknown[]) => Promise<unknown>,
  userId: string,
): Promise<void> {
  const now = Date.now();
  await query(
    `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
     VALUES ($1, $2, 100, 100, 0, $3, $3)`,
    [`credits-${randomUUID()}`, userId, now],
  );
}

function reportOutput(runId: string, stepId: string, sourceVersionId: string) {
  return {
    schemaId: 'platform-compliance-report-v1',
    value: validReport({
      reportId: `report:${stepId}`, runId, sourceVersionId,
      generatedAt: '2026-09-09T00:00:00.000Z',
    }),
  } as const;
}

describe('platform compliance accounting on isolated PostgreSQL', () => {
  postgresIt('deduplicates concurrent audits and refunds undelivered vision work once', async () => {
    await withIsolatedPostgres('platform_compliance_cancel_refund', async ({ databaseUrl, query }) => {
      const [core, taskStorage, agentService, sameTask, skillService] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/agent-runtime/service'), import('@/lib/agent-runtime/same-task-adapter'),
        import('@/lib/skill-runtime/service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-cancel-${randomUUID()}`;
      await seedCredits(query, userId);
      const input = complianceInput(userId, `compliance-key-${randomUUID()}`);
      const harness = await createHarness();
      const creates = await Promise.all(Array.from({ length: 12 }, () => harness.skill.create(input)));
      expect(new Set(creates.map(result => result.runId))).toHaveLength(1);
      expect(creates.filter(result => result.charged)).toHaveLength(1);
      const runId = creates[0]!.runId;
      const events = await agentService.listAgentRunEvents({ actorUserId: userId, runId });
      const projection = await agentService.getAgentRunProjection({ actorUserId: userId, runId });
      const requestDigest = String(events.find(event => event.type === 'run.created')?.payload.requestDigest);
      let releasePending!: () => void;
      const pending = new Promise<void>(resolvePending => { releasePending = resolvePending; });
      let firstDelivered!: () => void;
      const delivered = new Promise<void>(resolveDelivered => { firstDelivered = resolveDelivered; });
      let fence: { runId: string; leaseOwner: string; generation: number } | undefined;

      const execution = sameTask.executeAdoptedAgentTask({
        adoption: {
          runId, reused: false, claimed: true, projection, tools: [], actorUserId: userId,
          projectId: input.request.projectId, workspace: 'canvas', toolId: 'compliance-run', requestDigest,
        },
        execute: context => {
          fence = context.executionFence;
          return skillService.executeSkillRun({
            actor: input.actor, request: input.request, runId, operationContext: context,
            stepAdapters: {
              chat: async () => ({ assetVersionIds: [], media: [], text: '合规检查计划' }),
              compliance_audit: async step => {
                const sourceVersionId = step.step.compiledFanOut
                  ? (step.inputValues.sourceImages as string[])[step.step.compiledFanOut.itemIndex]!
                  : '';
                if (sourceVersionId !== 'source-a') {
                  await pending;
                  if (step.signal.aborted) throw step.signal.reason;
                }
                const versionId = `report-final-${sourceVersionId}`;
                if (sourceVersionId === 'source-a') queueMicrotask(firstDelivered);
                return {
                  assetVersionIds: [versionId], media: [],
                  structured: reportOutput(runId, step.step.id, sourceVersionId),
                };
              },
            },
          });
        },
      });
      await delivered;
      await new Promise(resolveWait => setTimeout(resolveWait, 20));
      await harness.skill.cancel({ actorUserId: userId, runId });
      releasePending();
      await expect(execution).rejects.toBeDefined();

      const [task, operations, ledger] = await Promise.all([
        taskStorage.getCloudTaskForUser(runId, userId),
        query<{ operation_key: string; step_id: string }>(
          `SELECT operation_key, step_id FROM wujie_agent_downstream_operations
           WHERE task_id = $1 AND tool_id = 'compliance_audit' ORDER BY step_id`, [runId],
        ),
        query<{ type: string; amount: number }>(
          `SELECT type, amount FROM wujie_credit_transactions
           WHERE task_id = $1 ORDER BY created_at, id`, [runId],
        ),
      ]);
      expect(task).toMatchObject({ status: 'cancelled', creditStatus: 'charged' });
      expect(operations.rows).toHaveLength(3);
      expect(new Set(operations.rows.map(row => row.operation_key)).size).toBe(3);
      expect(ledger.rows).toEqual([
        { type: 'consume', amount: -20 },
        { type: 'refund', amount: 10 },
      ]);

      const late = await agentService.appendAgentRunEvent({
        actorUserId: userId, runId, eventId: `late-completed-${randomUUID()}`,
        type: 'run.completed', payload: { result: { assetVersionIds: ['late-version'] } },
        executionFence: fence,
      });
      expect(late.accepted).toBe(false);
      expect((await taskStorage.getCloudTaskForUser(runId, userId))?.status).toBe('cancelled');
      const refunds = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM wujie_credit_transactions
         WHERE task_id = $1 AND type = 'refund'`, [runId],
      );
      expect(refunds.rows[0]?.count).toBe('1');
    });
  }, 60_000);

  postgresIt('retries only the failed image and preserves its technical report version', async () => {
    await withIsolatedPostgres('platform_compliance_retry_partial', async ({ databaseUrl, query }) => {
      const [core, taskStorage, agentService, eventStorage, sameTask, skillService] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/agent-runtime/service'), import('@/lib/agent-runtime/event-storage'),
        import('@/lib/agent-runtime/same-task-adapter'), import('@/lib/skill-runtime/service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-retry-${randomUUID()}`;
      await seedCredits(query, userId);
      const input = complianceInput(userId, `compliance-key-${randomUUID()}`);
      const harness = await createHarness();
      const created = await harness.skill.create(input);
      const runId = created.runId;
      const calls = new Map<string, number>();
      const adapter = async (step: Parameters<typeof skillService.executeSkillRun>[0]['stepAdapters'][string] extends (...args: infer A) => unknown ? A[0] : never) => {
        const sourceVersionId = (step.inputValues.sourceImages as string[])[step.step.compiledFanOut!.itemIndex]!;
        calls.set(sourceVersionId, (calls.get(sourceVersionId) || 0) + 1);
        if (sourceVersionId === 'source-b' && calls.get(sourceVersionId) === 1) {
          const technicalVersionId = 'report-technical-source-b';
          await eventStorage.appendAdoptedAgentEvent({
            actorUserId: userId, projectId: input.request.projectId, runId, workspace: 'canvas',
            eventId: `technical:${step.step.id}:${technicalVersionId}`, type: 'asset.created',
            payload: {
              stepId: step.step.id, assetVersionId: technicalVersionId,
              generation: step.operation.executionFence!.generation,
            },
            executionFence: step.operation.executionFence,
          });
          await eventStorage.appendAdoptedAgentEvent({
            actorUserId: userId, projectId: input.request.projectId, runId, workspace: 'canvas',
            eventId: `technical:${step.step.id}:progress`, type: 'tool.progress',
            payload: {
              toolId: 'compliance_audit', stepId: step.step.id, phase: 'vision-error',
              assetVersionId: technicalVersionId,
              generation: step.operation.executionFence!.generation,
              outputs: [{
                stepId: step.step.id, kind: 'json', schemaId: 'platform-compliance-report-v1',
                content: canonicalComplianceReportJson(reportOutput(runId, step.step.id, sourceVersionId).value),
              }],
            },
            executionFence: step.operation.executionFence,
          });
          throw Object.assign(new Error('controlled vision failure'), { submissionOutcome: 'known' });
        }
        return {
          assetVersionIds: [`report-final-${sourceVersionId}`], media: [],
          structured: reportOutput(runId, step.step.id, sourceVersionId),
        };
      };
      const initialEvents = await agentService.listAgentRunEvents({ actorUserId: userId, runId });
      const initialProjection = await agentService.getAgentRunProjection({ actorUserId: userId, runId });
      const requestDigest = String(initialEvents.find(event => event.type === 'run.created')?.payload.requestDigest);
      const adoption = {
        runId, reused: false, claimed: true, projection: initialProjection, tools: [],
        actorUserId: userId, projectId: input.request.projectId, workspace: 'canvas' as const,
        toolId: 'compliance-run', requestDigest,
      };
      let initialFailure: unknown;
      try {
        await sameTask.executeAdoptedAgentTask({
        adoption,
        execute: context => skillService.executeSkillRun({
          actor: input.actor, request: input.request, runId, operationContext: context,
          stepAdapters: {
            chat: async () => ({ assetVersionIds: [], media: [], text: '合规检查计划' }),
            compliance_audit: adapter,
          },
        }),
        });
      } catch (error) {
        initialFailure = error;
      }
      expect(initialFailure).toMatchObject({ message: 'controlled vision failure' });

      const paused = await harness.skill.get({ actorUserId: userId, runId });
      const failedStepId = paused.resumeFromStepId!;
      expect(paused.status).toBe('paused');
      expect(paused.assetVersionIds).toEqual(expect.arrayContaining([
        'report-final-source-a', 'report-technical-source-b', 'report-final-source-c',
      ]));
      const beforeVersions = [...paused.assetVersionIds];
      const task = await taskStorage.getCloudTaskForUser(runId, userId);
      const resumed = await eventStorage.transitionAgentRunControl({
        actorUserId: userId, projectId: input.request.projectId, runId,
        eventId: `agent:${runId}:resumed:1`, workspace: 'canvas', type: 'run.resumed',
        payload: { nextStepId: failedStepId, generation: 1 },
        expectedRevision: task!.revision || 0, leaseOwner: `retry-${randomUUID()}`,
      });
      expect(resumed.accepted).toBe(true);
      const retried = await sameTask.executeAdoptedAgentTask({
        adoption: {
          ...adoption, reused: true, toolId: failedStepId,
          projection: await agentService.getAgentRunProjection({ actorUserId: userId, runId }),
        },
        resumeFromStepId: failedStepId, expectedGeneration: 1, leaseOwner: resumed.leaseOwner,
        execute: context => skillService.executeSkillRun({
          actor: input.actor, request: input.request, runId, operationContext: context,
          resumeFromStepId: failedStepId,
          stepAdapters: {
            chat: async () => ({ assetVersionIds: [], media: [], text: '合规检查计划' }),
            compliance_audit: adapter,
          },
        }),
      });
      expect(retried.executed).toBe(true);
      const completed = await harness.skill.get({ actorUserId: userId, runId });
      expect(completed.status).toBe('completed');
      expect(completed.assetVersionIds).toEqual(expect.arrayContaining(beforeVersions));
      expect(completed.assetVersionIds).toContain('report-final-source-b');
      expect(calls).toEqual(new Map([
        ['source-a', 1], ['source-b', 2], ['source-c', 1],
      ]));
      const operations = await query<{ step_id: string }>(
        `SELECT step_id FROM wujie_agent_downstream_operations
         WHERE task_id = $1 AND tool_id = 'compliance_audit' ORDER BY step_id`, [runId],
      );
      expect(operations.rows).toHaveLength(3);
      const ledger = await query<{ type: string }>(
        `SELECT type FROM wujie_credit_transactions WHERE task_id = $1 ORDER BY created_at, id`, [runId],
      );
      expect(ledger.rows).toEqual([{ type: 'consume' }]);
    });
  }, 60_000);
});
