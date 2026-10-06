import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
const auth = vi.hoisted(() => ({ userId: 'owner-a' }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => ({ id: auth.userId }) }));
import * as route from '../../src/app/api/collaboration/document-enable/route';

if (process.env.POSTGRES_TEST_DATABASE_URL) requireOfflineBridgeTestDatabaseUrl(process.env);
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL ? it : it.skip;
afterEach(() => { vi.unstubAllEnvs(); auth.userId = 'owner-a'; });

async function setup(query: QueryFn): Promise<void> {
  for (const file of ['20260809_wj_core_users.sql', '20260810_wj_stable_s2_assets.sql',
    '20260925_yjs_canvas_editors.sql', '20260925_yjs_canvas_documents.sql']) {
    await query(await readFile(`migrations/${file}`, 'utf8'));
  }
  await query(`CREATE TABLE wujie_user_data (user_id text, data_key text,
    data_value jsonb, PRIMARY KEY(user_id, data_key))`);
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner-a','Owner','test','active',1,1),('other','Other','test','active',1,1)`);
  await query(`INSERT INTO wujie_user_data VALUES
    ('owner-a','projects','[{"id":"legacy-a","userId":"owner-a"}]'),
    ('owner-a','__asset_graph_projects_revision','3')`);
}

async function get(): Promise<Response> {
  const handler = (route as typeof route & { GET?: (req: NextRequest) => Promise<Response> }).GET;
  expect(handler, 'the owner read endpoint must exist').toBeTypeOf('function');
  if (!handler) throw new Error('Owner status GET missing');
  return handler(new NextRequest('http://localhost/api/collaboration/document-enable?projectId=legacy-a'));
}

describe('owner status against isolated PostgreSQL', () => {
  postgresIt.each([true, false])('reads enabled authority with feature flag %s without changing any rows', async featureEnabled => {
    await withIsolatedPostgres('owner-status-enabled', async ({ query }) => {
      await setup(query);
      vi.stubEnv('WUJIE_YJS_ENABLED', String(featureEnabled));
      await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('legacy-a','owner-a','Legacy')");
      await query("INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled,authority_revision) VALUES ('legacy-a','owner-a',true,3)");
      await query("INSERT INTO wujie_project_canvas_documents (project_id,owner_id) VALUES ('legacy-a','owner-a')");
      const tables = ['wujie_user_data', 'wujie_projects', 'wujie_assets', 'wujie_asset_versions',
        'wujie_project_document_settings', 'wujie_project_canvas_documents'];
      const before = await Promise.all(tables.map(table => query(`SELECT * FROM ${table}`)));
      const response = await get();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, projectId: 'legacy-a', featureEnabled,
        enabled: true, currentRevision: 3 });
      for (const [index, table] of tables.entries()) {
        expect((await query(`SELECT * FROM ${table}`)).rows).toEqual(before[index].rows);
      }
      await query('DELETE FROM wujie_project_document_settings');
      expect((await get()).status).toBe(409);
    });
  });
  postgresIt('reads an unmigrated project without creating graph or document rows', async () => {
    await withIsolatedPostgres('owner-status-legacy', async ({ query }) => {
      await setup(query);
      vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
      const before = await query('SELECT * FROM wujie_user_data ORDER BY user_id,data_key');
      const response = await get();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, projectId: 'legacy-a',
        featureEnabled: false, enabled: false, currentRevision: 3 });
      expect((await query('SELECT * FROM wujie_user_data ORDER BY user_id,data_key')).rows).toEqual(before.rows);
      for (const table of ['wujie_projects', 'wujie_project_canvas_documents', 'wujie_project_document_settings']) {
        expect((await query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(0);
      }
    });
  });

  postgresIt.each(['foreign', 'disabled', 'trashed', 'missing-document', 'duplicate', 'bad-revision'])
    ('rejects %s without guessing an unenabled state', async scenario => {
      await withIsolatedPostgres(`owner-status-${scenario}`, async ({ query }) => {
        await setup(query);
        if (scenario === 'foreign') auth.userId = 'other';
        if (scenario === 'disabled') await query("UPDATE wujie_users SET status='disabled' WHERE id='owner-a'");
        if (scenario === 'trashed' || scenario === 'missing-document') {
          await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('legacy-a','owner-a','Legacy')");
          if (scenario === 'trashed') await query("UPDATE wujie_projects SET status='trashed'");
          else await query("INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled,authority_revision) VALUES ('legacy-a','owner-a',true,3)");
        }
        if (scenario === 'duplicate') await query("UPDATE wujie_user_data SET data_value=data_value || data_value WHERE data_key='projects'");
        if (scenario === 'bad-revision') await query("UPDATE wujie_user_data SET data_value='-1' WHERE data_key='__asset_graph_projects_revision'");
        const response = await get();
        expect(response.status).toBe(['foreign', 'disabled', 'trashed'].includes(scenario) ? 403 : 409);
        expect((await response.json()).success).toBe(false);
        expect((await query('SELECT count(*)::int AS count FROM wujie_project_canvas_documents')).rows[0].count).toBe(0);
      });
    });
});
