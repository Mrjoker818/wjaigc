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

describe('resolveSimpleChatWorkspaceHandoff', () => {
  it('returns only the actor-owned message and managed index-aligned images', async () => {
    const projectExists = vi.fn().mockResolvedValue(true);
    const readSnapshot = vi.fn().mockResolvedValue(snapshotFixture);

    const result = await resolveSimpleChatWorkspaceHandoff(input, {
      projectExists,
      readSnapshot,
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

  it('rejects a target project not owned by the actor before reading chat data', async () => {
    const readSnapshot = vi.fn().mockResolvedValue(snapshotFixture);

    await expect(resolveSimpleChatWorkspaceHandoff(input, {
      projectExists: async () => false,
      readSnapshot,
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
    })).rejects.toMatchObject({ code: 'NO_MANAGED_MEDIA', status: 422 });
  });
});
