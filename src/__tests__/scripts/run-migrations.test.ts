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

  it('bootstraps the core user table before applying credential migrations', async () => {
    const runner = await import('../../../scripts/run-migrations.mjs');
    const migrations = await runner.listMigrationFiles();
    const coreUsersIndex = migrations.indexOf('20260809_wj_core_users.sql');
    const credentialIndex = migrations.indexOf('20260823_v588_auth_credentials.sql');

    expect(coreUsersIndex).toBeGreaterThanOrEqual(0);
    expect(credentialIndex).toBeGreaterThan(coreUsersIndex);
  });

  it('migrates parent lineage to same-owner/project cross-Asset foreign keys', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'migrations', '20260909_mpe_cross_asset_parents.sql'),
      'utf8',
    );
    const normalized = migration.replace(/\s+/g, ' ');

    expect(normalized).toContain('DROP CONSTRAINT IF EXISTS wujie_asset_version_parents_parent_version_id_asset_id_owner_id_project_id_fkey');
    expect(normalized).toMatch(/FOREIGN KEY \(parent_version_id, owner_id, project_id\)/);
    expect(normalized).toMatch(/REFERENCES wujie_asset_versions\(id, owner_id, project_id\)/);
    expect(normalized.match(/ADD CONSTRAINT wujie_asset_version_parents_parent_scope_fk FOREIGN KEY \(([^)]+)\)/)?.[1])
      .toBe('parent_version_id, owner_id, project_id');
    expect(normalized).not.toMatch(/\b(?:DELETE|UPDATE|TRUNCATE)\b/i);

    const storage = await readFile(resolve(process.cwd(), 'src/lib/asset-core/storage.ts'), 'utf8');
    expect(storage).toMatch(/FROM wujie_asset_versions parent\s+WHERE parent\.id = \$5 AND parent\.owner_id = \$2 AND parent\.project_id = \$3/);
  });
});
