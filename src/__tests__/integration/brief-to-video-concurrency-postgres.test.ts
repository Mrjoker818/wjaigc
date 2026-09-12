import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

describe('Brief to video prepaid concurrency', () => {
  postgresIt('creates one video child and settles the parent exactly once under 20-way contention', async () => {
    await withIsolatedPostgres('brief_video_concurrency', async ({ databaseUrl, query }) => {
      const storage = await import('@/lib/cloud-task-storage');
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const { createBillableTask } = await import('@/lib/task-core/billing-service');
      const { withAgentExecutionFence } = await import('@/lib/agent-runtime/execution-fence');
      const {
        cancelSkillPrepaidChildren,
        createSkillPrepaidGeneration,
      } = await import('@/lib/skill-runtime/prepaid-generation');

      await ensureCoreTables();
      await storage.ensureCloudTaskTables();
      const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
      });
      expect(migration.status, migration.stderr || migration.stdout).toBe(0);

      const now = Date.now();
      await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
        VALUES ('brief-video-credits','brief-video-user',30,30,0,$1,$1)`, [now]);
      await createBillableTask({
        userId: 'brief-video-user',
        idempotencyKey: 'brief-video-parent-key',
        requestDigest: 'brief-video-parent-digest',
        creditCost: 15,
        task: {
          id: 'brief-video-run', projectId: 'brief-video-project', type: 'agent-run',
          status: 'processing', progress: 0, createdAt: now, updatedAt: now,
        },
      });
      await query(`INSERT INTO wujie_agent_execution_leases
        (task_id,owner_id,project_id,tool_id,lease_owner,generation,updated_at)
        VALUES ('brief-video-run','brief-video-user','brief-video-project','video_generate','brief-video-lease',1,$1)`, [now]);
      await query(`INSERT INTO wujie_agent_events
        (event_id,task_id,owner_id,project_id,workspace,sequence,event_type,request_digest,payload,created_at)
        VALUES ('brief-video-created','brief-video-run','brief-video-user','brief-video-project','canvas',1,
          'run.created','brief-video-parent-digest',$1::jsonb,$2)`, [JSON.stringify({
        workspaceId: 'canvas:brief-video-project',
        skill: { modelBindings: { video: { providerId: 'pear-video', modelId: 'video-model' } } },
        skillSnapshot: { steps: [{ id: 'generate-film', toolId: 'video_generate', modelRole: 'video' }] },
      }), now]);
      await query(`INSERT INTO wujie_agent_downstream_operations
        (operation_key,owner_id,project_id,task_id,tool_id,step_id,request_digest,idempotency_key,status,created_at,updated_at)
        VALUES ('brief-video-operation','brief-video-user','brief-video-project','brief-video-run','video_generate',
          'generate-film','brief-video-step-digest','brief-video-provider-key','prepared',$1,$1)`, [now]);

      const context = {
        runId: 'brief-video-run', stepId: 'generate-film', requestDigest: 'brief-video-step-digest',
        operationKey: 'brief-video-operation',
        executionFence: { runId: 'brief-video-run', leaseOwner: 'brief-video-lease', generation: 1 },
      };
      const child = {
        userId: 'brief-video-user', projectId: 'brief-video-project', sessionId: 'canvas:brief-video-project',
        type: 'video', status: 'processing' as const, progress: 0,
        providerId: 'pear-video', model: 'video-model', idempotencyKey: 'brief-video-provider-key:0',
        requestDigest: 'brief-video-child-digest',
        result: { submissionPayload: { prompt: 'approved video plan' } },
        createdAt: now, updatedAt: now,
      };

      const admissions = await Promise.all(Array.from({ length: 20 }, (_, index) => (
        createSkillPrepaidGeneration({ ...child, id: `brief-video-child-${index}` }, context, 'brief-video-provider-key')
      )));
      expect(admissions.filter(Boolean)).toHaveLength(1);
      const children = await query(`SELECT id,status,credit_cost,credit_status FROM cloud_tasks WHERE type='video'`);
      expect(children.rows).toHaveLength(1);
      expect(children.rows[0]).toMatchObject({ status: 'processing', credit_status: 'not-applicable' });
      expect(Number(children.rows[0].credit_cost)).toBe(0);
      expect((await query(`SELECT balance FROM wujie_credits WHERE user_id='brief-video-user'`)).rows[0].balance).toBe(15);
      expect((await query(`SELECT type,amount FROM wujie_credit_transactions`)).rows)
        .toEqual([{ type: 'consume', amount: -15 }]);

      const cancelled = await Promise.all(Array.from({ length: 20 }, () => (
        withAgentExecutionFence(context.executionFence, () => storage.terminateCloudTaskAndRefund(
          'brief-video-run', 'cancelled', 'user cancelled approved video',
        ))
      )));
      expect(cancelled.filter(result => result.transitioned)).toHaveLength(1);
      expect(await cancelSkillPrepaidChildren({
        actorUserId: 'brief-video-user', runId: 'brief-video-run',
      })).toEqual([children.rows[0].id]);
      expect(await storage.completeCloudTask(children.rows[0].id, {
        videoUrl: 'https://cdn.example.test/late.mp4',
      })).toBe(false);
      expect((await storage.getCloudTaskById(children.rows[0].id))?.status).toBe('cancelled');
      expect((await query(`SELECT balance FROM wujie_credits WHERE user_id='brief-video-user'`)).rows[0].balance).toBe(30);
      expect((await query(`SELECT type,amount FROM wujie_credit_transactions ORDER BY created_at`)).rows)
        .toEqual([{ type: 'consume', amount: -15 }, { type: 'refund', amount: 15 }]);
    });
  }, 120_000);
});
