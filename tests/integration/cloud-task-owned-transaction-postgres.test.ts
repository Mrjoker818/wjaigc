import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { readOwnedSketchFixture, withOwnedSketchPostgres } from '../helpers/owned-sketch-postgres-fixture';
import type { IsolatedPostgresContext, QueryFn } from '../helpers/postgres-test-database';
import { getPool } from '@/lib/db-client';

vi.mock('server-only', () => ({}));

type Storage = typeof import('@/lib/cloud-task-storage');
type Action = 'create' | 'complete' | 'terminate';
interface Outcome { value?: unknown; error?: unknown }
interface ObservationOptions { commit?: boolean; connect?: () => Promise<PoolClient>; observe?: QueryFn }

async function ownedCase(name: string, run: (context: IsolatedPostgresContext) => Promise<void>): Promise<void> {
  if (!readOwnedSketchFixture()) throw new Error('Explicit owned fixture required for cold transaction acceptance');
  await withOwnedSketchPostgres(`image_pg_cold_${name}`, run);
}

async function warmSchema(): Promise<Storage> {
  const core = await import('@/lib/db-storage');
  const storage = await import('@/lib/cloud-task-storage');
  await core.ensureCoreTables(); await storage.ensureCloudTaskTables();
  return storage;
}

async function coldStorage(): Promise<Storage> {
  vi.resetModules();
  return import('@/lib/cloud-task-storage');
}

async function seedTask(context: IsolatedPostgresContext, taskId: string, paid = false): Promise<void> {
  await context.query(`INSERT INTO cloud_tasks
    (id,user_id,type,status,credit_status,credit_cost,charged_transaction_id,created_at,updated_at)
    VALUES ($1,'synthetic-owner','generate','processing',$2,$3,$4,1,1)`,
  [taskId, paid ? 'pending' : 'not-applicable', paid ? 68 : 0, paid ? 'ctx_charge_owned_cold' : '']);
  if (!paid) return;
  await context.query(`INSERT INTO wujie_credits
    (id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    VALUES ('credit-owned-cold','synthetic-owner',32,100,68,1,1)`);
  await context.query(`INSERT INTO wujie_credit_transactions
    (id,user_id,amount,type,balance_after,description,model,task_id,reference_id,created_at)
    VALUES ('ctx_charge_owned_cold','synthetic-owner',-68,'consume',32,'synthetic charge','image-model',$1,$1,1)`, [taskId]);
}

function createInput(taskId: string): Parameters<Storage['createCloudTask']>[0] {
  return { id: taskId, userId: 'synthetic-owner', type: 'generate', status: 'processing', progress: 0,
    creditStatus: 'not-applicable', creditCost: 0, createdAt: 1, updatedAt: 1 };
}

async function perform(storage: Storage, action: Action, taskId: string, client: PoolClient): Promise<unknown> {
  if (action === 'create') return storage.createCloudTask(createInput(`${taskId}-created`), client);
  if (action === 'complete') return storage.completeCloudTask(taskId, { syntheticResult: 'owned' }, { client });
  return storage.terminateCloudTaskAndRefund(taskId, 'cancelled', 'SYNTHETIC_OWNER_CANCEL', undefined,
    { requireActive: true, client });
}

/** Observe the actual SQL lock graph; never race away and abandon a DB call.
 * The savepoint releases only test-held locks while keeping the outer caller
 * transaction alive, so a RED run also completes and rolls back cleanly. */
async function whileLocked(context: IsolatedPostgresContext, taskId: string,
  operation: (client: PoolClient) => Promise<unknown>, options: ObservationOptions = {}): Promise<{ outcome: Outcome; blocking: Record<string, unknown>[]; finishedWhileLocked: boolean }> {
  const client = await (options.connect ? options.connect() : getPool().connect());
  let pending: Promise<Outcome> | undefined, finished = false, finishedWhileLocked = false;
  let outcome: Outcome = {}, blocking: Record<string, unknown>[] = [];
  let operationFailed = false, operationError: unknown, released = false, discard = false;
  const cleanupErrors: unknown[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SAVEPOINT before_owned_locks');
    const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await client.query('SELECT id FROM cloud_tasks WHERE id=$1 FOR UPDATE', [taskId]);
    await client.query('SELECT id FROM wujie_credit_transactions FOR UPDATE');
    pending = operation(client).then(value => ({ value }), error => ({ error }))
      .finally((): void => { finished = true; });
    const deadline = Date.now() + 1200;
    while (!finished && Date.now() < deadline) {
      blocking = (await (options.observe ?? context.query)(`SELECT wait_event_type,wait_event,query,
        pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))`, [pid])).rows;
      if (blocking.length) break;
      await delay(10);
    }
    finishedWhileLocked = finished;
    if (!finished) await client.query('ROLLBACK TO SAVEPOINT before_owned_locks');
    outcome = await pending;
    if (options.commit && !outcome.error) await client.query('COMMIT');
  } catch (error) { operationFailed = true; operationError = error; }
  finally {
    if (pending && !finished) {
      // An observation failure must not roll back the whole transaction and
      // return its connection while the operation can still issue caller SQL.
      try { await client.query('ROLLBACK TO SAVEPOINT before_owned_locks'); }
      catch (error) {
        cleanupErrors.push(error); released = true;
        // Destroy rather than return a connection whose locks cannot be released.
        // Observe the pending operation even when destroying that connection.
        try { client.release(true); } catch (releaseError) { cleanupErrors.push(releaseError); }
      }
    }
    if (pending) {
      try { outcome = await pending; }
      catch (error) { cleanupErrors.push(error); }
    }
    if (!released) {
      try { await client.query('ROLLBACK'); }
      catch (error) { cleanupErrors.push(error); discard = true; }
      try { client.release(discard); }
      catch (error) { cleanupErrors.push(error); }
    }
  }
  if (operationFailed && outcome.error) cleanupErrors.push(outcome.error);
  if (operationFailed && cleanupErrors.length) throw new AggregateError([operationError, ...cleanupErrors], 'Owned observation and cleanup failed');
  if (operationFailed) throw operationError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Owned observation cleanup failed');
  return { outcome, blocking, finishedWhileLocked };
}

