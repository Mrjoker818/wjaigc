import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { withIsolatedPostgres } from '../helpers/postgres-test-database';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; Stage 4 Agent accounting PostgreSQL tests skipped.',
  );
}

function migrate(isolatedDatabaseUrl: string): void {
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

function clearInMemoryTaskRegistry(): void {
  const store = (globalThis as Record<string, unknown>).__wujie_task_store__ as {
    registry?: Map<string, unknown>;
    cancelled?: Map<string, unknown>;
    userQueues?: Map<string, unknown>;
    userActiveCount?: Map<string, unknown>;
    taskUserMap?: Map<string, unknown>;
    pendingDurableTaskMarkers?: Map<string, unknown>;
  } | undefined;
  store?.registry?.clear();
  store?.cancelled?.clear();
  store?.userQueues?.clear();
  store?.userActiveCount?.clear();
  store?.taskUserMap?.clear();
  store?.pendingDurableTaskMarkers?.clear();
}

describe('Stage 4 Agent workspace projection on real PostgreSQL', () => {
  postgresIt('binds caller idempotency to one exact target while sharing one result version', async () => {
    await withIsolatedPostgres('stage-4-agent-workspace-result', async ({ databaseUrl: url, query }) => {
      migrate(url);
      const { createCloudTask } = await import('@/lib/cloud-task-storage');
      const { projectAgentResultToWorkspace } = await import('@/lib/agent-runtime/workspace-results');

      const ownerId = 'stage-4-workspace-owner';
      const projectId = 'stage-4-workspace-project';
      const taskId = 'stage-4-workspace-task';
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name, status)
         VALUES ($1, $2, 'Stage 4 workspace result', 'active')`,
        [projectId, ownerId],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ('stage-4-source-asset', $1, $2, 'image', 'active')`,
        [ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, availability
         ) VALUES (
           'stage-4-source-version', 'stage-4-source-asset', $1, $2,
           '/uploads/stage-4-source.png', 'ready'
         )`,
        [ownerId, projectId],
      );
      await createCloudTask({
        id: taskId,
        userId: ownerId,
        projectId,
        type: 'agent-edit',
        status: 'completed',
        providerId: 'stage-4-provider',
        model: 'stage-4-model',
        progress: 100,
        result: { imageUrl: '/uploads/stage-4-agent-result.png' },
        creditStatus: 'charged',
        creditCost: 7,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const base = {
        actorUserId: ownerId,
        taskId,
        targetProjectId: projectId,
        parentVersionIds: ['stage-4-source-version'],
      };
      const chat = await projectAgentResultToWorkspace({
        ...base,
        workspace: 'chat',
        workspaceId: `standalone-chat:${projectId}`,
        sourceEntityId: 'chat-message-1',
        idempotencyKey: 'stage-4-result-chat',
      });
      const canvas = await projectAgentResultToWorkspace({
        ...base,
        workspace: 'canvas',
        workspaceId: `canvas:${projectId}`,
        sourceEntityId: 'canvas-image-1',
        idempotencyKey: 'stage-4-result-canvas',
      });
      const workflow = await projectAgentResultToWorkspace({
        ...base,
        workspace: 'workflow',
        workspaceId: `workflow:${projectId}`,
        sourceEntityId: 'workflow-output-1',
        idempotencyKey: 'stage-4-result-workflow',
      });

      expect(new Set([chat[0].assetVersionId, canvas[0].assetVersionId, workflow[0].assetVersionId]).size)
        .toBe(1);
      expect(new Set([chat[0].placementId, canvas[0].placementId, workflow[0].placementId]).size)
        .toBe(3);
      const lineage = await query<{ source_version_ids: string[]; lineage_mode: string }>(
        `SELECT
           ARRAY(SELECT jsonb_array_elements_text(metadata->'sourceVersionIds')) AS source_version_ids,
           metadata->>'lineageMode' AS lineage_mode
         FROM wujie_asset_versions WHERE id = $1`,
        [chat[0].assetVersionId],
      );
      expect(lineage.rows[0]).toEqual({
        source_version_ids: ['stage-4-source-version'],
        lineage_mode: 'ordered-source-metadata',
      });

      const concurrentInput = {
        ...base,
        workspace: 'workflow' as const,
        workspaceId: `workflow:${projectId}`,
        sourceEntityId: 'workflow-output-concurrent',
        idempotencyKey: 'stage-4-result-concurrent',
      };
      const concurrent = await Promise.all(
        Array.from({ length: 20 }, () => projectAgentResultToWorkspace(concurrentInput)),
      );
      expect(new Set(concurrent.map(result => result[0].placementId)).size).toBe(1);
      const concurrentCount = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM wujie_workspace_placements
         WHERE owner_id = $1 AND project_id = $2
           AND workspace_id = $3 AND entity_id = $4`,
        [ownerId, projectId, concurrentInput.workspaceId, `${concurrentInput.sourceEntityId}:0`],
      );
      expect(concurrentCount.rows[0].count).toBe(1);

      const conflictingKey = 'stage-4-result-conflicting-target';
      await projectAgentResultToWorkspace({
        ...base,
        workspace: 'chat',
        workspaceId: `standalone-chat:${projectId}`,
        sourceEntityId: 'conflicting-chat-result',
        idempotencyKey: conflictingKey,
      });
      await expect(projectAgentResultToWorkspace({
        ...base,
        workspace: 'workflow',
        workspaceId: `workflow:${projectId}`,
        sourceEntityId: 'conflicting-workflow-result',
        idempotencyKey: conflictingKey,
      })).rejects.toMatchObject({ code: 'TASK_PROJECTION_CONFLICT' });

      const switchedProjectId = 'stage-4-workspace-project-switched';
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name, status)
         VALUES ($1, $2, 'Switched project', 'active')`,
        [switchedProjectId, ownerId],
      );
      await expect(projectAgentResultToWorkspace({
        ...base,
        targetProjectId: switchedProjectId,
        workspace: 'canvas',
        workspaceId: `canvas:${switchedProjectId}`,
        sourceEntityId: 'stale-result-after-project-switch',
        idempotencyKey: 'stage-4-stale-project-result',
      })).rejects.toMatchObject({ code: 'TASK_PROJECTION_NOT_FOUND' });
      const switchedProjectFacts = await query<{ versions: number; placements: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM wujie_asset_versions WHERE project_id = $1) AS versions,
           (SELECT COUNT(*)::int FROM wujie_workspace_placements WHERE project_id = $1) AS placements`,
        [switchedProjectId],
      );
      expect(switchedProjectFacts.rows[0]).toEqual({ versions: 0, placements: 0 });

      const foreignOwnerId = 'stage-4-workspace-foreign-owner';
      const foreignProjectId = 'stage-4-workspace-foreign-project';
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name, status)
         VALUES ($1, $2, 'Foreign project', 'active')`,
        [foreignProjectId, foreignOwnerId],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ('stage-4-foreign-asset', $1, $2, 'image', 'active')`,
        [foreignOwnerId, foreignProjectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, availability
         ) VALUES (
           'stage-4-foreign-version', 'stage-4-foreign-asset', $1, $2,
           '/uploads/foreign.png', 'ready'
         )`,
        [foreignOwnerId, foreignProjectId],
      );
      await expect(projectAgentResultToWorkspace({
        ...base,
        workspace: 'workflow',
        workspaceId: `workflow:${projectId}`,
        sourceEntityId: 'cross-user-parent-result',
        parentVersionIds: ['stage-4-foreign-version'],
        idempotencyKey: 'stage-4-cross-user-parent',
      })).rejects.toMatchObject({ code: 'TASK_PROJECTION_NOT_FOUND' });
    });
  });
});

describe('Stage 4 Agent accounting on real PostgreSQL', () => {
  postgresIt('keeps one charge, at most one refund, monotonic terminal state, and no late versions', async () => {
    await withIsolatedPostgres('stage-4-agent-accounting', async ({ databaseUrl: url, query }) => {
      migrate(url);
      const { createBillableTask, settleFailedTask } = await import('@/lib/task-core/billing-service');
      const { transitionTask } = await import('@/lib/task-core/task-service');
      const { getCloudTaskById } = await import('@/lib/cloud-task-storage');
      const { projectAgentResultToWorkspace } = await import('@/lib/agent-runtime/workspace-results');
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();

      const ownerId = 'stage-4-accounting-owner';
      const projectId = 'stage-4-accounting-project';
      const now = Date.now();
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name, status)
         VALUES ($1, $2, 'Stage 4 accounting', 'active')`,
        [projectId, ownerId],
      );
      await query(
        `INSERT INTO wujie_credits(
           id, user_id, balance, total_recharged, total_used, created_at, updated_at
         ) VALUES ('stage-4-accounting-credits', $1, 1000, 1000, 0, $2, $2)`,
        [ownerId, now],
      );

      const create = (suffix: string, idempotencyKey = `stage-4-accounting-${suffix}`) => (
        createBillableTask({
          userId: ownerId,
          idempotencyKey,
          requestDigest: `stage-4-accounting-digest-${suffix}`,
          creditCost: 7,
          task: {
            id: `stage-4-accounting-task-${suffix}`,
            projectId,
            type: 'agent-run',
            status: 'processing',
            progress: 0,
            createdAt: now,
            updatedAt: now,
          },
        })
      );
      const countLedger = async (taskId: string, type: 'consume' | 'refund'): Promise<number> => {
        const result = await query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM wujie_credit_transactions
           WHERE task_id = $1 AND type = $2`,
          [taskId, type],
        );
        return result.rows[0].count;
      };
      const countVersions = async (taskId: string): Promise<number> => {
        const result = await query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM wujie_asset_versions WHERE task_id = $1',
          [taskId],
        );
        return result.rows[0].count;
      };

      const successAttempts = await Promise.all(
        Array.from({ length: 20 }, (_, index) => create(
          'success',
          'stage-4-accounting-success-key',
        ).then(result => ({ index, result }))),
      );
      const successTaskId = successAttempts[0].result.task.id;
      expect(new Set(successAttempts.map(attempt => attempt.result.task.id)).size).toBe(1);
      expect(successAttempts.filter(attempt => attempt.result.charged)).toHaveLength(1);
      await transitionTask({
        taskId: successTaskId,
        from: ['processing'],
        to: 'completed',
        result: { imageUrl: '/uploads/stage-4-accounting-success.png' },
        creditStatus: 'charged',
      });
      const successReferences = await projectAgentResultToWorkspace({
        actorUserId: ownerId,
        taskId: successTaskId,
        targetProjectId: projectId,
        workspace: 'chat',
        workspaceId: `standalone-chat:${projectId}`,
        sourceEntityId: 'stage-4-accounting-success-message',
        parentVersionIds: [],
        idempotencyKey: 'stage-4-accounting-success-placement',
      });
      expect(successReferences).toHaveLength(1);
      expect(await countLedger(successTaskId, 'consume')).toBe(1);
      expect(await countLedger(successTaskId, 'refund')).toBe(0);
      expect(await countVersions(successTaskId)).toBe(1);

      const failureCases = [
        {
          suffix: 'cancelled',
          status: 'cancelled' as const,
          code: 'AGENT_RUN_CANCELLED',
        },
        {
          suffix: 'timeout',
          status: 'timeout' as const,
          code: 'AGENT_RUN_TIMEOUT',
        },
        {
          suffix: 'provider-failed',
          status: 'failed' as const,
          code: 'AGENT_PROVIDER_FAILED',
        },
      ];

      for (const failure of failureCases) {
        const created = await create(failure.suffix);
        const taskId = created.task.id;
        const settlements = await Promise.all(
          Array.from({ length: 20 }, () => settleFailedTask({
            taskId,
            status: failure.status,
            error: {
              code: failure.code,
              message: `${failure.suffix} terminal`,
              retryable: failure.status !== 'cancelled',
            },
          })),
        );
        expect(settlements.filter(settlement => settlement.transitioned)).toHaveLength(1);
        expect(settlements.filter(settlement => settlement.refunded)).toHaveLength(1);

        clearInMemoryTaskRegistry();
        const lateCompletion = await transitionTask({
          taskId,
          from: ['processing'],
          to: 'completed',
          result: { imageUrl: `/uploads/${failure.suffix}-late.png` },
          creditStatus: 'charged',
        });
        expect(lateCompletion.transitioned).toBe(false);
        await expect(projectAgentResultToWorkspace({
          actorUserId: ownerId,
          taskId,
          targetProjectId: projectId,
          workspace: 'canvas',
          workspaceId: `canvas:${projectId}`,
          sourceEntityId: `${failure.suffix}-late-result`,
          parentVersionIds: [],
          idempotencyKey: `${failure.suffix}-late-placement`,
        })).resolves.toEqual([]);

        const durable = await getCloudTaskById(taskId);
        expect(durable?.status).toBe(failure.status);
        expect(await countLedger(taskId, 'consume')).toBe(1);
        expect(await countLedger(taskId, 'refund')).toBeLessThanOrEqual(1);
        expect(await countVersions(taskId)).toBe(0);
      }
    });
  });
});
