import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pool construction/end are real; these tests never query or connect to a database.
const databaseA = 'postgresql://postgres@127.0.0.1:55497/wujie_bridge_test_pool_a';
const databaseB = 'postgresql://postgres@127.0.0.1:55497/wujie_bridge_test_pool_b';
const retainedPools = new Set<Pool>();
const releases = new Set<() => void>();
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalPgDatabaseUrl = process.env.PGDATABASE_URL;

function retain(pool: Pool): Pool {
  retainedPools.add(pool);
  return pool;
}

function holdEnd(pool: Pool): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const end = pool.end.bind(pool);
  vi.spyOn(pool, 'end').mockImplementation(async (): Promise<void> => {
    await gate;
    await end();
  });
  releases.add(release);
  return release;
}

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_URL = databaseA;
  delete process.env.PGDATABASE_URL;
});

afterEach(async () => {
  for (const release of releases) release();
  releases.clear();
  vi.restoreAllMocks();
  await (await import('@/lib/db-client')).closePool();
  for (const pool of retainedPools) {
    if (!pool.ending) await pool.end();
  }
  retainedPools.clear();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalPgDatabaseUrl === undefined) delete process.env.PGDATABASE_URL;
  else process.env.PGDATABASE_URL = originalPgDatabaseUrl;
});

describe('db-client process-owned pool lifecycle', () => {
  it('closes business and lock pools created by another evaluated module instance', async () => {
    const firstModule = await import('@/lib/db-client');
    const business = retain(firstModule.getPool());
    const locks = retain(firstModule.getAdvisoryLockPool());
    expect(locks).not.toBe(business);
    vi.resetModules();
    const closingModule = await import('@/lib/db-client');

    await closingModule.closePool();

    expect(business.ended).toBe(true);
    expect(locks.ended).toBe(true);
    const reopened = retain(firstModule.getPool());
    expect(reopened).not.toBe(business);
    expect(reopened.ended).toBe(false);
  });

  it('does not route a changed database configuration into the previous database pool', async () => {
    const db = await import('@/lib/db-client');
    const first = retain(db.getPool());
    process.env.DATABASE_URL = databaseB;
    const second = retain(db.getPool());

    expect(second).not.toBe(first);
    expect(second.options.connectionString).toBe(databaseB);
    process.env.DATABASE_URL = databaseA;
    expect(db.getPool()).toBe(first);
    await db.closePool();
    expect(first.ended).toBe(true);
    expect(second.ended).toBe(true);
  });

  it('a concurrent close waits for an already draining pool instead of reporting early success', async () => {
    const db = await import('@/lib/db-client');
    const business = retain(db.getPool());
    const release = holdEnd(business);
    const firstClose = db.closePool();
    let secondSettled = false;
    const secondClose = db.closePool().finally(() => { secondSettled = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(secondSettled).toBe(false);
    release();
    await Promise.all([firstClose, secondClose]);
    expect(business.ended).toBe(true);
  });

  it('waits for the other pool to drain before propagating a pool close failure', async () => {
    const db = await import('@/lib/db-client');
    const business = retain(db.getPool());
    const locks = retain(db.getAdvisoryLockPool());
    const failure = new Error('injected close failure');
    vi.spyOn(business, 'end').mockRejectedValueOnce(failure);
    const release = holdEnd(locks);
    let settled = false;
    const closing = db.closePool().then(
      () => { settled = true; return undefined; },
      (error: unknown) => { settled = true; return error; },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(settled).toBe(false);
    release();
    expect(await closing).toBe(failure);
    expect(locks.ended).toBe(true);
  });

  it('a late concurrent close retains an earlier failure until the whole drain batch finishes', async () => {
    const db = await import('@/lib/db-client');
    const business = retain(db.getPool());
    const locks = retain(db.getAdvisoryLockPool());
    const failure = new Error('injected early close failure');
    vi.spyOn(business, 'end').mockRejectedValueOnce(failure);
    const release = holdEnd(locks);
    const firstClose = db.closePool().catch((error: unknown) => error);
    // Let the business pool fail before another caller joins the still-running batch.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    let secondSettled = false;
    const secondClose = db.closePool().then(
      () => { secondSettled = true; return undefined; },
      (error: unknown) => { secondSettled = true; return error; },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(secondSettled).toBe(false);
    release();
    expect(await firstClose).toBe(failure);
    expect(await secondClose).toBe(failure);
  });
});
