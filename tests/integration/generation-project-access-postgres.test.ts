import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { getPool } from '../../src/lib/db-client';
import { authorizeGenerationProject as authorize } from '../../src/lib/collaboration/generation-project-access';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function seed(query: QueryFn): Promise<void> {
  // Full SQL files, including the legacy authority trigger; no hand-made substitute tables.
  for (const migration of [
    '20260809_wj_core_users.sql', '20260810_wj_stable_s2_assets.sql',
    '20260924_project_presence.sql', '20260925_yjs_canvas_editors.sql',
    '20260925_yjs_canvas_documents.sql', '20260926_yjs_canvas_authority_fence.sql',
  ]) await query(await readFile(`migrations/${migration}`, 'utf8'));
  await query(`INSERT INTO wujie_users (id, name, password_hash, status, role, created_at, updated_at)
    VALUES ('actor','Actor','test','active','user',1,1), ('owner','Owner','test','active','user',1,1),
      ('other','Other','test','active','admin',1,1), ('presence','Presence','test','active','user',1,1)`);
  await query(`INSERT INTO wujie_projects (id, owner_id, name, status) VALUES
    ('personal','actor','Personal','active'), ('foreign-project','owner','Foreign','active'),
    ('shared','owner','Shared','active'), ('trashed','actor','Trashed','trashed'),
    ('disabled','owner','Disabled','active'), ('missing-doc','owner','Missing','active'),
    ('missing-setting','owner','Missing setting','active'), ('disabled-doc','owner','Disabled doc','active')`);
  await query(`INSERT INTO wujie_project_presence_members (project_id, owner_id, member_user_id)
    VALUES ('shared','owner','presence')`);
  await query(`INSERT INTO wujie_project_document_editors (project_id, owner_id, member_user_id)
    SELECT id, owner_id, 'actor' FROM wujie_projects WHERE owner_id = 'owner'`);
  await query(`INSERT INTO wujie_project_document_settings (project_id, owner_id, enabled)
    VALUES ('shared','owner',true), ('disabled','owner',false), ('missing-doc','owner',true),
      ('disabled-doc','owner',false)`);
  await query(`INSERT INTO wujie_project_canvas_documents (project_id, owner_id)
    VALUES ('shared','owner'), ('missing-setting','owner'), ('disabled-doc','owner')`);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}

async function snapshot(query: QueryFn): Promise<unknown> {
  const tables = await query<{ name: string }>(`SELECT tablename AS name FROM pg_tables
    WHERE schemaname = current_schema() ORDER BY tablename`);
  const contents: Record<string, unknown> = {};
  for (const { name } of tables.rows) {
    contents[name] = (await query(`SELECT to_jsonb(t) AS row FROM "${name.replaceAll('"', '""')}" t
      ORDER BY to_jsonb(t)::text`)).rows;
  }
  return contents;
}

const forbidden = { code: 'GENERATION_PROJECT_FORBIDDEN', status: 403, message: '无权在此项目中生成图片' };
const unavailable = { code: 'GENERATION_PROJECT_UNAVAILABLE', status: 503, message: '项目权限服务暂不可用，请稍后重试' };

