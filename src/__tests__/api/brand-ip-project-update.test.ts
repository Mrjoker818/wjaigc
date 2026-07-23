import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  getBrandIpProject: vi.fn(),
  updateBrandIpProject: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/brand-ip-storage', () => ({
  getBrandIpProject: mocks.getBrandIpProject,
  updateBrandIpProject: mocks.updateBrandIpProject,
}));

import { PATCH } from '@/app/api/brand-ip/projects/route';

const project = {
  id: 'project-a',
  userId: 'user-a',
  name: '无界品牌 IP',
  brief: { brandName: '无界AI', objective: '品牌角色设计' },
  directions: [
    {
      id: 'direction-a',
      name: '边界探索者',
      concept: '以探索和连接为核心的品牌角色',
      scores: { brandRole: 88, ownability: 84, feasibility: 91 },
      status: 'draft',
    },
  ],
  confirmedDirectionId: null,
  immutableCore: [],
  controlledVariables: [],
  currentStage: 'role-direction',
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
};

describe('/api/brand-ip/projects update', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-a',
      userRole: 'user',
    });
  });

  it('confirms only a direction owned by the authenticated project', async () => {
    mocks.getBrandIpProject.mockResolvedValue(project);
    mocks.updateBrandIpProject.mockResolvedValue({ ...project, confirmedDirectionId: 'direction-a' });

    const response = await PATCH(new NextRequest('http://localhost/api/brand-ip/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-a', confirmedDirectionId: 'direction-a' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.getBrandIpProject).toHaveBeenCalledWith('project-a', 'user-a');
    expect(mocks.updateBrandIpProject).toHaveBeenCalledWith(
      'project-a',
      'user-a',
      expect.objectContaining({ confirmedDirectionId: 'direction-a' }),
    );
  });

  it('rejects confirming a direction that does not belong to the project', async () => {
    mocks.getBrandIpProject.mockResolvedValue(project);

    const response = await PATCH(new NextRequest('http://localhost/api/brand-ip/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-a', confirmedDirectionId: 'direction-b' }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.updateBrandIpProject).not.toHaveBeenCalled();
  });

  it('updates visual constraints without trusting a client user id', async () => {
    mocks.getBrandIpProject.mockResolvedValue(project);
    mocks.updateBrandIpProject.mockResolvedValue(project);

    const response = await PATCH(new NextRequest('http://localhost/api/brand-ip/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-a',
        userId: 'user-b',
        immutableCore: [{ id: 'silhouette', label: '轮廓', value: '圆角方形' }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateBrandIpProject).toHaveBeenCalledWith(
      'project-a',
      'user-a',
      expect.objectContaining({ immutableCore: [{ id: 'silhouette', label: '轮廓', value: '圆角方形' }] }),
    );
  });
});
