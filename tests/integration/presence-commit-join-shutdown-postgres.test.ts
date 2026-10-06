import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { get, type Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { Client, type Pool, type PoolClient, type QueryResult } from 'pg';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

import type { PresenceGateway } from '../../src/lib/collaboration/presence-gateway';
import { runPostgresCleanup, withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
type Stage = 'ticket-commit' | 'lease-join' | 'join-snapshot' | 'post-join-member' | 'post-join-snapshot';
interface BackendIdentity { pid: number; backend_start: string; datname: string; usename: string }

// Test-only resource owner shared by the real compensation fixture and its
// failure-path control. Native acquisitions, SQL and transports remain real.
function createCompensationHolderSetup(
  pool: Pool, holders: (PoolClient & Client)[], borrowed: Set<PoolClient & Client>,
  onSaturated: () => void, continueSetup: () => void,
  delayCheckout?: (client: PoolClient & Client) => Promise<void>,
): { start: () => Promise<void>; cleanup: () => Promise<void> } {
  let producer: Promise<void> | undefined;
  let extraCheckout: Promise<void> | undefined;
  let closing = false;
  const releaseBorrowed = (): Promise<void> => runPostgresCleanup([...borrowed].map((client, index) => ({
    name: `release-compensation-holder-${index}`,
    run: (): void => { client.release(); borrowed.delete(client); },
  })));
  const start = (): Promise<void> => {
    if (producer) return producer;
    producer = (async (): Promise<void> => {
      for (let index = 0; index < 4; index++) {
        if (closing) return;
        const client = await pool.connect();
        if (!(client instanceof Client)) { client.release(true); throw new Error('Native compensation holder required'); }
        let retained = false;
        try {
          if (closing) return;
          if (delayCheckout) await delayCheckout(client);
          if (closing) return;
          holders.push(client);
          borrowed.add(client);
          retained = true;
        } finally { if (!retained) client.release(); }
      }
      if (closing) return;
      extraCheckout = pool.connect().then(client => {
        if (!(client instanceof Client)) { client.release(true); throw new Error('Native fifth compensation holder required'); }
        if (closing) { client.release(); return; }
        holders.push(client);
        borrowed.add(client);
        onSaturated();
      });
      void extraCheckout.catch(() => undefined);
      continueSetup();
    })();
    void producer.catch(() => undefined);
    return producer;
  };
  return { start, cleanup: (): Promise<void> => {
    // Close admission synchronously. Waiting for native acquisition remains
    // owned; a late concrete checkout is released before any continuation.
    closing = true;
    return runPostgresCleanup([
      { name: 'release-current-compensation-holders', run: releaseBorrowed },
      { name: 'settle-compensation-holder-producer', run: async (): Promise<void> => {
        if (producer) await observeWithin(producer, 12_000, 'cleanup holder producer');
      } },
      { name: 'settle-fifth-compensation-holder', run: async (): Promise<void> => {
        if (extraCheckout) await observeWithin(extraCheckout, 12_000, 'cleanup fifth holder');
      } },
      { name: 'release-late-compensation-holders', run: releaseBorrowed },
    ]);
  } };
}

async function observeWithin<T>(pending: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Test observation exceeded: ${label}`)), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function setupDatabase(query: QueryFn): Promise<void> {
  for (const path of [
    'migrations/20260809_wj_core_users.sql', 'migrations/20260810_wj_stable_s2_assets.sql',
    'migrations/20260924_project_presence.sql', 'migrations/20260924_project_presence_tickets.sql',
    'migrations/20260924_project_presence_ttl_leases.sql',
  ]) await query(await readFile(path, 'utf8'));
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner','Owner','test','active',1,1), ('member','Member','test','active',1,1)`);
  await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('project','owner','Project')");
  await query(`INSERT INTO wujie_project_presence_members (project_id,owner_id,member_user_id)
    VALUES ('project','owner','member')`);
}

async function waitForSqlLock(
  query: QueryFn, lockerPid: number, applicationName: string, stage: Stage | 'compensation-delete',
  observationMs = 3_000,
): Promise<BackendIdentity> {
  const deadline = performance.now() + observationMs;
  while (performance.now() < deadline) {
    // The compensation fixture's observer also owns an open lock transaction;
    // PostgreSQL statistics must not reuse that transaction's old snapshot.
    if (stage === 'compensation-delete') await query('SELECT pg_stat_clear_snapshot()');
    const result = await query<BackendIdentity>(`SELECT pid, backend_start::text AS backend_start, datname, usename
      FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1
        AND state='active' AND wait_event_type='Lock' AND $2::int=ANY(pg_blocking_pids(pid))
        AND query LIKE $3`,
    [applicationName, lockerPid, stage === 'ticket-commit' ? 'COMMIT'
      : stage === 'compensation-delete' ? 'DELETE FROM wujie_presence_leases%'
        : stage === 'join-snapshot' || stage === 'post-join-snapshot' ? 'SELECT COALESCE((%'
          : stage === 'post-join-member' ? 'SELECT 1%' : '%FOR SHARE OF p%']);
    if (result.rows.length === 1) return result.rows[0];
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Real ${stage} did not reach its independent PostgreSQL lock`);
}

async function rejectedAfterClose(server: Server): Promise<number> {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback HTTP address required');
  return new Promise<number>((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', port: address.port, path: '/api/collaboration/presence',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket' } }, response => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.once('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Late 101 after close')); });
    request.once('error', reject);
    request.setTimeout(1_000, () => request.destroy(new Error('Admission observation timed out')));
  });
}

async function verifyLockedShutdown(stage: Stage, faults: {
  closeFailure?: Error;
  earlyBodyFailure?: Error;
  snapshotCompensation?: 'delete-failure' | 'delete-locked';
  earlyPostJoinBodyFailure?: Error;
  lateCleanupProducer?: () => void;
  postJoinControlFailure?: Error;
} = {}): Promise<void> {
  requireOfflineBridgeTestDatabaseUrl(process.env);
  await withIsolatedPostgres(`presence-${stage}-shutdown`, async ({ databaseUrl, schemaName, query }) => {
    const postJoin = stage === 'post-join-member' || stage === 'post-join-snapshot';
    let locker: Client | undefined;
    let healthy: (PoolClient & Client) | undefined;
    let gateway: PresenceGateway | undefined;
    let server: Server | undefined;
    let client: WebSocket | undefined;
    let rawSocket: Duplex | undefined;
    let closePending: Promise<void> | undefined;
    let snapshotCheckout: (PoolClient & Client) | undefined;
    let snapshotCheckoutReleased = false;
    let snapshotIdentity: BackendIdentity | undefined;
    let acknowledgedJoin = false;
    let committedConnectionId: string | undefined;
    let firstSnapshotReturned = false;
    let postJoinMemberReturned = false;
    let closedClient = false;
    let lateHeartbeatTimers = 0;
    const heartbeatTimers = new Set<ReturnType<typeof setTimeout>>();
    const callbackDeliveries: Promise<void>[] = [];
    let restorePostJoinQuery: (() => void) | undefined;
    let snapshotCloseError: unknown;
    let expectedSnapshotCloseError: unknown;
    const cancellationControls = new Set<Client>();
    let observedPool: Pool | undefined;
    const acquired = new Set<PoolClient & Client>();
    const onAcquire = (checkout: PoolClient): void => {
      if (checkout instanceof Client) acquired.add(checkout);
    };
    const upgrades: Promise<void>[] = [];
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
      await setupDatabase(query);
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const { createPresenceGateway } = await import('../../src/lib/collaboration/presence-gateway');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const { getPool } = await import('../../src/lib/db-client');
      const ticket = await issuePresenceTicket('member', 'project');
      const ticketHash = createHash('sha256').update(ticket).digest('hex');
      const pool = getPool();
      observedPool = pool;
      pool.on('acquire', onAcquire);
      const checkout = await pool.connect();
      if (!(checkout instanceof Client)) { checkout.release(true); throw new Error('Native healthy lease required'); }
      healthy = checkout;
      const originalHealthy = (await healthy.query<BackendIdentity>(
        'SELECT pid, backend_start::text AS backend_start, datname, usename FROM pg_stat_activity WHERE pid=pg_backend_pid()',
      )).rows[0];
      expect((await healthy.query<{ statement_timeout: string; lock_timeout: string }>(
        "SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout",
      )).rows[0]).toEqual({ statement_timeout: '0', lock_timeout: '0' });
      locker = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
      await locker.connect();
      await locker.query('BEGIN');
      const lockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      if (stage === 'ticket-commit') {
        // A real deferred trigger blocks COMMIT, not an earlier UPDATE or a query spy.
        await query(`CREATE FUNCTION hold_ticket_commit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_SCHEMA), 751); RETURN NEW; END $$`);
        await query(`CREATE CONSTRAINT TRIGGER hold_ticket_commit AFTER UPDATE ON wujie_presence_tickets
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hold_ticket_commit()`);
        await locker.query('SELECT pg_advisory_xact_lock(hashtext($1), 751)', [schemaName]);
      } else if (stage === 'lease-join') {
        // Plain live membership reads pass; only the lease's FOR SHARE is blocked.
        await locker.query("SELECT id FROM wujie_projects WHERE id='project' FOR UPDATE");
      } else if (postJoin) {
        // Preserve Pool.query's third callback while observing actual native
        // SQL. No result, error or cancellation is replaced by this observer.
        const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult> = Client.prototype.query;
        const observer = vi.spyOn(Client.prototype, 'query').mockImplementation(function (
          this: Client, text: unknown, values?: unknown[], callback?: (error: Error, result: QueryResult) => void,
        ): Promise<QueryResult> {
          const operation = (async (): Promise<QueryResult> => {
            if (typeof text !== 'string') throw new Error('Expected native post-join SQL');
            const targetsLockedSql = (stage === 'post-join-member' && firstSnapshotReturned
              && text.startsWith('SELECT 1') && text.includes('FROM wujie_projects p'))
              || (stage === 'post-join-snapshot' && postJoinMemberReturned && text.startsWith('SELECT COALESCE(('));
            if (targetsLockedSql) {
              expect((await nativeQuery.call(this,
                "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock",
              )).rows[0]).toEqual({ statement: '0', lock: '0' });
            }
            const result = await nativeQuery.call(this, text, values);
            if (text.includes('INSERT INTO wujie_presence_leases')) committedConnectionId = String(values?.[0]);
            if (text === 'COMMIT' && committedConnectionId) acknowledgedJoin = true;
            const isFirstSnapshot = !firstSnapshotReturned && text.startsWith('SELECT COALESCE((');
            const isPostJoinMember = firstSnapshotReturned && !postJoinMemberReturned
              && text.startsWith('SELECT 1') && text.includes('FROM wujie_projects p');
            if (isFirstSnapshot) firstSnapshotReturned = true;
            if (isPostJoinMember) postJoinMemberReturned = true;
            if ((stage === 'post-join-member' && isFirstSnapshot)
              || (stage === 'post-join-snapshot' && isPostJoinMember)) {
              // The preceding real query has completed. Only the NEXT read
              // must wait on this independent lock; lease cleanup is unblocked.
              await locker!.query('LOCK TABLE wujie_users IN ACCESS EXCLUSIVE MODE');
            }
            return result;
          })();
          if (callback) {
            // pg's callback overload types do not express native null success
            // or absent failure result. Preserve those real runtime arguments.
            const delivered = operation.then(result => { Reflect.apply(callback, undefined, [null, result]); }, (error: unknown): void => {
              Reflect.apply(callback, undefined, [error instanceof Error ? error : new Error(String(error))]);
            });
            callbackDeliveries.push(delivered);
            void delivered.catch(() => undefined);
          }
          return operation;
        });
        // Restore the observer only during cleanup: post-join Pool.query must
        // deliver its callback normally, and all derived promises stay owned.
        restorePostJoinQuery = (): void => { observer.mockRestore(); };
        const nativeSetTimeout = globalThis.setTimeout;
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(function (
          callback: (...args: never[]) => void, delay?: number, ...args: unknown[]
        ): ReturnType<typeof setTimeout> {
          // Reflect preserves every runtime argument across Node's overloaded
          // native timer API; this is not a fake clock or callback replacement.
          const timer = Reflect.apply(nativeSetTimeout, globalThis, [callback, delay, ...args]) as ReturnType<typeof setTimeout>;
          if (delay === 45_000) {
            heartbeatTimers.add(timer);
            if (closedClient) lateHeartbeatTimers += 1;
          }
          return timer;
        });
      } else {
        if (faults.snapshotCompensation === 'delete-failure') {
          await query(`CREATE FUNCTION fail_snapshot_compensation() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'controlled first snapshot compensation delete failure'; END $$`);
          await query(`CREATE TRIGGER fail_snapshot_compensation BEFORE DELETE ON wujie_presence_leases
            FOR EACH ROW EXECUTE FUNCTION fail_snapshot_compensation()`);
        }
        const checkout = await pool.connect();
        if (!(checkout instanceof Client)) { checkout.release(true); throw new Error('Native initial snapshot checkout required'); }
        snapshotCheckout = checkout;
        snapshotIdentity = (await checkout.query<BackendIdentity>(
          'SELECT pid, backend_start::text AS backend_start, datname, usename FROM pg_stat_activity WHERE pid=pg_backend_pid()',
        )).rows[0];
        expect((await checkout.query<{ statement: string; lock: string }>(
          "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock",
        )).rows[0]).toEqual({ statement: '0', lock: '0' });
        const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult> = Client.prototype.query;
        const observer = vi.spyOn(checkout, 'query').mockImplementation(async function (
          this: Client, text: unknown, values?: unknown[],
        ): Promise<QueryResult> {
          if (typeof text !== 'string') throw new Error('Expected real initial-join SQL');
          const result = await nativeQuery.call(this, text, values);
          if (text.includes('INSERT INTO wujie_presence_leases')) {
            if (typeof values?.[0] !== 'string') throw new Error('Actual committed connection identity required');
            committedConnectionId = values[0];
          }
          if (text === 'COMMIT' && committedConnectionId && !acknowledgedJoin) {
            acknowledgedJoin = true;
            // Only AFTER real lease COMMIT, acquire an independent relation
            // lock used by snapshot SELECT but not leave/sequence compensation.
            await locker!.query('LOCK TABLE wujie_users IN ACCESS EXCLUSIVE MODE');
            if (faults.snapshotCompensation === 'delete-locked') {
              await locker!.query('SELECT connection_id FROM wujie_presence_leases WHERE connection_id=$1 FOR UPDATE',
                [committedConnectionId]);
            }
            // Pool.query uses a third callback; preserve its native API before
            // the real first snapshot can acquire this concrete checkout.
            observer.mockRestore();
          }
          return result;
        });
        checkout.release();
        snapshotCheckoutReleased = true;
      }
      gateway = createPresenceGateway({ instanceId: 'commit-join-shutdown',
        ...(postJoin ? { reconcileIntervalMs: 60_000 } : {}) });
      const selectedGateway = gateway;
      server = createPresenceHttpServer({
        onRequest: (_request, response) => response.end('controlled-http'),
        onPresenceUpgrade: (request, socket, head) => {
          rawSocket = socket;
          const pending = selectedGateway.handlePresenceUpgrade(request, socket, head);
          upgrades.push(pending);
          void pending.catch(() => socket.destroy());
        },
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Loopback address required');
      const origin = `http://127.0.0.1:${address.port}`;
      client = new WebSocket(`${origin.replace('http:', 'ws:')}/api/collaboration/presence`,
        ['wujie-presence-v1', `wujie-ticket.${ticket}`], { origin, handshakeTimeout: 12_000 });
      client.on('error', () => undefined);
      let upgraded = 0;
      let frames = 0;
      client.on('upgrade', () => { upgraded += 1; });
      client.on('message', () => { frames += 1; });
      const clientClosed = new Promise<void>(resolve => client!.once('close', () => { closedClient = true; resolve(); }));
      if (stage !== 'ticket-commit') await observeWithin(once(client, 'open'), 3_000, 'real 101 open');
      const waiting = await waitForSqlLock(query, lockerPid, schemaName, stage);
      expect(upgraded).toBe(stage === 'ticket-commit' ? 0 : 1);
      expect(waiting.pid === originalHealthy.pid || waiting.pid === lockerPid).toBe(false);
      const lockedCheckout = [...acquired].find(checkout => 'processID' in checkout && checkout.processID === waiting.pid);
      if (stage === 'join-snapshot' || postJoin) {
        expect(acknowledgedJoin).toBe(true);
        if (!postJoin) expect(waiting).toEqual(snapshotIdentity);
        else {
          expect(firstSnapshotReturned).toBe(true);
          expect(postJoinMemberReturned).toBe(stage === 'post-join-snapshot');
          expect(lockedCheckout).toBeDefined();
        }
        expect((await query<{ connection_id: string }>('SELECT connection_id FROM wujie_presence_leases')).rows)
          .toEqual([{ connection_id: committedConnectionId }]);
        expect((await query<{ sequence: string }>(
          "SELECT sequence::text FROM wujie_presence_project_sequences WHERE project_id='project'",
        )).rows[0].sequence).toBe('1');
      }
      const actualClose = gateway.close();
      closePending = faults.closeFailure ? actualClose.then((): never => { throw faults.closeFailure; }) : actualClose;
      const settled = closePending.then(() => true, (error: unknown): boolean => {
        if (!faults.snapshotCompensation && !faults.postJoinControlFailure) throw error;
        snapshotCloseError = error;
        return true;
      });
      // Own rejection immediately, even if a body assertion skips the later
      // race. This observer does not replace the original rejecting promise.
      void settled.catch(() => undefined);
      expect(gateway.close() === actualClose).toBe(true);
      await observeWithin(clientClosed, 2_000, 'actual WebSocket shutdown');
      expect(rawSocket?.closed).toBe(true);
      expect(await rejectedAfterClose(server)).toBe(503);
      if (faults.postJoinControlFailure) {
        if (stage !== 'post-join-member') throw new Error('Post-join member control required');
        // Wait for the actual successful lease cleanup before faulting the
        // independent cancellation connection. No pool acquisition is replaced.
        const cleanupDeadline = performance.now() + 2_000;
        let leaseCleaned = false;
        while (performance.now() < cleanupDeadline) {
          const cleaned = await query<{ leases: number; sequence: string }>(`SELECT
            (SELECT count(*)::int FROM wujie_presence_leases) AS leases,
            (SELECT sequence::text FROM wujie_presence_project_sequences WHERE project_id='project') AS sequence`);
          if (cleaned.rows[0].leases === 0 && cleaned.rows[0].sequence === '2') { leaseCleaned = true; break; }
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
        expect(leaseCleaned, 'Actual lease cleanup must commit before the control transport fault').toBe(true);
        vi.spyOn(Client.prototype, 'connect').mockImplementationOnce(function (this: Client): Promise<void> {
          cancellationControls.add(this);
          return Promise.reject(faults.postJoinControlFailure);
        });
      }
      if (faults.earlyPostJoinBodyFailure) throw faults.earlyPostJoinBodyFailure;
      if (faults.earlyBodyFailure) {
        // This is a test-cleanup ownership control, not a successful shutdown
        // business case. Permit real shutdown, then fail BEFORE the race owner.
        await locker.query('ROLLBACK');
        await closePending.catch(() => undefined);
        await query('SELECT 1');
        throw faults.earlyBodyFailure;
      }
      // Snapshot cancellation occurs at the gateway's real five-second grace.
      // Keep BOTH independent locks held while observing compensation DELETE.
      const compensationWaiting = faults.snapshotCompensation === 'delete-locked'
        ? await waitForSqlLock(query, lockerPid, schemaName, 'compensation-delete', 8_000) : undefined;
      const compensationCheckout = compensationWaiting ? [...acquired].find(checkout =>
        'processID' in checkout && checkout.processID === compensationWaiting.pid) : undefined;
      if (compensationWaiting) {
        expect(compensationCheckout).toBeDefined();
        expect(compensationWaiting.pid).not.toBe(waiting.pid);
      }
      // This budget observes bounded ownership; it is not a production/global SLA.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let finishedWithoutUnlock: boolean;
      try {
        finishedWithoutUnlock = await Promise.race([settled, new Promise<false>(resolve => {
          timer = setTimeout(() => resolve(false), 8_000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
      const waiter = await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
          AND state='active' AND wait_event_type='Lock' AND $5::int=ANY(pg_blocking_pids(pid))`,
      [waiting.pid, waiting.backend_start, waiting.datname, waiting.usename, lockerPid]);
      expect((await query<{ held: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks
        WHERE pid=$1 AND granted AND locktype=$2) AS held`,
      [lockerPid, stage === 'ticket-commit' ? 'advisory' : stage === 'lease-join' ? 'transactionid' : 'relation'])).rows[0].held).toBe(true);
      if (stage === 'join-snapshot' || postJoin) {
        expect((await query<{ held: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks
          WHERE pid=$1 AND granted AND mode='AccessExclusiveLock' AND relation='wujie_users'::regclass) AS held`,
        [lockerPid])).rows[0].held).toBe(true);
      }
      if (compensationWaiting) {
        const blockedCompensation = await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
            AND state='active' AND wait_event_type='Lock' AND $5::int=ANY(pg_blocking_pids(pid))`,
        [compensationWaiting.pid, compensationWaiting.backend_start, compensationWaiting.datname,
          compensationWaiting.usename, lockerPid]);
        expect((await query<{ held: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks
          WHERE pid=$1 AND granted AND locktype='transactionid') AS held`, [lockerPid])).rows[0].held).toBe(true);
        expect({ finishedWithoutUnlock, blockedCompensationSql: blockedCompensation.rows[0].count },
          'Shutdown must retire its actual compensation DELETE while the independent row lock remains held')
          .toEqual({ finishedWithoutUnlock: true, blockedCompensationSql: 0 });
      }
      if (faults.postJoinControlFailure) {
        // Failed cancellation cannot establish server-side SQL retirement.
        // Own local close and preserve uncertainty; finally releases the lock.
        expect(finishedWithoutUnlock).toBe(true);
        expect(cancellationControls.size).toBe(1);
        expect([...cancellationControls][0]?.connection.stream.closed).toBe(true);
      } else {
        expect({ finishedWithoutUnlock, blockedOwnedSql: waiter.rows[0].count },
          'Shutdown must own and retire locked SQL without releasing an independent transaction')
          .toEqual({ finishedWithoutUnlock: true, blockedOwnedSql: 0 });
        expect((await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
            AND (state<>'idle' OR xact_start IS NOT NULL)`,
        [waiting.pid, waiting.backend_start, waiting.datname, waiting.usename])).rows[0].count).toBe(0);
      }
      if (compensationWaiting) {
        expect((await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
        [compensationWaiting.pid, compensationWaiting.backend_start, compensationWaiting.datname,
          compensationWaiting.usename])).rows[0].count,
        'Compensation must retire its actual SQL backend before the independent row lock is released').toBe(0);
        expect(compensationCheckout?.connection.stream.closed).toBe(true);
      }
      if (faults.snapshotCompensation) {
        const nested = (error: unknown): unknown[] => [error,
          ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
          ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
        ];
        expect(snapshotCloseError, 'A failed committed lease compensation must reject actual gateway.close')
          .toBeInstanceOf(AggregateError);
        const causes = nested(snapshotCloseError);
        expect(causes.some(error => error instanceof Error && error.name === 'PresenceConnectionCleanupError')).toBe(true);
        expect(causes.some(error => error instanceof Error && error.message.includes(`(${committedConnectionId})`))).toBe(true);
        const retiredSqlErrors = causes.filter(error => error instanceof Error && 'code' in error && error.code === '57P01');
        expect(retiredSqlErrors.length).toBe(faults.snapshotCompensation === 'delete-locked' ? 2 : 1);
        expect(new Set(retiredSqlErrors).size).toBe(faults.snapshotCompensation === 'delete-locked' ? 2 : 1);
        if (faults.snapshotCompensation === 'delete-failure') {
          expect(causes.some(error => error instanceof Error && 'code' in error && error.code === 'P0001'
            && error.message.includes('controlled first snapshot compensation delete failure'))).toBe(true);
        }
      }
      if (faults.postJoinControlFailure) {
        const nested = (error: unknown): unknown[] => [error,
          ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
          ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
        ];
        expect(snapshotCloseError, 'Failed member connection cleanup must reject actual gateway.close')
          .toBeInstanceOf(AggregateError);
        const causes = nested(snapshotCloseError);
        expect(causes).toContain(faults.postJoinControlFailure);
        const cleanupError = causes.find(error => error instanceof Error
          && error.name === 'PresenceConnectionCleanupError' && error.cause instanceof AggregateError
          && (error.cause.errors as unknown[]).includes(faults.postJoinControlFailure));
        expect(cleanupError).toBeInstanceOf(Error);
        const compound = (cleanupError as Error).cause as AggregateError;
        expect(compound.errors).toHaveLength(2);
        expect(compound.errors[0]).toBeInstanceOf(Error);
        expect(compound.errors[0]).not.toBe(faults.postJoinControlFailure);
        expect((compound.errors[0] as Error).message).toMatch(/Connection terminated|terminating connection/u);
        expect(compound.errors[1]).toBe(faults.postJoinControlFailure);
      }
      expect((await query<{ consumed: boolean }>(
        'SELECT consumed_at IS NOT NULL AS consumed FROM wujie_presence_tickets WHERE token_hash=$1', [ticketHash],
      )).rows[0].consumed).toBe(stage !== 'ticket-commit');
      expect((await query<{ count: number }>('SELECT count(*)::int AS count FROM wujie_presence_leases')).rows[0].count)
        .toBe(faults.snapshotCompensation ? 1 : 0);
      if (stage === 'join-snapshot' || postJoin) {
        expect((postJoin ? lockedCheckout : snapshotCheckout)?.connection.stream.closed).toBe(true);
        expect((await query<{ sequence: string }>(
          "SELECT sequence::text FROM wujie_presence_project_sequences WHERE project_id='project'",
        )).rows[0].sequence).toBe(faults.snapshotCompensation ? '1' : '2');
        // Failed compensation is NOT a reclaimed lease or a sequence bump.
      }
      expect((await healthy.query<BackendIdentity>(
        'SELECT pid, backend_start::text AS backend_start, datname, usename FROM pg_stat_activity WHERE pid=pg_backend_pid()',
      )).rows[0]).toEqual(originalHealthy);
      expect((await healthy.query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
      expect(healthy.connection.stream.closed).toBe(false);
      expect(pool.ending).toBe(false);
      expect(pool.waitingCount).toBe(0);
      expect(frames).toBe(0);
      expect(await Promise.allSettled(upgrades)).toEqual([
        { status: 'fulfilled', value: undefined }, // Original upgrade.
        { status: 'fulfilled', value: undefined }, // Real late 503 admission probe.
      ]);
      if (postJoin) expect(lateHeartbeatTimers, 'No heartbeat timer may be armed after physical client shutdown').toBe(0);
      if (faults.snapshotCompensation || faults.postJoinControlFailure) expectedSnapshotCloseError = snapshotCloseError;
    } catch (error) { bodyFailed = true; bodyError = error; throw error; }
    finally {
      // Unlock only AFTER the business assertion, so pre-fix recovery cannot mask RED.
      await runPostgresCleanup([
        { name: 'restore-native-query-before-unlock', run: (): void => {
          if (postJoin) restorePostJoinQuery?.();
          else vi.restoreAllMocks();
        } },
        { name: 'remove-checkout-observer', run: (): void => { observedPool?.off('acquire', onAcquire); } },
        { name: 'release-unstarted-snapshot-checkout', run: (): void => {
          if (snapshotCheckout && !snapshotCheckoutReleased) snapshotCheckout.release(true);
        } },
        { name: 'rollback-independent-lock', run: async (): Promise<void> => { if (locker) await observeWithin(locker.query('ROLLBACK'), 2_000, 'rollback locker'); } },
        { name: 'run-controlled-late-cleanup-producer', run: (): void => { faults.lateCleanupProducer?.(); } },
        { name: 'end-independent-lock', run: async (): Promise<void> => { if (locker) await observeWithin(locker.end(), 2_000, 'end locker'); } },
        { name: 'stop-test-client', run: (): void => { client?.terminate(); rawSocket?.destroy(); } },
        { name: 'release-unrelated-owned-checkout', run: (): void => { healthy?.release(); healthy = undefined; } },
        { name: 'settle-started-upgrades', run: async (): Promise<void> => { await observeWithin(Promise.allSettled(upgrades), 12_000, 'settle upgrades'); } },
        { name: 'settle-native-query-callbacks', run: async (): Promise<void> => {
          await observeWithin(Promise.all(callbackDeliveries), 12_000, 'settle native query callbacks');
        } },
        { name: 'settle-started-close', run: async (): Promise<void> => {
          if (closePending) await observeWithin(closePending, 12_000, 'settle close').catch((error: unknown): void => {
            if (error !== expectedSnapshotCloseError) throw error;
          });
        } },
        { name: 'close-gateway', run: async (): Promise<void> => {
          if (gateway) await observeWithin(gateway.close(), 12_000, 'close gateway').catch((error: unknown): void => {
            if (error !== expectedSnapshotCloseError) throw error;
          });
        } },
        { name: 'close-http', run: async (): Promise<void> => {
          if (!server) return;
          server.closeAllConnections();
          await observeWithin(new Promise<void>((resolve, reject) => server!.close(error => {
            if (error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')) reject(error);
            else resolve();
          })), 2_000, 'close HTTP');
        } },
        { name: 'clear-observed-heartbeat-timers', run: (): void => {
          for (const timer of heartbeatTimers) clearTimeout(timer);
        } },
        { name: 'restore-observers-after-close-drain', run: (): void => { vi.restoreAllMocks(); } },
        { name: 'restore-environment', run: (): void => { vi.unstubAllEnvs(); } },
      ]).catch((cleanupError: unknown): never => {
        if (!bodyFailed) throw cleanupError;
        throw new AggregateError([bodyError, ...(cleanupError instanceof AggregateError ? cleanupError.errors as unknown[] : [cleanupError])],
          'Presence commit/join verification body and cleanup failed');
      });
    }
  });
}

describe('presence shutdown owns real COMMIT and post-101 join SQL', () => {
  postgresIt('preserves a rejected close and subsequent body failure without a derived unhandled rejection', async () => {
    const bodyFailure = new Error('controlled early body assertion');
    const closeFailure = new Error('controlled close rejection after real gateway retirement');
    let result: unknown;
    try { await verifyLockedShutdown('lease-join', { earlyBodyFailure: bodyFailure, closeFailure }); }
    catch (error) { result = error; }
    const nested = (error: unknown): unknown[] => [error,
      ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
      ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
    ];
    expect(result).toBeInstanceOf(AggregateError);
    expect(nested(result)).toContain(bodyFailure);
    expect(nested(result)).toContain(closeFailure);
  }, 20_000);

  // Break caught: a cleanup that only sweeps already registered holders returns
  // before a delayed native checkout, then permits new holders and a leaked spy.
  async function verifySetupFailureControl(rejectCheckout: boolean, closeFailure?: Error): Promise<void> {
    requireOfflineBridgeTestDatabaseUrl(process.env);
    await withIsolatedPostgres('presence-compensation-setup-late', async ({ databaseUrl }) => {
      const { getPool } = await import('../../src/lib/db-client');
      const pool = getPool();
      const joinSlot = await pool.connect();
      const holders: (PoolClient & Client)[] = [];
      const borrowed = new Set<PoolClient & Client>();
      const releasedClients = new Set<Client>();
      pool.on('release', (_error: Error | undefined, client: PoolClient): void => {
        if (client instanceof Client) releasedClients.add(client);
      });
      let joinSlotReleased = false;
      let releaseDelay: () => void = (): void => {};
      const delay = new Promise<void>(resolve => { releaseDelay = resolve; });
      let checkoutArrived: (client: PoolClient & Client) => void = (): void => {};
      const arrival = new Promise<PoolClient & Client>(resolve => { checkoutArrived = resolve; });
      let signalSaturation: () => void = (): void => {};
      const saturated = new Promise<void>(resolve => { signalSaturation = resolve; });
      let delayed = false;
      let continued = false;
      const leakedFault = new Error('controlled late setup connect spy leak');
      const setup = createCompensationHolderSetup(pool, holders, borrowed, signalSaturation, (): void => {
        continued = true;
        vi.spyOn(Client.prototype, 'connect').mockImplementationOnce(() => Promise.reject(leakedFault));
        joinSlot.release();
        joinSlotReleased = true;
      }, async (client): Promise<void> => {
        if (delayed) return;
        delayed = true;
        checkoutArrived(client);
        await delay;
        if (rejectCheckout) await client.query('SELECT 1/0');
      });
      const producer = setup.start();
      let bodyError: unknown;
      let cleanupSettled = false;
      let settledBeforeArrival = false;
      let concreteCheckout: (PoolClient & Client) | undefined;
      let operationError: unknown;
      let rescueError: unknown;
      let firstCleanup: Promise<void> | undefined;
      let firstCleanupError: unknown;
      let afterCleanup: { borrowed: number; continued: boolean; returnedConcreteCheckout: boolean; probeAnswer: number | undefined } | undefined;
      const probe = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
      try {
        concreteCheckout = await observeWithin(arrival, 2_000, 'real delayed setup checkout');
        expect(concreteCheckout.connection.stream.closed).toBe(false);
        expect((await concreteCheckout.query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
        try { await observeWithin(saturated, 3_000, 'five actual compensation pool holders'); }
        catch (error) { bodyError = error; }
        // Match the actual fixture: restore observers before cleanup; a late
        // producer must not be allowed to install them again afterwards.
        vi.restoreAllMocks();
        firstCleanup = setup.cleanup().then((): void => { cleanupSettled = true; }, (error: unknown): never => {
          cleanupSettled = true;
          throw error;
        });
        // Observe the derived rejection immediately without replacing its
        // rejecting owner; finally must still await this exact first cleanup.
        void firstCleanup.catch(() => undefined);
        await new Promise<void>(resolve => setImmediate(resolve));
        settledBeforeArrival = cleanupSettled;
        releaseDelay();
        await observeWithin(producer, 3_000, 'late setup producer');
        await observeWithin(firstCleanup, 3_000, 'owned setup cleanup');
        let probeAnswer: number | undefined;
        try {
          await probe.connect();
          probeAnswer = (await probe.query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer;
        } catch (error) { if (error !== leakedFault) throw error; }
        afterCleanup = { borrowed: borrowed.size, continued,
          returnedConcreteCheckout: releasedClients.has(concreteCheckout), probeAnswer };
      } catch (error) { operationError = error; }
      finally {
        // This control's rescue is outside the asserted cleanup boundary. It
        // makes RED safe without hiding the pre-rescue ownership observation.
        releaseDelay();
        await runPostgresCleanup([
          { name: 'settle-test-setup-producer', run: async (): Promise<void> => { await observeWithin(producer, 12_000, 'rescue setup producer'); } },
          { name: 'settle-first-test-setup-cleanup', run: async (): Promise<void> => {
            if (!firstCleanup) return;
            try { await observeWithin(firstCleanup, 12_000, 'rescue first setup cleanup'); }
            catch (error) { firstCleanupError = error; throw error; }
          } },
          { name: 'restore-test-connect', run: (): void => { vi.restoreAllMocks(); } },
          { name: 'release-test-join-slot', run: (): void => { if (!joinSlotReleased) { joinSlot.release(); joinSlotReleased = true; } } },
          { name: 'rescue-test-setup-holders', run: setup.cleanup },
          { name: 'end-test-probe', run: async (): Promise<void> => { await probe.end(); if (closeFailure) throw closeFailure; } },
        ]).catch((error: unknown): void => { rescueError = error; });
      }
      expect(bodyError).toBeInstanceOf(Error);
      expect((bodyError as Error).message).toBe('Test observation exceeded: five actual compensation pool holders');
      if (rejectCheckout) {
        const matchesStep = (error: unknown, name: string, cause: unknown): boolean =>
          error instanceof Error && error.message.startsWith(`${name}: `) && error.cause === cause;
        const expectedHolderCleanup = (error: unknown): boolean => error instanceof AggregateError
          && error.errors.length === 1
          && matchesStep(error.errors[0], 'settle-compensation-holder-producer', operationError);
        // A deliberate SQL fault permits only these exact cleanup owners and
        // cause identities. An unrelated end/release/restore error must escape.
        const expectedRescue = rescueError instanceof AggregateError && (rescueError.errors as unknown[]).every(error =>
          matchesStep(error, 'settle-test-setup-producer', operationError)
          || matchesStep(error, 'settle-first-test-setup-cleanup', firstCleanupError)
          || (error instanceof Error && error.message.startsWith('rescue-test-setup-holders: ')
            && expectedHolderCleanup(error.cause)));
        if (!expectedHolderCleanup(firstCleanupError) || !expectedRescue) {
          throw new AggregateError([bodyError, operationError, firstCleanupError, rescueError].filter(error => error !== undefined),
            'Unexpected setup control body or cleanup failure');
        }
        const nested = (error: unknown): unknown[] => [error,
          ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
          ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
        ];
        expect(nested(operationError).some(error => error instanceof Error && 'code' in error && error.code === '22012')).toBe(true);
        expect(nested(rescueError)).toContain(operationError);
        expect(firstCleanupError).toBeInstanceOf(AggregateError);
        expect(nested(firstCleanupError)).toContain(operationError);
        expect(nested(rescueError)).toContain(firstCleanupError);
        expect({ cleanupSettled, borrowed: borrowed.size, returnedConcreteCheckout: concreteCheckout !== undefined && releasedClients.has(concreteCheckout) },
          'The first cleanup rejection must be owned, not replaced by a second cleanup')
          .toEqual({ cleanupSettled: true, borrowed: 0, returnedConcreteCheckout: true });
        const healthy = await pool.connect();
        try { expect((await healthy.query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42); }
        finally { healthy.release(); }
      } else {
        if (operationError || rescueError) throw new AggregateError([operationError, rescueError].filter(error => error !== undefined), 'Setup control body and rescue failed');
        expect({ settledBeforeArrival, ...afterCleanup }, 'Cleanup must own the delayed concrete checkout and stop the entire producer')
          .toEqual({ settledBeforeArrival: false, borrowed: 0, continued: false, returnedConcreteCheckout: true, probeAnswer: 42 });
      }
      expect(pool.waitingCount).toBe(0);
    });
  }

  postgresIt.each([false, true])('owns a compensation setup checkout after its observation deadline, SQL failure=%s', async rejectCheckout => {
    await verifySetupFailureControl(rejectCheckout);
  }, 20_000);

  postgresIt('rejects an extra completed probe close failure while preserving the real setup SQL failure', async () => {
    const closeFailure = new Error('controlled probe post-end failure');
    let result: unknown;
    try { await verifySetupFailureControl(true, closeFailure); }
    catch (error) { result = error; }
    const nested = (error: unknown): unknown[] => [error,
      ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
      ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
    ];
    expect(result, 'Unexpected cleanup failure must reject the setup control, not be accepted as the intended SQL fault')
      .toBeInstanceOf(AggregateError);
    expect(nested(result)).toContain(closeFailure);
    expect(nested(result).some(error => error instanceof Error && 'code' in error && error.code === '22012')).toBe(true);
  }, 20_000);

  // Removing the compensation's independent cancellation owner leaves the real
  // DELETE waiter alive and join pending while this independent lock is held.
  postgresIt.each(['success', 'delete-failure', 'delete-locked', 'queued-late', 'queue-timeout'] as const)('owns confirmed committed lease compensation: %s', async compensation => {
    requireOfflineBridgeTestDatabaseUrl(process.env);
    await withIsolatedPostgres('presence-committed-join-cleanup', async ({ query, databaseUrl, schemaName }) => {
      let owned: PoolClient | undefined;
      let released = false;
      let pending: Promise<unknown> | undefined;
      let joinSettled = false;
      let holderSetup: ReturnType<typeof createCompensationHolderSetup> | undefined;
      const holders: (PoolClient & Client)[] = [];
      const borrowed = new Set<PoolClient & Client>();
      const identities: BackendIdentity[] = [];
      const saturated = compensation === 'queued-late' || compensation === 'queue-timeout';
      let resolveSaturation: () => void = (): void => {};
      const saturationReady = new Promise<void>(resolve => { resolveSaturation = resolve; });
      const controls: Client[] = [];
      const controller = new AbortController();
      const controlFault = new Error('controlled cancellation connect failure after actual COMMIT');
      let commitObserved = false;
      let bodyFailed = false;
      let bodyError: unknown;
      let lockerPid: number | undefined;
      const compensationClients: Client[] = [];
      let resolveLock: (pid: number) => void = (): void => {};
      const lockReady = new Promise<number>(resolve => { resolveLock = resolve; });
      try {
        vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
        vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
        const businessUrl = new URL(databaseUrl);
        businessUrl.searchParams.set('options', `${businessUrl.searchParams.get('options')} -capplication_name=${schemaName}`);
        process.env.DATABASE_URL = businessUrl.toString();
        process.env.PGDATABASE_URL = businessUrl.toString();
        await setupDatabase(query);
        if (compensation === 'delete-failure') {
          await query(`CREATE FUNCTION fail_compensation_delete() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'controlled compensation delete failure'; END $$`);
          await query(`CREATE TRIGGER fail_compensation_delete BEFORE DELETE ON wujie_presence_leases
            FOR EACH ROW EXECUTE FUNCTION fail_compensation_delete()`);
        }
        const { getPool } = await import('../../src/lib/db-client');
        const { joinPresence } = await import('../../src/lib/collaboration/presence-leases');
        const { PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
        const continueSetup = (): void => {
          vi.spyOn(Client.prototype, 'connect').mockImplementationOnce(function (this: Client): Promise<void> {
            controls.push(this);
            return Promise.reject(controlFault);
          });
          controller.abort();
        };
        if (saturated) holderSetup = createCompensationHolderSetup(getPool(), holders, borrowed, resolveSaturation, continueSetup);
        owned = await getPool().connect();
        if (!(owned instanceof Client)) throw new Error('Native transaction checkout required');
        const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult> = Client.prototype.query;
        if (compensation === 'delete-locked') {
          vi.spyOn(Client.prototype, 'query').mockImplementation(async function (
            this: Client, text: unknown, values?: unknown[],
          ): Promise<QueryResult> {
            if (typeof text !== 'string') throw new Error('Expected real string SQL in compensation fixture');
            if (text.startsWith('DELETE FROM wujie_presence_leases')) compensationClients.push(this);
            return nativeQuery.call(this, text, values);
          });
        }
        vi.spyOn(owned, 'query').mockImplementation(async function (
          this: Client, text: unknown, values?: unknown[],
        ): Promise<QueryResult> {
          if (typeof text !== 'string') throw new Error('Expected production string SQL in this fixture');
          const result = await nativeQuery.call(this, text, values);
          if (text === 'COMMIT' && !commitObserved) {
            // Actual PostgreSQL COMMIT has succeeded before abort. Keep the real
            // transaction and helper; fail only the next independent control connect.
            commitObserved = true;
            if (compensation === 'delete-locked') {
              // The helper is a separate real transaction; keep this lock until
              // AFTER the retirement assertion, never unlock to manufacture GREEN.
              await query('BEGIN');
              lockerPid = (await query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
              await query("SELECT connection_id FROM wujie_presence_leases WHERE connection_id='confirmed-commit' FOR UPDATE");
              resolveLock(lockerPid);
            }
            if (saturated) {
              // COMMIT is real and acknowledged. Fill the other four slots,
              // then enqueue a fifth holder BEFORE abort retires the join slot.
              // The compensation request must queue behind these actual leases.
              await holderSetup!.start();
            }
            else continueSetup();
          }
          return result;
        });
        owned.release();
        released = true;
        pending = joinPresence({ connectionId: 'confirmed-commit', userId: 'member', projectId: 'project', instanceId: 'one' },
          controller.signal).then(value => { joinSettled = true; return value; },
          (error: unknown): unknown => { joinSettled = true; return error; });
        let queueObservedAt = 0;
        if (saturated) {
          await observeWithin(saturationReady, 3_000, 'five actual compensation pool holders');
          const queueDeadline = performance.now() + 3_000;
          while (getPool().waitingCount !== 1 && performance.now() < queueDeadline) {
            await new Promise<void>(resolve => setTimeout(resolve, 10));
          }
          expect(getPool().waitingCount).toBe(1);
          expect(getPool().totalCount).toBe(5);
          expect(getPool().idleCount).toBe(0);
          expect(holders.length).toBe(5);
          expect(joinSettled).toBe(false);
          queueObservedAt = performance.now();
          for (const client of holders) {
            identities.push((await client.query<BackendIdentity>(
              'SELECT pid, backend_start::text AS backend_start, datname, usename FROM pg_stat_activity WHERE pid=pg_backend_pid()',
            )).rows[0]);
            expect((await client.query<{ statement: string; lock: string }>(
              "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock",
            )).rows[0]).toEqual({ statement: '0', lock: '0' });
          }
          if (compensation === 'queued-late') {
            // Let the real compensation cancellation budget expire while native
            // acquisition is still owned. No fake clock or private queue edits.
            await new Promise<void>(resolve => setTimeout(resolve, 6_000));
            expect(joinSettled).toBe(false);
            expect(getPool().waitingCount).toBe(1);
            expect(holders[0].connection.stream.closed).toBe(false);
            expect((await holders[0].query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
            holders[0].release();
            borrowed.delete(holders[0]);
          }
        }
        if (compensation === 'delete-locked') {
          await observeWithin(lockReady, 3_000, 'independent lock after acknowledged COMMIT');
          if (!lockerPid) throw new Error('Independent committed lease locker not observed');
          const waiting = await waitForSqlLock(query, lockerPid, schemaName, 'compensation-delete');
          let timer: ReturnType<typeof setTimeout> | undefined;
          let finishedWithoutUnlock: boolean;
          try {
            finishedWithoutUnlock = await Promise.race([pending.then(() => true), new Promise<false>(resolve => {
              timer = setTimeout(() => resolve(false), 8_000);
            })]);
          } finally { if (timer) clearTimeout(timer); }
          await query('SELECT pg_stat_clear_snapshot()');
          const remaining = (await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
              AND (state<>'idle' OR xact_start IS NOT NULL)`,
          [waiting.pid, waiting.backend_start, waiting.datname, waiting.usename])).rows[0].count;
          expect((await query<{ held: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks
            WHERE pid=$1 AND granted AND locktype='transactionid') AS held`, [lockerPid])).rows[0].held).toBe(true);
          expect({ finishedWithoutUnlock, remaining }, 'Compensation must retire its own SQL while the independent lease lock remains')
            .toEqual({ finishedWithoutUnlock: true, remaining: 0 });
          expect(compensationClients.length).toBe(1);
          expect(compensationClients[0]).toBeInstanceOf(Client);
          expect(compensationClients[0].connection.stream.closed).toBe(true);
          expect(getPool().ending).toBe(false);
          const healthy = await getPool().connect();
          try { expect((await healthy.query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42); }
          finally { healthy.release(); }
        }
        const result = await observeWithin(pending, saturated ? 12_000 : 5_000, 'committed join cancellation cleanup');
        if (compensation === 'queued-late') {
          expect({ retired: holders[0].connection.stream.closed, retainedLease: (await query<{ count: number }>(
            "SELECT count(*)::int AS count FROM wujie_presence_leases WHERE connection_id='confirmed-commit'",
          )).rows[0].count }, 'A late cancelled compensation must retire its concrete checkout before running DELETE')
            .toEqual({ retired: true, retainedLease: 1 });
        }
        expect(commitObserved).toBe(true);
        expect(result).toBeInstanceOf(PresenceConnectionCleanupError);
        const failure = result as Error;
        if (compensation === 'success') expect(failure.cause).toBe(controlFault);
        else {
          const nested = (error: unknown): unknown[] => [error,
            ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
            ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
          ];
          expect(nested(failure)).toContain(controlFault);
          if (compensation === 'delete-failure') {
            expect(nested(failure).some(error => error instanceof Error && error.message === 'controlled compensation delete failure')).toBe(true);
          } else if (compensation === 'delete-locked') {
            expect(nested(failure).some(error => error instanceof Error && 'code' in error && error.code === '57P01')).toBe(true);
          } else {
            expect(nested(failure).some(error => error instanceof Error && (
              compensation === 'queued-late' ? /compensation deadline exceeded/.test(error.message) : /timeout/i.test(error.message)
            ))).toBe(true);
          }
          expect(nested(failure).some(error => error instanceof Error && error.message.includes('confirmed-commit'))).toBe(true);
        }
        expect(controls.length).toBe(1);
        expect(controls[0].connection.stream.closed).toBe(true);
        if (saturated) {
          expect(getPool().waitingCount).toBe(0);
          expect(getPool().ending).toBe(false);
          if (compensation === 'queued-late') {
            const identity = identities[0];
            expect((await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
              WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
            [identity.pid, identity.backend_start, identity.datname, identity.usename])).rows[0].count).toBe(0);
          } else {
            expect(performance.now() - queueObservedAt).toBeGreaterThanOrEqual(9_000);
            expect(getPool().totalCount).toBe(5);
            expect(getPool().idleCount).toBe(0);
          }
          for (let index = compensation === 'queued-late' ? 1 : 0; index < holders.length; index++) {
            const client = holders[index];
            expect(client.connection.stream.closed).toBe(false);
            expect((await client.query<BackendIdentity>(
              'SELECT pid, backend_start::text AS backend_start, datname, usename FROM pg_stat_activity WHERE pid=pg_backend_pid()',
            )).rows[0]).toEqual(identities[index]);
            expect((await client.query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
          }
        }
        expect((await query<{ count: number }>(
          "SELECT count(*)::int AS count FROM wujie_presence_leases WHERE connection_id='confirmed-commit'",
        )).rows[0].count, 'Successful COMMIT must still have a lease compensation owner').toBe(compensation === 'success' ? 0 : 1);
        expect((await query<{ sequence: string }>(
          "SELECT sequence::text FROM wujie_presence_project_sequences WHERE project_id='project'",
        )).rows[0].sequence).toBe(compensation === 'success' ? '2' : '1'); // One join; successful compensation increments once.
      } catch (error) { bodyFailed = true; bodyError = error; throw error; }
      finally {
        await runPostgresCleanup([
          { name: 'rollback-independent-compensation-lock', run: async (): Promise<void> => { if (lockerPid) await observeWithin(query('ROLLBACK'), 2_000, 'rollback compensation locker'); } },
          { name: 'restore-control-observers', run: (): void => { vi.restoreAllMocks(); } },
          { name: 'abort-owned-initial-join', run: (): void => { controller.abort(); } },
          { name: 'release-initial-checkout', run: (): void => { if (owned && !released) owned.release(true); } },
          { name: 'cleanup-compensation-holder-producer', run: async (): Promise<void> => { if (holderSetup) await holderSetup.cleanup(); } },
          { name: 'settle-owned-join', run: async (): Promise<void> => { if (pending) await observeWithin(pending, 5_000, 'cleanup join'); } },
          { name: 'retire-control-transports', run: async (): Promise<void> => {
            for (const control of controls) {
              const stream = control.connection.stream;
              const closed = stream.closed ? Promise.resolve() : new Promise<void>(resolve => stream.once('close', resolve));
              stream.destroy();
              await observeWithin(closed, 2_000, 'cleanup control transport');
            }
          } },
          { name: 'restore-test-environment', run: (): void => { vi.unstubAllEnvs(); } },
        ]).catch((cleanupError: unknown): never => {
          if (!bodyFailed) throw cleanupError;
          throw new AggregateError([bodyError, ...(cleanupError instanceof AggregateError ? cleanupError.errors as unknown[] : [cleanupError])],
            'Committed join verification body and cleanup failed');
        });
      }
    });
  }, 20_000);

  // Break caught: suppressing the post-101 cleanup error falsely fulfills close;
  // dropping compensation cancellation lets a late native checkout delete the
  // committed lease. The gateway, 101, COMMIT, pool and close deadline are real.
  async function verifyGatewayCommittedShutdown(compensation: 'queued-late' | 'queue-timeout', earlyBodyFailure?: Error): Promise<void> {
    requireOfflineBridgeTestDatabaseUrl(process.env);
    await withIsolatedPostgres('presence-gateway-committed', async ({ query, databaseUrl, schemaName }) => {
      type CloseOutcome = { status: 'fulfilled' } | { status: 'rejected'; reason: unknown };
      let gateway: PresenceGateway | undefined;
      let server: Server | undefined;
      let client: WebSocket | undefined;
      let rawSocket: Duplex | undefined;
      let actualClose: Promise<void> | undefined;
      let observedClose: Promise<CloseOutcome> | undefined;
      let closeSettled = false;
      let closeStartedAt = 0;
      let controlStartedAt = 0;
      let expectedCloseError: unknown;
      let holderSetup: ReturnType<typeof createCompensationHolderSetup> | undefined;
      const holders: (PoolClient & Client)[] = [];
      const borrowed = new Set<PoolClient & Client>();
      const identities: BackendIdentity[] = [];
      const controls: Client[] = [];
      const upgrades: Promise<void>[] = [];
      const joinClients: Client[] = [];
      let connectionId: string | undefined;
      let commitObserved = false;
      let bodyFailed = false;
      let bodyError: unknown;
      const controlFault = new Error('controlled gateway cancellation connect failure after actual COMMIT');
      let deliverCommit: () => void = (): void => {};
      const commitDelivery = new Promise<void>(resolve => { deliverCommit = resolve; });
      let resolveCommitted: () => void = (): void => {};
      const committed = new Promise<void>(resolve => { resolveCommitted = resolve; });
      let resolveControl: () => void = (): void => {};
      const controlStarted = new Promise<void>(resolve => { resolveControl = resolve; });
      let resolveSaturation: () => void = (): void => {};
      const saturationReady = new Promise<void>(resolve => { resolveSaturation = resolve; });
      const startClose = (): void => {
        if (actualClose || !gateway) return;
        closeStartedAt = performance.now();
        actualClose = gateway.close();
        observedClose = actualClose.then(
          (): CloseOutcome => { closeSettled = true; return { status: 'fulfilled' }; },
          (reason: unknown): CloseOutcome => { closeSettled = true; return { status: 'rejected', reason }; },
        );
      };
      try {
        vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
        vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
        vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
        const businessUrl = new URL(databaseUrl);
        businessUrl.searchParams.set('options', `${businessUrl.searchParams.get('options')} -capplication_name=${schemaName}`);
        process.env.DATABASE_URL = businessUrl.toString();
        process.env.PGDATABASE_URL = businessUrl.toString();
        await setupDatabase(query);
        const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
        const { createPresenceGateway } = await import('../../src/lib/collaboration/presence-gateway');
        const { createPresenceHttpServer } = await import('../../scripts/presence-server');
        const { PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
        const { getPool } = await import('../../src/lib/db-client');
        const ticket = await issuePresenceTicket('member', 'project');
        const pool = getPool();
        holderSetup = createCompensationHolderSetup(pool, holders, borrowed, resolveSaturation, (): void => {
          // The fifth holder is already queued. Only the independent control
          // connect fails; no fake cancellation signal or native pool mutation.
          vi.spyOn(Client.prototype, 'connect').mockImplementationOnce(function (this: Client): Promise<void> {
            controls.push(this);
            controlStartedAt = performance.now();
            resolveControl();
            return Promise.reject(controlFault);
          });
          resolveCommitted();
        });
        const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult> = Client.prototype.query;
        vi.spyOn(Client.prototype, 'query').mockImplementation(async function (
          this: Client, text: unknown, values?: unknown[],
        ): Promise<QueryResult> {
          if (typeof text !== 'string') throw new Error('Expected native string SQL in gateway compensation fixture');
          const result = await nativeQuery.call(this, text, values);
          if (text.includes('INSERT INTO wujie_presence_leases') && values?.[3] === 'gateway-committed-saturated') {
            if (typeof values[0] !== 'string' || joinClients.length) throw new Error('Expected one actual gateway lease identity');
            connectionId = values[0];
            joinClients.push(this);
          }
          if (this === joinClients[0] && text === 'COMMIT' && !commitObserved) {
            commitObserved = true; // Real PostgreSQL acknowledgement, not a substituted result.
            await holderSetup!.start();
            // Delay delivery, not COMMIT itself, until the gateway's own close
            // deadline has reached this operation's real cancellation owner.
            await commitDelivery;
          }
          return result;
        });
        gateway = createPresenceGateway({ instanceId: 'gateway-committed-saturated' });
        const selectedGateway = gateway;
        server = createPresenceHttpServer({
          onRequest: (_request, response) => response.end('controlled-http'),
          onPresenceUpgrade: (request, socket, head) => {
            rawSocket ??= socket;
            const pending = selectedGateway.handlePresenceUpgrade(request, socket, head);
            upgrades.push(pending);
            void pending.catch(() => socket.destroy());
          },
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Loopback address required');
        const origin = `http://127.0.0.1:${address.port}`;
        client = new WebSocket(`${origin.replace('http:', 'ws:')}/api/collaboration/presence`,
          ['wujie-presence-v1', `wujie-ticket.${ticket}`], { origin, handshakeTimeout: 12_000 });
        client.on('error', () => undefined);
        let upgraded = 0;
        let frames = 0;
        client.on('upgrade', () => { upgraded += 1; });
        client.on('message', () => { frames += 1; });
        const clientClosed = new Promise<void>(resolve => client!.once('close', () => resolve()));
        await observeWithin(once(client, 'open'), 3_000, 'gateway committed real 101');
        await observeWithin(committed, 3_000, 'gateway acknowledged COMMIT and four holders');
        expect(upgraded).toBe(1);
        expect(commitObserved).toBe(true);
        expect((await query<{ connection_id: string }>('SELECT connection_id FROM wujie_presence_leases')).rows)
          .toEqual([{ connection_id: connectionId }]);
        if (earlyBodyFailure) throw earlyBodyFailure;
        startClose();
        expect(gateway.close()).toBe(actualClose);
        await observeWithin(clientClosed, 2_000, 'gateway committed physical WebSocket close');
        expect(rawSocket?.closed).toBe(true);
        expect(closeSettled).toBe(false);
        expect(await rejectedAfterClose(server)).toBe(503);
        await observeWithin(controlStarted, 8_000, 'gateway actual shutdown cancellation deadline');
        expect(controlStartedAt - closeStartedAt, 'Actual gateway cancellation must preserve its shutdown grace')
          .toBeGreaterThanOrEqual(4_500);
        deliverCommit();
        await observeWithin(saturationReady, 3_000, 'gateway fifth native holder');
        const queueDeadline = performance.now() + 3_000;
        while (pool.waitingCount !== 1 && performance.now() < queueDeadline) {
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
        expect({ waiting: pool.waitingCount, total: pool.totalCount, idle: pool.idleCount, holders: holders.length, closeSettled })
          .toEqual({ waiting: 1, total: 5, idle: 0, holders: 5, closeSettled: false });
        const queueObservedAt = performance.now();
        for (const holder of holders) {
          identities.push((await holder.query<BackendIdentity>(
            'SELECT pid, backend_start::text AS backend_start, datname, usename FROM pg_stat_activity WHERE pid=pg_backend_pid()',
          )).rows[0]);
          expect((await holder.query<{ statement: string; lock: string }>(
            "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock",
          )).rows[0]).toEqual({ statement: '0', lock: '0' });
        }
        if (compensation === 'queued-late') {
          await new Promise<void>(resolve => setTimeout(resolve, 6_000));
          expect(closeSettled).toBe(false);
          expect(pool.waitingCount).toBe(1);
          expect((await holders[0].query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
          holders[0].release();
          borrowed.delete(holders[0]);
        }
        const outcome = await observeWithin(observedClose!, 12_000, 'gateway committed compensation close aggregation');
        expect(outcome.status, 'Gateway close must surface committed compensation cleanup failure').toBe('rejected');
        if (outcome.status !== 'rejected') throw new Error('Gateway falsely fulfilled committed compensation close');
        expect(outcome.reason).toBeInstanceOf(AggregateError);
        const nested = (error: unknown): unknown[] => [error,
          ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
          ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
        ];
        expect(nested(outcome.reason)).toContain(controlFault);
        expect(nested(outcome.reason).some(error => error instanceof PresenceConnectionCleanupError)).toBe(true);
        expect(nested(outcome.reason).some(error => error instanceof Error && error.message.includes(connectionId!))).toBe(true);
        expect(nested(outcome.reason).some(error => error instanceof Error && (
          compensation === 'queued-late' ? /compensation deadline exceeded/.test(error.message) : /timeout/i.test(error.message)
        ))).toBe(true);
        expect(controls.length).toBe(1);
        expect(controls[0].connection.stream.closed).toBe(true);
        expect(joinClients[0]?.connection.stream.closed).toBe(true);
        expect(pool.waitingCount).toBe(0);
        expect(pool.ending).toBe(false);
        if (compensation === 'queued-late') {
          expect(holders[0].connection.stream.closed).toBe(true);
          const identity = identities[0];
          expect((await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
          [identity.pid, identity.backend_start, identity.datname, identity.usename])).rows[0].count).toBe(0);
        } else {
          expect(performance.now() - queueObservedAt).toBeGreaterThanOrEqual(9_000);
          expect(pool.totalCount).toBe(5);
          expect(pool.idleCount).toBe(0);
        }
        for (let index = compensation === 'queued-late' ? 1 : 0; index < holders.length; index++) {
          expect(holders[index].connection.stream.closed).toBe(false);
          expect((await holders[index].query<BackendIdentity>(
            'SELECT pid, backend_start::text AS backend_start, datname, usename FROM pg_stat_activity WHERE pid=pg_backend_pid()',
          )).rows[0]).toEqual(identities[index]);
          expect((await holders[index].query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
        }
        expect((await query<{ connection_id: string }>('SELECT connection_id FROM wujie_presence_leases')).rows)
          .toEqual([{ connection_id: connectionId }]);
        expect((await query<{ sequence: string }>(
          "SELECT sequence::text FROM wujie_presence_project_sequences WHERE project_id='project'",
        )).rows[0].sequence).toBe('1');
        expect(frames).toBe(0);
        expect(await Promise.allSettled(upgrades)).toEqual([
          { status: 'fulfilled', value: undefined }, { status: 'fulfilled', value: undefined },
        ]);
        expectedCloseError = outcome.reason;
      } catch (error) { bodyFailed = true; bodyError = error; throw error; }
      finally {
        await runPostgresCleanup([
          { name: 'close-test-observation-admission-before-commit-delivery', run: async (): Promise<void> => {
            // Close holder admission synchronously before restoring observers:
            // no late producer may reinstall them after this boundary. The
            // real Pool.query callback API must be intact before join can
            // continue from COMMIT to its snapshot, including early body throw.
            const holderCleanup = holderSetup?.cleanup();
            if (holderCleanup) void holderCleanup.catch(() => undefined);
            startClose();
            vi.restoreAllMocks();
            deliverCommit();
            if (holderCleanup) await holderCleanup;
          } },
          { name: 'stop-gateway-test-client', run: (): void => { client?.terminate(); rawSocket?.destroy(); } },
          { name: 'settle-gateway-close', run: async (): Promise<void> => {
            startClose();
            if (!observedClose) return;
            const outcome = await observeWithin(observedClose, 12_000, 'cleanup gateway close');
            if (outcome.status === 'rejected' && outcome.reason !== expectedCloseError) throw outcome.reason;
          } },
          { name: 'settle-gateway-upgrades', run: async (): Promise<void> => {
            await observeWithin(Promise.all(upgrades), 12_000, 'cleanup gateway upgrades');
          } },
          { name: 'close-gateway-test-http', run: async (): Promise<void> => {
            if (!server) return;
            server.closeAllConnections();
            await observeWithin(new Promise<void>((resolve, reject) => server!.close(error => {
              if (error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')) reject(error);
              else resolve();
            })), 2_000, 'cleanup gateway HTTP');
          } },
          { name: 'restore-gateway-test-observers', run: (): void => { vi.restoreAllMocks(); } },
          { name: 'restore-gateway-test-environment', run: (): void => { vi.unstubAllEnvs(); } },
        ]).catch((cleanupError: unknown): never => {
          if (!bodyFailed) throw cleanupError;
          throw new AggregateError([bodyError, ...(cleanupError instanceof AggregateError ? cleanupError.errors as unknown[] : [cleanupError])],
            'Gateway committed compensation verification body and cleanup failed');
        });
      }
    });
  }

  postgresIt.each(['queued-late', 'queue-timeout'] as const)('owns gateway shutdown committed compensation: %s', async compensation => {
    await verifyGatewayCommittedShutdown(compensation);
  }, 30_000);

  // Break caught: retaining the text/values-only observer during cleanup loses
  // Pool.query's callback after the real COMMIT, leaving join and close pending.
  postgresIt('preserves an early gateway body failure before committed result delivery', async () => {
    const bodyFailure = new Error('controlled gateway assertion before startClose');
    let result: unknown;
    try { await verifyGatewayCommittedShutdown('queued-late', bodyFailure); }
    catch (error) { result = error; }
    expect(result, 'Early body failure must survive successful concrete gateway, holder and schema cleanup').toBe(bodyFailure);
  }, 20_000);

  // Dropping authorization ownership must leave the deferred COMMIT waiter live.
  postgresIt('retires a real deferred ticket COMMIT without admitting 101', async () => {
    await verifyLockedShutdown('ticket-commit');
  }, 40_000);

  // Omitting post-101 cancellation must leave FOR SHARE and close pending.
  postgresIt('closes a real 101 connection while its lease join remains SQL-locked', async () => {
    await verifyLockedShutdown('lease-join');
  }, 40_000);

  // Omitting the join signal from its first snapshot leaves a committed lease
  // and real SELECT waiter even after the 101 socket has physically closed.
  postgresIt('retires the first snapshot SQL and compensates its committed join during gateway close', async () => {
    await verifyLockedShutdown('join-snapshot');
  }, 40_000);

  // Break caught: unowned DELETE waits forever, or swallowed DELETE failure
  // makes gateway.close fulfill despite retaining an acknowledged lease.
  postgresIt.each(['delete-failure', 'delete-locked'] as const)(
    'preserves first snapshot compensation failure during gateway close: %s', async snapshotCompensation => {
      await verifyLockedShutdown('join-snapshot', { snapshotCompensation });
    }, 40_000,
  );

  // Break caught: the initial join signal is not passed to the post-join
  // membership check or second snapshot, so close leaves their real SQL locked.
  postgresIt.each(['post-join-member', 'post-join-snapshot'] as const)(
    'retires real post-join SQL before unlocking: %s', async stage => {
      await verifyLockedShutdown(stage);
    }, 40_000,
  );

  // Break caught: member revalidation catches a real connection-cleanup error
  // and closes the WebSocket, but incorrectly fulfills gateway.close.
  postgresIt('rejects gateway close when post-join member cancellation control cannot connect', async () => {
    await verifyLockedShutdown('post-join-member', {
      postJoinControlFailure: new Error('controlled post-join cancellation connect failure'),
    });
  }, 20_000);

  // This controls TEST cleanup, not production heartbeat success. The real
  // gateway/read/lock are pending when a body error enters cleanup, and a
  // test-owned producer schedules a native late timer during that drain.
  postgresIt('reclaims a native late cleanup timer while preserving a post-join body failure', async () => {
    const bodyFailure = new Error('controlled post-join body failure before SQL observation');
    let lateTimer: ReturnType<typeof setTimeout> | undefined;
    let result: unknown;
    try {
      try {
        await verifyLockedShutdown('post-join-member', { earlyPostJoinBodyFailure: bodyFailure,
          lateCleanupProducer: (): void => { lateTimer = setTimeout(() => undefined, 45_000); lateTimer.unref(); },
        });
      } catch (error) { result = error; }
      expect(result).toBe(bodyFailure);
      if (!lateTimer || !('_destroyed' in lateTimer) || typeof lateTimer._destroyed !== 'boolean') {
        throw new Error('Actual native late timer retirement state required');
      }
      expect(lateTimer._destroyed, 'Test cleanup must retire a timer scheduled by its late producer').toBe(true);
    } finally { if (lateTimer) clearTimeout(lateTimer); }
  }, 20_000);
});
