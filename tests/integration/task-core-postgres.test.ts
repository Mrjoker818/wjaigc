import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; real PostgreSQL isolation test skipped.',
  );
}

describe('task core PostgreSQL baseline', () => {
  it('exposes the isolated PostgreSQL helper contract', async () => {
    const helpers = await import('../helpers/postgres-test-database');

    expect(helpers.withIsolatedPostgres).toBeTypeOf('function');
    expect(helpers.schemaExists).toBeTypeOf('function');
  });

  it('reports a release blocker when the PostgreSQL test database is unavailable', () => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DOCTOR_SKIP_ENV_FILE: '1',
    };
    delete environment.POSTGRES_TEST_DATABASE_URL;

    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/doctor.mjs')],
      {
        cwd: process.cwd(),
        env: environment,
        encoding: 'utf8',
      },
    );

    expect(result.stdout).toContain(
      '[BLOCKED] postgres-test-database: POSTGRES_TEST_DATABASE_URL is not configured; Stage 1 release verification is blocked',
    );
  });

  it('requires doctor to probe the Stage 1 PostgreSQL capabilities', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/doctor.mjs'),
      'utf8',
    );

    expect(source).toContain('POSTGRES_TEST_DATABASE_URL');
    expect(source).toContain('CREATE TABLE doctor_stage1_probe');
    expect(source).toContain("client.query('BEGIN')");
    expect(source).toContain('CREATE UNIQUE INDEX');
    expect(source).toContain('pg_try_advisory_lock');
  });

  postgresIt('creates an isolated schema and removes it after the test', async () => {
    const { schemaExists, withIsolatedPostgres } = await import(
      '../helpers/postgres-test-database'
    );
    const schema = await withIsolatedPostgres(
      'task-core-schema',
      async ({ schemaName, query }) => {
        await query('CREATE TABLE marker(id text primary key)');
        return schemaName;
      },
    );

    expect(await schemaExists(schema)).toBe(false);
  });
});
