import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';

import { Client, DatabaseError, type PoolClient, type QueryResult } from 'pg';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

import type { PresenceGateway } from '../../src/lib/collaboration/presence-gateway';
import { presenceSnapshotFrameSchema } from '../../src/lib/collaboration/presence-schema';
import { runPostgresCleanup, withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
interface Identity { pid: number; backend_start: string; datname: string; usename: string }

async function within<T>(pending: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Observation exceeded: ${label}`)), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Actual condition missing: ${label}`);
}

async function seed(query: QueryFn): Promise<void> {
  for (const file of ['migrations/20260809_wj_core_users.sql', 'migrations/20260810_wj_stable_s2_assets.sql',
    'migrations/20260924_project_presence.sql', 'migrations/20260924_project_presence_tickets.sql',
    'migrations/20260924_project_presence_ttl_leases.sql']) await query(await readFile(file, 'utf8'));
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner','Owner','test','active',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project','owner','Project')");
}

async function verifyListenerShutdown(blockListener: boolean, callbackFault?: Error, onlyClientExit = false): Promise<void> {
  requireOfflineBridgeTestDatabaseUrl(process.env);
  await withIsolatedPostgres('presence-listener-shutdown', async ({ query, databaseUrl, schemaName }) => {
    let gateway: PresenceGateway | undefined;
    let server: Server | undefined;
    let client: WebSocket | undefined;
    let locker: Client | undefined;
    let healthy: (Client & PoolClient) | undefined;
    const listenerIdentities = new Map<Client, Identity>();
    let closePending: Promise<void> | undefined;
    let restoreQuery: (() => void) | undefined;
    const operations: Promise<QueryResult>[] = [];
    const pipelineOperations = new Map<Promise<unknown>, Client>();
    const acknowledgedCancellation = new Set<Client>();
    const verifiedRetirement = new Set<Client>();
    const callbacks: Promise<void>[] = [];
    const upgrades: Promise<void>[] = [];
    let bodyFailed = false;
    let bodyError: unknown;
    const lockKey = 99129301;
    try {
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
      vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
      const scopedUrl = new URL(databaseUrl);
      scopedUrl.searchParams.set('options', `${scopedUrl.searchParams.get('options')} -capplication_name=${schemaName}`);
      process.env.DATABASE_URL = scopedUrl.toString();
      process.env.PGDATABASE_URL = scopedUrl.toString();
      await seed(query);
      const { getPool } = await import('../../src/lib/db-client');
      const { createPresenceGateway } = await import('../../src/lib/collaboration/presence-gateway');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const pool = getPool();
      const checkout = await pool.connect();
      if (!(checkout instanceof Client)) { checkout.release(true); throw new Error('Actual healthy checkout required'); }
      healthy = checkout;
      const healthyIdentity = (await healthy.query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
        FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0];
      locker = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
      await locker.connect();
      const lockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      if (blockListener) await locker.query('SELECT pg_advisory_lock($1)', [lockKey]);
      const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult> = Client.prototype.query;
      const observer = vi.spyOn(Client.prototype, 'query').mockImplementation(function (
        this: Client, text: unknown, values?: unknown[], callback?: (error: Error, result: QueryResult) => void,
      ): Promise<QueryResult> {
        const operation = (async (): Promise<QueryResult> => {
          if (typeof text !== 'string') throw new Error('Native listener SQL text required');
          if (text !== 'LISTEN wujie_presence_changed') return await nativeQuery.call(this, text, values);
          const identity: Identity | undefined = (await nativeQuery.call(this, `SELECT pid,backend_start::text AS backend_start,datname,usename
            FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0];
          if (!identity) throw new Error('Actual listener backend identity required');
          listenerIdentities.set(this, identity);
          const settings = (await nativeQuery.call(this,
            "SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock")).rows[0];
          expect(settings).toEqual({ statement: '0', lock: '0' });
          if (!blockListener) return await nativeQuery.call(this, text, values);
          // Queue an actual held SQL before the actual native LISTEN on this
          // same listener checkout. This is a controlled pipeline stall, not
          // an assertion that LISTEN itself takes a table/advisory lock.
          const blocked = nativeQuery.call(this, 'SELECT pg_advisory_xact_lock($1)', [lockKey]);
          const listen = nativeQuery.call(this, text, values);
          operations.push(blocked, listen);
          pipelineOperations.set(blocked, this); pipelineOperations.set(listen, this);
          void blocked.catch(() => undefined); void listen.catch(() => undefined);
          const settled = await Promise.allSettled([blocked, listen]);
          const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
          if (errors.some(error => error instanceof DatabaseError && error.code === '57P01')) acknowledgedCancellation.add(this);
          if (errors.length > 0) throw new AggregateError(errors, 'Actual listener pipeline failed');
          const result = settled[1];
          if (result.status !== 'fulfilled') throw new Error('Native LISTEN result required');
          return result.value;
        })();
        operations.push(operation);
        if (text === 'LISTEN wujie_presence_changed' && blockListener) pipelineOperations.set(operation, this);
        void operation.catch(() => undefined);
        if (callback) {
          const delivery = operation.then(result => {
            Reflect.apply(callback, undefined, [null, result]);
            if (callbackFault && text === 'SELECT 314 AS callback_probe') throw callbackFault;
          },
            (error: unknown): void => { Reflect.apply(callback, undefined, [error]); });
          callbacks.push(delivery); void delivery.catch(() => undefined);
        }
        return operation;
      });
      restoreQuery = (): void => { observer.mockRestore(); };
      gateway = createPresenceGateway({ instanceId: 'listener-shutdown', reconcileIntervalMs: 60_000 });
      const selected = gateway;
      server = createPresenceHttpServer({
        onRequest: (_request, response) => response.end('controlled-http'),
        onPresenceUpgrade: (request, socket, head) => {
          const upgrade = selected.handlePresenceUpgrade(request, socket, head);
          upgrades.push(upgrade); void upgrade.catch(() => socket.destroy());
        },
      });
      server.listen(0, '127.0.0.1');
      await within(once(server, 'listening'), 2_000, 'actual HTTP listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Loopback address required');
      const origin = `http://127.0.0.1:${address.port}`;
      client = new WebSocket(`${origin.replace('http:', 'ws:')}/api/collaboration/presence`,
        ['wujie-presence-v1', `wujie-ticket.${await issuePresenceTicket('owner', 'project')}`], { origin });
      client.on('error', () => undefined);
      const physicallyClosed = new Promise<void>(resolve => client!.once('close', () => resolve()));
      const initialMessage = blockListener ? undefined : once(client, 'message');
      void initialMessage?.catch(() => undefined);
      await within(once(client, 'open'), 3_000, 'actual client WebSocket 101');
      if (blockListener) {
        await until(async () => {
          if (listenerIdentities.size !== 1) return false;
          const listenerIdentity = [...listenerIdentities.values()][0];
          const result = await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
              AND application_name=$5 AND state='active' AND wait_event_type='Lock'
              AND $6::int=ANY(pg_blocking_pids(pid)) AND query='SELECT pg_advisory_xact_lock($1)'`,
          [listenerIdentity.pid, listenerIdentity.backend_start, listenerIdentity.datname, listenerIdentity.usename, schemaName, lockerPid]);
          return result.rows[0].count === 1;
        }, 'actual listener pipeline lock');
        expect((await query('SELECT 1 FROM wujie_presence_leases')).rowCount).toBe(1);
      } else {
        if (!initialMessage) throw new Error('Initial message owner required');
        const [raw] = await within(initialMessage, 3_000, 'actual initial snapshot');
        const frame = presenceSnapshotFrameSchema.parse(JSON.parse(String(raw)));
        expect(frame.sequence).toBe(1); expect(frame.participants[0].userId).toBe('owner');
      }
      if (callbackFault) {
        expect((await pool.query<{ callback_probe: number }>('SELECT 314 AS callback_probe')).rows[0].callback_probe).toBe(314);
      }
      if (onlyClientExit) {
        client.close();
        await within(physicallyClosed, 2_000, 'initializing client physically closed');
        await until(async () => (await query('SELECT 1 FROM wujie_presence_leases')).rowCount === 0,
          'physical client exit reclaims its lease while the independent lock remains held');
        await until(async () => [...listenerIdentities.keys()][0]?.connection.stream.closed === true,
          'physical client exit retires listener before gateway shutdown');
      }
      closePending = gateway.close();
      void closePending.catch(() => undefined);
      expect(gateway.close()).toBe(closePending);
      await within(physicallyClosed, 2_000, 'actual WebSocket close');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let closedBeforeUnlock: boolean;
      try {
        closedBeforeUnlock = await Promise.race([closePending.then(() => true), new Promise<false>(resolve => {
          timer = setTimeout(() => resolve(false), 8_000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
      const listenerEntry = [...listenerIdentities.entries()][0];
      if (!listenerEntry || listenerIdentities.size !== 1) throw new Error('Exactly one paired listener checkout and identity required');
      const [listenerClient, listenerIdentity] = listenerEntry;
      const remaining = (await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
          AND (state<>'idle' OR xact_start IS NOT NULL)`,
      [listenerIdentity.pid, listenerIdentity.backend_start, listenerIdentity.datname, listenerIdentity.usename])).rows[0].count;
      if (blockListener) {
        expect((await query<{ held: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1
          AND locktype='advisory' AND objid=$2::oid AND granted) AS held`, [lockerPid, lockKey])).rows[0].held).toBe(true);
      }
      expect({ closedBeforeUnlock, remaining, tcpClosed: listenerClient.connection.stream.closed })
        .toEqual({ closedBeforeUnlock: true, remaining: 0, tcpClosed: true });
      expect((await query('SELECT 1 FROM wujie_presence_leases')).rowCount).toBe(0);
      expect((await healthy.query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
        FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0]).toEqual(healthyIdentity);
      expect((await healthy.query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
      expect(healthy.connection.stream.closed).toBe(false); expect(pool.ending).toBe(false);
      expect((await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
      [listenerIdentity.pid, listenerIdentity.backend_start, listenerIdentity.datname, listenerIdentity.usename])).rows[0].count).toBe(0);
      if (blockListener) verifiedRetirement.add(listenerClient);
    } catch (error) { bodyFailed = true; bodyError = error; throw error; }
    finally {
      await runPostgresCleanup([
        { name: 'restore-native-query', run: (): void => { restoreQuery?.(); } },
        { name: 'release-independent-advisory-lock', run: async (): Promise<void> => {
          if (locker) await within(locker.query('SELECT pg_advisory_unlock($1)', [lockKey]), 2_000, 'independent unlock');
        } },
        { name: 'end-independent-locker', run: async (): Promise<void> => { if (locker) await within(locker.end(), 2_000, 'locker end'); } },
        { name: 'stop-actual-client', run: (): void => { client?.terminate(); } },
        { name: 'release-healthy-checkout', run: (): void => { healthy?.release(); healthy = undefined; } },
        { name: 'settle-original-close', run: async (): Promise<void> => { if (closePending) await within(closePending, 12_000, 'original close'); } },
        { name: 'close-gateway', run: async (): Promise<void> => { if (gateway) await within(gateway.close(), 12_000, 'gateway close'); } },
        { name: 'settle-native-observations', run: async (): Promise<void> => {
          const observed = [...operations, ...callbacks, ...upgrades];
          const settled = await within(Promise.allSettled(observed), 12_000, 'native observations');
          const cancelled = (error: unknown): boolean => error instanceof AggregateError
            ? error.errors.length > 0 && (error.errors as unknown[]).every(cancelled)
            : (error instanceof DatabaseError && error.code === '57P01')
              || (error instanceof Error && error.message === 'Connection terminated unexpectedly');
          const errors = settled.flatMap((result, index) => {
            if (result.status !== 'rejected') return [];
            const target = pipelineOperations.get(observed[index]);
            if (target && verifiedRetirement.has(target) && acknowledgedCancellation.has(target)
              && cancelled(result.reason)) return [];
            return [result.reason as unknown];
          });
          if (errors.length > 0) throw new AggregateError(errors, 'Actual listener observation or delivery failed');
        } },
        { name: 'close-http', run: async (): Promise<void> => {
          if (!server) return;
          server.closeAllConnections();
          await within(new Promise<void>((resolve, reject) => server!.close(error => { if (error) reject(error); else resolve(); })), 2_000, 'HTTP close');
        } },
        { name: 'restore-mocks-and-environment', run: (): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); } },
      ]).catch((cleanupError: unknown): never => {
        if (!bodyFailed) throw cleanupError;
        throw new AggregateError([bodyError, cleanupError], 'Listener body and cleanup failed');
      });
    }
  });
}

describe('presence listener ownership on actual PostgreSQL', () => {
  postgresIt.each([false, true])('retires the listener checkout during close (held pipeline: %s)', async held => {
    await verifyListenerShutdown(held);
  }, 40_000);
  postgresIt('retains a callback delivery failure after its actual SQL result was consumed', async () => {
    const fault = new Error('controlled actual SQL callback delivery failure');
    let observed: unknown;
    try { await verifyListenerShutdown(false, fault); }
    catch (error) { observed = error; }
    const nested = (error: unknown): unknown[] => [error,
      ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
      ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
    ];
    expect(observed).toBeInstanceOf(AggregateError);
    expect(nested(observed)).toContain(fault);
  }, 40_000);
  postgresIt('owns the last client exit during listener initialization without waiting for gateway shutdown', async () => {
    await verifyListenerShutdown(true, undefined, true);
  }, 40_000);
});
