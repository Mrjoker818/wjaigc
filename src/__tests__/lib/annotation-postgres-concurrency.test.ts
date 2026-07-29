import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_POSTGRES_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('annotation PostgreSQL concurrency', () => {
  const userId = `annotation-pg-${randomUUID()}`;
  const taskId = `annotation-pg-task-${randomUUID()}`;
  let execSql: typeof import('@/lib/db-client').execSql;
  let dbStorage: typeof import('@/lib/db-storage');
  let storage: typeof import('@/lib/cloud-task-storage');

  beforeAll(async () => {
    process.env.PGDATABASE_URL = databaseUrl;
    ({ execSql } = await import('@/lib/db-client'));
    dbStorage = await import('@/lib/db-storage');
    storage = await import('@/lib/cloud-task-storage');
    await dbStorage.ensureCoreTables();
    await storage.ensureCloudTaskTables();
    await dbStorage.dbInitCredits(userId, 100);
    await storage.createCloudTask({
      id: taskId,
      userId,
      type: 'annotation-edit',
      status: 'pending',
      progress: 0,
      creditStatus: 'not-applicable',
      creditCost: 0,
      idempotencyKey: `idem-${taskId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  afterAll(async () => {
    if (!execSql) return;
    await execSql('DELETE FROM wujie_credit_transactions WHERE reference_id = $1', [taskId]);
    await execSql('DELETE FROM cloud_tasks WHERE id = $1', [taskId]);
    await execSql('DELETE FROM wujie_credits WHERE user_id = $1', [userId]);
  });

  it('charges once, settles one failure terminal, and rejects every late completion', async () => {
    const charges = await Promise.all([
      storage.chargeCloudTaskCredits(taskId, userId, 8, 'concurrency test'),
      storage.chargeCloudTaskCredits(taskId, userId, 8, 'concurrency test'),
    ]);
    expect(charges.filter((result) => result.charged)).toHaveLength(1);

    const terminalResults = await Promise.all([
      storage.terminateCloudTaskAndRefund(taskId, 'cancelled', 'concurrency cancel'),
      storage.terminateCloudTaskAndRefund(taskId, 'timeout', 'concurrency timeout'),
      storage.terminateCloudTaskAndRefund(taskId, 'failed', 'concurrency failure'),
    ]);
    expect(terminalResults.filter((result) => result.transitioned)).toHaveLength(1);
    expect(terminalResults.filter((result) => result.refunded)).toHaveLength(1);

    const lateCompletions = await Promise.all(
      Array.from({ length: 8 }, () =>
        storage.completeCloudTask(taskId, { image: { url: '/late.png' } })),
    );
    expect(lateCompletions.every((completed) => completed === false)).toBe(true);

    const task = await storage.getCloudTaskForUser(taskId, userId);
    const credits = await execSql(
      'SELECT balance, total_used FROM wujie_credits WHERE user_id = $1',
      [userId],
    );
    expect(['cancelled', 'timeout', 'failed']).toContain(task?.status);
    expect(task?.creditStatus).toBe('refunded');
    expect(Number(credits.rows[0].balance)).toBe(100);
    expect(Number(credits.rows[0].total_used)).toBe(0);
  });
});
