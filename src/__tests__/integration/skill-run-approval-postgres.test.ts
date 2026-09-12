import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';
import { createSkillApprovalState } from '@/lib/skill-runtime/approval';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

function migrate(databaseUrl: string): void {
  const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

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

describe('Skill approval PostgreSQL concurrency', () => {
  postgresIt('dispatches twenty identical approvals once and keeps cross-user access hidden', async () => {
    await withIsolatedPostgres('skill_approval_concurrency', async ({ databaseUrl, query }) => {
      const [core, taskStorage, eventStorage, agentService, runRequest, skillService, billing, taskService] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/agent-runtime/event-storage'), import('@/lib/agent-runtime/service'),
        import('@/lib/skill-runtime/run-request'), import('@/lib/skill-runtime/service'),
        import('@/lib/task-core/billing-service'), import('@/lib/task-core/task-service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);

      const userId = `approval-${randomUUID()}`;
      const actor: User = {
        id: userId, name: 'Approval user', role: 'user', status: 'active',
        productType: 'canvas,chat', createdAt: 1, updatedAt: 1,
      };
      const now = Date.now();
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const request: SkillRunRequest = {
        skillId: 'preset-ecommerce-listing', skillVersion: 1, surface: 'canvas',
        projectId: 'project-1', workspaceId: 'canvas-1',
        inputValues: { product: '耳机', features: '降噪' }, sourceVersionIds: [],
        modelBindings: {
          orchestrator: { providerId: 'chat-provider', modelId: 'chat-model' },
          image: { providerId: 'image-provider', modelId: 'image-model' },
        },
        idempotencyKey: `approval-run-${randomUUID()}`,
      };
      const authorizeContext = async ({ request: agentRequest }: { request: AgentRunRequest }) => ({
        snapshot: agentRequest.context, mediaByVersionId: {}, selectedEntityVersionIds: {},
      });
      const resolveTaskModel = async (providerId: string, modelId: string) => descriptor(
        providerId, modelId, providerId === 'chat-provider' ? 'chat' : 'image',
      );
      let dispatchCount = 0;
      let releaseDispatch: () => void = () => undefined;
      const heldCompletion = new Promise<void>(resolveCompletion => { releaseDispatch = resolveCompletion; });
      const runtime = agentService.createAgentRuntimeService({
        randomUUID, now: Date.now, resolveTaskModel, authorizeContext,
        calculateCreditCost: async operation => operation === 'chat' ? 1 : 3,
        createBillableTask: billing.createBillableTask,
        appendEvent: eventStorage.appendAgentEvent,
        transitionControl: eventStorage.transitionAgentRunControl,
        listEvents: eventStorage.listAgentEventsForActor,
        listRunEventStreams: eventStorage.listAgentEventStreamsForActor,
        getTaskForUser: taskStorage.getCloudTaskForUser,
        transitionTask: taskService.transitionTask,
        settleFailedTask: billing.settleFailedTask,
        abortTaskExecution: () => false,
        dispatchExecution: async () => {
          dispatchCount += 1;
          return { started: true, completion: heldCompletion };
        },
      });
      const createAuthorizedSkillRun: typeof runRequest.createSkillRun = value => runRequest.createSkillRun(value, {
        resolveTaskModel, authorizeContext,
        calculateCreditCost: async operation => operation === 'chat' ? 1 : 3,
        createAgentRun: runtime.createRun,
      });
      const service = skillService.createSkillRuntimeService({
        createAuthorizedSkillRun,
        getTaskForUser: taskStorage.getCloudTaskForUser,
        listTasks: taskStorage.listCloudTasks,
        listEvents: runtime.listEvents,
        getProjection: runtime.getRun,
        pauseRun: runtime.pauseRun,
        resumeRun: runtime.resumeRun,
        cancelRun: runtime.cancelRun,
        prepareResume: async () => true,
      });
      const created = await service.create({ actor, request });
      const execution = await eventStorage.claimAdoptedAgentExecution({
        actorUserId: userId, projectId: request.projectId, runId: created.runId, toolId: 'plan',
      });
      expect(execution.claimed).toBe(true);
      const beforePause = await taskStorage.getCloudTaskForUser(created.runId, userId);
      expect(beforePause).not.toBeNull();
      const approval = createSkillApprovalState({
        stepId: 'plan', nextStepId: 'generate-3', outputSchemaId: 'brief-to-video-plan-v1',
        planChecksum: 'a'.repeat(64), revision: (beforePause!.revision ?? 0) + 1,
        generation: execution.generation!, allowRevision: true,
      });
      await runtime.pauseRun({
        actorUserId: userId, runId: created.runId, nextStepId: 'generate-3',
        pauseReason: 'approval', approval: approval as unknown as Record<string, unknown>,
        error: { code: 'SKILL_APPROVAL_REQUIRED', message: 'approval required', retryable: false },
        executionFence: { runId: created.runId, leaseOwner: execution.leaseOwner,
          generation: execution.generation! },
      });

      const identity = { revision: approval.revision, generation: approval.generation,
        planChecksum: approval.planChecksum };
      const results = await Promise.all(Array.from({ length: 20 }, () => service.approve({
        actorUserId: userId, runId: created.runId, ...identity,
      })));
      expect(results.filter(result => result.dispatched === true)).toHaveLength(1);
      expect(dispatchCount).toBe(1);
      const resumed = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM wujie_agent_events
         WHERE task_id = $1 AND event_type = 'run.resumed'`,
        [created.runId],
      );
      expect(resumed.rows[0]?.count).toBe('1');
      await expect(service.approve({ actorUserId: 'other-user', runId: created.runId, ...identity }))
        .rejects.toMatchObject({ code: 'SKILL_RUN_NOT_FOUND', status: 404 });
      releaseDispatch();
      await heldCompletion;
    });
  }, 60_000);
});
