import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

async function setupPresenceDatabase(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): Promise<void> {
  await query(await readFile('migrations/20260809_wj_core_users.sql', 'utf8'));
  await query(await readFile('migrations/20260810_wj_stable_s2_assets.sql', 'utf8'));
  await query(await readFile('migrations/20260924_project_presence.sql', 'utf8'));
  await query(await readFile('migrations/20260924_project_presence.sql', 'utf8'));
  await query(`
    INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
    VALUES
      ('owner-a', 'Owner A', 'test', 'active', 1, 1),
      ('owner-b', 'Owner B', 'test', 'active', 1, 1),
      ('member-a', 'Member A', 'test', 'active', 1, 1),
      ('outsider', 'Outsider', 'test', 'active', 1, 1)
  `);
  await query(`
    INSERT INTO wujie_projects (id, owner_id, name)
    VALUES ('project-a', 'owner-a', 'A'), ('project-b', 'owner-b', 'B')
  `);
}

describe('presence membership on isolated PostgreSQL', () => {
  postgresIt('grants presence only in an active project, and revocation takes effect immediately', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-member-permissions', async ({ query }) => {
      await setupPresenceDatabase(query);
      const { assertPresenceMember, grantPresenceMember, listPresenceMembers, revokePresenceMember } =
        await import('../../src/lib/collaboration/presence-members');

      await expect(assertPresenceMember('owner-a', 'project-a')).resolves.toBeUndefined();
      await expect(assertPresenceMember('outsider', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await expect(grantPresenceMember('owner-b', 'project-a', 'member-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });

      await grantPresenceMember('owner-a', 'project-a', 'member-a');
      const firstInvite = await query(`
        SELECT updated_at FROM wujie_project_presence_members
         WHERE project_id = 'project-a' AND member_user_id = 'member-a'
      `) as { rows: Array<{ updated_at: Date }> };
      await query('SELECT pg_sleep(0.02)');
      await grantPresenceMember('owner-a', 'project-a', 'member-a');
      const secondInvite = await query(`
        SELECT updated_at FROM wujie_project_presence_members
         WHERE project_id = 'project-a' AND member_user_id = 'member-a'
      `) as { rows: Array<{ updated_at: Date }> };
      expect(secondInvite.rows[0]?.updated_at).toEqual(firstInvite.rows[0]?.updated_at);
      const activeRows = await query(`
        SELECT COUNT(*)::int AS count
          FROM wujie_project_presence_members
         WHERE project_id = 'project-a' AND member_user_id = 'member-a'
      `) as { rows: Array<{ count: number }> };
      expect(activeRows.rows[0]?.count).toBe(1);
      await expect(assertPresenceMember('member-a', 'project-a')).resolves.toBeUndefined();
      await expect(listPresenceMembers('owner-a', 'project-a'))
        .resolves.toEqual([{ userId: 'member-a', name: 'Member A' }]);
      await expect(listPresenceMembers('owner-b', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await expect(assertPresenceMember('member-a', 'project-b'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });

      await query("UPDATE wujie_users SET status = 'disabled' WHERE id = 'member-a'");
      await expect(assertPresenceMember('member-a', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await query("UPDATE wujie_users SET status = 'active' WHERE id = 'member-a'");

      await revokePresenceMember('owner-a', 'project-a', 'member-a');
      await revokePresenceMember('owner-a', 'project-a', 'member-a');
      const revokedRows = await query(`
        SELECT status, revoked_at IS NOT NULL AS has_revoked_at
          FROM wujie_project_presence_members
         WHERE project_id = 'project-a' AND member_user_id = 'member-a'
      `) as { rows: Array<{ status: string; has_revoked_at: boolean }> };
      expect(revokedRows.rows).toEqual([{ status: 'revoked', has_revoked_at: true }]);
      await expect(listPresenceMembers('owner-a', 'project-a')).resolves.toEqual([]);
      await expect(assertPresenceMember('member-a', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });

      await grantPresenceMember('owner-a', 'project-a', 'member-a');
      const restoredRows = await query(`
        SELECT status, revoked_at
          FROM wujie_project_presence_members
         WHERE project_id = 'project-a' AND member_user_id = 'member-a'
      `) as { rows: Array<{ status: string; revoked_at: Date | null }> };
      expect(restoredRows.rows).toEqual([{ status: 'active', revoked_at: null }]);
      await expect(assertPresenceMember('member-a', 'project-a')).resolves.toBeUndefined();

      await query("UPDATE wujie_users SET status = 'disabled' WHERE id = 'owner-a'");
      await expect(assertPresenceMember('member-a', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await query("UPDATE wujie_users SET status = 'active' WHERE id = 'owner-a'");

      await query("UPDATE wujie_projects SET status = 'trashed' WHERE id = 'project-a'");
      await expect(assertPresenceMember('owner-a', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });

      await query("UPDATE wujie_projects SET status = 'active' WHERE id = 'project-a'");
      await query("DELETE FROM wujie_users WHERE id = 'member-a'");
      const afterUserDelete = await query(`
        SELECT COUNT(*)::int AS count FROM wujie_project_presence_members
         WHERE member_user_id = 'member-a'
      `) as { rows: Array<{ count: number }> };
      expect(afterUserDelete.rows[0]?.count).toBe(0);

      await grantPresenceMember('owner-a', 'project-a', 'outsider');
      await query("DELETE FROM wujie_projects WHERE id = 'project-a'");
      const afterProjectDelete = await query(`
        SELECT COUNT(*)::int AS count FROM wujie_project_presence_members
         WHERE project_id = 'project-a'
      `) as { rows: Array<{ count: number }> };
      expect(afterProjectDelete.rows[0]?.count).toBe(0);
    });
  });
});
