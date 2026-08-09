import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const { createCloudTask, getCloudTaskById, settleFailedTask, transitionTask, updateCloudTask } = vi.hoisted(() => ({
  createCloudTask: vi.fn(),
  getCloudTaskById: vi.fn(),
  settleFailedTask: vi.fn(),
  transitionTask: vi.fn(),
  updateCloudTask: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({ createCloudTask, getCloudTaskById, updateCloudTask }));
vi.mock('@/lib/task-core/billing-service', () => ({ settleFailedTask }));
vi.mock('@/lib/task-core/task-service', () => ({ transitionTask }));

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
  });

  it('rejects a completed projection when the durable transition loses a race', async () => {
    transitionTask.mockResolvedValueOnce({
      transitioned: false,
      task: { status: 'cancelled' },
    });

    await expect(recordAgentTaskTerminal('agent-1', {
      status: 'completed', imageUrl: '/late-result.png', finalResponse: 'Done',
    })).rejects.toThrow('Agent task terminal transition conflict');
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
  });
});
