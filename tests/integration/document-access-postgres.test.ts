import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import type { QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

async function setupDocumentDatabase(query: QueryFn): Promise<void> {
  await query(await readFile('migrations/20260809_wj_core_users.sql', 'utf8'));
  await query(await readFile('migrations/20260810_wj_stable_s2_assets.sql', 'utf8'));
  await query(await readFile('migrations/20260924_project_presence.sql', 'utf8'));
  const migration = await readFile('migrations/20260925_yjs_canvas_editors.sql', 'utf8');
  await query(migration);
  await query(migration);
  await query(`
    INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
    VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1),
           ('owner-b', 'Owner B', 'test', 'active', 1, 1),
           ('presence-only', 'Member', 'test', 'active', 1, 1),
           ('editor-a', 'Editor', 'test', 'active', 1, 1),
           ('editor-same-name', 'Editor', 'test', 'active', 1, 1)
  `);
  await query(`
    INSERT INTO wujie_projects (id, owner_id, name)
    VALUES ('project-a', 'owner-a', 'A'), ('project-b', 'owner-b', 'B')
  `);
  await query(`
    INSERT INTO wujie_project_presence_members (project_id, owner_id, member_user_id)
    VALUES ('project-a', 'owner-a', 'presence-only')
  `);
}

describe('independent canvas document editor access on PostgreSQL', () => {
  postgresIt('holds editor authorization through the outbound read callback before revocation commits', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-editor-outbound-fence', async ({ query }) => {
      await setupDocumentDatabase(query);
      const { grantDocumentEditor, revokeDocumentEditor, withDocumentEditorRead } =
        await import('../../src/lib/collaboration/document-access');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      let enterRead: (() => void) | undefined;
      let finishRead: (() => void) | undefined;
      const entered = new Promise<void>(resolve => { enterRead = resolve; });
      const release = new Promise<void>(resolve => { finishRead = resolve; });
      const outbound = withDocumentEditorRead('editor-a', 'project-a', '1', async client => {
        enterRead?.();
        await release;
        await client.query('SELECT 1');
        return 'delivered';
      });
      await entered;
      const revocation = revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
      const revokedEarly = await Promise.race([
        revocation.then(() => true),
        new Promise<false>(resolve => setTimeout(() => resolve(false), 50)),
      ]);
      expect(revokedEarly).toBe(false);
      finishRead?.();
      await expect(outbound).resolves.toBe('delivered');
      await revocation;
      await expect(withDocumentEditorRead('editor-a', 'project-a', '1', async () => 'late'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    });
  });

  postgresIt('starts disabled and does not copy presence members into document editors', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-editors-schema', async ({ query }) => {
      await setupDocumentDatabase(query);

      const editors = await query<{ count: number }>(`
        SELECT COUNT(*)::int AS count FROM wujie_project_document_editors
         WHERE project_id = 'project-a'
      `);
      const settings = await query<{ count: number }>(`
        SELECT COUNT(*)::int AS count FROM wujie_project_document_settings
         WHERE project_id = 'project-a' AND enabled = true
      `);
      expect(editors.rows[0]?.count).toBe(0);
      expect(settings.rows[0]?.count).toBe(0);
    });
  });

  postgresIt('allows only the owner and explicitly granted active editor in one active project', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-editor-permissions', async ({ query }) => {
      await setupDocumentDatabase(query);
      const { assertDocumentEditor, grantDocumentEditor, revokeDocumentEditor } =
        await import('../../src/lib/collaboration/document-access');

      await expect(assertDocumentEditor('owner-a', 'project-a'))
        .resolves.toMatchObject({ ownerId: 'owner-a' });
      await expect(assertDocumentEditor('presence-only', 'project-a'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      await expect(grantDocumentEditor('owner-b', 'project-a', 'editor-a'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });

      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      await expect(assertDocumentEditor('editor-a', 'project-a'))
        .resolves.toMatchObject({ ownerId: 'owner-a' });
      await expect(assertDocumentEditor('editor-same-name', 'project-a'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      await expect(assertDocumentEditor('editor-a', 'project-b'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });

      await query("UPDATE wujie_users SET status = 'disabled' WHERE id = 'editor-a'");
      await expect(assertDocumentEditor('editor-a', 'project-a'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      await query("UPDATE wujie_users SET status = 'active' WHERE id = 'editor-a'");
      await query("UPDATE wujie_projects SET status = 'trashed' WHERE id = 'project-a'");
      await expect(assertDocumentEditor('editor-a', 'project-a'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      await query("UPDATE wujie_projects SET status = 'active' WHERE id = 'project-a'");

      await revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
      await expect(assertDocumentEditor('editor-a', 'project-a'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      const revoked = await query<{ status: string; generation: string }>(`
        SELECT status, grant_generation::text AS generation
          FROM wujie_project_document_editors
         WHERE project_id = 'project-a' AND member_user_id = 'editor-a'
      `);
      expect(revoked.rows).toEqual([{ status: 'revoked', generation: '2' }]);
    });
  });

  postgresIt('preserves duplicate grants but changes the generation on revoke and regrant', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-editor-generation', async ({ query }) => {
      await setupDocumentDatabase(query);
      const { assertDocumentEditor, grantDocumentEditor, revokeDocumentEditor } =
        await import('../../src/lib/collaboration/document-access');
      const generation = async (): Promise<string | undefined> => {
        const result = await query<{ generation: string }>(`
          SELECT grant_generation::text AS generation
            FROM wujie_project_document_editors
           WHERE project_id = 'project-a' AND member_user_id = 'editor-a'
        `);
        return result.rows[0]?.generation;
      };

      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      expect(await generation()).toBe('1');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      expect(await generation()).toBe('1');
      await revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
      expect(await generation()).toBe('2');
      await revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
      expect(await generation()).toBe('2');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      expect(await generation()).toBe('3');
      await expect(assertDocumentEditor('editor-a', 'project-a'))
        .resolves.toMatchObject({ ownerId: 'owner-a' });

      await query("UPDATE wujie_users SET status = 'disabled' WHERE id = 'owner-a'");
      await expect(assertDocumentEditor('editor-a', 'project-a'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      await expect(grantDocumentEditor('owner-a', 'project-a', 'editor-same-name'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    });
  });

  postgresIt('lists only active explicit editors for the exact owner and project', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-editor-list', async ({ query }) => {
      await setupDocumentDatabase(query);
      const { grantDocumentEditor, listDocumentEditors, revokeDocumentEditor } =
        await import('../../src/lib/collaboration/document-access');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-same-name');
      expect(await listDocumentEditors('owner-a', 'project-a')).toEqual([
        { userId: 'editor-a', name: 'Editor' },
        { userId: 'editor-same-name', name: 'Editor' },
      ]);
      await revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
      expect(await listDocumentEditors('owner-a', 'project-a')).toEqual([
        { userId: 'editor-same-name', name: 'Editor' },
      ]);
      await expect(listDocumentEditors('owner-b', 'project-a'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    });
  });

  postgresIt('does not combine a formerly active user with a newly active editor grant', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-editor-consistent-read', async ({ query }) => {
      await setupDocumentDatabase(query);
      const { getPool } = await import('../../src/lib/db-client');
      const { assertDocumentEditor, grantDocumentEditor, revokeDocumentEditor } =
        await import('../../src/lib/collaboration/document-access');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      await revokeDocumentEditor('owner-a', 'project-a', 'editor-a');

      const pool = getPool();
      const originalQuery = pool.query.bind(pool) as QueryFn;
      let switched = false;
      const querySpy = vi.spyOn(pool, 'query').mockImplementation((async (
        text: string,
        values?: unknown[],
      ) => {
        const result = await originalQuery(text, values);
        if (!switched && text.includes('JOIN wujie_users actor')) {
          switched = true;
          await query('BEGIN');
          try {
            await query(`UPDATE wujie_project_document_editors
              SET status = 'active' WHERE project_id = 'project-a'
                AND member_user_id = 'editor-a'`);
            await query("UPDATE wujie_users SET status = 'disabled' WHERE id = 'editor-a'");
            await query('COMMIT');
          } catch (error) {
            await query('ROLLBACK');
            throw error;
          }
        }
        return result;
      }) as typeof pool.query);
      try {
        await expect(assertDocumentEditor('editor-a', 'project-a'))
          .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
        expect(switched).toBe(true);
      } finally {
        querySpy.mockRestore();
      }
    });
  });
});
