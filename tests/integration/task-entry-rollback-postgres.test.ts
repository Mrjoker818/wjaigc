import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; task entry rollback rehearsal skipped.',
  );
}

describe('task entry rollback on PostgreSQL', () => {
  postgresIt('keeps a core-v2 task authoritative after switching new admissions to legacy', async () => {
    const { withIsolatedPostgres } = await import(
      '../helpers/postgres-test-database'
    );

    await withIsolatedPostgres('task-entry-rollback', async ({ query }) => {
      const {
        createTaskEntryAudit,
        executeTaskEntryMigration,
        resolveTaskCoreMode,
      } = await import('@/lib/task-core/entry-migration');
      const {
        createBillableTask,
        settleFailedTask,
      } = await import('@/lib/task-core/billing-service');
      const {
        createCloudTask,
        getCloudTaskById,
      } = await import('@/lib/cloud-task-storage');
      const { ensureCoreTables } = await import('@/lib/db-storage');

      const userId = 'rollback-user';
      const coreTaskId = 'rollback-core-v2-task';
      const legacyTaskId = 'rollback-legacy-task';
      const now = Date.now();

      await ensureCoreTables();
      await query(
        `INSERT INTO wujie_credits (
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 100, 100, 0, $3, $3)`,
        ['rollback-credits', userId, now],
      );

      const coreMode = resolveTaskCoreMode('core-v2');
      const coreAudit = createTaskEntryAudit({
        entry: 'video',
        mode: coreMode,
        requestId: 'rollback-core-request',
        requestedProviderId: 'provider-a',
        requestedModelId: 'model-a',
        actualProviderId: 'provider-a',
        actualModelId: 'model-a',
        startedAt: now,
        creditCost: 7,
        creditStatus: 'pending',
      });
      const coreAdmission = await executeTaskEntryMigration({
        mode: coreMode,
        legacy: async () => {
          throw new Error('legacy admission must not run in core-v2 mode');
        },
        coreV2: async () => createBillableTask({
          userId,
          idempotencyKey: 'rollback-core-key',
          requestDigest: 'rollback-core-digest',
          creditCost: 7,
          task: {
            id: coreTaskId,
            type: 'video',
            status: 'processing',
            providerId: 'provider-a',
            model: 'model-a',
            progress: 5,
            label: 'Core V2 rollback probe',
            result: { taskEntryAudit: coreAudit },
            createdAt: now,
            updatedAt: now,
          },
        }),
        factsFromResult: result => ({
          providerId: result.task.providerId,
          modelId: result.task.model,
          creditCost: result.task.creditCost,
          status: 'processing',
        }),
      });

      expect(coreAdmission.mode).toBe('core-v2');
      expect(coreAdmission.value).toMatchObject({ reused: false, charged: true });

      const rollbackMode = resolveTaskCoreMode(undefined);
      const legacyAudit = createTaskEntryAudit({
        entry: 'video',
        mode: rollbackMode,
        requestId: 'rollback-legacy-request',
        requestedProviderId: 'provider-b',
        requestedModelId: 'model-b',
        actualProviderId: 'provider-b',
        actualModelId: 'model-b',
        startedAt: now + 1,
        creditStatus: 'not-applicable',
      });
      const legacyAdmission = await executeTaskEntryMigration({
        mode: rollbackMode,
        legacy: async () => createCloudTask({
          id: legacyTaskId,
          userId,
          type: 'video',
          status: 'processing',
          providerId: 'provider-b',
          model: 'model-b',
          progress: 0,
          result: { taskEntryAudit: legacyAudit },
          creditStatus: 'not-applicable',
          createdAt: now + 1,
          updatedAt: now + 1,
        }),
        coreV2: async () => {
          throw new Error('core-v2 admission must not run after rollback');
        },
        factsFromResult: () => ({
          providerId: 'provider-b',
          modelId: 'model-b',
          creditCost: 0,
          status: 'processing',
        }),
      });

      expect(legacyAdmission.mode).toBe('legacy');
      expect(legacyAdmission.value).toBe(true);

      const beforeSettlement = await getCloudTaskById(coreTaskId);
      expect(beforeSettlement?.result?.taskEntryAudit).toMatchObject({
        handlerVersion: 'task-core-v2',
        requestId: 'rollback-core-request',
      });

      const settlement = await settleFailedTask({
        taskId: coreTaskId,
        status: 'timeout',
        error: {
          code: 'ROLLBACK_PROBE_TIMEOUT',
          message: 'Rollback probe terminal settlement',
        },
      });
      const duplicateSettlement = await settleFailedTask({
        taskId: coreTaskId,
        status: 'failed',
        error: {
          code: 'ROLLBACK_PROBE_LATE_FAILURE',
          message: 'Late result after rollback',
        },
      });

      expect(settlement).toEqual({ transitioned: true, refunded: true });
      expect(duplicateSettlement).toEqual({
        transitioned: false,
        refunded: false,
      });

      const coreTask = await getCloudTaskById(coreTaskId);
      const legacyTask = await getCloudTaskById(legacyTaskId);
      const taskRows = await query<{
        id: string;
        status: string;
        credit_status: string;
      }>(
        `SELECT id, status, credit_status
         FROM cloud_tasks
         WHERE user_id = $1
         ORDER BY id`,
        [userId],
      );
      const transactions = await query<{
        type: string;
        amount: number;
        task_id: string;
      }>(
        `SELECT type, amount, task_id
         FROM wujie_credit_transactions
         WHERE user_id = $1
         ORDER BY type`,
        [userId],
      );
      const credits = await query<{ balance: number; total_used: number }>(
        'SELECT balance, total_used FROM wujie_credits WHERE user_id = $1',
        [userId],
      );

      expect(coreTask).toMatchObject({
        id: coreTaskId,
        status: 'timeout',
        creditStatus: 'refunded',
      });
      expect(coreTask?.result?.taskEntryAudit).toMatchObject({
        handlerVersion: 'task-core-v2',
        requestId: 'rollback-core-request',
      });
      expect(legacyTask?.result?.taskEntryAudit).toMatchObject({
        handlerVersion: 'legacy',
        requestId: 'rollback-legacy-request',
      });
      expect(taskRows.rows).toEqual([
        { id: coreTaskId, status: 'timeout', credit_status: 'refunded' },
        { id: legacyTaskId, status: 'processing', credit_status: 'not-applicable' },
      ]);
      expect(transactions.rows).toEqual([
        { type: 'consume', amount: -7, task_id: coreTaskId },
        { type: 'refund', amount: 7, task_id: coreTaskId },
      ]);
      expect(credits.rows).toEqual([{ balance: 100, total_used: 0 }]);
    });
  });
});
