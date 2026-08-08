import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; authoritative task-state PostgreSQL tests skipped.',
  );
}

describe('authoritative PostgreSQL task state', () => {
  postgresIt('allows one concurrent completion and prevents terminal resurrection', async () => {
    const { withIsolatedPostgres } = await import(
      '../helpers/postgres-test-database'
    );

    await withIsolatedPostgres('task-state-terminals', async () => {
      const {
        createCloudTask,
        getCloudTaskById,
        updateCloudTask,
      } = await import('@/lib/cloud-task-storage');
      const { transitionTask } = await import('@/lib/task-core/task-service');

      const now = Date.now();
      await createCloudTask({
        id: 'concurrent-completion',
        userId: 'user-a',
        type: 'generate',
        status: 'processing',
        progress: 55,
        creditStatus: 'pending',
        createdAt: now,
        updatedAt: now,
        revision: 0,
      });

      const completions = await Promise.all([
        transitionTask({
          taskId: 'concurrent-completion',
          from: ['processing'],
          to: 'completed',
          revision: 0,
          result: { imageUrl: '/winner-a.png' },
        }),
        transitionTask({
          taskId: 'concurrent-completion',
          from: ['processing'],
          to: 'completed',
          revision: 0,
          result: { imageUrl: '/winner-b.png' },
        }),
      ]);

      expect(completions.filter((outcome) => outcome.transitioned)).toHaveLength(1);
      const completed = await getCloudTaskById('concurrent-completion');
      expect(completed).toMatchObject({
        status: 'completed',
        progress: 100,
        revision: 1,
      });

      for (const status of ['failed', 'cancelled', 'timeout'] as const) {
        await createCloudTask({
          id: `terminal-${status}`,
          userId: 'user-a',
          type: 'generate',
          status,
          progress: 0,
          creditStatus: 'pending',
          createdAt: now,
          updatedAt: now,
          revision: 3,
        });

        await expect(transitionTask({
          taskId: `terminal-${status}`,
          from: [status],
          to: 'completed',
          revision: 3,
        })).resolves.toMatchObject({
          transitioned: false,
          task: { status, revision: 3 },
        });
      }

      await expect(updateCloudTask('concurrent-completion', {
        label: 'late audit metadata',
      })).resolves.toBe(true);
      await expect(updateCloudTask('concurrent-completion', {
        progress: 50,
      })).resolves.toBe(false);
      await expect(updateCloudTask('concurrent-completion', {
        status: 'processing',
      })).resolves.toBe(false);

      expect(await getCloudTaskById('concurrent-completion')).toMatchObject({
        status: 'completed',
        label: 'late audit metadata',
      });

      await createCloudTask({
        id: 'legacy-pending',
        userId: 'user-a',
        type: 'generate',
        status: 'pending',
        progress: 0,
        creditStatus: 'pending',
        createdAt: now,
        updatedAt: now,
        revision: 0,
      });
      await expect(transitionTask({
        taskId: 'legacy-pending',
        from: ['submitting'],
        to: 'failed',
        revision: 0,
        error: { code: 'LEGACY_FAILURE', message: 'legacy task failed' },
      })).resolves.toMatchObject({
        transitioned: true,
        task: {
          status: 'failed',
          error: 'legacy task failed',
          revision: 1,
        },
      });
    });
  });
});
