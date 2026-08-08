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
import { transitionTask } from '@/lib/task-core/task-service';

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

  it.each<DurableTaskStatus>(['failed', 'cancelled', 'timeout'])(
    'rejects %s -> completed',
    (status) => {
      expect(canTransitionTaskStatus(status, 'completed')).toBe(false);
    },
  );

  it('allows completed only from processing', () => {
    for (const status of DURABLE_TASK_STATUSES) {
      expect(canTransitionTaskStatus(status, 'completed')).toBe(
        status === 'processing',
      );
    }
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
});
