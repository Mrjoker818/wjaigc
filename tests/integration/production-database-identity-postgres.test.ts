import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: async () => ({ id: 'synthetic-admin', role: 'admin' }) }));
vi.mock('@/lib/cloud-task-storage', () => ({ ensureCloudTaskTables: () => { throw new Error('Schema initialization is forbidden in identity diagnosis'); } }));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: () => { throw new Error('Provider reads are forbidden in identity diagnosis'); } }));
vi.mock('@/lib/asset-core/asset-release-readiness', () => ({ collectAssetGraphReleaseReadiness: () => { throw new Error('Graph scans are forbidden in identity diagnosis'); } }));
vi.mock('@/lib/payment-config', () => ({ getProductionPaymentConfigurationIssues: () => [] }));
vi.mock('@/lib/task-event-transport', () => ({ getTaskEventTransportReadinessIssue: () => null }));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
postgresIt('reports the real application database identity without changing data, schema or pooled transaction settings', async () => {
  const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
  await withIsolatedPostgres('runtime-database-identity', async ({ query, schemaName }) => {
    await query('CREATE TABLE identity_guard (id integer PRIMARY KEY, value text NOT NULL)');
    await query("INSERT INTO identity_guard VALUES (1,'original synthetic fixture')");
    const before = await query(`SELECT current_user::text AS role, session_user::text AS session_role,
      current_database() AS database_name, inet_server_addr()::text AS server_address,
      current_setting('statement_timeout') AS statement_timeout,
      current_setting('transaction_read_only') AS read_only`);
    const original = await query('SELECT * FROM identity_guard');
    const { GET } = await import('../../src/app/api/admin/production-readiness/route');
    const response = await GET(new NextRequest('https://readiness.invalid/api/admin/production-readiness?diagnostics=database-identity'));
    expect(response.status).toBe(200);
    const result = await response.json();
    const row = before.rows[0];
    expect(result.identity).toMatchObject({ source: 'application-runtime', readOnly: true, role: row.role,
      sessionRole: row.session_role, schema: schemaName,
      databaseNameSha256: createHash('sha256').update(String(row.database_name)).digest('hex') });
    if (row.server_address !== null) expect(JSON.stringify(result)).not.toContain(row.server_address);
    expect(JSON.stringify(result)).not.toContain(row.database_name);
    expect((await query('SELECT * FROM identity_guard')).rows).toEqual(original.rows);
    expect((await query(`SELECT table_name FROM information_schema.tables WHERE table_schema=$1`, [schemaName])).rows)
      .toEqual([{ table_name: 'identity_guard' }]);
    const { getPool } = await import('../../src/lib/db-client');
    const after = await getPool().query(`SELECT current_setting('statement_timeout') AS statement_timeout,
      current_setting('transaction_read_only') AS read_only`);
    expect(after.rows[0]).toEqual({ statement_timeout: row.statement_timeout, read_only: row.read_only });
  });
});
