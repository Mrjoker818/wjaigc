import { describe, expect, it, vi } from 'vitest';

import {
  AgentContextNotFoundError,
  authorizeAgentContext,
} from '@/lib/agent-runtime/context-adapters';
import {
  authorizeAgentTools,
  type AgentToolDefinition,
} from '@/lib/agent-runtime/tool-registry';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';

const registry: AgentToolDefinition[] = [
  {
    toolId: 'generate_image',
    workspaces: ['canvas', 'workflow', 'chat'],
    productTypes: ['canvas', 'simple-chat'],
    modelCapabilities: ['image'],
  },
  {
    toolId: 'edit_image',
    workspaces: ['canvas', 'workflow'],
    productTypes: ['canvas'],
    modelCapabilities: ['edit', 'image'],
  },
];

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    projectId: 'project-1',
    workspace: 'canvas',
    workspaceId: 'canvas-1',
    mode: 'agent',
    providerId: 'provider-1',
    modelId: 'model-1',
    prompt: 'Create a poster',
    sourceVersionIds: ['version-1'],
    allowedToolIds: ['generate_image'],
    idempotencyKey: 'agent-request-1',
    context: {
      selectedEntityIds: ['image-1'],
      visibleVersionIds: ['version-1'],
      locale: 'zh-CN',
    },
    ...overrides,
  };
}

describe('Agent tool authorization', () => {
  it('denies requested tools when the exact model lacks the required capability', () => {
    const authorization = authorizeAgentTools({
      requestedToolIds: ['generate_image', 'edit_image'],
      workspace: 'chat',
      userProductTypes: ['simple-chat'],
      modelCapabilities: ['chat'],
      registry,
    });

    expect(authorization.tools).toEqual([]);
    expect(authorization.denials).toEqual(expect.arrayContaining([
      { toolId: 'generate_image', code: 'MODEL_CAPABILITY_REQUIRED' },
      { toolId: 'edit_image', code: 'WORKSPACE_FORBIDDEN' },
    ]));
  });

  it('returns a tool only when workspace, product, and every model capability are authorized', () => {
    const authorization = authorizeAgentTools({
      requestedToolIds: ['edit_image'],
      workspace: 'canvas',
      userProductTypes: ['canvas'],
      modelCapabilities: ['chat', 'image', 'edit'],
      registry,
    });

    expect(authorization.tools.map(tool => tool.toolId)).toEqual(['edit_image']);
    expect(authorization.denials).toEqual([]);
  });

  it('reports missing tools and product permissions without inventing a fallback tool', () => {
    const authorization = authorizeAgentTools({
      requestedToolIds: ['missing_tool', 'generate_image'],
      workspace: 'canvas',
      userProductTypes: ['unauthorized-product'],
      modelCapabilities: ['image'],
      registry,
    });

    expect(authorization.tools).toEqual([]);
    expect(authorization.denials).toEqual([
      { toolId: 'missing_tool', code: 'TOOL_NOT_FOUND' },
      { toolId: 'generate_image', code: 'PRODUCT_PERMISSION_REQUIRED' },
    ]);
  });

  it('does not treat reference-image input support as vision analysis capability', () => {
    const authorization = authorizeAgentTools({
      requestedToolIds: ['analyze_image'],
      workspace: 'chat',
      userProductTypes: ['simple-chat'],
      modelCapabilities: ['image', 'reference-images'],
    });

    expect(authorization.tools).toEqual([]);
    expect(authorization.denials).toEqual([
      { toolId: 'analyze_image', code: 'MODEL_CAPABILITY_REQUIRED' },
    ]);
  });

  it('authorizes the existing Agent-edit planner only for a canvas chat model', () => {
    const authorization = authorizeAgentTools({
      requestedToolIds: ['agent_edit'],
      workspace: 'canvas',
      userProductTypes: ['canvas'],
      modelCapabilities: ['chat'],
    });

    expect(authorization.tools.map(tool => tool.toolId)).toEqual(['agent_edit']);
    expect(authorization.denials).toEqual([]);
  });
});

describe('Agent context ownership adapter', () => {
  it('validates project and every unique source or visible version through Asset Graph scope', async () => {
    const transaction = {
      findProject: vi.fn(async () => true),
      findVersion: vi.fn(async (_ownerId: string, _projectId: string, versionId: string) => (
        versionId === 'version-1' || versionId === 'version-2'
          ? { id: versionId }
          : null
      )),
    };
    const storage = {
      transaction: async <T>(callback: (value: typeof transaction) => Promise<T>): Promise<T> => (
        callback(transaction)
      ),
    };

    await expect(authorizeAgentContext({
      actorUserId: 'owner-1',
      request: request({
        sourceVersionIds: ['version-1', 'version-1'],
        context: {
          selectedEntityIds: ['image-1'],
          visibleVersionIds: ['version-1', 'version-2'],
          locale: 'zh-CN',
        },
      }),
      storage,
    })).resolves.toEqual({
      selectedEntityIds: ['image-1'],
      visibleVersionIds: ['version-1', 'version-2'],
      locale: 'zh-CN',
    });
    expect(transaction.findProject).toHaveBeenCalledWith('owner-1', 'project-1');
    expect(transaction.findVersion).toHaveBeenCalledTimes(2);
    expect(transaction.findVersion).toHaveBeenCalledWith('owner-1', 'project-1', 'version-1');
    expect(transaction.findVersion).toHaveBeenCalledWith('owner-1', 'project-1', 'version-2');
  });

  it.each([
    { projectOwned: false, missingVersion: false },
    { projectOwned: true, missingVersion: true },
  ])('fails closed without distinguishing project or version existence: %j', async ({
    projectOwned,
    missingVersion,
  }) => {
    const storage = {
      transaction: async <T>(callback: (value: {
        findProject: () => Promise<boolean>;
        findVersion: () => Promise<null | { id: string }>;
      }) => Promise<T>): Promise<T> => callback({
        findProject: async () => projectOwned,
        findVersion: async () => missingVersion ? null : { id: 'version-1' },
      }),
    };

    await expect(authorizeAgentContext({
      actorUserId: 'wrong-or-unscoped-owner',
      request: request(),
      storage,
    })).rejects.toEqual(expect.objectContaining({
      name: AgentContextNotFoundError.name,
      code: 'AGENT_CONTEXT_NOT_FOUND',
      status: 404,
      message: 'Agent context not found',
    }));
  });
});
