import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; authoritative task billing PostgreSQL tests skipped.',
  );
}

describe('authoritative PostgreSQL task billing', () => {
  postgresIt('reuses one task and one charge across 20 concurrent submissions', async () => {
    const { withIsolatedPostgres } = await import(
      '../helpers/postgres-test-database'
    );

    await withIsolatedPostgres('task-billing-idempotency', async ({ query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const {
        createBillableTask,
        settleFailedTask,
      } = await import('@/lib/task-core/billing-service');
      const { IdempotencyConflictError } = await import(
        '@/lib/task-core/idempotency'
      );

      await ensureCoreTables();
      const now = Date.now();
      await query(
        `INSERT INTO wujie_credits (
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, $3, $3, 0, $4, $4)`,
        ['credits-user-a', 'user-a', 100, now],
      );

      const attempts = await Promise.all(
        Array.from({ length: 20 }, (_, index) => createBillableTask({
          userId: 'user-a',
          idempotencyKey: 'same-request-key',
          requestDigest: 'same-request-digest',
          creditCost: 7,
          task: {
            id: `task-attempt-${index}`,
            type: 'generate',
            status: 'processing',
            progress: 0,
            createdAt: now + index,
            updatedAt: now + index,
          },
        })),
      );

      expect(new Set(attempts.map(({ task }) => task.id)).size).toBe(1);
      expect(attempts.filter(({ reused }) => !reused)).toHaveLength(1);
      expect(attempts.filter(({ charged }) => charged)).toHaveLength(1);

      const tasks = await query<{
        id: string;
        request_digest: string;
        charged_transaction_id: string;
      }>(
        `SELECT id, request_digest, charged_transaction_id
         FROM cloud_tasks
         WHERE user_id = $1 AND idempotency_key = $2`,
        ['user-a', 'same-request-key'],
      );
      const charges = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM wujie_credit_transactions
         WHERE task_id = $1 AND type = 'consume'`,
        [tasks.rows[0]?.id],
      );
      const creditsAfterCharge = await query<{
        balance: number;
        total_used: number;
      }>(
        'SELECT balance, total_used FROM wujie_credits WHERE user_id = $1',
        ['user-a'],
      );

      expect(tasks.rows).toHaveLength(1);
      expect(tasks.rows[0]).toMatchObject({
        request_digest: 'same-request-digest',
      });
      expect(tasks.rows[0]?.charged_transaction_id).not.toBe('');
      expect(charges.rows[0]?.count).toBe('1');
      expect(creditsAfterCharge.rows[0]).toMatchObject({
        balance: 93,
        total_used: 7,
      });

      await expect(createBillableTask({
        userId: 'user-a',
        idempotencyKey: 'same-request-key',
        requestDigest: 'different-request-digest',
        creditCost: 7,
        task: {
          id: 'task-conflicting-payload',
          type: 'generate',
          status: 'processing',
          progress: 0,
          createdAt: now + 100,
          updatedAt: now + 100,
        },
      })).rejects.toMatchObject({
        name: IdempotencyConflictError.name,
        code: 'IDEMPOTENCY_CONFLICT',
        status: 409,
      });

      const winnerTaskId = tasks.rows[0]?.id;
      const settlements = await Promise.all([
        settleFailedTask({
          taskId: winnerTaskId,
          status: 'failed',
          error: { code: 'PROVIDER_FAILED', message: 'provider failed' },
        }),
        settleFailedTask({
          taskId: winnerTaskId,
          status: 'cancelled',
          error: { code: 'USER_CANCELLED', message: 'user cancelled' },
        }),
        settleFailedTask({
          taskId: winnerTaskId,
          status: 'timeout',
          error: { code: 'MODEL_TIMEOUT', message: 'provider timed out' },
        }),
      ]);

      expect(settlements.filter(({ transitioned }) => transitioned)).toHaveLength(1);
      expect(settlements.filter(({ refunded }) => refunded)).toHaveLength(1);

      const settledTask = await query<{
        status: string;
        credit_status: string;
        refunded_transaction_id: string;
      }>(
        `SELECT status, credit_status, refunded_transaction_id
         FROM cloud_tasks WHERE id = $1`,
        [winnerTaskId],
      );
      const refunds = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM wujie_credit_transactions
         WHERE task_id = $1 AND type = 'refund'`,
        [winnerTaskId],
      );
      const creditsAfterRefund = await query<{
        balance: number;
        total_used: number;
      }>(
        'SELECT balance, total_used FROM wujie_credits WHERE user_id = $1',
        ['user-a'],
      );

      expect(['failed', 'cancelled', 'timeout']).toContain(
        settledTask.rows[0]?.status,
      );
      expect(settledTask.rows[0]).toMatchObject({ credit_status: 'refunded' });
      expect(settledTask.rows[0]?.refunded_transaction_id).not.toBe('');
      expect(refunds.rows[0]?.count).toBe('1');
      expect(creditsAfterRefund.rows[0]).toMatchObject({
        balance: 100,
        total_used: 0,
      });
    });
  });
});
