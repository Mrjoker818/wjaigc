import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createCloudTask,
  getCloudTaskById,
  getCloudTaskForUser,
  projectCompletedTaskToAssets,
  recordTaskProjectionCompleted,
  recordTaskProjectionPending,
  recordTaskLateResultAudit,
  settleFailedTask,
  transitionTask,
  updateCloudTask,
} = vi.hoisted(() => ({
  createCloudTask: vi.fn(),
  getCloudTaskById: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  projectCompletedTaskToAssets: vi.fn(),
  recordTaskProjectionCompleted: vi.fn(),
  recordTaskProjectionPending: vi.fn(),
  recordTaskLateResultAudit: vi.fn(),
  settleFailedTask: vi.fn(),
  transitionTask: vi.fn(),
  updateCloudTask: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({ createCloudTask, getCloudTaskById, getCloudTaskForUser, updateCloudTask }));
vi.mock('@/lib/collaboration/task-result-publication', () => ({ projectCanvasTaskResult: async () => null }));
vi.mock('@/lib/task-core/billing-service', () => ({ settleFailedTask }));
vi.mock('@/lib/task-core/task-service', () => ({ transitionTask }));
vi.mock('@/lib/asset-core/task-projector', () => ({
  projectCompletedTaskToAssets,
  recordTaskProjectionCompleted,
  recordTaskProjectionPending,
  recordTaskLateResultAudit,
}));

import {
  recordAgentTaskSubmitted,
  recordAgentTaskProgress,
  recordAgentTaskTerminal,
} from '@/lib/agent-task-persistence';

describe('agent task persistence', () => {
  beforeEach(() => {
    getCloudTaskForUser.mockReset().mockResolvedValue(null);
    createCloudTask.mockReset().mockResolvedValue(true);
    getCloudTaskById.mockReset().mockResolvedValue({
      id: 'agent-1',
      status: 'processing',
      result: { taskEntryAudit: { requestId: 'req-agent-1' } },
      creditStatus: 'charged',
    });
    settleFailedTask.mockReset().mockResolvedValue({ transitioned: true, refunded: true });
    transitionTask.mockReset().mockResolvedValue({ transitioned: true, task: { status: 'completed' } });
    updateCloudTask.mockReset().mockResolvedValue(undefined);
    projectCompletedTaskToAssets.mockReset().mockResolvedValue({
      versions: [{ id: 'version-agent-1', assetId: 'asset-agent-1', file: { url: '/result.png' } }],
      placements: [{ id: 'placement-agent-1', entityId: 'entity-agent-1' }],
      reused: false,
    });
    recordTaskProjectionCompleted.mockReset().mockResolvedValue(undefined);
    recordTaskProjectionPending.mockReset().mockResolvedValue(undefined);
    recordTaskLateResultAudit.mockReset().mockResolvedValue(undefined);
  });

  it('persists an owner-scoped agent task without credentials', async () => {
    await expect(recordAgentTaskSubmitted({
      taskId: 'agent-1', userId: 'user-1', providerId: 'provider-1', model: 'chat-model', label: 'Analyzing',
      creditCost: 6,
      creditStatus: 'charged',
      taskEntryAudit: {
        entry: 'agent', mode: 'shadow', handlerVersion: 'task-core-v2-shadow', requestId: 'req-agent-1',
        startedAt: 1, updatedAt: 1, durationMs: 0, creditCost: 6, creditStatus: 'charged',
      },
    })).resolves.toBe(true);

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'agent-1', userId: 'user-1', type: 'agent-edit', providerId: 'provider-1', model: 'chat-model', status: 'processing',
      creditCost: 6,
      creditStatus: 'charged',
      result: { taskEntryAudit: expect.objectContaining({ requestId: 'req-agent-1' }) },
    }));
    expect(JSON.stringify(createCloudTask.mock.calls[0][0])).not.toContain('apiKey');
  });

  it('persists progress and a terminal step summary', async () => {
    await recordAgentTaskProgress('agent-1', 55, 'Editing');
    await recordAgentTaskTerminal('agent-1', {
      status: 'completed', imageUrl: '/result.png', steps: [{ toolName: 'image_edit', success: true }], finalResponse: 'Done',
    });

    expect(updateCloudTask).toHaveBeenCalledWith('agent-1', expect.objectContaining({ progress: 55, label: 'Editing' }));
    expect(transitionTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'agent-1',
      from: ['processing'],
      to: 'completed',
      result: expect.objectContaining({
        taskEntryAudit: { requestId: 'req-agent-1' },
        imageUrl: '/result.png',
        finalResponse: 'Done',
      }),
    }));
  });

  it('settles non-completed terminal facts atomically without a prewrite', async () => {
    await recordAgentTaskTerminal('agent-1', {
      status: 'timeout', error: 'Agent task timed out',
    });

    expect(settleFailedTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'agent-1',
      status: 'timeout',
      error: expect.objectContaining({ message: 'Agent task timed out' }),
    }));
    expect(updateCloudTask).not.toHaveBeenCalled();
  });

  it('passes a structured submission_unknown error to exactly-once settlement without a result prewrite', async () => {
    await recordAgentTaskTerminal('agent-1', {
      status: 'failed',
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN',
      error: 'Submission outcome is unknown',
      retryable: false,
      imageUrl: '/partially-complete.png',
      steps: [{ toolName: 'image_edit', success: false }],
      finalResponse: 'The provider accepted the edit before failing',
    });

    expect(settleFailedTask).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN',
        retryable: false,
      }),
      result: {
        imageUrl: '/partially-complete.png',
        steps: [{ toolName: 'image_edit', success: false }],
        finalResponse: 'The provider accepted the edit before failing',
      },
    }));
    expect(updateCloudTask).not.toHaveBeenCalled();
    expect(settleFailedTask).toHaveBeenCalledTimes(1);
  });

  it('records the successful asset projection for the terminal transition winner', async () => {
    getCloudTaskForUser.mockResolvedValue({ id: 'agent-1', userId: 'user-1', projectId: 'project-1',
      sessionId: 'workflow:project-1', messageId: 'message-1', status: 'completed', result: { imageUrl: '/result.png' } });
    transitionTask.mockResolvedValueOnce({ transitioned: true, task: { id: 'agent-1', userId: 'user-1', status: 'completed' } });
    getCloudTaskById.mockResolvedValueOnce({
      id: 'agent-1',
      userId: 'user-1',
      projectId: 'project-1',
      sessionId: 'workflow:project-1',
      messageId: 'message-1',
      status: 'processing',
      result: {},
      creditStatus: 'charged',
    });

    await recordAgentTaskTerminal('agent-1', {
      status: 'completed',
      imageUrl: '/result.png',
      finalResponse: 'Done',
    });

    expect(recordTaskProjectionCompleted).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      taskId: 'agent-1',
      versionIds: ['version-agent-1'],
      references: [{ assetId: 'asset-agent-1', assetVersionId: 'version-agent-1', placementId: 'placement-agent-1', entityId: 'entity-agent-1', url: '/result.png' }],
    });
    expect(projectCompletedTaskToAssets).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'workflow',
      workspaceId: 'workflow:project-1',
      sourceEntityId: 'message-1',
    }));
  });

  it('isolates a late completed image when a failed terminal state wins the race', async () => {
    transitionTask.mockResolvedValueOnce({
      transitioned: false,
      task: { id: 'agent-1', userId: 'user-1', status: 'cancelled' },
    });

    await expect(recordAgentTaskTerminal('agent-1', {
      status: 'completed', imageUrl: '/late-result.png', finalResponse: 'Done',
    })).resolves.toBeUndefined();

    expect(projectCompletedTaskToAssets).not.toHaveBeenCalled();
    expect(recordTaskLateResultAudit).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      taskId: 'agent-1',
      terminalStatus: 'cancelled',
      urls: ['/late-result.png'],
    });
  });

  it('leaves a different durable terminal winner untouched when settlement does not transition', async () => {
    settleFailedTask.mockResolvedValueOnce({ transitioned: false, refunded: false });

    await expect(recordAgentTaskTerminal('agent-1', {
      status: 'failed', error: 'Provider failed',
    })).resolves.toBeUndefined();
  });

});
