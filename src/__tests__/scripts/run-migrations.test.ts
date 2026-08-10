import { describe, expect, it } from 'vitest';

describe('migration runner connection contract', () => {
  it('normalizes sslmode=require with libpq compatibility before creating PostgreSQL clients', async () => {
    const runner = await import('../../../scripts/run-migrations.mjs');

    const connectionString = 'postgresql://user:pass@example.test:5432/db?sslmode=require';
    expect(runner.normalizePostgresConnectionString(connectionString)).toBe(
      'postgresql://user:pass@example.test:5432/db?sslmode=require&uselibpqcompat=true',
    );
    expect(runner.connectionOptions(connectionString).connectionString).toBe(
      'postgresql://user:pass@example.test:5432/db?sslmode=require&uselibpqcompat=true',
    );
  });
});
