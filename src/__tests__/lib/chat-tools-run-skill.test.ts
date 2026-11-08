import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn().mockResolvedValue({}),
}));

const { createSkillRun, dispatchSkillRunExecution, getSkillRun } = vi.hoisted(() => ({
  createSkillRun: vi.fn(),
  dispatchSkillRunExecution: vi.fn(),
  getSkillRun: vi.fn(),
}));
vi.mock('@/lib/skill-runtime/service', () => ({
  createSkillRun,
  dispatchSkillRunExecution,
  getSkillRun,
}));

import { executeToolCall } from '@/lib/chat-tools';

const toolContext = {
  chatApiKey: 'test-key',
  chatBaseUrl: 'https://example.com',
  origin: 'https://app.example.com',
  userId: 'user-1',
  projectId: 'project-1',
  chatModel: 'chat-model',
  chatProviderId: 'chat-provider',
  imageModel: 'image-model',
  imageProviderId: 'image-provider',
};

describe('run_skill chat tool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createSkillRun.mockReset().mockResolvedValue({ runId: 'run-1', reused: false });
    dispatchSkillRunExecution.mockReset().mockResolvedValue({ started: true, completion: Promise.resolve() });
    getSkillRun.mockReset().mockResolvedValue({
      runId: 'run-1',
      status: 'completed',
      outputs: [{ stepId: 'step-1', kind: 'text', content: '技能产出的文案' }],
      assetVersionIds: ['asset-1'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a skill run, waits for it, and returns its text output to the model', async () => {
    const pending = executeToolCall('run_skill', {
      skill_id: 'preset-ecommerce-listing',
      request: '给蓝牙音箱做一套主图',
    }, toolContext);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.success).toBe(true);
    expect(createSkillRun).toHaveBeenCalledOnce();
    const created = createSkillRun.mock.calls[0][0];
    expect(created.request).toMatchObject({
      skillId: 'preset-ecommerce-listing',
      surface: 'canvas',
      projectId: 'project-1',
    });
    expect(created.request.inputValues.product).toBe('给蓝牙音箱做一套主图');
    expect(dispatchSkillRunExecution).toHaveBeenCalledWith({ actorUserId: 'user-1', runId: 'run-1' });
    expect(result.resultText).toContain('技能产出的文案');
    expect(result.taskIds).toEqual([
      expect.objectContaining({ taskId: 'run-1', runId: 'run-1' }),
    ]);
  });

  it('rejects a skill that does not exist before creating a run', async () => {
    const result = await executeToolCall('run_skill', {
      skill_id: 'not-a-real-skill',
      request: '随便做点什么',
    }, toolContext);

    expect(result.success).toBe(false);
    expect(createSkillRun).not.toHaveBeenCalled();
  });
});
