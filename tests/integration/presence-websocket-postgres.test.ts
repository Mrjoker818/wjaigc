import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';

import type { QueryFn } from '../helpers/postgres-test-database';
import type { PresenceGateway } from '../../src/lib/collaboration/presence-gateway';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

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
      const { getPool } = await import('../../src/lib/db-client');
      const rosterReads = vi.spyOn(getPool(), 'query');
      try {
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
        expect(rosterReads.mock.calls.filter(([sql]) =>
          typeof sql === 'string' && sql.includes('FROM wujie_presence_leases lease'))).toHaveLength(0);
        const sequence = await query<{ sequence: number }>(
          "SELECT sequence::int FROM wujie_presence_project_sequences WHERE project_id = 'project-a'",
        );
        expect(sequence.rows[0].sequence).toBe(1);
      } finally {
        rosterReads.mockRestore();
      }
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

  postgresIt('shares one roster read across local clients for one project notification', async () => {
    await withPresenceServer('presence-websocket-shared-roster-read', async ({ connect, query }) => {
      const { issuePresenceTicket } = await import('../../src/lib/collaboration/presence-tickets');
      const first = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(first, 'message');
      const second = connect(await issuePresenceTicket('owner-a', 'project-a'));
      await once(second, 'message');
      const afterBarrier = (socket: WebSocket): Promise<void> => new Promise(resolve => {
        socket.on('message', data => {
          if ((JSON.parse(String(data)) as { sequence: number }).sequence === 3) resolve();
        });
      });
      const firstReady = afterBarrier(first);
      const secondReady = afterBarrier(second);
      await query("UPDATE wujie_presence_project_sequences SET sequence = sequence + 1 WHERE project_id = 'project-a'");
      await query("SELECT pg_notify('wujie_presence_changed', 'project-a')");
      await Promise.all([firstReady, secondReady]);
      const { getPool } = await import('../../src/lib/db-client');
      const rosterReads = vi.spyOn(getPool(), 'query');
      try {
        const firstChange = once(first, 'message');
        const secondChange = once(second, 'message');
        await query("UPDATE wujie_presence_project_sequences SET sequence = sequence + 1 WHERE project_id = 'project-a'");
        await query("SELECT pg_notify('wujie_presence_changed', 'project-a')");
        await Promise.all([firstChange, secondChange]);
        expect(rosterReads.mock.calls.filter(([sql]) =>
          typeof sql === 'string' && sql.includes('FROM wujie_presence_leases lease'))).toHaveLength(1);
      } finally {
        rosterReads.mockRestore();
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
      const { getPool } = await import('../../src/lib/db-client');
      const rosterReads = vi.spyOn(getPool(), 'query');
      let reconciled = false;
      const deadline = Date.now() + 1_000;
      while (!reconciled && Date.now() < deadline) {
        reconciled = rosterReads.mock.calls.some(([sql]) =>
          typeof sql === 'string' && sql.includes('FROM wujie_presence_leases lease'));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      rosterReads.mockRestore();
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
