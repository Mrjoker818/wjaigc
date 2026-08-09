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
      status: 'processing',
    }), { status: 200 }));

    const result = await kickoffDurableGenerationTasks({
      taskIds: ['task-1', 'task-2', 'task-1'],
      userId: 'user-a',
      userRole: 'admin',
      fetchImpl,
    });

    expect(mocks.getInternalRequestHeaders).toHaveBeenCalledWith('user-a', 'admin');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://internal/api/poll-task', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ taskId: 'task-1' }),
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'x-internal-request': 'true',
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
});
