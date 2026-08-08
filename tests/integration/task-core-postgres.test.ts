import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
    expect(helpers.createIsolatedPostgresConnectionString).toBeTypeOf('function');
  });

  it('fails production doctor when the PostgreSQL test database is unavailable', () => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DOCTOR_SKIP_ENV_FILE: '1',
    };
    delete environment.POSTGRES_TEST_DATABASE_URL;

    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/doctor.mjs'), '--production'],
      {
        cwd: process.cwd(),
        env: environment,
        encoding: 'utf8',
      },
    );

    expect(result.stdout).toContain(
      '[BLOCKED] postgres-test-database: POSTGRES_TEST_DATABASE_URL is not configured; Stage 1 release verification is blocked',
    );
    expect(result.status).not.toBe(0);
  });

  it('creates a Pool connection string with no public schema fallback', async () => {
    const { createIsolatedPostgresConnectionString } = await import(
      '../helpers/postgres-test-database'
    );
    const connectionString = createIsolatedPostgresConnectionString(
      'postgresql://postgres:postgres@localhost:5432/wujie_test?options=-cstatement_timeout%3D5000',
      'test_task_core',
    );
    const options = new URL(connectionString).searchParams.get('options');

    expect(options).toContain('-cstatement_timeout=5000');
    expect(options).toContain('-csearch_path=test_task_core');
    expect(options).not.toContain('public');
  });

  it('runs every cleanup step and aggregates every cleanup failure', async () => {
    const { cleanupIsolatedPostgres } = await import(
      '../helpers/postgres-test-database'
    );
    const stepNames = [
      'close-isolated-business-pool',
      'restore-database-environment',
      'rollback-helper-client',
      'reset-helper-search-path',
      'drop-isolated-schema',
      'end-helper-client',
    ];
    const calls: string[] = [];

    let cleanupError: unknown;
    try {
      const failingStep = (name: string) => async () => {
        calls.push(name);
        throw new Error(`${name} failed`);
      };
      await cleanupIsolatedPostgres({
        closeBusinessPool: failingStep('close-isolated-business-pool'),
        dropIsolatedSchema: failingStep('drop-isolated-schema'),
        endHelperClient: failingStep('end-helper-client'),
        environmentBound: true,
        resetHelperSearchPath: failingStep('reset-helper-search-path'),
        restoreDatabaseEnvironment: failingStep(
          'restore-database-environment',
        ),
        rollbackHelperClient: failingStep('rollback-helper-client'),
        schemaCreated: true,
      });
    } catch (error) {
      cleanupError = error;
    }

    expect(calls).toEqual(stepNames);
    expect(cleanupError).toBeInstanceOf(AggregateError);
    expect(
      (cleanupError as AggregateError).errors.map(
        (error) => (error as Error).message,
      ),
    ).toEqual(stepNames.map((name) => `${name}: ${name} failed`));
    expect((cleanupError as Error).message).toContain(
      'PostgreSQL isolation cleanup failed',
    );
  });

  it('lets the postgres-test blocker alone determine production exit status', async () => {
    const { getDoctorExitCode } = await import('../../scripts/doctor-status.mjs');

    expect(
      getDoctorExitCode({
        blockedCount: 0,
        failedCount: 0,
        production: true,
      }),
    ).toBe(0);
    expect(
      getDoctorExitCode({
        blockedCount: 1,
        failedCount: 0,
        production: true,
      }),
    ).not.toBe(0);
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

  postgresIt('binds business execSql to the isolated schema and removes it after the test', async () => {
    const { schemaExists, withIsolatedPostgres } = await import(
      '../helpers/postgres-test-database'
    );
    const tableName = `task_core_marker_${randomUUID()
      .replaceAll('-', '')
      .slice(0, 12)}`;
    const schema = await withIsolatedPostgres(
      'task-core-schema',
      async ({ databaseUrl, schemaName, query }) => {
        expect(process.env.DATABASE_URL).toBe(databaseUrl);
        expect(process.env.PGDATABASE_URL).toBe(databaseUrl);

        await query(
          `CREATE TABLE public.${tableName}(id text primary key, source text not null)`,
        );
        try {
          await query(
            `INSERT INTO public.${tableName}(id, source) VALUES ('shared', 'public')`,
          );

          const { execSql } = await import('@/lib/db-client');
          const beforeCreate = await execSql(
            `SELECT to_regclass('${tableName}')::text AS relation`,
          );
          expect(beforeCreate.rows[0]?.relation).toBeNull();

          await execSql(
            `CREATE TABLE ${tableName}(id text primary key, source text not null)`,
          );
          await execSql(
            `INSERT INTO ${tableName}(id, source) VALUES ($1, $2)`,
            ['isolated', 'business-exec-sql'],
          );

          const activeSchema = await execSql(
            'SELECT current_schema() AS schema_name',
          );
          const isolatedRows = await execSql(
            `SELECT id, source FROM ${tableName}`,
          );
          const publicRows = await query(
            `SELECT id, source FROM public.${tableName}`,
          );

          expect(activeSchema.rows[0]?.schema_name).toBe(schemaName);
          expect(isolatedRows.rows).toEqual([
            { id: 'isolated', source: 'business-exec-sql' },
          ]);
          expect(publicRows.rows).toEqual([
            { id: 'shared', source: 'public' },
          ]);
          return schemaName;
        } finally {
          await query(`DROP TABLE IF EXISTS public.${tableName}`);
        }
      },
    );

    expect(await schemaExists(schema)).toBe(false);
  });
});
