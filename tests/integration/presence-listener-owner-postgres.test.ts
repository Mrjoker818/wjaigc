import { Client, type Pool, type PoolClient, type QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

import type { PresenceListenerOwner, PresenceListenerToken } from '../../src/lib/collaboration/presence-listener';
import { runPostgresCleanup, withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
interface Identity { pid: number; backend_start: string; datname: string; usename: string }
type Checkout = Client & PoolClient;
interface Context {
  owner: PresenceListenerOwner;
  pool: Pool;
  query: QueryFn;
  healthy: Checkout;
  held: Set<Checkout>;
  acquired: Set<Checkout>;
  identities: Map<Client, Identity>;
  dispatchedSql: Map<Client, string[]>;
  events: string[];
  expectedCloseErrors: Map<PresenceListenerToken, unknown>;
  retain: (signal?: AbortSignal) => PresenceListenerToken;
  release: (client: Checkout) => void;
  listener: () => Promise<{ identity: Identity; client: Checkout }>;
}

async function within<T>(pending: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Observation exceeded: ${label}`)), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 4_000;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Actual condition missing: ${label}`);
}

async function withOwner(run: (context: Context) => Promise<void>): Promise<void> {
  requireOfflineBridgeTestDatabaseUrl(process.env);
  await withIsolatedPostgres('presence-listener-owner', async ({ databaseUrl, schemaName, query }) => {
    let pool: Pool | undefined;
    const held = new Set<Checkout>();
    const acquired = new Set<Checkout>();
    const identities = new Map<Client, Identity>();
    const dispatchedSql = new Map<Client, string[]>();
    const tokens: PresenceListenerToken[] = [];
    const expectedCloseErrors = new Map<PresenceListenerToken, unknown>();
    const onAcquire = (client: PoolClient): void => { if (client instanceof Client) acquired.add(client); };
    const release = (client: Checkout): void => { if (held.delete(client)) client.release(); };
    const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult<Identity>> = Client.prototype.query;
    const queryObserver = vi.spyOn(Client.prototype, 'query').mockImplementation(function (
      this: Client, text: string, values?: unknown[],
    ): Promise<QueryResult<Identity>> {
      const sql = dispatchedSql.get(this) ?? [];
      sql.push(text); dispatchedSql.set(this, sql);
      const pending = nativeQuery.call(this, text, values);
      if (/SELECT\s+pid,\s*backend_start::text\s+AS\s+backend_start,\s*datname,\s*usename\s+FROM\s+pg_stat_activity\s+WHERE\s+pid=pg_backend_pid\(\)/i.test(text)) {
        void pending.then(result => { if (result.rows[0]) identities.set(this, result.rows[0]); }).catch(() => undefined);
      }
      return pending;
    });
    let bodyFailed = false;
    let bodyError: unknown;
    try {
      const scoped = new URL(databaseUrl);
      scoped.searchParams.set('options', `${scoped.searchParams.get('options')} -capplication_name=${schemaName}`);
      process.env.DATABASE_URL = scoped.toString(); process.env.PGDATABASE_URL = scoped.toString();
      const { getPool } = await import('../../src/lib/db-client');
      pool = getPool(); pool.on('acquire', onAcquire);
      const healthy = await pool.connect();
      if (!(healthy instanceof Client)) { healthy.release(true); throw new Error('Actual healthy client required'); }
      held.add(healthy);
      const healthyIdentity = (await healthy.query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
        FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0];
      const { createPresenceListenerOwner } = await import('../../src/lib/collaboration/presence-listener');
      const events: string[] = [];
      const owner = createPresenceListenerOwner(projectId => { events.push(projectId); });
      const retain = (signal?: AbortSignal): PresenceListenerToken => { const token = owner.retain(signal); tokens.push(token); return token; };
      const listener = async (): Promise<{ identity: Identity; client: Checkout }> => {
        const rows = (await query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
          FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1
            AND query='LISTEN wujie_presence_changed' AND state='idle'`, [schemaName])).rows;
        expect(rows).toHaveLength(1);
        const identity = rows[0];
        const client = [...acquired].find(value => {
          const sampled = identities.get(value);
          return sampled?.pid === identity.pid && sampled.backend_start === identity.backend_start
            && sampled.datname === identity.datname && sampled.usename === identity.usename;
        });
        if (!client) throw new Error('Concrete listener checkout required');
        return { identity, client };
      };
      await run({ owner, pool, query, healthy, held, acquired, identities, dispatchedSql, events, expectedCloseErrors, retain, release, listener });
      expect((await healthy.query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
        FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0]).toEqual(healthyIdentity);
      expect((await healthy.query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
      expect(healthy.connection.stream.closed).toBe(false); expect(pool.ending).toBe(false);
    } catch (error) { bodyFailed = true; bodyError = error; throw error; }
    finally {
      await runPostgresCleanup([
        { name: 'release-test-held-checkouts-before-late-producer-drain', run: (): void => { for (const client of [...held]) release(client); } },
        { name: 'close-every-owned-token', run: async (): Promise<void> => {
          const settled = await within(Promise.allSettled(tokens.map(async token => {
            try { await token.close(); }
            catch (error) {
              // Only a body-asserted failure of this exact token is expected.
              if (!expectedCloseErrors.has(token) || expectedCloseErrors.get(token) !== error) throw error;
            }
          })), 15_000, 'token cleanup');
          const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
          if (errors.length > 0) throw new AggregateError(errors, 'Listener token cleanup failed');
        } },
        { name: 'remove-checkout-observer', run: (): void => { pool?.off('acquire', onAcquire); } },
        { name: 'restore-native-query-observer', run: (): void => { queryObserver.mockRestore(); } },
      ]).catch((cleanupError: unknown): never => {
        if (!bodyFailed) throw cleanupError;
        throw new AggregateError([bodyError, cleanupError], 'Listener owner body and cleanup failed');
      });
    }
  });
}

async function fillPool(context: Context): Promise<void> {
  while (context.held.size < context.pool.options.max) {
    const checkout = await context.pool.connect();
    if (!(checkout instanceof Client)) { checkout.release(true); throw new Error('Native held checkout required'); }
    context.held.add(checkout);
  }
}

describe('shared presence listener owner on actual PostgreSQL', () => {
  postgresIt('retains the same actual listener for a survivor and retires it after the final token', async () => {
    await withOwner(async context => {
      const first = context.retain(); const survivor = context.retain();
      await within(Promise.all([first.ready, survivor.ready]), 3_000, 'both listener tokens ready');
      const original = await context.listener();
      const closeFirst = first.close(); expect(first.close()).toBe(closeFirst);
      await within(closeFirst, 2_000, 'first token close without survivor cancellation');
      await context.query("SELECT pg_notify('wujie_presence_changed','survivor-probe')");
      await until(async () => context.events.includes('survivor-probe'), 'actual survivor notification');
      expect((await context.listener()).identity).toEqual(original.identity);
      expect(original.client.connection.stream.closed).toBe(false);
      await within(survivor.close(), 3_000, 'last listener token close');
      expect(original.client.connection.stream.closed).toBe(true);
      expect((await context.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
      [original.identity.pid, original.identity.backend_start, original.identity.datname, original.identity.usename])).rows[0].count).toBe(0);
    });
  }, 20_000);

  postgresIt.each(['late-checkout', 'pool-timeout'] as const)('owns cancelled acquisition through its actual terminal: %s', async kind => {
    await withOwner(async context => {
      await fillPool(context);
      const controller = new AbortController();
      const token = context.retain(controller.signal);
      let readyError: unknown;
      const ready = token.ready.catch((error: unknown): void => { readyError = error; });
      await until(async () => context.pool.waitingCount === 1, 'actual pool queued acquisition');
      const heldBefore = new Set(context.held);
      const heldIdentities = new Map<Checkout, Identity>();
      for (const checkout of heldBefore) {
        const identity = (await checkout.query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
          FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0];
        if (!identity) throw new Error('Actual pre-acquisition backend identity required');
        heldIdentities.set(checkout, identity);
      }
      const acquireEvents: Checkout[] = [];
      const onLateAcquire = (checkout: PoolClient): void => { if (checkout instanceof Client) acquireEvents.push(checkout); };
      context.pool.on('acquire', onLateAcquire);
      try {
        const reason = new Error(`controlled acquisition cancellation: ${kind}`);
        controller.abort(reason);
        let closed = false;
        const close = token.close().then(() => { closed = true; });
        void close.catch(() => undefined);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(closed, 'Do not abandon the actual acquisition producer').toBe(false);
        if (kind === 'late-checkout') {
          const available = [...context.held].find(client => client !== context.healthy);
          if (!available) throw new Error('Actual non-healthy slot required');
          context.dispatchedSql.set(available, []);
          context.release(available);
        }
        await within(close, kind === 'pool-timeout' ? 12_000 : 3_000, 'actual cancelled acquisition completion');
        await within(ready, 2_000, 'cancelled token ready observation');
        expect(readyError).toBe(reason);
        expect(context.pool.waitingCount).toBe(0);
        if (kind === 'late-checkout') {
          expect(acquireEvents).toHaveLength(1);
          expect(heldBefore.has(acquireEvents[0])).toBe(true);
          expect(acquireEvents[0].connection.stream.closed).toBe(true);
          expect(context.dispatchedSql.get(acquireEvents[0]), 'Cancelled checkout must dispatch no SQL at all').toEqual([]);
          const identity = heldIdentities.get(acquireEvents[0]);
          if (!identity) throw new Error('Exact pre-sampled late client identity required');
          expect((await context.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
          [identity.pid, identity.backend_start, identity.datname, identity.usename])).rows[0].count).toBe(0);
        } else expect(acquireEvents).toHaveLength(0);
        expect((await context.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE query='LISTEN wujie_presence_changed' AND datname=current_database()`)).rows[0].count).toBe(0);
      } finally { context.pool.off('acquire', onLateAcquire); }
    });
  }, 25_000);

  postgresIt('recovers after the actual listening backend is terminated while a token remains', async () => {
    await withOwner(async context => {
      const token = context.retain(); await within(token.ready, 3_000, 'initial ready');
      const original = await context.listener();
      expect((await context.query<{ stopped: boolean }>(`SELECT pg_terminate_backend(pid,500) AS stopped
        FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
      [original.identity.pid, original.identity.backend_start, original.identity.datname, original.identity.usename])).rows[0].stopped).toBe(true);
      await until(async () => {
        const result = await context.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname=current_database() AND query='LISTEN wujie_presence_changed' AND pid<>$1`, [original.identity.pid]);
        return result.rows[0].count === 1;
      }, 'actual replacement listener');
      const replacement = await context.listener(); expect(replacement.identity.pid).not.toBe(original.identity.pid);
      expect(original.client.connection.stream.closed).toBe(true);
      await context.query("SELECT pg_notify('wujie_presence_changed','reconnected-probe')");
      await until(async () => context.events.includes('reconnected-probe'), 'actual reconnected delivery');
      await token.close(); expect(replacement.client.connection.stream.closed).toBe(true);
    });
  }, 20_000);

  postgresIt('degrades after an actual LISTEN initialization error and retries while its token remains', async () => {
    await withOwner(async context => {
      const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult<Identity>> = Client.prototype.query;
      let failedClient: Client | undefined;
      let databaseFailure: unknown;
      // Fail the LISTEN boundary with an actual PostgreSQL error, not a fake
      // query result. Acquisition, identity sampling and retry stay native.
      const spy = vi.spyOn(Client.prototype, 'query').mockImplementation(function (
        this: Client, text: string, values?: unknown[],
      ): Promise<QueryResult<Identity>> {
        if (text === 'LISTEN wujie_presence_changed' && !failedClient) {
          [failedClient] = [this];
          const pending = nativeQuery.call(this, 'SELECT 1/0');
          void pending.catch((error: unknown): void => { databaseFailure = error; });
          return pending;
        }
        return nativeQuery.call(this, text, values);
      });
      try {
        const token = context.retain();
        await within(token.ready, 3_000, 'ordinary initialization fallback');
        expect(databaseFailure).toMatchObject({ code: '22012' });
        if (!failedClient) throw new Error('Actual failed initialization checkout required');
        expect(failedClient.connection.stream.closed).toBe(true);
        const failedIdentity = context.identities.get(failedClient);
        if (!failedIdentity) throw new Error('Full failed initialization identity required');
        expect((await context.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
        [failedIdentity.pid, failedIdentity.backend_start, failedIdentity.datname, failedIdentity.usename])).rows[0].count).toBe(0);
        await until(async () => (await context.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname=current_database() AND query='LISTEN wujie_presence_changed'`)).rows[0].count === 1,
        'actual retry after failed LISTEN initialization');
        const replacement = await context.listener();
        expect(replacement.identity.pid).not.toBe(failedIdentity.pid);
        await context.query("SELECT pg_notify('wujie_presence_changed','after-initialization-fallback')");
        await until(async () => context.events.includes('after-initialization-fallback'), 'retried listener delivery');
        await token.close(); expect(replacement.client.connection.stream.closed).toBe(true);
      } finally { spy.mockRestore(); }
    });
  }, 20_000);

  postgresIt('does not let retirement of the previous listener erase a newly retained epoch', async () => {
    await withOwner(async context => {
      const first = context.retain(); await within(first.ready, 3_000, 'first epoch ready');
      const original = await context.listener();
      const retiring = first.close();
      const successor = context.retain();
      await within(Promise.all([retiring, successor.ready]), 4_000, 'retire and successor acquire');
      const replacement = await context.listener();
      expect(replacement.identity.pid).not.toBe(original.identity.pid);
      expect(original.client.connection.stream.closed).toBe(true);
      await context.query("SELECT pg_notify('wujie_presence_changed','successor-probe')");
      await until(async () => context.events.includes('successor-probe'), 'actual successor delivery');
      expect((await context.listener()).identity).toEqual(replacement.identity);
      await successor.close(); expect(replacement.client.connection.stream.closed).toBe(true);
    });
  }, 20_000);

  postgresIt('cancels one initializing token without abandoning the surviving acquisition', async () => {
    await withOwner(async context => {
      await fillPool(context);
      const controller = new AbortController();
      const first = context.retain(controller.signal); const survivor = context.retain();
      const reason = new Error('Only the first initializing subscriber left');
      const firstReady = first.ready.catch((error: unknown): unknown => error);
      await until(async () => context.pool.waitingCount === 1, 'one real shared queued acquisition');
      controller.abort(reason);
      await within(first.close(), 1_000, 'non-final initializing token close');
      expect(await firstReady).toBe(reason);
      expect(context.pool.waitingCount).toBe(1);
      const available = [...context.held].find(client => client !== context.healthy);
      if (!available) throw new Error('Actual non-healthy slot required');
      context.release(available);
      await within(survivor.ready, 3_000, 'survivor initialization');
      const active = await context.listener();
      await context.query("SELECT pg_notify('wujie_presence_changed','initializing-survivor')");
      await until(async () => context.events.includes('initializing-survivor'), 'survivor initialized delivery');
      await survivor.close(); expect(active.client.connection.stream.closed).toBe(true);
    });
  }, 20_000);

  postgresIt('does not reconnect after the final token closes a disconnected epoch', async () => {
    await withOwner(async context => {
      const token = context.retain(); await token.ready;
      const original = await context.listener();
      await context.query(`SELECT pg_terminate_backend(pid,500) FROM pg_stat_activity
        WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
      [original.identity.pid, original.identity.backend_start, original.identity.datname, original.identity.usename]);
      await until(async () => original.client.connection.stream.closed, 'original disconnected TCP');
      const acquiredBefore = new Set(context.acquired);
      await token.close();
      // Real elapsed time crosses the production 1000ms retry window.
      await new Promise<void>(resolve => setTimeout(resolve, 1_200));
      expect(context.acquired.size).toBe(acquiredBefore.size);
      expect([...context.acquired].every(client => acquiredBefore.has(client))).toBe(true);
      expect((await context.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE query='LISTEN wujie_presence_changed' AND datname=current_database()`)).rows[0].count).toBe(0);
    });
  }, 20_000);

  postgresIt('propagates uncertain retirement with the original control failure instead of successful close', async () => {
    await withOwner(async context => {
      const { PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
      const token = context.retain(); await token.ready;
      const original = await context.listener();
      const failure = new Error('Controlled independent retirement control connect failure');
      const controls: Client[] = [];
      // Only the independent control-connect boundary fails; actual listener
      // acquisition, identity query, LISTEN and target TCP retirement stay real.
      const spy = vi.spyOn(Client.prototype, 'connect').mockImplementationOnce(function (this: Client): never {
        controls.push(this); throw failure;
      });
      let failedWaiter: PresenceListenerToken | undefined;
      let retirementFailure: unknown;
      try {
        const closing = token.close();
        failedWaiter = context.retain();
        const waitingReady = failedWaiter.ready.catch((error: unknown): unknown => error);
        const result = await within(closing.then(() => undefined, (error: unknown): unknown => error), 3_000, 'uncertain retirement');
        expect(result).toBeInstanceOf(PresenceConnectionCleanupError);
        expect((result as Error).cause).toBe(failure);
        expect(original.client.connection.stream.closed).toBe(true);
        expect(controls).toHaveLength(1); expect(controls[0].connection.stream.closed).toBe(true);
        context.expectedCloseErrors.set(token, result);
        expect(await waitingReady).toBe(result);
        retirementFailure = result;
      } finally { spy.mockRestore(); }
      if (!failedWaiter) throw new Error('Actual waiter on retiring epoch required');
      const waiterClosing = failedWaiter.close();
      const successor = context.retain();
      expect(failedWaiter.close()).toBe(waiterClosing);
      expect(await waiterClosing.then(() => undefined, (error: unknown): unknown => error),
        'A new retain cannot erase the pending close rejection of its old epoch').toBe(retirementFailure);
      context.expectedCloseErrors.set(failedWaiter, retirementFailure);
      await within(successor.ready, 3_000, 'new subscription after the failed epoch has fully closed');
      const replacement = await context.listener();
      expect(replacement.identity.pid).not.toBe(original.identity.pid);
      await context.query("SELECT pg_notify('wujie_presence_changed','after-reported-retirement-failure')");
      await until(async () => context.events.includes('after-reported-retirement-failure'), 'fresh epoch delivery after reported failure');
      await successor.close(); expect(replacement.client.connection.stream.closed).toBe(true);
      expect(await token.close().then(() => undefined, (error: unknown): unknown => error)).toBe(context.expectedCloseErrors.get(token));
    });
  }, 20_000);
});
