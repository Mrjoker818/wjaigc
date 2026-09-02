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
});
