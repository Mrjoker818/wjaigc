import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isDatabaseConfigured,
  normalizePostgresConnectionString,
  resolveDatabaseConnectionString,
} from '@/lib/db-client';

const originalEnv = { ...process.env };

function stageEnv(patch: Record<string, string | undefined>): void {
  vi.stubEnv('DATABASE_URL', patch.DATABASE_URL);
  vi.stubEnv('PGDATABASE_URL', patch.PGDATABASE_URL);
  vi.stubEnv('PGHOST', patch.PGHOST);
  vi.stubEnv('PGPORT', patch.PGPORT);
  vi.stubEnv('PGDATABASE', patch.PGDATABASE);
  vi.stubEnv('PGUSER', patch.PGUSER);
  vi.stubEnv('PGPASSWORD', patch.PGPASSWORD);
  vi.stubEnv('COZE_SUPABASE_URL', patch.COZE_SUPABASE_URL);
  vi.stubEnv('COZE_SUPABASE_SERVICE_ROLE_KEY', patch.COZE_SUPABASE_SERVICE_ROLE_KEY);
  vi.stubEnv('COZE_SUPABASE_ANON_KEY', patch.COZE_SUPABASE_ANON_KEY);
}

const CLEAN: Record<string, undefined> = {
  DATABASE_URL: undefined, PGDATABASE_URL: undefined,
  PGHOST: undefined, PGPORT: undefined, PGDATABASE: undefined, PGUSER: undefined, PGPASSWORD: undefined,
  COZE_SUPABASE_URL: undefined, COZE_SUPABASE_SERVICE_ROLE_KEY: undefined, COZE_SUPABASE_ANON_KEY: undefined,
};

describe('PostgreSQL connection string normalization', () => {
  it('opts into libpq require semantics without rewriting the supplied URL', () => {
    expect(normalizePostgresConnectionString(
      'postgresql://user:pass@example.test:5432/db?sslmode=require',
    )).toBe(
      'postgresql://user:pass@example.test:5432/db?sslmode=require&uselibpqcompat=true',
    );
  });

  it('does not duplicate an explicit compatibility setting', () => {
    const connectionString = 'postgresql://example.test/db?uselibpqcompat=true&sslmode=require';
    expect(normalizePostgresConnectionString(connectionString)).toBe(connectionString);
  });

  it('leaves non-require SSL modes unchanged', () => {
    const connectionString = 'postgresql://example.test/db?sslmode=verify-full';
    expect(normalizePostgresConnectionString(connectionString)).toBe(connectionString);
  });
});

describe('database binding resolution (three injection forms)', () => {
  beforeEach(() => stageEnv(CLEAN));
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
  });

  it('prefers the canonical URL over split variables', () => {
    stageEnv({
      ...CLEAN,
      DATABASE_URL: 'postgresql://url-owner@url-host/url-db',
      PGHOST: 'split-host', PGDATABASE: 'split-db', PGUSER: 'split-user',
    });
    expect(resolveDatabaseConnectionString()).toContain('url-host');
    expect(isDatabaseConfigured()).toBe(true);
  });

  it('assembles a connection string from libpq split variables when no URL is set', () => {
    stageEnv({
      ...CLEAN,
      PGHOST: 'split-host', PGPORT: '5433', PGDATABASE: 'split-db', PGUSER: 'split-user', PGPASSWORD: 'p@w',
    });
    const resolved = resolveDatabaseConnectionString()!;
    expect(resolved).toContain('split-host:5433');
    expect(resolved).toContain('/split-db');
    expect(resolved).toContain('split-user');
    expect(resolved).toContain('p%40w');
    expect(isDatabaseConfigured()).toBe(true);
  });

  it('treats an incomplete split-variable set as unbound for connection purposes', () => {
    stageEnv({ ...CLEAN, PGHOST: 'host-only' });
    expect(resolveDatabaseConnectionString()).toBeUndefined();
    expect(isDatabaseConfigured()).toBe(false);
  });

  it('recognizes a COZE_SUPABASE_* integration as a binding signal without a pg source', () => {
    stageEnv({
      ...CLEAN,
      COZE_SUPABASE_URL: 'https://example.supabase.co',
      COZE_SUPABASE_SERVICE_ROLE_KEY: 'sb-secret',
    });
    expect(resolveDatabaseConnectionString()).toBeUndefined();
    expect(isDatabaseConfigured()).toBe(true);
  });

  it('reports unbound when nothing is injected', () => {
    stageEnv(CLEAN);
    expect(resolveDatabaseConnectionString()).toBeUndefined();
    expect(isDatabaseConfigured()).toBe(false);
  });
});