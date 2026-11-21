import { expect, it, vi } from 'vitest';
import { scopeOfflineDatabaseEnvironment } from './isolated-child-database-env';

it('clears the existing offline guard bindings from a synthetic environment', () => {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'synthetic-database', PGDATABASE_URL: 'synthetic-pg',
    POSTGRES_TEST_DATABASE_URL: 'synthetic-postgres-test', TEST_POSTGRES_URL: '',
    PGHOST: 'synthetic-host', COZE_SUPABASE_URL: 'synthetic-http',
    WUJIE_DEPLOYMENT_DB_ONLY: '1', WUJIE_AUTH_PERSISTENCE_MODE: 'DB_ONLY',
    KEEP: 'unrelated',
  };
  const restore = scopeOfflineDatabaseEnvironment(environment);
  try {
    expect(environment).toEqual({ NODE_ENV: 'test', KEEP: 'unrelated' });
  } finally {
    restore();
  }
});

it('restores exact original values and removes bindings introduced inside the scope', () => {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'synthetic-original', PGDATABASE_URL: '', KEEP: 'before',
  };
  const restore = scopeOfflineDatabaseEnvironment(environment);
  environment.DATABASE_URL = 'synthetic-changed';
  environment.POSTGRES_TEST_DATABASE_URL = 'synthetic-added';
  environment.WUJIE_AUTH_PERSISTENCE_MODE = 'DB_ONLY';
  environment.KEEP = 'after';
  restore();
  const expected = { NODE_ENV: 'test', DATABASE_URL: 'synthetic-original', PGDATABASE_URL: '', KEEP: 'after' };
  expect(environment).toEqual(expected);
  restore();
  expect(environment).toEqual(expected);
});

it('keeps the outer bindings cleared when a case calls vi.unstubAllEnvs', () => {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'synthetic-outer', PGDATABASE_URL: '', KEEP: 'unrelated',
  };
  const original = { ...environment };
  const restore = scopeOfflineDatabaseEnvironment(environment);
  let duringCase: NodeJS.ProcessEnv | undefined;
  let afterUnstub: NodeJS.ProcessEnv | undefined;
  try {
    try {
      // Only Vitest's synchronous env utilities see this synthetic process object.
      // No real process.env values are read or changed, and no assertion runs until it is restored.
      vi.stubGlobal('process', { env: environment });
      vi.stubEnv('WUJIE_AUTH_PERSISTENCE_MODE', 'DB_ONLY');
      vi.stubEnv('DATABASE_URL', 'synthetic-case');
      duringCase = { ...environment };
      vi.unstubAllEnvs();
      afterUnstub = { ...environment };
    } finally {
      try {
        vi.unstubAllEnvs();
      } finally {
        vi.unstubAllGlobals();
      }
    }
    expect(duringCase).toEqual({
      NODE_ENV: 'test', KEEP: 'unrelated', WUJIE_AUTH_PERSISTENCE_MODE: 'DB_ONLY', DATABASE_URL: 'synthetic-case',
    });
    expect(afterUnstub).toEqual({ NODE_ENV: 'test', KEEP: 'unrelated' });
    expect(environment).toEqual({ NODE_ENV: 'test', KEEP: 'unrelated' });
  } finally {
    restore();
  }
  expect(environment).toEqual(original);
});
