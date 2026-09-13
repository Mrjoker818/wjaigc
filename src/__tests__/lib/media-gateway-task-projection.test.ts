import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCloudTaskForUser: vi.fn(),
  projectPersistedCompletedTask: vi.fn(),
  getInternalRequestHeaders: vi.fn(),
  query: vi.fn(),
  thumbnailState: 'ready' as 'ready' | 'pending' | 'failed',
}));

vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: mocks.getCloudTaskForUser,
}));
vi.mock('@/lib/db-client', () => ({
  getPool: () => ({ query: mocks.query }),
}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: mocks.getInternalRequestHeaders,
}));
vi.mock('@/lib/cloud-task-persistence', () => ({
  projectPersistedCompletedTask: mocks.projectPersistedCompletedTask,
}));

import { getGatewayTaskProjection } from '@/lib/media-gateway/task-projection';

const principal = {
  keyId: 'gwkey-1',
  userId: 'user-1',
  requestsPerMinute: 60,
  dailyQuota: 100,
};

describe('media gateway task thumbnail projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.thumbnailState = 'ready';
    mocks.getInternalRequestHeaders.mockResolvedValue({
      'x-internal-user-id': 'user-1',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, status: 'processing' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      projectId: 'project-1',
      type: 'generate-async',
      status: 'completed',
      progress: 100,
      result: {
        assetProjection: { versionIds: ['version-1'] },
        imageUrl: '/uploads/original.png',
      },
      creditStatus: 'charged',
      createdAt: 1,
      updatedAt: 2,
    });
    mocks.query.mockImplementation((sql: string) => Promise.resolve({
      rows: sql.includes('FROM wujie_asset_versions')
        ? [{ id: 'version-1' }]
        : mocks.thumbnailState === 'ready'
          ? [
              { size: 256, file_url: '/uploads/thumb-256.webp' },
              { size: 512, file_url: '/uploads/thumb-512.webp' },
            ]
          : [],
    }));
  });

  it.each([
    ['ready', {
      assetVersionId: 'version-1',
      downloadUrl: '/uploads/original.png',
      thumbnailUrls: {
        '256': '/uploads/thumb-256.webp',
        '512': '/uploads/thumb-512.webp',
      },
      previewUrl: '/uploads/thumb-512.webp',
    }],
    ['pending', { thumbnailUrls: undefined, previewUrl: '/uploads/original.png' }],
    ['failed', { thumbnailUrls: undefined, previewUrl: '/uploads/original.png' }],
  ] as const)(
    'projects %s thumbnail state without changing task completion',
    async (state, expected) => {
      mocks.thumbnailState = state;

      expect(await getGatewayTaskProjection(principal, 'task-1')).toMatchObject({
        status: 'completed',
        ...expected,
      });
    },
  );

  it('keeps the owner-scoped asset identity and original download while thumbnails are pending', async () => {
    mocks.query.mockImplementation((sql: string) => Promise.resolve({
      rows: sql.includes('FROM wujie_asset_versions') ? [{ id: 'version-1' }] : [],
    }));

    const projection = await getGatewayTaskProjection(principal, 'task-1');

    expect(projection).toMatchObject({
      status: 'completed',
      assetVersionId: 'version-1',
      previewUrl: '/uploads/original.png',
      downloadUrl: '/uploads/original.png',
      thumbnailUrls: undefined,
    });
  });

  it('queries only ready 256 and 512 variants owned by the task principal', async () => {
    await getGatewayTaskProjection(principal, 'task-1');

    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0][0]).toContain('FROM wujie_asset_versions');
    expect(mocks.query.mock.calls[0][1]).toEqual(['version-1', 'user-1', 'project-1']);
    expect(mocks.query.mock.calls[1][0]).toContain("status = 'ready'");
    expect(mocks.query.mock.calls[1][0]).toMatch(/size\s+IN\s*\(256,\s*512\)/);
    expect(mocks.query.mock.calls[1][1]).toEqual(['version-1', 'user-1']);
  });

  it('does not expose an asset version outside the task owner and project', async () => {
    mocks.query.mockImplementation((sql: string) => Promise.resolve({
      rows: sql.includes('FROM wujie_asset_versions')
        ? []
        : [{ size: 512, file_url: '/uploads/thumb-512.webp' }],
    }));

    const projection = await getGatewayTaskProjection(principal, 'task-1');

    expect(projection.assetVersionId).toBeUndefined();
    expect(projection.thumbnailUrls).toEqual({});
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it('prefers the current asset projection over the legacy top-level version id', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      projectId: 'project-1',
      type: 'generate-async',
      status: 'completed',
      progress: 100,
      result: {
        assetVersionId: 'legacy-version',
        assetProjection: { versionIds: ['current-version'] },
        imageUrl: '/uploads/original.png',
      },
      creditStatus: 'charged',
      createdAt: 1,
      updatedAt: 2,
    });
    mocks.query.mockImplementation((sql: string) => Promise.resolve({
      rows: sql.includes('FROM wujie_asset_versions')
        ? [{ id: 'current-version' }]
        : [],
    }));

    await expect(getGatewayTaskProjection(principal, 'task-1')).resolves.toMatchObject({
      assetVersionId: 'current-version',
    });
    expect(mocks.query.mock.calls[0][1]).toEqual(['current-version', 'user-1', 'project-1']);
  });

  it('retries a missing completed projection before returning the gateway task', async () => {
    const completedWithoutProjection = {
      id: 'task-1',
      userId: 'user-1',
      projectId: 'project-1',
      type: 'generate-async',
      status: 'completed',
      progress: 100,
      result: {
        imageUrl: '/uploads/original.png',
        submissionPayload: { sourceChannel: 'gateway' },
      },
      creditStatus: 'charged',
      createdAt: 1,
      updatedAt: 2,
    };
    mocks.getCloudTaskForUser
      .mockResolvedValueOnce(completedWithoutProjection)
      .mockResolvedValueOnce({
        ...completedWithoutProjection,
        result: {
          ...completedWithoutProjection.result,
          assetProjection: { status: 'projected', versionIds: ['version-1'] },
        },
      });

    await expect(getGatewayTaskProjection(principal, 'task-1')).resolves.toMatchObject({
      status: 'completed',
      assetVersionId: 'version-1',
    });
    expect(mocks.projectPersistedCompletedTask).toHaveBeenCalledOnce();
    expect(mocks.projectPersistedCompletedTask).toHaveBeenCalledWith('task-1', 'user-1');
  });

  it('advances a persisted video task through the internal poll route after restart', async () => {
    const processing = {
      id: 'video-1', userId: 'user-1', projectId: 'project-1', type: 'video',
      status: 'processing', progress: 10, providerId: 'provider-1', model: 'video-model',
      remoteTaskId: 'remote-video-1', creditStatus: 'charged', createdAt: 1, updatedAt: 2,
      result: { submissionPayload: { sourceChannel: 'gateway' } },
    };
    mocks.getCloudTaskForUser
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce({
        ...processing,
        status: 'completed',
        progress: 100,
        result: {
          ...processing.result,
          videoUrl: '/api/serve-upload/video/video-1.mp4',
          assetProjection: { status: 'projected', versionIds: ['version-1'] },
        },
      });
    const internalPoll = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, status: 'completed' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', internalPoll);

    await expect(getGatewayTaskProjection(principal, 'video-1')).resolves.toMatchObject({
      taskId: 'video-1',
      status: 'completed',
      progress: 100,
      downloadUrl: '/api/serve-upload/video/video-1.mp4',
    });
    expect(internalPoll).toHaveBeenCalledOnce();
    expect(internalPoll).toHaveBeenCalledWith(
      expect.stringContaining('/api/poll-task'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ taskId: 'video-1' }),
      }),
    );
  });

  it.each(['processing', 'cancelled'] as const)(
    'does not query thumbnails while the authoritative task is %s',
    async (status) => {
      mocks.getCloudTaskForUser.mockResolvedValue({
        id: 'task-1',
        userId: 'user-1',
        type: 'generate-async',
        status,
        progress: 50,
        result: {
          assetVersionId: 'version-1',
          imageUrl: '/uploads/original.png',
        },
        creditStatus: status === 'cancelled' ? 'refunded' : 'pending',
        createdAt: 1,
        updatedAt: 2,
      });

      await expect(getGatewayTaskProjection(principal, 'task-1')).resolves.toMatchObject({
        status,
        previewUrl: '/uploads/original.png',
        thumbnailUrls: {},
      });
      expect(mocks.query).not.toHaveBeenCalled();
    },
  );

  it('uses a safe 256 thumbnail when no 512 variant exists', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ size: 256, file_url: '/uploads/thumb-256.webp' }],
    });

    await expect(getGatewayTaskProjection(principal, 'task-1')).resolves.toMatchObject({
      status: 'completed',
      previewUrl: '/uploads/thumb-256.webp',
      thumbnailUrls: { '256': '/uploads/thumb-256.webp' },
    });
  });

  it('uses a safe 256 thumbnail when the 512 URL is unsafe', async () => {
    const unsafeUrl = 'https://127.0.0.1/private.webp';
    mocks.query.mockImplementation((sql: string) => Promise.resolve({
      rows: sql.includes('FROM wujie_asset_versions')
        ? [{ id: 'version-1' }]
        : [
            { size: 256, file_url: '/uploads/thumb-256.webp' },
            { size: 512, file_url: unsafeUrl },
          ],
    }));

    const projection = await getGatewayTaskProjection(principal, 'task-1');

    expect(projection).toMatchObject({
      status: 'completed',
      previewUrl: '/uploads/thumb-256.webp',
      thumbnailUrls: { '256': '/uploads/thumb-256.webp' },
    });
    expect(JSON.stringify(projection)).not.toContain(unsafeUrl);
  });

  it('fails closed on thumbnail storage errors without changing completed status', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }] })
      .mockRejectedValueOnce(new Error('thumbnail storage unavailable'));

    await expect(getGatewayTaskProjection(principal, 'task-1')).resolves.toMatchObject({
      status: 'completed',
      previewUrl: '/uploads/original.png',
      thumbnailUrls: undefined,
    });
  });

  it.each([
    'http://cdn.openai.com/thumb.webp',
    'https://127.0.0.1/private.webp',
    '/uploads/thumb.webp?credential=secret',
  ])('does not leak unsafe ready thumbnail URL %s', async (unsafeUrl) => {
    mocks.query.mockResolvedValue({ rows: [{ size: 512, file_url: unsafeUrl }] });

    const projection = await getGatewayTaskProjection(principal, 'task-1');

    expect(projection).toMatchObject({
      status: 'completed',
      previewUrl: '/uploads/original.png',
      thumbnailUrls: undefined,
    });
    expect(JSON.stringify(projection)).not.toContain(unsafeUrl);
  });
});
