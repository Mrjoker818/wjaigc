import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calculateConfiguredCreditCost: vi.fn(),
  executeElementBoardTask: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  completeCloudTask: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
  updateCloudTask: vi.fn(),
  resolveElementBoardProvider: vi.fn(),
  submitElementBoardProviderTask: vi.fn(),
  pollElementBoardProviderTask: vi.fn(),
  cancelElementBoardProviderTask: vi.fn(),
}));

// @ts-expect-error Vitest supports virtual module mocks at runtime.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('@/lib/credits', () => ({ calculateConfiguredCreditCost: mocks.calculateConfiguredCreditCost }));
vi.mock('@/lib/element-decomposition/board-task', () => ({ executeElementBoardTask: mocks.executeElementBoardTask }));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: mocks.getCloudTaskForUser,
  completeCloudTask: mocks.completeCloudTask,
  terminateCloudTaskAndRefund: mocks.terminateCloudTaskAndRefund,
  updateCloudTask: mocks.updateCloudTask,
}));
vi.mock('@/lib/element-decomposition/board-provider', () => ({
  resolveElementBoardProvider: mocks.resolveElementBoardProvider,
}));
vi.mock('@/lib/element-decomposition/board-provider-client', () => ({
  submitElementBoardProviderTask: mocks.submitElementBoardProviderTask,
  pollElementBoardProviderTask: mocks.pollElementBoardProviderTask,
  cancelElementBoardProviderTask: mocks.cancelElementBoardProviderTask,
}));

const provider = {
  id: 'image-provider', name: 'Image provider', baseUrl: 'https://images.example.com/v1',
  apiKey: 'secret', isEnabled: true, type: 'image', modelType: 'image',
  selectedModels: ['gpt-image-1'], discoveredModels: [], createdAt: 1, updatedAt: 1,
};

const input = {
  userId: 'user-1', userRole: 'user', idempotencyKey: 'board-key',
  sourceUrl: '/api/serve-upload/source.png', sourceHash: 'a'.repeat(64),
  aspectRatio: '16:9', background: 'transparent' as const,
  providerId: 'image-provider', modelId: 'gpt-image-1',
};

