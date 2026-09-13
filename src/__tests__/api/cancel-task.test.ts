import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  requireApiAuthOrReject: vi.fn(),
  getTaskInfo: vi.fn(),
  isTaskCancelled: vi.fn(),
  cancelTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  cancelEditTask: vi.fn(),
  refundCredits: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  refundCloudTaskCredits: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
  recordCloudTaskCancelled: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: mocks.requireApiAuthOrReject,
}));
vi.mock('@/lib/task-registry', () => ({
  getTaskInfo: mocks.getTaskInfo,
  isTaskCancelled: mocks.isTaskCancelled,
  cancelTask: mocks.cancelTask,
  updateTaskProgress: mocks.updateTaskProgress,
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

function request(
  taskId: string,
  requestId?: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest('http://localhost/api/cancel-task', {
    method: 'POST',
    body: JSON.stringify({ taskId }),
    headers: {
      'Content-Type': 'application/json',
      ...(requestId ? { 'x-request-id': requestId } : {}),
      ...headers,
    },
  });
}

describe('POST /api/cancel-task', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.requireApiAuthOrReject.mockImplementation(async (incomingRequest: NextRequest) => {
      const user = await mocks.getSessionUser(incomingRequest);
      return user
        ? {
            authenticated: true,
            userId: user.id,
            userRole: user.role || 'user',
            user,
            source: 'cookie',
          }
        : NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    });
    mocks.isTaskCancelled.mockReturnValue(false);
    mocks.recordCloudTaskCancelled.mockResolvedValue({
      transitioned: true,
      task: { id: 'cancelled-task', status: 'cancelled', revision: 1 },
    });
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

  it('keeps a registry-only task cancellable without authoritative persistence', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'memory-only-task',
      userId: 'user-a',
      type: 'edit',
      status: 'processing',
      creditCost: 4,
      persistence: 'memory',
    });
    mocks.getCloudTaskForUser.mockRejectedValue(
      new Error('postgres unavailable'),
    );

    const response = await POST(request('memory-only-task'));

    expect(response.status).toBe(200);
    expect(mocks.getCloudTaskForUser).not.toHaveBeenCalled();
    expect(mocks.cancelTask).toHaveBeenCalledWith('memory-only-task');
    expect(mocks.cancelEditTask).toHaveBeenCalledWith('memory-only-task');
    expect(mocks.refundCredits).toHaveBeenCalledWith(
      'user-a',
      4,
      expect.stringContaining('taskId: memory-only-task'),
      'memory-only-task',
    );
    expect(mocks.recordCloudTaskCancelled).not.toHaveBeenCalled();
    expect(mocks.updateTaskProgress).toHaveBeenCalledWith(
      'memory-only-task',
      { status: 'cancelled', progress: 0 },
    );
  });

  it('uses authoritative atomic settlement when a durable generation slot is temporarily marked memory-only', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'generation-slot-memory-marker',
      userId: 'user-a',
      type: 'generate-async',
      status: 'processing',
      creditCost: 60,
      persistence: 'memory',
      result: {
        submissionPayload: {
          batchId: 'batch-memory-marker',
          slotId: 'batch-memory-marker:0',
          slotIndex: 0,
        },
      },
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'generation-slot-memory-marker',
      userId: 'user-a',
      type: 'generate-async',
      status: 'processing',
      creditCost: 60,
      creditStatus: 'pending',
      result: {
        submissionPayload: {
          batchId: 'batch-memory-marker',
          slotId: 'batch-memory-marker:0',
          slotIndex: 0,
        },
      },
    });

    const response = await POST(request('generation-slot-memory-marker'));

    expect(response.status).toBe(200);
    expect(mocks.getCloudTaskForUser).toHaveBeenCalledWith(
      'generation-slot-memory-marker',
      'user-a',
    );
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith(
      'generation-slot-memory-marker',
      'cancelled',
      '图像生成槽位已取消 (taskId: generation-slot-memory-marker)',
    );
    expect(mocks.refundCredits).not.toHaveBeenCalled();
    expect(mocks.recordCloudTaskCancelled).not.toHaveBeenCalled();
  });

  it('does not project cancelled when authoritative persistence fails', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'task-db-failure',
      userId: 'user-a',
      type: 'generate',
      status: 'processing',
      persistence: 'durable',
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-db-failure',
      userId: 'user-a',
      type: 'generate',
      status: 'processing',
      creditCost: 0,
    });
    mocks.recordCloudTaskCancelled.mockRejectedValue(
      new Error('postgres unavailable'),
    );

    const response = await POST(request('task-db-failure'));

    expect(response.status).toBe(500);
    expect(mocks.cancelTask).toHaveBeenCalledWith('task-db-failure');
    expect(mocks.updateTaskProgress).not.toHaveBeenCalledWith(
      'task-db-failure',
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('does not touch the registry when durable task lookup fails', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'task-db-lookup-failure',
      userId: 'user-a',
      type: 'generate',
      status: 'processing',
      persistence: 'durable',
    });
    mocks.getCloudTaskForUser.mockRejectedValue(
      new Error('postgres unavailable'),
    );

    const response = await POST(request('task-db-lookup-failure'));

    expect(response.status).toBe(500);
    expect(mocks.cancelTask).not.toHaveBeenCalled();
    expect(mocks.cancelEditTask).not.toHaveBeenCalled();
    expect(mocks.updateTaskProgress).not.toHaveBeenCalled();
    expect(mocks.recordCloudTaskCancelled).not.toHaveBeenCalled();
  });

  it('returns a safe unified database error with the caller requestId', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'task-db-error-contract',
      userId: 'user-a',
      type: 'generate',
      status: 'processing',
      persistence: 'durable',
    });
    mocks.getCloudTaskForUser.mockRejectedValue(
      new Error('postgres password=secret connection refused'),
    );

    const response = await POST(
      request('task-db-error-contract', 'req_cancel_contract_01'),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req_cancel_contract_01');
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      success: false,
      code: 'TASK_CANCEL_FAILED',
      message: '取消任务失败，请稍后重试',
      source: 'database',
      retryable: true,
      requestId: 'req_cancel_contract_01',
    }));
  });

  it('retries authoritative persistence when a cancellation signal already exists', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'task-cancel-retry',
      userId: 'user-a',
      type: 'generate',
      status: 'processing',
      persistence: 'durable',
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-cancel-retry',
      userId: 'user-a',
      type: 'generate',
      status: 'processing',
      creditCost: 0,
    });
    mocks.isTaskCancelled.mockReturnValue(true);

    const response = await POST(request('task-cancel-retry'));

    expect(response.status).toBe(200);
    expect(mocks.recordCloudTaskCancelled).toHaveBeenCalledWith(
      'task-cancel-retry',
      false,
    );
  });

  it('settles annotation cancellation and refund from the database terminal state', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'annotation-task',
      userId: 'user-a',
      type: 'edit',
      creditCost: 8,
      persistence: 'durable',
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
    expect(mocks.updateTaskProgress).toHaveBeenCalledWith(
      'annotation-task',
      { status: 'cancelled', progress: 0 },
    );
  });

  it('settles a durable core-v2 edit atomically before a late completion can win', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'core-v2-edit-task',
      userId: 'user-a',
      type: 'edit',
      creditCost: 8,
      persistence: 'durable',
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'core-v2-edit-task',
      userId: 'user-a',
      type: 'edit',
      status: 'processing',
      creditCost: 8,
      creditStatus: 'pending',
    });

    const response = await POST(request('core-v2-edit-task'));

    expect(response.status).toBe(200);
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith(
      'core-v2-edit-task',
      'cancelled',
      expect.stringContaining('core-v2-edit-task'),
    );
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
    expect(mocks.recordCloudTaskCancelled).not.toHaveBeenCalled();
  });

  it('accepts a trusted internal user without requiring a cookie', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-a',
      userRole: 'user',
      user: { id: 'user-a', role: 'user' },
      source: 'internal',
    });
    mocks.getTaskInfo.mockReturnValue(undefined);
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-owned',
      userId: 'user-a',
      type: 'video',
      status: 'processing',
      progress: 20,
      creditStatus: 'pending',
      creditCost: 8,
      createdAt: 1,
      updatedAt: 2,
    });

    const response = await POST(request('task-owned'));

    expect(response.status).toBe(200);
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledOnce();
    expect(mocks.getSessionUser).not.toHaveBeenCalled();
  });

  it('rejects forged internal headers when shared-secret authentication fails', async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(request('task-owned', undefined, {
      'x-internal-request': 'true',
      'x-internal-user-id': 'user-a',
      'x-wujie-internal-secret': 'forged',
    }));

    expect(response.status).toBe(401);
    expect(mocks.getCloudTaskForUser).not.toHaveBeenCalled();
    expect(mocks.cancelTask).not.toHaveBeenCalled();
  });

  it('keeps repeated durable cancellation idempotent through atomic settlement', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue(undefined);
    mocks.getCloudTaskForUser
      .mockResolvedValueOnce({
        id: 'task-repeat', userId: 'user-a', type: 'video', status: 'processing',
        progress: 20, creditStatus: 'pending', creditCost: 8, createdAt: 1, updatedAt: 2,
      })
      .mockResolvedValueOnce({
        id: 'task-repeat', userId: 'user-a', type: 'video', status: 'cancelled',
        progress: 0, creditStatus: 'refunded', creditCost: 8, createdAt: 1, updatedAt: 3,
      })
      .mockResolvedValueOnce({
        id: 'task-repeat', userId: 'user-a', type: 'video', status: 'cancelled',
        progress: 0, creditStatus: 'refunded', creditCost: 8, createdAt: 1, updatedAt: 3,
      });
    mocks.terminateCloudTaskAndRefund
      .mockResolvedValueOnce({
        status: 'cancelled', transitioned: true, refunded: true, creditCost: 8,
      })
      .mockResolvedValueOnce({
        status: 'cancelled', transitioned: false, refunded: false, creditCost: 8,
      });

    const first = await POST(request('task-repeat'));
    const second = await POST(request('task-repeat'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledTimes(2);
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
    expect(mocks.refundCredits).not.toHaveBeenCalled();
  });

  it.each([
    ['brand-ecommerce', 'brand-task'],
    ['font-design', 'font-task'],
  ])('settles %s cancellation atomically before a late completion can win', async (type, taskId) => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId,
      userId: 'user-a',
      type,
      status: 'processing',
      creditCost: 12,
      persistence: 'durable',
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: taskId,
      userId: 'user-a',
      type,
      status: 'processing',
      creditCost: 12,
      creditStatus: 'pending',
    });

    const response = await POST(request(taskId));

    expect(response.status).toBe(200);
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith(
      taskId,
      'cancelled',
      expect.stringContaining(taskId),
    );
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
    expect(mocks.recordCloudTaskCancelled).not.toHaveBeenCalled();
  });

  it('does not report a durable edit cancelled when completion already won', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'core-v2-edit-race',
      userId: 'user-a',
      type: 'edit',
      persistence: 'durable',
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'core-v2-edit-race',
      userId: 'user-a',
      type: 'edit',
      status: 'completed',
      creditCost: 8,
      creditStatus: 'charged',
    });
    mocks.terminateCloudTaskAndRefund.mockResolvedValue({
      status: 'completed',
      transitioned: false,
      refunded: false,
      creditCost: 0,
    });

    const response = await POST(request('core-v2-edit-race'));

    expect(response.status).toBe(409);
    expect(mocks.cancelTask).not.toHaveBeenCalled();
    expect(mocks.cancelEditTask).not.toHaveBeenCalled();
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
  });

  it('settles a durable generation slot atomically so a late provider completion cannot win', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'generation-slot-task',
      userId: 'user-a',
      type: 'generate-async',
      creditCost: 6,
      persistence: 'durable',
      result: {
        submissionPayload: {
          batchId: 'batch-1',
          slotId: 'batch-1:0',
          slotIndex: 0,
        },
      },
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'generation-slot-task',
      userId: 'user-a',
      type: 'generate-async',
      creditCost: 6,
      creditStatus: 'pending',
      result: {
        submissionPayload: {
          batchId: 'batch-1',
          slotId: 'batch-1:0',
          slotIndex: 0,
        },
      },
    });

    const response = await POST(request('generation-slot-task'));

    expect(response.status).toBe(200);
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith(
      'generation-slot-task',
      'cancelled',
      '图像生成槽位已取消 (taskId: generation-slot-task)',
    );
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
    expect(mocks.recordCloudTaskCancelled).not.toHaveBeenCalled();
    expect(mocks.updateTaskProgress).toHaveBeenCalledWith(
      'generation-slot-task',
      { status: 'cancelled', progress: 0 },
    );
  });

  it('does not report a durable generation slot as cancelled when its database terminal transition loses', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'generation-slot-race',
      userId: 'user-a',
      type: 'generate-async',
      creditCost: 6,
      persistence: 'durable',
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'generation-slot-race',
      userId: 'user-a',
      type: 'generate-async',
      status: 'processing',
      creditCost: 6,
      creditStatus: 'pending',
      result: {
        submissionPayload: {
          batchId: 'batch-1',
          slotId: 'batch-1:0',
          slotIndex: 0,
        },
      },
    });
    mocks.terminateCloudTaskAndRefund.mockResolvedValue({
      status: 'completed',
      transitioned: false,
      refunded: false,
      creditCost: 0,
    });

    const response = await POST(request('generation-slot-race'));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: '任务状态已变化，无法取消',
    });
    expect(mocks.cancelTask).not.toHaveBeenCalled();
    expect(mocks.recordCloudTaskCancelled).not.toHaveBeenCalled();
  });

  it('settles a durable video task atomically before its remote poll can complete', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.getTaskInfo.mockReturnValue({
      taskId: 'video-task',
      userId: 'user-a',
      type: 'video',
      creditCost: 50,
      persistence: 'durable',
    });
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'video-task',
      userId: 'user-a',
      type: 'video',
      creditCost: 50,
      creditStatus: 'pending',
    });

    const response = await POST(request('video-task'));

    expect(response.status).toBe(200);
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith(
      'video-task',
      'cancelled',
      '视频任务已取消 (taskId: video-task)',
    );
    expect(mocks.refundCloudTaskCredits).not.toHaveBeenCalled();
    expect(mocks.recordCloudTaskCancelled).not.toHaveBeenCalled();
    expect(mocks.updateTaskProgress).toHaveBeenCalledWith(
      'video-task',
      { status: 'cancelled', progress: 0 },
    );
  });
});
