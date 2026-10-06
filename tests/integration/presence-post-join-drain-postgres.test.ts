import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';

import { Client, DatabaseError, type PoolClient, type QueryResult } from 'pg';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

import type { PresenceGateway } from '../../src/lib/collaboration/presence-gateway';
import { presenceSnapshotFrameSchema } from '../../src/lib/collaboration/presence-schema';
import { runPostgresCleanup, withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
type Kind = 'renew' | 'leave' | 'expire' | 'prune';
interface Identity { pid: number; backend_start: string; datname: string; usename: string }
interface Target {
  client: Client; identity: Identity; operation: Promise<QueryResult>; error?: unknown;
  settings: { statement: string; lock: string };
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

function isTarget(kind: Kind, text: string): boolean {
  if (kind === 'renew') return /FROM wujie_projects p\s+JOIN wujie_users actor/u.test(text);
  if (kind === 'leave') return text.startsWith('DELETE FROM wujie_presence_leases WHERE connection_id');
  if (kind === 'expire') return text.includes('WITH stale AS MATERIALIZED');
  return text.includes('WITH expired AS MATERIALIZED');
}

function nested(error: unknown): unknown[] {
  return [error, ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
    ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : [])];
}

async function verifyDrain(kind: Kind, backgroundFault?: Error, observeAdditionalFailure?: (error: unknown) => void): Promise<void> {
  requireOfflineBridgeTestDatabaseUrl(process.env);
  await withIsolatedPostgres(`presence-postjoin-${kind}`, async ({ query, databaseUrl, schemaName }) => {
    let gateway: PresenceGateway | undefined; let server: Server | undefined;
    let socket: WebSocket | undefined; let socketClosed: Promise<void> | undefined;
    let locker: Client | undefined; let healthy: (Client & PoolClient) | undefined;
    let stop: (() => Promise<void>) | undefined; let closing: Promise<void> | undefined;
    let validatedCloseError: unknown; let closeValidated = false;
    let restoreQuery: (() => void) | undefined; const restores: Array<() => void> = [];
    const targets: Target[] = []; const deliveries: Promise<void>[] = []; const probes: Promise<QueryResult>[] = [];
    const permittedTargetErrors = new Map<Target, unknown>();
    const finishedConnections = new Set<Target>();
    const frameErrors: unknown[] = []; const upgrades: Promise<void>[] = [];
    let bodyFailed = false; let bodyError: unknown;
    try {
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true'); vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
      vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
      for (const file of ['migrations/20260809_wj_core_users.sql', 'migrations/20260810_wj_stable_s2_assets.sql',
        'migrations/20260924_project_presence.sql', 'migrations/20260924_project_presence_tickets.sql',
        'migrations/20260924_project_presence_ttl_leases.sql']) await query(await readFile(file, 'utf8'));
      await query(`INSERT INTO wujie_users(id,name,password_hash,status,created_at,updated_at)
        VALUES ('owner','Owner','test','active',1,1)`);
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project','owner','Project')");
      const scoped = new URL(databaseUrl);
      scoped.searchParams.set('options', `${scoped.searchParams.get('options')} -capplication_name=${schemaName}`);
      process.env.DATABASE_URL = scoped.toString(); process.env.PGDATABASE_URL = scoped.toString();
      const { getPool } = await import('../../src/lib/db-client');
      const pool = getPool(); const checkout = await pool.connect();
      if (!(checkout instanceof Client)) { checkout.release(true); throw new Error('Actual healthy checkout required'); }
      healthy = checkout;
      const healthyIdentity = (await healthy.query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
        FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0];
      if (backgroundFault) {
        const connections = await import('../../src/lib/collaboration/presence-connection');
        const nativeConnection = connections.withPresenceConnection;
        const connectionSpy = vi.spyOn(connections, 'withPresenceConnection').mockImplementation(async <T>(
          signal: AbortSignal | undefined, operation: (client: PoolClient) => Promise<T>,
        ): Promise<T> => {
          let selected: Client | PoolClient | undefined;
          try {
            return await nativeConnection(signal, client => { selected = client; return operation(client); });
          } finally {
            for (const target of targets) if (target.client === selected) finishedConnections.add(target);
          }
        });
        restores.push(() => connectionSpy.mockRestore());
      }
      const leases = await import('../../src/lib/collaboration/presence-leases');
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const gatewayKind = kind === 'renew' || kind === 'leave';
      let connectionId = 'owned';
      if (gatewayKind) {
        let joinSignal: AbortSignal | undefined; let joinReturned = false; let clientSnapshotReturned = false;
        const nativeJoin = leases.joinPresence; const nativeSnapshot = leases.readPresenceSnapshot;
        const joinSpy = vi.spyOn(leases, 'joinPresence').mockImplementation((input, signal): ReturnType<typeof nativeJoin> => {
          joinSignal = signal;
          return nativeJoin(input, signal).then(result => { joinReturned = true; return result; });
        });
        const snapshotSpy = vi.spyOn(leases, 'readPresenceSnapshot').mockImplementation((projectId, signal): ReturnType<typeof nativeSnapshot> => {
          const clientRead = joinReturned && signal === joinSignal;
          return nativeSnapshot(projectId, signal).then(result => {
            if (clientRead) clientSnapshotReturned = true;
            return result;
          });
        });
        restores.push(() => joinSpy.mockRestore(), () => snapshotSpy.mockRestore());
        const { createPresenceGateway } = await import('../../src/lib/collaboration/presence-gateway');
        const { createPresenceHttpServer } = await import('../../scripts/presence-server');
        gateway = createPresenceGateway({ instanceId: 'postjoin', reconcileIntervalMs: 60_000 });
        const selectedGateway = gateway;
        server = createPresenceHttpServer({ onRequest: (_request, response) => response.end('controlled-http'),
          onPresenceUpgrade: (request, peer, head) => {
            const pending = selectedGateway.handlePresenceUpgrade(request, peer, head);
            upgrades.push(pending); void pending.catch(() => peer.destroy());
          } });
        server.listen(0, '127.0.0.1'); await within(once(server, 'listening'), 2_000, 'HTTP listening');
        const address = server.address(); if (!address || typeof address === 'string') throw new Error('Loopback address required');
        const origin = `http://127.0.0.1:${address.port}`;
        socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/collaboration/presence`,
          ['wujie-presence-v1', `wujie-ticket.${await issuePresenceTicket('owner', 'project')}`], { origin });
        socket.on('error', () => undefined);
        socketClosed = new Promise<void>(resolve => socket!.once('close', () => resolve()));
        let frames = 0;
        socket.on('message', raw => {
          try { const frame = presenceSnapshotFrameSchema.parse(JSON.parse(String(raw))); connectionId = frame.connectionId; frames++; }
          catch (error) { frameErrors.push(error); }
        });
        await within(once(socket, 'open'), 2_000, 'actual 101');
        await until(async () => clientSnapshotReturned && frames > 0, 'real join and client second snapshot delivered');
        await new Promise<void>(resolve => setImmediate(resolve));
      } else {
        await leases.joinPresence({ connectionId, userId: 'owner', projectId: 'project', instanceId: 'maintenance' });
        if (kind === 'expire') await query("UPDATE wujie_presence_leases SET expires_at=clock_timestamp()-interval '1 second'");
        if (kind === 'prune') {
          await issuePresenceTicket('owner', 'project');
          await query("UPDATE wujie_presence_tickets SET expires_at=clock_timestamp()-interval '10 minutes'");
        }
      }
      locker = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
      await locker.connect(); await locker.query('BEGIN');
      const lockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const relation = kind === 'renew' ? 'wujie_users' : kind === 'prune' ? 'wujie_presence_tickets' : 'wujie_presence_leases';
      if (!backgroundFault) {
        if (kind === 'leave') await locker.query('SELECT connection_id FROM wujie_presence_leases WHERE connection_id=$1 FOR UPDATE', [connectionId]);
        else await locker.query(`LOCK TABLE ${relation} IN ACCESS EXCLUSIVE MODE`);
      }
      const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult> = Client.prototype.query;
      const observer = vi.spyOn(Client.prototype, 'query').mockImplementation(function (
        this: Client, text: string, values?: unknown[], callback?: (error: Error, result: QueryResult) => void,
      ): Promise<QueryResult> {
        if (!isTarget(kind, text)) return Reflect.apply(nativeQuery, this, [text, values, callback]) as Promise<QueryResult>;
        const operation = (async (): Promise<QueryResult> => {
          const probe = nativeQuery.call(this, `SELECT pid,backend_start::text AS backend_start,datname,usename,
            current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout
            FROM pg_stat_activity WHERE pid=pg_backend_pid()`);
          probes.push(probe); void probe.catch(() => undefined);
          const identity = (await probe).rows[0] as (Identity & { statement_timeout: string; lock_timeout: string }) | undefined;
          if (!identity) throw new Error('Full target backend identity required');
          const nativeSql = nativeQuery.call(this, text, values);
          // Only fault delivery after the actual expiry SQL completes; neither
          // query results nor the checkout/rollback/transport are simulated.
          const sql = backgroundFault ? nativeSql.then((): never => { throw backgroundFault; }) : nativeSql;
          const target: Target = { client: this, identity, operation: sql,
            settings: { statement: identity.statement_timeout, lock: identity.lock_timeout } };
          targets.push(target);
          void sql.catch((error: unknown): void => { target.error = error; });
          return await sql;
        })();
        void operation.catch(() => undefined);
        if (callback) {
          const delivery = operation.then(result => { Reflect.apply(callback, undefined, [null, result]); },
            (error: unknown): void => { Reflect.apply(callback, undefined, [error]); });
          deliveries.push(delivery); void delivery.catch(() => undefined);
        }
        return operation;
      });
      restoreQuery = (): void => observer.mockRestore();
      if (kind === 'renew') socket!.send(JSON.stringify({ type: 'heartbeat' }));
      if (kind === 'leave') closing = gateway!.close();
      if (!gatewayKind) stop = leases.startPresenceMaintenance(50);
      if (closing) void closing.catch(() => undefined);
      if (backgroundFault) {
        await until(async () => targets.length === 1 && targets[0].error === backgroundFault
          && targets[0].client.connection.stream.closed && finishedConnections.has(targets[0]),
        'actual expiry failure, native helper fully settled and checkout retired before stop');
        await new Promise<void>(resolve => setImmediate(resolve));
        await new Promise<void>(resolve => setTimeout(resolve, 200));
        expect(targets.length, 'A completed background cleanup failure must forbid another actual cycle before stop').toBe(1);
      } else await until(async () => targets.length === 1 && (await query<{ count: number }>(`SELECT count(*)::int AS count
        FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
          AND state='active' AND wait_event_type='Lock' AND $5::int=ANY(pg_blocking_pids(pid))`,
      [targets[0].identity.pid, targets[0].identity.backend_start, targets[0].identity.datname, targets[0].identity.usename, lockerPid])).rows[0].count === 1,
      'concrete post-join SQL held by independent locker');
      const target = targets[0];
      expect(target.settings).toEqual({ statement: '0', lock: '0' });
      if (!closing) closing = gatewayKind ? gateway!.close() : stop!();
      let closeError: unknown;
      const observed = closing.then(() => true, (error: unknown): boolean => { closeError = error; return true; });
      if (socketClosed) await within(socketClosed, 2_000, 'physical client close');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settledBeforeUnlock: boolean;
      try {
        settledBeforeUnlock = await Promise.race([observed, new Promise<false>(resolve => {
          timer = setTimeout(() => resolve(false), 8_000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
      if (!backgroundFault) expect((await query<{ held: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks
        WHERE pid=$1 AND granted AND relation=$2::regclass AND mode=$3) AS held`,
      [lockerPid, relation, kind === 'leave' ? 'RowShareLock' : 'AccessExclusiveLock'])).rows[0].held).toBe(true);
      expect(settledBeforeUnlock, 'Shutdown must own and retire the actual post-join SQL before test unlock').toBe(true);
      expect(target.client.connection.stream.closed).toBe(true);
      expect((await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
      [target.identity.pid, target.identity.backend_start, target.identity.datname, target.identity.usename])).rows[0].count).toBe(0);
      if (backgroundFault) expect(target.error).toBe(backgroundFault);
      else { expect(target.error).toBeInstanceOf(DatabaseError); expect(target.error).toMatchObject({ code: '57P01' }); }
      if (kind === 'renew') {
        expect(closeError).toBeUndefined();
        expect((await query<{ count: number }>('SELECT count(*)::int AS count FROM wujie_presence_leases')).rows[0].count).toBe(0);
      } else {
        if (kind === 'leave') expect(closeError).toBeInstanceOf(AggregateError);
        expect(nested(closeError)).toContain(target.error);
        validatedCloseError = closeError;
      }
      if (gateway) expect(gateway.close()).toBe(closing);
      else expect(stop!()).toBe(closing);
      expect((await healthy.query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
        FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0]).toEqual(healthyIdentity);
      expect((await healthy.query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
      expect(healthy.connection.stream.closed).toBe(false); expect(pool.ending).toBe(false); expect(pool.waitingCount).toBe(0);
      expect(frameErrors).toEqual([]);
      if (!gatewayKind) {
        // Cross multiple real 50ms cycle windows after stop. Observe actual
        // SQL dispatches, not a timer mock or spy call-count assertion.
        await new Promise<void>(resolve => setTimeout(resolve, 200));
        expect(targets.length).toBe(1);
      }
      closeValidated = true;
      permittedTargetErrors.set(target, target.error);
      await locker.query('ROLLBACK');
      if (kind === 'expire') expect((await query<{ count: number }>('SELECT count(*)::int AS count FROM wujie_presence_leases')).rows[0].count).toBe(1);
      if (kind === 'prune') expect((await query<{ count: number }>('SELECT count(*)::int AS count FROM wujie_presence_tickets')).rows[0].count).toBe(1);
      if (kind === 'leave') expect((await query<{ count: number }>('SELECT count(*)::int AS count FROM wujie_presence_leases')).rows[0].count).toBe(1);
      if (observeAdditionalFailure) {
        // Another actual target-shaped SQL fails AFTER the first target's body
        // proof. It has neither a retirement proof nor a cancellation exemption.
        const additional = await healthy.query('WITH stale AS MATERIALIZED (SELECT 1/0 AS invalid) SELECT invalid FROM stale')
          .then(() => undefined, (error: unknown): unknown => error);
        expect(additional).toBeInstanceOf(DatabaseError); expect(additional).toMatchObject({ code: '22012' });
        observeAdditionalFailure(additional);
      }
    } catch (error) { bodyFailed = true; bodyError = error; throw error; }
    finally {
      await runPostgresCleanup([
        { name: 'unlock-independent-locker', run: async (): Promise<void> => { await locker?.query('ROLLBACK'); } },
        { name: 'stop-owned-work', run: async (): Promise<void> => {
          socket?.terminate();
          try { await within(gateway ? gateway.close() : stop?.() ?? Promise.resolve(), 12_000, 'owned work cleanup'); }
          catch (error) { if (!closeValidated || error !== validatedCloseError) throw error; }
          if (socketClosed) await within(socketClosed, 2_000, 'client cleanup');
        } },
        { name: 'drain-real-native-observations', run: async (): Promise<void> => {
          const settled = await Promise.allSettled([...probes, ...deliveries, ...upgrades, ...targets.map(async target => {
            try { await target.operation; }
            catch (error) {
              if (!permittedTargetErrors.has(target) || permittedTargetErrors.get(target) !== error) throw error;
            }
          })]);
          const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
          if (errors.length) throw new AggregateError(errors, 'Native post-join observation failed');
        } },
        { name: 'restore-callthroughs', run: (): void => { restoreQuery?.(); for (const restore of restores) restore(); } },
        { name: 'close-http', run: async (): Promise<void> => {
          if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
        } },
        { name: 'release-healthy-and-locker', run: async (): Promise<void> => { healthy?.release(); await locker?.end(); } },
        { name: 'restore-flags', run: (): void => { vi.unstubAllEnvs(); } },
      ]).catch((cleanupError: unknown): never => {
        if (!bodyFailed) throw cleanupError;
        throw new AggregateError([bodyError, cleanupError], `Post-join body and cleanup failed: ${bodyError instanceof Error ? bodyError.message : 'unknown body error'}`,
          { cause: bodyError });
      });
    }
  });
}

describe('post-join presence SQL shutdown on actual PostgreSQL', () => {
  postgresIt.each(['renew', 'leave', 'expire', 'prune'] as const)('drains its concrete locked checkout before unlock: %s', async kind => {
    await verifyDrain(kind);
  }, 30_000);
  postgresIt('reports a background cleanup-class delivery failure after real expiry SQL without starting another cycle', async () => {
    const { PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
    await verifyDrain('expire', new PresenceConnectionCleanupError(new Error('Controlled post-expiry cleanup delivery failure')));
  }, 20_000);
  postgresIt('preserves an additional actual SQL rejection that has no exact target retirement exemption', async () => {
    const { PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
    let additionalFailure: unknown;
    const result = await verifyDrain('expire', new PresenceConnectionCleanupError(new Error('Controlled original cycle failure')),
      (error: unknown): void => { additionalFailure = error; }).then(() => undefined, (error: unknown): unknown => error);
    expect(additionalFailure).toMatchObject({ code: '22012' });
    expect(result, 'Cleanup must not forgive a new target solely because the first target was validated').toBeInstanceOf(AggregateError);
    expect(nested(result)).toContain(additionalFailure);
  }, 20_000);
});
