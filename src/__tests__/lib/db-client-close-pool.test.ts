import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pgMocks = vi.hoisted(() => {
  const instances: Array<{
    end: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  }> = [];
  const Pool = vi.fn(() => {
    const instance = {
      end: vi.fn(),
      on: vi.fn(),
      query: vi.fn(),
    };
    instances.push(instance);
    return instance;
  });
  return { instances, Pool };
});

vi.mock('pg', () => ({
  Pool: pgMocks.Pool,
}));

describe('db-client closePool', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPgDatabaseUrl = process.env.PGDATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    pgMocks.instances.length = 0;
    pgMocks.Pool.mockClear();
    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@localhost:5432/wujie_test';
    delete process.env.PGDATABASE_URL;
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalPgDatabaseUrl === undefined) delete process.env.PGDATABASE_URL;
    else process.env.PGDATABASE_URL = originalPgDatabaseUrl;
  });

  it('clears the cached Pool even when Pool.end rejects', async () => {
    const dbClient = await import('@/lib/db-client');
    const firstPool = dbClient.getPool();
    pgMocks.instances[0].end.mockRejectedValueOnce(
      new Error('injected Pool.end failure'),
    );

    await expect(dbClient.closePool()).rejects.toThrow(
      'injected Pool.end failure',
    );

    const secondPool = dbClient.getPool();
    expect(secondPool).not.toBe(firstPool);
    expect(pgMocks.Pool).toHaveBeenCalledTimes(2);
  });
});
