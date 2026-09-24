import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '../../src/lib/user-types';
import type { QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

async function setup(query: QueryFn): Promise<void> {
  for (const file of [
    'migrations/20260809_wj_core_users.sql',
    'migrations/20260810_wj_stable_s2_assets.sql',
    'migrations/20260924_project_presence.sql',
    'migrations/20260924_project_presence_tickets.sql',
    'migrations/20260924_project_presence_ttl_leases.sql',
  ]) await query(await readFile(file, 'utf8'));
  await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
    VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1),
           ('member-a', 'Member A', 'test', 'active', 1, 1),
           ('owner-b', 'Owner B', 'test', 'active', 1, 1)`);
  await query(`CREATE TABLE IF NOT EXISTS wujie_user_data (
    user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB NOT NULL,
    updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
  )`);
}

function project(id = 'project-a'): Project {
  return {
    id, userId: 'owner-a', name: 'Legacy Project',
    createdAt: 1, updatedAt: 1, canvasImages: [], settings: {},
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('presence identity for legacy canvas projects', () => {
  postgresIt('presence-enabled legacy sync projects empty canvases and revokes removed projects atomically', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-legacy-sync', async ({ query }) => {
      await setup(query);
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      const { executeLegacyCanvasProjectSync } = await import('../../src/lib/asset-core/canvas-project-sync');
      const { assertPresenceMember, grantPresenceMember } = await import('../../src/lib/collaboration/presence-members');
      await executeLegacyCanvasProjectSync({ actorUserId: 'owner-a', projects: [project()], expectedRevision: 0 });
      const active = await query<{ owner_id: string; status: string }>(
        "SELECT owner_id, status FROM wujie_projects WHERE id = 'project-a'",
      );
      expect(active.rows).toEqual([{ owner_id: 'owner-a', status: 'active' }]);
      await expect(assertPresenceMember('owner-a', 'project-a')).resolves.toBeUndefined();
      await grantPresenceMember('owner-a', 'project-a', 'member-a');
      await executeLegacyCanvasProjectSync({ actorUserId: 'owner-a', projects: [], expectedRevision: 1 });
      const removed = await query<{ status: string }>("SELECT status FROM wujie_projects WHERE id = 'project-a'");
      expect(removed.rows).toEqual([{ status: 'trashed' }]);
      await expect(assertPresenceMember('owner-a', 'project-a')).rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await expect(assertPresenceMember('member-a', 'project-a')).rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
    });
  });

  postgresIt('first owner access projects an existing legacy snapshot without stealing another owner ID', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-legacy-on-demand', async ({ query }) => {
      await setup(query);
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      const { assertPresenceMember, grantPresenceMember } = await import('../../src/lib/collaboration/presence-members');
      await query(
        `INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
         VALUES ('owner-a', 'projects', $1::jsonb, 1)`,
        [JSON.stringify([project()])],
      );
      await expect(assertPresenceMember('owner-a', 'project-a')).resolves.toBeUndefined();
      await grantPresenceMember('owner-a', 'project-a', 'member-a');
      const rows = await query<{ owner_id: string }>("SELECT owner_id FROM wujie_projects WHERE id = 'project-a'");
      expect(rows.rows).toEqual([{ owner_id: 'owner-a' }]);

      await query(`INSERT INTO wujie_projects (id, owner_id, name) VALUES ('collision', 'owner-b', 'B')`);
      await query(`UPDATE wujie_user_data SET data_value = $1::jsonb
        WHERE user_id = 'owner-a' AND data_key = 'projects'`, [JSON.stringify([project('collision')])]);
      await expect(assertPresenceMember('owner-a', 'collision'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      const collision = await query<{ owner_id: string }>("SELECT owner_id FROM wujie_projects WHERE id = 'collision'");
      expect(collision.rows).toEqual([{ owner_id: 'owner-b' }]);
    });
  });

  postgresIt('historical owner project without userId can join while a foreign-tagged snapshot cannot', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-legacy-missing-user-id', async ({ query }) => {
      await setup(query);
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'legacy');
      const { assertPresenceMember } = await import('../../src/lib/collaboration/presence-members');
      const historical = { id: 'project-a', name: 'Historical', canvasImages: [], settings: {} };
      await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([historical])]);
      await expect(assertPresenceMember('owner-a', 'project-a')).resolves.toBeUndefined();
      expect((await query<{ owner_id: string }>("SELECT owner_id FROM wujie_projects WHERE id = 'project-a'")).rows)
        .toEqual([{ owner_id: 'owner-a' }]);

      // Project GET also accepts a historical JSON string stored inside jsonb.
      await query(`UPDATE wujie_user_data SET data_value = $1::jsonb
        WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      [JSON.stringify(JSON.stringify([historical]))]);
      await expect(assertPresenceMember('owner-a', 'project-a')).resolves.toBeUndefined();

      await query(`UPDATE wujie_user_data SET data_value = $1::jsonb
        WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      [JSON.stringify([{ ...historical, userId: 'owner-b' }])]);
      await expect(assertPresenceMember('owner-a', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });

      await query(`UPDATE wujie_user_data SET data_value = $1::jsonb
        WHERE user_id = 'owner-a' AND data_key = 'projects'`, [JSON.stringify('not json')]);
      await expect(assertPresenceMember('owner-a', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
    });
  });

  postgresIt('legacy presence projection does not block later asset-graph migration', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-legacy-to-graph', async ({ query }) => {
      await setup(query);
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      const { executeLegacyCanvasProjectSync } = await import('../../src/lib/asset-core/canvas-project-sync');
      const { migrateLegacyProjectOnWriteInTransaction } = await import('../../src/lib/asset-core/legacy-migration');
      const { getPool } = await import('../../src/lib/db-client');
      await executeLegacyCanvasProjectSync({ actorUserId: 'owner-a', projects: [project()], expectedRevision: 0 });

      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await migrateLegacyProjectOnWriteInTransaction(client, {
          actorUserId: 'owner-a', projectId: 'project-a',
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      const migrated = await query<{ schema_version: number; metadata: { legacySourceSchemaVersion?: number } }>(
        "SELECT schema_version, metadata FROM wujie_projects WHERE id = 'project-a'",
      );
      expect(migrated.rows[0]?.metadata.legacySourceSchemaVersion).toBeTypeOf('number');
    });
  });

  postgresIt('restored legacy snapshot can migrate a previously trashed presence projection', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-legacy-restored', async ({ query }) => {
      await setup(query);
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      const { executeLegacyCanvasProjectSync } = await import('../../src/lib/asset-core/canvas-project-sync');
      const { migrateLegacyProjectOnWriteInTransaction } = await import('../../src/lib/asset-core/legacy-migration');
      const { getPool } = await import('../../src/lib/db-client');
      await executeLegacyCanvasProjectSync({ actorUserId: 'owner-a', projects: [project()], expectedRevision: 0 });
      await executeLegacyCanvasProjectSync({ actorUserId: 'owner-a', projects: [], expectedRevision: 1 });
      await query(
        `UPDATE wujie_user_data SET data_value = $1::jsonb
          WHERE user_id = 'owner-a' AND data_key = 'projects'`,
        [JSON.stringify([project()])],
      );
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await migrateLegacyProjectOnWriteInTransaction(client, {
          actorUserId: 'owner-a', projectId: 'project-a',
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      const row = await query<{ status: string; metadata: { presenceProjection?: boolean } }>(
        "SELECT status, metadata FROM wujie_projects WHERE id = 'project-a'",
      );
      expect(row.rows).toEqual([{ status: 'active', metadata: expect.not.objectContaining({ presenceProjection: true }) }]);
    });
  });

  postgresIt('legacy presence sync never renames, revives, or trashes graph-owned project rows', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-graph-untouched', async ({ query }) => {
      await setup(query);
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      const { executeLegacyCanvasProjectSync } = await import('../../src/lib/asset-core/canvas-project-sync');
      await query(`INSERT INTO wujie_projects (id, owner_id, name, status, metadata)
        VALUES ('project-a', 'owner-a', 'Graph A', 'trashed', '{}'::jsonb),
               ('graph-unrelated', 'owner-a', 'Graph B', 'active', '{}'::jsonb)`);
      await executeLegacyCanvasProjectSync({ actorUserId: 'owner-a', projects: [project()], expectedRevision: 0 });
      await executeLegacyCanvasProjectSync({ actorUserId: 'owner-a', projects: [], expectedRevision: 1 });
      const rows = await query<{ id: string; name: string; status: string }>(
        "SELECT id, name, status FROM wujie_projects WHERE owner_id = 'owner-a' ORDER BY id",
      );
      expect(rows.rows).toEqual([
        { id: 'graph-unrelated', name: 'Graph B', status: 'active' },
        { id: 'project-a', name: 'Graph A', status: 'trashed' },
      ]);
    });
  });

  postgresIt('deleting a legacy snapshot project denies presence even when its migrated graph row stays active', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-legacy-deleted-graph', async ({ query }) => {
      await setup(query);
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'legacy');
      const { executeLegacyCanvasProjectSync } = await import('../../src/lib/asset-core/canvas-project-sync');
      const { assertPresenceMember, grantPresenceMember } = await import('../../src/lib/collaboration/presence-members');
      const { joinPresence, readPresenceSnapshot, renewPresence } =
        await import('../../src/lib/collaboration/presence-leases');
      await query(`INSERT INTO wujie_projects (id, owner_id, name, status, metadata)
        VALUES ('project-a', 'owner-a', 'Migrated A', 'active', '{}'::jsonb)`);
      await executeLegacyCanvasProjectSync({ actorUserId: 'owner-a', projects: [project()], expectedRevision: 0 });
      await grantPresenceMember('owner-a', 'project-a', 'member-a');
      await expect(assertPresenceMember('member-a', 'project-a')).resolves.toBeUndefined();
      await joinPresence({ connectionId: 'member-a-connection', userId: 'member-a',
        projectId: 'project-a', instanceId: 'test-instance' });

      await executeLegacyCanvasProjectSync({ actorUserId: 'owner-a', projects: [], expectedRevision: 1 });
      expect((await query<{ status: string }>("SELECT status FROM wujie_projects WHERE id = 'project-a'")).rows)
        .toEqual([{ status: 'active' }]);
      await expect(assertPresenceMember('owner-a', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await expect(assertPresenceMember('member-a', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await expect(grantPresenceMember('owner-a', 'project-a', 'member-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await expect(joinPresence({ connectionId: 'late-connection', userId: 'member-a',
        projectId: 'project-a', instanceId: 'test-instance' }))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      expect((await readPresenceSnapshot('project-a')).participants).toEqual([]);
      await expect(renewPresence('member-a-connection')).resolves.toBe(false);

      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'shadow');
      await expect(assertPresenceMember('owner-a', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await expect(assertPresenceMember('member-a', 'project-a'))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      await expect(joinPresence({ connectionId: 'shadow-late-connection', userId: 'member-a',
        projectId: 'project-a', instanceId: 'test-instance' }))
        .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
      expect((await readPresenceSnapshot('project-a')).participants).toEqual([]);
    });
  });

  postgresIt('presence flag off leaves legacy project writes unchanged', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-legacy-disabled', async ({ query }) => {
      await setup(query);
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'false');
      const { executeLegacyCanvasProjectSync } = await import('../../src/lib/asset-core/canvas-project-sync');
      await executeLegacyCanvasProjectSync({ actorUserId: 'owner-a', projects: [project()], expectedRevision: 0 });
      const rows = await query("SELECT id FROM wujie_projects WHERE id = 'project-a'");
      expect(rows.rows).toEqual([]);
    });
  });
});