describe('generation admission against real PostgreSQL', () => {
  it('does not open PG for unscoped or invalid IDs, even with PG unconfigured', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('PGDATABASE_URL', '');
    for (const projectId of [undefined, null, '']) {
      await expect(authorize({ actorUserId: 'actor', projectId })).resolves.toEqual({ kind: 'unscoped', actorUserId: 'actor' });
    }
    for (const projectId of [1, false, {}, [], ['personal'], ' ', ' personal', 'personal ', 'a\nb', 'a\u0000b', 'a\u007fb', 'a\u0085b', 'x'.repeat(257)]) {
      await expect(authorize({ actorUserId: 'actor', projectId })).rejects.toMatchObject({
        code: 'GENERATION_PROJECT_INVALID', status: 400, message: '项目参数无效',
      });
    }
    await expect(authorize({ actorUserId: 'actor', projectId: 'personal' })).rejects.toMatchObject(unavailable);
  });

  it('returns exact actor/owner/generation and leaves every migrated table unchanged', async () => {
    await withIsolatedPostgres('generation-identity', async ({ query }) => {
      await seed(query);
      await query(`INSERT INTO wujie_projects (id, owner_id, name) VALUES ($1,'actor','Boundary'), ('x','actor','One')`, ['x'.repeat(256)]);
      const before = await snapshot(query);
      for (const projectId of ['personal', 'x', 'x'.repeat(256)]) {
        await expect(authorize({ actorUserId: 'actor', projectId })).resolves.toEqual({ kind: 'personal', actorUserId: 'actor', ownerId: 'actor', projectId });
      }
      await expect(authorize({ actorUserId: 'actor', projectId: 'shared' })).resolves.toEqual({
        kind: 'document', actorUserId: 'actor', ownerId: 'owner', projectId: 'shared', grantGeneration: '1',
      });
      await expect(authorize({ actorUserId: 'owner', projectId: 'shared' })).resolves.toEqual({
        kind: 'document', actorUserId: 'owner', ownerId: 'owner', projectId: 'shared', grantGeneration: '0',
      });
      for (const [actorUserId, projectId] of [
        ['actor','foreign-project'], ['actor','unknown'], ['actor','trashed'],
        ['presence','shared'], ['other','shared'], ['missing-user','personal'],
        ['actor','disabled'], ['owner','missing-doc'], ['actor','missing-doc'],
        ['owner','missing-setting'], ['owner','disabled-doc'], ['actor','disabled-doc'],
      ]) await expect(authorize({ actorUserId, projectId })).rejects.toMatchObject(forbidden);
      await expect(authorize({ actorUserId: 'owner', projectId: 'disabled' })).resolves.toEqual({
        kind: 'personal', actorUserId: 'owner', ownerId: 'owner', projectId: 'disabled',
      });
      vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
      for (const actorUserId of ['owner', 'actor']) await expect(authorize({ actorUserId, projectId: 'shared' })).rejects.toMatchObject(forbidden);
      await expect(authorize({ actorUserId: 'actor', projectId: 'personal' })).resolves.toMatchObject({ kind: 'personal' });
      expect(await snapshot(query)).toEqual(before);
    });
  });

  it('reads only unique own legacy projects in arrays or JSON strings without projecting them', async () => {
    await withIsolatedPostgres('generation-legacy', async ({ query }) => {
      await seed(query);
      for (const [value, allowed] of [
        [[{ id: 'legacy', userId: 'actor' }], true],
        [JSON.stringify([{ id: 'legacy', userId: 'actor' }]), true],
        [[{ id: 'legacy', userId: 'actor' }, { id: 'legacy', userId: 'actor' }], false],
        [[{ id: 'legacy', userId: 'actor' }, { id: 'legacy', userId: 'other' }], false],
        [[{ id: 'legacy', userId: 'other' }], false], [[{ id: 'legacy' }], false],
        [{ id: 'legacy', userId: 'actor' }, false], ['not json', false], [null, false],
        [[{ id: 'legacy', userId: 'actor', status: 'trashed' }], false],
      ] as const) {
        await query(`INSERT INTO wujie_user_data (user_id,data_key,data_value,updated_at)
          VALUES ('actor','projects',$1::jsonb,1) ON CONFLICT (user_id,data_key)
          DO UPDATE SET data_value = EXCLUDED.data_value`, [JSON.stringify(value)]);
        const before = await snapshot(query);
        const access = authorize({ actorUserId: 'actor', projectId: 'legacy' });
        if (allowed) await expect(access).resolves.toEqual({ kind: 'personal', actorUserId: 'actor', ownerId: 'actor', projectId: 'legacy' });
        else await expect(access).rejects.toMatchObject(forbidden);
        expect(await snapshot(query)).toEqual(before);
      }
      await query(`UPDATE wujie_user_data SET data_value = $1::jsonb WHERE user_id = 'actor'`,
        [JSON.stringify(['foreign-project', 'trashed', 'missing-setting'].map(id => ({ id, userId: 'actor' })))]);
      for (const projectId of ['foreign-project', 'trashed', 'missing-setting']) {
        await expect(authorize({ actorUserId: 'actor', projectId })).rejects.toMatchObject(forbidden);
      }
      await query(`INSERT INTO wujie_user_data (user_id,data_key,data_value,updated_at)
        VALUES ('other','projects','[{"id":"other-legacy","userId":"actor"}]',1),
          ('actor','wrong-key','[{"id":"wrong-key","userId":"actor"}]',1)`);
      for (const projectId of ['other-legacy', 'wrong-key']) await expect(authorize({ actorUserId: 'actor', projectId })).rejects.toMatchObject(forbidden);
    });
  });

  it('rejects disabled actors, owners and projects including the legacy owner', async () => {
    await withIsolatedPostgres('generation-status', async ({ query }) => {
      await seed(query);
      await query(`INSERT INTO wujie_user_data (user_id,data_key,data_value,updated_at)
        VALUES ('actor','projects','[{"id":"legacy","userId":"actor"}]',1)`);
      await query("UPDATE wujie_users SET status = 'disabled' WHERE id = 'actor'");
      for (const projectId of ['personal','shared','legacy']) await expect(authorize({ actorUserId: 'actor', projectId })).rejects.toMatchObject(forbidden);
      await query("UPDATE wujie_users SET status = 'active' WHERE id = 'actor'");
      await query("UPDATE wujie_users SET status = 'disabled' WHERE id = 'owner'");
      for (const actorUserId of ['owner','actor']) await expect(authorize({ actorUserId, projectId: 'shared' })).rejects.toMatchObject(forbidden);
      await query("UPDATE wujie_users SET status = 'active' WHERE id = 'owner'");
      await query("UPDATE wujie_projects SET status = 'trashed' WHERE id = 'shared'");
      await expect(authorize({ actorUserId: 'actor', projectId: 'shared' })).rejects.toMatchObject(forbidden);
    });
  });

  it('ends admission before revocation, rejects the next request and reads the new grant generation', async () => {
    await withIsolatedPostgres('generation-regrant', async ({ query }) => {
      await seed(query);
      const { revokeDocumentEditor, grantDocumentEditor } = await import('../../src/lib/collaboration/document-access');
      await expect(authorize({ actorUserId: 'actor', projectId: 'shared' })).resolves.toMatchObject({ grantGeneration: '1' });
      expect(getPool().idleCount).toBe(getPool().totalCount);
      await revokeDocumentEditor('owner', 'shared', 'actor');
      await expect(authorize({ actorUserId: 'actor', projectId: 'shared' })).rejects.toMatchObject(forbidden);
      await grantDocumentEditor('owner', 'shared', 'actor');
      await expect(authorize({ actorUserId: 'actor', projectId: 'shared' })).resolves.toMatchObject({ grantGeneration: '3' });
      expect(getPool().idleCount).toBe(getPool().totalCount);
    });
  });

  it('uses a read-only consistent snapshot and releases transactions on allow and deny', async () => {
    await withIsolatedPostgres('generation-snapshot', async ({ query }) => {
      await seed(query);
      const pool = getPool();
      const client = await pool.connect();
      const original = client.query.bind(client) as QueryFn;
      const seen: string[] = [];
      let changed = false;
      const spy = vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
        seen.push(sql);
        const result = await original(sql, values);
        if (/^SELECT/i.test(sql.trim()) && !changed) {
          changed = true;
          expect((await original('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe('on');
          expect((await original('SHOW transaction_isolation')).rows[0].transaction_isolation).toBe('repeatable read');
          // At neither snapshot is actor both active and granted: old snapshot has revoked grant.
          await query("UPDATE wujie_users SET status='disabled' WHERE id='actor'");
          await query("UPDATE wujie_project_document_editors SET status='active' WHERE project_id='shared' AND member_user_id='actor'");
        }
        return result;
      }) as typeof client.query);
      await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE project_id='shared' AND member_user_id='actor'");
      client.release();
      try {
        await expect(authorize({ actorUserId: 'actor', projectId: 'shared' })).rejects.toMatchObject(forbidden);
        expect(changed).toBe(true);
        expect(pool.idleCount).toBe(pool.totalCount);
        expect(seen.some(sql => /^(COMMIT|ROLLBACK)$/i.test(sql))).toBe(true);
        const activity = await query(`SELECT state FROM pg_stat_activity WHERE datname=current_database()
          AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`);
        expect(activity.rows).toEqual([]);
      } finally { spy.mockRestore(); }
    });
  });

  it.each(['SQL', 'COMMIT', 'connect'] as const)('maps %s failure to a fixed 503 and releases the client', async failure => {
    await withIsolatedPostgres(`generation-failure-${failure}`, async ({ query }) => {
      await seed(query);
      const pool = getPool();
      let client: PoolClient | undefined;
      if (failure === 'connect') vi.spyOn(pool, 'connect').mockRejectedValueOnce(new Error('secret-db-url'));
      else {
        client = await pool.connect();
        const original = client.query.bind(client) as QueryFn;
        vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
          if ((failure === 'COMMIT' && sql === 'COMMIT') || (failure === 'SQL' && /^SELECT/i.test(sql.trim()))) {
            // A real PostgreSQL statement failure, including transaction-aborted recovery.
            return original('SELECT generation_secret_missing_column');
          }
          return original(sql, values);
        }) as typeof client.query);
        client.release();
      }
      try {
        await expect(authorize({ actorUserId: 'actor', projectId: 'personal' })).rejects.toMatchObject(unavailable);
        expect(pool.idleCount).toBe(pool.totalCount);
      } finally { vi.restoreAllMocks(); }
      await expect(authorize({ actorUserId: 'actor', projectId: 'personal' })).resolves.toMatchObject({ kind: 'personal' });
    });
  });
});
