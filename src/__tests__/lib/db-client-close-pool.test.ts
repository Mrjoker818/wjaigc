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

  afterEach(async () => {
    await (await import('@/lib/db-client')).closePool();
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it('logs only a stable code when a real execSql query catch rethrows', async () => {
    const dbClient = await import('@/lib/db-client');
    dbClient.getPool();
    const privateError = new Error(
      'postgresql://private-user:private-password@example.test user=private-name hash=scrypt-secret',
    );
    pgMocks.instances[0].query.mockRejectedValueOnce(privateError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(dbClient.execSql(
      'SELECT * FROM wujie_users WHERE name = $1',
      ['private-name'],
    )).rejects.toBe(privateError);

    expect(consoleError.mock.calls).toEqual([[{ code: 'DB_SQL_QUERY_FAILED' }]]);
    const serializedLogs = JSON.stringify(consoleError.mock.calls);
    expect(serializedLogs).not.toContain('private');
    expect(serializedLogs).not.toContain('scrypt');
    expect(serializedLogs).not.toContain('SELECT');
  });

  it('does not include a transient driver error in retry warnings', async () => {
    vi.useFakeTimers();
    const dbClient = await import('@/lib/db-client');
    const client = dbClient.getPool();
    const privateError = new Error(
      'Connection terminated postgresql://private-user:private-password@example.test',
    );
    pgMocks.instances[0].query
      .mockRejectedValueOnce(privateError)
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = dbClient.execSql('SELECT $1', ['private-value']);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ rows: [{ ok: true }], rowCount: 1 });

    expect(consoleWarn.mock.calls).toEqual([[
      { code: 'DB_SQL_TRANSIENT_RETRY', attempt: 1, maxAttempts: 3 },
    ]]);
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain('private');
    expect(client).toBe(pgMocks.instances[0]);
  });
});
