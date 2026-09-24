import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

interface TicketRow {
  token_hash: string;
  user_id: string;
  project_id: string;
  lifetime_seconds: number;
  consumed_at: Date | null;
}

async function withTicketDatabase(
  name: string,
  callback: (
    query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>,
    databaseUrl: string,
  ) => Promise<void>,
): Promise<void> {
  const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
  await withIsolatedPostgres(name, async ({ query, databaseUrl }) => {
    for (const path of [
      'migrations/20260809_wj_core_users.sql',
      'migrations/20260810_wj_stable_s2_assets.sql',
      'migrations/20260924_project_presence.sql',
      'migrations/20260924_project_presence_tickets.sql',
    ]) {
      await query(await readFile(path, 'utf8'));
    }
    await query(`
      INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
      VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1),
             ('owner-b', 'Owner B', 'test', 'active', 1, 1),
             ('member-a', 'Member A', 'test', 'active', 1, 1),
             ('outsider', 'Outsider', 'test', 'active', 1, 1)
    `);
    await query(`
      INSERT INTO wujie_projects (id, owner_id, name)
      VALUES ('project-a', 'owner-a', 'A'), ('project-b', 'owner-b', 'B')
    `);
    await query(`
      INSERT INTO wujie_project_presence_members (project_id, owner_id, member_user_id)
      VALUES ('project-a', 'owner-a', 'member-a')
    `);
    await callback(query, databaseUrl);
  });
}

