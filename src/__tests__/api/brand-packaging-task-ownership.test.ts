import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  getTaskInfo: vi.fn(),
  findProviderForModel: vi.fn(),
  normalizeModelForApi: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/task-registry', () => ({ getTaskInfo: mocks.getTaskInfo }));
vi.mock('@/lib/server-api-config', () => ({ findProviderForModel: mocks.findProviderForModel }));
vi.mock('@/lib/model-capabilities', () => ({ normalizeModelForApi: mocks.normalizeModelForApi }));

import { GET } from '@/app/api/brand-packaging/tasks/route';

describe('GET /api/brand-packaging/tasks ownership', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      userRole: 'user',
    });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'pkg-1',
      userId: 'user-2',
      status: 'completed',
      progress: 100,
      result: { imageUrls: ['https://example.test/packaging.png'], prompt: 'private prompt' },
      createdAt: 1,
      updatedAt: 1,
    });
  });

  it('hides another user’s packaging task', async () => {
    const response = await GET(new NextRequest('http://localhost/api/brand-packaging/tasks?taskId=pkg-1'));

    expect(response.status).toBe(404);
  });

  it('allows an administrator to inspect another user’s packaging task', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'admin-1',
      userRole: 'admin',
    });

    const response = await GET(new NextRequest('http://localhost/api/brand-packaging/tasks?taskId=pkg-1'));

    expect(response.status).toBe(200);
  });
});
