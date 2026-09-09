import { describe, expect, it, vi } from 'vitest';
import { authorizeAgentContext, type AgentContextTransaction } from '@/lib/agent-runtime/context-adapters';
import type { AgentRunRequest, ModelAgentRunRequest } from '@/lib/agent-runtime/types';

function request(overrides: Partial<ModelAgentRunRequest> = {}): ModelAgentRunRequest {
  return {
    projectId: 'project-a', workspace: 'canvas', workspaceId: 'canvas:project-a',
    mode: 'agent', executionRuntime: 'model', providerId: 'provider-a', modelId: 'model-a', prompt: 'Keep the product',
    sourceVersionIds: ['version-a'], allowedToolIds: [], idempotencyKey: 'request-a',
    context: { selectedEntityIds: ['image-a'], visibleVersionIds: [], locale: 'zh-CN' },
    ...overrides,
  };
}

function fixture(
  storedWorkspace: string,
  active = true,
  storedSurface: AgentRunRequest['workspace'] = 'canvas',
): AgentContextTransaction {
  const matches = (owner: string, project: string, surface: string, workspace: string): boolean =>
    active && owner === 'owner-a' && project === 'project-a'
      && surface === storedSurface && workspace === storedWorkspace;
  return {
    findProject: vi.fn(async (owner, project) => owner === 'owner-a' && project === 'project-a'),
    findAsset: vi.fn(async (owner, project, assetId) =>
      owner === 'owner-a' && project === 'project-a' && assetId === 'asset-a'
        ? { id: assetId, kind: 'image' as const } : null),
    findVersion: vi.fn(async (owner, project, version) =>
      owner === 'owner-a' && project === 'project-a' && version === 'version-a'
        ? {
          id: version, assetId: 'asset-a',
          file: {
            url: '/api/serve-upload/product.png', availability: 'ready' as const, mimeType: 'image/png',
          },
        } : null),
    findVersionPlacement: vi.fn(async (owner, project, surface, workspace, version) =>
      matches(owner, project, surface, workspace) && version === 'version-a'
        ? { id: 'placement-a', assetVersionId: version } : null),
    findEntityPlacement: vi.fn(async (owner, project, surface, workspace, entity) =>
      matches(owner, project, surface, workspace) && entity === 'image-a'
        ? { id: 'placement-a', assetVersionId: 'version-a' } : null),
  };
}

describe('Agent context project Canvas aliases', () => {
  it.each([
    ['canvas:project-a', 'project-a'], ['project-a', 'canvas:project-a'],
    ['canvas:project-a', 'canvas:project-a'], ['project-a', 'project-a'],
  ])('resolves request %s against persisted %s without rewriting data', async (workspaceId, stored) => {
    const transaction = fixture(stored);
    const result = await authorizeAgentContext({
      actorUserId: 'owner-a', request: request({ workspaceId }),
      storage: { transaction: async execute => execute(transaction) },
    });
    expect(result.mediaByVersionId['version-a']).toBe('/api/serve-upload/product.png');
    expect(result.selectedEntityVersionIds['image-a']).toBe('version-a');
  });

  it.each([
    { workspaceId: 'session-a' }, { workspaceId: 'canvas:project-b' },
    { workspace: 'chat' as const }, { workspace: 'workflow' as const },
    { projectId: 'project-b' }, { sourceVersionIds: ['version-b'] },
  ])('does not broaden scope for %j', async overrides => {
    const transaction = fixture('project-a');
    await expect(authorizeAgentContext({
      actorUserId: 'owner-a', request: request(overrides),
      storage: { transaction: async execute => execute(transaction) },
    })).rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND' });
  });

  it.each([['owner-b', true], ['owner-a', false]] as const)('rejects owner=%s active=%s', async (actorUserId, active) => {
    await expect(authorizeAgentContext({
      actorUserId, request: request(),
      storage: { transaction: async execute => execute(fixture('project-a', active)) },
    })).rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND' });
  });

  it('accepts a ready legacy image version whose persisted MIME is missing', async () => {
    const transaction = fixture('project-a');
    transaction.findVersion = vi.fn(async () => ({
      id: 'version-a',
      assetId: 'asset-a',
      file: { url: '/api/serve-upload/legacy.png', availability: 'ready' as const },
    }));

    await expect(authorizeAgentContext({
      actorUserId: 'owner-a', request: request(),
      storage: { transaction: async execute => execute(transaction) },
    })).resolves.toMatchObject({
      mediaByVersionId: { 'version-a': '/api/serve-upload/legacy.png' },
    });
  });

  it.each([
    ['workflow:workflow-a', 'workflow-a'],
    ['workflow-a', 'workflow:workflow-a'],
  ])('resolves Workflow request %s against persisted %s without broadening the project', async (
    workspaceId,
    storedWorkspace,
  ) => {
    const transaction = fixture(storedWorkspace, true, 'workflow');
    const result = await authorizeAgentContext({
      actorUserId: 'owner-a',
      request: request({ workspace: 'workflow', workspaceId }),
      storage: { transaction: async execute => execute(transaction) },
    });

    expect(result.mediaByVersionId['version-a']).toBe('/api/serve-upload/product.png');
    expect(result.selectedEntityVersionIds['image-a']).toBe('version-a');
  });
});
