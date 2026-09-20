import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInternalRequestHeaders: vi.fn(),
  getInternalApiUrl: vi.fn((path: string) => `http://internal${path}`),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: mocks.getInternalRequestHeaders,
}));

vi.mock('@/lib/api-helpers', () => ({
  getInternalApiUrl: mocks.getInternalApiUrl,
}));

import { kickoffDurableGenerationTasks } from '@/lib/task-core/durable-generation-kickoff';

describe('durable generation server kickoff', () => {
  beforeEach(() => {
    mocks.getInternalRequestHeaders.mockReset();
    mocks.getInternalApiUrl.mockClear();
    mocks.getInternalRequestHeaders.mockResolvedValue({
      'x-internal-request': 'true',
      'x-internal-user-id': 'user-a',
    });
  });

  it('wakes every unique slot through the lease-protected poll route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      status: 'completed',
    }), { status: 200 }));

    const result = await kickoffDurableGenerationTasks({
      taskIds: ['task-1', 'task-2', 'task-1'],
      userId: 'user-a',
      userRole: 'admin',
      fetchImpl,
      executionFence: {
        runId: 'task-1',
        leaseOwner: 'agent-lease-1',
        generation: 3,
      },
    });

    expect(mocks.getInternalRequestHeaders).toHaveBeenCalledWith('user-a', 'admin');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://internal/api/poll-task', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ taskId: 'task-1' }),
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'x-internal-request': 'true',
        'x-wujie-agent-run-id': 'task-1',
        'x-wujie-agent-lease-owner': 'agent-lease-1',
        'x-wujie-agent-generation': '3',
      }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://internal/api/poll-task', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ taskId: 'task-2' }),
    }));
    expect(result).toEqual({ attempted: 2, accepted: 2, failed: [] });
  });

  it('continues waking later slots when one internal request fails', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('temporary disconnect'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const result = await kickoffDurableGenerationTasks({
      taskIds: ['task-1', 'task-2'],
      userId: 'user-a',
      userRole: 'user',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.attempted).toBe(2);
    expect(result.accepted).toBe(1);
    expect(result.failed).toEqual([{ taskId: 'task-1', error: 'temporary disconnect' }]);
  });

  it('can return after the recovery route accepts a queued slot without waiting for terminal state', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      status: 'processing',
      recoveryPending: true,
      retryAfterMs: 3_000,
    }), { status: 200 }));

    const result = await kickoffDurableGenerationTasks({
      taskIds: ['task-1'],
      userId: 'user-a',
      userRole: 'admin',
      fetchImpl,
      waitForTerminal: false,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ attempted: 1, accepted: 1, failed: [] });
  });

  it('keeps driving a slot after recovery backoff until it reaches a terminal state', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          success: true,
          status: 'processing',
          recoveryPending: true,
          retryAfterMs: 3_000,
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          success: true,
          status: 'processing',
          progress: 10,
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          success: true,
          status: 'completed',
          progress: 100,
        }), { status: 200 }));

      const kickoff = kickoffDurableGenerationTasks({
        taskIds: ['task-1'],
        userId: 'user-a',
        userRole: 'admin',
        fetchImpl,
      });

      await vi.runAllTimersAsync();

      await expect(kickoff).resolves.toEqual({ attempted: 1, accepted: 1, failed: [] });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('combines the initial execution signal with the poll timeout and stops when pause aborts it', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      receivedSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    });

    const kickoff = kickoffDurableGenerationTasks({
      taskIds: ['task-1'], userId: 'user-a', userRole: 'user', fetchImpl, signal: controller.signal,
    });
    await vi.waitFor(() => expect(receivedSignal).toBeTruthy());
    expect(receivedSignal).not.toBe(controller.signal);
    controller.abort(new Error('paused'));

    await expect(kickoff).resolves.toEqual({
      attempted: 1,
      accepted: 0,
      failed: [{ taskId: 'task-1', error: 'paused' }],
    });
  });

  it('aborts a pending poll at the existing 15 second request timeout', async () => {
    vi.useFakeTimers();
    try {
      let receivedSignal: AbortSignal | null | undefined;
      const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        receivedSignal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      });

      const kickoff = kickoffDurableGenerationTasks({
        taskIds: ['task-timeout'], userId: 'user-a', userRole: 'user', fetchImpl,
      });
      await vi.waitFor(() => expect(receivedSignal).toBeTruthy());
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await kickoff;
      expect(receivedSignal?.aborted).toBe(true);
      expect(result.attempted).toBe(1);
      expect(result.accepted).toBe(0);
      expect(result.failed).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
