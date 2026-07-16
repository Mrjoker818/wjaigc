import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  dbCreateTask: vi.fn(),
  dbGetTask: vi.fn(),
  dbGetFilesByTask: vi.fn(),
  canAccessAiPsdTask: vi.fn(),
  cleanupExpiredTasks: vi.fn(),
  registerTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  validateApiInputs: vi.fn(),
  runAiPsdTask: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/ai-psd/storage', () => ({
  dbCreateTask: mocks.dbCreateTask,
  dbGetTask: mocks.dbGetTask,
  dbGetFilesByTask: mocks.dbGetFilesByTask,
  canAccessAiPsdTask: mocks.canAccessAiPsdTask,
  cleanupExpiredTasks: mocks.cleanupExpiredTasks,
}));
vi.mock('@/lib/task-registry', () => ({
  registerTask: mocks.registerTask,
  updateTaskProgress: mocks.updateTaskProgress,
}));
vi.mock('@/lib/api-validator', () => ({ validateApiInputs: mocks.validateApiInputs }));
vi.mock('@/lib/ai-psd/task-worker', () => ({ runAiPsdTask: mocks.runAiPsdTask }));

import { POST as createTask } from '@/app/api/ai-psd/create/route';
import { GET as getTaskStatus } from '@/app/api/ai-psd/status/route';
import { GET as getTaskResult } from '@/app/api/ai-psd/result/route';

function authenticatedUser(userId = 'user-1', userRole = 'user') {
  return { authenticated: true as const, userId, userRole };
}

function taskFor(userId: string) {
  return {
    id: 'ai-psd-task-1',
    userId,
    status: 'success',
    progress: 100,
    generationMode: 'text_to_psd',
    prompt: 'poster',
    ratio: '16:9',
    sceneType: 'poster',
    style: [],
    colorTone: 'auto',
    layerComplexity: 'standard',
    outputQuality: 'standard',
    textRenderMode: 'editable_text',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('AI PSD task ownership', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.requireApiAuthOrReject.mockResolvedValue(authenticatedUser());
    mocks.dbCreateTask.mockResolvedValue(true);
    mocks.cleanupExpiredTasks.mockResolvedValue(undefined);
    mocks.validateApiInputs.mockReturnValue(null);
    mocks.runAiPsdTask.mockResolvedValue(undefined);
    mocks.canAccessAiPsdTask.mockImplementation((task, userId, userRole) => userRole === 'admin' || task.userId === userId);
  });

  it('persists the authenticated owner when creating an AI PSD task', async () => {
    const response = await createTask(new NextRequest('http://localhost/api/ai-psd/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Create a launch poster' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.dbCreateTask).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('rejects anonymous task status reads before loading task data', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );

    const response = await getTaskStatus(new NextRequest('http://localhost/api/ai-psd/status?taskId=ai-psd-task-1'));

    expect(response.status).toBe(401);
    expect(mocks.dbGetTask).not.toHaveBeenCalled();
  });

  it('hides a different user’s completed PSD result', async () => {
    mocks.dbGetTask.mockResolvedValue(taskFor('user-2'));

    const response = await getTaskResult(new NextRequest('http://localhost/api/ai-psd/result?taskId=ai-psd-task-1'));

    expect(response.status).toBe(404);
    expect(mocks.dbGetFilesByTask).not.toHaveBeenCalled();
  });

  it('allows an owner to read their task status', async () => {
    mocks.dbGetTask.mockResolvedValue(taskFor('user-1'));

    const response = await getTaskStatus(new NextRequest('http://localhost/api/ai-psd/status?taskId=ai-psd-task-1'));

    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
  });
});
