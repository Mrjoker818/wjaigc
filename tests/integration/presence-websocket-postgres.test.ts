import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

import { Client, type QueryResult } from 'pg';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

import type { QueryFn } from '../helpers/postgres-test-database';
import type { PresenceGateway } from '../../src/lib/collaboration/presence-gateway';
import { runPostgresCleanup } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

// Observe completed native SQL across both Pool.query and owned checkouts.
// Cancellation ownership must not make the shared-read budget invisible.
interface RosterReadObservation { completed: () => number; stop: () => Promise<void> }
function observeActualRosterReads(): RosterReadObservation {
  let completed = 0;
  const operations: Promise<QueryResult>[] = [];
  const callbacks: Promise<void>[] = [];
  const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult> = Client.prototype.query;
  const observer = vi.spyOn(Client.prototype, 'query').mockImplementation(function (
    this: Client, text: unknown, values?: unknown[], callback?: (error: Error, result: QueryResult) => void,
  ): Promise<QueryResult> {
    const operation = (async (): Promise<QueryResult> => {
      if (typeof text !== 'string') throw new Error('Native SQL text required for roster observer');
      const result = await nativeQuery.call(this, text, values);
      if (text.startsWith('SELECT COALESCE((') && text.includes('FROM wujie_presence_leases lease')) completed += 1;
      return result;
    })();
    operations.push(operation);
    void operation.catch(() => undefined);
    if (callback) {
      const delivery = operation.then(result => { Reflect.apply(callback, undefined, [null, result]); },
        (error: unknown): void => { Reflect.apply(callback, undefined, [error]); });
      callbacks.push(delivery);
      void delivery.catch(() => undefined);
    }
    return operation;
  });
  return { completed: (): number => completed, stop: async (): Promise<void> => {
    observer.mockRestore();
    const settled = await Promise.allSettled([...operations, ...callbacks]);
    const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
    if (errors.length > 0) throw new AggregateError(errors, 'Observed roster SQL or callback failed');
  } };
}

// One test-only owner for the existing read windows. Failure controls below
// exercise this exact budget/cleanup boundary used by the WebSocket contracts.
async function withRosterReadBudget(
  expected: number | undefined, body: (observer: RosterReadObservation) => Promise<void>,
): Promise<void> {
  const observer = observeActualRosterReads();
  let bodyFailed = false;
  let bodyError: unknown;
  try { await body(observer); }
  catch (error) { bodyFailed = true; bodyError = error; }
  let stopFailed = false;
  let stopError: unknown;
  try { await observer.stop(); }
  catch (error) { stopFailed = true; stopError = error; }
  if (bodyFailed && stopFailed) throw new AggregateError([bodyError, stopError], 'Roster body and drain both failed');
  if (bodyFailed) throw bodyError;
  if (stopFailed) throw stopError;
  if (expected !== undefined) expect(observer.completed()).toBe(expected);
}

