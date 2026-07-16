import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const { createCloudTask, updateCloudTask } = vi.hoisted(() => ({
  createCloudTask: vi.fn(),
  updateCloudTask: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => ({ createCloudTask, updateCloudTask }));

import {
  recordAgentTaskSubmitted,
  recordAgentTaskProgress,
  recordAgentTaskTerminal,
} from '@/lib/agent-task-persistence';

describe('agent task persistence', () => {
  beforeEach(() => {
    createCloudTask.mockReset().mockResolvedValue(true);
    updateCloudTask.mockReset().mockResolvedValue(undefined);
  });

  it('persists an owner-scoped agent task without credentials', async () => {
    await expect(recordAgentTaskSubmitted({
      taskId: 'agent-1', userId: 'user-1', providerId: 'provider-1', model: 'chat-model', label: 'Analyzing',
    })).resolves.toBe(true);

    expect(createCloudTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'agent-1', userId: 'user-1', type: 'agent-edit', providerId: 'provider-1', model: 'chat-model', status: 'processing',
    }));
    expect(JSON.stringify(createCloudTask.mock.calls[0][0])).not.toContain('apiKey');
  });

  it('persists progress and a terminal step summary', async () => {
    await recordAgentTaskProgress('agent-1', 55, 'Editing');
    await recordAgentTaskTerminal('agent-1', {
      status: 'completed', imageUrl: '/result.png', steps: [{ toolName: 'image_edit', success: true }], finalResponse: 'Done',
    });

    expect(updateCloudTask).toHaveBeenCalledWith('agent-1', expect.objectContaining({ progress: 55, label: 'Editing' }));
    expect(updateCloudTask).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      status: 'completed', progress: 100, result: expect.objectContaining({ imageUrl: '/result.png', finalResponse: 'Done' }),
    }));
  });

  it('records non-completed terminal states without presenting stale progress', async () => {
    await recordAgentTaskTerminal('agent-1', {
      status: 'timeout', error: 'Agent task timed out',
    });

    expect(updateCloudTask).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      status: 'timeout', progress: 0, error: 'Agent task timed out', creditStatus: 'not-applicable',
    }));
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
