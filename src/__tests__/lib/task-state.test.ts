import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCloudTaskById,
  transitionCloudTaskStatus,
  updateCloudTask,
  updateTaskProgress,
} = vi.hoisted(() => ({
  getCloudTaskById: vi.fn(),
  transitionCloudTaskStatus: vi.fn(),
  updateCloudTask: vi.fn(),
  updateTaskProgress: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskById,
  transitionCloudTaskStatus,
  updateCloudTask,
}));

vi.mock('@/lib/task-registry', () => ({
  updateTaskProgress,
}));

import {
  DURABLE_TASK_STATUSES,
  canTransitionTaskStatus,
  normalizeDurableTaskStatus,
  type DurableTaskStatus,
} from '@/lib/task-core/task-state';
import {
  getTaskResultImageUrls,
  publishDurableDirectTask,
  TaskNotFoundError,
  transitionTask,
} from '@/lib/task-core/task-service';

function cloudTask(status: DurableTaskStatus, revision = 0) {
  return {
    id: `task-${status}`,
    userId: 'user-a',
    type: 'generate',
    status,
    progress: status === 'completed' ? 100 : 25,
    creditStatus: 'pending' as const,
    createdAt: 100,
    updatedAt: 200,
    revision,
  };
}

describe('durable task state', () => {
  beforeEach(() => {
    getCloudTaskById.mockReset();
    transitionCloudTaskStatus.mockReset();
    updateCloudTask.mockReset();
    updateTaskProgress.mockReset();
  });

  it('declares every durable task status explicitly', () => {
    expect(DURABLE_TASK_STATUSES).toEqual([
      'created',
      'queued',
      'submitting',
      'processing',
      'uploading',
      'completed',
      'failed',
      'cancelled',
      'timeout',
    ]);
  });

  const allowedEdges: Array<[DurableTaskStatus, DurableTaskStatus]> = [
    ['created', 'queued'],
    ['created', 'failed'],
    ['created', 'cancelled'],
    ['created', 'timeout'],
    ['queued', 'submitting'],
    ['queued', 'processing'],
    ['queued', 'failed'],
    ['queued', 'cancelled'],
    ['queued', 'timeout'],
    ['submitting', 'processing'],
    ['submitting', 'failed'],
    ['submitting', 'cancelled'],
    ['submitting', 'timeout'],
    ['processing', 'uploading'],
    ['processing', 'completed'],
    ['processing', 'failed'],
    ['processing', 'cancelled'],
    ['processing', 'timeout'],
    ['uploading', 'processing'],
    ['uploading', 'failed'],
    ['uploading', 'cancelled'],
    ['uploading', 'timeout'],
  ];
  const allowedEdgeKeys = new Set(
    allowedEdges.map(([from, to]) => `${from}->${to}`),
  );

  it.each(allowedEdges)('allows the explicit edge %s -> %s', (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(true);
  });

  it.each(
    DURABLE_TASK_STATUSES.flatMap((from) =>
      DURABLE_TASK_STATUSES
        .filter((to) => !allowedEdgeKeys.has(`${from}->${to}`))
        .map((to) => [from, to] as const)
    ),
  )('rejects the undeclared edge %s -> %s', (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(false);
  });

  it('normalizes the legacy pending status without removing compatibility', () => {
    expect(normalizeDurableTaskStatus('pending')).toBe('submitting');
  });

  it.each<DurableTaskStatus>(['failed', 'cancelled', 'timeout'])(
    'does not write or project an attempted resurrection from %s',
    async (status) => {
      const current = cloudTask(status, 7);
      getCloudTaskById.mockResolvedValue(current);

      const outcome = await transitionTask({
        taskId: current.id,
        from: [status],
        to: 'completed',
        result: { imageUrl: '/should-not-win.png' },
      });

      expect(outcome).toMatchObject({
        transitioned: false,
        task: { status, revision: 7 },
      });
      expect(transitionCloudTaskStatus).not.toHaveBeenCalled();
      expect(updateTaskProgress).not.toHaveBeenCalled();
    },
  );

  it('uses the persisted revision and projects only after PostgreSQL wins', async () => {
    const calls: string[] = [];
    const current = cloudTask('processing', 4);
    const completed = {
      ...current,
      status: 'completed' as const,
      progress: 100,
      result: { imageUrl: '/result.png' },
      revision: 5,
    };
    getCloudTaskById.mockResolvedValue(current);
    transitionCloudTaskStatus.mockImplementation(async () => {
      calls.push('database');
      return { transitioned: true, task: completed };
    });
    updateTaskProgress.mockImplementation(() => {
      calls.push('projection');
    });

    const outcome = await transitionTask({
      taskId: current.id,
      from: ['processing'],
      to: 'completed',
      result: completed.result,
    });

    expect(transitionCloudTaskStatus).toHaveBeenCalledWith({
      taskId: current.id,
      from: ['processing'],
      to: 'completed',
      revision: 4,
      result: completed.result,
      error: undefined,
    });
    expect(outcome).toEqual({ transitioned: true, task: completed });
    expect(calls).toEqual(['database', 'projection']);
    expect(updateTaskProgress).toHaveBeenCalledWith(current.id, {
      status: 'completed',
      progress: 100,
      result: completed.result,
      error: undefined,
    });
  });

  it('does not update the in-memory projection when a concurrent writer wins', async () => {
    const current = cloudTask('processing', 11);
    const winner = {
      ...current,
      status: 'completed' as const,
      progress: 100,
      revision: 12,
    };
    getCloudTaskById.mockResolvedValue(current);
    transitionCloudTaskStatus.mockResolvedValue({
      transitioned: false,
      task: winner,
    });

    const outcome = await transitionTask({
      taskId: current.id,
      from: ['processing'],
      to: 'completed',
      revision: 11,
    });

    expect(outcome).toEqual({ transitioned: false, task: winner });
    expect(updateTaskProgress).not.toHaveBeenCalled();
  });

  it('throws a dedicated not-found error when the task does not exist', async () => {
    getCloudTaskById.mockResolvedValue(null);

    await expect(transitionTask({
      taskId: 'missing-task',
      from: ['processing'],
      to: 'completed',
    })).rejects.toEqual(expect.objectContaining({
      name: 'TaskNotFoundError',
      code: 'TASK_NOT_FOUND',
      taskId: 'missing-task',
    }));
    await expect(transitionTask({
      taskId: 'missing-task',
      from: ['processing'],
      to: 'completed',
    })).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it('uses the same dedicated error when the task disappears after CAS loss', async () => {
    const current = cloudTask('processing', 13);
    getCloudTaskById.mockResolvedValue(current);
    transitionCloudTaskStatus.mockResolvedValue({
      transitioned: false,
      task: null,
    });

    await expect(transitionTask({
      taskId: current.id,
      from: ['processing'],
      to: 'completed',
      revision: 13,
    })).rejects.toEqual(expect.objectContaining({
      name: 'TaskNotFoundError',
      code: 'TASK_NOT_FOUND',
      taskId: current.id,
    }));
    expect(updateTaskProgress).not.toHaveBeenCalled();
  });

  describe('durable direct task publication', () => {
    const completedTask = {
      ...cloudTask('completed', 2),
      id: 'direct-task',
      result: { imageUrl: '/direct.png' },
      progress: 100,
    };

    function publicationHarness(
      createTask: () => Promise<boolean>,
      completeTask: (prepared: Record<string, unknown>) => Promise<{
        transitioned: boolean;
        task: ReturnType<typeof cloudTask> & {
          result?: Record<string, unknown>;
        };
      } | undefined>,
      prepareCompletion = vi.fn().mockResolvedValue({
        imageUrl: '/prepared.png',
      }),
    ) {
      const taskIds: string[] = [];
      const registry: string[] = [];
      const imageUrls: string[] = [];
      return {
        taskIds,
        registry,
        imageUrls,
        prepareCompletion,
        run: () => publishDurableDirectTask({
          taskId: 'direct-task',
          createTask,
          prepareCompletion,
          completeTask,
          publishCompleted: (task) => {
            taskIds.push(task.id);
            registry.push(`${task.id}:${task.status}`);
            imageUrls.push(...getTaskResultImageUrls(task));
          },
        }),
      };
    }

    it('does not publish when durable creation returns false', async () => {
      const completeTask = vi.fn();
      const harness = publicationHarness(
        vi.fn().mockResolvedValue(false),
        completeTask,
      );

      await expect(harness.run()).resolves.toMatchObject({
        published: false,
        reason: 'create-rejected',
      });
      expect(completeTask).not.toHaveBeenCalled();
      expect(harness.prepareCompletion).not.toHaveBeenCalled();
      expect(harness.taskIds).toEqual([]);
      expect(harness.registry).toEqual([]);
      expect(harness.imageUrls).toEqual([]);
    });

    it('propagates creation errors without publishing', async () => {
      const harness = publicationHarness(
        vi.fn().mockRejectedValue(new Error('postgres unavailable')),
        vi.fn(),
      );

      await expect(harness.run()).rejects.toThrow('postgres unavailable');
      expect(harness.prepareCompletion).not.toHaveBeenCalled();
      expect(harness.taskIds).toEqual([]);
      expect(harness.registry).toEqual([]);
      expect(harness.imageUrls).toEqual([]);
    });

    it('does not publish when a CAS loser observes a failed winner', async () => {
      const harness = publicationHarness(
        vi.fn().mockResolvedValue(true),
        vi.fn().mockResolvedValue({
          transitioned: false,
          task: cloudTask('failed', 2),
        }),
      );

      await expect(harness.run()).resolves.toMatchObject({
        published: false,
        reason: 'terminal-not-completed',
        task: { status: 'failed' },
      });
      expect(harness.taskIds).toEqual([]);
      expect(harness.registry).toEqual([]);
      expect(harness.imageUrls).toEqual([]);
    });

    it.each([
      ['CAS winner', true],
      ['CAS loser with authoritative completed snapshot', false],
    ] as const)('publishes a completed direct task for %s', async (
      _scenario,
      transitioned,
    ) => {
      const harness = publicationHarness(
        vi.fn().mockResolvedValue(true),
        vi.fn().mockResolvedValue({
          transitioned,
          task: completedTask,
        }),
      );

      await expect(harness.run()).resolves.toMatchObject({
        published: true,
        transitioned,
        task: {
          id: 'direct-task',
          status: 'completed',
          result: { imageUrl: '/direct.png' },
        },
      });
      expect(harness.taskIds).toEqual(['direct-task']);
      expect(harness.registry).toEqual(['direct-task:completed']);
      expect(harness.imageUrls).toEqual(['/direct.png']);
    });

    it('passes the persisted final URL into the winning terminal CAS', async () => {
      const prepareCompletion = vi.fn().mockResolvedValue({
        imageUrl: '/persisted-final.png',
      });
      const completeTask = vi.fn().mockImplementation(
        async (prepared: Record<string, unknown>) => ({
          transitioned: true,
          task: {
            ...completedTask,
            result: prepared,
          },
        }),
      );
      const harness = publicationHarness(
        vi.fn().mockResolvedValue(true),
        completeTask,
        prepareCompletion,
      );

      await expect(harness.run()).resolves.toMatchObject({
        published: true,
        transitioned: true,
      });
      expect(prepareCompletion).toHaveBeenCalledTimes(1);
      expect(completeTask).toHaveBeenCalledWith({
        imageUrl: '/persisted-final.png',
      });
      expect(harness.imageUrls).toEqual(['/persisted-final.png']);
    });

    it('publishes a CAS winner snapshot instead of the loser prepared URL', async () => {
      const harness = publicationHarness(
        vi.fn().mockResolvedValue(true),
        vi.fn().mockResolvedValue({
          transitioned: false,
          task: {
            ...completedTask,
            result: { imageUrl: '/winner.png' },
          },
        }),
        vi.fn().mockResolvedValue({ imageUrl: '/loser.png' }),
      );

      await expect(harness.run()).resolves.toMatchObject({
        published: true,
        transitioned: false,
      });
      expect(harness.imageUrls).toEqual(['/winner.png']);
    });
  });
});
