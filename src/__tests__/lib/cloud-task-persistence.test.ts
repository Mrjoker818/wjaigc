import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCloudTask, updateCloudTask } = vi.hoisted(() => ({
  createCloudTask: vi.fn(),
  updateCloudTask: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({ createCloudTask, updateCloudTask }));

import {
  recordImageTaskSubmitted,
  recordImageTaskTerminal,
  recordCloudTaskCancelled,
  buildRecoveredTaskContext,
  recordThreeDTaskSubmitted,
  recordThreeDTaskTerminal,
  recordVideoTaskRemotePolling,
  recordVideoTaskSubmitted,
  recordVideoTaskTerminal,
} from '@/lib/cloud-task-persistence';

describe('cloud-task-persistence', () => {
  beforeEach(() => {
    createCloudTask.mockReset().mockResolvedValue(true);
    updateCloudTask.mockReset().mockResolvedValue(undefined);
  });

  it('records an image submission without storing provider credentials', async () => {
    const created = await recordImageTaskSubmitted({
      taskId: 'remote-task-1',
      userId: 'user-a',
      providerId: 'provider-a',
      model: 'image-model-a',
      label: '生成图片',
    });

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'remote-task-1',
      userId: 'user-a',
      type: 'generate',
      status: 'processing',
      providerId: 'provider-a',
      model: 'image-model-a',
      remoteTaskId: 'remote-task-1',
    }));
    expect(JSON.stringify(createCloudTask.mock.calls[0][0])).not.toContain('apiKey');
    expect(created).toBe(true);
  });

  it('propagates an idempotency collision to the submitter', async () => {
    createCloudTask.mockResolvedValue(false);

    await expect(recordImageTaskSubmitted({
      taskId: 'remote-task-duplicate',
      userId: 'user-a',
      idempotencyKey: 'retry-key-1',
    })).resolves.toBe(false);
  });

  it('persists batch and slot metadata without provider credentials', async () => {
    await recordImageTaskSubmitted({
      taskId: 'remote-task-slot-2',
      userId: 'user-a',
      batchId: 'batch-a',
      slotId: 'batch-a:1',
      slotIndex: 1,
    });

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      result: {
        submissionPayload: {
          batchId: 'batch-a',
          slotId: 'batch-a:1',
          slotIndex: 1,
        },
      },
    }));
    expect(JSON.stringify(createCloudTask.mock.calls[0][0])).not.toContain('apiKey');
  });

  it('creates a billable child task as pending until the atomic charge succeeds', async () => {
    await recordImageTaskSubmitted({
      taskId: 'remote-task-billable-child',
      userId: 'user-a',
      batchId: 'batch-a',
      slotId: 'batch-a:0',
      slotIndex: 0,
      deferCreditCharge: true,
    });

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'remote-task-billable-child',
      status: 'pending',
      progress: 0,
      creditStatus: 'not-applicable',
      creditCost: 0,
    }));
  });

  it('preserves the editing task type for recovery and filtering', async () => {
    await recordImageTaskSubmitted({
      taskId: 'edit-task-1',
      userId: 'user-a',
      type: 'erase',
      providerId: 'provider-a',
      model: 'image-model-a',
      label: '擦除',
    });

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'edit-task-1',
      type: 'erase',
      label: '擦除',
    }));
  });

  it('records a completed image result as a terminal cloud task state', async () => {
    await recordImageTaskTerminal('remote-task-1', {
      status: 'completed',
      imageUrl: '/uploads/result.png',
      maskUrl: '/uploads/mask.png',
      creditStatus: 'charged',
    });

    expect(updateCloudTask).toHaveBeenCalledWith('remote-task-1', expect.objectContaining({
      status: 'completed',
      progress: 100,
      creditStatus: 'charged',
      result: {
        imageUrl: '/uploads/result.png',
        imageUrls: ['/uploads/result.png'],
        maskUrl: '/uploads/mask.png',
        maskUrls: ['/uploads/mask.png'],
      },
    }));
  });

  it('persists all batch image and mask URLs while keeping the first item compatible', async () => {
    await recordImageTaskTerminal('remote-task-batch', {
      status: 'completed',
      imageUrl: '/uploads/result-1.png',
      imageUrls: [
        '/uploads/result-1.png',
        '/uploads/result-2.png',
        '/uploads/result-1.png',
        '/uploads/result-3.png',
      ],
      maskUrl: '/uploads/mask-1.png',
      maskUrls: ['/uploads/mask-1.png', '/uploads/mask-2.png'],
      creditStatus: 'charged',
    });

    expect(updateCloudTask).toHaveBeenCalledWith('remote-task-batch', expect.objectContaining({
      status: 'completed',
      progress: 100,
      creditStatus: 'charged',
      result: {
        imageUrl: '/uploads/result-1.png',
        imageUrls: [
          '/uploads/result-1.png',
          '/uploads/result-2.png',
          '/uploads/result-3.png',
        ],
        maskUrl: '/uploads/mask-1.png',
        maskUrls: ['/uploads/mask-1.png', '/uploads/mask-2.png'],
      },
    }));
  });

  it('records a failed image task with a readable error', async () => {
    await recordImageTaskTerminal('remote-task-1', {
      status: 'failed',
      error: '上游服务超时',
      creditStatus: 'refunded',
    });

    expect(updateCloudTask).toHaveBeenCalledWith('remote-task-1', expect.objectContaining({
      status: 'failed',
      progress: 0,
      error: '上游服务超时',
      creditStatus: 'refunded',
    }));
  });

  it('does not persist an internal image task when its outer task owns monitoring', async () => {
    await recordImageTaskSubmitted({
      taskId: 'internal-direct-task',
      userId: 'user-a',
      providerId: 'provider-a',
      model: 'image-model-a',
      persist: false,
    });
    await recordImageTaskTerminal('internal-direct-task', {
      status: 'completed',
      imageUrl: '/uploads/result.png',
      persist: false,
    });

    expect(createCloudTask).not.toHaveBeenCalled();
    expect(updateCloudTask).not.toHaveBeenCalled();
  });

  it('records a cancelled task as refunded when cancellation refunds credits', async () => {
    await recordCloudTaskCancelled('remote-task-1', true);

    expect(updateCloudTask).toHaveBeenCalledWith('remote-task-1', expect.objectContaining({
      status: 'cancelled',
      progress: 0,
      creditStatus: 'refunded',
    }));
  });

  it('builds recovery context without credentials or request payloads', () => {
    const context = buildRecoveredTaskContext({
      id: 'remote-task-1', userId: 'user-a', type: 'generate', status: 'processing',
      providerId: 'provider-a', model: 'image-model-a', remoteTaskId: 'remote-id',
      progress: 35, label: '生成图片', creditStatus: 'charged', createdAt: 1, updatedAt: 2,
      result: { apiKey: 'must-not-copy', imageUrl: 'https://example.com/old.png' },
    });

    expect(context).toEqual({
      taskId: 'remote-task-1', remoteTaskId: 'remote-id', providerId: 'provider-a',
      model: 'image-model-a', type: 'generate', progress: 35, label: '生成图片', userId: 'user-a',
    });
    expect(JSON.stringify(context)).not.toContain('apiKey');
  });

  it('records video submission and completion without provider credentials', async () => {
    await recordVideoTaskSubmitted({
      taskId: 'video-task-1',
      userId: 'user-a',
      type: 'video-extend',
      providerId: 'provider-video',
      model: 'video-model-a',
    });

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'video-task-1',
      type: 'video-extend',
      providerId: 'provider-video',
      model: 'video-model-a',
    }));
    expect(JSON.stringify(createCloudTask.mock.calls[0][0])).not.toContain('apiKey');

    await recordVideoTaskTerminal('video-task-1', {
      status: 'completed',
      videoUrl: '/api/serve-upload/video/video-task-1/result.mp4',
      imageUrl: '/api/serve-upload/video/video-task-1/cover.png',
    });

    expect(updateCloudTask).toHaveBeenCalledWith('video-task-1', expect.objectContaining({
      status: 'completed',
      progress: 100,
      result: {
        videoUrl: '/api/serve-upload/video/video-task-1/result.mp4',
        imageUrl: '/api/serve-upload/video/video-task-1/cover.png',
      },
    }));
  });

  it('creates a video task as pending until its atomic credit charge succeeds', async () => {
    await recordVideoTaskSubmitted({
      taskId: 'video-task-pending-charge',
      userId: 'user-a',
      providerId: 'provider-video',
      model: 'video-model-a',
      creditCost: 25,
      deferCreditCharge: true,
    });

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'video-task-pending-charge',
      status: 'pending',
      progress: 0,
      creditStatus: 'not-applicable',
      creditCost: 0,
    }));
  });

  it('persists the third-party video task ID required after a server restart', async () => {
    await recordVideoTaskRemotePolling('video-task-1', {
      remoteTaskId: 'supplier-video-task-9',
      usedImagesEndpoint: true,
    });

    expect(updateCloudTask).toHaveBeenCalledWith('video-task-1', expect.objectContaining({
      remoteTaskId: 'supplier-video-task-9',
      progress: 10,
      result: {
        thirdPartyTaskId: 'supplier-video-task-9',
        usedImagesEndpoint: true,
      },
    }));
    expect(JSON.stringify(updateCloudTask.mock.calls[0][1])).not.toContain('apiKey');
  });

  it('records 3D submission and terminal model URL without provider credentials', async () => {
    await recordThreeDTaskSubmitted({
      taskId: 'three-d-task-1',
      userId: 'user-a',
      providerId: 'provider-3d',
      model: 'hunyuan-3d',
    });

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'three-d-task-1',
      type: '3d-model',
      providerId: 'provider-3d',
      model: 'hunyuan-3d',
    }));
    expect(JSON.stringify(createCloudTask.mock.calls[0][0])).not.toContain('apiKey');

    await recordThreeDTaskTerminal('three-d-task-1', {
      status: 'completed',
      assetUrl: 'https://assets.example/model.glb',
      previewImageUrl: 'https://assets.example/cover.png',
    });

    expect(updateCloudTask).toHaveBeenCalledWith('three-d-task-1', expect.objectContaining({
      status: 'completed',
      result: {
        assetUrl: 'https://assets.example/model.glb',
        previewImageUrl: 'https://assets.example/cover.png',
      },
    }));
  });
});
