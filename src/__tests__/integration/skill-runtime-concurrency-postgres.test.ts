import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const hasPostgresTestDatabase = Boolean(process.env.POSTGRES_TEST_DATABASE_URL?.trim());
const postgresIt = hasPostgresTestDatabase ? it : it.skip;

if (!hasPostgresTestDatabase) {
  console.warn('[BLOCKED] Unified Skill Runtime Task 6 PostgreSQL concurrency was not verified: POSTGRES_TEST_DATABASE_URL is missing.');
}

describe('Skill runtime PostgreSQL concurrency', () => {
  postgresIt('same actor and idempotency key creates one Skill run and one charge', async () => {
    await withIsolatedPostgres('skill_runtime_create_concurrency', async ({ query }) => {
      const { createBillableTask } = await import('@/lib/task-core/billing-service');
      const now = Date.now();
      const userId = `skill-user-${randomUUID()}`;
      const idempotencyKey = `skill-key-${randomUUID()}`;
      const requestDigest = 'a'.repeat(64);
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const attempts = await Promise.all(Array.from({ length: 20 }, (_, index) => createBillableTask({
        userId, idempotencyKey, requestDigest, creditCost: 7,
        task: {
          id: `skill-run-${index}-${randomUUID()}`, projectId: 'project-1', type: 'agent-run',
          status: 'processing', progress: 0,
          result: { skillId: 'preset-ecommerce-listing', skillVersion: 1 },
          createdAt: now + index, updatedAt: now + index,
        },
      })));
      const runIds = new Set(attempts.map(attempt => attempt.task.id));
      expect(runIds.size).toBe(1);
      expect(attempts.filter(attempt => !attempt.reused)).toHaveLength(1);
      expect(attempts.filter(attempt => attempt.charged)).toHaveLength(1);
      const runId = [...runIds][0];
      const ledger = await query<{ type: string }>(
        'SELECT type FROM wujie_credit_transactions WHERE task_id = $1', [runId],
      );
      const credits = await query<{ balance: number }>(
        'SELECT balance FROM wujie_credits WHERE user_id = $1', [userId],
      );
      expect(ledger.rows).toEqual([{ type: 'consume' }]);
      expect(credits.rows[0]?.balance).toBe(93);
      await expect(createBillableTask({
        userId, idempotencyKey, requestDigest: 'b'.repeat(64), creditCost: 7,
        task: {
          id: `skill-conflict-${randomUUID()}`, projectId: 'project-1', type: 'agent-run',
          status: 'processing', progress: 0, createdAt: now + 100, updatedAt: now + 100,
        },
      })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    });
  }, 60_000);

  postgresIt('failure or cancellation refunds once and a late completion cannot cross the terminal state', async () => {
    await withIsolatedPostgres('skill_runtime_terminal_race', async ({ query }) => {
      const { createBillableTask, settleFailedTask } = await import('@/lib/task-core/billing-service');
      const { completeCloudTask } = await import('@/lib/cloud-task-storage');
      const now = Date.now();
      const userId = `skill-terminal-${randomUUID()}`;
      await query(
        `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        [`credits-${randomUUID()}`, userId, now],
      );
      const created = await createBillableTask({
        userId, idempotencyKey: randomUUID(), requestDigest: 'c'.repeat(64), creditCost: 9,
        task: {
          id: `skill-run-${randomUUID()}`, projectId: 'project-1', type: 'agent-run',
          status: 'processing', progress: 0, createdAt: now, updatedAt: now,
        },
      });
      const settlements = await Promise.all([
        settleFailedTask({
          taskId: created.task.id, status: 'failed',
          error: { code: 'SKILL_QUALITY_FAILED', message: 'quality failed', retryable: false },
        }),
        settleFailedTask({
          taskId: created.task.id, status: 'cancelled',
          error: { code: 'AGENT_RUN_CANCELLED', message: 'cancelled', retryable: false },
        }),
      ]);
      expect(settlements.filter(result => result.transitioned)).toHaveLength(1);
      expect(settlements.filter(result => result.refunded)).toHaveLength(1);
      await expect(completeCloudTask(created.task.id, {
        assetVersionIds: ['late-version'],
      })).resolves.toBe(false);
      const task = await query<{ status: string; credit_status: string }>(
        'SELECT status, credit_status FROM cloud_tasks WHERE id = $1', [created.task.id],
      );
      const refunds = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM wujie_credit_transactions
         WHERE task_id = $1 AND type = 'refund'`, [created.task.id],
      );
      expect(['failed', 'cancelled']).toContain(task.rows[0]?.status);
      expect(task.rows[0]?.credit_status).toBe('refunded');
      expect(refunds.rows[0]?.count).toBe('1');
    });
  }, 60_000);
});