async function observeWithin<T>(pending: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Observation exceeded: ${label}`)), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function verifyRosterBudgetControl(kind: 'late-roster' | 'failed-and-pending'): Promise<void> {
  requireOfflineBridgeTestDatabaseUrl(process.env);
  const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
  await withIsolatedPostgres('presence-roster-observer-control', async ({ query, databaseUrl }) => {
    let locker: Client | undefined;
    let roster: Promise<unknown> | undefined;
    let window: Promise<void> | undefined;
    let unlock: Promise<void> | undefined;
    let windowError: unknown;
    let sqlError: unknown;
    let settled = false;
    let settledBeforeUnlock = false;
    let signalBody: () => void = (): void => {};
    const bodyReached = new Promise<void>(resolve => { signalBody = resolve; });
    const bodyError = new Error('controlled roster window body failure');
    let bodyFailed = false;
    let bodyFailure: unknown;
    try {
      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
      await setupPresenceDatabase(query);
      locker = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
      await locker.connect();
      await locker.query('BEGIN');
      const lockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await locker.query('LOCK TABLE wujie_users IN ACCESS EXCLUSIVE MODE');
      const { getPool } = await import('../../src/lib/db-client');
      const { readPresenceSnapshot } = await import('../../src/lib/collaboration/presence-leases');
      window = withRosterReadBudget(kind === 'late-roster' ? 0 : undefined, async (): Promise<void> => {
        if (kind === 'failed-and-pending') {
          try { await getPool().query('SELECT 1/0'); }
          catch (error) { sqlError = error; }
          if (!(sqlError instanceof Error)) throw new Error('Actual PostgreSQL division failure required');
        }
        roster = readPresenceSnapshot('project-a');
        void roster.catch(() => undefined);
        const deadline = performance.now() + 3_000;
        let waiting = false;
        while (performance.now() < deadline) {
          const result = await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'
              AND $1::int=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT COALESCE((%'`, [lockerPid]);
          if (result.rows[0].count === 1) { waiting = true; break; }
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
        if (!waiting) throw new Error('Actual extra roster SQL lock required');
        signalBody();
        if (kind === 'failed-and-pending') throw bodyError;
        // The real extra read is still locked during the OLD budget assertion.
        // Unlock on the next native turn, then it completes during stop/drain.
        unlock = new Promise<void>((resolve, reject) => setImmediate(() => {
          void locker!.query('ROLLBACK').then(() => resolve(), reject);
        }));
      }).then((): void => { settled = true; }, (error: unknown): void => { settled = true; windowError = error; });
      await observeWithin(bodyReached, 5_000, 'real roster body boundary');
      if (kind === 'failed-and-pending') {
        await new Promise<void>(resolve => setImmediate(resolve));
        settledBeforeUnlock = settled;
        expect((await query<{ held: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1
          AND granted AND mode='AccessExclusiveLock' AND relation='wujie_users'::regclass) AS held`, [lockerPid])).rows[0].held).toBe(true);
        await locker.query('ROLLBACK');
      } else if (unlock) await observeWithin(unlock, 2_000, 'scheduled real unlock');
      await observeWithin(window, 5_000, 'actual budget owner settlement');
      if (roster) await observeWithin(roster, 5_000, 'actual late roster result');
      if (kind === 'late-roster') {
        expect(windowError, 'An actual read completing during drain cannot pass an exact-zero budget').toBeInstanceOf(Error);
      } else {
        const nested = (error: unknown): unknown[] => [error,
          ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(nested) : []),
          ...(error instanceof Error && error.cause !== undefined ? nested(error.cause) : []),
        ];
        expect(settledBeforeUnlock, 'Rejected SQL must not let stop return before another actual SQL settles').toBe(false);
        expect(windowError).toBeInstanceOf(AggregateError);
        expect(nested(windowError)).toContain(bodyError);
        expect(nested(windowError)).toContain(sqlError);
        expect(sqlError instanceof Error && 'code' in sqlError ? sqlError.code : undefined).toBe('22012');
      }
      expect((await getPool().query<{ answer: number }>('SELECT 42 AS answer')).rows[0].answer).toBe(42);
    } catch (error) { bodyFailed = true; bodyFailure = error; throw error; }
    finally {
      await runPostgresCleanup([
        { name: 'rollback-observer-independent-lock', run: async (): Promise<void> => { if (locker) await observeWithin(locker.query('ROLLBACK'), 2_000, 'rescue lock'); } },
        { name: 'settle-observer-unlock-producer', run: async (): Promise<void> => { if (unlock) await observeWithin(unlock, 5_000, 'unlock producer'); } },
        { name: 'settle-observer-roster', run: async (): Promise<void> => { if (roster) await observeWithin(roster, 5_000, 'rescue roster'); } },
        { name: 'settle-observer-window', run: async (): Promise<void> => { if (window) await observeWithin(window, 5_000, 'rescue window'); } },
        { name: 'end-observer-independent-lock', run: async (): Promise<void> => { if (locker) await observeWithin(locker.end(), 2_000, 'end locker'); } },
        { name: 'restore-observer-environment', run: (): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); } },
      ]).catch((cleanupError: unknown): never => {
        if (!bodyFailed) throw cleanupError;
        throw new AggregateError([bodyFailure, ...(cleanupError instanceof AggregateError ? cleanupError.errors as unknown[] : [cleanupError])],
          'Roster observer control and cleanup failed');
      });
    }
  });
}

async function setupPresenceDatabase(query: QueryFn): Promise<void> {
  for (const file of [
    'migrations/20260809_wj_core_users.sql',
    'migrations/20260810_wj_stable_s2_assets.sql',
    'migrations/20260924_project_presence.sql',
    'migrations/20260924_project_presence_tickets.sql',
    'migrations/20260924_project_presence_ttl_leases.sql',
  ]) await query(await readFile(file, 'utf8'));
  await query(`
    INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
    VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1),
           ('member-a', 'Member A', 'test', 'active', 1, 1)
  `);
  await query("INSERT INTO wujie_projects (id, owner_id, name) VALUES ('project-a', 'owner-a', 'A')");
  await query(`INSERT INTO wujie_project_presence_members (project_id, owner_id, member_user_id)
               VALUES ('project-a', 'owner-a', 'member-a')`);
}

interface TestPresenceServer {
  query: QueryFn;
  gateway: PresenceGateway;
  origin: string;
  url: string;
  connect(ticket: string, options?: { origin?: string; protocols?: string[] }): WebSocket;
}

async function withPresenceServer(
  name: string,
  run: (context: TestPresenceServer) => Promise<void>,
  gatewayOptions: {
    maxBufferedBytes?: number;
    maxConnectionsPerUserProject?: number;
    heartbeatTimeoutMs?: number;
    reconcileIntervalMs?: number;
  } = {},
): Promise<void> {
  const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
  await withIsolatedPostgres(name, async ({ query }) => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    // These gateway fixtures create graph projects directly, without a legacy snapshot.
    vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
    await setupPresenceDatabase(query);
    const { createPresenceGateway } = await import('../../src/lib/collaboration/presence-gateway');
    const { createPresenceHttpServer } = await import('../../scripts/presence-server');
    const gateway = createPresenceGateway({ instanceId: 'test-instance', ...gatewayOptions });
    const server = createPresenceHttpServer({
      onRequest: (_request, response) => response.end('next-http'),
      onPresenceUpgrade: (request, socket, head) => {
        void gateway.handlePresenceUpgrade(request, socket, head);
      },
    });
    const clients = new Set<WebSocket>();
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const origin = `http://127.0.0.1:${port}`;
      const url = `ws://127.0.0.1:${port}/api/collaboration/presence`;
      await run({
        query, gateway, origin, url,
        connect: (ticket, options = {}) => {
          const client = new WebSocket(url, options.protocols ?? [
            'wujie-presence-v1', `wujie-ticket.${ticket}`,
          ], { origin: options.origin ?? origin });
          clients.add(client);
          client.on('error', () => {});
          return client;
        },
      });
    } finally {
      for (const client of clients) client.terminate();
      await gateway.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  });
}

