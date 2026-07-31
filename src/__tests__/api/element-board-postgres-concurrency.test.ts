import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_POSTGRES_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('element board PostgreSQL concurrency', () => {
  const userId = `board-pg-${randomUUID()}`;
  const idempotencyKey = `board-idem-${randomUUID()}`;
  const request = {
    sourceHash: 'a'.repeat(64),
    sourceUrl: '/api/serve-upload/board-concurrency.png',
    aspectRatio: '16:9',
    background: 'transparent',
    providerId: 'board-provider',
    modelId: 'board-model',
  };
  let taskId = '';
  let execSql: typeof import('@/lib/db-client').execSql;
  let dbStorage: typeof import('@/lib/db-storage');
  let storage: typeof import('@/lib/cloud-task-storage');
  let idempotency: typeof import('@/lib/element-decomposition/board-idempotency');

  beforeAll(async () => {
    process.env.PGDATABASE_URL = databaseUrl;
    ({ execSql } = await import('@/lib/db-client'));
    dbStorage = await import('@/lib/db-storage');
    storage = await import('@/lib/cloud-task-storage');
    idempotency = await import('@/lib/element-decomposition/board-idempotency');
    await dbStorage.ensureCoreTables();
    await storage.ensureCloudTaskTables();
    await dbStorage.dbInitCredits(userId, 100);
  });

  afterAll(async () => {
    if (!execSql) return;
    if (taskId) {
      await execSql('DELETE FROM wujie_credit_transactions WHERE reference_id = $1', [taskId]);
      await execSql('DELETE FROM cloud_tasks WHERE id = $1', [taskId]);
    }
    await execSql('DELETE FROM wujie_credits WHERE user_id = $1', [userId]);
  });

  it('claims, charges, and refunds exactly once under concurrent duplicate requests', async () => {
    const requestHash = idempotency.createElementBoardRequestHash(request);
    const claims = await Promise.all(Array.from({ length: 20 }, () => (
      idempotency.claimElementBoardTask({
        userId,
        idempotencyKey,
        requestHash,
        providerId: request.providerId,
        modelId: request.modelId,
        request,
      })
    )));
    taskId = claims[0].taskId;

    expect(new Set(claims.map((claim) => claim.taskId))).toEqual(new Set([taskId]));
    expect(claims.filter((claim) => claim.owner)).toHaveLength(1);

    const charges = await Promise.all(Array.from({ length: 12 }, () => (
      storage.chargeCloudTaskCredits(taskId, userId, 9, 'Element board concurrency test')
    )));
    expect(charges.filter((charge) => charge.charged)).toHaveLength(1);

    const terminals = await Promise.all([
      storage.terminateCloudTaskAndRefund(taskId, 'cancelled', 'cancel wins'),
      storage.terminateCloudTaskAndRefund(taskId, 'timeout', 'timeout loses'),
      storage.terminateCloudTaskAndRefund(taskId, 'failed', 'failure loses'),
    ]);
    expect(terminals.filter((terminal) => terminal.transitioned)).toHaveLength(1);
    expect(terminals.filter((terminal) => terminal.refunded)).toHaveLength(1);

    const lateCompletions = await Promise.all(Array.from({ length: 12 }, () => (
      storage.completeCloudTask(taskId, { imageUrl: '/late-result.png' })
    )));
    expect(lateCompletions.every((completed) => completed === false)).toBe(true);

    const rows = await execSql(
      `SELECT
         (SELECT COUNT(*)::int FROM cloud_tasks WHERE id = $1) AS task_count,
         (SELECT COUNT(*)::int FROM wujie_credit_transactions
          WHERE reference_id = $1 AND type = 'consume') AS consume_count,
         (SELECT COUNT(*)::int FROM wujie_credit_transactions
          WHERE reference_id = $1 AND type = 'refund') AS refund_count`,
      [taskId],
    );
    expect(rows.rows[0]).toMatchObject({ task_count: 1, consume_count: 1, refund_count: 1 });

    const credits = await execSql(
      'SELECT balance, total_used FROM wujie_credits WHERE user_id = $1',
      [userId],
    );
    expect(Number(credits.rows[0].balance)).toBe(100);
    expect(Number(credits.rows[0].total_used)).toBe(0);
  });
});
