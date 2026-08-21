import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withIsolatedPostgres } from '../helpers/postgres-test-database';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;
const migrationVersion = '20260821_wj_stable_s4_historical_media_remediations.sql';
const migrationPath = resolve(process.cwd(), 'migrations', migrationVersion);

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; historical media remediation PostgreSQL tests skipped.',
  );
}

function runMigrations(isolatedDatabaseUrl: string): void {
  const result = spawnSync(
    process.execPath,
    [resolve(process.cwd(), 'scripts/run-migrations.mjs')],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: isolatedDatabaseUrl,
        PGDATABASE_URL: isolatedDatabaseUrl,
      },
    },
  );
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

describe('historical media remediation ledger on real PostgreSQL', () => {
  postgresIt('applies the immutable remediation ledger once with an exact checksum', async () => {
    await withIsolatedPostgres('historical-media-ledger', async ({ databaseUrl: isolatedUrl, query }) => {
      runMigrations(isolatedUrl);
      runMigrations(isolatedUrl);

      const columns = await query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'wujie_asset_media_remediations'
         ORDER BY ordinal_position`,
      );
      expect(columns.rows.map(row => row.column_name)).toEqual([
        'id',
        'actor_user_id',
        'idempotency_key',
        'request_digest',
        'action',
        'reason',
        'before_state',
        'result',
        'status',
        'created_at',
        'completed_at',
      ]);

      const checksum = createHash('sha256').update(await readFile(migrationPath)).digest('hex');
      await expect(query(
        'SELECT checksum FROM wujie_schema_migrations WHERE version = $1',
        [migrationVersion],
      )).resolves.toMatchObject({ rows: [{ checksum }] });

      const actorUserId = randomUUID();
      const idempotencyKey = randomUUID();
      const row = [
        randomUUID(),
        actorUserId,
        idempotencyKey,
        'a'.repeat(64),
        'archive-unrecoverable',
        'historical media cannot be recovered',
        JSON.stringify({ availability: 'unrecoverable' }),
        JSON.stringify({ archive: 'recorded' }),
        'completed',
      ];
      const insert = `INSERT INTO wujie_asset_media_remediations(
        id, actor_user_id, idempotency_key, request_digest, action,
        reason, before_state, result, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`;
      await query(insert, row);
      await expect(query(insert, [randomUUID(), ...row.slice(1)])).rejects.toThrow();

      await expect(query(insert, [
        randomUUID(), randomUUID(), randomUUID(), 'b'.repeat(64), 'archive-recoverable',
        'invalid action', '{}', '{}', 'completed',
      ])).rejects.toThrow();
      await expect(query(insert, [
        randomUUID(), randomUUID(), randomUUID(), 'c'.repeat(64), 'archive-unrecoverable',
        'invalid status', '{}', '{}', 'pending',
      ])).rejects.toThrow();
      await expect(query(insert, [
        randomUUID(), randomUUID(), randomUUID(), 'not-a-digest', 'archive-unrecoverable',
        'invalid digest', '{}', '{}', 'completed',
      ])).rejects.toThrow();
    });
  });
});
