import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  countLegacyCredentialUsers,
  readSystemSettingStrict,
  resolveDatabaseSecretRing,
  updateUserCredentialSidecar,
} from '@/lib/auth/auth-repository';
import { closePool } from '@/lib/db-client';
import { dbUpsertUser, dbWriteUsers } from '@/lib/db-storage';
import {
  type QueryFn,
  withIsolatedPostgres,
} from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const primaryTestDatabaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const alternateTestDatabaseUrl = process.env.TEST_POSTGRES_URL?.trim();
const isolatedTestDatabaseUrl = primaryTestDatabaseUrl || alternateTestDatabaseUrl;
const postgresIt = isolatedTestDatabaseUrl ? it : it.skip;
const migrationPath = resolve(
  process.cwd(),
  'migrations',
  '20260823_v588_auth_credentials.sql',
);
const now = 1_724_601_600_000;
const legacySecret = 'legacy-integration-secret-0123456789abcdef';
const configuredSecret = 'configured-integration-secret-0123456789abcdef';
const credentialHash = [
  'scrypt-v1',
  '32768',
  '8',
  '1',
  Buffer.alloc(16, 3).toString('base64url'),
  Buffer.alloc(32, 4).toString('base64url'),
].join('$');

if (!isolatedTestDatabaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL and TEST_POSTGRES_URL are not configured; '
    + 'V5.8.8 authentication PostgreSQL integration tests skipped. '
    + 'DATABASE_URL and PGDATABASE_URL are intentionally never used as test targets.',
  );
}

async function withAuthPostgres<T>(
  testName: string,
  callback: Parameters<typeof withIsolatedPostgres<T>>[1],
): Promise<T> {
  const previous = process.env.POSTGRES_TEST_DATABASE_URL;
  if (!primaryTestDatabaseUrl && alternateTestDatabaseUrl) {
    process.env.POSTGRES_TEST_DATABASE_URL = alternateTestDatabaseUrl;
  }
  try {
    return await withIsolatedPostgres(testName, callback);
  } finally {
    if (previous === undefined) delete process.env.POSTGRES_TEST_DATABASE_URL;
    else process.env.POSTGRES_TEST_DATABASE_URL = previous;
  }
}

