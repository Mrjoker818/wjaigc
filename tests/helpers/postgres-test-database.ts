import { randomUUID } from 'node:crypto';

import {
  Client,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

export type QueryFn = <TRow extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<TRow>>;

interface IsolatedPostgresContext {
  schemaName: string;
  query: QueryFn;
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

export async function withIsolatedPostgres<T>(
  testName: string,
  callback: (context: IsolatedPostgresContext) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: getConnectionString(),
    connectionTimeoutMillis: 5_000,
  });
  const schemaName = createSchemaName(testName);
  const quotedSchemaName = quoteIdentifier(schemaName);
  let schemaCreated = false;

  try {
    await client.connect();
    await client.query(`CREATE SCHEMA ${quotedSchemaName}`);
    schemaCreated = true;
    await client.query(`SET search_path TO ${quotedSchemaName}, public`);

    const query: QueryFn = (text, values) => client.query(text, values);
    return await callback({ schemaName, query });
  } finally {
    if (schemaCreated) {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('RESET search_path').catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`);
    }
    await client.end().catch(() => undefined);
  }
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
