import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/credits', async original => ({
  ...await original<typeof import('@/lib/credits')>(),
  calculateConfiguredCreditCost: vi.fn(async () => 12),
}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL ? it : it.skip;
if (!process.env.POSTGRES_TEST_DATABASE_URL) console.warn('BLOCKED: refine settlement requires POSTGRES_TEST_DATABASE_URL');

describe('refine lifecycle real PostgreSQL settlement', () => {
  postgresIt('binds one charge to a task and settles concurrent failures and completion races consistently', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('refine-settlement', async ({ query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const { ensureCloudTaskTables, getCloudTaskById } = await import('@/lib/cloud-task-storage');
      const { createRefineTask, reconcileRefineTask, settleRefineTask } = await import('@/lib/refine-task-lifecycle');
      const { recordImageTaskTerminal } = await import('@/lib/cloud-task-persistence');
      const { registerTask, updateTaskProgress } = await import('@/lib/task-registry');
      await ensureCoreTables();
      await ensureCloudTaskTables();
      const now = Date.now();
      await query('INSERT INTO wujie_credits (id,user_id,balance,total_used,total_recharged,created_at,updated_at) VALUES ($1,$2,1000,0,1000,$3,$3)', ['refine-credits', 'refine-pg-user', now]);
      const input = (taskId: string) => ({ taskId, userId: 'refine-pg-user', label: 'Refine PostgreSQL test', providerId: 'fixture-provider', model: 'gpt-image-2', pricingModel: 'gpt-image-2' });
      const balance = async (): Promise<number> => Number((await query('SELECT balance FROM wujie_credits WHERE user_id=$1', ['refine-pg-user'])).rows[0]?.balance);
      const ledger = async (taskId: string): Promise<Array<{ type: string; count: string }>> => (await query<{ type: string; count: string }>('SELECT type,count(*)::text AS count FROM wujie_credit_transactions WHERE task_id=$1 GROUP BY type ORDER BY type', [taskId])).rows;

      // Exercise the real advisory lock and debit transaction concurrently.
      await Promise.all(Array.from({ length: 6 }, () => createRefineTask(input('refine-pg-repeated'))));
      expect(await balance()).toBe(988);
      expect(await ledger('refine-pg-repeated')).toEqual([{ type: 'consume', count: '1' }]);
      registerTask('refine-pg-repeated', 'refine-engine', 'PG', 'refine-pg-user', 'durable');
      updateTaskProgress('refine-pg-repeated', { status: 'processing', creditCost: 12, result: { remoteTaskId: 'remote-pg-task', apiKey: 'must-not-persist' } });
      await reconcileRefineTask('refine-pg-repeated');
      expect(await getCloudTaskById('refine-pg-repeated')).toMatchObject({ remoteTaskId: 'remote-pg-task', creditCost: 12 });
      expect(JSON.stringify(await getCloudTaskById('refine-pg-repeated'))).not.toContain('must-not-persist');
      await Promise.all(Array.from({ length: 6 }, () => settleRefineTask('refine-pg-repeated', 'failed', 'Provider failed')));
      expect(await balance()).toBe(1000);
      expect(await ledger('refine-pg-repeated')).toEqual([{ type: 'consume', count: '1' }, { type: 'refund', count: '1' }]);
      expect(await getCloudTaskById('refine-pg-repeated')).toMatchObject({ status: 'failed', creditStatus: 'refunded' });
      expect(await recordImageTaskTerminal('refine-pg-repeated', { status: 'completed', imageUrl: '/late.png', creditStatus: 'charged' })).toMatchObject({ transitioned: false, task: { status: 'failed', creditStatus: 'refunded' } });

      for (let index = 0; index < 8; index++) {
        const taskId = `refine-pg-race-${index}`;
        const before = await balance();
        await createRefineTask(input(taskId));
        await Promise.all([
          recordImageTaskTerminal(taskId, { status: 'completed', imageUrl: '/winner.png', creditStatus: 'charged' }),
          settleRefineTask(taskId, 'cancelled', 'User cancelled'),
        ]);
        const task = await getCloudTaskById(taskId);
        expect(['completed', 'cancelled']).toContain(task?.status);
        const completed = task?.status === 'completed';
        expect(task?.creditStatus).toBe(completed ? 'charged' : 'refunded');
        expect(await balance()).toBe(before - (completed ? 12 : 0));
        expect(await ledger(taskId)).toEqual(completed ? [{ type: 'consume', count: '1' }] : [{ type: 'consume', count: '1' }, { type: 'refund', count: '1' }]);
      }

      await query("CREATE FUNCTION reject_refine_task() RETURNS trigger AS $$ BEGIN IF NEW.id = 'refine-pg-rollback' THEN RAISE EXCEPTION 'simulated storage failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql");
      await query('CREATE TRIGGER reject_refine BEFORE INSERT ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION reject_refine_task()');
      const beforeRollback = await balance();
      await expect(createRefineTask(input('refine-pg-rollback'))).rejects.toThrow('simulated storage failure');
      expect(await balance()).toBe(beforeRollback);
      expect(await ledger('refine-pg-rollback')).toEqual([]);
      expect(await getCloudTaskById('refine-pg-rollback')).toBeNull();
    });
  });
});