async function createAuthTables(
  query: Parameters<Parameters<typeof withIsolatedPostgres>[1]>[0]['query'],
): Promise<void> {
  await query(`
    CREATE TABLE wujie_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      credential_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      product_type TEXT,
      chat_models TEXT[],
      image_models TEXT[],
      daily_token_limit INTEGER,
      monthly_token_limit INTEGER,
      daily_image_limit INTEGER,
      avatar TEXT,
      nickname TEXT,
      api_permissions JSONB DEFAULT '{}',
      storage_folder TEXT DEFAULT '',
      email TEXT DEFAULT '',
      group_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await query(`
    CREATE TABLE wujie_system_settings (
      key TEXT PRIMARY KEY,
      value JSONB,
      updated_at BIGINT NOT NULL
    )
  `);
}

function withApplicationName(databaseUrl: string, applicationName: string): string {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set('application_name', applicationName);
  return parsed.toString();
}

interface ResolverBarrierFacts {
  active: number;
  blocked: number;
  advisory_holders: number;
  advisory_waiters: number;
}

async function waitForResolverBarrier(
  query: QueryFn,
  applicationName: string,
): Promise<ResolverBarrierFacts> {
  let latest: ResolverBarrierFacts | undefined;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await query<ResolverBarrierFacts>(
      `SELECT count(*)::int AS active,
              count(*) FILTER (
                WHERE cardinality(pg_blocking_pids(activity.pid)) > 0
              )::int AS blocked,
              count(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM pg_locks held
                  WHERE held.pid = activity.pid
                    AND held.locktype = 'advisory'
                    AND held.granted
                )
              )::int AS advisory_holders,
              count(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM pg_locks waiting
                  WHERE waiting.pid = activity.pid
                    AND waiting.locktype = 'advisory'
                    AND NOT waiting.granted
                )
              )::int AS advisory_waiters
       FROM pg_stat_activity activity
       WHERE activity.datname = current_database()
         AND activity.application_name = $1`,
      [applicationName],
    );
    latest = result.rows[0];
    if (latest
      && latest.active >= 5
      && latest.blocked >= 5
      && latest.advisory_holders === 1
      && latest.advisory_waiters >= 1) {
      return latest;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error(
    `authentication resolver advisory-lock readiness not observed: ${JSON.stringify(latest)}`,
  );
}

describe('V5.8.8 authentication repository on real isolated PostgreSQL', () => {
  postgresIt('applies only the nullable additive sidecar migration', async () => {
    await withAuthPostgres('v588-auth-migration', async ({ query }) => {
      await query(`
        CREATE TABLE wujie_users (
          id TEXT PRIMARY KEY,
          password_hash TEXT NOT NULL,
          marker TEXT NOT NULL
        )
      `);
      await query(
        'INSERT INTO wujie_users(id, password_hash, marker) VALUES ($1, $2, $3)',
        ['preserved-user', 'preserved-password-hash', 'preserved-marker'],
      );
      const migration = await readFile(migrationPath, 'utf8');

      await query(migration);
      await query(migration);

      const columns = await query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'wujie_users'
         ORDER BY ordinal_position`,
      );
      const row = await query(
        'SELECT id, password_hash, credential_hash, marker FROM wujie_users',
      );
      expect(columns.rows).toEqual([
        { column_name: 'id', is_nullable: 'NO' },
        { column_name: 'password_hash', is_nullable: 'NO' },
        { column_name: 'marker', is_nullable: 'NO' },
        { column_name: 'credential_hash', is_nullable: 'YES' },
      ]);
      expect(row.rows).toEqual([{
        id: 'preserved-user',
        password_hash: 'preserved-password-hash',
        credential_hash: null,
        marker: 'preserved-marker',
      }]);
    });
  });

  postgresIt('serializes twenty ring resolvers to one compatible active/previous result', async () => {
    await withAuthPostgres('v588-auth-ring-concurrency', async ({ databaseUrl, query }) => {
      await createAuthTables(query);
      await query(
        'INSERT INTO wujie_system_settings(key, value, updated_at) VALUES ($1, $2::jsonb, $3)',
        ['auth_secret', JSON.stringify(legacySecret), now - 1],
      );
      await query(
        `INSERT INTO wujie_users(
           id, name, password_hash, role, status, created_at, updated_at
         ) VALUES ($1, $2, $3, 'user', 'active', $4, $4)`,
        ['legacy-user', 'Legacy User', 'a'.repeat(64), now],
      );
      const applicationName = `v588_auth_resolver_${randomUUID()}`;
      const businessDatabaseUrl = withApplicationName(databaseUrl, applicationName);
      await closePool();
      process.env.DATABASE_URL = businessDatabaseUrl;
      process.env.PGDATABASE_URL = businessDatabaseUrl;

      let controllerTransactionOpen = false;
      let resolverPromise: Promise<Awaited<ReturnType<typeof resolveDatabaseSecretRing>>[]> | undefined;
      try {
        await query('BEGIN');
        controllerTransactionOpen = true;
        await query('LOCK TABLE wujie_system_settings IN ACCESS EXCLUSIVE MODE');

        let started = 0;
        const callerTimes = Array.from({ length: 20 }, (_, index) => now + index + 1);
        resolverPromise = Promise.all(callerTimes.map(callerNow => {
          started += 1;
          return resolveDatabaseSecretRing({ configuredSecret, now: callerNow });
        }));
        expect(started).toBe(20);

        const barrier = await waitForResolverBarrier(query, applicationName);
        expect(barrier).toMatchObject({
          active: 5,
          blocked: 5,
          advisory_holders: 1,
        });
        expect(barrier.advisory_waiters).toBeGreaterThanOrEqual(1);

        await query('COMMIT');
        controllerTransactionOpen = false;
        const rings = await resolverPromise;
        const stored = await query<{ value: Awaited<ReturnType<typeof resolveDatabaseSecretRing>> }>(
          'SELECT value FROM wujie_system_settings WHERE key = $1',
          ['auth_secret_ring_v1'],
        );
        const persistedRing = stored.rows[0]?.value;

        expect(persistedRing).toBeDefined();
        expect(callerTimes).toContain(persistedRing?.updatedAt);
        expect(rings).toEqual(Array.from({ length: 20 }, () => persistedRing));
        expect(new Set(rings.map(ring => ring.updatedAt)).size).toBe(1);
        expect(persistedRing?.active.secret).toBe(configuredSecret);
        expect(persistedRing?.previous?.secret).toBe(legacySecret);
      } finally {
        if (controllerTransactionOpen) await query('ROLLBACK').catch(() => undefined);
        await resolverPromise?.catch(() => undefined);
      }
    });
  }, 30_000);

  postgresIt('fails a database read without creating a random or partial ring', async () => {
    await withAuthPostgres('v588-auth-read-failure', async ({ query }) => {
      await query(`
        CREATE TABLE auth_settings_backing (
          key TEXT PRIMARY KEY,
          value JSONB,
          updated_at BIGINT NOT NULL
        )
      `);
      await query(
        'INSERT INTO auth_settings_backing(key, value, updated_at) VALUES ($1, $2::jsonb, $3)',
        ['auth_secret', JSON.stringify(legacySecret), now],
      );
      await query(`
        CREATE VIEW wujie_system_settings AS
        SELECT key, to_jsonb(1 / (length(key) - length(key))) AS value, updated_at
        FROM auth_settings_backing
      `);

      await expect(resolveDatabaseSecretRing({ configuredSecret, now })).rejects.toMatchObject({
        code: 'AUTH_PERSISTENCE_UNAVAILABLE',
      });

      const backing = await query('SELECT key, value FROM auth_settings_backing ORDER BY key');
      expect(backing.rows).toEqual([{ key: 'auth_secret', value: legacySecret }]);
    });
  });

  postgresIt('updates only a null sidecar and reports non-disclosing outcomes', async () => {
    await withAuthPostgres('v588-auth-sidecar', async ({ query }) => {
      await createAuthTables(query);
      await query(
        `INSERT INTO wujie_users(
           id, name, password_hash, role, status, product_type, chat_models,
           image_models, daily_token_limit, monthly_token_limit, daily_image_limit,
           avatar, nickname, api_permissions, storage_folder, email, group_id,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, 11, 22, 33,
           $9, $10, $11::jsonb, $12, $13, $14, $15, $15
         )`,
        [
          'sidecar-user', 'Sidecar User', 'b'.repeat(64), 'admin', 'disabled',
          'canvas', ['chat-a'], ['image-a'], 'avatar.png', 'Nickname',
          JSON.stringify({ image: true }), 'folder-a', 'user@example.test',
          'group-a', now,
        ],
      );
      const before = await query(
        'SELECT * FROM wujie_users WHERE id = $1',
        ['sidecar-user'],
      );

      await expect(updateUserCredentialSidecar('sidecar-user', credentialHash)).resolves.toBe('updated');
      await expect(updateUserCredentialSidecar('sidecar-user', credentialHash)).resolves.toBe('already-set');
      await expect(updateUserCredentialSidecar('missing-user', credentialHash)).resolves.toBe('user-missing');

      const after = await query(
        'SELECT * FROM wujie_users WHERE id = $1',
        ['sidecar-user'],
      );
      expect(after.rows[0]).toEqual({
        ...before.rows[0],
        credential_hash: credentialHash,
        updated_at: expect.any(String),
      });
      expect(Number(after.rows[0]?.updated_at)).toBeGreaterThanOrEqual(now);
    });
  });

  postgresIt('preserves the sidecar during a stable-style UPSERT and counts all legacy rows', async () => {
    await withAuthPostgres('v588-auth-stable-upsert', async ({ query }) => {
      await createAuthTables(query);
      await query(
        `INSERT INTO wujie_users(
           id, name, password_hash, credential_hash, role, status, created_at, updated_at
         ) VALUES
           ($1, $2, $3, $4, 'user', 'active', $5, $5),
           ($6, $7, $3, $4, 'user', 'active', $5, $5)`,
        [
          'stable-user', 'Stable User', 'c'.repeat(64), credentialHash, now,
          'direct-upsert-user', 'Direct Upsert User',
        ],
      );
      await query(
        `INSERT INTO wujie_users(
           id, name, password_hash, credential_hash, role, status, created_at, updated_at
         ) VALUES
           ('legacy-a', 'Legacy A', $1, NULL, 'user', 'active', $2, $2),
           ('legacy-b', 'Legacy B', $1, NULL, 'user', 'active', $2, $2),
           ('empty-password', 'Empty', '', NULL, 'user', 'active', $2, $2)`,
        ['d'.repeat(64), now],
      );

      await expect(dbWriteUsers([{
        id: 'stable-user',
        name: 'Stable User Updated',
        passwordHash: 'e'.repeat(64),
        role: 'admin',
        status: 'disabled',
        apiPermissions: { image: true },
        storageFolder: 'stable-folder',
        createdAt: now,
        updatedAt: now + 1,
      }])).resolves.toBe(true);
      await expect(dbUpsertUser({
        id: 'direct-upsert-user',
        name: 'Direct Upsert User Updated',
        password_hash: 'f'.repeat(64),
        role: 'admin',
        status: 'disabled',
        api_permissions: { image: true },
        storage_folder: 'direct-upsert-folder',
        created_at: now,
        updated_at: now + 1,
      })).resolves.toBe(true);

      const rows = await query<{ id: string; credential_hash: string }>(
        `SELECT id, credential_hash
         FROM wujie_users
         WHERE id = ANY($1::text[])
         ORDER BY id`,
        [['stable-user', 'direct-upsert-user']],
      );
      expect(rows.rows).toEqual([
        { id: 'direct-upsert-user', credential_hash: credentialHash },
        { id: 'stable-user', credential_hash: credentialHash },
      ]);
      await expect(countLegacyCredentialUsers()).resolves.toBe(2);
    });
  });

  postgresIt('rolls back a rejected ring UPSERT without changing the legacy setting', async () => {
    await withAuthPostgres('v588-auth-ring-rollback', async ({ query }) => {
      await query(`
        CREATE TABLE wujie_users (
          id TEXT PRIMARY KEY,
          password_hash TEXT NOT NULL,
          credential_hash TEXT
        )
      `);
      await query('CREATE SEQUENCE auth_repository_write_attempts');
      await query('CREATE TABLE auth_repository_faults(enabled BOOLEAN NOT NULL)');
      await query('INSERT INTO auth_repository_faults(enabled) VALUES (TRUE)');
      await query(`
        CREATE FUNCTION allow_auth_ring_write(candidate_key TEXT)
        RETURNS BOOLEAN
        LANGUAGE plpgsql
        VOLATILE
        AS $$
        DECLARE
          fault_enabled BOOLEAN;
        BEGIN
          IF candidate_key = 'auth_secret_ring_v1' THEN
            PERFORM nextval('auth_repository_write_attempts');
          END IF;
          SELECT enabled INTO fault_enabled FROM auth_repository_faults LIMIT 1;
          RETURN NOT (candidate_key = 'auth_secret_ring_v1' AND fault_enabled);
        END;
        $$
      `);
      await query(`
        CREATE TABLE wujie_system_settings (
          key TEXT PRIMARY KEY,
          value JSONB,
          updated_at BIGINT NOT NULL,
          CONSTRAINT reject_auth_ring_write CHECK (allow_auth_ring_write(key))
        )
      `);
      await query(
        'INSERT INTO wujie_system_settings(key, value, updated_at) VALUES ($1, $2::jsonb, $3)',
        ['auth_secret', JSON.stringify(legacySecret), now - 1],
      );

      await expect(resolveDatabaseSecretRing({ configuredSecret, now })).rejects.toMatchObject({
        code: 'AUTH_PERSISTENCE_UNAVAILABLE',
      });

      const attempts = await query<{ attempts: number }>(
        'SELECT last_value::int AS attempts FROM auth_repository_write_attempts',
      );
      expect(attempts.rows).toEqual([{ attempts: 1 }]);
      await query('UPDATE auth_repository_faults SET enabled = FALSE');
      await expect(readSystemSettingStrict('auth_secret_ring_v1')).resolves.toEqual({ found: false });

      const rows = await query('SELECT key, value, updated_at FROM wujie_system_settings');
      expect(rows.rows).toEqual([{
        key: 'auth_secret',
        value: legacySecret,
        updated_at: String(now - 1),
      }]);
    });
  });
});
