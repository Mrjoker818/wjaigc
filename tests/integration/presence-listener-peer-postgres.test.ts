import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';

import { Client, type QueryResult } from 'pg';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

import type { PresenceGateway } from '../../src/lib/collaboration/presence-gateway';
import { presenceSnapshotFrameSchema, type PresenceSnapshotFrame } from '../../src/lib/collaboration/presence-schema';
import { runPostgresCleanup, withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
interface Identity { pid: number; backend_start: string; datname: string; usename: string }
interface Peer { socket: WebSocket; frames: PresenceSnapshotFrame[]; closed: Promise<void> }

async function within<T>(pending: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Observation exceeded: ${label}`)), 5_000);
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

async function verifySurvivor(kind: 'initializing-room' | 'another-gateway'): Promise<void> {
  requireOfflineBridgeTestDatabaseUrl(process.env);
  await withIsolatedPostgres('presence-listener-peer', async ({ query, databaseUrl }) => {
    const gateways: PresenceGateway[] = []; const servers: Server[] = []; const peers: Peer[] = [];
    const operations: Promise<unknown>[] = []; const listenerIdentities = new Map<Client, Identity>();
    const frameErrors: unknown[] = [];
    let locker: Client | undefined; let restoreQuery: (() => void) | undefined;
    let restoreJoin: (() => void) | undefined;
    let releaseSecondJoin: () => void = (): void => undefined;
    const secondJoinGate = new Promise<void>(resolve => { releaseSecondJoin = resolve; });
    let secondJoinDelivered = false;
    let bodyFailed = false; let bodyError: unknown;
    const lockKey = 99129302;
    try {
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true'); vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
      vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
      for (const file of ['migrations/20260809_wj_core_users.sql', 'migrations/20260810_wj_stable_s2_assets.sql',
        'migrations/20260924_project_presence.sql', 'migrations/20260924_project_presence_tickets.sql',
        'migrations/20260924_project_presence_ttl_leases.sql']) await query(await readFile(file, 'utf8'));
      await query(`INSERT INTO wujie_users(id,name,password_hash,status,created_at,updated_at)
        VALUES ('owner','Owner','test','active',1,1)`);
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project','owner','Project')");
      locker = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
      await locker.connect();
      const lockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      if (kind === 'initializing-room') await locker.query('SELECT pg_advisory_lock($1)', [lockKey]);
      const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult> = Client.prototype.query;
      const observer = vi.spyOn(Client.prototype, 'query').mockImplementation(function (
        this: Client, text: string, values?: unknown[], callback?: (error: Error, result: QueryResult) => void,
      ): Promise<QueryResult> {
        const operation = (async (): Promise<QueryResult> => {
          if (text === 'LISTEN wujie_presence_changed') {
            const identity = (await nativeQuery.call(this, `SELECT pid,backend_start::text AS backend_start,datname,usename
              FROM pg_stat_activity WHERE pid=pg_backend_pid()`)).rows[0] as Identity | undefined;
            if (!identity) throw new Error('Actual listener identity required');
            listenerIdentities.set(this, identity);
            if (kind === 'initializing-room') await nativeQuery.call(this, 'SELECT pg_advisory_xact_lock($1)', [lockKey]);
          }
          return await nativeQuery.call(this, text, values);
        })();
        operations.push(operation); void operation.catch(() => undefined);
        if (callback) {
          const delivery = operation.then(result => { Reflect.apply(callback, undefined, [null, result]); },
            (error: unknown): void => { Reflect.apply(callback, undefined, [error]); });
          operations.push(delivery); void delivery.catch(() => undefined);
        }
        return operation;
      });
      restoreQuery = (): void => { observer.mockRestore(); };
      const { createPresenceGateway } = await import('../../src/lib/collaboration/presence-gateway');
      const { createPresenceHttpServer } = await import('../../scripts/presence-server');
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const leases = await import('../../src/lib/collaboration/presence-leases');
      const { leavePresence } = leases;
      if (kind === 'initializing-room') {
        const nativeJoin = leases.joinPresence;
        let joinIndex = 0;
        const joinObserver = vi.spyOn(leases, 'joinPresence').mockImplementation((input, signal): ReturnType<typeof nativeJoin> => {
          const second = ++joinIndex === 2;
          const delivery = nativeJoin(input, signal).then(async snapshot => {
            if (second) await secondJoinGate;
            return snapshot;
          });
          // Gateway's continuation publishes Room membership synchronously
          // after delivery, before awaiting shared ready. Observe the real
          // delivery and the following event-loop turn, not COMMIT alone.
          if (second) {
            const delivered = delivery.then(() => new Promise<void>(resolve => setImmediate(() => {
              secondJoinDelivered = true; resolve();
            })));
            operations.push(delivered); void delivered.catch(() => undefined);
          }
          return delivery;
        });
        restoreJoin = (): void => { joinObserver.mockRestore(); };
      }
      const firstGateway = createPresenceGateway({ instanceId: 'first', reconcileIntervalMs: 60_000 }); gateways.push(firstGateway);
      const start = async (gateway: PresenceGateway): Promise<string> => {
        const server = createPresenceHttpServer({ onRequest: (_request, response) => response.end('controlled-http'),
          onPresenceUpgrade: (request, socket, head) => {
            const upgrade = gateway.handlePresenceUpgrade(request, socket, head);
            operations.push(upgrade); void upgrade.catch(() => socket.destroy());
          } });
        servers.push(server); server.listen(0, '127.0.0.1'); await within(once(server, 'listening'), 'HTTP listening');
        const address = server.address(); if (!address || typeof address === 'string') throw new Error('Loopback address required');
        return `http://127.0.0.1:${address.port}`;
      };
      const connect = async (origin: string): Promise<Peer> => {
        const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/collaboration/presence`,
          ['wujie-presence-v1', `wujie-ticket.${await issuePresenceTicket('owner', 'project')}`], { origin });
        socket.on('error', () => undefined);
        const peer: Peer = { socket, frames: [], closed: new Promise<void>(resolve => socket.once('close', () => resolve())) };
        peers.push(peer);
        socket.on('message', raw => {
          try { peer.frames.push(presenceSnapshotFrameSchema.parse(JSON.parse(String(raw)))); }
          catch (error) { frameErrors.push(error); }
        });
        await within(once(socket, 'open'), 'real WebSocket 101'); return peer;
      };
      const origin = await start(firstGateway); const first = await connect(origin);
      if (kind === 'initializing-room') await until(async () => (await query<{ count: number }>(`SELECT count(*)::int AS count
        FROM pg_stat_activity WHERE query='SELECT pg_advisory_xact_lock($1)' AND $1::int=ANY(pg_blocking_pids(pid))`, [lockerPid])).rows[0].count === 1,
      'real first listener held pipeline');
      else await until(async () => first.frames.length > 0, 'first snapshot');
      let survivorOrigin = origin;
      if (kind === 'another-gateway') {
        const secondGateway = createPresenceGateway({ instanceId: 'second', reconcileIntervalMs: 60_000 }); gateways.push(secondGateway);
        survivorOrigin = await start(secondGateway);
      }
      const survivor = await connect(survivorOrigin);
      await until(async () => (await query('SELECT 1 FROM wujie_presence_leases')).rowCount === 2, 'both committed leases');
      if (kind === 'initializing-room') {
        expect(secondJoinDelivered, 'Two committed leases cannot release the Room-membership barrier').toBe(false);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(secondJoinDelivered).toBe(false);
        releaseSecondJoin();
        await until(async () => secondJoinDelivered && survivor.socket.readyState === WebSocket.OPEN,
          'actual second join delivery and gateway membership continuation before first exit');
      }
      if (kind === 'another-gateway') await until(async () => survivor.frames.length > 0, 'second gateway snapshot');
      expect(listenerIdentities.size).toBe(1);
      const [listenerClient, identity] = [...listenerIdentities.entries()][0];
      if (kind === 'initializing-room') { first.socket.close(); await within(first.closed, 'first physical exit'); }
      else await within(firstGateway.close(), 'first gateway close with another gateway alive');
      await until(async () => (await query('SELECT 1 FROM wujie_presence_leases')).rowCount === 1, 'only survivor lease remains');
      expect(listenerClient.connection.stream.closed).toBe(false);
      expect((await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
      [identity.pid, identity.backend_start, identity.datname, identity.usename])).rows[0].count).toBe(1);
      if (kind === 'initializing-room') await locker.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      await until(async () => survivor.frames.some(frame => frame.sequence === 3), 'survivor gets current actual snapshot');
      await leases.joinPresence({ connectionId: 'peer-notification-probe', userId: 'owner', projectId: 'project', instanceId: 'probe' });
      await until(async () => survivor.frames.some(frame => frame.sequence === 4), 'actual notification delivered to surviving Room');
      await leavePresence('peer-notification-probe');
      expect(listenerIdentities.size).toBe(1); expect(frameErrors).toHaveLength(0);
      await within(Promise.all(gateways.map(gateway => gateway.close())), 'all gateway close');
      expect(listenerClient.connection.stream.closed).toBe(true);
      expect((await query('SELECT 1 FROM wujie_presence_leases')).rowCount).toBe(0);
    } catch (error) { bodyFailed = true; bodyError = error; throw error; }
    finally {
      await runPostgresCleanup([
        { name: 'release-second-native-join-delivery', run: releaseSecondJoin },
        { name: 'unlock-before-draining-native-observations', run: async (): Promise<void> => { if (locker) await locker.query('SELECT pg_advisory_unlock($1)', [lockKey]); } },
        { name: 'stop-peers', run: (): void => { for (const peer of peers) peer.socket.terminate(); } },
        ...gateways.map((gateway, index) => ({ name: `close-gateway-${index}`, run: (): Promise<void> => within(gateway.close(), 'gateway cleanup') })),
        { name: 'restore-query-observer', run: (): void => { restoreQuery?.(); } },
        { name: 'restore-join-delivery-observer', run: (): void => { restoreJoin?.(); } },
        { name: 'settle-real-SQL-and-callbacks', run: async (): Promise<void> => {
          const settled = await within(Promise.allSettled(operations), 'native observations');
          const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
          if (errors.length > 0) throw new AggregateError(errors, 'Peer native observations failed');
        } },
        ...servers.map((server, index) => ({ name: `close-HTTP-${index}`, run: async (): Promise<void> => {
          server.closeAllConnections(); await within(new Promise<void>((resolve, reject) => server.close(error => { if (error) reject(error); else resolve(); })), 'HTTP cleanup');
        } })),
        { name: 'end-locker', run: async (): Promise<void> => { if (locker) await within(locker.end(), 'locker cleanup'); } },
        { name: 'restore-environment', run: (): void => { vi.unstubAllEnvs(); } },
      ]).catch((cleanupError: unknown): never => {
        if (bodyFailed) throw new AggregateError([bodyError, cleanupError], 'Peer body and cleanup failed');
        throw cleanupError;
      });
    }
  });
}

describe('actual Room and gateway listener survivors', () => {
  postgresIt.each(['initializing-room', 'another-gateway'] as const)(
    'preserves the actual listener for a survivor: %s', async kind => verifySurvivor(kind), 30_000,
  );
});
