import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getTaskInfo: vi.fn(),
  isTaskCancelled: vi.fn(),
  cancelTask: vi.fn(),
  cancelEditTask: vi.fn(),
  refundCredits: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  refundCloudTaskCredits: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
  recordCloudTaskCancelled: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/task-registry', () => ({
  getTaskInfo: mocks.getTaskInfo,
  isTaskCancelled: mocks.isTaskCancelled,
  cancelTask: mocks.cancelTask,
}));
vi.mock('@/lib/edit-task-store', () => ({ cancelEditTask: mocks.cancelEditTask }));
vi.mock('@/lib/credits', () => ({ refundCredits: mocks.refundCredits }));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: mocks.getCloudTaskForUser,
  refundCloudTaskCredits: mocks.refundCloudTaskCredits,
  terminateCloudTaskAndRefund: mocks.terminateCloudTaskAndRefund,
}));
vi.mock('@/lib/cloud-task-persistence', () => ({ recordCloudTaskCancelled: mocks.recordCloudTaskCancelled }));

import { POST } from '@/app/api/cancel-task/route';

function request(taskId: string): NextRequest {
  return new NextRequest('http://localhost/api/cancel-task', {
    method: 'POST',
    body: JSON.stringify({ taskId }),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/cancel-task', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.isTaskCancelled.mockReturnValue(false);
    mocks.recordCloudTaskCancelled.mockResolvedValue(undefined);
    mocks.terminateCloudTaskAndRefund.mockResolvedValue({
      status: 'cancelled',
      transitioned: true,
      refunded: true,
      creditCost: 8,
    });
  });

  it('rejects an unauthenticated cancellation', async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(request('task-1'));

    expect(response.status).toBe(401);
    expect(mocks.cancelTask).not.toHaveBeenCalled();
  });

  it('rejects a restarted task that is not owned by the user', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue(undefined);
    mocks.getCloudTaskForUser.mockResolvedValue(null);

    const response = await POST(request('task-other-user'));

    expect(response.status).toBe(404);
    expect(mocks.getCloudTaskForUser).toHaveBeenCalledWith('task-other-user', 'user-a');
    expect(mocks.cancelTask).not.toHaveBeenCalled();
  });

  it('allows a restarted task owned by the user to be cancelled', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue(undefined);
    mocks.getCloudTaskForUser.mockResolvedValue({ id: 'task-owned', userId: 'user-a' });

    const response = await POST(request('task-owned'));

    expect(response.status).toBe(200);
    expect(mocks.cancelTask).toHaveBeenCalledWith('task-owned');
    expect(mocks.recordCloudTaskCancelled).toHaveBeenCalledWith('task-owned', false);
  });

  it('settles annotation cancellation and refund from the database terminal state', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'annotation-task',
      userId: 'user-a',
      type: 'edit',
      creditCost: 8,
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'annotation-task',
      userId: 'user-a',
      type: 'annotation-edit',
      creditCost: 8,
      creditStatus: 'pending',
    });

    const response = await POST(request('annotation-task'));

    expect(response.status).toBe(200);
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith(
      'annotation-task',
      'cancelled',
      'Annotation edit cancelled (taskId: annotation-task)',
    );
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
    expect(mocks.recordCloudTaskCancelled).not.toHaveBeenCalled();
  });
});
