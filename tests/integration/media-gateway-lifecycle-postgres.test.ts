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
      const permits = await Promise.all(Array.from({ length: 20 }, () => recordGatewayAttempt(principal)));
      const decisions = await Promise.all(permits.map(attemptPermit => reserveGatewayRequest({
        principal,
        idempotencyKey: 'task-8-identical',
        requestDigest: 'a'.repeat(64),
        mediaType: 'image',
        attemptPermit,
      })));

      expect(decisions.filter(decision => decision.kind === 'execute')).toHaveLength(1);
      expect(decisions.filter(decision => decision.kind === 'reuse')).toHaveLength(19);
      const gatewayRequestId = decisions[0].request.id;

      const now = Date.now();
      const { createBillableTask } = await import('@/lib/task-core/billing-service');
      const { ensureCoreTables } = await import('@/lib/db-storage');
      await ensureCoreTables();
      await query(`INSERT INTO wujie_credits
        (id, user_id, balance, total_recharged, total_used, created_at, updated_at)
        VALUES ('credits_gateway_user', 'gateway-user', 100, 100, 0, $1, $1)`, [now]);
      const task = await createBillableTask({
        userId: 'gateway-user',
        idempotencyKey: gatewayRequestId,
        requestDigest: 'a'.repeat(64),
        creditCost: 15,
        task: {
          id: 'gateway-task-8', type: 'generate', status: 'processing', progress: 10,
          createdAt: now, updatedAt: now,
        },
      });
      await markGatewayAdmitted({ gatewayRequestId, taskIds: [task.task.id] });

      const counts = await query<{
        gateway_requests: string; cloud_tasks: string; charges: string;
      }>(`SELECT
        (SELECT COUNT(*)::text FROM wujie_gateway_requests) AS gateway_requests,
        (SELECT COUNT(*)::text FROM cloud_tasks WHERE user_id = 'gateway-user') AS cloud_tasks,
        (SELECT COUNT(*)::text FROM wujie_credit_transactions WHERE task_id = 'gateway-task-8' AND type = 'consume') AS charges`);
      expect(counts.rows[0]).toEqual({ gateway_requests: '1', cloud_tasks: '1', charges: '1' });

      const replays = await Promise.all(Array.from({ length: 20 }, async () => {
        const attemptPermit = await recordGatewayAttempt(principal);
        return reserveGatewayRequest({
          principal, idempotencyKey: 'task-8-identical', requestDigest: 'a'.repeat(64),
          mediaType: 'image', attemptPermit,
        });
      }));
      expect(replays.every(decision => decision.kind === 'reuse'
        && decision.request.taskIds[0] === 'gateway-task-8')).toBe(true);

      expect(JSON.stringify(await query('SELECT * FROM wujie_gateway_keys'))).not.toContain(issued.secret);
      expect(JSON.stringify(await query('SELECT * FROM wujie_gateway_requests'))).not.toContain('private prompt');
      expect(JSON.stringify(await query('SELECT * FROM cloud_tasks'))).not.toContain('private-reference');
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
      await expect(authenticateGatewayBearer('Bearer wmg_wrong')).rejects.toMatchObject({
        code: 'GATEWAY_KEY_INVALID', status: 401,
      });
    });
  }, 45_000);

  postgresIt('allows one failure terminal and one refund while rejecting a late completion', async () => {
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

      const settlements = await Promise.all([
        settleFailedTask({ taskId: charged.task.id, status: 'failed', error: { code: 'PROVIDER_FAILED', message: 'provider failed' } }),
        settleFailedTask({ taskId: charged.task.id, status: 'timeout', error: { code: 'MODEL_TIMEOUT', message: 'provider timed out' } }),
        settleFailedTask({ taskId: charged.task.id, status: 'cancelled', error: { code: 'USER_CANCELLED', message: 'user cancelled' } }),
      ]);
      expect(settlements.filter(result => result.transitioned)).toHaveLength(1);
      expect(settlements.filter(result => result.refunded)).toHaveLength(1);

      const { completeCloudTask } = await import('@/lib/cloud-task-storage');
      await expect(completeCloudTask(charged.task.id, { imageUrl: '/uploads/late.png' })).resolves.toBe(false);
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
      expect(['failed', 'timeout', 'cancelled']).toContain(row.rows[0]?.status);
      expect(row.rows[0]).toMatchObject({ credit_status: 'refunded', refunds: '1', balance: 50, total_used: 0 });
    });
  }, 45_000);

  postgresIt('fails closed when the database is unavailable', async () => {
    const { closePool } = await import('@/lib/db-client');
    const { authenticateGatewayBearer } = await import('@/lib/media-gateway/key-service');
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousPgDatabaseUrl = process.env.PGDATABASE_URL;
    await closePool();
    process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/unavailable?connect_timeout=1';
    process.env.PGDATABASE_URL = process.env.DATABASE_URL;
    try {
      const secret = `wmg_${'x'.repeat(43)}`;
      const error = await authenticateGatewayBearer(`Bearer ${secret}`).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).not.toContain(secret);
    } finally {
      await closePool();
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousPgDatabaseUrl === undefined) delete process.env.PGDATABASE_URL;
      else process.env.PGDATABASE_URL = previousPgDatabaseUrl;
    }
  }, 15_000);
});
