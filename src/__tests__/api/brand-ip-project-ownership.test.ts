import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  getBrandIpProject: vi.fn(),
  createBrandIpProject: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/brand-ip-storage', () => ({
  getBrandIpProject: mocks.getBrandIpProject,
  createBrandIpProject: mocks.createBrandIpProject,
}));

import { GET, POST } from '@/app/api/brand-ip/projects/route';

describe('/api/brand-ip/projects ownership', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-a',
      userRole: 'user',
    });
  });

  it('queries projects inside the authenticated user boundary', async () => {
    mocks.getBrandIpProject.mockResolvedValue(null);

    const response = await GET(new NextRequest(
      'http://localhost/api/brand-ip/projects?projectId=project-b&userId=user-b',
    ));

    expect(response.status).toBe(404);
    expect(mocks.getBrandIpProject).toHaveBeenCalledWith('project-b', 'user-a');
  });

  it('ignores a client supplied user id when creating a project', async () => {
    mocks.createBrandIpProject.mockResolvedValue({ id: 'project-a', userId: 'user-a' });

    const response = await POST(new NextRequest('http://localhost/api/brand-ip/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-b',
        name: '新品牌 IP',
        brief: { brandName: '无界AI', objective: '品牌角色设计' },
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createBrandIpProject).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({ name: '新品牌 IP' }),
    );
  });

  it('rejects unauthenticated callers before reading storage', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );

    const response = await GET(new NextRequest(
      'http://localhost/api/brand-ip/projects?projectId=project-a',
    ));

    expect(response.status).toBe(401);
    expect(mocks.getBrandIpProject).not.toHaveBeenCalled();
  });
});
