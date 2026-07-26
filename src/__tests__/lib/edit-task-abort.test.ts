import { describe, expect, it } from 'vitest';

import {
  cancelTask,
  registerTask,
  registerTaskAbortController,
  unregisterTaskAbortController,
} from '@/lib/task-registry';
import {
  cancelEditTask,
  failEditTask,
  getEditTask,
  setEditTask,
} from '@/lib/edit-task-store';

describe('edit task cancellation propagation', () => {
  it('actively aborts the registered backend controller', () => {
    const taskId = `abort-test-${Date.now()}-${Math.random()}`;
    const controller = new AbortController();
    registerTask(taskId, 'edit', 'abort test', 'user-1');
    registerTaskAbortController(taskId, controller);

    expect(cancelTask(taskId)).toBe(true);
    expect(controller.signal.aborted).toBe(true);

    unregisterTaskAbortController(taskId, controller);
  });

  it('does not allow late failure or completion to overwrite cancellation', () => {
    const taskId = `edit-terminal-test-${Date.now()}-${Math.random()}`;
    setEditTask(taskId, {
      id: taskId,
      status: 'processing',
      progress: 10,
      stage: 'processing',
      createdAt: Date.now(),
    });
    expect(cancelEditTask(taskId)).toBe(true);

    failEditTask(taskId, 'late failure');
    setEditTask(taskId, {
      id: taskId,
      status: 'completed',
      progress: 100,
      stage: 'completed',
      createdAt: Date.now(),
    });

    expect(getEditTask(taskId)?.status).toBe('cancelled');
  });
});
