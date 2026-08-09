import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listCloudTasks: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  listCloudTasks: mocks.listCloudTasks,
}));

import { GET } from '@/app/api/tasks/recover/route';

describe('GET /api/tasks/recover recovery backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    mocks.getSessionUser.mockReset();
    mocks.listCloudTasks.mockReset();
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
  });

  it('returns lease-aware retry metadata instead of inviting a hot recovery loop', async () => {
    mocks.listCloudTasks.mockResolvedValue([{
      id: 'task-active-lease',
      userId: 'user-a',
      projectId: 'project-a',
      type: 'generate-async',
      status: 'processing',
      providerId: 'provider-a',
      model: 'model-a',
      progress: 30,
      label: '生成中',
      result: { submissionPayload: { prompt: 'hello' } },
      createdAt: 1_000,
      updatedAt: 9_000,
      leaseExpiresAt: 18_000,
      attemptCount: 2,
    }]);

    const response = await GET(new NextRequest(
      'http://localhost/api/tasks/recover?projectId=project-a',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('8');
    expect(body).toEqual(expect.objectContaining({
      success: true,
      retryAfterMs: 8_000,
      tasks: [
        expect.objectContaining({
          id: 'task-active-lease',
          recoveryAllowed: false,
          retryAfterMs: 8_000,
          nextRecoveryAt: 18_000,
          recoveryReason: 'lease-active',
        }),
      ],
    }));
  });
});
