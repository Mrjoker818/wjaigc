import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; authoritative task billing PostgreSQL tests skipped.',
  );
}

describe('authoritative PostgreSQL task billing', () => {
  postgresIt('enforces atomic idempotency and billing rollback boundaries', async () => {
    const { withIsolatedPostgres } = await import(
      '../helpers/postgres-test-database'
    );

    await withIsolatedPostgres('task-billing-idempotency', async ({ query }) => {
      const {
        createBillableTask,
        settleFailedTask,
      } = await import('@/lib/task-core/billing-service');
      const { IdempotencyConflictError } = await import(
        '@/lib/task-core/idempotency'
      );

      const now = Date.now();
      const coldStartAttempts = await Promise.all(
        Array.from({ length: 20 }, (_, index) => createBillableTask({
          userId: 'cold-start-user',
          idempotencyKey: 'cold-start-key',
          requestDigest: 'cold-start-digest',
          creditCost: 0,
          task: {
            id: `cold-start-task-${index}`,
            type: 'generate',
            status: 'processing',
            progress: 0,
            createdAt: now + index,
            updatedAt: now + index,
          },
        })),
      );

      expect(new Set(coldStartAttempts.map(({ task }) => task.id)).size).toBe(1);
      expect(coldStartAttempts.filter(({ reused }) => !reused)).toHaveLength(1);
      expect(coldStartAttempts.some(({ charged }) => charged)).toBe(false);

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

      await query(
        `INSERT INTO wujie_credits (
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, $3, $3, 0, $4, $4)`,
        ['credits-insufficient', 'insufficient-user', 2, now],
      );
      await expect(createBillableTask({
        userId: 'insufficient-user',
        idempotencyKey: 'insufficient-key',
        requestDigest: 'insufficient-digest',
        creditCost: 7,
        task: {
          id: 'insufficient-task',
          type: 'generate',
          status: 'processing',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        },
      })).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
      const insufficientState = await query<{
        balance: number;
        total_used: number;
        tasks: string;
        transactions: string;
      }>(
        `SELECT credits.balance,
                credits.total_used,
                (SELECT COUNT(*)::text FROM cloud_tasks WHERE id = $2) AS tasks,
                (SELECT COUNT(*)::text
                 FROM wujie_credit_transactions WHERE task_id = $2) AS transactions
         FROM wujie_credits credits
         WHERE credits.user_id = $1`,
        ['insufficient-user', 'insufficient-task'],
      );
      expect(insufficientState.rows[0]).toMatchObject({
        balance: 2,
        total_used: 0,
        tasks: '0',
        transactions: '0',
      });

      await query(
        `INSERT INTO wujie_credits (
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, $3, $3, 0, $4, $4)`,
        ['credits-pk-conflict', 'pk-conflict-user', 20, now],
      );
      await query(
        `INSERT INTO cloud_tasks (
          id, user_id, type, status, progress, credit_status, credit_cost,
          idempotency_key, request_digest, revision, created_at, updated_at
        ) VALUES ($1, $2, 'generate', 'processing', 0, 'not-applicable', 0,
                  'original-key', 'original-digest', 0, $3, $3)`,
        ['duplicate-task-id', 'pk-conflict-user', now],
      );
      await expect(createBillableTask({
        userId: 'pk-conflict-user',
        idempotencyKey: 'new-key',
        requestDigest: 'new-digest',
        creditCost: 7,
        task: {
          id: 'duplicate-task-id',
          type: 'generate',
          status: 'processing',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        },
      })).rejects.toBeTruthy();
      const pkConflictState = await query<{
        balance: number;
        total_used: number;
        transactions: string;
      }>(
        `SELECT credits.balance,
                credits.total_used,
                (SELECT COUNT(*)::text
                 FROM wujie_credit_transactions
                 WHERE task_id = $2) AS transactions
         FROM wujie_credits credits
         WHERE credits.user_id = $1`,
        ['pk-conflict-user', 'duplicate-task-id'],
      );
      expect(pkConflictState.rows[0]).toMatchObject({
        balance: 20,
        total_used: 0,
        transactions: '0',
      });

      const zeroCost = await createBillableTask({
        userId: 'zero-cost-user',
        idempotencyKey: 'zero-cost-key',
        requestDigest: 'zero-cost-digest',
        creditCost: 0,
        task: {
          id: 'zero-cost-task',
          type: 'generate',
          status: 'processing',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        },
      });
      expect(zeroCost).toMatchObject({
        reused: false,
        charged: false,
        task: {
          id: 'zero-cost-task',
          creditStatus: 'not-applicable',
          creditCost: 0,
        },
      });
      const zeroCostRows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM wujie_credit_transactions WHERE task_id = $1`,
        ['zero-cost-task'],
      );
      expect(zeroCostRows.rows[0]?.count).toBe('0');

      await query(
        `INSERT INTO wujie_credits (
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, $3, $3, 0, $4, $4)`,
        ['credits-completed', 'completed-user', 20, now],
      );
      await createBillableTask({
        userId: 'completed-user',
        idempotencyKey: 'completed-key',
        requestDigest: 'completed-digest',
        creditCost: 7,
        task: {
          id: 'completed-task',
          type: 'generate',
          status: 'processing',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        },
      });
      await query(
        `UPDATE cloud_tasks
         SET status = 'completed', progress = 100, credit_status = 'charged'
         WHERE id = $1`,
        ['completed-task'],
      );
      await expect(settleFailedTask({
        taskId: 'completed-task',
        status: 'failed',
        error: { code: 'LATE_FAILURE', message: 'late failure' },
      })).resolves.toEqual({ transitioned: false, refunded: false });
      const completedState = await query<{
        status: string;
        credit_status: string;
        balance: number;
        refunds: string;
      }>(
        `SELECT task.status,
                task.credit_status,
                credits.balance,
                (SELECT COUNT(*)::text
                 FROM wujie_credit_transactions
                 WHERE task_id = task.id AND type = 'refund') AS refunds
         FROM cloud_tasks task
         JOIN wujie_credits credits ON credits.user_id = task.user_id
         WHERE task.id = $1`,
        ['completed-task'],
      );
      expect(completedState.rows[0]).toMatchObject({
        status: 'completed',
        credit_status: 'charged',
        balance: 13,
        refunds: '0',
      });

      await query(
        `INSERT INTO cloud_tasks (
          id, user_id, type, status, progress, result, credit_status,
          credit_cost, idempotency_key, request_digest, revision,
          created_at, updated_at
        ) VALUES ($1, $2, 'generate', 'processing', 0, '{}'::jsonb, 'pending',
                  7, $3, '', 0, $4, $4)`,
        ['legacy-empty-task', 'legacy-user', 'legacy-empty-key', now],
      );
      await expect(createBillableTask({
        userId: 'legacy-user',
        idempotencyKey: 'legacy-empty-key',
        requestDigest: 'new-request-digest',
        creditCost: 7,
        task: {
          id: 'legacy-new-task',
          type: 'generate',
          status: 'processing',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        },
      })).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
        status: 409,
        details: { existingDigest: 'legacy-unknown' },
      });
      const legacyDigest = await query<{ request_digest: string }>(
        'SELECT request_digest FROM cloud_tasks WHERE id = $1',
        ['legacy-empty-task'],
      );
      expect(legacyDigest.rows[0]?.request_digest).toBe('');

      await query(
        `INSERT INTO wujie_credits (
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, $3, $3, 0, $4, $4)`,
        ['credits-ledger-failure', 'ledger-failure-user', 20, now],
      );
      await query(`
        CREATE OR REPLACE FUNCTION reject_task4_ledger_insert()
        RETURNS trigger AS $$
        BEGIN
          IF NEW.task_id = 'ledger-failure-task' THEN
            RAISE EXCEPTION 'forced ledger insert failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await query(`
        CREATE TRIGGER reject_task4_ledger_insert
        BEFORE INSERT ON wujie_credit_transactions
        FOR EACH ROW EXECUTE FUNCTION reject_task4_ledger_insert()
      `);
      await expect(createBillableTask({
        userId: 'ledger-failure-user',
        idempotencyKey: 'ledger-failure-key',
        requestDigest: 'ledger-failure-digest',
        creditCost: 7,
        task: {
          id: 'ledger-failure-task',
          type: 'generate',
          status: 'processing',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        },
      })).rejects.toThrow('forced ledger insert failure');
      const ledgerFailureState = await query<{
        balance: number;
        total_used: number;
        tasks: string;
        transactions: string;
      }>(
        `SELECT credits.balance,
                credits.total_used,
                (SELECT COUNT(*)::text FROM cloud_tasks WHERE id = $2) AS tasks,
                (SELECT COUNT(*)::text
                 FROM wujie_credit_transactions WHERE task_id = $2) AS transactions
         FROM wujie_credits credits
         WHERE credits.user_id = $1`,
        ['ledger-failure-user', 'ledger-failure-task'],
      );
      expect(ledgerFailureState.rows[0]).toMatchObject({
        balance: 20,
        total_used: 0,
        tasks: '0',
        transactions: '0',
      });
    });
  });
});
