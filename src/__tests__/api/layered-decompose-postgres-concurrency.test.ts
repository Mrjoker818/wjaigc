import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LayerDecompositionRequest } from '@/lib/layer-decomposition/types';

const databaseUrl = process.env.TEST_POSTGRES_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('layer decomposition PostgreSQL concurrency', () => {
  const userId = `layer-pg-${randomUUID()}`;
  const idempotencyKey = `layer-idem-${randomUUID()}`;
  const request: LayerDecompositionRequest = {
    imageUrl: '/api/serve-upload/concurrency.png',
    engine: 'smart',
    providerId: 'pear-provider',
    modelId: 'pear-layer-model',
  };
  let taskId = '';
  let execSql: typeof import('@/lib/db-client').execSql;
  let storage: typeof import('@/lib/cloud-task-storage');
  let idempotency: typeof import('@/lib/layer-decomposition/idempotency');

  beforeAll(async () => {
    process.env.PGDATABASE_URL = databaseUrl;
    ({ execSql } = await import('@/lib/db-client'));
    storage = await import('@/lib/cloud-task-storage');
    idempotency = await import('@/lib/layer-decomposition/idempotency');
    await storage.ensureCloudTaskTables();
    await execSql(
      `INSERT INTO wujie_credits (user_id, balance, total_used, total_recharged, created_at, updated_at)
       VALUES ($1, 100, 0, 100, $2, $2)
       ON CONFLICT (user_id) DO UPDATE SET balance = 100, total_used = 0, updated_at = $2`,
      [userId, Date.now()],
    );
  });

  afterAll(async () => {
    if (!execSql) return;
    if (taskId) {
      await execSql('DELETE FROM wujie_credit_transactions WHERE reference_id = $1', [taskId]);
      await execSql('DELETE FROM cloud_tasks WHERE id = $1', [taskId]);
    }
    await execSql('DELETE FROM wujie_credits WHERE user_id = $1', [userId]);
  });

  it('creates, charges, and refunds one task under concurrent duplicate requests', async () => {
    const requestHash = idempotency.createLayerRequestHash(request);
    const claims = await Promise.all(Array.from({ length: 10 }, () => (
      idempotency.claimLayerTask({
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

    const charges = await Promise.all(Array.from({ length: 8 }, () => (
      storage.chargeCloudTaskCredits(taskId, userId, 7, 'Pear layer concurrency test')
    )));
    expect(charges.filter((charge) => charge.charged)).toHaveLength(1);

    const terminals = await Promise.all([
      storage.terminateCloudTaskAndRefund(taskId, 'cancelled', 'cancel wins'),
      storage.terminateCloudTaskAndRefund(taskId, 'timeout', 'timeout loses'),
      storage.terminateCloudTaskAndRefund(taskId, 'failed', 'failure loses'),
    ]);
    expect(terminals.filter((terminal) => terminal.transitioned)).toHaveLength(1);
    expect(terminals.filter((terminal) => terminal.refunded)).toHaveLength(1);

    const lateCompletions = await Promise.all(Array.from({ length: 8 }, () => (
      storage.completeCloudTask(taskId, { phase: 'ready' })
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
