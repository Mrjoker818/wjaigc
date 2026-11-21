import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

postgresIt('protects document snapshots from temporary relations created after migration', async () => {
  const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
  await withIsolatedPostgres('document-fence-temporary-shadow', async ({ query, schemaName }) => {
    for (const migration of [
      '20260809_wj_core_users.sql',
      '20260810_wj_stable_s2_assets.sql',
      '20260925_yjs_canvas_editors.sql',
      '20260925_yjs_canvas_documents.sql',
    ]) await query(await readFile(`migrations/${migration}`, 'utf8'));
    await query(`CREATE TABLE wujie_user_data (
      user_id text NOT NULL, data_key text NOT NULL, data_value jsonb,
      updated_at bigint NOT NULL, PRIMARY KEY(user_id,data_key))`);
    await query(await readFile('migrations/20260926_yjs_canvas_authority_fence.sql', 'utf8'));
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,created_at,updated_at)
      VALUES ('owner','Owner','test','active',1,1)`);
    await query(`INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project','owner','Original')`);
    const snapshot = [{ id: 'project', userId: 'owner', name: 'Original', createdAt: 1, canvasImages: [] }];
    await query(`INSERT INTO wujie_user_data VALUES ('owner','projects',$1::jsonb,1)`, [JSON.stringify(snapshot)]);
    await query(`INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled)
      VALUES ('project','owner',true)`);
    const qualifiedData = `"${schemaName}".wujie_user_data`;
    await expect(query(`UPDATE ${qualifiedData} SET data_value='[]' WHERE user_id='owner'`))
      .rejects.toThrow('DOCUMENT_AUTHORITY_CONFLICT');

    await query(await readFile('migrations/20261121_yjs_canvas_authority_fence_search_path.sql', 'utf8'));
    // Temporary relations are deliberately introduced after the hardening.
    await query(`CREATE TEMP TABLE wujie_project_document_settings
      (LIKE "${schemaName}".wujie_project_document_settings)`);
    await query(`CREATE TEMP TABLE wujie_projects (LIKE "${schemaName}".wujie_projects)`);
    await expect(query(`UPDATE ${qualifiedData} SET data_value='[]' WHERE user_id='owner'`))
      .rejects.toThrow('DOCUMENT_AUTHORITY_CONFLICT');
    await expect(query(`DELETE FROM ${qualifiedData} WHERE user_id='owner'`))
      .rejects.toThrow('DOCUMENT_AUTHORITY_CONFLICT');
    const renamed = [{ ...snapshot[0], name: 'Renamed' }];
    await expect(query(`UPDATE ${qualifiedData} SET data_value=$1::jsonb WHERE user_id='owner'`,
      [JSON.stringify(renamed)])).resolves.toMatchObject({ rowCount: 1 });
    expect((await query(`SELECT name FROM "${schemaName}".wujie_projects WHERE id='project'`)).rows)
      .toEqual([{ name: 'Renamed' }]);
    expect((await query('SELECT count(*)::int n FROM pg_temp.wujie_projects')).rows[0].n).toBe(0);
    expect((await query(`SELECT data_value FROM ${qualifiedData} WHERE user_id='owner'`)).rows[0].data_value)
      .toEqual(renamed);
  });
});
