import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  prepareAdmittedAgentTaskExecution,
  type AdmittedAgentTaskExecutionDependencies,
} from '@/lib/agent-runtime/surface-dispatch';

function routeSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function agentEditExecutionSource(): string {
  return routeSource('src/lib/agent-runtime/agent-edit-execution-service.ts');
}

function dependencies(): AdmittedAgentTaskExecutionDependencies {
  return {
    observeShadow: vi.fn().mockResolvedValue(undefined),
    adopt: vi.fn().mockResolvedValue({
      runId: 'task-1',
      reused: false,
      claimed: true,
      projection: { status: 'executing' },
      tools: [],
    }),
    executeAdoption: vi.fn().mockImplementation(async ({ execute }) => execute()),
  } as unknown as AdmittedAgentTaskExecutionDependencies;
}

const observation = {
  runId: 'task-1',
  actorUserId: 'user-1',
  projectId: 'project-1',
  workspace: 'canvas' as const,
  providerId: 'provider-image',
  modelId: 'model-image',
  mode: 'agent' as const,
  prompt: 'Create an image',
  sourceVersionIds: [],
  allowedToolIds: ['generate_image'],
};

const adoption = {
  actor: {
    id: 'user-1', name: 'Owner', role: 'user' as const, status: 'active' as const,
    productType: 'canvas', createdAt: 1, updatedAt: 1,
  },
  taskId: 'task-1',
  request: {
    projectId: 'project-1', workspace: 'canvas' as const, workspaceId: 'canvas-1',
    mode: 'agent' as const, providerId: 'provider-image', modelId: 'model-image',
    prompt: 'Create an image', sourceVersionIds: [], allowedToolIds: ['generate_image'],
    idempotencyKey: 'task-1',
    context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' as const },
  },
  toolId: 'generate_image',
};

