import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
    await expect(runner.listMigrationFiles()).resolves.toContain(
      '20260821_wj_stable_s4_historical_media_remediations.sql',
    );
    await expect(runner.listMigrationFiles()).resolves.toContain(
      '20260823_v588_auth_credentials.sql',
    );
    expect(runner.migrationChecksum(Buffer.from('agent-events'))).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('keeps the V5.8.8 credential migration strictly additive', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'migrations', '20260823_v588_auth_credentials.sql'),
      'utf8',
    );
    const normalized = migration.trim().replace(/\s+/g, ' ');

    expect(normalized).toBe(
      'ALTER TABLE wujie_users ADD COLUMN IF NOT EXISTS credential_hash TEXT;',
    );
    expect(normalized).not.toMatch(/\b(?:DROP|RENAME|UPDATE|DELETE)\b/i);
    expect(normalized).not.toContain('password_hash');
  });
});
