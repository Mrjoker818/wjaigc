import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  admitAuthorizedAgentExecution,
  type AgentExecutionAdmissionDependencies,
} from '@/lib/agent-runtime/admission-gate';
import { buildCanvasAgentRequest } from '@/lib/agent-runtime/surface-requests';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';

const actor = {
  id: 'user-1', name: 'Owner', role: 'user' as const, status: 'active' as const,
  productType: 'canvas,chat', createdAt: 1, updatedAt: 1,
};

const request: AgentRunRequest = {
  projectId: 'project-1', workspace: 'canvas', workspaceId: 'canvas-1', mode: 'agent',
  providerId: 'provider-image', modelId: 'model-image', prompt: 'Create an image',
  sourceVersionIds: ['version-1'], allowedToolIds: ['generate_image'],
  idempotencyKey: 'stable-key',
  context: {
    selectedEntityIds: ['canvas-image-1'],
    visibleVersionIds: ['version-1'],
    locale: 'zh-CN',
  },
};

function dependencies(
  overrides: Partial<AgentExecutionAdmissionDependencies> = {},
): AgentExecutionAdmissionDependencies {
  return {
    authorizeContext: vi.fn().mockResolvedValue(request.context),
    resolveTaskModel: vi.fn().mockResolvedValue({
      providerId: 'provider-image', modelId: 'model-image', kind: 'image', sourceType: 'image',
      protocol: 'images', executionMode: 'async', allowedRatios: [], allowedSizes: [],
      qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false, supportsMask: false,
      supportedOperations: ['text-to-image'], outputKinds: ['png'], capabilitySources: {},
    }),
    ...overrides,
  };
}

describe('Agent execution admission gate', () => {
  it('does not use an orchestrator chat model as a downstream image model', async () => {
    const canvasRequest = buildCanvasAgentRequest({
      projectId: 'project-1',
      workspaceId: 'canvas-1',
      providerId: 'provider-chat',
      modelId: 'model-chat',
      prompt: 'Analyze, generate, and edit an image',
      sourceVersionIds: ['version-1'],
      selectedEntityIds: ['canvas-image-1'],
      mode: 'agent',
      idempotencyKey: 'canvas-agent-default-tools',
    });
    const deps = dependencies({
      resolveTaskModel: vi.fn().mockResolvedValue({
        providerId: 'provider-chat', modelId: 'model-chat', kind: 'chat', sourceType: 'chat',
        protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [],
        qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false, supportsMask: false,
        outputKinds: ['text'], capabilitySources: {},
      }),
    });

    expect(canvasRequest.allowedToolIds).toEqual([
      'analyze_image',
      'generate_image',
      'edit_image',
    ]);
    await expect(admitAuthorizedAgentExecution({
      actor,
      request: canvasRequest,
      toolId: 'generate_image',
      admit: vi.fn().mockResolvedValue('generate_image'),
    }, deps)).rejects.toMatchObject({ code: 'AGENT_TOOL_AUTHORIZATION_DENIED' });
  });

  it('does not create a task or call a provider when Asset Graph authorization fails', async () => {
    const admit = vi.fn().mockResolvedValue('should-not-run');
    const deps = dependencies({
      authorizeContext: vi.fn().mockRejectedValue(new Error('cross-project source')),
    });

    await expect(admitAuthorizedAgentExecution({
      actor, request, toolId: 'generate_image', admit,
    }, deps)).rejects.toThrow('cross-project source');
    expect(deps.resolveTaskModel).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });

  it('does not create a task or call a provider for an unavailable or unauthorized exact pair', async () => {
    const admit = vi.fn().mockResolvedValue('should-not-run');
    const deps = dependencies({
      resolveTaskModel: vi.fn().mockRejectedValue(new Error('not authorized')),
    });

    await expect(admitAuthorizedAgentExecution({
      actor, request, toolId: 'generate_image', admit,
    }, deps)).rejects.toMatchObject({ code: 'MODEL_ROUTE_MISMATCH' });
    expect(admit).not.toHaveBeenCalled();
  });

  it('admits only after exact context, model, and tool authorization succeeds', async () => {
    const order: string[] = [];
    const deps = dependencies({
      authorizeContext: vi.fn().mockImplementation(async () => {
        order.push('context');
        return { snapshot: request.context, mediaByVersionId: {}, selectedEntityVersionIds: {} };
      }),
      resolveTaskModel: vi.fn().mockImplementation(async () => {
        order.push('model');
        return dependencies().resolveTaskModel('', '', '');
      }),
    });
    const admit = vi.fn().mockImplementation(async () => {
      order.push('admit');
      return 'task-1';
    });

    await expect(admitAuthorizedAgentExecution({
      actor, request, toolId: 'generate_image', admit,
    }, deps)).resolves.toBe('task-1');
    expect(order).toEqual(['context', 'model', 'admit']);
  });

  it('passes only the server-resolved canonical media authorization into admission', async () => {
    const authorizedContext = {
      snapshot: request.context,
      mediaByVersionId: { 'version-1': 'https://media.example.com/version-1.png' },
      selectedEntityVersionIds: { 'canvas-image-1': 'version-1' },
    };
    const admit = vi.fn().mockResolvedValue('task-1');
    const deps = dependencies({ authorizeContext: vi.fn().mockResolvedValue(authorizedContext) });

    await admitAuthorizedAgentExecution({ actor, request, toolId: 'generate_image', admit }, deps);

    expect(admit).toHaveBeenCalledWith(authorizedContext);
  });
});
