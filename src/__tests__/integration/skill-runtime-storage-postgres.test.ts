import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const hasPostgresTestDatabase = Boolean(process.env.POSTGRES_TEST_DATABASE_URL?.trim());
const postgresIt = hasPostgresTestDatabase ? it : it.skip;

describe('skill runtime PostgreSQL CAS', () => {
  beforeAll(() => {
    if (!hasPostgresTestDatabase) {
      console.warn(
        '[BLOCKED] Unified Skill Runtime Task 3 PostgreSQL CAS was not verified: '
        + 'POSTGRES_TEST_DATABASE_URL is missing.',
      );
    }
  });

  postgresIt('allows only one writer for the same user_id, key, and revision', async () => {
    await withIsolatedPostgres('skill_runtime_storage_cas', async () => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const { loadUserSkillEnvelope, saveUserSkillEnvelope } = await import('@/lib/skill-runtime/storage');
      await ensureCoreTables();
      const userId = `skill-user-${randomUUID()}`;
      const empty = { schemaVersion: 1 as const, revision: 0, skills: [], migratedLegacyIds: [] };

      const writes = await Promise.allSettled([
        saveUserSkillEnvelope(userId, 0, empty),
        saveUserSkillEnvelope(userId, 0, empty),
      ]);

      expect(writes.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(await loadUserSkillEnvelope(userId)).toMatchObject({ revision: 1 });
    });
  }, 60_000);

  postgresIt('does not overwrite a damaged existing revision as revision zero', async () => {
    await withIsolatedPostgres('skill_runtime_storage_damaged_revision', async ({ query }) => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const { saveUserSkillEnvelope } = await import('@/lib/skill-runtime/storage');
      await ensureCoreTables();
      const userId = `skill-damaged-${randomUUID()}`;
      await query(
        `INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
         VALUES ($1, 'skill_catalog_v1', $2::jsonb, 1)`,
        [userId, JSON.stringify({ revision: '0', attacker: true })],
      );

      await expect(saveUserSkillEnvelope(userId, 0, {
        schemaVersion: 1,
        revision: 0,
        skills: [],
        migratedLegacyIds: [],
      })).rejects.toMatchObject({ code: 'SKILL_REVISION_CONFLICT' });
      const stored = await query<{ data_value: unknown }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = 'skill_catalog_v1'`,
        [userId],
      );
      expect(stored.rows[0]?.data_value).toEqual({ revision: '0', attacker: true });
    });
  }, 60_000);
});
