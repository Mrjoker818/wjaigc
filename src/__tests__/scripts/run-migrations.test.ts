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

  it('exports the checksum-managed migration inventory used by doctor checks', async () => {
    const runner = await import('../../../scripts/run-migrations.mjs');

    await expect(runner.listMigrationFiles()).resolves.toContain(
      '20260816_wj_stable_s4_agent_events.sql',
    );
    await expect(runner.listMigrationFiles()).resolves.toContain(
      '20260821_v588_admin_thumbnail_variants.sql',
    );
    expect(runner.migrationChecksum(Buffer.from('agent-events'))).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});
