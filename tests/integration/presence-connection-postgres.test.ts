import { Client, Connection, DatabaseError, type PoolClient, type QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

import { withIsolatedPostgres, runPostgresCleanup, type QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

interface BackendIdentity {
  pid: number;
  backend_start: string;
  datname: string;
  usename: string;
}

interface NativeCancellationTransport extends Connection {
  connect: (port: number | string, host?: string) => void;
  cancel: (pid: number, key: number) => void;
}

function isNativeCancellationTransport(connection: Connection): connection is NativeCancellationTransport {
  return 'connect' in connection && typeof connection.connect === 'function'
    && 'cancel' in connection && typeof connection.cancel === 'function';
}

function assertDedicatedDatabase(): void {
  requireOfflineBridgeTestDatabaseUrl(process.env);
}

async function captureIdentity(query: QueryFn): Promise<BackendIdentity> {
  const result = await query<BackendIdentity>(
    'SELECT pid, backend_start::text, datname, usename FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid()',
  );
  if (!result.rows[0]) throw new Error('Owned backend identity missing');
  return result.rows[0];
}

async function recoverOwnedSleep(query: QueryFn, identity: BackendIdentity | undefined): Promise<void> {
  if (!identity) return;
  const result = await query<{ terminated: boolean }>(
    `SELECT pg_catalog.pg_terminate_backend(pid,1000) AS terminated FROM pg_catalog.pg_stat_activity
       WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
       AND pid<>pg_backend_pid()`,
    [identity.pid, identity.backend_start, identity.datname, identity.usename],
  );
  if (result.rows.some(row => !row.terminated)) throw new Error('Owned backend recovery termination was not confirmed');
}

async function withLocalCleanup<T>(
  body: () => Promise<T>, steps: Parameters<typeof runPostgresCleanup>[0],
): Promise<T> {
  let bodyFailed = false;
  let bodyError: unknown;
  try { return await body(); }
  catch (error) { bodyFailed = true; bodyError = error; throw error; }
  finally {
    try { await runPostgresCleanup(steps); }
    catch (cleanupError) {
      if (bodyFailed) throw new AggregateError(
        [bodyError, cleanupError], 'Presence test operation and cleanup failed',
      );
      throw cleanupError;
    }
  }
}

async function retireCapturedControls(clients: Client[]): Promise<void> {
  await runPostgresCleanup(clients.map((client, index) => ({
    name: `retire-captured-control-${index}`,
    run: async (): Promise<void> => {
      const stream = client.connection.stream;
      const closed = stream.closed ? Promise.resolve() : new Promise<void>(resolve => stream.once('close', resolve));
      try {
        const ending = client.end();
        stream.destroy();
        await ending;
      } finally { stream.destroy(); await closed; }
    },
  })));
}

function nestedErrors(error: unknown): unknown[] {
  const children: unknown[] = error instanceof AggregateError ? error.errors : [];
  const cause = error instanceof Error && error.cause !== undefined ? [error.cause] : [];
  return [error, ...children.flatMap(nestedErrors), ...cause.flatMap(nestedErrors)];
}

async function observeWithin<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Production cancellation did not settle within the test observation')), 3_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function observeSleep(query: QueryFn, pid: () => number | undefined): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (performance.now() < deadline) {
    if (pid() !== undefined) {
      const state = await query<{ active: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1
           AND state='active' AND wait_event='PgSleep') AS active`, [pid()],
      );
      if (state.rows[0].active) return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Owned production query did not enter real PostgreSQL sleep');
}

async function observeControlLock(query: QueryFn, identity: () => BackendIdentity | undefined): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (performance.now() < deadline) {
    const current = identity();
    if (current) {
      const state = await query<{ waiting: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid=$1
           AND backend_start=$2::timestamptz AND state='active' AND wait_event_type='Lock') AS waiting`,
        [current.pid, current.backend_start],
      );
      if (state.rows[0].waiting) return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Control did not reach its real PostgreSQL lock');
}

describe('presence authorization connection cancellation error ownership', () => {
  // A local socket close alone must not report successful retirement while
  // the server is still waiting inside the pre-authorization identity query.
  async function exerciseIdentitySampling(controlFailure?: 'connect' | 'connect-after' | 'connect-reset' | 'connect-async-reset' | 'key' | 'key-reset'): Promise<void> {
    assertDedicatedDatabase();
    await withIsolatedPostgres('presence-identity-sampling-abort', async ({ query, schemaName }) => {
      const { withPresenceConnection, PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
      const { getPool } = await import('../../src/lib/db-client');
      const pool = getPool();
      const controller = new AbortController();
      let owned: (PoolClient & Client) | undefined;
      let returnedOwned = false;
      let identity: BackendIdentity | undefined;
      let survivor: PoolClient | undefined;
      let survivorIdentity: BackendIdentity | undefined;
      let pending: Promise<unknown> | undefined;
      let identityReturned = false;
      let identityQueryError: unknown;
      let operationRan = false;
      const controls: Connection[] = [];
      const connectFailure = new Error('Controlled native cancel connect failure');
      const resetFailure = Object.assign(new Error('Controlled native cancel reset'), { code: 'ECONNRESET' });
      let asyncResetObserved = false;
      let nativeCancelCalls = 0;
      const key = (await query<{ key: string }>('SELECT pg_catalog.hashtextextended($1,0)::text AS key', [schemaName])).rows[0].key;
      await withLocalCleanup(async (): Promise<void> => {
        const client = await pool.connect();
        if (!(client instanceof Client)) { client.release(true); throw new Error('Native pg identity checkout required'); }
        owned = client;
        identity = await captureIdentity((text, values) => client.query(text, values));
        survivor = await pool.connect();
        survivorIdentity = await captureIdentity((text, values) => survivor!.query(text, values));
        const timeouts = await client.query<{ statement: string; lock: string }>(
          "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock",
        );
        expect(timeouts.rows[0]).toEqual({ statement: '0', lock: '0' });
        await query('SELECT pg_catalog.pg_advisory_lock($1::bigint)', [key]);
        client.release();
        returnedOwned = true;
        const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult<BackendIdentity>> = Client.prototype.query;
        // Only gate this concrete checkout's next identity-query boundary.
        // The rows, lock wait, driver, TCP and cancellation are native; the
        // pre-captured identity stays test-owned and is not sent to production.
        vi.spyOn(client, 'query').mockImplementationOnce(async function (this: Client): Promise<QueryResult<BackendIdentity>> {
          try {
            const result = await nativeQuery.call(this,
              `WITH gate AS MATERIALIZED (SELECT pg_catalog.pg_advisory_xact_lock($1::bigint))
                 SELECT pid, backend_start::text, datname, usename FROM pg_catalog.pg_stat_activity, gate
                  WHERE pid=pg_backend_pid()`, [key]);
            identityReturned = true;
            return result;
          } catch (error) { identityQueryError = error; throw error; }
        });
        pending = withPresenceConnection(controller.signal, async operationClient => {
          operationRan = true;
          return (await operationClient.query<{ value: number }>('SELECT 42 AS value')).rows[0].value;
        }).then(value => value, (error: unknown): unknown => error);
        await observeControlLock(query, () => identity);
        expect(identityReturned).toBe(false);
        const transport = Connection.prototype;
        if (!isNativeCancellationTransport(transport)) throw new Error('Native cancel transport fixture required');
        const nativeConnect = transport.connect;
        const nativeCancel = transport.cancel;
        vi.spyOn(transport, 'connect').mockImplementationOnce(function (
          this: Connection, port: number | string, host?: string,
        ): void {
          controls.push(this);
          if (controlFailure === 'connect') throw connectFailure;
          if (controlFailure === 'connect-reset') throw resetFailure;
          if (controlFailure === 'connect-async-reset') this.stream.once('error', (error: Error): void => {
            asyncResetObserved = error === resetFailure;
          });
          nativeConnect.call(this, port, host);
          if (controlFailure === 'connect-async-reset') queueMicrotask((): void => { this.stream.destroy(resetFailure); });
          if (controlFailure === 'connect-after') throw connectFailure;
        });
        if (controlFailure === 'connect-async-reset') vi.spyOn(transport, 'cancel').mockImplementation(function (
          this: Connection, pid: number, key: number,
        ): void {
          nativeCancelCalls++;
          nativeCancel.call(this, pid, key);
        });
        if (controlFailure === 'key' || controlFailure === 'key-reset') {
          // Real CancelRequest with a deliberately mismatched key is ignored
          // by PostgreSQL; control EOF must not masquerade as query completion.
          vi.spyOn(transport, 'cancel').mockImplementationOnce(function (this: Connection, pid: number, key: number): void {
            nativeCancel.call(this, pid, key ^ 1);
            // Flush the actual bad-key packet then close only this control
            // transport. Even concrete local EOF is not a cancellation ack.
            this.stream.end((): void => { this.stream.destroy(controlFailure === 'key-reset' ? resetFailure : undefined); });
          });
        }
        controller.abort();
        const result = await observeWithin(pending);
        expect(result).toBeInstanceOf(Error);
        if (controlFailure) {
          expect(result).toBeInstanceOf(PresenceConnectionCleanupError);
          if (controlFailure === 'connect' || controlFailure === 'connect-after') expect(nestedErrors(result)).toContain(connectFailure);
          else if (controlFailure === 'connect-reset' || controlFailure === 'connect-async-reset') expect(nestedErrors(result)).toContain(resetFailure);
          else expect(nestedErrors(result).some(error => error instanceof Error
            && error.message === 'Presence identity query retirement deadline exceeded')).toBe(true);
          if (controlFailure === 'key-reset') expect(nestedErrors(result)).toContain(resetFailure);
          if (controlFailure === 'connect-async-reset') {
            expect(asyncResetObserved).toBe(true);
            expect(nativeCancelCalls).toBe(0);
            expect(nestedErrors(result).some(error => error instanceof Error
              && error.message === 'Presence identity query retirement deadline exceeded')).toBe(false);
          }
        } else {
          expect(result).not.toBeInstanceOf(PresenceConnectionCleanupError);
          expect(result).toBe(identityQueryError);
          expect(result).toBeInstanceOf(DatabaseError);
          if (!(result instanceof DatabaseError)) throw new Error('Native query cancellation response required');
          expect(result.code).toBe('57014');
        }
        expect(controls).toHaveLength(1);
        expect(controls[0].stream.closed).toBe(true);
        expect(operationRan).toBe(false);
        expect(identityReturned).toBe(false);
        expect(client.connection.stream.closed).toBe(true);
        const remaining = await query<{ count: string }>(
          `SELECT count(*) FROM pg_catalog.pg_stat_activity
             WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
          [identity.pid, identity.backend_start, identity.datname, identity.usename],
        );
        if (!controlFailure) expect(Number(remaining.rows[0].count)).toBe(0);
        if (controlFailure === 'connect-async-reset') expect(Number(remaining.rows[0].count)).toBe(1);
        expect(await captureIdentity((text, values) => survivor!.query(text, values))).toEqual(survivorIdentity);
        expect((await survivor.query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
        const replacement = await pool.connect();
        try {
          const nextIdentity = await captureIdentity((text, values) => replacement.query(text, values));
          expect(nextIdentity.pid).not.toBe(identity.pid);
          expect((await replacement.query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
        } finally { replacement.release(); }
      }, [
        { name: 'restore-identity-query-boundary', run: (): void => { vi.restoreAllMocks(); } },
        { name: 'abort-identity-owner', run: (): void => { controller.abort(); } },
        { name: 'unlock-only-identity-gate', run: async (): Promise<void> => { await query('SELECT pg_catalog.pg_advisory_unlock($1::bigint)', [key]); } },
        { name: 'recover-only-identity-backend', run: (): Promise<void> => recoverOwnedSleep(query, identity) },
        { name: 'release-initial-identity-lease', run: (): void => { if (owned && !returnedOwned) owned.release(true); } },
        { name: 'retire-concrete-identity-transport', run: async (): Promise<void> => { if (owned) await retireCapturedControls([owned]); } },
        { name: 'settle-identity-request', run: async (): Promise<void> => { if (pending) await observeWithin(pending); } },
        { name: 'release-unrelated-survivor', run: (): void => { survivor?.release(); } },
      ]);
    });
  }

  postgresIt('retires a backend cancelled before its identity query returns',
    async () => exerciseIdentitySampling(), 10_000);

  postgresIt.each(['connect', 'connect-after', 'connect-reset', 'connect-async-reset', 'key', 'key-reset'] as const)(
    'surfaces uncertain identity-query retirement after cancel %s failure',
    async phase => exerciseIdentitySampling(phase), 10_000,
  );

  // Removing the post-identity abort check must dispatch the business callback
  // even though the real driver returned its rows before this continuation.
  postgresIt('retires a checkout cancelled after native identity rows return but before their continuation', async () => {
    assertDedicatedDatabase();
    await withIsolatedPostgres('presence-identity-rows-abort', async ({ query }) => {
      const { withPresenceConnection, PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
      const { getPool } = await import('../../src/lib/db-client');
      const pool = getPool();
      const controller = new AbortController();
      const reason = new Error('Cancelled after native identity rows returned');
      let owned: (PoolClient & Client) | undefined;
      let returnedOwned = false;
      let identity: BackendIdentity | undefined;
      let survivor: PoolClient | undefined;
      let survivorIdentity: BackendIdentity | undefined;
      let pending: Promise<unknown> | undefined;
      let nativeIdentity: BackendIdentity | undefined;
      let operationRan = false;
      const controls: Connection[] = [];
      await withLocalCleanup(async (): Promise<void> => {
        const client = await pool.connect();
        if (!(client instanceof Client)) { client.release(true); throw new Error('Native pg rows checkout required'); }
        owned = client;
        identity = await captureIdentity((text, values) => client.query(text, values));
        survivor = await pool.connect();
        survivorIdentity = await captureIdentity((text, values) => survivor!.query(text, values));
        const timeouts = await client.query<{ statement: string; lock: string }>(
          "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock",
        );
        expect(timeouts.rows[0]).toEqual({ statement: '0', lock: '0' });
        client.release();
        returnedOwned = true;
        const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult<BackendIdentity>> = Client.prototype.query;
        vi.spyOn(client, 'query').mockImplementationOnce(async function (this: Client): Promise<QueryResult<BackendIdentity>> {
          const result = await nativeQuery.call(this,
            'SELECT pid, backend_start::text, datname, usename FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid()');
          nativeIdentity = result.rows[0];
          // Actual rows have arrived, but production has not resumed to assign
          // its identity yet. No fixture identity is supplied to production.
          controller.abort(reason);
          return result;
        });
        const transport = Connection.prototype;
        if (!isNativeCancellationTransport(transport)) throw new Error('Native rows cancel fixture required');
        const nativeConnect = transport.connect;
        vi.spyOn(transport, 'connect').mockImplementationOnce(function (
          this: Connection, port: number | string, host?: string,
        ): void { controls.push(this); nativeConnect.call(this, port, host); });
        pending = withPresenceConnection(controller.signal, async operationClient => {
          operationRan = true;
          return (await operationClient.query<{ value: number }>('SELECT 42 AS value')).rows[0].value;
        }).then(value => value, (error: unknown): unknown => error);
        const result = await observeWithin(pending);
        expect(nativeIdentity).toEqual(identity);
        expect(controller.signal.aborted).toBe(true);
        expect(operationRan).toBe(false);
        expect(result).toBe(reason);
        expect(result).not.toBeInstanceOf(PresenceConnectionCleanupError);
        expect(controls).toHaveLength(1);
        expect(controls[0].stream.closed).toBe(true);
        expect(client.connection.stream.closed).toBe(true);
        const remaining = await query<{ count: string }>(
          `SELECT count(*) FROM pg_catalog.pg_stat_activity
             WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
          [identity.pid, identity.backend_start, identity.datname, identity.usename],
        );
        expect(Number(remaining.rows[0].count)).toBe(0);
        expect(await captureIdentity((text, values) => survivor!.query(text, values))).toEqual(survivorIdentity);
        expect((await survivor.query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
        const replacement = await pool.connect();
        try {
          const nextIdentity = await captureIdentity((text, values) => replacement.query(text, values));
          expect(nextIdentity.pid).not.toBe(identity.pid);
          expect((await replacement.query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
        } finally { replacement.release(); }
      }, [
        { name: 'restore-rows-query-boundary', run: (): void => { vi.restoreAllMocks(); } },
        { name: 'abort-rows-owner', run: (): void => { controller.abort(); } },
        { name: 'recover-only-rows-backend', run: (): Promise<void> => recoverOwnedSleep(query, identity) },
        { name: 'release-initial-rows-lease', run: (): void => { if (owned && !returnedOwned) owned.release(true); } },
        { name: 'retire-concrete-rows-transport', run: async (): Promise<void> => { if (owned) await retireCapturedControls([owned]); } },
        { name: 'settle-rows-request', run: async (): Promise<void> => { if (pending) await observeWithin(pending); } },
        { name: 'release-unrelated-rows-survivor', run: (): void => { survivor?.release(); } },
      ]);
    });
  }, 10_000);

  // Removing the entry abort check must acquire a real backend for a request
  // already cancelled; removing the post-checkout check must emit SQL on a
  // late lease. These controls leave the real five-slot Pool unchanged.
  postgresIt('does not acquire a backend for an already cancelled request', async () => {
    assertDedicatedDatabase();
    await withIsolatedPostgres('presence-checkout-preabort', async () => {
      const { withPresenceConnection } = await import('../../src/lib/collaboration/presence-connection');
      const { getPool } = await import('../../src/lib/db-client');
      const pool = getPool();
      const acquired: PoolClient[] = [];
      const onAcquire = (client: PoolClient): void => { acquired.push(client); };
      const controller = new AbortController();
      const reason = new Error('Request cancelled before checkout');
      let operationRan = false;
      let pending: Promise<unknown> | undefined;
      await withLocalCleanup(async (): Promise<void> => {
        pool.on('acquire', onAcquire);
        controller.abort(reason);
        pending = withPresenceConnection(controller.signal, async client => {
          operationRan = true;
          return (await client.query<{ value: number }>('SELECT 42 AS value')).rows[0].value;
        }).then(value => value, (error: unknown): unknown => error);
        expect(await observeWithin(pending)).toBe(reason);
        expect(operationRan).toBe(false);
        expect(acquired).toHaveLength(0);
        expect(pool.totalCount).toBe(0);
        expect(pool.waitingCount).toBe(0);
      }, [
        { name: 'remove-preabort-observer', run: (): void => { pool.off('acquire', onAcquire); } },
        { name: 'settle-preabort-request', run: async (): Promise<void> => { if (pending) await observeWithin(pending); } },
      ]);
    });
  }, 10_000);

  async function exerciseLateCheckout(earlyBodyFailure?: Error): Promise<void> {
    assertDedicatedDatabase();
    await withIsolatedPostgres('presence-checkout-late-abort', async ({ query }) => {
      const { withPresenceConnection } = await import('../../src/lib/collaboration/presence-connection');
      const { getPool } = await import('../../src/lib/db-client');
      const pool = getPool();
      const holders: (PoolClient & Client)[] = [];
      const identities: BackendIdentity[] = [];
      const acquired: PoolClient[] = [];
      const recovered: Client[] = [];
      const onAcquire = (client: PoolClient): void => { acquired.push(client); };
      const controller = new AbortController();
      const reason = new Error('Request cancelled while waiting for checkout');
      let pending: Promise<unknown> | undefined;
      let releasedFirst = false;
      let operationRan = false;
      let settled = false;
      const outcome = await withLocalCleanup(async (): Promise<void> => {
        for (let index = 0; index < 5; index++) {
          const client = await pool.connect();
          if (!(client instanceof Client)) { client.release(true); throw new Error('Native pg checkout required'); }
          holders.push(client);
          identities.push(await captureIdentity((text, values) => client.query(text, values)));
          const timeouts = await client.query<{ statement: string; lock: string }>(
            "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock",
          );
          expect(timeouts.rows[0]).toEqual({ statement: '0', lock: '0' });
        }
        expect(pool.totalCount).toBe(5);
        expect(pool.idleCount).toBe(0);
        // Default spy is an observer: all native pg query side effects remain.
        // It detects forbidden identity SQL, not just the operation callback.
        const lateSql = vi.spyOn(holders[0], 'query');
        pool.on('acquire', onAcquire);
        pending = withPresenceConnection(controller.signal, async client => {
          operationRan = true;
          return (await client.query<{ value: number }>('SELECT 42 AS value')).rows[0].value;
        }).then(value => { settled = true; return value; }, (error: unknown): unknown => { settled = true; return error; });
        expect(pool.waitingCount).toBe(1);
        controller.abort(reason);
        // A real network round trip confirms the checkout is still queued;
        // cancellation is not falsely reported as physical resource retirement.
        expect((await query<{ value: number }>('SELECT 1 AS value')).rows[0].value).toBe(1);
        expect(settled).toBe(false);
        expect(pool.waitingCount).toBe(1);
        if (earlyBodyFailure) throw earlyBodyFailure;
        holders[0].release();
        releasedFirst = true;
        expect(await observeWithin(pending)).toBe(reason);
        expect(acquired).toHaveLength(1);
        expect(acquired[0] === holders[0]).toBe(true);
        expect(lateSql.mock.calls).toHaveLength(0);
        expect(operationRan).toBe(false);
        expect(holders[0].connection.stream.closed).toBe(true);
        expect(pool.waitingCount).toBe(0);
        expect(pool.totalCount).toBe(4);
        const retired = await query<{ count: string }>(
          `SELECT count(*) FROM pg_catalog.pg_stat_activity
             WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
          [identities[0].pid, identities[0].backend_start, identities[0].datname, identities[0].usename],
        );
        expect(Number(retired.rows[0].count)).toBe(0);
        for (let index = 1; index < holders.length; index++) {
          expect(await captureIdentity((text, values) => holders[index].query(text, values))).toEqual(identities[index]);
          expect((await holders[index].query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
        }
        const replacement = await pool.connect();
        try {
          const identity = await captureIdentity((text, values) => replacement.query(text, values));
          expect(identity.pid).not.toBe(identities[0].pid);
          expect((await replacement.query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
        } finally { replacement.release(); }
      }, [
        { name: 'restore-late-sql-observer', run: (): void => { vi.restoreAllMocks(); } },
        { name: 'abort-and-release-held-leases', run: async (): Promise<void> => {
          controller.abort(reason);
          await runPostgresCleanup(holders.map((client, index) => ({
            name: `release-held-checkout-${index}`,
            run: (): void => { if (index !== 0 || !releasedFirst) client.release(); },
          })));
          releasedFirst = holders.length > 0;
        } },
        { name: 'recover-only-late-checkout', run: async (): Promise<void> => {
          const client = acquired[0];
          if (client) {
            if (!(client instanceof Client)) throw new Error('Native pg recovery checkout required');
            recovered.push(client);
            await retireCapturedControls([client]);
          }
        } },
        { name: 'settle-late-checkout-request', run: async (): Promise<void> => { if (pending) await observeWithin(pending); } },
        { name: 'remove-late-checkout-observer', run: (): void => { pool.off('acquire', onAcquire); } },
      ]).then(() => undefined, (error: unknown): unknown => error);
      expect(outcome).toBe(earlyBodyFailure);
      if (earlyBodyFailure) {
        expect(acquired).toHaveLength(1);
        expect(acquired[0] === holders[0]).toBe(true);
        expect(recovered).toHaveLength(1);
        expect(recovered[0] === holders[0]).toBe(true);
        expect(holders[0].connection.stream.closed).toBe(true);
        const retired = await query<{ count: string }>(
          `SELECT count(*) FROM pg_catalog.pg_stat_activity
             WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
          [identities[0].pid, identities[0].backend_start, identities[0].datname, identities[0].usename],
        );
        expect(Number(retired.rows[0].count)).toBe(0);
        expect(pool.waitingCount).toBe(0);
        expect((await pool.query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
      }
    });
  }

  postgresIt('retires a late cancelled checkout before SQL without harming other leases',
    async () => exerciseLateCheckout(), 10_000);

  postgresIt('cleanup captures the late checkout when the body fails before releasing a lease',
    async () => exerciseLateCheckout(new Error('Controlled body failure before checkout handoff')), 10_000);

  // A cancelled queued request has acquired no resource. Global-pool cleanup
  // on its native acquisition failure would harm these unrelated live leases;
  // returning success or leaving a waiter would permit a ghost handoff later.
  async function exerciseNativePoolTimeout(suppressSecondRelease = false): Promise<void> {
    assertDedicatedDatabase();
    await withIsolatedPostgres('presence-checkout-native-timeout', async ({ query }) => {
      const { withPresenceConnection, PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
      const { getPool } = await import('../../src/lib/db-client');
      const pool = getPool();
      const holders: (PoolClient & Client)[] = [];
      const identities: BackendIdentity[] = [];
      const borrowed = new Set<PoolClient>();
      const acquired: PoolClient[] = [];
      const onAcquire = (client: PoolClient): void => { acquired.push(client); borrowed.add(client); };
      let secondNativeRelease: (() => void) | undefined;
      let secondReleased = false;
      let releaseSuppressed = false;
      let bodyError: unknown;
      const onRelease = (_error: Error | boolean | undefined, client: PoolClient): void => {
        borrowed.delete(client);
        if (secondNativeRelease && client === holders[0]) secondReleased = true;
      };
      const releaseBorrowed = (): Promise<void> => runPostgresCleanup([...borrowed].map((client, index) => ({
        name: `release-current-timeout-checkout-${index}`,
        run: (): void => { client.release(); },
      })));
      const controller = new AbortController();
      let pending: Promise<unknown> | undefined;
      let operationRan = false;
      let settled = false;
      const outcome = await withLocalCleanup(async (): Promise<void> => {
        pool.on('release', onRelease);
        for (let index = 0; index < 5; index++) {
          const client = await pool.connect();
          if (!(client instanceof Client)) { client.release(true); throw new Error('Native pg timeout checkout required'); }
          holders.push(client);
          borrowed.add(client);
          identities.push(await captureIdentity((text, values) => client.query(text, values)));
          const timeouts = await client.query<{ statement: string; lock: string }>(
            "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock",
          );
          expect(timeouts.rows[0]).toEqual({ statement: '0', lock: '0' });
        }
        expect(pool.totalCount).toBe(5);
        expect(pool.idleCount).toBe(0);
        pool.on('acquire', onAcquire);
        const started = performance.now();
        pending = withPresenceConnection(controller.signal, async client => {
          operationRan = true;
          return (await client.query<{ value: number }>('SELECT 42 AS value')).rows[0].value;
        }).then(value => { settled = true; return value; }, (error: unknown): unknown => { settled = true; return error; });
        expect(pool.waitingCount).toBe(1);
        controller.abort(new Error('Request cancelled during native pool wait'));
        expect((await query<{ value: number }>('SELECT 1 AS value')).rows[0].value).toBe(1);
        expect(settled).toBe(false);
        expect(pool.waitingCount).toBe(1);
        // This awaits the unchanged real ten-second pg-pool timeout. No fake
        // timers, private queue edits or shorter Pool options drive the outcome.
        const result = await pending;
        expect(result).toBeInstanceOf(Error);
        expect(result).not.toBeInstanceOf(PresenceConnectionCleanupError);
        expect(result instanceof Error && /timeout/i.test(result.message)).toBe(true);
        expect(performance.now() - started).toBeGreaterThanOrEqual(9_000);
        expect(operationRan).toBe(false);
        expect(acquired).toHaveLength(0);
        expect(pool.waitingCount).toBe(0);
        expect(pool.totalCount).toBe(5);
        expect(pool.idleCount).toBe(0);
        for (let index = 0; index < holders.length; index++) {
          expect(holders[index].connection.stream.closed).toBe(false);
          expect(await captureIdentity((text, values) => holders[index].query(text, values))).toEqual(identities[index]);
          expect((await holders[index].query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
        }
        expect(pool.ending).toBe(false);
        expect(pool.ended).toBe(false);
        holders[0].release();
        const nextValue = await withPresenceConnection(undefined, async client => {
          expect(client === holders[0]).toBe(true);
          expect(await captureIdentity((text, values) => client.query(text, values))).toEqual(identities[0]);
          if (suppressSecondRelease) {
            secondNativeRelease = client.release;
            vi.spyOn(client, 'release').mockImplementationOnce((): void => { releaseSuppressed = true; });
          }
          return (await client.query<{ value: number }>('SELECT 42 AS value')).rows[0].value;
        });
        expect(nextValue).toBe(42);
        expect(acquired).toHaveLength(1);
        expect(acquired[0] === holders[0]).toBe(true);
        expect(pool.waitingCount).toBe(0);
        expect(pool.totalCount).toBe(5);
        try { expect(pool.idleCount).toBe(1); }
        catch (error) { bodyError = error; throw error; }
        expect(operationRan).toBe(false);
      }, [
        { name: 'restore-timeout-release-boundary', run: (): void => { vi.restoreAllMocks(); } },
        { name: 'abort-timeout-request', run: (): void => { controller.abort(); } },
        { name: 'release-timeout-held-leases', run: releaseBorrowed },
        { name: 'settle-timeout-request', run: async (): Promise<void> => { if (pending) await observeWithin(pending); } },
        { name: 'release-timeout-late-borrowed-leases', run: releaseBorrowed },
        { name: 'remove-timeout-observer', run: (): void => { pool.off('acquire', onAcquire); } },
      ]).then(() => undefined, (error: unknown): unknown => error);
      try {
        if (!suppressSecondRelease) { if (outcome !== undefined) throw outcome; }
        else {
          expect(releaseSuppressed).toBe(true);
          expect(bodyError).toBeInstanceOf(Error);
          expect(bodyError).toMatchObject({ actual: 0, expected: 1 });
          expect(outcome === bodyError).toBe(true);
          expect(borrowed.size).toBe(0);
          expect(pool.waitingCount).toBe(0);
          expect(pool.idleCount).toBe(5);
          expect(secondReleased).toBe(true);
          for (let index = 0; index < holders.length; index++) {
            expect(await captureIdentity((text, values) => holders[index].query(text, values))).toEqual(identities[index]);
            expect((await holders[index].query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
          }
        }
      } finally {
        // Test-only emergency owner keeps a deliberately broken cleanup control
        // from stranding the outer isolation helper. It runs after assertions,
        // so it cannot make the failed recovery look successful.
        try { if (secondNativeRelease && !secondReleased) secondNativeRelease(); }
        finally { pool.off('release', onRelease); }
      }
    });
  }

  postgresIt('reports native pool timeout without retiring unrelated held checkouts',
    async () => exerciseNativePoolTimeout(), 25_000);

  postgresIt('cleanup recovers the second checkout when its production return is suppressed',
    async () => exerciseNativePoolTimeout(true), 25_000);

  // Removing error aggregation must lose the real business query failure even
  // though the independent control connect/query boundary has its own error.
  async function exerciseCancellationFailure(
    phase: 'connect' | 'query', endMode?: 'before' | 'after',
  ): Promise<void> {
    assertDedicatedDatabase();
    await withIsolatedPostgres(`presence-cancel-errors-${phase}`, async ({ query }) => {
      const { withPresenceConnection, PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
      let identity: BackendIdentity | undefined;
      let operationFailure: unknown;
      let pending: Promise<unknown> | undefined;
      const cleanupFailure = new Error(`Controlled cancellation ${phase} boundary failure`);
      const endFailure = new Error(`Controlled end ${endMode} boundary failure`);
      const controlClients: Client[] = [];
      const controller = new AbortController();
      await withLocalCleanup(async (): Promise<void> => {
        pending = withPresenceConnection(controller.signal, async client => {
          identity = await captureIdentity((text, values) => client.query(text, values));
          try { await client.query('SELECT pg_sleep(60)'); }
          catch (error) { operationFailure = error; throw error; }
        }).then(() => undefined, (error: unknown): unknown => error);
        await observeSleep(query, () => identity?.pid);
        // Only the next independent control boundary is injected; the owned
        // business SQL, socket retirement, schema and resource recovery are real.
        if (phase === 'connect') vi.spyOn(Client.prototype, 'connect').mockImplementationOnce(() => { throw cleanupFailure; });
        else vi.spyOn(Client.prototype, 'query').mockImplementationOnce(() => { throw cleanupFailure; });
        if (endMode) {
          const nativeEnd: () => Promise<void> = Client.prototype.end;
          vi.spyOn(Client.prototype, 'end').mockImplementationOnce(function (this: Client): Promise<void> {
            controlClients.push(this);
            if (endMode === 'before') throw endFailure;
            return nativeEnd.call(this).then((): never => { throw endFailure; });
          });
        }
        controller.abort();
        const result = await observeWithin(pending);
        expect(result).toBeInstanceOf(PresenceConnectionCleanupError);
        expect(operationFailure).toBeInstanceOf(Error);
        if (endMode) expect(controlClients[0]?.connection.stream.closed).toBe(true);
        expect(nestedErrors(result)).toContain(cleanupFailure);
        expect(nestedErrors(result)).toContain(operationFailure);
        if (endMode) {
          expect(nestedErrors(result)).toContain(endFailure);
        }
      }, [
          { name: 'restore-control-boundary', run: (): void => { vi.restoreAllMocks(); } },
          { name: 'recover-concrete-control-socket', run: async (): Promise<void> => {
            for (const controlClient of controlClients) {
              const ending = controlClient.end();
              controlClient.connection.stream.destroy();
              await ending;
            }
          } },
          { name: 'recover-only-owned-sleep', run: async (): Promise<void> => {
            await recoverOwnedSleep(query, identity);
          } },
          { name: 'settle-owned-operation', run: async (): Promise<void> => { controller.abort(); if (pending) await observeWithin(pending); } },
      ]);
    });
  }

  postgresIt.each(['connect', 'query'] as const)(
    'preserves real operation and %s cleanup failure', async phase => exerciseCancellationFailure(phase), 10_000,
  );

  // A finally which simply throws the end error loses the previous control
  // error; skipping forced retirement on a synchronous throw leaks its socket.
  postgresIt.each([
    ['connect', 'before'], ['query', 'before'], ['connect', 'after'], ['query', 'after'],
  ] as const)('preserves %s and end %s failures with concrete control socket retirement',
    async (phase, endMode) => exerciseCancellationFailure(phase, endMode), 10_000,
  );

  postgresIt('rejects unconfirmed termination and retires its owned transports', async () => {
    assertDedicatedDatabase();
    await withIsolatedPostgres('presence-termination-false', async ({ query }) => {
      const { withPresenceConnection, PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
      let identity: BackendIdentity | undefined;
      let pending: Promise<unknown> | undefined;
      const controls: Client[] = [];
      const controller = new AbortController();
      await withLocalCleanup(async (): Promise<void> => {
        pending = withPresenceConnection(controller.signal, async client => {
          identity = await captureIdentity((text, values) => client.query(text, values));
          await client.query('SELECT pg_sleep(60)');
        }).then(() => undefined, (error: unknown): unknown => error);
        await observeSleep(query, () => identity?.pid);
        const nativeQuery: (this: Client, text: string) => Promise<QueryResult<{ terminated: boolean }>> = Client.prototype.query;
        // This next-control boundary returns a real PostgreSQL boolean result,
        // not a fake completion. It does not make pg_terminate_backend fail.
        vi.spyOn(Client.prototype, 'query').mockImplementationOnce(function (this: Client): Promise<QueryResult<{ terminated: boolean }>> {
          controls.push(this);
          return nativeQuery.call(this, 'SELECT false AS terminated');
        });
        controller.abort();
        const result = await observeWithin(pending);
        expect(result).toBeInstanceOf(PresenceConnectionCleanupError);
        expect(nestedErrors(result).some(error => error instanceof Error
          && error.message === 'Presence backend termination was not confirmed')).toBe(true);
        expect(controls[0]?.connection.stream.closed).toBe(true);
      }, [
        { name: 'restore-false-boundary', run: (): void => { vi.restoreAllMocks(); } },
        { name: 'retire-false-control', run: (): Promise<void> => retireCapturedControls(controls) },
        { name: 'recover-original-sleep', run: (): Promise<void> => recoverOwnedSleep(query, identity) },
        { name: 'settle-false-operation', run: async (): Promise<void> => { controller.abort(); if (pending) await observeWithin(pending); } },
      ]);
    });
  }, 10_000);

  postgresIt.each([0, 1_100])('holds its checkout until cancellation finishes after the operation completes (%ims second checkout delivery)', async deliveryDelay => {
    assertDedicatedDatabase();
    await withIsolatedPostgres('presence-operation-cancel-race', async ({ query, schemaName }) => {
      const { withPresenceConnection } = await import('../../src/lib/collaboration/presence-connection');
      const { getPool } = await import('../../src/lib/db-client');
      const pool = getPool();
      const controller = new AbortController();
      let releaseOperation: () => void = (): void => {};
      const operationGate = new Promise<void>(resolve => { releaseOperation = resolve; });
      let enteredOperation: () => void = (): void => {};
      const entered = new Promise<void>(resolve => { enteredOperation = resolve; });
      let finishedOperation: () => void = (): void => {};
      const finished = new Promise<void>(resolve => { finishedOperation = resolve; });
      let identity: BackendIdentity | undefined;
      let controlIdentity: BackendIdentity | undefined;
      let pending: Promise<unknown> | undefined;
      let settled = false;
      let second: PoolClient | undefined;
      const controls: Client[] = [];
      const key = (await query<{ key: string }>('SELECT pg_catalog.hashtextextended($1,0)::text AS key', [schemaName])).rows[0].key;
      await withLocalCleanup(async (): Promise<void> => {
        await query('SELECT pg_catalog.pg_advisory_lock($1::bigint)', [key]);
        pending = withPresenceConnection(controller.signal, async client => {
          identity = await captureIdentity((text, values) => client.query(text, values));
          enteredOperation();
          await operationGate;
          const value = await client.query<{ value: number }>('SELECT 42 AS value');
          finishedOperation();
          return value.rows[0].value;
        }).then(value => { settled = true; return value; }, (error: unknown): unknown => { settled = true; return error; });
        await observeWithin(entered);
        // Preparation is not part of the production control's one-second
        // lifetime. Both checkout and its identity must exist before abort.
        second = await pool.connect();
        if (deliveryDelay) await new Promise<void>(resolve => setTimeout(resolve, deliveryDelay));
        const nextIdentity = await captureIdentity((text, values) => second!.query(text, values));
        expect(nextIdentity.pid).not.toBe(identity?.pid);
        const nativeConnect: (this: Client) => Promise<void> = Client.prototype.connect;
        vi.spyOn(Client.prototype, 'connect').mockImplementationOnce(async function (this: Client): Promise<void> {
          controls.push(this);
          await nativeConnect.call(this);
          controlIdentity = await captureIdentity((text, values) => this.query(text, values));
          // Only delay the real control connect boundary. Its original
          // production identity predicates and termination SQL still execute.
          await this.query('SELECT pg_catalog.pg_advisory_xact_lock($1::bigint)', [key]);
        });
        controller.abort();
        await observeControlLock(query, () => controlIdentity);
        releaseOperation();
        await observeWithin(finished);
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(pool.idleCount).toBe(0);
        await observeControlLock(query, () => controlIdentity);
        expect(settled).toBe(false);
        expect(pool.totalCount).toBe(2);
        await query('SELECT pg_catalog.pg_advisory_unlock($1::bigint)', [key]);
        expect(await observeWithin(pending)).toBe(42);
        expect(controls[0]?.connection.stream.closed).toBe(true);
        const remaining = await query<{ count: string }>(
          'SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz',
          [identity?.pid, identity?.backend_start],
        );
        expect(Number(remaining.rows[0].count)).toBe(0);
        expect((await second.query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
        expect(await captureIdentity((text, values) => second!.query(text, values))).toEqual(nextIdentity);
      }, [
        { name: 'restore-race-boundary', run: (): void => { vi.restoreAllMocks(); } },
        { name: 'unlock-control-gate', run: async (): Promise<void> => { await query('SELECT pg_catalog.pg_advisory_unlock($1::bigint)', [key]); } },
        { name: 'release-operation-gate', run: (): void => { releaseOperation(); controller.abort(); } },
        { name: 'release-second-checkout', run: (): void => { second?.release(); } },
        { name: 'recover-race-original', run: (): Promise<void> => recoverOwnedSleep(query, identity) },
        { name: 'recover-race-control', run: (): Promise<void> => recoverOwnedSleep(query, controlIdentity) },
        { name: 'retire-race-controls', run: (): Promise<void> => retireCapturedControls(controls) },
        { name: 'settle-race-operation', run: async (): Promise<void> => { if (pending) await observeWithin(pending); } },
      ]);
    });
  }, 10_000);

  // Removing any backend identity predicate must target this independently
  // owned live session despite the supplied identity not belonging to it.
  postgresIt.each(['backend_start', 'datname', 'usename'] as const)(
    'recovery does not terminate a live backend with mismatched %s', async field => {
      assertDedicatedDatabase();
      await withIsolatedPostgres(`presence-recovery-identity-${field}`, async ({ databaseUrl, query }) => {
        const unrelated = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1_000 });
        unrelated.on('error', (): void => {});
        await withLocalCleanup(async (): Promise<void> => {
          await unrelated.connect();
          const identity = await captureIdentity((text, values) => unrelated.query(text, values));
          const wrongIdentity = { ...identity, [field]: field === 'backend_start' ? '2000-01-01 00:00:00+00' : 'not_this_backend' };
          await recoverOwnedSleep(query, wrongIdentity);
          const alive = await unrelated.query<{ value: number }>('SELECT 1 AS value');
          expect(alive.rows[0].value).toBe(1);
        }, [{ name: 'end-unrelated-control-client', run: (): Promise<void> => unrelated.end() }]);
      });
    }, 10_000,
  );

  postgresIt('recovery terminates the exact owned sleeping backend', async () => {
    assertDedicatedDatabase();
    await withIsolatedPostgres('presence-recovery-exact', async ({ databaseUrl, query }) => {
      const owned = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1_000 });
      owned.on('error', (): void => {});
      let pending: Promise<unknown> | undefined;
      let identity: BackendIdentity | undefined;
      await withLocalCleanup(async (): Promise<void> => {
        await owned.connect();
        identity = await captureIdentity((text, values) => owned.query(text, values));
        pending = owned.query('SELECT pg_sleep(60)').then(() => undefined, (error: unknown): unknown => error);
        await observeSleep(query, () => identity?.pid);
        await recoverOwnedSleep(query, identity);
        expect(await observeWithin(pending)).toBeInstanceOf(Error);
        const remaining = await query<{ count: string }>('SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE pid=$1', [identity.pid]);
        expect(Number(remaining.rows[0].count)).toBe(0);
      }, [
          { name: 'recover-exact-control-backend', run: (): Promise<void> => recoverOwnedSleep(query, identity) },
          { name: 'end-control-client', run: (): Promise<void> => owned.end() },
          { name: 'observe-control-query', run: async (): Promise<void> => { if (pending) await observeWithin(pending); } },
      ]);
    });
  }, 10_000);

  postgresIt('local cleanup preserves the native body and cleanup SQL failures', async () => {
    assertDedicatedDatabase();
    await withIsolatedPostgres('presence-recovery-errors', async ({ query }) => {
      let bodyError: unknown;
      let cleanupError: unknown;
      let laterStepCompleted = false;
      const result = await withLocalCleanup(async (): Promise<void> => {
        try { await query('SELECT * FROM missing_body_relation'); }
        catch (error) { bodyError = error; throw error; }
      }, [
        { name: 'controlled-native-cleanup-failure', run: async (): Promise<void> => {
          try { await query('SELECT * FROM missing_cleanup_relation'); }
          catch (error) { cleanupError = error; throw error; }
        } },
        { name: 'later-real-cleanup-step', run: async (): Promise<void> => {
          const alive = await query<{ value: number }>('SELECT 1 AS value');
          laterStepCompleted = alive.rows[0].value === 1;
        } },
      ]).then(() => undefined, (error: unknown): unknown => error);
      expect(bodyError).toBeInstanceOf(Error);
      expect(cleanupError).toBeInstanceOf(Error);
      expect(nestedErrors(result)).toContain(bodyError);
      expect(nestedErrors(result)).toContain(cleanupError);
      expect(laterStepCompleted).toBe(true);
    });
  }, 10_000);
});
