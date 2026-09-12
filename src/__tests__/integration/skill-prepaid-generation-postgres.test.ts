import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

describe('Skill prepaid generation database admission', () => {
  postgresIt('admits only an exactly authorized prepaid video child', async () => {
    await withIsolatedPostgres('skill_prepaid_video', async ({ databaseUrl, query }) => {
      const storage = await import('@/lib/cloud-task-storage');
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      await storage.ensureCloudTaskTables();
      const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
        encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
      });
      expect(migration.status, migration.stderr || migration.stdout).toBe(0);
      const { createBillableTask } = await import('@/lib/task-core/billing-service');
      const {
        cancelSkillPrepaidChildren,
        createSkillPrepaidGeneration,
      } = await import('@/lib/skill-runtime/prepaid-generation');
      const now = Date.now();
      await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
        VALUES ('video-credits','video-user',30,30,0,$1,$1)`, [now]);
      await createBillableTask({
        userId: 'video-user', idempotencyKey: 'video-parent-key', requestDigest: 'video-parent-digest', creditCost: 15,
        task: { id: 'video-run', projectId: 'video-project', type: 'agent-run', status: 'processing',
          progress: 0, createdAt: now, updatedAt: now },
      });
      await query(`INSERT INTO wujie_agent_execution_leases
        (task_id,owner_id,project_id,tool_id,lease_owner,generation,updated_at)
        VALUES ('video-run','video-user','video-project','video_generate','video-lease',1,$1)`, [now]);
      await query(`INSERT INTO wujie_agent_events
        (event_id,task_id,owner_id,project_id,workspace,sequence,event_type,request_digest,payload,created_at)
        VALUES ('video-created','video-run','video-user','video-project','canvas',1,'run.created',
          'video-parent-digest',$1::jsonb,$2)`, [JSON.stringify({
        workspaceId: 'canvas:video-project',
        skill: { modelBindings: { video: { providerId: 'video-provider', modelId: 'video-model' } } },
        skillSnapshot: { steps: [{ id: 'video-step', toolId: 'video_generate', modelRole: 'video' }] },
      }), now]);
      await query(`INSERT INTO wujie_agent_downstream_operations
        (operation_key,owner_id,project_id,task_id,tool_id,step_id,request_digest,idempotency_key,status,created_at,updated_at)
        VALUES ('video-operation','video-user','video-project','video-run','video_generate','video-step',
          'video-step-digest','video-provider-key','prepared',$1,$1)`, [now]);
      const context = {
        runId: 'video-run', stepId: 'video-step', requestDigest: 'video-step-digest', operationKey: 'video-operation',
        executionFence: { runId: 'video-run', leaseOwner: 'video-lease', generation: 1 },
      };
      const child = {
        id: 'video-child', userId: 'video-user', projectId: 'video-project', sessionId: 'canvas:video-project',
        type: 'video', status: 'pending' as const, progress: 0,
        model: 'video-model', providerId: 'video-provider', idempotencyKey: 'video-provider-key:0',
        result: { submissionPayload: { prompt: 'authorized video' } }, createdAt: now, updatedAt: now,
      };

      await expect(createSkillPrepaidGeneration(
        { ...child, id: 'forbidden-child', type: 'edit' }, context, 'video-provider-key',
      )).rejects.toMatchObject({ code: 'SKILL_BILLING_NOT_AUTHORIZED' });
      await expect(createSkillPrepaidGeneration(child, context, 'video-provider-key')).resolves.toBe(true);

      const { markAgentLocalDownstreamOperationAccepted } = await import('@/lib/agent-runtime/event-storage');
      await query(`UPDATE wujie_agent_downstream_operations SET lease_owner='video-operation-lease'
        WHERE operation_key='video-operation'`);
      await expect(markAgentLocalDownstreamOperationAccepted({
        ...context,
        actorUserId: 'video-user',
        projectId: 'video-project',
        toolId: 'video_generate',
        idempotencyKey: 'video-provider-key',
        leaseOwner: 'video-operation-lease',
        providerTaskId: child.id,
      })).resolves.toMatchObject({ status: 'accepted', providerTaskId: child.id });

      const persisted = await storage.getCloudTaskForUser(child.id, child.userId);
      expect(persisted).toMatchObject({
        type: 'video', userId: 'video-user', projectId: 'video-project', providerId: 'video-provider',
        model: 'video-model', idempotencyKey: 'video-provider-key:0', creditStatus: 'not-applicable', creditCost: 0,
      });
      expect(persisted?.result?.skillBillingProvenance).toMatchObject({
        runId: 'video-run', stepId: 'video-step', operationKey: 'video-operation',
      });
      expect((await query(`SELECT balance FROM wujie_credits WHERE user_id='video-user'`)).rows[0].balance).toBe(15);
      expect((await query(`SELECT type,amount FROM wujie_credit_transactions`)).rows)
        .toEqual([{ type: 'consume', amount: -15 }]);

      const siblingBase = {
        userId: child.userId, projectId: child.projectId, sessionId: child.sessionId,
        status: 'processing' as const, progress: 10, model: child.model, providerId: child.providerId,
        creditStatus: 'not-applicable' as const, creditCost: 0,
        result: { skillBillingProvenance: { runId: context.runId } }, createdAt: now, updatedAt: now,
      };
      await storage.createCloudTask({
        ...siblingBase, id: 'image-sibling', type: 'generate-async', idempotencyKey: 'image-sibling-key',
      });
      await storage.createCloudTask({
        ...siblingBase, id: 'unrelated-sibling', type: 'edit', idempotencyKey: 'unrelated-sibling-key',
      });
      await query(`UPDATE cloud_tasks SET status='cancelled' WHERE id='video-run'`);

      expect(new Set(await cancelSkillPrepaidChildren({ actorUserId: child.userId, runId: context.runId })))
        .toEqual(new Set(['video-child', 'image-sibling']));
      expect((await storage.getCloudTaskForUser('video-child', child.userId))?.status).toBe('cancelled');
      expect((await storage.getCloudTaskForUser('image-sibling', child.userId))?.status).toBe('cancelled');
      expect((await storage.getCloudTaskForUser('unrelated-sibling', child.userId))?.status).toBe('processing');
    });
  }, 120_000);

  postgresIt.each(['complete-first', 'cancel-first', 'dispatch-first', 'cancel-before-dispatch',
    'pause-complete', 'pause-cas', 'pause-update', 'pause-race', 'pause-budget', 'dispatch-rate-limit', 'dispatch-ambiguous-429',
    'dispatch-network-error', 'dispatch-timeout-lease', 'dispatch-timeout-race'])('serializes prepaid child operations and parent cancellation (%s)', async (scenario) => {
    const completedFirst = scenario === 'complete-first';
    const downstreamToolId = completedFirst ? 'img2img' : 'generate_image';
    await withIsolatedPostgres('skill_prepaid_generation', async ({ databaseUrl, query }) => {
      const storage = await import('@/lib/cloud-task-storage');
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      await storage.ensureCloudTaskTables();
      const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
        encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
      });
      expect(migration.status, migration.stderr || migration.stdout).toBe(0);
      const { createBillableTask } = await import('@/lib/task-core/billing-service');
      const { createSkillPrepaidGeneration, inspectSkillPrepaidPoll } = await import('@/lib/skill-runtime/prepaid-generation');
      const { withAgentExecutionFence } = await import('@/lib/agent-runtime/execution-fence');
      const { markAgentLocalDownstreamOperationAccepted } = await import('@/lib/agent-runtime/event-storage');
      const now = Date.now();
      await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
        VALUES ('credits-test','user-1',84,84,0,$1,$1)`, [now]);
      await createBillableTask({
        userId: 'user-1', idempotencyKey: 'parent-key', requestDigest: 'parent-digest', creditCost: 62,
        task: { id: 'run-1', projectId: 'project-1', type: 'agent-run', status: 'processing',
          progress: 0, createdAt: now, updatedAt: now },
      });
      await query(`INSERT INTO wujie_agent_execution_leases
        (task_id,owner_id,project_id,tool_id,lease_owner,generation,updated_at)
        VALUES ('run-1','user-1','project-1',$2,'lease-1',1,$1)`, [now, downstreamToolId]);
      await query(`INSERT INTO wujie_agent_events
        (event_id,task_id,owner_id,project_id,workspace,sequence,event_type,request_digest,payload,created_at)
        VALUES ('created-1','run-1','user-1','project-1','canvas',1,'run.created','parent-digest',$1::jsonb,$2)`,
      [JSON.stringify({ workspaceId: 'canvas:project-1',
        skill: { modelBindings: { image: { providerId: 'provider-1', modelId: 'image-1' } } },
        skillSnapshot: { steps: [{ id: 'image-step', toolId: downstreamToolId, modelRole: 'image' }] },
      }), now]);
      await query(`INSERT INTO wujie_agent_downstream_operations
        (operation_key,owner_id,project_id,task_id,tool_id,step_id,request_digest,idempotency_key,status,created_at,updated_at)
        VALUES ('operation-1','user-1','project-1','run-1',$2,'image-step','step-digest',
        'provider-key','prepared',$1,$1)`, [now, downstreamToolId]);
      const context = { runId: 'run-1', stepId: 'image-step', requestDigest: 'step-digest', operationKey: 'operation-1',
        executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 } };
      const child = {
        id: 'child-1', userId: 'user-1', projectId: 'project-1', sessionId: 'canvas:project-1',
        type: 'generate-async', status: 'pending' as const, progress: 0,
        model: 'image-1', providerId: 'provider-1', idempotencyKey: 'provider-key:0',
        result: { submissionPayload: { requestDigest: 'image-digest' } }, createdAt: now, updatedAt: now,
      };
      const results = await Promise.all(Array.from({ length: 12 }, (_, index) => (
        createSkillPrepaidGeneration({ ...child, id: `child-${index}` }, context, 'provider-key')
      )));
      expect(results.filter(Boolean)).toHaveLength(1);
      const children = await query(`SELECT id, credit_cost, credit_status, result FROM cloud_tasks WHERE type='generate-async'`);
      expect(children.rows).toHaveLength(1);
      expect(Number(children.rows[0].credit_cost)).toBe(0);
      expect(children.rows[0].credit_status).toBe('not-applicable');
      expect(children.rows[0].result.skillBillingProvenance).toMatchObject({ runId: 'run-1', stepId: 'image-step' });
      expect((await query(`SELECT balance FROM wujie_credits WHERE user_id='user-1'`)).rows[0].balance).toBe(22);
      expect((await query(`SELECT type,amount FROM wujie_credit_transactions`)).rows).toEqual([{ type: 'consume', amount: -62 }]);
      await expect(createSkillPrepaidGeneration({ ...child, userId: 'other' }, context, 'provider-key'))
        .rejects.toMatchObject({ code: 'SKILL_BILLING_NOT_AUTHORIZED' });
      await expect(createSkillPrepaidGeneration({ ...child, model: 'other' }, context, 'provider-key'))
        .rejects.toMatchObject({ code: 'SKILL_BILLING_NOT_AUTHORIZED' });
      await storage.updateCloudTask(children.rows[0].id, { result: { submissionPayload: { prompt: 'persisted prompt' } } });
      expect((await storage.getCloudTaskForUser(children.rows[0].id, 'user-1'))?.result?.skillBillingProvenance)
        .toMatchObject({ runId: 'run-1', stepId: 'image-step' });
      const childTask = (await storage.getCloudTaskForUser(children.rows[0].id, 'user-1'))!;
      expect(await inspectSkillPrepaidPoll(childTask)).toMatchObject({ action: 'wait' });
      await query(`UPDATE wujie_agent_downstream_operations SET lease_owner='operation-lease-1'
        WHERE operation_key='operation-1'`);
      const acceptance = { ...context, actorUserId: 'user-1', projectId: 'project-1', toolId: downstreamToolId,
        idempotencyKey: 'provider-key', leaseOwner: 'operation-lease-1', providerTaskId: children.rows[0].id };
      await expect(markAgentLocalDownstreamOperationAccepted({ ...acceptance, providerTaskId: 'wrong-child' })).rejects.toThrow();
      await expect(markAgentLocalDownstreamOperationAccepted({ ...acceptance, actorUserId: 'wrong-owner' })).rejects.toThrow();
      await expect(markAgentLocalDownstreamOperationAccepted(acceptance)).resolves.toMatchObject({
        status: 'accepted', providerTaskId: children.rows[0].id,
      });
      await expect(markAgentLocalDownstreamOperationAccepted(acceptance)).resolves.toMatchObject({ status: 'accepted' });
      expect(await inspectSkillPrepaidPoll(childTask)).toEqual({ action: 'allow' });
      await query(`UPDATE wujie_agent_execution_leases SET paused_at=1 WHERE task_id='run-1'`);
      expect(await inspectSkillPrepaidPoll(childTask)).toMatchObject({ action: 'wait' });
      await expect(markAgentLocalDownstreamOperationAccepted(acceptance)).rejects.toThrow('execution lease');
      await query(`UPDATE wujie_agent_execution_leases SET paused_at=0 WHERE task_id='run-1'`);
      await storage.chargeCloudTaskCredits(children.rows[0].id, 'user-1', 0, 'activate prepaid child');
      if (scenario === 'pause-budget') {
        const { getSkillPrepaidSubmissionDeadline } = await import('@/lib/skill-runtime/prepaid-generation');
        await query(`UPDATE cloud_tasks SET created_at=$2 WHERE id=$1`, [children.rows[0].id, now - 1_200_000]);
        for (const [sequence, eventType, time] of [[2, 'run.paused', now - 1_140_000], [3, 'run.resumed', now - 60_000]] as const) {
          await query(`INSERT INTO wujie_agent_events
            (event_id,task_id,owner_id,project_id,workspace,sequence,event_type,request_digest,payload,created_at)
            VALUES ($1,'run-1','user-1','project-1','canvas',$2,$3,'parent-digest','{}'::jsonb,$4)`,
          [`budget-${sequence}`, sequence, eventType, time]);
        }
        const aged = (await storage.getCloudTaskForUser(children.rows[0].id, 'user-1'))!;
        expect(await getSkillPrepaidSubmissionDeadline(aged, now))
          .toEqual({ expired: false, deadlineAt: now + 480_000, remainingMs: 480_000 });
        expect(await getSkillPrepaidSubmissionDeadline(aged, now + 480_001)).toMatchObject({ expired: true });
        expect((await query(`SELECT type,amount FROM wujie_credit_transactions`)).rows)
          .toEqual([{ type: 'consume', amount: -62 }]);
        return;
      }
      if (scenario.startsWith('pause-')) {
        const { getPool } = await import('@/lib/db-client');
        const pauseConnection = scenario === 'pause-race' ? await getPool().connect() : undefined;
        if (pauseConnection) await pauseConnection.query('BEGIN');
        const pauseSql = `UPDATE wujie_agent_execution_leases SET paused_at=1,lease_owner='' WHERE task_id='run-1'`;
        if (pauseConnection) await pauseConnection.query(pauseSql);
        else await query(pauseSql);
        const result = { imageUrl: 'https://example.test/deferred.png' };
        const snapshot = (await storage.getCloudTaskById(children.rows[0].id))!;
        const completing = scenario === 'pause-complete' || scenario === 'pause-race'
          ? storage.completeCloudTask(snapshot.id, result)
          : scenario === 'pause-cas'
            ? storage.transitionCloudTaskStatus({ taskId: snapshot.id, from: ['processing'], to: 'completed',
              revision: snapshot.revision, result }).then(value => value.transitioned)
            : storage.updateCloudTask(snapshot.id, { status: 'completed', result });
        if (pauseConnection) {
          try {
            await vi.waitFor(async () => {
              const waiting = await query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
                AND wait_event_type='Lock' AND query LIKE '%prepaid_parent_completion%'`);
              expect(waiting.rows.length).toBeGreaterThan(0);
            }, { timeout: 5000 });
            await pauseConnection.query('COMMIT');
          } finally {
            await pauseConnection.query('ROLLBACK');
            pauseConnection.release();
          }
        }
        const completed = await completing;
        expect(completed).toBe(false);
        const deferred = (await storage.getCloudTaskForUser(snapshot.id, 'user-1'))!;
        expect(deferred.status).toBe('processing');
        expect(deferred.result?.imageUrl).toBeUndefined();
        expect(deferred.result?.skillDeferredCompletion).toMatchObject({ result });
        expect(await storage.completeCloudTask(snapshot.id, { imageUrl: 'https://example.test/duplicate.png' })).toBe(false);
        await storage.updateCloudTask(snapshot.id, { progress: 80, result: { label: 'paused progress' } });
        expect((await storage.getCloudTaskById(snapshot.id))?.result?.skillDeferredCompletion).toMatchObject({ result });
        await query(`UPDATE wujie_agent_execution_leases SET paused_at=0,lease_owner='lease-2',generation=2 WHERE task_id='run-1'`);
        expect(await inspectSkillPrepaidPoll(deferred)).toEqual({ action: 'allow' });
        expect(await storage.completeCloudTask(snapshot.id, { imageUrl: 'https://example.test/overwrite.png' })).toBe(true);
        const finished = (await storage.getCloudTaskById(snapshot.id))!;
        expect(finished.status).toBe('completed');
        expect(finished.result?.imageUrl).toBe(result.imageUrl);
        expect(finished.result?.skillDeferredCompletion).toBeUndefined();
        expect((await query(`SELECT balance FROM wujie_credits WHERE user_id='user-1'`)).rows[0].balance).toBe(22);
        expect((await query(`SELECT type FROM wujie_credit_transactions`)).rows).toEqual([{ type: 'consume' }]);
        return;
      }
      if (scenario.startsWith('dispatch-') || scenario === 'cancel-before-dispatch') {
        const { startSkillPrepaidProviderRequest } = await import('@/lib/skill-runtime/prepaid-generation');
        await query(`UPDATE cloud_tasks SET lease_owner='dispatch-worker', lease_expires_at=$2, attempt_count=1 WHERE id=$1`,
          [children.rows[0].id, Date.now() + 60_000]);
        const dispatchInput = { taskId: children.rows[0].id, userId: 'user-1', workerId: 'dispatch-worker',
          attemptCount: 1, parentGeneration: 1, providerId: 'provider-1', modelId: 'image-1',
          requestBody: { prompt: 'persisted prompt' } };
        if (scenario.startsWith('dispatch-timeout-')) {
          const { getPool } = await import('@/lib/db-client');
          const writer = scenario === 'dispatch-timeout-race' ? await getPool().connect() : undefined;
          if (writer) {
            await query(`UPDATE cloud_tasks SET lease_expires_at=1 WHERE id=$1`, [dispatchInput.taskId]);
            await writer.query('BEGIN');
            await writer.query(`UPDATE cloud_tasks SET result=result || '{"skillProviderDispatch":{"token":"racing-dispatch"}}'::jsonb WHERE id=$1`, [dispatchInput.taskId]);
          }
          const terminating = storage.terminateCloudTaskAndRefund(dispatchInput.taskId, 'timeout', 'stale recovery deadline',
            undefined, { requireUnsubmittedPrepaid: true });
          if (writer) {
            try {
              await vi.waitFor(async () => {
                const waiting = await query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
                  AND wait_event_type='Lock' AND query LIKE '%WITH candidate AS%'`);
                expect(waiting.rows.length).toBeGreaterThan(0);
              }, { timeout: 5000 });
              await writer.query('COMMIT');
            } finally {
              await writer.query('ROLLBACK');
              writer.release();
            }
          }
          expect(await terminating).toMatchObject({ transitioned: false, refunded: false });
          expect((await storage.getCloudTaskById(dispatchInput.taskId))?.status).toBe('processing');
          expect(await storage.completeCloudTask(dispatchInput.taskId, { imageUrl: 'https://example.test/late-success.png' })).toBe(true);
          const idle = { ...child, id: 'idle-prepaid', status: 'processing' as const,
            idempotencyKey: 'idle-prepaid-key',
            result: { skillBillingProvenance: { runId: 'run-1' } } };
          await storage.createCloudTask(idle);
          expect(await storage.terminateCloudTaskAndRefund(idle.id, 'timeout', 'never submitted',
            undefined, { requireUnsubmittedPrepaid: true })).toMatchObject({ transitioned: true, status: 'timeout', refunded: false });
          expect((await query(`SELECT type,amount FROM wujie_credit_transactions`)).rows)
            .toEqual([{ type: 'consume', amount: -62 }]);
          return;
        }
        if (['dispatch-rate-limit', 'dispatch-ambiguous-429', 'dispatch-network-error'].includes(scenario)) {
          const rateLimited = scenario === 'dispatch-rate-limit';
          const response = new Response(JSON.stringify({
            error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Too many requests' },
            ...(rateLimited ? {} : { task_id: 'already-accepted-remote-task' }),
          }), { status: 429, headers: { 'content-type': 'application/json' } });
          const send = vi.fn(() => scenario === 'dispatch-network-error'
            ? Promise.reject(new Error('connection reset after submission')) : Promise.resolve(response));
          const first = startSkillPrepaidProviderRequest(dispatchInput, send);
          if (scenario === 'dispatch-network-error') await expect(first).rejects.toThrow('connection reset');
          else expect(await (await first).json()).toHaveProperty('error.code', 'rate_limit_exceeded');
          const persisted = (await storage.getCloudTaskById(dispatchInput.taskId))!;
          if (rateLimited) {
            expect(persisted.result?.skillProviderDispatch).toBeUndefined();
            send.mockImplementation(() => Promise.resolve(new Response('{"task_id":"accepted-on-retry"}')));
            await expect(startSkillPrepaidProviderRequest(dispatchInput, send)).resolves.toBeInstanceOf(Response);
            expect(send).toHaveBeenCalledTimes(2);
            expect((await storage.getCloudTaskById(dispatchInput.taskId))?.result?.skillProviderDispatch).toBeDefined();
          } else {
            expect(persisted.result?.skillProviderDispatch).toBeDefined();
            await expect(startSkillPrepaidProviderRequest(dispatchInput, send))
              .rejects.toMatchObject({ code: 'SKILL_SUBMISSION_ALREADY_CLAIMED' });
            expect(send).toHaveBeenCalledTimes(1);
            const { reconcileSkillPrepaidDispatch } = await import('@/lib/skill-runtime/prepaid-generation');
            const snapshot = (await storage.getCloudTaskForUser(dispatchInput.taskId, 'user-1'))!;
            expect(await reconcileSkillPrepaidDispatch(snapshot, 'request-live')).toBe(false);
            await query(`UPDATE cloud_tasks SET lease_expires_at=1 WHERE id=$1`, [snapshot.id]);
            expect(await reconcileSkillPrepaidDispatch({ ...snapshot, userId: 'wrong-user' }, 'request-other')).toBe(false);
            expect(await reconcileSkillPrepaidDispatch(snapshot, 'request-orphan')).toBe(true);
            const orphan = (await storage.getCloudTaskForUser(snapshot.id, 'user-1'))!;
            expect(orphan.status).toBe('processing');
            expect(orphan.result?.taskError).toMatchObject({ code: 'SKILL_SUBMISSION_UNKNOWN', retryable: false });
            await storage.updateCloudTask(snapshot.id, { remoteTaskId: 'late-known-task' });
            expect(await reconcileSkillPrepaidDispatch(snapshot, 'request-late')).toBe(false);
          }
          expect((await query(`SELECT type,amount FROM wujie_credit_transactions`)).rows)
            .toEqual([{ type: 'consume', amount: -62 }]);
          expect((await query(`SELECT balance FROM wujie_credits WHERE user_id='user-1'`)).rows[0].balance).toBe(22);
          return;
        }
        const cancel = () => withAgentExecutionFence(context.executionFence,
          () => storage.terminateCloudTaskAndRefund('run-1', 'cancelled', 'dispatch race'));
        const send = vi.fn(() => Promise.resolve(new Response('{}')));
        if (scenario === 'cancel-before-dispatch') {
          await cancel();
          await expect(startSkillPrepaidProviderRequest(dispatchInput, send)).rejects.toMatchObject({ code: 'SKILL_PARENT_CANCELLED' });
          expect(send).not.toHaveBeenCalled();
        } else {
          await expect(startSkillPrepaidProviderRequest({ ...dispatchInput, parentGeneration: 0 }, send)).rejects.toThrow();
          expect(send).not.toHaveBeenCalled();
          let markStarted!: () => void;
          const started = new Promise<void>(resolve => { markStarted = resolve; });
          let finishResponse!: (response: Response) => void;
          const response = new Promise<Response>(resolve => { finishResponse = resolve; });
          send.mockImplementation(() => { markStarted(); return response; });
          const inFlight = startSkillPrepaidProviderRequest(dispatchInput, send);
          await started;
          await expect(startSkillPrepaidProviderRequest(dispatchInput, send)).rejects.toMatchObject({ code: 'SKILL_SUBMISSION_ALREADY_CLAIMED' });
          const cancelled = await cancel();
          expect(cancelled.transitioned).toBe(true);
          finishResponse(new Response('{}'));
          await expect(inFlight).resolves.toBeInstanceOf(Response);
          expect(send).toHaveBeenCalledTimes(1);
        }
        expect((await query(`SELECT balance FROM wujie_credits WHERE user_id='user-1'`)).rows[0].balance).toBe(84);
        return;
      }
      if (completedFirst) {
        expect(await storage.completeCloudTask(children.rows[0].id, { imageUrl: 'https://example.test/on-time.png' })).toBe(true);
      }
      await withAgentExecutionFence(context.executionFence, async () => {
        await Promise.all(Array.from({ length: 4 }, () => storage.terminateCloudTaskAndRefund('run-1', 'cancelled', 'test cancellation')));
      });
      await expect(createSkillPrepaidGeneration(child, context, 'provider-key'))
        .rejects.toMatchObject({ code: 'SKILL_BILLING_NOT_AUTHORIZED' });
      await expect(markAgentLocalDownstreamOperationAccepted(acceptance)).rejects.toThrow('parent');
      expect(await inspectSkillPrepaidPoll(childTask)).toMatchObject({ action: 'stop', status: 'cancelled' });
      expect(await storage.completeCloudTask(children.rows[0].id, { imageUrl: 'https://example.test/late.png' })).toBe(false);
      const latestChild = await storage.getCloudTaskById(children.rows[0].id);
      expect((await storage.transitionCloudTaskStatus({
        taskId: children.rows[0].id, from: ['processing'], to: 'completed',
        revision: latestChild!.revision, result: { imageUrl: 'https://example.test/late-cas.png' },
      })).transitioned).toBe(false);
      expect(await storage.updateCloudTask(children.rows[0].id, {
        status: 'completed', result: { imageUrl: 'https://example.test/late-update.png' },
      })).toBe(false);
      expect((await storage.getCloudTaskById(children.rows[0].id))?.result?.imageUrl)
        .toBe(completedFirst ? 'https://example.test/on-time.png' : undefined);
      expect((await query(`SELECT balance FROM wujie_credits WHERE user_id='user-1'`)).rows[0].balance).toBe(84);
      expect((await query(`SELECT type,amount FROM wujie_credit_transactions ORDER BY amount`)).rows)
        .toEqual([{ type: 'consume', amount: -62 }, { type: 'refund', amount: 62 }]);
    });
  }, 120_000);
});
