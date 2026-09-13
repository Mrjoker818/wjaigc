import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCloudTaskForUser: vi.fn(),
  projectPersistedCompletedTask: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn(async () => ({ 'x-internal-auth': 'test' })),
}));
vi.mock('@/lib/api-helpers', () => ({
  getInternalApiUrl: vi.fn((path: string) => `http://internal.test${path}`),
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: mocks.getCloudTaskForUser,
}));
vi.mock('@/lib/cloud-task-persistence', () => ({
  projectPersistedCompletedTask: mocks.projectPersistedCompletedTask,
}));

import { recoverBriefToVideoOperation } from '@/lib/brief-to-video/video-recovery';

const input = {
  actorUserId: 'user-1', actorRole: 'user' as const, projectId: 'project-1',
  workspaceId: 'canvas-1', runId: 'run-1', stepId: 'generate-film',
  requestDigest: 'digest-1', idempotencyKey: 'key-1', operationKey: 'operation-1',
  executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
  inputValues: {}, previousOutputs: [],
  modelBinding: { providerId: 'pear-video', modelId: 'video-model', descriptor: {} as never },
  sourceImageUrls: {}, signal: new AbortController().signal,
  recordLocalAccepted: async () => undefined,
};

describe('Brief to video recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects an already completed video task before polling the provider again', async () => {
    mocks.getCloudTaskForUser
      .mockResolvedValueOnce({
        id: 'video-child-1', userId: 'user-1', projectId: 'project-1', type: 'video',
        status: 'completed', result: { videoUrl: '/video.mp4' }, remoteTaskId: 'remote-video-1',
      })
      .mockResolvedValueOnce({
        id: 'video-child-1', userId: 'user-1', projectId: 'project-1', type: 'video',
        status: 'completed', remoteTaskId: 'remote-video-1',
        result: { videoUrl: '/video.mp4', assetProjection: { versionIds: ['video-v1'] } },
      });
    const fetcher = vi.spyOn(globalThis, 'fetch');

    await expect(recoverBriefToVideoOperation('video-child-1', input, {
      maxPolls: 1, pollIntervalMs: 0,
    })).resolves.toEqual({
      assetVersionIds: ['video-v1'],
      remoteTaskId: 'remote-video-1',
    });
    expect(mocks.projectPersistedCompletedTask).toHaveBeenCalledWith('video-child-1', 'user-1');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });

  it('waits for the existing completed task projection instead of returning an empty result', async () => {
    mocks.getCloudTaskForUser
      .mockResolvedValueOnce({
        id: 'video-child-1', userId: 'user-1', projectId: 'project-1', type: 'video',
        status: 'completed', result: {}, remoteTaskId: 'remote-video-1',
      })
      .mockResolvedValueOnce({
        id: 'video-child-1', userId: 'user-1', projectId: 'project-1', type: 'video',
        status: 'completed', remoteTaskId: 'remote-video-1',
        result: {
          videoThumbnailUrl: '/thumb.png',
          assetProjection: { versionIds: ['video-v1'] },
        },
      });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ status: 'completed' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await expect(recoverBriefToVideoOperation('video-child-1', input, {
      maxPolls: 2, pollIntervalMs: 0,
    })).resolves.toEqual({
      assetVersionIds: ['video-v1'],
      remoteTaskId: 'remote-video-1',
      thumbnailUrl: '/thumb.png',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('http://internal.test/api/poll-task', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        taskId: 'video-child-1', providerId: 'pear-video', model: 'video-model',
      }),
    }));
    fetcher.mockRestore();
  });
});
