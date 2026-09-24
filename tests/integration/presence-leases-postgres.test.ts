import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { describe, expect, it, vi } from 'vitest';

import type { QueryFn } from '../helpers/postgres-test-database';

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
           ('owner-b', 'Owner B', 'test', 'active', 1, 1),
           ('member-a', 'Member A', 'test', 'active', 1, 1)
  `);
  await query(`INSERT INTO wujie_projects (id, owner_id, name)
               VALUES ('project-a', 'owner-a', 'A'), ('project-b', 'owner-b', 'B')`);
  await query(`
    INSERT INTO wujie_project_presence_members (project_id, owner_id, member_user_id)
    VALUES ('project-a', 'owner-a', 'member-a')
  `);
}

describe('presence leases on isolated PostgreSQL', () => {
  postgresIt('serializes concurrent joins from two instances into one project sequence', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-concurrent-sequence', async ({ query }) => {
      await setupPresenceDatabase(query);
      const { joinPresence, readPresenceSnapshot } =
        await import('../../src/lib/collaboration/presence-leases');
      await Promise.all(Array.from({ length: 20 }, (_, index) => joinPresence({
        connectionId: `concurrent-${index}`,
        userId: index % 2 === 0 ? 'owner-a' : 'member-a',
        projectId: 'project-a',
        instanceId: index % 2 === 0 ? 'instance-one' : 'instance-two',
      })));
      const snapshot = await readPresenceSnapshot('project-a');
      expect(snapshot.sequence).toBe(20);
      expect(snapshot.participants.map(person => person.userId)).toEqual(['member-a', 'owner-a']);
      const persisted = await query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM wujie_presence_leases WHERE project_id = $1',
        ['project-a'],
      );
      expect(persisted.rows[0]?.count).toBe(20);
    });
  });

  postgresIt('merges two connections from one user and removes only the connection that left', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-aggregation', async ({ query }) => {
      await setupPresenceDatabase(query);

      const { joinPresence, leavePresence, readPresenceSnapshot } =
        await import('../../src/lib/collaboration/presence-leases');
      const first = await joinPresence({
        connectionId: 'connection-1', userId: 'member-a', projectId: 'project-a', instanceId: 'one',
      });
      expect(first.sequence).toBe(1);
      expect(first.participants).toEqual([{
        userId: 'member-a', displayName: 'Member A', lastSeenAt: expect.any(String),
      }]);

      const second = await joinPresence({
        connectionId: 'connection-2', userId: 'member-a', projectId: 'project-a', instanceId: 'two',
      });
      expect(second.sequence).toBe(2);
      expect(second.participants).toHaveLength(1);

      await leavePresence('connection-1');
      const afterOneLeft = await readPresenceSnapshot('project-a');
      expect(afterOneLeft.sequence).toBe(3);
      expect(afterOneLeft.participants.map(person => person.userId)).toEqual(['member-a']);

      await leavePresence('connection-2');
      const afterBothLeft = await readPresenceSnapshot('project-a');
      expect(afterBothLeft.sequence).toBe(4);
      expect(afterBothLeft.participants).toEqual([]);
    });
  });

  postgresIt('renews only live leases and removes expired connections after a crash', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-ttl', async ({ query }) => {
      await setupPresenceDatabase(query);
      const { joinPresence, renewPresence, expirePresenceLeases, readPresenceSnapshot } =
        await import('../../src/lib/collaboration/presence-leases');
      await joinPresence({
        connectionId: 'connection-live', userId: 'member-a', projectId: 'project-a', instanceId: 'one',
      });
      await expect(renewPresence('connection-live')).resolves.toBe(true);
      const liveLease = await query<{ lifetime_seconds: number }>(`
        SELECT EXTRACT(EPOCH FROM expires_at - last_seen_at)::float8 AS lifetime_seconds
          FROM wujie_presence_leases WHERE connection_id = 'connection-live'
      `);
      expect(liveLease.rows[0]?.lifetime_seconds).toBe(45);
      expect((await readPresenceSnapshot('project-a')).sequence).toBe(2);

      await query(`UPDATE wujie_presence_leases
                      SET expires_at = clock_timestamp() - interval '1 second'
                    WHERE connection_id = 'connection-live'`);
      await expect(renewPresence('connection-live')).resolves.toBe(false);
      expect((await readPresenceSnapshot('project-a')).participants).toEqual([]);
      await expect(expirePresenceLeases()).resolves.toBe(1);
      const cleaned = await readPresenceSnapshot('project-a');
      expect(cleaned.sequence).toBe(3);
      expect(cleaned.participants).toEqual([]);
      expect((await query("SELECT 1 FROM wujie_presence_leases WHERE connection_id = 'connection-live'"))
        .rowCount).toBe(0);
    });
  });

  postgresIt('expires lease backlog in bounded batches', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-bounded-expiry', async ({ query }) => {
      await setupPresenceDatabase(query);
      const { joinPresence, expirePresenceLeases } =
        await import('../../src/lib/collaboration/presence-leases');
      for (const connectionId of ['expired-a', 'expired-b', 'expired-c']) {
        await joinPresence({ connectionId, userId: 'member-a', projectId: 'project-a', instanceId: 'one' });
      }
      await query(`UPDATE wujie_presence_leases
                      SET expires_at = clock_timestamp() - interval '1 second'
                    WHERE project_id = 'project-a'`);
      await expect(expirePresenceLeases(1)).resolves.toBe(1);
      const left = await query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM wujie_presence_leases WHERE project_id = 'project-a'",
      );
      expect(left.rows[0].count).toBe(2);
      await expect(expirePresenceLeases(1)).resolves.toBe(1);
      await expect(expirePresenceLeases(1)).resolves.toBe(1);
      await expect(expirePresenceLeases(1)).resolves.toBe(0);
    });
  });

  postgresIt('isolates projects and immediately removes a revoked member from the authority snapshot', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-revocation', async ({ query }) => {
      await setupPresenceDatabase(query);
      const { joinPresence, readPresenceSnapshot, renewPresence } =
        await import('../../src/lib/collaboration/presence-leases');
      const { revokePresenceMember } =
        await import('../../src/lib/collaboration/presence-members');
      await joinPresence({
        connectionId: 'connection-a', userId: 'member-a', projectId: 'project-a', instanceId: 'one',
      });
      await joinPresence({
        connectionId: 'connection-b', userId: 'owner-b', projectId: 'project-b', instanceId: 'two',
      });
      expect((await readPresenceSnapshot('project-b')).participants.map(p => p.userId))
        .toEqual(['owner-b']);
      expect((await readPresenceSnapshot('project-a')).participants.map(p => p.userId))
        .toEqual(['member-a']);

      await revokePresenceMember('owner-a', 'project-a', 'member-a');
      const revoked = await readPresenceSnapshot('project-a');
      expect(revoked.sequence).toBe(2);
      expect(revoked.participants).toEqual([]);
      expect((await query("SELECT 1 FROM wujie_presence_leases WHERE connection_id = 'connection-a'"))
        .rowCount).toBe(0);
      await expect(renewPresence('connection-a')).resolves.toBe(false);
      expect((await readPresenceSnapshot('project-b')).sequence).toBe(1);
    });
  });

  postgresIt('does not retain a join that overlaps member revocation', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-revoke-race', async ({ query, databaseUrl }) => {
      await setupPresenceDatabase(query);
      await query(`
        CREATE FUNCTION hold_presence_join() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(9911831);
          RETURN NEW;
        END $$;
        CREATE TRIGGER hold_presence_join_before_insert
          BEFORE INSERT ON wujie_presence_leases
          FOR EACH ROW EXECUTE FUNCTION hold_presence_join();
      `);
      const { Client } = await import('pg');
      const locker = new Client({ connectionString: databaseUrl });
      await locker.connect();
      await locker.query('SELECT pg_advisory_lock(9911831)');
      const lockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const { joinPresence, readPresenceSnapshot } =
        await import('../../src/lib/collaboration/presence-leases');
      const { revokePresenceMember } =
        await import('../../src/lib/collaboration/presence-members');
      let join: Promise<unknown> | undefined;
      let revoke: Promise<unknown> | undefined;
      try {
        join = joinPresence({
          connectionId: 'racing-join', userId: 'member-a', projectId: 'project-a', instanceId: 'one',
        });
        let joinBlocked = false;
        const joinDeadline = Date.now() + 2_000;
        while (Date.now() < joinDeadline) {
          const waiting = await query<{ count: number }>(
            'SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
            [lockerPid],
          );
          if (waiting.rows[0].count > 0) { joinBlocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        expect(joinBlocked).toBe(true);
        let revokeSettled = false;
        revoke = revokePresenceMember('owner-a', 'project-a', 'member-a')
          .finally(() => { revokeSettled = true; });
        const revokeDeadline = Date.now() + 2_000;
        let revokeWaiting = false;
        while (Date.now() < revokeDeadline && !revokeSettled) {
          const waiting = await query<{ count: number }>(`
            SELECT COUNT(*)::int AS count FROM pg_stat_activity
             WHERE query LIKE 'UPDATE wujie_project_presence_members%'
               AND wait_event_type = 'Lock'
          `);
          if (waiting.rows[0].count > 0) { revokeWaiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        expect(revokeSettled || revokeWaiting).toBe(true);
        await locker.query('SELECT pg_advisory_unlock(9911831)');
        await expect(Promise.all([join, revoke])).resolves.toHaveLength(2);
        expect((await readPresenceSnapshot('project-a')).participants).toEqual([]);
        const leases = await query<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM wujie_presence_leases WHERE connection_id = 'racing-join'",
        );
        expect(leases.rows[0].count).toBe(0);
      } finally {
        await locker.query('SELECT pg_advisory_unlock(9911831)').catch(() => undefined);
        await locker.end();
        await Promise.allSettled([join, revoke].filter(Boolean) as Promise<unknown>[]);
      }
    });
  }, 10_000);

  postgresIt('wakes a separate listener on project changes and reconciles when notifications are absent', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-notifications', async ({ query }) => {
      await setupPresenceDatabase(query);
      const { joinPresence, subscribePresence } =
        await import('../../src/lib/collaboration/presence-leases');
      let changes = 0;
      const unsubscribe = await subscribePresence('project-a', () => { changes += 1; }, 700);
      try {
        await joinPresence({
          connectionId: 'other-project', userId: 'owner-b', projectId: 'project-b', instanceId: 'two',
        });
        expect(changes).toBe(0);
        await joinPresence({
          connectionId: 'target-project', userId: 'member-a', projectId: 'project-a', instanceId: 'one',
        });
        const deadline = Date.now() + 500;
        while (changes === 0 && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(changes).toBeGreaterThan(0);
      } finally {
        await unsubscribe();
      }

      changes = 0;
      const unsubscribeFallback = await subscribePresence('project-a', () => { changes += 1; }, 50);
      try {
        const deadline = Date.now() + 500;
        while (changes === 0 && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(changes).toBeGreaterThan(0);
      } finally {
        await unsubscribeFallback();
      }
    });
  });

  postgresIt('delivers a committed project snapshot to a separate Node process', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-process-notify', async ({ query, databaseUrl }) => {
      await setupPresenceDatabase(query);
      const child = spawn(process.execPath, [
        '--conditions=react-server', '--import', 'tsx',
        resolve('tests/helpers/presence-listener-worker.ts'), 'project-a',
      ], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => { stderr += chunk; });
      const lineReader = createInterface({ input: child.stdout });
      const lines = lineReader[Symbol.asyncIterator]();
      const nextLine = async (): Promise<string> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const item = await Promise.race([
            lines.next(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`Worker timed out: ${stderr}`)), 8_000);
            }),
          ]);
          if (item.done) throw new Error(`Worker exited: ${stderr}`);
          return item.value;
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      try {
        expect(await nextLine()).toBe('READY');
        const { joinPresence } = await import('../../src/lib/collaboration/presence-leases');
        await joinPresence({
          connectionId: 'remote-wakeup', userId: 'member-a', projectId: 'project-a', instanceId: 'one',
        });
        const message = JSON.parse(await nextLine()) as {
          type: string;
          snapshot: { projectId: string; sequence: number; participants: Array<{ userId: string }> };
        };
        expect(message.type).toBe('snapshot');
        expect(message.snapshot.projectId).toBe('project-a');
        expect(message.snapshot.sequence).toBe(1);
        expect(message.snapshot.participants.map(person => person.userId)).toEqual(['member-a']);
      } finally {
        lineReader.close();
        if (child.exitCode === null) child.kill('SIGTERM');
        await new Promise<void>((resolveExit) => {
          if (child.exitCode !== null) resolveExit();
          else child.once('exit', () => resolveExit());
        });
      }
    });
  }, 15_000);

  postgresIt('isolates a throwing periodic subscriber so later reconciliation still runs', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-reconcile-error', async ({ query }) => {
      await setupPresenceDatabase(query);
      const { subscribePresence } =
        await import('../../src/lib/collaboration/presence-leases');
      const stopListener = await subscribePresence('project-a', () => undefined, 5_000);
      vi.useFakeTimers();
      let attempts = 0;
      const stopThrowing = await subscribePresence('project-a', () => {
        attempts += 1;
        throw new Error('subscriber failed');
      }, 50);
      let rejectedAttempts = 0;
      const stopRejecting = await subscribePresence('project-a', async () => {
        rejectedAttempts += 1;
        throw new Error('subscriber rejected');
      }, 50);
      try {
        await vi.advanceTimersByTimeAsync(100);
        expect(attempts).toBe(2);
        expect(rejectedAttempts).toBe(2);
      } finally {
        await stopRejecting();
        await stopThrowing();
        vi.useRealTimers();
        await stopListener();
      }
    });
  });

  postgresIt('reconnects its listener after a database backend is terminated', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-listener-restart', async ({ query }) => {
      await setupPresenceDatabase(query);
      const { joinPresence, subscribePresence } =
        await import('../../src/lib/collaboration/presence-leases');
      let changes = 0;
      const unsubscribe = await subscribePresence('project-a', () => { changes += 1; }, 5_000);
      try {
        const listenerPid = async (): Promise<number | undefined> => {
          const result = await query<{ pid: number }>(`
            SELECT pid FROM pg_stat_activity
             WHERE query = 'LISTEN wujie_presence_changed' AND state = 'idle'
               AND pid <> pg_backend_pid()
             ORDER BY pid DESC LIMIT 1
          `);
          return result.rows[0]?.pid;
        };
        const original = await listenerPid();
        expect(original).toBeTypeOf('number');
        await query('SELECT pg_terminate_backend($1)', [original]);

        const deadline = Date.now() + 3_000;
        let replacement: number | undefined;
        while (Date.now() < deadline) {
          replacement = await listenerPid();
          if (replacement && replacement !== original) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        expect(replacement).toBeTypeOf('number');
        expect(replacement).not.toBe(original);
        await joinPresence({
          connectionId: 'reconnected', userId: 'member-a', projectId: 'project-a', instanceId: 'one',
        });
        const notificationDeadline = Date.now() + 500;
        while (changes === 0 && Date.now() < notificationDeadline) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(changes).toBeGreaterThan(0);
      } finally {
        await unsubscribe();
      }
    });
  }, 10_000);

  postgresIt('periodically removes crashed leases and aged tickets until stopped', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-lease-maintenance', async ({ query }) => {
      await setupPresenceDatabase(query);
      const { joinPresence, readPresenceSnapshot, startPresenceMaintenance } =
        await import('../../src/lib/collaboration/presence-leases');
      const { issuePresenceTicket } =
        await import('../../src/lib/collaboration/presence-tickets');
      await joinPresence({
        connectionId: 'crashed', userId: 'member-a', projectId: 'project-a', instanceId: 'one',
      });
      await query(`UPDATE wujie_presence_leases
                      SET expires_at = clock_timestamp() - interval '1 second'
                    WHERE connection_id = 'crashed'`);
      await issuePresenceTicket('member-a', 'project-a');
      await query(`UPDATE wujie_presence_tickets
                      SET expires_at = clock_timestamp() - interval '10 minutes'`);

      const stop = startPresenceMaintenance(50);
      try {
        const deadline = Date.now() + 3_000;
        let leaseCount = 1;
        let ticketCount = 1;
        while (Date.now() < deadline) {
          leaseCount = (await query<{ count: number }>(
            'SELECT COUNT(*)::int AS count FROM wujie_presence_leases',
          )).rows[0].count;
          ticketCount = (await query<{ count: number }>(
            'SELECT COUNT(*)::int AS count FROM wujie_presence_tickets',
          )).rows[0].count;
          if (leaseCount === 0 && ticketCount === 0) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        expect([leaseCount, ticketCount]).toEqual([0, 0]);
        expect((await readPresenceSnapshot('project-a')).sequence).toBe(2);
      } finally {
        await stop();
      }
    });
  });
});
