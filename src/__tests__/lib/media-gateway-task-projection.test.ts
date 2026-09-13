import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCloudTaskForUser: vi.fn(),
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
  getInternalRequestHeaders: vi.fn(),
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
    mocks.thumbnailState = 'ready';
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      type: 'generate-async',
      status: 'completed',
      progress: 100,
      result: {
        assetVersionId: 'version-1',
        imageUrl: '/uploads/original.png',
      },
      creditStatus: 'charged',
      createdAt: 1,
      updatedAt: 2,
    });
    mocks.query.mockImplementation(() => Promise.resolve({
      rows: mocks.thumbnailState === 'ready'
        ? [
            { size: 256, file_url: '/uploads/thumb-256.webp' },
            { size: 512, file_url: '/uploads/thumb-512.webp' },
          ]
        : [],
    }));
  });

  it.each([
    ['ready', {
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

  it('queries only ready 256 and 512 variants owned by the task principal', async () => {
    await getGatewayTaskProjection(principal, 'task-1');

    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[0][0]).toContain("status = 'ready'");
    expect(mocks.query.mock.calls[0][0]).toMatch(/size\s+IN\s*\(256,\s*512\)/);
    expect(mocks.query.mock.calls[0][1]).toEqual(['version-1', 'user-1']);
  });

  it('fails closed on thumbnail storage errors without changing completed status', async () => {
    mocks.query.mockRejectedValue(new Error('thumbnail storage unavailable'));

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
