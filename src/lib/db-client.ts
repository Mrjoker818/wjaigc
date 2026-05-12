/**
 * PostgreSQL database client for Wujie AI
 * Uses the built-in exec_sql tool's connection via environment variables
 */

import { Pool, PoolConfig } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
    if (!connectionString) {
      throw new Error('[db-client] No DATABASE_URL or PGDATABASE_URL environment variable set');
    }
    const config: PoolConfig = {
      connectionString,
      ssl: connectionString.includes('supabase') || connectionString.includes('aidap') ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
    pool = new Pool(config);

    pool.on('error', (err) => {
      console.error('[db-client] Unexpected pool error:', err);
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
  try {
    const result = await client.query(query, params);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (e) {
    console.error('[db-client] SQL error:', e);
    throw e;
  }
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
  if (pool) {
    await pool.end();
    pool = null;
  }
}
