import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const {
  createCloudTask,
  getCloudTaskById,
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
  projectCompletedTaskToAssets: vi.fn(),
  recordTaskProjectionCompleted: vi.fn(),
  recordTaskProjectionPending: vi.fn(),
  recordTaskLateResultAudit: vi.fn(),
  settleFailedTask: vi.fn(),
  transitionTask: vi.fn(),
  updateCloudTask: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({ createCloudTask, getCloudTaskById, updateCloudTask }));
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
      versions: [{ id: 'version-agent-1' }],
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

  it('records non-completed terminal states without presenting stale progress', async () => {
    await recordAgentTaskTerminal('agent-1', {
      status: 'timeout', error: 'Agent task timed out',
    });

    expect(settleFailedTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'agent-1',
      status: 'timeout',
      error: expect.objectContaining({ message: 'Agent task timed out' }),
    }));
    expect(updateCloudTask).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      result: expect.objectContaining({
        taskError: expect.objectContaining({ code: 'AGENT_TASK_ERROR', retryable: true }),
      }),
      expectedStatuses: ['processing'],
    }));
  });

  it('persists a structured submission_unknown code before exactly-once settlement', async () => {
    await recordAgentTaskTerminal('agent-1', {
      status: 'failed',
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN',
      error: 'Submission outcome is unknown',
      retryable: false,
    });

    expect(updateCloudTask).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      result: expect.objectContaining({
        taskError: expect.objectContaining({
          code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN',
          retryable: false,
        }),
      }),
    }));
    expect(settleFailedTask).toHaveBeenCalledTimes(1);
  });

  it('records the successful asset projection for the terminal transition winner', async () => {
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

  it('rejects a failed projection when durable settlement does not transition', async () => {
    settleFailedTask.mockResolvedValueOnce({ transitioned: false, refunded: false });

    await expect(recordAgentTaskTerminal('agent-1', {
      status: 'failed', error: 'Provider failed',
    })).rejects.toThrow('Agent task terminal transition conflict');
  });

  it('wires agent-edit task lifecycle through persistent storage', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/agent-edit/route.ts'), 'utf8');
    expect(source).toContain('recordAgentTaskSubmitted');
    expect(source).toContain('recordAgentTaskProgress');
    expect(source).toContain('recordAgentTaskTerminal');
    expect(source).toContain('getCloudTaskForUser');
    expect(source).toContain("status: 'timeout'");
    expect(source).toContain('sessionId');
    expect(source).toContain('messageId');
    expect(source).toContain('projectId: typeof projectId');
  });
});
