import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withIsolatedPostgres } from '../helpers/postgres-test-database';

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

describe('stage 2 asset lifecycle PostgreSQL contract', () => {
  postgresIt('installs lifecycle audit storage so concurrent restore/trash/purge checks can share one transaction boundary', async () => {
    await withIsolatedPostgres('asset_lifecycle', async ({ databaseUrl, query }) => {
      const migration = resolve(process.cwd(), 'migrations/20260812_wj_stable_s2_asset_lifecycle.sql');
      const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
        cwd: process.cwd(), encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const source = await readFile(migration, 'utf8');
      expect(source).toContain('wujie_asset_media_recovery_attempts');
      const table = await query<{ exists: boolean }>(
        "SELECT to_regclass('wujie_asset_media_recovery_attempts') IS NOT NULL AS exists",
      );
      expect(table.rows[0]?.exists).toBe(true);
    });
  });
});
