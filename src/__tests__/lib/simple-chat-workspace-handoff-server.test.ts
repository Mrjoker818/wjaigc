import { describe, expect, it, vi } from 'vitest';
import type { SimpleChatProject } from '@/components/simple-chat/simple-chat-types';

vi.mock('server-only', () => ({}));

import {
  resolveSimpleChatWorkspaceHandoff,
} from '@/lib/simple-chat-workspace-handoff-server';

const input = {
  actorUserId: 'user-1',
  targetProjectId: 'canvas-1',
  chatProjectId: 'chat-1',
  chatTaskId: 'task-1',
  chatMessageId: 'message-1',
};

const projectFixture: SimpleChatProject = {
  id: 'chat-1',
  name: '品牌项目',
  createdAt: 1,
  updatedAt: 1,
  agents: [],
  knowledgeItems: [],
  tasks: [{
    id: 'task-1',
    projectId: 'chat-1',
    name: '最终提案',
    model: 'model-1',
    providerId: 'provider-1',
    createdAt: 1,
    updatedAt: 1,
    messages: [{
      id: 'message-1',
      role: 'assistant',
      content: '  最终方案  ',
      images: ['/managed.png', 'https://legacy.example/image.png'],
      imageRefs: [
        {
          url: '/managed.png',
          assetId: 'asset-1',
          assetVersionId: 'version-1',
          placementId: 'placement-1',
          name: '方案图.png',
        },
        { url: 'https://legacy.example/image.png' },
      ],
      model: 'message-model-1',
      providerId: 'message-provider-1',
      agentRunId: 'run-1',
      createdAt: Date.parse('2026-08-27T08:00:00+08:00'),
    }],
  }],
};

const snapshotFixture = {
  schemaVersion: 1 as const,
  revision: 1,
  projects: [projectFixture],
};

const authorizedMediaDependencies = {
  resolveVersionProject: async (_userId: string, assetVersionId: string) => (
    assetVersionId === 'version-1' ? 'source-project-1' : null
  ),
  findPlacement: async (_userId: string, projectId: string, placementId: string) => (
    projectId === 'source-project-1' && placementId === 'placement-1'
      ? { assetVersionId: 'version-1', status: 'active' as const }
      : null
  ),
};

