import { describe, expect, it } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

const dedicatedUrl = 'postgresql://postgres@127.0.0.1:55492/wujie_bridge_test_20260928';

function environment(url: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: url,
    PGDATABASE_URL: url,
    POSTGRES_TEST_DATABASE_URL: url,
    TEST_POSTGRES_URL: url,
  };
}

describe('offline bridge database guard', () => {
  it('accepts a newly named loopback bridge test database with matching aliases', () => {
    expect(requireOfflineBridgeTestDatabaseUrl(environment(dedicatedUrl))).toBe(dedicatedUrl);
  });

  it('accepts the fresh isolated suite database instead of requiring a historical port and name', () => {
    const url = 'postgresql://postgres@127.0.0.1:55496/wujie_bridge_test_batch_20261005';
    expect(requireOfflineBridgeTestDatabaseUrl(environment(url))).toBe(url);
  });

  it.each([
    'postgresql://postgres@127.0.0.1:55492/postgres',
    'postgresql://postgres@127.0.0.1:55492/wujie_yjs_task8cb3i2_20260927',
    'postgresql://postgres@db.example.invalid:55492/wujie_bridge_test_20260928',
    'postgresql://postgres@127.0.0.1/wujie_bridge_test_20260928',
    'postgresql://postgres@127.0.0.1:55492/wujie_bridge_test_20260928?options=-csearch_path%3Dpublic',
    'postgresql://postgres@127.0.0.1:55432/wujie',
    'postgres://postgres@127.0.0.1:55496/wujie_bridge_test_batch_20261005',
    'postgresql://postgres@localhost:55496/wujie_bridge_test_batch_20261005',
    'postgresql://postgres@127.0.0.1:543/wujie_bridge_test_batch_20261005',
    'postgresql://postgres@127.0.0.1:55496/wujie_bridge_test_batch_20261005#public',
  ])('rejects a database target outside the dedicated bridge test boundary: %s', (url) => {
    expect(() => requireOfflineBridgeTestDatabaseUrl(environment(url))).toThrow();
  });

  it('rejects an alias that could send migrations to a different database', () => {
    const env = environment(dedicatedUrl);
    env.PGDATABASE_URL = 'postgresql://postgres@127.0.0.1:55492/postgres';
    expect(() => requireOfflineBridgeTestDatabaseUrl(env)).toThrow();
  });

  it.each(['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL'] as const)(
    'rejects a missing %s alias before creating any database connection', key => {
      const env = environment(dedicatedUrl);
      delete env[key];
      expect(() => requireOfflineBridgeTestDatabaseUrl(env)).toThrow();
    },
  );

  it('rejects a missing test URL before any database operation', () => {
    const env = environment(dedicatedUrl);
    delete env.POSTGRES_TEST_DATABASE_URL;
    expect(() => requireOfflineBridgeTestDatabaseUrl(env)).toThrow();
  });
});
