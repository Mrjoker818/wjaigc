import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { observeLegacyAgentRun } from '@/lib/agent-runtime/legacy-observer';

const agentEditExecutionPath = 'src/lib/agent-runtime/agent-edit-execution-service.ts';

describe('legacy Agent runtime shadow observation', () => {
  it('observes an admitted image-Agent task only in shadow mode', () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), agentEditExecutionPath),
      'utf8',
    );

    expect(routeSource).toContain('resolveAgentRuntimeMode(process.env.WUJIE_AGENT_RUNTIME_MODE)');
    expect(routeSource).toContain('prepareAdmittedAgentTaskExecution({');
    expect(routeSource.indexOf('prepareAdmittedAgentTaskExecution({')).toBeGreaterThan(
      routeSource.indexOf('const taskId = admission.value.taskId;'),
    );
  });

  it('keeps all three entries behind the same rollout-mode resolver', () => {
    for (const path of [
      'src/app/api/chat/route.ts',
      'src/app/api/simple-chat/chat/route.ts',
      agentEditExecutionPath,
    ]) {
      const routeSource = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(routeSource).toContain('resolveAgentRuntimeMode(process.env.WUJIE_AGENT_RUNTIME_MODE)');
    }
  });

  it('appends observations without calling providers, charging credits, or creating assets', async () => {
    const deps = {
      appendEvent: vi.fn().mockResolvedValue(undefined),
      callProvider: vi.fn(),
      chargeCredits: vi.fn(),
      createAssetVersion: vi.fn(),
      recordDiagnostic: vi.fn(),
    };

    await observeLegacyAgentRun({
      runId: 'legacy-task-1', actorUserId: 'user-1', projectId: 'project-1',
      workspace: 'canvas', providerId: 'provider-chat', modelId: 'model-chat',
      mode: 'agent', prompt: '生成图片', sourceVersionIds: ['version-1'],
      allowedToolIds: ['generate_image'],
    }, deps);

    expect(deps.appendEvent).toHaveBeenCalled();
    expect(deps.callProvider).not.toHaveBeenCalled();
    expect(deps.chargeCredits).not.toHaveBeenCalled();
    expect(deps.createAssetVersion).not.toHaveBeenCalled();
  });

  it('emits only one observation group for the same legacy task', async () => {
    const deps = {
      appendEvent: vi.fn().mockResolvedValue(undefined),
      recordDiagnostic: vi.fn(),
    };
    const input = {
      runId: 'legacy-task-2', actorUserId: 'user-1', projectId: 'project-1',
      workspace: 'chat' as const, providerId: 'provider-chat', modelId: 'model-chat',
      mode: 'conversation' as const, prompt: '你好', sourceVersionIds: [], allowedToolIds: [],
    };

    await observeLegacyAgentRun(input, deps);
    await observeLegacyAgentRun(input, deps);

    expect(deps.appendEvent).toHaveBeenCalledTimes(2);
  });

  it('contains observation failures and records a redacted diagnostic', async () => {
    const deps = {
      appendEvent: vi.fn().mockRejectedValue(new Error('Bearer secret-token-value')),
      recordDiagnostic: vi.fn(),
    };

    await expect(observeLegacyAgentRun({
      runId: 'legacy-task-3', actorUserId: 'user-1', projectId: 'project-1',
      workspace: 'canvas', providerId: 'provider-chat', modelId: 'model-chat',
      mode: 'agent', prompt: '编辑', sourceVersionIds: ['version-1'], allowedToolIds: ['edit_image'],
    }, deps)).resolves.toBeUndefined();

    expect(deps.recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      code: 'AGENT_SHADOW_OBSERVATION_FAILED',
      message: expect.not.stringContaining('secret-token-value'),
    }));
  });

  it('retries only the missing deterministic event after a partial failure', async () => {
    const appendEvent = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    const input = {
      runId: 'legacy-task-partial', actorUserId: 'user-1', projectId: 'project-1',
      workspace: 'chat' as const, providerId: 'provider-chat', modelId: 'model-chat',
      mode: 'conversation' as const, prompt: 'hello', sourceVersionIds: [], allowedToolIds: [],
    };
    await observeLegacyAgentRun(input, { appendEvent });
    await observeLegacyAgentRun(input, { appendEvent });
    expect(appendEvent).toHaveBeenCalledTimes(3);
    expect(appendEvent.mock.calls[2]?.[0]).toMatchObject({
      eventId: 'legacy-observer:legacy-task-partial:plan',
    });
  });
});
