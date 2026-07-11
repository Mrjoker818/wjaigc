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
  recordVideoTaskSubmitted,
  recordVideoTaskTerminal,
} from '@/lib/cloud-task-persistence';

describe('cloud-task-persistence', () => {
  beforeEach(() => {
    createCloudTask.mockReset().mockResolvedValue(undefined);
    updateCloudTask.mockReset().mockResolvedValue(undefined);
  });

  it('records an image submission without storing provider credentials', async () => {
    await recordImageTaskSubmitted({
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
      result: { imageUrl: '/uploads/result.png', maskUrl: '/uploads/mask.png' },
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
