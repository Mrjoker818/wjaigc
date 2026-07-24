import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  getRequestUser: vi.fn(),
  getBrandIpProject: vi.fn(),
  createBrandIpGenerationTask: vi.fn(),
  executeBrandIpGeneration: vi.fn(),
  getTaskInfo: vi.fn(),
  getCloudTaskById: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  listCloudTasks: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: mocks.requireApiAuthOrReject,
  getRequestUser: mocks.getRequestUser,
}));
vi.mock('@/lib/brand-ip-storage', () => ({ getBrandIpProject: mocks.getBrandIpProject }));
vi.mock('@/lib/brand-ip-generation', () => ({
  createBrandIpGenerationTask: mocks.createBrandIpGenerationTask,
  executeBrandIpGeneration: mocks.executeBrandIpGeneration,
}));
vi.mock('@/lib/task-registry', () => ({ getTaskInfo: mocks.getTaskInfo }));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskById: mocks.getCloudTaskById,
  getCloudTaskForUser: mocks.getCloudTaskForUser,
  listCloudTasks: mocks.listCloudTasks,
}));

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
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'user-a', role: 'user', status: 'active' },
    });
    mocks.executeBrandIpGeneration.mockResolvedValue(undefined);
    mocks.getTaskInfo.mockReturnValue(null);
    mocks.getCloudTaskById.mockResolvedValue(null);
    mocks.getCloudTaskForUser.mockResolvedValue(null);
    mocks.listCloudTasks.mockResolvedValue([]);
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
    mocks.getTaskInfo.mockReturnValue({ id: 'task-b', type: 'brand-generate', userId: 'user-b', status: 'processing' });

    const response = await getTask(new NextRequest(
      'http://localhost/api/brand-ip/tasks?taskId=task-b',
    ));

    expect(response.status).toBe(200);
  });

  it('hides non-brand tasks even when they are resident in memory', async () => {
    mocks.getTaskInfo.mockReturnValue({ id: 'task-image', type: 'image-generate', userId: 'user-a', status: 'processing' });

    const response = await getTask(new NextRequest(
      'http://localhost/api/brand-ip/tasks?taskId=task-image',
    ));

    expect(response.status).toBe(404);
  });

  it('hides another user persistent task from a regular user', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue(null);

    const response = await getTask(new NextRequest(
      'http://localhost/api/brand-ip/tasks?taskId=task-persistent-b',
    ));

    expect(response.status).toBe(404);
    expect(mocks.getCloudTaskForUser).toHaveBeenCalledWith('task-persistent-b', 'user-a');
  });

  it('allows an administrator to inspect a persistent brand task', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'admin-a',
      userRole: 'admin',
    });
    mocks.getCloudTaskById.mockResolvedValue({
      id: 'task-persistent-b',
      type: 'brand-generate',
      status: 'processing',
      userId: 'user-b',
      progress: 35,
      label: '正在生成',
      result: {},
      error: '',
      createdAt: 1,
      updatedAt: 2,
    });

    const response = await getTask(new NextRequest(
      'http://localhost/api/brand-ip/tasks?taskId=task-persistent-b',
    ));

    expect(response.status).toBe(200);
    expect(mocks.getCloudTaskById).toHaveBeenCalledWith('task-persistent-b');
  });

  it('hides persistent non-brand tasks', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-persistent-image',
      type: 'image-generate',
      status: 'processing',
      userId: 'user-a',
      progress: 40,
      label: '正在生成图片',
      result: {},
      error: '',
      createdAt: 1,
      updatedAt: 2,
    });

    const response = await getTask(new NextRequest(
      'http://localhost/api/brand-ip/tasks?taskId=task-persistent-image',
    ));

    expect(response.status).toBe(404);
  });

  it('restores only unfinished brand tasks owned by the current project user', async () => {
    mocks.getBrandIpProject.mockResolvedValue({ id: 'project-a', userId: 'user-a' });
    mocks.listCloudTasks.mockResolvedValue([
      { id: 'task-running', type: 'brand-generate', status: 'processing', userId: 'user-a', projectId: 'project-a', progress: 46, label: '正在生成', result: null, error: null, createdAt: 1, updatedAt: 2 },
      { id: 'task-done', type: 'brand-generate', status: 'completed', userId: 'user-a', projectId: 'project-a', progress: 100, label: '已完成', result: null, error: null, createdAt: 1, updatedAt: 3 },
      { id: 'task-other', type: 'image-generate', status: 'processing', userId: 'user-a', projectId: 'project-a', progress: 20, label: '图像任务', result: null, error: null, createdAt: 1, updatedAt: 4 },
      { id: 'task-timeout', type: 'brand-generate', status: 'timeout', userId: 'user-a', projectId: 'project-a', progress: 60, label: '超时', result: null, error: null, createdAt: 1, updatedAt: 5 },
    ]);

    const response = await getTask(new NextRequest(
      'http://localhost/api/brand-ip/tasks?projectId=project-a',
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0].taskId).toBe('task-running');
    expect(mocks.listCloudTasks).toHaveBeenCalledWith({ userId: 'user-a', projectId: 'project-a', limit: 50 });
  });

  it('does not expose project recovery tasks when the project is not owned by the caller', async () => {
    mocks.getBrandIpProject.mockResolvedValue(null);

    const response = await getTask(new NextRequest(
      'http://localhost/api/brand-ip/tasks?projectId=project-b',
    ));

    expect(response.status).toBe(404);
    expect(mocks.listCloudTasks).not.toHaveBeenCalled();
  });
});
