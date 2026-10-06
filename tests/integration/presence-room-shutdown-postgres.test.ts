import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';

import { Client, type Pool, type PoolClient, type QueryResult } from 'pg';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

import type { PresenceGateway } from '../../src/lib/collaboration/presence-gateway';
import { presenceSnapshotFrameSchema, type PresenceSnapshotFrame } from '../../src/lib/collaboration/presence-schema';
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
    VALUES ('owner','Owner','test','active',1,1),('member','Member','test','active',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project','owner','Project')");
  await query(`INSERT INTO wujie_project_presence_members(project_id,owner_id,member_user_id)
    VALUES ('project','owner','member')`);
}

async function verifySharedRoom(lockRefresh: boolean, controlFault?: Error, delaySecondSnapshot = false, unsubscribeFault?: Error): Promise<void> {
  requireOfflineBridgeTestDatabaseUrl(process.env);
  await withIsolatedPostgres('presence-room-shutdown', async ({ query, databaseUrl, schemaName }) => {
    let gateway: PresenceGateway | undefined;
    let server: Server | undefined;
    let locker: Client | undefined;
    let healthy: (Client & PoolClient) | undefined;
    let pool: Pool | undefined;
    let closePending: Promise<void> | undefined;
    let expectedCloseError: unknown;
    let validatedCloseError: unknown;
    const clients: Array<{ client: WebSocket; frames: PresenceSnapshotFrame[]; closed: Promise<void> }> = [];
    const upgrades: Promise<void>[] = [];
    const acquired = new Set<Client & PoolClient>();
    const callbacks: Promise<void>[] = [];
    const frameErrors: unknown[] = [];
    let restoreQuery: (() => void) | undefined;
    let releaseSecondSnapshot: () => void = (): void => {};
    const secondSnapshotGate = new Promise<void>(resolve => { releaseSecondSnapshot = resolve; });
    let releaseRoomResult: () => void = (): void => undefined;
    const roomResultGate = new Promise<void>(resolve => { releaseRoomResult = resolve; });
    let holdRoomResult = false;
    let roomResultHeld = false;
    let unsubscribeFailed = false;
    const onAcquire = (checkout: PoolClient): void => { if (checkout instanceof Client) acquired.add(checkout); };
    let bodyFailed = false;
    let bodyError: unknown;
    try {
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
      vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
      const businessUrl = new URL(databaseUrl);
      businessUrl.searchParams.set('options', `${businessUrl.searchParams.get('options')} -capplication_name=${schemaName}`);
      process.env.DATABASE_URL = businessUrl.toString();
      process.env.PGDATABASE_URL = businessUrl.toString();
      await seed(query);
      const { getPool } = await import('../../src/lib/db-client');
      const { createPresenceGateway } = await import('../../src/lib/collaboration/presence-gateway');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      pool = getPool();
      pool.on('acquire', onAcquire);
      const checkout = await pool.connect();
      if (!(checkout instanceof Client)) { checkout.release(true); throw new Error('Native healthy checkout required'); }
      healthy = checkout;
      const healthyIdentity = (await healthy.query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
        FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0];
      // Observe actual direct join reads so the later independent lock cannot
      // accidentally target an unfinished initial/post-join snapshot instead.
      // Pool callbacks are forwarded with native null/error argument semantics.
      let directSnapshotsReturned = 0;
      const completedJoins = new Set<AbortSignal>();
      const completedSecondSnapshots = new Set<AbortSignal>();
      const initialReadsReady = (): boolean => completedJoins.size === 2 && completedSecondSnapshots.size === 2;
      let memberSignal: AbortSignal | undefined;
      let secondSnapshotHeld = false;
      let delayedSecondReturned = false;
      const leases = await import('../../src/lib/collaboration/presence-leases');
      if (unsubscribeFault) {
        const actualSubscribe = leases.subscribePresence;
        vi.spyOn(leases, 'subscribePresence').mockImplementation(async (...args): ReturnType<typeof actualSubscribe> => {
          const unsubscribe = await actualSubscribe(...args);
          return async (): Promise<void> => {
            await unsubscribe(); unsubscribeFailed = true; throw unsubscribeFault;
          };
        });
      }
      const actualJoin = leases.joinPresence;
      vi.spyOn(leases, 'joinPresence').mockImplementation(async (input, signal): Promise<Awaited<ReturnType<typeof actualJoin>>> => {
        if (input.userId === 'member') memberSignal = signal;
        const result = await actualJoin(input, signal);
        if (signal) completedJoins.add(signal);
        return result;
      });
      const actualSnapshot = leases.readPresenceSnapshot;
      vi.spyOn(leases, 'readPresenceSnapshot').mockImplementation(async (projectId, signal): Promise<Awaited<ReturnType<typeof actualSnapshot>>> => {
        const held = delaySecondSnapshot && signal !== undefined && signal === memberSignal && completedJoins.has(signal);
        if (held) { secondSnapshotHeld = true; await secondSnapshotGate; }
        const result = await actualSnapshot(projectId, signal);
        if (holdRoomResult && signal && !completedJoins.has(signal)) {
          roomResultHeld = true;
          await roomResultGate;
        }
        if (signal && completedJoins.has(signal)) completedSecondSnapshots.add(signal);
        if (held) delayedSecondReturned = true;
        return result;
      });
      let snapshotLockInstalled = false;
      const snapshotSettings = new Map<Client, { statement: string; lock: string }>();
      const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult> = Client.prototype.query;
      const observer = vi.spyOn(Client.prototype, 'query').mockImplementation(function (
        this: Client, text: unknown, values?: unknown[], callback?: (error: Error, result: QueryResult) => void,
      ): Promise<QueryResult> {
        const operation = (async (): Promise<QueryResult> => {
          if (typeof text !== 'string') throw new Error('Native SQL text required');
          // Fault only the cancellation control's SQL boundary. Its actual
          // connect, original blocked query, transport and cleanup stay real.
          if (controlFault && text.startsWith('SELECT pg_terminate_backend(pid, 500)')) throw controlFault;
          if (snapshotLockInstalled && text.startsWith('SELECT COALESCE((')) {
            const settings: { statement: string; lock: string } = (await nativeQuery.call(this,
              "SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock",
            )).rows[0];
            snapshotSettings.set(this, settings);
          }
          const result = await nativeQuery.call(this, text, values);
          if (!callback && text.startsWith('SELECT COALESCE((')) directSnapshotsReturned += 1;
          return result;
        })();
        if (callback) {
          const delivery = operation.then(result => { Reflect.apply(callback, undefined, [null, result]); },
            (error: unknown): void => { Reflect.apply(callback, undefined, [error]); });
          callbacks.push(delivery);
          void delivery.catch(() => undefined);
        }
        return operation;
      });
      restoreQuery = (): void => { observer.mockRestore(); };
      gateway = createPresenceGateway({ instanceId: 'room-shutdown', reconcileIntervalMs: 60_000 });
      const selectedGateway = gateway;
      server = createPresenceHttpServer({
        onRequest: (_request, response) => response.end('controlled-http'),
        onPresenceUpgrade: (request, socket, head) => {
          const pending = selectedGateway.handlePresenceUpgrade(request, socket, head);
          upgrades.push(pending);
          void pending.catch(() => socket.destroy());
        },
      });
      server.listen(0, '127.0.0.1');
      await within(once(server, 'listening'), 2_000, 'HTTP listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Loopback address required');
      const origin = `http://127.0.0.1:${address.port}`;
      const connect = async (userId: string): Promise<void> => {
        const ticket = await issuePresenceTicket(userId, 'project');
        const client = new WebSocket(`${origin.replace('http:', 'ws:')}/api/collaboration/presence`,
          ['wujie-presence-v1', `wujie-ticket.${ticket}`], { origin, handshakeTimeout: 3_000 });
        const frames: PresenceSnapshotFrame[] = [];
        const closed = new Promise<void>(resolve => client.once('close', () => resolve()));
        clients.push({ client, frames, closed });
        client.on('error', () => undefined);
        client.on('message', raw => {
          try { frames.push(presenceSnapshotFrameSchema.parse(JSON.parse(String(raw)))); }
          catch (error) { frameErrors.push(error); }
        });
        await within(once(client, 'open'), 2_000, `actual ${userId} 101`);
        if (!delaySecondSnapshot || userId !== 'member') await until(async () => frames.length > 0, `actual ${userId} snapshot`);
      };
      await connect('owner');
      await connect('member');
      if (delaySecondSnapshot) {
        await until(async () => completedJoins.size === 2 && secondSnapshotHeld, 'actual member second snapshot held before dispatch');
        // Change the real roster signature so a notification cannot be skipped
        // as a duplicate. The member socket receives a real ROOM snapshot even
        // though its own actual second snapshot has not been dispatched yet.
        await query("UPDATE wujie_users SET name='Member Gate Probe' WHERE id='member'");
        await query("SELECT pg_notify('wujie_presence_changed','project')");
        await until(async () => directSnapshotsReturned >= 4 && clients[1].frames.some(frame =>
          frame.participants.some(person => person.displayName === 'Member Gate Probe')), 'actual room read cannot complete the held client read');
        expect(initialReadsReady(), 'A completed room read cannot stand in for a held client second snapshot').toBe(false);
        releaseSecondSnapshot();
        await until(async () => delayedSecondReturned, 'actual delayed second snapshot returned');
      }
      await until(async () => initialReadsReady() && clients.every(({ frames }) =>
        frames.some(frame => frame.sequence === 2 && frame.participants.length === 2)), 'both joins and second snapshots returned');
      await Promise.all(callbacks);
      expect(frameErrors).toEqual([]);
      expect((await query<{ count: number }>('SELECT count(*)::int AS count FROM wujie_presence_leases')).rows[0].count).toBe(2);

      if (unsubscribeFault) {
        holdRoomResult = true;
        await query("UPDATE wujie_users SET name='Pending Room Result' WHERE id='member'");
        await query("SELECT pg_notify('wujie_presence_changed','project')");
        await until(async () => roomResultHeld, 'real Room snapshot completed but delivery still owned');
        closePending = gateway.close();
        let closeSettled = false;
        let closeError: unknown;
        const observedClose = closePending.then(() => { closeSettled = true; }, (error: unknown): void => {
          closeSettled = true; closeError = error;
        });
        await within(Promise.all(clients.map(({ closed }) => closed)), 2_000, 'physical peers closed before Room drain');
        await until(async () => unsubscribeFailed, 'actual unsubscribe retired its listener then failed');
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(closeSettled, 'Unsubscribe failure cannot finish shutdown before the owned refresh returns').toBe(false);
        releaseRoomResult();
        await within(observedClose, 3_000, 'Room refresh and rejected unsubscribe both drained');
        expect(closeError).toBeInstanceOf(AggregateError);
        const nested = (error: unknown): unknown[] => [error,
          ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
          ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
        ];
        expect(nested(closeError)).toContain(unsubscribeFault);
        validatedCloseError = closeError;
      } else if (!lockRefresh) {
        clients[0].client.terminate();
        await within(clients[0].closed, 2_000, 'first client physical close');
        await until(async () => clients[1].frames.some(frame => frame.sequence === 3
          && frame.participants.length === 1 && frame.participants[0].userId === 'member'), 'surviving room leave notification');
        expect(clients[1].client.readyState).toBe(WebSocket.OPEN);
        // A new peer and the surviving peer must both receive this same room's
        // next actual authoritative roster, not only a new socket's snapshot.
        await connect('owner');
        await until(async () => clients[1].frames.some(frame => frame.sequence === 4 && frame.participants.length === 2)
          && clients[2].frames.some(frame => frame.sequence === 4 && frame.participants.length === 2), 'surviving room new peer');
      } else {
        locker = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
        await locker.connect();
        await locker.query('BEGIN');
        const lockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await locker.query('LOCK TABLE wujie_users IN ACCESS EXCLUSIVE MODE');
        snapshotLockInstalled = true;
        await query("SELECT pg_notify('wujie_presence_changed','project')");
        let waiting: Identity | undefined;
        await until(async () => {
          const result = await query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
            FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1
              AND state='active' AND wait_event_type='Lock' AND $2::int=ANY(pg_blocking_pids(pid))
              AND query LIKE 'SELECT COALESCE((%'`, [schemaName, lockerPid]);
          if (result.rows.length === 1) { waiting = result.rows[0]; return true; }
          return false;
        }, 'actual room notification snapshot SQL lock');
        if (!waiting) throw new Error('Concrete room SQL identity required');
        const owned = [...acquired].find(client => 'processID' in client && client.processID === waiting!.pid);
        expect(owned).toBeDefined();
        expect(snapshotSettings.get(owned!)).toEqual({ statement: '0', lock: '0' });
        const framesBefore = clients.map(({ frames }) => frames.length);
        closePending = gateway.close();
        let closeError: unknown;
        const settled = closePending.then(() => true, (error: unknown): boolean => {
          if (!controlFault) throw error;
          closeError = error;
          return true;
        });
        void settled.catch(() => undefined);
        expect(gateway.close()).toBe(closePending);
        await within(Promise.all(clients.map(({ closed }) => closed)), 2_000, 'both physical WebSocket closes');
        let timer: ReturnType<typeof setTimeout> | undefined;
        let closedWithoutUnlock: boolean;
        try {
          closedWithoutUnlock = await Promise.race([settled, new Promise<false>(resolve => {
            timer = setTimeout(() => resolve(false), 8_000);
          })]);
        } finally { if (timer) clearTimeout(timer); }
        const waiter = (await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
            AND state='active' AND wait_event_type='Lock' AND $5::int=ANY(pg_blocking_pids(pid))`,
        [waiting.pid, waiting.backend_start, waiting.datname, waiting.usename, lockerPid])).rows[0].count;
        expect((await query<{ held: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND granted
          AND mode='AccessExclusiveLock' AND relation='wujie_users'::regclass) AS held`, [lockerPid])).rows[0].held).toBe(true);
        if (controlFault) {
          // Failed cancellation cannot prove server SQL retirement. The
          // caller must receive uncertainty, not a falsely successful close.
          expect(closedWithoutUnlock).toBe(true);
          expect(closeError, 'Room cancellation cleanup failure must reject gateway.close').toBeInstanceOf(AggregateError);
          const nested = (error: unknown): unknown[] => [error,
            ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
            ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
          ];
          const causes = nested(closeError);
          expect(causes).toContain(controlFault);
          const cleanupError = causes.find(error => error instanceof Error
            && error.name === 'PresenceConnectionCleanupError' && error.cause instanceof AggregateError
            && (error.cause.errors as unknown[]).includes(controlFault));
          expect(cleanupError).toBeInstanceOf(Error);
          const compound = (cleanupError as Error).cause as AggregateError;
          expect(compound.errors).toHaveLength(2);
          expect(compound.errors[0]).toBeInstanceOf(Error);
          expect(compound.errors[0]).not.toBe(controlFault);
          expect((compound.errors[0] as Error).message).toMatch(/Connection terminated|terminating connection/u);
          expect(compound.errors[1]).toBe(controlFault);
          validatedCloseError = closeError;
        } else {
          expect({ closedWithoutUnlock, waiter }, 'Shared room refresh must retire before independent lock release')
            .toEqual({ closedWithoutUnlock: true, waiter: 0 });
          expect((await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
              AND (state<>'idle' OR xact_start IS NOT NULL)`,
          [waiting.pid, waiting.backend_start, waiting.datname, waiting.usename])).rows[0].count).toBe(0);
        }
        expect(owned!.connection.stream.closed).toBe(true);
        expect(clients.map(({ frames }) => frames.length)).toEqual(framesBefore);
      }
      closePending ??= gateway.close();
      await within(closePending, 8_000, 'final actual gateway close').catch((error: unknown): void => {
        if (error !== validatedCloseError) throw error;
      });
      expect((await query<{ count: number }>('SELECT count(*)::int AS count FROM wujie_presence_leases')).rows[0].count).toBe(0);
      expect((await query<{ sequence: string }>("SELECT sequence::text FROM wujie_presence_project_sequences WHERE project_id='project'")).rows[0].sequence)
        .toBe(lockRefresh || unsubscribeFault ? '4' : '6');
      expect((await healthy.query<Identity>(`SELECT pid,backend_start::text AS backend_start,datname,usename
        FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0]).toEqual(healthyIdentity);
      expect((await healthy.query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
      expect(healthy.connection.stream.closed).toBe(false);
      expect(pool.ending).toBe(false);
      expect(pool.waitingCount).toBe(0);
      expect(frameErrors).toEqual([]);
      expect(await Promise.allSettled(upgrades)).toEqual(clients.map(() => ({ status: 'fulfilled', value: undefined })));
      expectedCloseError = validatedCloseError;
    } catch (error) { bodyFailed = true; bodyError = error; throw error; }
    finally {
      await runPostgresCleanup([
        { name: 'release-owned-real-room-result', run: releaseRoomResult },
        { name: 'release-delayed-second-snapshot', run: releaseSecondSnapshot },
        { name: 'restore-query-before-unlock', run: (): void => { restoreQuery?.(); } },
        { name: 'remove-checkout-observer', run: (): void => { pool?.off('acquire', onAcquire); } },
        { name: 'rollback-independent-lock', run: async (): Promise<void> => { if (locker) await within(locker.query('ROLLBACK'), 2_000, 'rollback locker'); } },
        { name: 'end-independent-lock', run: async (): Promise<void> => { if (locker) await within(locker.end(), 2_000, 'end locker'); } },
        { name: 'stop-owned-clients', run: (): void => { for (const { client } of clients) client.terminate(); } },
        { name: 'release-healthy-checkout', run: (): void => { healthy?.release(); healthy = undefined; } },
        { name: 'settle-native-callbacks', run: async (): Promise<void> => { await within(Promise.all(callbacks), 12_000, 'native callbacks'); } },
        { name: 'settle-original-close', run: async (): Promise<void> => {
          if (closePending) await within(closePending, 12_000, 'original close').catch((error: unknown): void => {
            if (error !== expectedCloseError) throw error;
          });
        } },
        { name: 'close-gateway', run: async (): Promise<void> => {
          if (gateway) await within(gateway.close(), 12_000, 'gateway cleanup').catch((error: unknown): void => {
            if (error !== expectedCloseError) throw error;
          });
        } },
        { name: 'settle-upgrades', run: async (): Promise<void> => { await within(Promise.allSettled(upgrades), 12_000, 'upgrades'); } },
        { name: 'close-http', run: async (): Promise<void> => {
          if (!server) return;
          server.closeAllConnections();
          await within(new Promise<void>((resolve, reject) => server!.close(error => {
            if (error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')) reject(error);
            else resolve();
          })), 2_000, 'HTTP cleanup');
        } },
        { name: 'restore-observers-and-environment', run: (): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); } },
      ]).catch((cleanupError: unknown): never => {
        if (!bodyFailed) throw cleanupError;
        throw new AggregateError([bodyError, ...(cleanupError instanceof AggregateError ? cleanupError.errors as unknown[] : [cleanupError])],
          'Shared room verification body and cleanup failed');
      });
    }
  });
}

describe('shared presence room shutdown on real PostgreSQL', () => {
  postgresIt('keeps the shared room usable when its first client leaves and another joins', async () => {
    await verifySharedRoom(false);
  }, 20_000);
  postgresIt('retires actual room snapshot SQL before independent lock release during gateway close', async () => {
    await verifySharedRoom(true);
  }, 40_000);
  postgresIt('rejects close when its shared room cancellation control SQL fails', async () => {
    await verifySharedRoom(true, new Error('controlled room termination SQL failure'));
  }, 20_000);
  postgresIt('does not classify a room read as a delayed client second snapshot completion', async () => {
    await verifySharedRoom(false, undefined, true);
  }, 20_000);
  postgresIt('drains an actual completed Room read when unsubscribe fails before its result delivery', async () => {
    await verifySharedRoom(false, undefined, false, new Error('controlled unsubscribe after actual listener retirement'));
  }, 20_000);
});
