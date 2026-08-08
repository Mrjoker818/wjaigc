import { randomUUID } from 'node:crypto';

import {
  Client,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

import { closePool } from '../../src/lib/db-client';

export type QueryFn = <TRow extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<TRow>>;

interface IsolatedPostgresContext {
  databaseUrl: string;
  schemaName: string;
  query: QueryFn;
}

interface PostgresCleanupStep {
  name: string;
  run: () => Promise<void> | void;
}

interface IsolatedPostgresCleanupOptions {
  closeBusinessPool: () => Promise<void> | void;
  dropIsolatedSchema: () => Promise<void> | void;
  endHelperClient: () => Promise<void> | void;
  environmentBound: boolean;
  resetHelperSearchPath: () => Promise<void> | void;
  restoreDatabaseEnvironment: () => Promise<void> | void;
  rollbackHelperClient: () => Promise<void> | void;
  schemaCreated: boolean;
}

function getConnectionString(): string {
  const connectionString = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      'POSTGRES_TEST_DATABASE_URL is required for real PostgreSQL integration tests',
    );
  }
  return normalizePostgresConnectionString(connectionString);
}

function normalizePostgresConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    if (
      parsed.searchParams.get('sslmode')?.toLowerCase() === 'require'
      && !parsed.searchParams.has('uselibpqcompat')
    ) {
      parsed.searchParams.set('uselibpqcompat', 'true');
      return parsed.toString();
    }
  } catch {
    return connectionString;
  }
  return connectionString;
}

function createSchemaName(testName: string): string {
  const stem = testName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'test';
  return `test_${stem}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function restoreEnvironmentVariable(
  name: 'DATABASE_URL' | 'PGDATABASE_URL',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function createStepError(stepName: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${stepName}: ${detail}`, { cause: error });
}

export async function runPostgresCleanup(
  steps: PostgresCleanupStep[],
): Promise<void> {
  const errors: Error[] = [];

  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      errors.push(createStepError(step.name, error));
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `PostgreSQL isolation cleanup failed (${errors.length} step${errors.length === 1 ? '' : 's'})`,
    );
  }
}

export async function cleanupIsolatedPostgres({
  closeBusinessPool,
  dropIsolatedSchema,
  endHelperClient,
  environmentBound,
  resetHelperSearchPath,
  restoreDatabaseEnvironment,
  rollbackHelperClient,
  schemaCreated,
}: IsolatedPostgresCleanupOptions): Promise<void> {
  const steps: PostgresCleanupStep[] = [];
  if (environmentBound) {
    steps.push(
      {
        name: 'close-isolated-business-pool',
        run: closeBusinessPool,
      },
      {
        name: 'restore-database-environment',
        run: restoreDatabaseEnvironment,
      },
    );
  }
  if (schemaCreated) {
    steps.push(
      {
        name: 'rollback-helper-client',
        run: rollbackHelperClient,
      },
      {
        name: 'reset-helper-search-path',
        run: resetHelperSearchPath,
      },
      {
        name: 'drop-isolated-schema',
        run: dropIsolatedSchema,
      },
    );
  }
  steps.push({
    name: 'end-helper-client',
    run: endHelperClient,
  });
  await runPostgresCleanup(steps);
}

export function createIsolatedPostgresConnectionString(
  connectionString: string,
  schemaName: string,
): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schemaName)) {
    throw new Error(`Invalid PostgreSQL test schema name: ${schemaName}`);
  }

  const parsed = new URL(normalizePostgresConnectionString(connectionString));
  const existingOptions = parsed.searchParams.get('options')?.trim() || '';
  if (/\bsearch_path\b/i.test(existingOptions)) {
    throw new Error(
      'POSTGRES_TEST_DATABASE_URL options must not define search_path',
    );
  }
  parsed.searchParams.set(
    'options',
    [existingOptions, `-csearch_path=${schemaName}`]
      .filter(Boolean)
      .join(' '),
  );
  return parsed.toString();
}

export async function withIsolatedPostgres<T>(
  testName: string,
  callback: (context: IsolatedPostgresContext) => Promise<T>,
): Promise<T> {
  const connectionString = getConnectionString();
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
  });
  const schemaName = createSchemaName(testName);
  const quotedSchemaName = quoteIdentifier(schemaName);
  const databaseUrl = createIsolatedPostgresConnectionString(
    connectionString,
    schemaName,
  );
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousPgDatabaseUrl = process.env.PGDATABASE_URL;
  let schemaCreated = false;
  let environmentBound = false;
  let operationError: unknown;
  let operationFailed = false;
  let result: T | undefined;

  try {
    await client.connect();
    await client.query(`CREATE SCHEMA ${quotedSchemaName}`);
    schemaCreated = true;
    await client.query(`SET search_path TO ${quotedSchemaName}`);

    await closePool();
    process.env.DATABASE_URL = databaseUrl;
    process.env.PGDATABASE_URL = databaseUrl;
    environmentBound = true;

    const query: QueryFn = (text, values) => client.query(text, values);
    result = await callback({ databaseUrl, schemaName, query });
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  let cleanupError: unknown;
  try {
    await cleanupIsolatedPostgres({
      closeBusinessPool: () => closePool(),
      dropIsolatedSchema: () =>
        client
          .query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`)
          .then(() => undefined),
      endHelperClient: () => client.end(),
      environmentBound,
      resetHelperSearchPath: () =>
        client.query('RESET search_path').then(() => undefined),
      restoreDatabaseEnvironment: () => {
        restoreEnvironmentVariable('DATABASE_URL', previousDatabaseUrl);
        restoreEnvironmentVariable('PGDATABASE_URL', previousPgDatabaseUrl);
      },
      rollbackHelperClient: () =>
        client.query('ROLLBACK').then(() => undefined),
      schemaCreated,
    });
  } catch (error) {
    cleanupError = error;
  }

  if (operationFailed && cleanupError) {
    const cleanupErrors =
      cleanupError instanceof AggregateError
        ? cleanupError.errors
        : [cleanupError];
    throw new AggregateError(
      [
        createStepError('postgres-operation', operationError),
        ...cleanupErrors,
      ],
      'PostgreSQL isolation operation and cleanup failed',
    );
  }
  if (operationFailed) throw operationError;
  if (cleanupError) throw cleanupError;
  return result as T;
}

export async function schemaExists(schemaName: string): Promise<boolean> {
  const client = new Client({
    connectionString: getConnectionString(),
    connectionTimeoutMillis: 5_000,
  });

  try {
    await client.connect();
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
         FROM information_schema.schemata
         WHERE schema_name = $1
       ) AS exists`,
      [schemaName],
    );
    return result.rows[0]?.exists === true;
  } finally {
    await client.end().catch(() => undefined);
  }
}
