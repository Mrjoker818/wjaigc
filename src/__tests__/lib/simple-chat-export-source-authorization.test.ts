import { describe, expect, it, vi } from 'vitest';

import {
  authorizeSimpleChatExportSources,
  SimpleChatExportSourceAuthorizationError,
} from '@/lib/multi-platform-export/simple-chat-source-authorization';

function storageFor(input: {
  entityType?: 'chat-attachment' | 'chat-result';
  entityId?: string;
  taskId?: string;
  messageId?: string;
  versionId?: string;
  url?: string;
}) {
  const taskId = input.taskId ?? 'task-1';
  const messageId = input.messageId ?? 'message-1';
  const versionId = input.versionId ?? 'version-1';
  const entityId = input.entityId ?? `${taskId}:${messageId}:0`;
  return {
    read: vi.fn(async callback => callback({
      findProject: vi.fn(async () => true),
      findVersion: vi.fn(async () => ({
        id: versionId,
        assetId: 'asset-1',
        file: { url: input.url ?? '/managed.png', availability: 'ready', mimeType: 'image/png' },
      })),
      findAsset: vi.fn(async () => ({ id: 'asset-1', kind: 'image', status: 'active' })),
      findActivePlacement: vi.fn(async (
        _ownerId: string,
        _projectId: string,
        _workspace: string,
        _workspaceId: string,
        entityType: string,
        requestedEntityId: string,
      ) => entityType === (input.entityType ?? 'chat-attachment') && requestedEntityId === entityId
        ? { id: 'placement-1', assetVersionId: versionId, entityId, status: 'active' }
        : null),
    })),
  };
}

const request = {
  actorUserId: 'user-1',
  projectId: 'asset-project-1',
  workspaceId: 'standalone-chat:chat-project-1',
  taskId: 'task-1',
  messageId: 'message-1',
  sourceVersionIds: ['version-1'],
  entityIds: ['task-1:message-1:0'],
  messageImageUrls: ['/managed.png'],
};

describe('Simple Chat export source authorization', () => {
  it('authorizes only the exact current-message chat attachment placement', async () => {
    await expect(authorizeSimpleChatExportSources(request, storageFor({}))).resolves.toEqual({
      sourceVersionIds: ['version-1'],
      mediaUrls: ['/managed.png'],
    });
  });

  it.each([
    ['another message', storageFor({ entityId: 'task-1:message-other:0' })],
    ['another task', storageFor({ entityId: 'task-other:message-1:0' })],
    ['a chat result', storageFor({ entityType: 'chat-result' })],
    ['a mismatched version', storageFor({ versionId: 'version-other' })],
  ])('rejects a source bound to %s', async (_name, storage) => {
    await expect(authorizeSimpleChatExportSources(request, storage)).rejects.toBeInstanceOf(
      SimpleChatExportSourceAuthorizationError,
    );
  });

  it('rejects a canonical media URL that does not match the source message slot', async () => {
    await expect(authorizeSimpleChatExportSources(
      request,
      storageFor({ url: '/different.png' }),
    )).rejects.toMatchObject({ code: 'SIMPLE_CHAT_EXPORT_SOURCE_FORBIDDEN' });
  });
});
