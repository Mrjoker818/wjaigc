/**
 * PostgreSQL database client for Wujie AI
 * Uses the built-in exec_sql tool's connection via environment variables
 */

import { Pool, PoolConfig } from 'pg';

const POOL_REGISTRY = Symbol.for('wujie.databasePoolRegistry.v1');

interface DatabasePools {
  business?: Pool;
  advisoryLocks?: Pool;
}

interface PoolRegistry {
  databases: Map<string, DatabasePools>;
  // Keep a failed member visible to concurrent callers until its whole batch drains.
  draining: Set<Promise<void>>;
}

type PoolRegistryGlobal = typeof globalThis & { [POOL_REGISTRY]?: PoolRegistry };

/** Source CLI modules and compiled Next routes must have the same lifecycle owner. */
function getPoolRegistry(): PoolRegistry {
  const scope = globalThis as PoolRegistryGlobal;
  return scope[POOL_REGISTRY] ??= { databases: new Map(), draining: new Set() };
}

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

function getConnectionString(): string {
  const configuredConnectionString = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
  if (!configuredConnectionString) {
    throw new Error('[db-client] No DATABASE_URL or PGDATABASE_URL environment variable set');
  }
  return normalizePostgresConnectionString(configuredConnectionString);
}

function createPool(connectionString: string): Pool {
  const config: PoolConfig = {
      connectionString,
      ssl: connectionString.includes('supabase') || connectionString.includes('aidap') ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
  };
  const created = new Pool(config);
  created.on('error', () => {
    console.error({ code: 'DB_POOL_ERROR' });
  });
  return created;
}

export function getPool(): Pool {
  return getConfiguredPool('business');
}

/** Session-level advisory locks must not consume the business transaction pool. */
export function getAdvisoryLockPool(): Pool {
  return getConfiguredPool('advisoryLocks');
}

function getConfiguredPool(kind: keyof DatabasePools): Pool {
  const connectionString = getConnectionString();
  const registry = getPoolRegistry();
  let databasePools = registry.databases.get(connectionString);
  if (!databasePools) {
    databasePools = {};
    registry.databases.set(connectionString, databasePools);
  }
  return databasePools[kind] ??= createPool(connectionString);
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

async function waitForPoolDrains(pending: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(pending);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

export async function closePool(): Promise<void> {
  const registry = getPoolRegistry();
  const poolDrains: Promise<void>[] = [];
  for (const databasePools of registry.databases.values()) {
    for (const currentPool of [databasePools.business, databasePools.advisoryLocks]) {
      if (!currentPool) continue;
      poolDrains.push(Promise.resolve().then(() => currentPool.end()));
    }
  }
  // Detach before awaiting: old module references can reopen without reusing ended pools.
  registry.databases.clear();
  if (poolDrains.length > 0) {
    const batch = waitForPoolDrains(poolDrains);
    registry.draining.add(batch);
    void batch.then(
      () => { registry.draining.delete(batch); },
      () => { registry.draining.delete(batch); },
    );
  }
  await waitForPoolDrains([...registry.draining]);
}
