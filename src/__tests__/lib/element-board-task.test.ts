import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claimElementBoardTask: vi.fn(),
  createElementBoardRequestHash: vi.fn(() => 'request-hash'),
  chargeCloudTaskCredits: vi.fn(),
  completeCloudTask: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
  updateCloudTask: vi.fn(),
}));

vi.mock('@/lib/element-decomposition/board-idempotency', () => ({
  claimElementBoardTask: mocks.claimElementBoardTask,
  createElementBoardRequestHash: mocks.createElementBoardRequestHash,
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  chargeCloudTaskCredits: mocks.chargeCloudTaskCredits,
  completeCloudTask: mocks.completeCloudTask,
  getCloudTaskForUser: mocks.getCloudTaskForUser,
  terminateCloudTaskAndRefund: mocks.terminateCloudTaskAndRefund,
  updateCloudTask: mocks.updateCloudTask,
}));

const request = {
  sourceHash: 'a'.repeat(64),
  sourceUrl: '/api/serve-upload/source.png',
  aspectRatio: '16:9',
  background: 'transparent',
  providerId: 'pear',
  modelId: 'gpt-image',
};

describe('element board task execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimElementBoardTask.mockResolvedValue({ owner: true, taskId: 'board-local' });
    mocks.chargeCloudTaskCredits.mockResolvedValue({ charged: true, creditCost: 9, userId: 'user-1' });
    mocks.completeCloudTask.mockResolvedValue(true);
    mocks.updateCloudTask.mockResolvedValue(true);
    mocks.terminateCloudTaskAndRefund.mockResolvedValue({ transitioned: true, refunded: true, creditCost: 9 });
  });

  it('charges and submits only for the idempotency owner', async () => {
    const { executeElementBoardTask } = await import('@/lib/element-decomposition/board-task');
    const submit = vi.fn().mockResolvedValue({ remoteTaskId: 'remote-1', usedModel: 'gpt-image' });

    const result = await executeElementBoardTask({
      userId: 'user-1',
      idempotencyKey: 'board-request-key',
      request,
      creditCost: 9,
      submit,
    });

    expect(mocks.chargeCloudTaskCredits).toHaveBeenCalledWith(
      'board-local', 'user-1', 9, expect.any(String),
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(mocks.updateCloudTask).toHaveBeenCalledWith('board-local', expect.objectContaining({
      remoteTaskId: 'remote-1',
      creditCost: 9,
      expectedStatuses: ['processing'],
    }));
    expect(result).toMatchObject({ taskId: 'board-local', remoteTaskId: 'remote-1', status: 'processing' });
  });

  it('returns the existing task without another charge or provider submission', async () => {
    const { executeElementBoardTask } = await import('@/lib/element-decomposition/board-task');
    mocks.claimElementBoardTask.mockResolvedValueOnce({ owner: false, taskId: 'board-existing' });
    mocks.getCloudTaskForUser.mockResolvedValueOnce({
      id: 'board-existing', userId: 'user-1', type: 'element-board', status: 'processing',
      progress: 25, creditStatus: 'pending', creditCost: 9, createdAt: 1, updatedAt: 1,
      remoteTaskId: 'remote-existing', result: { usedModel: 'gpt-image' },
    });
    const submit = vi.fn();

    const result = await executeElementBoardTask({
      userId: 'user-1', idempotencyKey: 'board-request-key', request, creditCost: 9, submit,
    });

    expect(mocks.chargeCloudTaskCredits).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ taskId: 'board-existing', remoteTaskId: 'remote-existing', status: 'processing' });
  });

  it('commits a direct image only while the task is still processing', async () => {
    const { executeElementBoardTask } = await import('@/lib/element-decomposition/board-task');
    const result = await executeElementBoardTask({
      userId: 'user-1', idempotencyKey: 'board-request-key', request, creditCost: 9,
      submit: vi.fn().mockResolvedValue({ directUrl: '/result.png', usedModel: 'gpt-image' }),
    });

    expect(mocks.completeCloudTask).toHaveBeenCalledWith('board-local', expect.objectContaining({
      imageUrl: '/result.png',
    }));
    expect(result).toMatchObject({ taskId: 'board-local', status: 'completed', imageUrl: '/result.png' });
  });

  it('settles a provider submission failure exactly once', async () => {
    const { executeElementBoardTask } = await import('@/lib/element-decomposition/board-task');
    const failure = new Error('provider failed');

    await expect(executeElementBoardTask({
      userId: 'user-1', idempotencyKey: 'board-request-key', request, creditCost: 9,
      submit: vi.fn().mockRejectedValue(failure),
    })).rejects.toThrow('provider failed');

    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledTimes(1);
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith(
      'board-local', 'failed', expect.stringContaining('provider failed'),
    );
  });
});
