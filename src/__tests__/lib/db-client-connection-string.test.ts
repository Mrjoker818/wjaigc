import { describe, expect, it } from 'vitest';
import { normalizePostgresConnectionString } from '@/lib/db-client';

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