describe('resolveSimpleChatWorkspaceHandoff', () => {
  it('returns only the actor-owned message and managed index-aligned images', async () => {
    const projectExists = vi.fn().mockResolvedValue(true);
    const readSnapshot = vi.fn().mockResolvedValue(snapshotFixture);

    const result = await resolveSimpleChatWorkspaceHandoff(input, {
      projectExists,
      readSnapshot,
      ...authorizedMediaDependencies,
    });

    expect(projectExists).toHaveBeenCalledWith('user-1', 'canvas-1');
    expect(readSnapshot).toHaveBeenCalledWith('user-1');
    expect(result.text).toBe('最终方案');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({
      imageIndex: 0,
      assetRef: {
        assetVersionId: 'version-1',
        placementId: 'placement-1',
      },
      sourceTrace: {
        chatProjectId: 'chat-1',
        chatTaskId: 'task-1',
        messageId: 'message-1',
      },
    });
    expect(result.sourceTrace).toEqual({
      source: 'simple-chat',
      chatProjectId: 'chat-1',
      chatTaskId: 'task-1',
      messageId: 'message-1',
      modelId: 'message-model-1',
      providerId: 'message-provider-1',
      agentRunId: 'run-1',
      createdAt: '2026-08-27T00:00:00.000Z',
    });
    expect(result.warnings).toContain('UNMANAGED_IMAGE_SKIPPED');
  });

  it('skips a forged asset version while preserving an authorized image index', async () => {
    const project = structuredClone(projectFixture);
    const message = project.tasks[0].messages[0];
    message.images = ['/forged.png', '/managed.png'];
    message.imageRefs = [
      {
        url: '/forged.png',
        assetVersionId: 'version-other-user',
        placementId: 'placement-forged',
      },
      {
        url: '/managed.png',
        assetVersionId: 'version-1',
        placementId: 'placement-1',
      },
    ];
    const resolveVersionProject = vi.fn(async (_userId: string, versionId: string) => (
      versionId === 'version-1' ? 'source-project-1' : null
    ));
    const findPlacement = vi.fn(async (_userId: string, projectId: string, placementId: string) => (
      projectId === 'source-project-1' && placementId === 'placement-1'
        ? { assetVersionId: 'version-1', status: 'active' as const }
        : null
    ));

    const result = await resolveSimpleChatWorkspaceHandoff(input, {
      projectExists: async () => true,
      readSnapshot: async () => ({ schemaVersion: 1, revision: 2, projects: [project] }),
      resolveVersionProject,
      findPlacement,
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({
      imageIndex: 1,
      assetRef: { assetVersionId: 'version-1', placementId: 'placement-1' },
    });
    expect(result.warnings).toEqual(['UNMANAGED_IMAGE_SKIPPED']);
    expect(resolveVersionProject).toHaveBeenCalledWith('user-1', 'version-other-user');
    expect(findPlacement).not.toHaveBeenCalledWith('user-1', expect.any(String), 'placement-forged');
    expect(findPlacement).toHaveBeenCalledWith('user-1', 'source-project-1', 'placement-1');
  });

  it('rejects a target project not owned by the actor before reading chat data', async () => {
    const readSnapshot = vi.fn().mockResolvedValue(snapshotFixture);

    await expect(resolveSimpleChatWorkspaceHandoff(input, {
      projectExists: async () => false,
      readSnapshot,
      ...authorizedMediaDependencies,
    })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a source outside the actor-scoped snapshot', async () => {
    await expect(resolveSimpleChatWorkspaceHandoff(input, {
      projectExists: async () => true,
      readSnapshot: async actorUserId => ({
        schemaVersion: 1,
        revision: 2,
        projects: actorUserId === 'user-1' ? [] : [projectFixture],
      }),
      ...authorizedMediaDependencies,
    })).rejects.toMatchObject({ code: 'HANDOFF_SOURCE_NOT_FOUND', status: 404 });
  });

  it('rejects image-only messages when no index-aligned image is managed', async () => {
    const unmanagedProject = structuredClone(projectFixture);
    const message = unmanagedProject.tasks[0].messages[0];
    message.content = '   ';
    message.imageRefs = [{ url: message.images?.[0] || '' }];

    await expect(resolveSimpleChatWorkspaceHandoff(input, {
      projectExists: async () => true,
      readSnapshot: async () => ({
        schemaVersion: 1,
        revision: 2,
        projects: [unmanagedProject],
      }),
      ...authorizedMediaDependencies,
    })).rejects.toMatchObject({ code: 'NO_MANAGED_MEDIA', status: 422 });
  });

  it('rejects image-only messages when placements mismatch the version or are inactive', async () => {
    const project = structuredClone(projectFixture);
    const message = project.tasks[0].messages[0];
    message.content = '   ';
    message.images = ['/mismatch.png', '/trashed.png'];
    message.imageRefs = [
      {
        url: '/mismatch.png',
        assetVersionId: 'version-1',
        placementId: 'placement-mismatch',
      },
      {
        url: '/trashed.png',
        assetVersionId: 'version-2',
        placementId: 'placement-trashed',
      },
    ];

    await expect(resolveSimpleChatWorkspaceHandoff(input, {
      projectExists: async () => true,
      readSnapshot: async () => ({ schemaVersion: 1, revision: 3, projects: [project] }),
      resolveVersionProject: async () => 'source-project-1',
      findPlacement: async (_userId, _projectId, placementId) => placementId === 'placement-mismatch'
        ? { assetVersionId: 'different-version', status: 'active' as const }
        : { assetVersionId: 'version-2', status: 'trashed' as const },
    })).rejects.toMatchObject({ code: 'NO_MANAGED_MEDIA', status: 422 });
  });
});
