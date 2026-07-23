import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  getBrandIpProject: vi.fn(),
  createBrandIpGenerationTask: vi.fn(),
  getTaskInfo: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/brand-ip-storage', () => ({ getBrandIpProject: mocks.getBrandIpProject }));
vi.mock('@/lib/brand-ip-generation', () => ({
  createBrandIpGenerationTask: mocks.createBrandIpGenerationTask,
}));
vi.mock('@/lib/task-registry', () => ({ getTaskInfo: mocks.getTaskInfo }));

import { POST as generate } from '@/app/api/brand-ip/generate/route';
import { GET as getTask } from '@/app/api/brand-ip/tasks/route';

describe('brand IP generation boundaries', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-a',
      userRole: 'user',
    });
  });

  it('does not create an image task before a role direction is confirmed', async () => {
    mocks.getBrandIpProject.mockResolvedValue({
      id: 'project-a',
      userId: 'user-a',
      directions: [],
      confirmedDirectionId: null,
    });

    const response = await generate(new NextRequest('http://localhost/api/brand-ip/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-a', prompt: '角色三视图' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain('确认');
    expect(mocks.getBrandIpProject).toHaveBeenCalledWith('project-a', 'user-a');
    expect(mocks.createBrandIpGenerationTask).not.toHaveBeenCalled();
  });

  it('hides another user task from a regular user', async () => {
    mocks.getTaskInfo.mockReturnValue({ id: 'task-b', userId: 'user-b', status: 'processing' });

    const response = await getTask(new NextRequest(
      'http://localhost/api/brand-ip/tasks?taskId=task-b',
    ));

    expect(response.status).toBe(404);
  });

  it('allows an administrator to inspect another user task', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'admin-a',
      userRole: 'admin',
    });
    mocks.getTaskInfo.mockReturnValue({ id: 'task-b', userId: 'user-b', status: 'processing' });

    const response = await getTask(new NextRequest(
      'http://localhost/api/brand-ip/tasks?taskId=task-b',
    ));

    expect(response.status).toBe(200);
  });
});
