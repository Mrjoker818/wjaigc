import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createCloudTask,
  getCloudTaskById,
  projectCompletedTaskToAssets,
  recordTaskProjectionCompleted,
  recordTaskLateResultAudit,
  recordTaskProjectionPending,
  transitionCloudTaskStatus,
  transitionTask,
  updateCloudTask,
} = vi.hoisted(() => ({
  createCloudTask: vi.fn(),
  getCloudTaskById: vi.fn(),
  projectCompletedTaskToAssets: vi.fn(),
  recordTaskProjectionCompleted: vi.fn(),
  recordTaskLateResultAudit: vi.fn(),
  recordTaskProjectionPending: vi.fn(),
  transitionCloudTaskStatus: vi.fn(),
  transitionTask: vi.fn(),
  updateCloudTask: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({
  createCloudTask,
  getCloudTaskById,
  transitionCloudTaskStatus,
  updateCloudTask,
}));
vi.mock('@/lib/task-core/task-service', () => ({ transitionTask }));
vi.mock('@/lib/asset-core/task-projector', () => ({
  projectCompletedTaskToAssets,
  recordTaskProjectionCompleted,
  recordTaskLateResultAudit,
  recordTaskProjectionPending,
}));

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
    getCloudTaskById.mockReset();
    projectCompletedTaskToAssets.mockReset().mockResolvedValue({
      versions: [{ id: 'version-result-1' }],
      reused: false,
    });
    recordTaskProjectionCompleted.mockReset().mockResolvedValue(undefined);
    recordTaskLateResultAudit.mockReset().mockResolvedValue(undefined);
    recordTaskProjectionPending.mockReset().mockResolvedValue(undefined);
    transitionCloudTaskStatus.mockReset();
    transitionTask.mockReset().mockResolvedValue({
      transitioned: true,
      task: {
        id: 'terminal-task',
        status: 'completed',
        revision: 1,
      },
    });
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

  it('persists image entry audit facts for the administrator task projection', async () => {
    const taskEntryAudit = {
      entry: 'edit' as const,
      mode: 'shadow' as const,
      handlerVersion: 'task-core-v2-shadow' as const,
      requestId: 'req-image-edit-1',
      requestedProviderId: 'provider-requested',
      requestedModelId: 'model-requested',
      actualProviderId: 'provider-actual',
      actualModelId: 'model-actual',
      startedAt: 1_000,
      updatedAt: 1_200,
      durationMs: 200,
      creditCost: 4,
      creditStatus: 'charged' as const,
    };

    await recordImageTaskSubmitted({
      taskId: 'remote-task-audited',
      userId: 'user-a',
      creditCost: 4,
      creditStatus: 'charged',
      taskEntryAudit,
    });

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      result: { taskEntryAudit },
      creditCost: 4,
      creditStatus: 'charged',
    }));
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
    getCloudTaskById.mockResolvedValueOnce({
      id: 'remote-task-1',
      userId: 'user-a',
      projectId: 'project-a',
      sessionId: '',
      messageId: '',
      status: 'processing',
      result: {
        submissionPayload: {
          prompt: 'preserve me',
          referenceImages: ['source-a'],
        },
      },
    });
    transitionTask.mockResolvedValueOnce({
      transitioned: true,
      task: {
        id: 'remote-task-1',
        userId: 'user-a',
        projectId: 'project-a',
        sessionId: '',
        messageId: '',
        status: 'completed',
        result: {
          submissionPayload: {
            prompt: 'preserve me',
            referenceImages: ['source-a'],
          },
          imageUrl: '/uploads/result.png',
          imageUrls: ['/uploads/result.png'],
          maskUrl: '/uploads/mask.png',
          maskUrls: ['/uploads/mask.png'],
        },
      },
    });

    await recordImageTaskTerminal('remote-task-1', {
      status: 'completed',
      imageUrl: '/uploads/result.png',
      maskUrl: '/uploads/mask.png',
      creditStatus: 'charged',
    });

    expect(transitionTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'remote-task-1',
      from: ['processing'],
      to: 'completed',
      creditStatus: 'charged',
      result: {
        submissionPayload: {
          prompt: 'preserve me',
          referenceImages: ['source-a'],
        },
        imageUrl: '/uploads/result.png',
        imageUrls: ['/uploads/result.png'],
        maskUrl: '/uploads/mask.png',
        maskUrls: ['/uploads/mask.png'],
      },
    }));
    expect(projectCompletedTaskToAssets).toHaveBeenCalledWith({
      actorUserId: 'user-a',
      taskId: 'remote-task-1',
      targetProjectId: 'project-a',
      workspace: 'canvas',
      sourceEntityId: 'remote-task-1',
      parentVersionIds: [],
    });
    expect(recordTaskProjectionCompleted).toHaveBeenCalledWith({
      actorUserId: 'user-a',
      taskId: 'remote-task-1',
      versionIds: ['version-result-1'],
    });
    expect(updateCloudTask).not.toHaveBeenCalled();
  });

  it('keeps the completed terminal authoritative and marks projection_pending on asset failure', async () => {
    getCloudTaskById.mockResolvedValueOnce({
      id: 'remote-task-projection-failure',
      userId: 'user-a',
      projectId: 'project-a',
      sessionId: '',
      messageId: '',
      status: 'processing',
      result: { submissionPayload: { prompt: 'keep terminal completed' } },
    });
    transitionTask.mockResolvedValueOnce({
      transitioned: true,
      task: {
        id: 'remote-task-projection-failure',
        userId: 'user-a',
        projectId: 'project-a',
        sessionId: '',
        messageId: '',
        status: 'completed',
        result: {
          submissionPayload: { prompt: 'keep terminal completed' },
          imageUrl: '/uploads/result.png',
          imageUrls: ['/uploads/result.png'],
        },
      },
    });
    projectCompletedTaskToAssets.mockRejectedValueOnce(new Error('asset database unavailable'));

    const terminal = await recordImageTaskTerminal('remote-task-projection-failure', {
      status: 'completed',
      imageUrl: '/uploads/result.png',
      creditStatus: 'charged',
    });

    expect(terminal?.task.status).toBe('completed');
    expect(recordTaskProjectionPending).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-a',
      taskId: 'remote-task-projection-failure',
      reason: 'asset database unavailable',
    }));
    expect(transitionTask).toHaveBeenCalledTimes(1);
  });

  it('does not fail an already completed task when the projection-pending audit cannot be written', async () => {
    getCloudTaskById.mockResolvedValueOnce({
      id: 'remote-task-pending-write-failure',
      userId: 'user-a',
      projectId: 'project-a',
      status: 'processing',
      result: {},
    });
    transitionTask.mockResolvedValueOnce({
      transitioned: true,
      task: {
        id: 'remote-task-pending-write-failure',
        userId: 'user-a',
        projectId: 'project-a',
        status: 'completed',
        result: { imageUrl: '/result.png' },
      },
    });
    projectCompletedTaskToAssets.mockRejectedValueOnce(new Error('projection failed'));
    recordTaskProjectionPending.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(recordImageTaskTerminal('remote-task-pending-write-failure', {
      status: 'completed',
      imageUrl: '/result.png',
    })).resolves.toMatchObject({ transitioned: true });
  });

  it('isolates a late completed URL when another terminal state won the race', async () => {
    getCloudTaskById.mockResolvedValueOnce({
      id: 'remote-task-1',
      userId: 'user-a',
      status: 'processing',
      result: {},
    });
    transitionTask.mockResolvedValueOnce({
      transitioned: false,
      task: {
        id: 'remote-task-1',
        userId: 'user-a',
        status: 'cancelled',
        result: {},
      },
    });

    await recordImageTaskTerminal('remote-task-1', {
      status: 'completed',
      imageUrl: '/late-result.png',
    });

    expect(recordTaskLateResultAudit).toHaveBeenCalledWith({
      actorUserId: 'user-a',
      taskId: 'remote-task-1',
      terminalStatus: 'cancelled',
      urls: ['/late-result.png'],
    });
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

    expect(transitionTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'remote-task-batch',
      to: 'completed',
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
    expect(updateCloudTask).not.toHaveBeenCalled();
  });

  it('records a failed image task with a readable error', async () => {
    await recordImageTaskTerminal('remote-task-1', {
      status: 'failed',
      error: '上游服务超时',
      creditStatus: 'refunded',
    });

    expect(transitionTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'remote-task-1',
      to: 'failed',
      error: expect.objectContaining({
        code: 'LEGACY_TASK_ERROR',
        message: '上游服务超时',
        source: 'wujie',
        retryable: false,
        requestId: expect.stringMatching(/^req_/),
      }),
      creditStatus: 'refunded',
    }));
    expect(updateCloudTask).not.toHaveBeenCalled();
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
    expect(transitionTask).not.toHaveBeenCalled();
    expect(updateCloudTask).not.toHaveBeenCalled();
  });

  it('records a cancelled task as refunded when cancellation refunds credits', async () => {
    await recordCloudTaskCancelled('remote-task-1', true);

    expect(transitionTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'remote-task-1',
      to: 'cancelled',
      creditStatus: 'refunded',
    }));
    expect(updateCloudTask).not.toHaveBeenCalled();
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

    expect(transitionTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'video-task-1',
      to: 'completed',
      result: {
        videoUrl: '/api/serve-upload/video/video-task-1/result.mp4',
        imageUrl: '/api/serve-upload/video/video-task-1/cover.png',
      },
    }));
    expect(updateCloudTask).not.toHaveBeenCalled();
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
      mergeResult: true,
    }));
    expect(JSON.stringify(updateCloudTask.mock.calls[0][1])).not.toContain('apiKey');
  });

  it('records 3D submission and terminal model URL without provider credentials', async () => {
    await recordThreeDTaskSubmitted({
      taskId: 'three-d-task-1',
      userId: 'user-a',
      projectId: 'project-a',
      sessionId: 'workflow:project-a',
      messageId: 'execution-a:node-3d',
      providerId: 'provider-3d',
      model: 'hunyuan-3d',
      submissionPayload: { prompt: 'product turntable', assetProjectionMode: 'derived' },
    });

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'three-d-task-1',
      projectId: 'project-a',
      sessionId: 'workflow:project-a',
      messageId: 'execution-a:node-3d',
      type: '3d-model',
      providerId: 'provider-3d',
      model: 'hunyuan-3d',
      result: {
        submissionPayload: { prompt: 'product turntable', assetProjectionMode: 'derived' },
      },
    }));
    expect(JSON.stringify(createCloudTask.mock.calls[0][0])).not.toContain('apiKey');

    await recordThreeDTaskTerminal('three-d-task-1', {
      status: 'completed',
      assetUrl: 'https://assets.example/model.glb',
      previewImageUrl: 'https://assets.example/cover.png',
    });

    expect(transitionTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'three-d-task-1',
      to: 'completed',
      result: {
        assetUrl: 'https://assets.example/model.glb',
        previewImageUrl: 'https://assets.example/cover.png',
      },
    }));
    expect(updateCloudTask).not.toHaveBeenCalled();
  });

  it.each([
    ['video', () => recordVideoTaskTerminal('video-task-project', {
      status: 'completed',
      videoUrl: '/uploads/result.mp4',
    })],
    ['3d', () => recordThreeDTaskTerminal('three-d-task-project', {
      status: 'completed',
      assetUrl: '/uploads/result.glb',
    })],
  ] as const)('projects a completed %s task after the durable transition wins', async (_kind, complete) => {
    getCloudTaskById.mockResolvedValueOnce({
      id: 'terminal-task',
      userId: 'user-a',
      projectId: 'project-a',
      status: 'processing',
      result: {},
    });
    transitionTask.mockResolvedValueOnce({
      transitioned: true,
      task: {
        id: 'terminal-task',
        userId: 'user-a',
        projectId: 'project-a',
        status: 'completed',
        result: { videoUrl: '/uploads/result.mp4', assetUrl: '/uploads/result.glb' },
      },
    });

    await complete();

    expect(projectCompletedTaskToAssets).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-a',
      targetProjectId: 'project-a',
      workspace: 'canvas',
    }));
    expect(recordTaskProjectionCompleted).toHaveBeenCalled();
  });

  it.each([
    ['image', () => recordImageTaskTerminal('lost-image', {
      status: 'completed',
      imageUrl: '/lost.png',
      creditStatus: 'charged',
    })],
    ['video', () => recordVideoTaskTerminal('lost-video', {
      status: 'completed',
      videoUrl: '/lost.mp4',
      creditStatus: 'charged',
    })],
    ['3d', () => recordThreeDTaskTerminal('lost-3d', {
      status: 'completed',
      assetUrl: '/lost.glb',
      creditStatus: 'charged',
    })],
    ['cancel', () => recordCloudTaskCancelled('lost-cancel', true)],
  ])('does not overwrite compatibility metadata when the %s terminal CAS loses', async (
    _type,
    recordTerminal,
  ) => {
    transitionTask.mockResolvedValueOnce({
      transitioned: false,
      task: {
        id: 'winner',
        status: 'failed',
        revision: 2,
      },
    });

    await recordTerminal();

    expect(transitionTask).toHaveBeenCalledTimes(1);
    expect(updateCloudTask).not.toHaveBeenCalled();
  });
});