describe('Agent runtime route rollout modes', () => {
  it('legacy invokes the existing executor with zero shared-runtime calls', async () => {
    const deps = dependencies();
    const execute = vi.fn().mockResolvedValue('legacy-result');

    const prepared = await prepareAdmittedAgentTaskExecution({
      mode: 'legacy', observation, adoption, execute,
    }, deps);

    expect(prepared.runId).toBeUndefined();
    await expect(prepared.execute()).resolves.toBe('legacy-result');
    expect(deps.observeShadow).not.toHaveBeenCalled();
    expect(deps.adopt).not.toHaveBeenCalled();
    expect(deps.executeAdoption).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('shadow observes without replacing or duplicating the existing executor', async () => {
    const deps = dependencies();
    const execute = vi.fn().mockResolvedValue('shadow-result');

    const prepared = await prepareAdmittedAgentTaskExecution({
      mode: 'shadow', observation, adoption, execute,
    }, deps);

    expect(prepared.runId).toBeUndefined();
    await expect(prepared.execute()).resolves.toBe('shadow-result');
    expect(deps.observeShadow).toHaveBeenCalledTimes(1);
    expect(deps.adopt).not.toHaveBeenCalled();
    expect(deps.executeAdoption).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('agent-v2 claims the admitted task and exposes only that exact run ID', async () => {
    const deps = dependencies();
    const execute = vi.fn().mockResolvedValue('agent-v2-result');

    const prepared = await prepareAdmittedAgentTaskExecution({
      mode: 'agent-v2', observation, adoption, execute,
    }, deps);

    expect(prepared.runId).toBe('task-1');
    await expect(prepared.execute()).resolves.toBe('agent-v2-result');
    expect(deps.observeShadow).not.toHaveBeenCalled();
    expect(deps.adopt).toHaveBeenCalledTimes(1);
    expect(deps.executeAdoption).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('wires all three public routes to the same admitted-task dispatcher', () => {
    for (const path of ['src/app/api/chat/route.ts', 'src/app/api/simple-chat/chat/route.ts']) {
      expect(routeSource(path)).toContain('prepareAdmittedAgentTaskExecution({');
    }
    expect(routeSource('src/app/api/agent-edit/route.ts')).toContain(
      '@/lib/agent-runtime/agent-edit-execution-service',
    );
    expect(agentEditExecutionSource()).toContain('prepareAdmittedAgentTaskExecution({');
  });

  it('requires admission before paid continuation in both chat routes', () => {
    const canvas = routeSource('src/app/api/chat/route.ts');
    expect(canvas).toContain("deferAgentExecution: input.agentRuntimeMode === 'agent-v2'");
    expect(canvas).toContain('executeAdmittedToolCall');

    const standalone = routeSource('src/app/api/simple-chat/chat/route.ts');
    expect(standalone).toContain("'x-wujie-agent-defer-execution': 'true'");
    expect(standalone).toContain('executeAdmittedToolCall');
  });

  it('propagates the shared execution signal through chat, simple-chat, and agent-edit continuations', () => {
    const canvas = routeSource('src/app/api/chat/route.ts');
    expect(canvas).toContain('executeAdmittedToolCall(toolResult, context?.signal)');

    const standalone = routeSource('src/app/api/simple-chat/chat/route.ts');
    expect(standalone).toContain('executeAdmittedToolCall({');
    expect(standalone).toContain('}, context?.signal, {');
    expect(standalone).toContain('executionFence: context?.executionFence');
    expect(standalone).toContain('pollExistingTask(context?.signal, context?.executionFence)');

    const agentEdit = agentEditExecutionSource();
    expect(agentEdit).toContain('const operationSignal = operationContext.signal || executionSignal;');
    expect(agentEdit).toContain('signal: operationSignal');
  });

  it('combines execution cancellation with each existing downstream request timeout', () => {
    const chatTools = routeSource('src/lib/chat-tools.ts');
    expect(chatTools).toContain('runWithAbortSignalTimeout(signal, 120_000');

    const standalone = routeSource('src/app/api/simple-chat/chat/route.ts');
    expect(standalone).toContain('runWithAbortSignalTimeout(signal, 30_000');

    const agentEdit = agentEditExecutionSource();
    expect(agentEdit).toContain('runWithAbortSignalTimeout(operationSignal, 60_000');
    expect(agentEdit).toContain('runWithAbortSignalTimeout(signal, 30_000');
    expect(agentEdit).toContain('runWithAbortSignalTimeout(signal, 120_000');
    expect(agentEdit).not.toMatch(/signal:\s*(?:input\.signal|signal)\s*\?\?\s*AbortSignal\.timeout/);
  });

  it('resolves exact paid pairs before provider calls and disables agent-v2 fallback', () => {
    for (const path of ['src/app/api/chat/route.ts', 'src/app/api/simple-chat/chat/route.ts']) {
      const source = routeSource(path);
      const exactResolution = source.indexOf('resolveTaskModel(');
      const firstProviderCall = path.includes('simple-chat')
        ? source.indexOf('const fetchRes = await fetchWithTimeout')
        : source.indexOf('const response = await fetchWithV1Retry');
      expect(exactResolution).toBeGreaterThan(0);
      expect(firstProviderCall).toBeGreaterThan(0);
      expect(exactResolution).toBeLessThan(firstProviderCall);
    }

    const agentEdit = agentEditExecutionSource();
    expect(agentEdit).toContain("agentRuntimeMode !== 'agent-v2'");
    const agentEditResolution = agentEdit.indexOf('resolveTaskModel(');
    expect(agentEditResolution).toBeGreaterThan(0);
    expect(agentEditResolution).toBeLessThan(agentEdit.indexOf('createBillableTask({'));

    const canvas = routeSource('src/app/api/chat/route.ts');
    expect(canvas).toContain("agentRuntimeMode !== 'agent-v2' && model.endsWith('-thinking')");
    expect(canvas).toContain("agentRuntimeMode === 'agent-v2'");

    const edit = routeSource('src/app/api/edit/route.ts');
    expect(edit).toContain('if (resumeAgentExecution)');
    expect(edit).toContain('await executeEditTask();');
  });
});