describe('element board persistent executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveElementBoardProvider.mockResolvedValue({ provider, modelId: 'gpt-image-1' });
    mocks.calculateConfiguredCreditCost.mockResolvedValue(7);
    mocks.executeElementBoardTask.mockImplementation(async (args: { submit: () => Promise<unknown> }) => {
      const submitted = await args.submit();
      return { taskId: 'board_local', status: 'processing', progress: 10, ...(submitted as object) };
    });
    mocks.submitElementBoardProviderTask.mockResolvedValue({ remoteTaskId: 'remote-1', usedModel: 'gpt-image-1' });
    mocks.completeCloudTask.mockResolvedValue(true);
    mocks.terminateCloudTaskAndRefund.mockResolvedValue({ transitioned: true, refunded: true, creditCost: 7 });
    mocks.updateCloudTask.mockResolvedValue(true);
  });

  it('authorizes and prices the exact model before returning the local board task', async () => {
    const { submitElementBoard } = await import('@/lib/element-decomposition/board-executor');
    const result = await submitElementBoard(input);

    expect(mocks.resolveElementBoardProvider).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'image-provider', modelId: 'gpt-image-1', userId: 'user-1',
    }));
    expect(mocks.calculateConfiguredCreditCost).toHaveBeenCalledWith(
      'image_edit', 'gpt-image-1', { providerId: 'image-provider' },
    );
    expect(mocks.executeElementBoardTask).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', idempotencyKey: 'board-key', creditCost: 7,
      request: expect.objectContaining({ providerId: 'image-provider', modelId: 'gpt-image-1' }),
    }));
    expect(result.taskId).toBe('board_local');
  });

  it('polls the stored remote task and commits the local task exactly once', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'board_local', userId: 'user-1', type: 'element-board', status: 'processing',
      providerId: 'image-provider', model: 'gpt-image-1', remoteTaskId: 'remote-1',
      progress: 10, creditStatus: 'pending', creditCost: 7, createdAt: 1, updatedAt: 1,
      result: { request: input },
    });
    mocks.pollElementBoardProviderTask.mockResolvedValue({ status: 'completed', progress: 100, imageUrl: '/result.png' });
    const { pollElementBoard } = await import('@/lib/element-decomposition/board-executor');
    const result = await pollElementBoard({ taskId: 'board_local', userId: 'user-1', userRole: 'user' });

    expect(mocks.pollElementBoardProviderTask).toHaveBeenCalledWith(expect.objectContaining({ remoteTaskId: 'remote-1' }));
    expect(mocks.completeCloudTask).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ taskId: 'board_local', status: 'completed', result: { imageUrl: '/result.png' } });
  });

  it('does not report cancellation when downstream cancellation fails', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'board_local', userId: 'user-1', type: 'element-board', status: 'processing',
      providerId: 'image-provider', model: 'gpt-image-1', remoteTaskId: 'remote-1',
      progress: 10, creditStatus: 'pending', creditCost: 7, createdAt: 1, updatedAt: 1,
    });
    mocks.cancelElementBoardProviderTask.mockRejectedValue(new Error('provider does not support cancellation'));
    const { cancelElementBoard } = await import('@/lib/element-decomposition/board-executor');

    await expect(cancelElementBoard({ taskId: 'board_local', userId: 'user-1', userRole: 'user' }))
      .rejects.toThrow('provider does not support cancellation');
    expect(mocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
  });

  it('returns a completed persisted task without polling the provider again', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'board_local', userId: 'user-1', type: 'element-board', status: 'completed',
      providerId: 'image-provider', model: 'gpt-image-1', remoteTaskId: 'remote-1',
      progress: 100, creditStatus: 'charged', creditCost: 7, createdAt: 1, updatedAt: 2,
      result: { imageUrl: '/result.png' },
    });
    const { pollElementBoard } = await import('@/lib/element-decomposition/board-executor');

    await expect(pollElementBoard({ taskId: 'board_local', userId: 'user-1', userRole: 'user' }))
      .resolves.toMatchObject({ status: 'completed', result: { imageUrl: '/result.png' } });
    expect(mocks.pollElementBoardProviderTask).not.toHaveBeenCalled();
    expect(mocks.completeCloudTask).not.toHaveBeenCalled();
  });

  it('settles a remote failure once and returns the provider error', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'board_local', userId: 'user-1', type: 'element-board', status: 'processing',
      providerId: 'image-provider', model: 'gpt-image-1', remoteTaskId: 'remote-1',
      progress: 40, creditStatus: 'pending', creditCost: 7, createdAt: 1, updatedAt: 2,
      result: { request: input },
    });
    mocks.pollElementBoardProviderTask.mockResolvedValue({ status: 'failed', progress: 80, error: 'provider failed' });
    const { pollElementBoard } = await import('@/lib/element-decomposition/board-executor');

    await expect(pollElementBoard({ taskId: 'board_local', userId: 'user-1', userRole: 'user' }))
      .resolves.toMatchObject({ status: 'failed', error: 'provider failed' });
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledTimes(1);
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith('board_local', 'failed', 'provider failed');
    expect(mocks.completeCloudTask).not.toHaveBeenCalled();
  });

  it('reloads the authoritative terminal state when late completion loses the race', async () => {
    const liveTask = {
      id: 'board_local', userId: 'user-1', type: 'element-board', status: 'processing',
      providerId: 'image-provider', model: 'gpt-image-1', remoteTaskId: 'remote-1',
      progress: 40, creditStatus: 'pending', creditCost: 7, createdAt: 1, updatedAt: 2,
      result: { request: input },
    };
    mocks.getCloudTaskForUser
      .mockResolvedValueOnce(liveTask)
      .mockResolvedValueOnce({ ...liveTask, status: 'cancelled', creditStatus: 'refunded', error: 'cancelled' });
    mocks.pollElementBoardProviderTask.mockResolvedValue({ status: 'completed', progress: 100, imageUrl: '/late.png' });
    mocks.completeCloudTask.mockResolvedValue(false);
    const { pollElementBoard } = await import('@/lib/element-decomposition/board-executor');

    await expect(pollElementBoard({ taskId: 'board_local', userId: 'user-1', userRole: 'user' }))
      .resolves.toMatchObject({ status: 'cancelled', error: 'cancelled' });
    expect(mocks.completeCloudTask).toHaveBeenCalledTimes(1);
  });

  it('settles cancellation only after the provider confirms cancellation', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'board_local', userId: 'user-1', type: 'element-board', status: 'processing',
      providerId: 'image-provider', model: 'gpt-image-1', remoteTaskId: 'remote-1',
      progress: 40, creditStatus: 'pending', creditCost: 7, createdAt: 1, updatedAt: 2,
    });
    mocks.cancelElementBoardProviderTask.mockResolvedValue(undefined);
    const { cancelElementBoard } = await import('@/lib/element-decomposition/board-executor');

    await expect(cancelElementBoard({ taskId: 'board_local', userId: 'user-1', userRole: 'user' }))
      .resolves.toMatchObject({ status: 'cancelled' });
    expect(mocks.cancelElementBoardProviderTask).toHaveBeenCalledTimes(1);
    expect(mocks.terminateCloudTaskAndRefund).toHaveBeenCalledTimes(1);
  });
});
