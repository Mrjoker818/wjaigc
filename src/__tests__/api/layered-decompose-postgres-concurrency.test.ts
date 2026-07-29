import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LayerDecompositionRequest } from '@/lib/layer-decomposition/types';

const databaseUrl = process.env.TEST_POSTGRES_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('layer decomposition PostgreSQL concurrency', () => {
  const userId = `layer-pg-${randomUUID()}`;
  const refundRaceUserId = `layer-refund-race-${randomUUID()}`;
  const refundRaceTaskId = `layer-refund-race-task-${randomUUID()}`;
  const idempotencyKey = `layer-idem-${randomUUID()}`;
  const request: LayerDecompositionRequest = {
    imageUrl: '/api/serve-upload/concurrency.png',
    engine: 'smart',
    providerId: 'pear-provider',
    modelId: 'pear-layer-model',
  };
  let taskId = '';
  let execSql: typeof import('@/lib/db-client').execSql;
  let getPool: typeof import('@/lib/db-client').getPool;
  let dbStorage: typeof import('@/lib/db-storage');
  let storage: typeof import('@/lib/cloud-task-storage');
  let idempotency: typeof import('@/lib/layer-decomposition/idempotency');

  beforeAll(async () => {
    process.env.PGDATABASE_URL = databaseUrl;
    ({ execSql, getPool } = await import('@/lib/db-client'));
    dbStorage = await import('@/lib/db-storage');
    storage = await import('@/lib/cloud-task-storage');
    idempotency = await import('@/lib/layer-decomposition/idempotency');
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
    await execSql('DELETE FROM wujie_credit_transactions WHERE reference_id = $1', [refundRaceTaskId]);
    await execSql('DELETE FROM cloud_tasks WHERE id = $1', [refundRaceTaskId]);
    await execSql('DELETE FROM wujie_credits WHERE user_id = $1', [userId]);
    await execSql('DELETE FROM wujie_credits WHERE user_id = $1', [refundRaceUserId]);
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

  it('does not mark a task refunded when its credit account is concurrently removed', async () => {
    await dbStorage.dbInitCredits(refundRaceUserId, 100);
    await storage.createCloudTask({
      id: refundRaceTaskId,
      userId: refundRaceUserId,
      type: 'layer-decomposition',
      status: 'processing',
      progress: 5,
      creditStatus: 'not-applicable',
      creditCost: 0,
      idempotencyKey: `idem-${refundRaceTaskId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const charge = await storage.chargeCloudTaskCredits(
      refundRaceTaskId,
      refundRaceUserId,
      7,
      'Pear layer refund race test',
    );
    expect(charge.charged).toBe(true);

    const deletingClient = await getPool().connect();
    let deletionCommitted = false;
    let terminationPromise: ReturnType<typeof storage.terminateCloudTaskAndRefund> | undefined;
    try {
      await deletingClient.query('BEGIN');
      await deletingClient.query('DELETE FROM wujie_credits WHERE user_id = $1', [refundRaceUserId]);

      terminationPromise = storage.terminateCloudTaskAndRefund(
        refundRaceTaskId,
        'failed',
        'forced concurrent account deletion',
      );
      const deadline = Date.now() + 5_000;
      let settlementWaitingOnLock = false;
      while (Date.now() < deadline) {
        const waiting = await execSql(`
          SELECT COUNT(*)::int AS count
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND cardinality(pg_blocking_pids(pid)) > 0
        `);
        settlementWaitingOnLock = Number(waiting.rows[0]?.count || 0) > 0;
        if (settlementWaitingOnLock) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(settlementWaitingOnLock).toBe(true);

      await deletingClient.query('COMMIT');
      deletionCommitted = true;
      const termination = await terminationPromise;
      expect(termination).toMatchObject({
        status: 'failed',
        transitioned: true,
        refunded: false,
      });

      const task = await storage.getCloudTaskForUser(refundRaceTaskId, refundRaceUserId);
      expect(task?.creditStatus).toBe('pending');
      const refunds = await execSql(
        `SELECT COUNT(*)::int AS count
         FROM wujie_credit_transactions
         WHERE reference_id = $1 AND type = 'refund'`,
        [refundRaceTaskId],
      );
      expect(Number(refunds.rows[0]?.count || 0)).toBe(0);
    } finally {
      if (!deletionCommitted) await deletingClient.query('ROLLBACK').catch(() => undefined);
      await terminationPromise?.catch(() => undefined);
      deletingClient.release();
    }
  });
});