describe('caller-owned cloud-task transactions with cold initialization caches', (): void => {
  for (const action of ['create', 'complete', 'terminate'] as const) {
    it(`${action} finishes on the locked caller connection without waiting for pooled DDL`, async (): Promise<void> => {
      await ownedCase(action, async context => {
        await warmSchema();
        const taskId = `owned-${randomUUID()}`;
        await seedTask(context, taskId, action === 'terminate');
        const storage = await coldStorage();
        const observed = await whileLocked(context, taskId, client => perform(storage, action, taskId, client));
        expect(observed.outcome.error).toBeUndefined();
        if (action === 'terminate') expect(observed.outcome.value).toMatchObject({
          status: 'cancelled', transitioned: true, refunded: true, creditCost: 68, balance: 100, userId: 'synthetic-owner',
        });
        else expect(observed.outcome.value).toBe(true);
        expect((await context.query('SELECT status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
          .toEqual([{ status: 'processing' }]);
        expect((await context.query('SELECT id FROM cloud_tasks WHERE id=$1', [`${taskId}-created`])).rows).toEqual([]);
        if (action === 'terminate') {
          expect((await context.query('SELECT balance,total_used FROM wujie_credits')).rows).toEqual([{ balance: 32, total_used: 68 }]);
          expect((await context.query("SELECT type,amount FROM wujie_credit_transactions ORDER BY id")).rows)
            .toEqual([{ type: 'consume', amount: -68 }]);
        }
        expect(observed.blocking, 'caller must not block its own pooled schema initializer').toEqual([]);
        expect(observed.finishedWhileLocked).toBe(true);
      });
    });
  }

  for (const action of ['create', 'complete', 'terminate'] as const) {
    it(`${action} retains lazy schema initialization when no caller connection is supplied`, async (): Promise<void> => {
      await ownedCase(`standalone_${action}`, async context => {
        const storage = await coldStorage(), taskId = `standalone-${randomUUID()}`;
        if (action === 'create') expect(await storage.createCloudTask(createInput(taskId))).toBe(true);
        else if (action === 'complete') expect(await storage.completeCloudTask(taskId, { syntheticResult: 'owned' })).toBe(false);
        else expect(await storage.terminateCloudTaskAndRefund(taskId, 'cancelled', 'SYNTHETIC_STANDALONE')).toEqual({
          status: undefined, transitioned: false, refunded: false, creditCost: 0,
        });
        expect((await context.query("SELECT to_regclass('cloud_tasks') IS NOT NULL AS ready")).rows).toEqual([{ ready: true }]);
      });
    });
  }

  it('a cold caller-owned cancellation commits one refund and repeated cancellation cannot refund again', async (): Promise<void> => {
    await ownedCase('refund_once', async context => {
      await warmSchema();
      const taskId = `paid-${randomUUID()}`;
      await seedTask(context, taskId, true);
      const storage = await coldStorage();
      const observed = await whileLocked(context, taskId, async client => {
        const first = await perform(storage, 'terminate', taskId, client);
        const second = await perform(storage, 'terminate', taskId, client);
        expect(first).toMatchObject({ transitioned: true, refunded: true, creditCost: 68, balance: 100 });
        expect(second).toEqual({ status: undefined, transitioned: false, refunded: false, creditCost: 0 });
        expect((await client.query('SELECT balance,total_used FROM wujie_credits')).rows).toEqual([{ balance: 100, total_used: 0 }]);
        expect((await client.query("SELECT count(*)::int AS n FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([{ n: 1 }]);
        return first;
      }, { commit: true });
      expect(observed.outcome.error).toBeUndefined();
      expect(observed.blocking).toEqual([]);
      expect(observed.finishedWhileLocked).toBe(true);
      expect((await context.query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
        .toEqual([{ status: 'cancelled', credit_status: 'refunded' }]);
      expect(await storage.terminateCloudTaskAndRefund(taskId, 'cancelled', 'SYNTHETIC_REPEAT', undefined,
        { requireActive: true })).toEqual({ status: undefined, transitioned: false, refunded: false, creditCost: 0 });
      expect((await context.query('SELECT balance,total_used FROM wujie_credits')).rows).toEqual([{ balance: 100, total_used: 0 }]);
      expect((await context.query("SELECT count(*)::int AS n FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([{ n: 1 }]);
    });
  });

  for (const action of ['create', 'complete', 'terminate'] as const) {
    it(`${action} propagates caller-transaction schema failure instead of initializing via another connection`, async (): Promise<void> => {
      await ownedCase(`error_${action}`, async context => {
        const storage = await coldStorage(), client = await getPool().connect();
        try {
          await client.query('BEGIN');
          await expect(perform(storage, action, 'missing-task', client)).rejects.toMatchObject({ code: '42P01' });
          await expect(client.query('SELECT 1')).rejects.toMatchObject({ code: '25P02' });
        } finally {
          try { await client.query('ROLLBACK'); }
          finally { client.release(); }
        }
        expect((await context.query("SELECT to_regclass('cloud_tasks') IS NULL AS absent")).rows).toEqual([{ absent: true }]);
      });
    });
  }

  for (const rollbackFails of [false, true]) {
    it(rollbackFails ? 'destroys the caller connection and still drains pending work when lock rollback fails'
      : 'drains pending work before releasing the caller connection after observer failure', async (): Promise<void> => {
      await ownedCase(`observer_failure_${rollbackFails}`, async context => {
        await warmSchema();
        const taskId = `observer-${randomUUID()}`;
        await seedTask(context, taskId);
        const raw = await getPool().connect(), events: string[] = [];
        const observerFailure = new Error('SYNTHETIC_OBSERVER_FAILURE');
        const rollbackFailure = new Error('SYNTHETIC_ROLLBACK_FAILURE');
        let resume!: () => void, ended!: () => void, rollbackFailed = false;
        const gate = new Promise<void>(resolve => { resume = resolve; });
        const pendingEnded = new Promise<void>(resolve => { ended = resolve; });
        const client = new Proxy(raw, { get(target, key) {
          if (key === 'query') return async (...args: unknown[]): Promise<unknown> => {
            const sql = String(args[0]);
            if (rollbackFails && !rollbackFailed && sql.startsWith('ROLLBACK')) {
              rollbackFailed = true; throw rollbackFailure;
            }
            const result: unknown = await Reflect.apply(target.query, target, args);
            if (sql.startsWith('ROLLBACK TO SAVEPOINT')) resume();
            return result;
          };
          if (key === 'release') return (discard?: boolean): void => {
            events.push(`release:${discard === true}`); target.release(discard); resume();
          };
          const value: unknown = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
        let caught: unknown;
        try {
          await whileLocked(context, taskId, async connection => {
            await gate; events.push('pending-query');
            try { return await connection.query('SELECT 1'); }
            finally { events.push('pending-ended'); ended(); }
          }, { connect: async (): Promise<PoolClient> => client,
            observe: async (): Promise<never> => { throw observerFailure; } });
        } catch (error) { caught = error; }
        finally { resume(); await pendingEnded; }
        if (rollbackFails) {
          expect(caught).toBeInstanceOf(AggregateError);
          expect((caught as AggregateError).errors).toEqual(expect.arrayContaining([observerFailure, rollbackFailure]));
          expect(events.filter(value => value.startsWith('release:'))).toEqual(['release:true']);
        } else {
          expect(caught).toBe(observerFailure);
          expect(events.indexOf('pending-ended')).toBeLessThan(events.indexOf('release:false'));
        }
        expect(events).toContain('pending-ended');
        expect((await context.query('SELECT status FROM cloud_tasks WHERE id=$1', [taskId])).rows).toEqual([{ status: 'processing' }]);
      });
    });
  }

  it('retains both errors when pending work has already failed before the observer rejects', async (): Promise<void> => {
    await ownedCase('finished_pending_error', async context => {
      await warmSchema();
      const taskId = `finished-${randomUUID()}`;
      await seedTask(context, taskId);
      const pendingFailure = new Error('SYNTHETIC_FINISHED_PENDING_FAILURE');
      const observerFailure = new Error('SYNTHETIC_LATE_OBSERVER_FAILURE');
      let caught: unknown;
      try {
        await whileLocked(context, taskId, async (): Promise<never> => { throw pendingFailure; }, {
          observe: async (): Promise<never> => {
            // Let the operation's rejection/finally microtasks finish before
            // this already-started observation fails; no timing sleep is used.
            await new Promise<void>(resolve => setImmediate(resolve));
            throw observerFailure;
          },
        });
      } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(AggregateError);
      expect((caught as AggregateError).errors).toEqual([observerFailure, pendingFailure]);
      expect((await context.query('SELECT status FROM cloud_tasks WHERE id=$1', [taskId])).rows).toEqual([{ status: 'processing' }]);
    });
  });
});
