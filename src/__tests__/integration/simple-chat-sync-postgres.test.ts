import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { project } from '@/__tests__/fixtures/simple-chat-sync';
import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const hasPostgresTestDatabase = Boolean(process.env.POSTGRES_TEST_DATABASE_URL?.trim());
const postgresIt = hasPostgresTestDatabase ? it : it.skip;

describe('simple chat snapshot PostgreSQL CAS', () => {
  beforeAll(() => {
    if (!hasPostgresTestDatabase) {
      console.warn(
        '[BLOCKED] V588-CHAT-003 Task 3 real PostgreSQL concurrency was not verified: '
        + 'POSTGRES_TEST_DATABASE_URL is missing.',
      );
    }
  });

  postgresIt('allows only one writer for the same revision', async () => {
    await withIsolatedPostgres('simple_chat_snapshot_cas', async () => {
      const { ensureCoreTables } = await import('@/lib/db-storage');
      const {
        compareAndSetSimpleChatSnapshot,
        readSimpleChatSnapshot,
        SimpleChatSyncConflictError,
      } = await import('@/lib/simple-chat-sync-server');
      await ensureCoreTables();

      const userId = `simple-chat-${randomUUID()}`;
      const [first, second] = await Promise.allSettled([
        compareAndSetSimpleChatSnapshot({
          userId,
          expectedRevision: 0,
          projects: [project('a')],
        }),
        compareAndSetSimpleChatSnapshot({
          userId,
          expectedRevision: 0,
          projects: [project('b')],
        }),
      ]);

      expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = first.status === 'rejected' ? first.reason : second.status === 'rejected' ? second.reason : null;
      expect(rejected).toBeInstanceOf(SimpleChatSyncConflictError);
      expect(rejected).toMatchObject({ currentRevision: 1 });

      const snapshot = await readSimpleChatSnapshot(userId);
      expect(snapshot.revision).toBe(1);
      expect(snapshot.projects).toHaveLength(1);
      expect(['a', 'b']).toContain(snapshot.projects[0]?.id);

      await expect(readSimpleChatSnapshot(`${userId}-other`)).resolves.toEqual({
        schemaVersion: 1,
        revision: 0,
        projects: [],
      });
    });
  }, 60_000);
});
