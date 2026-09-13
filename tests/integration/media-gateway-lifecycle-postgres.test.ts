import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn('BLOCKED: media gateway lifecycle requires POSTGRES_TEST_DATABASE_URL');
}

async function prepareGatewaySchema(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): Promise<void> {
  await query('CREATE TABLE wujie_users (id TEXT PRIMARY KEY)');
  const migration = await readFile('migrations/20260913_v588_media_gateway.sql', 'utf8');
  await query(migration);
}

describe('media gateway lifecycle on PostgreSQL', () => {
  postgresIt('admits 20 identical requests into one charged authoritative task and one gateway row', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('gateway-full-lifecycle', async ({ query }) => {
      await prepareGatewaySchema(query);
      await query("INSERT INTO wujie_users (id) VALUES ('gateway-user')");

      const { issueGatewayKey, authenticateGatewayBearer } = await import('@/lib/media-gateway/key-service');
      const issued = await issueGatewayKey({
        userId: 'gateway-user', label: 'Task 8', requestsPerMinute: 100, dailyQuota: 100, createdBy: 'admin',
      });
      const principal = await authenticateGatewayBearer(`Bearer ${issued.secret}`);
      const { recordGatewayAttempt, reserveGatewayRequest, markGatewayAdmitted } = await import('@/lib/media-gateway/admission');
      const { digestGatewayRequest } = await import('@/lib/media-gateway/schema');
      const { createBillableTask } = await import('@/lib/task-core/billing-service');
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const privatePrompt = 'private prompt task8';
      const privateReference = '/api/serve-upload/private-reference-task8.png';
      const requestDigest = digestGatewayRequest({
        prompt: privatePrompt,
        providerId: 'pear',
        modelId: 'image-model',
        referenceImages: [privateReference],
      });
      const now = Date.now();
      await ensureCoreTables();
      await query(`INSERT INTO wujie_credits
        (id, user_id, balance, total_recharged, total_used, created_at, updated_at)
        VALUES ('credits_gateway_user', 'gateway-user', 100, 100, 0, $1, $1)`, [now]);
      const attempts = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
        const attemptPermit = await recordGatewayAttempt(principal);
        const decision = await reserveGatewayRequest({
          principal,
          idempotencyKey: 'task-8-identical',
          requestDigest,
          mediaType: 'image',
          attemptPermit,
        });
        if (decision.kind === 'reuse') return { decision, taskId: null };

        const task = await createBillableTask({
          userId: 'gateway-user',
          idempotencyKey: decision.request.id,
          requestDigest,
          creditCost: 15,
          task: {
            id: `gateway-task-8-${index}`, type: 'generate', status: 'processing', progress: 10,
            createdAt: now + index, updatedAt: now + index,
          },
        });
        await markGatewayAdmitted({ gatewayRequestId: decision.request.id, taskIds: [task.task.id] });
        return { decision, taskId: task.task.id };
      }));

      expect(attempts.filter(({ decision }) => decision.kind === 'execute')).toHaveLength(1);
      expect(attempts.filter(({ decision }) => decision.kind === 'reuse')).toHaveLength(19);
      const winner = attempts.find(attempt => attempt.taskId !== null);
      expect(winner?.taskId).toMatch(/^gateway-task-8-/);
      const gatewayRequestId = winner?.decision.request.id;
      const winnerTaskId = winner?.taskId;

      const counts = await query<{
        gateway_requests: string; cloud_tasks: string; charges: string;
      }>(`SELECT
        (SELECT COUNT(*)::text FROM wujie_gateway_requests) AS gateway_requests,
        (SELECT COUNT(*)::text FROM cloud_tasks WHERE user_id = 'gateway-user') AS cloud_tasks,
        (SELECT COUNT(*)::text FROM wujie_credit_transactions WHERE task_id = $1 AND type = 'consume') AS charges`,
      [winnerTaskId]);
      expect(counts.rows[0]).toEqual({ gateway_requests: '1', cloud_tasks: '1', charges: '1' });

      const replays = await Promise.all(Array.from({ length: 20 }, async () => {
        const attemptPermit = await recordGatewayAttempt(principal);
        return reserveGatewayRequest({
          principal, idempotencyKey: 'task-8-identical', requestDigest,
          mediaType: 'image', attemptPermit,
        });
      }));
      expect(replays.every(decision => decision.kind === 'reuse'
        && decision.request.id === gatewayRequestId
        && decision.request.taskIds[0] === winnerTaskId)).toBe(true);

      const persisted = JSON.stringify({
        keys: await query('SELECT * FROM wujie_gateway_keys'),
        requests: await query('SELECT * FROM wujie_gateway_requests'),
        tasks: await query('SELECT * FROM cloud_tasks'),
        ledger: await query('SELECT * FROM wujie_credit_transactions'),
      });
      for (const privateValue of [issued.secret, `Bearer ${issued.secret}`, privatePrompt, privateReference]) {
        expect(persisted).not.toContain(privateValue);
      }
    });
  }, 45_000);

  postgresIt('isolates users and rejects digest conflicts, revoked keys, and cross-user task ids', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('gateway-user-isolation', async ({ query }) => {
      await prepareGatewaySchema(query);
      await query("INSERT INTO wujie_users (id) VALUES ('user-a'), ('user-b')");
      const { issueGatewayKey, authenticateGatewayBearer, revokeGatewayKey } = await import('@/lib/media-gateway/key-service');
      const keyA = await issueGatewayKey({ userId: 'user-a', label: 'A', requestsPerMinute: 20, dailyQuota: 20, createdBy: 'admin' });
      const keyB = await issueGatewayKey({ userId: 'user-b', label: 'B', requestsPerMinute: 20, dailyQuota: 20, createdBy: 'admin' });
      const principalA = await authenticateGatewayBearer(`Bearer ${keyA.secret}`);
      const principalB = await authenticateGatewayBearer(`Bearer ${keyB.secret}`);
      const { recordGatewayAttempt, reserveGatewayRequest } = await import('@/lib/media-gateway/admission');
      const permitA = await recordGatewayAttempt(principalA);
      await reserveGatewayRequest({
        principal: principalA, idempotencyKey: 'shared-key', requestDigest: 'a'.repeat(64), mediaType: 'image', attemptPermit: permitA,
      });
      await expect(reserveGatewayRequest({
        principal: principalA, idempotencyKey: 'shared-key', requestDigest: 'b'.repeat(64), mediaType: 'image',
        attemptPermit: await recordGatewayAttempt(principalA),
      })).rejects.toMatchObject({ code: 'GATEWAY_IDEMPOTENCY_CONFLICT', status: 409 });
      await expect(reserveGatewayRequest({
        principal: principalB, idempotencyKey: 'shared-key', requestDigest: 'a'.repeat(64), mediaType: 'image',
        attemptPermit: await recordGatewayAttempt(principalB),
      })).resolves.toMatchObject({ kind: 'execute' });

      const now = Date.now();
      const { createBillableTask } = await import('@/lib/task-core/billing-service');
      await createBillableTask({
        userId: 'user-a', idempotencyKey: 'owned-task', requestDigest: 'owned-digest', creditCost: 0,
        task: { id: 'owned-task', type: 'generate', status: 'processing', progress: 0, createdAt: now, updatedAt: now },
      });
      const { getGatewayTaskProjection } = await import('@/lib/media-gateway/task-projection');
      await expect(getGatewayTaskProjection(principalB, 'owned-task')).rejects.toMatchObject({
        code: 'GATEWAY_TASK_NOT_FOUND', status: 404,
      });

      await revokeGatewayKey(keyA.key.id);
      await expect(authenticateGatewayBearer(`Bearer ${keyA.secret}`)).rejects.toMatchObject({
        code: 'GATEWAY_KEY_INVALID', status: 401,
      });
      await expect(authenticateGatewayBearer(`Bearer wmg_${'z'.repeat(43)}`)).rejects.toMatchObject({
        code: 'GATEWAY_KEY_INVALID', status: 401,
      });
    });
  }, 45_000);

  postgresIt('records provider submission and rejects a controlled late completion after cancellation', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('gateway-terminal-race', async ({ query }) => {
      const now = Date.now();
      const { createBillableTask, settleFailedTask } = await import('@/lib/task-core/billing-service');
      await createBillableTask({
        userId: 'race-user', idempotencyKey: 'race-task', requestDigest: 'race-digest', creditCost: 0,
        task: { id: 'bootstrap-task', type: 'generate', status: 'processing', progress: 0, createdAt: now, updatedAt: now },
      });
      await query(`INSERT INTO wujie_credits
        (id, user_id, balance, total_recharged, total_used, created_at, updated_at)
        VALUES ('credits_race_user', 'race-user', 50, 50, 0, $1, $1)`, [now]);
      const charged = await createBillableTask({
        userId: 'race-user', idempotencyKey: 'charged-race-task', requestDigest: 'charged-race-digest', creditCost: 15,
        task: { id: 'charged-race-task', type: 'generate', status: 'processing', progress: 20, createdAt: now + 1, updatedAt: now + 1 },
      });

      const { updateCloudTask } = await import('@/lib/cloud-task-storage');
      await expect(updateCloudTask(charged.task.id, {
        remoteTaskId: 'provider-task-before-cancel',
      })).resolves.toBe(true);
      const { waitForProviderSubmissionState, attemptControlledLateCompletionWriteback } = await import('../helpers/media-gateway-late-writeback');
      const providerStateBeforeCancel = await waitForProviderSubmissionState(charged.task.id);
      expect(providerStateBeforeCancel).toMatchObject({
        taskId: charged.task.id,
        remoteTaskId: 'provider-task-before-cancel',
        status: 'processing',
      });

      const cancellation = await settleFailedTask({
        taskId: charged.task.id,
        status: 'cancelled',
        error: { code: 'USER_CANCELLED', message: 'user cancelled' },
      });
      expect(cancellation).toEqual({ transitioned: true, refunded: true });

      const lateBoundary = await attemptControlledLateCompletionWriteback(
        charged.task.id,
        providerStateBeforeCancel,
      );
      expect(lateBoundary).toMatchObject({
        providerStateBeforeCancel: {
          remoteTaskId: 'provider-task-before-cancel',
          status: 'processing',
        },
        providerStateAfterCancel: {
          remoteTaskId: 'provider-task-before-cancel',
          status: 'cancelled',
        },
        completionWritebackAttempt: {
          providerRemoteTaskId: 'provider-task-before-cancel',
          accepted: false,
        },
        authoritativeDatabaseStatus: {
          beforeWriteback: 'cancelled',
          afterWriteback: 'cancelled',
        },
      });
      const repeats = await Promise.all(Array.from({ length: 20 }, () => settleFailedTask({
        taskId: charged.task.id, status: 'cancelled', error: { code: 'USER_CANCELLED', message: 'repeat' },
      })));
      expect(repeats.some(result => result.transitioned || result.refunded)).toBe(false);

      const row = await query<{ status: string; credit_status: string; refunds: string; balance: number; total_used: number }>(`SELECT
        task.status, task.credit_status,
        (SELECT COUNT(*)::text FROM wujie_credit_transactions WHERE task_id = task.id AND type = 'refund') AS refunds,
        credits.balance, credits.total_used
        FROM cloud_tasks task JOIN wujie_credits credits ON credits.user_id = task.user_id
        WHERE task.id = $1`, [charged.task.id]);
      expect(row.rows[0]).toMatchObject({ status: 'cancelled', credit_status: 'refunded', refunds: '1', balance: 50, total_used: 0 });
    });
  }, 45_000);

  postgresIt('permits completion only from processing and rejects every other durable status', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('gateway-completion-sources', async () => {
      const { createBillableTask } = await import('@/lib/task-core/billing-service');
      const { completeCloudTask } = await import('@/lib/cloud-task-storage');
      const statuses = [
        'created', 'queued', 'submitting', 'processing', 'uploading',
        'completed', 'failed', 'cancelled', 'timeout',
      ] as const;
      const now = Date.now();
      for (const [index, status] of statuses.entries()) {
        await createBillableTask({
          userId: 'completion-user',
          idempotencyKey: `completion-${status}`,
          requestDigest: `digest-${status}`,
          creditCost: 0,
          task: {
            id: `completion-${status}`, type: 'generate', status, progress: 0,
            createdAt: now + index, updatedAt: now + index,
          },
        });
      }

      for (const status of statuses) {
        await expect(completeCloudTask(
          `completion-${status}`,
          { imageUrl: `/uploads/${status}.png` },
        )).resolves.toBe(status === 'processing');
      }
    });
  }, 45_000);

  postgresIt('fails closed when the database is unavailable', async () => {
    const { closePool } = await import('@/lib/db-client');
    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/gateway/v1/tasks/[taskId]/route');
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousPgDatabaseUrl = process.env.PGDATABASE_URL;
    const previousGatewayEnabled = process.env.GATEWAY_ENABLED;
    await closePool();
    process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/unavailable?connect_timeout=1';
    process.env.PGDATABASE_URL = process.env.DATABASE_URL;
    process.env.GATEWAY_ENABLED = 'true';
    try {
      const secret = `wmg_${'x'.repeat(43)}`;
      const response = await GET(new NextRequest('http://localhost/api/gateway/v1/tasks/private-task', {
        headers: { authorization: `Bearer ${secret}`, 'x-request-id': 'req_task8_db_failure' },
      }), { params: Promise.resolve({ taskId: 'private-task' }) });
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toEqual({
        success: false,
        code: 'GATEWAY_INTERNAL_UNAVAILABLE',
        message: 'Media gateway is unavailable',
        requestId: 'req_task8_db_failure',
        retryable: true,
      });
      expect(JSON.stringify(body)).not.toContain(secret);
      expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    } finally {
      await closePool();
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousPgDatabaseUrl === undefined) delete process.env.PGDATABASE_URL;
      else process.env.PGDATABASE_URL = previousPgDatabaseUrl;
      if (previousGatewayEnabled === undefined) delete process.env.GATEWAY_ENABLED;
      else process.env.GATEWAY_ENABLED = previousGatewayEnabled;
    }
  }, 15_000);
});
