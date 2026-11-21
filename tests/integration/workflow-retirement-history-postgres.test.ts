import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, it } from 'vitest';

it('blocks historical workflow deletion in PostgreSQL and preserves rows, relations and timeout', async () => {
  const url = process.env.POSTGRES_TEST_DATABASE_URL;
  if (!url) throw new Error('dedicated PostgreSQL test identity is required');
  const client = new Client({ connectionString: url });
  await client.connect();
  const schema = `retirement_${randomUUID().replaceAll('-', '')}`;
  const { assertWorkflowRetirementSafe } = await import('../../scripts/run-migrations.mjs');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    await client.query("SET LOCAL lock_timeout='910ms'");
    await client.query('CREATE TABLE wujie_user_data (data_key text, data_value jsonb)');
    await client.query('CREATE TABLE wujie_projects (metadata jsonb)');
    await client.query('CREATE TABLE wujie_workflow_edit_outputs (id text)');
    await client.query('CREATE TABLE wujie_workflow_edit_publications (id text)');
    const originalRelations = (await client.query('SELECT c.relname,c.oid::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname', [schema])).rows;
    const cases = [
      { sql: 'INSERT INTO wujie_user_data VALUES ($1,$2)', values: ['workflow_draft', JSON.stringify({ steps: ['retained'] })], table: 'wujie_user_data' },
      { sql: 'INSERT INTO wujie_user_data VALUES ($1,$2)', values: ['projects', JSON.stringify([{ id: 'p', metadata: { workflow: { saved: true } } }])], table: 'wujie_user_data' },
      { sql: 'INSERT INTO wujie_projects VALUES ($1)', values: [JSON.stringify({ workflow: { saved: true } })], table: 'wujie_projects' },
      { sql: 'INSERT INTO wujie_workflow_edit_outputs VALUES ($1)', values: ['accepted-receipt'], table: 'wujie_workflow_edit_outputs' },
      { sql: 'INSERT INTO wujie_workflow_edit_publications VALUES ($1)', values: ['pending-publication'], table: 'wujie_workflow_edit_publications' },
    ];
    for (const fixture of cases) {
      await client.query('SAVEPOINT fixture');
      await client.query(fixture.sql, fixture.values);
      await expect(assertWorkflowRetirementSafe(client, '20261118_wj_remove_node_workflows.sql')).rejects.toThrow('WORKFLOW_RETIREMENT_HISTORY_REQUIRES_REVIEW');
      expect((await client.query(`SELECT count(*)::int count FROM "${fixture.table}"`)).rows[0].count).toBe(1);
      expect((await client.query("SELECT current_setting('lock_timeout') timeout")).rows[0].timeout).toBe('910ms');
      await client.query('ROLLBACK TO SAVEPOINT fixture');
    }
    // Ordinary projects and similarly named data must not prevent fresh installation.
    await client.query('INSERT INTO wujie_user_data VALUES ($1,$2)', ['workflowX', JSON.stringify({ ordinary: true })]);
    await client.query('INSERT INTO wujie_user_data VALUES ($1,$2)', ['projects', JSON.stringify([{ metadata: { title: 'kept' } }])]);
    await client.query('INSERT INTO wujie_projects VALUES ($1)', [JSON.stringify({ title: 'kept' })]);
    await expect(assertWorkflowRetirementSafe(client, '20261118_wj_remove_node_workflows.sql')).resolves.toBeUndefined();
    expect((await client.query('SELECT c.relname,c.oid::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname', [schema])).rows).toEqual(originalRelations);
    expect((await client.query('SELECT count(*)::int count FROM wujie_user_data')).rows[0].count).toBe(2);
    expect((await client.query("SELECT current_setting('lock_timeout') timeout")).rows[0].timeout).toBe('910ms');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
});

it('checks the actual resolved relations when pg_catalog is first in the search path', async () => {
  const client = new Client({ connectionString: process.env.POSTGRES_TEST_DATABASE_URL });
  if (!process.env.POSTGRES_TEST_DATABASE_URL) throw new Error('dedicated PostgreSQL test identity is required');
  await client.connect();
  const schema = `retirement_${randomUUID().replaceAll('-', '')}`;
  const { assertWorkflowRetirementSafe } = await import('../../scripts/run-migrations.mjs');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`CREATE TABLE "${schema}".wujie_user_data (data_key text, data_value jsonb)`);
    await client.query(`INSERT INTO "${schema}".wujie_user_data VALUES ('workflow_saved','{"retained":true}'::jsonb)`);
    await client.query(`SET LOCAL search_path TO pg_catalog,"${schema}"`);
    await expect(assertWorkflowRetirementSafe(client, '20261118_wj_remove_node_workflows.sql')).rejects.toThrow('WORKFLOW_RETIREMENT_HISTORY_REQUIRES_REVIEW');
    expect((await client.query(`SELECT data_value FROM "${schema}".wujie_user_data`)).rows).toEqual([{ data_value: { retained: true } }]);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
});

it('refuses a writable view instead of treating a resolved non-table as empty history', async () => {
  if (!process.env.POSTGRES_TEST_DATABASE_URL) throw new Error('dedicated PostgreSQL test identity is required');
  const client = new Client({ connectionString: process.env.POSTGRES_TEST_DATABASE_URL });
  await client.connect();
  const schema = `retirement_${randomUUID().replaceAll('-', '')}`;
  const { assertWorkflowRetirementSafe } = await import('../../scripts/run-migrations.mjs');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    await client.query('CREATE TABLE history_backing (data_key text, data_value jsonb)');
    await client.query('INSERT INTO history_backing VALUES ($1,$2)', ['workflow_kept', JSON.stringify({ preserved: true })]);
    await client.query('CREATE VIEW wujie_user_data AS SELECT * FROM history_backing');
    await expect(assertWorkflowRetirementSafe(client, '20261118_wj_remove_node_workflows.sql')).rejects.toThrow('WORKFLOW_RETIREMENT_RELATION_REQUIRES_REVIEW');
    expect((await client.query('SELECT data_value FROM history_backing')).rows).toEqual([{ data_value: { preserved: true } }]);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
});
