import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

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
          projectId: 'project-a',
          recoveryAllowed: false,
          retryAfterMs: 8_000,
          nextRecoveryAt: 18_000,
          recoveryReason: 'lease-active',
        }),
      ],
    }));
  });

  it('returns only safe managed result fields for completed image restoration', async () => {
    mocks.listCloudTasks.mockResolvedValue([{
      id: 'task-complete',
      userId: 'user-a',
      projectId: 'project-a',
      type: 'generate',
      status: 'completed',
      providerId: 'provider-a',
      model: 'model-a',
      progress: 100,
      result: {
        imageUrl: '/media/result.png',
        apiKey: 'must-not-leak',
        submissionPayload: { prompt: 'hello', apiKey: 'also-private' },
        assetProjection: {
          references: [{
            url: '/media/result.png',
            assetVersionId: 'version-1',
            placementId: 'placement-1',
          }],
        },
      },
      createdAt: 1_000,
      updatedAt: 9_000,
    }]);

    const response = await GET(new NextRequest(
      'http://localhost/api/tasks/recover?projectId=project-a',
    ));
    const body = await response.json();

    expect(body.tasks[0]).toMatchObject({
      projectId: 'project-a',
      result: {
        imageUrl: '/media/result.png',
        assetProjection: {
          references: [{ assetVersionId: 'version-1', placementId: 'placement-1' }],
        },
      },
    });
    expect(JSON.stringify(body.tasks[0])).not.toContain('must-not-leak');
    expect(JSON.stringify(body.tasks[0])).not.toContain('also-private');
  });
});