async function rejectedStatus(client: WebSocket): Promise<number> {
  const [, response] = await once(client, 'unexpected-response');
  const status = (response as { statusCode?: number; destroy(): void }).statusCode;
  (response as { destroy(): void }).destroy();
  return status ?? 0;
}

describe('presence WebSocket on isolated PostgreSQL', () => {
  postgresIt.each(['late-roster', 'failed-and-pending'] as const)('owns actual roster budget failure boundary: %s', async kind => {
    await verifyRosterBudgetControl(kind);
  }, 20_000);
  postgresIt('accepts a one-use ticket and sends an authoritative project snapshot', async () => {
    await withPresenceServer('presence-websocket-snapshot', async ({ connect, origin }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const client = connect(await issuePresenceTicket('owner-a', 'project-a'));
      const [frame] = await once(client, 'message');
      expect(client.protocol).toBe('wujie-presence-v1');
      expect(JSON.parse(String(frame))).toEqual({
        type: 'snapshot',
        projectId: 'project-a',
        connectionId: expect.any(String),
        sequence: 1,
        participants: [{
          userId: 'owner-a',
          displayName: 'Owner A',
          lastSeenAt: expect.any(String),
        }],
      });
      expect(await (await fetch(`${origin}/api/auth/me`)).text()).toBe('next-http');
    });
  });

  postgresIt('rejects a replayed ticket before another WebSocket is established', async () => {
    await withPresenceServer('presence-websocket-replay', async ({ connect }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const ticket = await issuePresenceTicket('owner-a', 'project-a');
      await once(connect(ticket), 'message');
      expect(await rejectedStatus(connect(ticket))).toBe(401);
    });
  });

  postgresIt('rejects a cross-origin upgrade without consuming its ticket', async () => {
    await withPresenceServer('presence-websocket-cross-origin', async ({ connect }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const ticket = await issuePresenceTicket('owner-a', 'project-a');
      expect(await rejectedStatus(connect(ticket, { origin: 'https://attacker.example' }))).toBe(403);
      await expect(once(connect(ticket), 'message')).resolves.toHaveLength(2);
    });
  });

  postgresIt('renews a live lease after a JSON heartbeat without rereading the whole roster', async () => {
    await withPresenceServer('presence-websocket-heartbeat', async ({ connect, query }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const client = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(client, 'message');
      const before = await query<{ last_seen_at: Date }>(
        "SELECT last_seen_at FROM wujie_presence_leases WHERE user_id = 'owner-a'",
      );
      await withRosterReadBudget(0, async (): Promise<void> => {
        client.send(JSON.stringify({ type: 'heartbeat' }));
        let renewed = false;
        const deadline = Date.now() + 1_000;
        while (Date.now() < deadline) {
          const current = await query<{ last_seen_at: Date }>(
            "SELECT last_seen_at FROM wujie_presence_leases WHERE user_id = 'owner-a'",
          );
          if (current.rows[0].last_seen_at > before.rows[0].last_seen_at) {
            renewed = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(renewed).toBe(true);
        const sequence = await query<{ sequence: number }>(
          "SELECT sequence::int FROM wujie_presence_project_sequences WHERE project_id = 'project-a'",
        );
        expect(sequence.rows[0].sequence).toBe(1);
      });
    });
  });

  postgresIt('closes a client that sends a binary frame', async () => {
    await withPresenceServer('presence-websocket-binary', async ({ connect }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const client = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(client, 'message');
      const closed = once(client, 'close');
      client.send(Buffer.from([1, 2, 3]));
      const [code] = await closed;
      expect(code).toBe(1003);
    });
  });

  postgresIt('disconnects a member after their project membership is revoked', async () => {
    await withPresenceServer('presence-websocket-revoked', async ({ connect }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const { revokePresenceMember } = await import('../../src/lib/collaboration/presence-members');
      const client = connect(await issuePresenceTicket('member-a', 'project-a'));
      await once(client, 'message');
      const closed = once(client, 'close');
      await revokePresenceMember('owner-a', 'project-a', 'member-a');
      const [code] = await closed;
      expect(code).toBe(1008);
    });
  });

  postgresIt('rejects an expired ticket without opening a socket', async () => {
    await withPresenceServer('presence-websocket-expired', async ({ connect, query }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const ticket = await issuePresenceTicket('owner-a', 'project-a');
      await query("UPDATE wujie_presence_tickets SET expires_at = clock_timestamp() - interval '1 second'");
      expect(await rejectedStatus(connect(ticket))).toBe(401);
    });
  });

  postgresIt('rejects a formerly valid ticket after membership revocation', async () => {
    await withPresenceServer('presence-websocket-revoked-ticket', async ({ connect }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const { revokePresenceMember } = await import('../../src/lib/collaboration/presence-members');
      const ticket = await issuePresenceTicket('member-a', 'project-a');
      await revokePresenceMember('owner-a', 'project-a', 'member-a');
      expect(await rejectedStatus(connect(ticket))).toBe(401);
    });
  });

  postgresIt('does not upgrade with the feature flag off and keeps ordinary HTTP available', async () => {
    await withPresenceServer('presence-websocket-disabled', async ({ connect, origin }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const ticket = await issuePresenceTicket('owner-a', 'project-a');
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'false');
      expect(await rejectedStatus(connect(ticket))).toBe(503);
      expect(await (await fetch(`${origin}/_next/static/test.js`)).text()).toBe('next-http');
    });
  });

  postgresIt('rejects oversized and unknown text messages', async () => {
    await withPresenceServer('presence-websocket-invalid-message', async ({ connect }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const large = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(large, 'message');
      const largeClosed = once(large, 'close');
      large.send('x'.repeat(1025));
      expect((await largeClosed)[0]).toBe(1009);

      const unknown = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(unknown, 'message');
      const unknownClosed = once(unknown, 'close');
      unknown.send(JSON.stringify({ type: 'edit', image: 'secret' }));
      expect((await unknownClosed)[0]).toBe(1003);
    });
  });

  postgresIt('limits heartbeat frequency instead of renewing every rapid frame', async () => {
    await withPresenceServer('presence-websocket-heartbeat-rate', async ({ connect }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const client = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(client, 'message');
      client.send(JSON.stringify({ type: 'heartbeat' }));
      const closed = once(client, 'close');
      client.send(JSON.stringify({ type: 'heartbeat' }));
      expect((await closed)[0]).toBe(1008);
    });
  });

  postgresIt('caps queued outbound bytes before sending a snapshot', async () => {
    await withPresenceServer('presence-websocket-send-budget', async ({ connect }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const client = connect(await issuePresenceTicket('owner-a', 'project-a'));
      expect((await once(client, 'close'))[0]).toBe(1008);
    }, { maxBufferedBytes: 1 });
  });

  postgresIt('caps active connections per user and project without adding a third lease', async () => {
    await withPresenceServer('presence-websocket-connection-cap', async ({ connect, query }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      await once(connect(await issuePresenceTicket('owner-a', 'project-a')), 'message');
      await once(connect(await issuePresenceTicket('owner-a', 'project-a')), 'message');
      const excess = connect(await issuePresenceTicket('owner-a', 'project-a'));
      expect((await once(excess, 'close'))[0]).toBe(1008);
      const count = await query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM wujie_presence_leases WHERE project_id = 'project-a'",
      );
      expect(count.rows[0].count).toBe(2);
    }, { maxConnectionsPerUserProject: 2 });
  });

  postgresIt('disconnects and removes a silent connection before it can outlive its lease', async () => {
    await withPresenceServer('presence-websocket-idle-timeout', async ({ connect, query }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const client = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(client, 'message');
      expect((await once(client, 'close'))[0]).toBe(1008);
      let remaining = 1;
      const deadline = Date.now() + 1_000;
      while (Date.now() < deadline) {
        const result = await query<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM wujie_presence_leases WHERE user_id = 'owner-a'",
        );
        remaining = result.rows[0].count;
        if (remaining === 0) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(remaining).toBe(0);
    }, { heartbeatTimeoutMs: 75 });
  });

  postgresIt('removes a lease when the socket closes while its join is still blocked', async () => {
    await withPresenceServer('presence-websocket-close-during-join', async ({ connect, query }) => {
      await query(`
        CREATE FUNCTION hold_websocket_presence_join() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(9911999);
          RETURN NEW;
        END $$;
        CREATE TRIGGER hold_websocket_presence_join_before_insert
          BEFORE INSERT ON wujie_presence_leases
          FOR EACH ROW EXECUTE FUNCTION hold_websocket_presence_join();
      `);
      const { Client } = await import('pg');
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const locker = new Client({ connectionString: process.env.DATABASE_URL });
      await locker.connect();
      let lockHeld = false;
      try {
        await locker.query('SELECT pg_advisory_lock(9911999)');
        lockHeld = true;
        const lockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const client = connect(await issuePresenceTicket('owner-a', 'project-a'));
        await once(client, 'open');
        let joinBlocked = false;
        const blockedDeadline = Date.now() + 2_000;
        while (Date.now() < blockedDeadline) {
          const waiting = await query<{ count: number }>(
            'SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
            [lockerPid],
          );
          if (waiting.rows[0].count > 0) { joinBlocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(joinBlocked).toBe(true);
        const closed = once(client, 'close');
        client.terminate();
        await closed;
        await new Promise(resolve => setTimeout(resolve, 50));
        await locker.query('SELECT pg_advisory_unlock(9911999)');
        lockHeld = false;
        let sequence = 0;
        const cleanupDeadline = Date.now() + 1_000;
        while (Date.now() < cleanupDeadline) {
          const result = await query<{ sequence: number }>(
            "SELECT sequence::int FROM wujie_presence_project_sequences WHERE project_id = 'project-a'",
          );
          sequence = result.rows[0]?.sequence ?? 0;
          if (sequence >= 2) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(sequence).toBe(2);
        expect((await query('SELECT 1 FROM wujie_presence_leases')).rowCount).toBe(0);
      } finally {
        if (lockHeld) await locker.query('SELECT pg_advisory_unlock(9911999)');
        await locker.end();
      }
    });
  });

  postgresIt('accepts a configured public host without a URL scheme', async () => {
    await withPresenceServer('presence-websocket-configured-host', async ({ connect, origin }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', new URL(origin).host);
      const client = connect(await issuePresenceTicket('owner-a', 'project-a'), {
        origin: `https://${new URL(origin).host}`,
      });
      expect((await once(client, 'message'))[0]).toBeDefined();
    });
  });

  postgresIt('starts the real gateway from the enabled server entry', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-websocket-live-entry', async ({ query }) => {
      await setupPresenceDatabase(query);
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const { startLivePresenceServer } = await import('../../scripts/presence-server');
      const runtime = await startLivePresenceServer({
        port: 0,
        hostname: '127.0.0.1',
        dev: false,
        createNextApp: () => ({
          prepare: async () => {},
          getRequestHandler: () => (_request, response) => response.end('next-http'),
          getUpgradeHandler: () => (_request, socket) => socket.destroy(),
        }),
      });
      let client: WebSocket | undefined;
      try {
        const port = (runtime.server.address() as AddressInfo).port;
        const origin = `http://127.0.0.1:${port}`;
        client = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/presence`, [
          'wujie-presence-v1', `wujie-ticket.${await issuePresenceTicket('owner-a', 'project-a')}`,
        ], { origin });
        const [frame] = await once(client, 'message');
        expect(JSON.parse(String(frame))).toMatchObject({ type: 'snapshot', projectId: 'project-a' });
        expect(await (await fetch(`${origin}/api/auth/me`)).text()).toBe('next-http');
      } finally {
        client?.terminate();
        await runtime.close();
        vi.unstubAllEnvs();
      }
    });
  });

  postgresIt('delivers one project membership snapshot to connections on two gateway instances', async () => {
    await withPresenceServer('presence-websocket-two-gateways', async ({ connect, query }) => {
      const { createPresenceGateway } = await import('../../src/lib/collaboration/presence-gateway');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const ownerTicket = await issuePresenceTicket('owner-a', 'project-a');
      const memberTicket = await issuePresenceTicket('member-a', 'project-a');
      const owner = connect(ownerTicket);
      await once(owner, 'message');
      const readyDeadline = Date.now() + 2_000;
      let listening = false;
      while (Date.now() < readyDeadline) {
        const result = await query<{ count: number }>(`
          SELECT COUNT(*)::int AS count FROM pg_stat_activity
           WHERE query = 'LISTEN wujie_presence_changed'
        `);
        if (result.rows[0].count > 0) { listening = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(listening).toBe(true);

      const peer = createPresenceGateway({ instanceId: 'peer-instance' });
      const peerServer = createPresenceHttpServer({
        onRequest: (_request, response) => response.end('peer-http'),
        onPresenceUpgrade: (request, socket, head) => {
          void peer.handlePresenceUpgrade(request, socket, head);
        },
      });
      let member: WebSocket | undefined;
      try {
        peerServer.listen(0, '127.0.0.1');
        await once(peerServer, 'listening');
        const port = (peerServer.address() as AddressInfo).port;
        const changed = once(owner, 'message');
        member = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/presence`, [
          'wujie-presence-v1', `wujie-ticket.${memberTicket}`,
        ], { origin: `http://127.0.0.1:${port}` });
        const [memberFrame] = await once(member, 'message');
        const [ownerFrame] = await changed;
        for (const frame of [memberFrame, ownerFrame]) {
          expect(JSON.parse(String(frame))).toMatchObject({
            type: 'snapshot',
            projectId: 'project-a',
            sequence: 2,
            participants: [
              { userId: 'member-a', displayName: 'Member A' },
              { userId: 'owner-a', displayName: 'Owner A' },
            ],
          });
        }
      } finally {
        member?.terminate();
        await peer.close();
        peerServer.closeAllConnections();
        await new Promise<void>(resolve => peerServer.close(() => resolve()));
      }
    });
  });

  postgresIt('delivers a membership change across independent gateway processes', async () => {
    await withPresenceServer('presence-websocket-independent-processes', async ({ connect }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const owner = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(owner, 'message');

      const child = spawn(process.execPath, [
        '--conditions=react-server', '--import', 'tsx', 'tests/helpers/presence-websocket-child.ts',
      ], {
        cwd: process.cwd(),
        env: { ...process.env, WUJIE_PRESENCE_ENABLED: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const childExit = once(child, 'exit');
      let member: WebSocket | undefined;
      try {
        const port = await new Promise<number>((resolve, reject) => {
          let stdout = '';
          let stderr = '';
          const timeout = setTimeout(() => reject(new Error(`child gateway did not start: ${stderr}`)), 8_000);
          child.stdout!.on('data', (chunk: Buffer) => {
            stdout += String(chunk);
            const line = stdout.split(/\r?\n/u)[0];
            if (!/^\d+$/u.test(line)) return;
            clearTimeout(timeout);
            resolve(Number(line));
          });
          child.stderr!.on('data', (chunk: Buffer) => { stderr += String(chunk); });
          child.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`child gateway exited ${code}: ${stderr}`));
          });
        });
        const changed = once(owner, 'message');
        member = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/presence`, [
          'wujie-presence-v1', `wujie-ticket.${await issuePresenceTicket('member-a', 'project-a')}`,
        ], { origin: `http://127.0.0.1:${port}` });
        const [memberFrame] = await once(member, 'message');
        const [ownerFrame] = await changed;
        for (const frame of [memberFrame, ownerFrame]) {
          expect(JSON.parse(String(frame))).toMatchObject({
            type: 'snapshot', projectId: 'project-a', sequence: 2,
            participants: [{ userId: 'member-a' }, { userId: 'owner-a' }],
          });
        }
      } finally {
        member?.terminate();
        child.kill('SIGTERM');
        await childExit;
      }
    });
  });

  postgresIt.each([false, true])('shares one roster read across local clients for one project notification (delayed initialization: %s)', async delayInitialization => {
    await withPresenceServer('presence-websocket-shared-roster-read', async ({ connect, query }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const leases = await import('../../src/lib/collaboration/presence-leases');
      const actualJoin = leases.joinPresence;
      const actualSnapshot = leases.readPresenceSnapshot;
      const actualSubscribe = leases.subscribePresence;
      const joinedSignals = new Set<AbortSignal>();
      const initializedSignals = new Set<AbortSignal>();
      const reads: Array<Promise<Awaited<ReturnType<typeof actualSnapshot>>>> = [];
      const refreshes: Promise<void>[] = [];
      const removeFrameListeners: Array<() => void> = [];
      let markInitialized: () => void = (): void => undefined;
      const initialized = new Promise<void>(resolve => { markInitialized = resolve; });
      let markBarrierReceived: () => void = (): void => undefined;
      const barrierReceived = new Promise<void>(resolve => { markBarrierReceived = resolve; });
      let notifications = 0;
      let secondSignal: AbortSignal | undefined;
      let joinCount = 0;
      let releaseInitialRead: () => void = (): void => undefined;
      const initialReadGate = new Promise<void>(resolve => { releaseInitialRead = resolve; });
      let markInitialHeld: () => void = (): void => undefined;
      const initialHeld = new Promise<void>(resolve => { markInitialHeld = resolve; });
      const joinObserver = vi.spyOn(leases, 'joinPresence').mockImplementation(async (input, signal) => {
        joinCount += 1;
        if (joinCount === 2) secondSignal = signal;
        const result = await actualJoin(input, signal);
        if (signal) joinedSignals.add(signal);
        return result;
      });
      const snapshotObserver = vi.spyOn(leases, 'readPresenceSnapshot').mockImplementation((projectId, signal) => {
        const pending = (async (): Promise<Awaited<ReturnType<typeof actualSnapshot>>> => {
          if (delayInitialization && signal !== undefined && signal === secondSignal && joinedSignals.has(signal)) {
            markInitialHeld();
            await initialReadGate;
          }
          const result = await actualSnapshot(projectId, signal);
          if (signal && joinedSignals.has(signal)) initializedSignals.add(signal);
          if (initializedSignals.size === 2) markInitialized();
          return result;
        })();
        reads.push(pending);
        void pending.catch(() => undefined);
        return pending;
      });
      // The second join and the explicit barrier each emit a real notification.
      // A sequence-3 frame can come from the older queued refresh: own both
      // actual callback settlements instead of treating that frame as drain.
      const subscriptionObserver = vi.spyOn(leases, 'subscribePresence').mockImplementation((projectId, onChange, interval) =>
        actualSubscribe(projectId, () => {
          const pending = Promise.resolve(onChange());
          refreshes.push(pending);
          void pending.catch(() => undefined);
          notifications += 1;
          if (notifications === 2) markBarrierReceived();
          return pending;
        }, interval));
      let bodyFailed = false;
      let bodyError: unknown;
      try {
      const first = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(first, 'message');
      const second = connect(await issuePresenceTicket('owner-a', 'project-a'));
      if (delayInitialization) await observeWithin(initialHeld, 2_000, 'second initialization held');
      else await once(second, 'message');
      const atSequence = (socket: WebSocket, sequence: number): Promise<void> => new Promise(resolve => {
        const onFrame = (data: WebSocket.RawData): void => {
          if ((JSON.parse(String(data)) as { sequence: number }).sequence !== sequence) return;
          socket.removeListener('message', onFrame);
          resolve();
        };
        removeFrameListeners.push((): void => { socket.removeListener('message', onFrame); });
        socket.on('message', onFrame);
      });
      const firstReady = atSequence(first, 3);
      const secondReady = atSequence(second, 3);
      await query("UPDATE wujie_presence_project_sequences SET sequence = sequence + 1 WHERE project_id = 'project-a'");
      await query("SELECT pg_notify('wujie_presence_changed', 'project-a')");
      await Promise.all([firstReady, secondReady]);
      if (delayInitialization) expect(initializedSignals.size).toBe(1);
      releaseInitialRead();
      await observeWithin(initialized, 2_000, 'both actual post-join snapshots returned');
      await observeWithin(barrierReceived, 2_000, 'join and barrier notifications received');
      await Promise.all(refreshes);
      expect(initializedSignals.size).toBe(2);
      await withRosterReadBudget(1, async (): Promise<void> => {
        const firstChange = atSequence(first, 4);
        const secondChange = atSequence(second, 4);
        await query("UPDATE wujie_presence_project_sequences SET sequence = sequence + 1 WHERE project_id = 'project-a'");
        await query("SELECT pg_notify('wujie_presence_changed', 'project-a')");
        await Promise.all([firstChange, secondChange]);
      });
      } catch (error) { bodyFailed = true; bodyError = error; throw error; }
      finally {
        await runPostgresCleanup([
          { name: 'release-initial-snapshot-producer', run: releaseInitialRead },
          { name: 'drain-real-snapshots-and-notifications', run: async (): Promise<void> => {
            const settled = await Promise.allSettled([...reads, ...refreshes]);
            const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
            if (errors.length > 0) throw new AggregateError(errors, 'Actual initialization or refresh failed');
          } },
          { name: 'restore-shared-roster-observers', run: (): void => {
            snapshotObserver.mockRestore(); joinObserver.mockRestore(); subscriptionObserver.mockRestore();
            for (const remove of removeFrameListeners) remove();
          } },
        ]).catch((cleanupError: unknown): never => {
          if (!bodyFailed) throw cleanupError;
          throw new AggregateError([bodyError, cleanupError], 'Shared roster body and cleanup failed');
        });
      }
    });
  });

  postgresIt('waits for a blocked lease deletion before gateway shutdown returns', async () => {
    await withPresenceServer('presence-websocket-shutdown-cleanup', async ({ connect, gateway, query }) => {
      await query(`
        CREATE FUNCTION hold_presence_leave() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(9912001);
          RETURN OLD;
        END $$;
        CREATE TRIGGER hold_presence_leave_before_delete
          BEFORE DELETE ON wujie_presence_leases
          FOR EACH ROW EXECUTE FUNCTION hold_presence_leave();
      `);
      const { Client } = await import('pg');
      const locker = new Client({ connectionString: process.env.DATABASE_URL });
      await locker.connect();
      let held = false;
      try {
        await locker.query('SELECT pg_advisory_lock(9912001)');
        held = true;
        const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
        const client = connect(await issuePresenceTicket('owner-a', 'project-a'));
        await once(client, 'message');
        let finished = false;
        const shutdown = gateway.close().then(() => { finished = true; });
        const lockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        let waiting = false;
        const deadline = Date.now() + 2_000;
        while (Date.now() < deadline) {
          const blocked = await query<{ count: number }>(
            'SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
            [lockerPid],
          );
          if (blocked.rows[0].count > 0) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
        expect(finished).toBe(false);
        await locker.query('SELECT pg_advisory_unlock(9912001)');
        held = false;
        await shutdown;
        expect((await query('SELECT 1 FROM wujie_presence_leases')).rowCount).toBe(0);
      } finally {
        if (held) await locker.query('SELECT pg_advisory_unlock(9912001)');
        await locker.end();
      }
    });
  });

  postgresIt('does not broadcast a full roster for heartbeat-only last-seen changes', async () => {
    await withPresenceServer('presence-websocket-last-seen-reconcile', async ({ connect, query }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const owner = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(owner, 'message');
      const member = connect(await issuePresenceTicket('member-a', 'project-a'));
      await once(member, 'message');
      await new Promise(resolve => setTimeout(resolve, 100));
      const settled = new Promise<void>(resolve => {
        member.on('message', data => {
          if ((JSON.parse(String(data)) as { sequence: number }).sequence === 3) resolve();
        });
      });
      await query("UPDATE wujie_presence_project_sequences SET sequence = sequence + 1 WHERE project_id = 'project-a'");
      await query("SELECT pg_notify('wujie_presence_changed', 'project-a')");
      await settled;
      const before = await query<{ last_seen_at: Date }>(
        "SELECT last_seen_at FROM wujie_presence_leases WHERE user_id = 'owner-a'",
      );
      let receivedFresh = false;
      member.on('message', data => {
        const frame = JSON.parse(String(data)) as {
          sequence: number;
          participants: Array<{ userId: string; lastSeenAt: string }>;
        };
        const ownerInFrame = frame.participants.find(person => person.userId === 'owner-a');
        if (frame.sequence === 3 && ownerInFrame
          && new Date(ownerInFrame.lastSeenAt) > before.rows[0].last_seen_at) receivedFresh = true;
      });
      owner.send(JSON.stringify({ type: 'heartbeat' }));
      let renewed = false;
      const renewalDeadline = Date.now() + 1_000;
      while (!renewed && Date.now() < renewalDeadline) {
        const current = await query<{ last_seen_at: Date }>(
          "SELECT last_seen_at FROM wujie_presence_leases WHERE user_id = 'owner-a'",
        );
        renewed = current.rows[0].last_seen_at > before.rows[0].last_seen_at;
        if (!renewed) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(renewed).toBe(true);
      let reconciled = false;
      const deadline = Date.now() + 1_000;
      await withRosterReadBudget(undefined, async (rosterReads: RosterReadObservation): Promise<void> => {
        while (!reconciled && Date.now() < deadline) {
          reconciled = rosterReads.completed() > 0;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      });
      expect(reconciled).toBe(true);
      expect(receivedFresh).toBe(false);
    }, { reconcileIntervalMs: 100 });
  });

  postgresIt('reconciles a filtered-out participant without requiring a sequence bump', async () => {
    await withPresenceServer('presence-websocket-filter-reconcile', async ({ connect, query }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const owner = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(owner, 'message');
      const member = connect(await issuePresenceTicket('member-a', 'project-a'));
      await once(member, 'message');
      const ownerReady = new Promise<void>(resolve => {
        owner.on('message', data => {
          if ((JSON.parse(String(data)) as { sequence: number }).sequence === 3) resolve();
        });
      });
      await query("UPDATE wujie_presence_project_sequences SET sequence = sequence + 1 WHERE project_id = 'project-a'");
      await query("SELECT pg_notify('wujie_presence_changed', 'project-a')");
      await ownerReady;
      const changed = once(owner, 'message');
      const removed = once(member, 'close');
      await query("UPDATE wujie_users SET status = 'disabled' WHERE id = 'member-a'");
      const [frame] = await changed;
      expect(JSON.parse(String(frame))).toMatchObject({
        type: 'snapshot', sequence: 3,
        participants: [{ userId: 'owner-a' }],
      });
      expect((await removed)[0]).toBe(1008);
    }, { reconcileIntervalMs: 100 });
  });
});
