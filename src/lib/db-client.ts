/**
 * PostgreSQL database client for Wujie AI
 * Uses the built-in exec_sql tool's connection via environment variables
 */

import { Pool, PoolConfig } from 'pg';

let pool: Pool | null = null;

export function normalizePostgresConnectionString(connectionString: string): string {
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

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.PGDATABASE_URL);
}

export function getPool(): Pool {
  if (!pool) {
    const configuredConnectionString = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
    if (!isDatabaseConfigured() || !configuredConnectionString) {
      throw new Error('[db-client] No DATABASE_URL or PGDATABASE_URL environment variable set');
    }
    const connectionString = normalizePostgresConnectionString(configuredConnectionString);
    const config: PoolConfig = {
      connectionString,
      ssl: connectionString.includes('supabase') || connectionString.includes('aidap') ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    };
    pool = new Pool(config);

    pool.on('error', () => {
      console.error({ code: 'DB_POOL_ERROR' });
    });
  }
  return pool;
}

export interface SqlResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export async function execSql(query: string, params?: unknown[]): Promise<SqlResult> {
  const client = getPool();
  const maxRetries = 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await client.query(query, params);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    } catch (e: unknown) {
      lastError = e;
      const errMsg = e instanceof Error ? e.message : String(e);
      const isTransient = errMsg.includes('Connection terminated')
        || errMsg.includes('ECONNRESET')
        || errMsg.includes('ETIMEDOUT')
        || errMsg.includes('timeout')
        || errMsg.includes('connection is closed');

      if (isTransient && attempt < maxRetries) {
        console.warn({
          code: 'DB_SQL_TRANSIENT_RETRY',
          attempt: attempt + 1,
          maxAttempts: maxRetries + 1,
        });
        // Don't destroy the entire pool — pg handles bad connections internally.
        // Only reset pool if it's completely unusable (null check on next attempt).
        // Previously pool.end() here caused cascading failures for concurrent queries.
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      console.error({ code: 'DB_SQL_QUERY_FAILED' });
      throw e;
    }
  }

  throw lastError;
}

export async function testConnection(): Promise<boolean> {
  try {
    const result = await execSql('SELECT 1 as test');
    return result.rowCount > 0;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  const currentPool = pool;
  pool = null;
  if (currentPool) await currentPool.end();
}