describe('one-use presence tickets on isolated PostgreSQL', () => {
  postgresIt('stores only a hash of a 30-second ticket bound to the member and project', async () => {
    await withTicketDatabase('presence-ticket-issuance', async (query) => {
      const { issuePresenceTicket, consumePresenceTicket } =
        await import('../../src/lib/collaboration/presence-tickets');
      const first = await issuePresenceTicket('member-a', 'project-a');
      const second = await issuePresenceTicket('member-a', 'project-a');
      expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(second).not.toBe(first);

      const result = await query(`
        SELECT token_hash, user_id, project_id,
               EXTRACT(EPOCH FROM expires_at - created_at)::float8 AS lifetime_seconds,
               consumed_at
          FROM wujie_presence_tickets
         WHERE token_hash = $1
      `, [createHash('sha256').update(first).digest('hex')]);
      expect(result.rows).toEqual([{
        token_hash: createHash('sha256').update(first).digest('hex'),
        user_id: 'member-a',
        project_id: 'project-a',
        lifetime_seconds: 30,
        consumed_at: null,
      } satisfies TicketRow]);
      expect(JSON.stringify(result.rows)).not.toContain(first);
      await expect(consumePresenceTicket(first))
        .resolves.toEqual({ userId: 'member-a', projectId: 'project-a' });
      const consumed = await query(
        'SELECT consumed_at < expires_at AS consumed_before_expiry FROM wujie_presence_tickets WHERE token_hash = $1',
        [createHash('sha256').update(first).digest('hex')],
      );
      expect(consumed.rows[0]).toEqual({ consumed_before_expiry: true });
      await expect(consumePresenceTicket(first)).resolves.toBeNull();
    });
  });

  postgresIt('allows exactly one winner under concurrent ticket consumption', async () => {
    await withTicketDatabase('presence-ticket-concurrent', async () => {
      const { issuePresenceTicket, consumePresenceTicket } =
        await import('../../src/lib/collaboration/presence-tickets');
      const raw = await issuePresenceTicket('owner-a', 'project-a');
      const results = await Promise.all(Array.from({ length: 20 }, () => consumePresenceTicket(raw)));
      expect(results.filter(Boolean)).toEqual([{ userId: 'owner-a', projectId: 'project-a' }]);
    });
  });

  postgresIt('does not consume a ticket after its expiry while waiting on a row lock', async () => {
    await withTicketDatabase('presence-ticket-lock-expiry', async (query, databaseUrl) => {
      const { Client } = await import('pg');
      const { issuePresenceTicket, consumePresenceTicket } =
        await import('../../src/lib/collaboration/presence-tickets');
      const raw = await issuePresenceTicket('owner-a', 'project-a');
      const hash = createHash('sha256').update(raw).digest('hex');
      await query(`UPDATE wujie_presence_tickets
                      SET expires_at = clock_timestamp() + interval '3 seconds'
                    WHERE token_hash = $1`, [hash]);

      const locker = new Client({ connectionString: databaseUrl });
      await locker.connect();
      let consumption: Promise<unknown> | undefined;
      try {
        await locker.query('BEGIN');
        const holder = await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        await locker.query('SELECT token_hash FROM wujie_presence_tickets WHERE token_hash = $1 FOR UPDATE', [hash]);
        consumption = consumePresenceTicket(raw);

        const deadline = Date.now() + 2_000;
        let blocked = false;
        while (Date.now() < deadline) {
          const result = await query(
            'SELECT COUNT(*)::int AS waiting FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
            [holder.rows[0].pid],
          );
          if ((result.rows[0] as { waiting: number }).waiting > 0) {
            blocked = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        expect(blocked).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 3_200));
        const expiry = await query(
          'SELECT expires_at < clock_timestamp() AS expired FROM wujie_presence_tickets WHERE token_hash = $1',
          [hash],
        );
        expect(expiry.rows[0]).toEqual({ expired: true });
        await locker.query('COMMIT');
        await expect(consumption).resolves.toBeNull();
      } finally {
        await locker.query('ROLLBACK');
        await locker.end();
        await consumption?.catch(() => undefined);
      }
    });
  }, 15_000);

  postgresIt('rejects absent, expired, revoked and disabled identities without revealing a project', async () => {
    await withTicketDatabase('presence-ticket-invalid', async (query) => {
      const { issuePresenceTicket, consumePresenceTicket } =
        await import('../../src/lib/collaboration/presence-tickets');
      await expect(issuePresenceTicket('outsider', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await expect(consumePresenceTicket('not-a-ticket')).resolves.toBeNull();

      const expired = await issuePresenceTicket('member-a', 'project-a');
      await query(`UPDATE wujie_presence_tickets SET expires_at = now() - interval '1 second'
                    WHERE token_hash = $1`, [createHash('sha256').update(expired).digest('hex')]);
      await expect(consumePresenceTicket(expired)).resolves.toBeNull();

      const revoked = await issuePresenceTicket('member-a', 'project-a');
      await query("UPDATE wujie_project_presence_members SET status = 'revoked' WHERE member_user_id = 'member-a'");
      await expect(consumePresenceTicket(revoked)).resolves.toBeNull();

      await query("UPDATE wujie_project_presence_members SET status = 'active' WHERE member_user_id = 'member-a'");
      const disabled = await issuePresenceTicket('member-a', 'project-a');
      await query("UPDATE wujie_users SET status = 'disabled' WHERE id = 'member-a'");
      await expect(consumePresenceTicket(disabled)).resolves.toBeNull();
    });
  });

  postgresIt('prunes expired ticket rows in bounded batches without touching live tickets', async () => {
    await withTicketDatabase('presence-ticket-retention', async (query) => {
      const { issuePresenceTicket, pruneExpiredPresenceTickets } =
        await import('../../src/lib/collaboration/presence-tickets');
      const oldA = await issuePresenceTicket('owner-a', 'project-a');
      const oldB = await issuePresenceTicket('owner-a', 'project-a');
      const live = await issuePresenceTicket('owner-a', 'project-a');
      for (const raw of [oldA, oldB]) {
        await query(`UPDATE wujie_presence_tickets
                        SET expires_at = clock_timestamp() - interval '10 minutes'
                      WHERE token_hash = $1`, [createHash('sha256').update(raw).digest('hex')]);
      }
      await expect(pruneExpiredPresenceTickets(1)).resolves.toBe(1);
      await expect(pruneExpiredPresenceTickets(1)).resolves.toBe(1);
      await expect(pruneExpiredPresenceTickets(1)).resolves.toBe(0);
      const remaining = await query('SELECT token_hash FROM wujie_presence_tickets');
      expect(remaining.rows).toEqual([{
        token_hash: createHash('sha256').update(live).digest('hex'),
      }]);
    });
  });
});
