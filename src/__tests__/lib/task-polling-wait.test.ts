import { describe, expect, it } from 'vitest';

import { waitForTaskPollInterval } from '@/lib/task-polling-wait';

describe('waitForTaskPollInterval', () => {
  it('waits for the timer when SSE is disconnected', async () => {
    const startedAt = Date.now();

    const result = await waitForTaskPollInterval({
      taskId: 'task-1',
      intervalMs: 25,
      isConnected: () => false,
      onTaskEvent: () => () => {},
    });

    expect(result).toBe('timer');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
  });

  it('wakes early only for a terminal event from the same task', async () => {
    let listener: ((event: { taskId: string; type: string }) => void) | undefined;

    const waiting = waitForTaskPollInterval({
      taskId: 'task-2',
      intervalMs: 200,
      isConnected: () => true,
      onTaskEvent: (callback) => {
        listener = callback;
        return () => {};
      },
    });

    listener?.({ taskId: 'another-task', type: 'completed' });
    listener?.({ taskId: 'task-2', type: 'progress' });
    setTimeout(() => listener?.({ taskId: 'task-2', type: 'completed' }), 5);

    await expect(waiting).resolves.toBe('event');
  });
});
