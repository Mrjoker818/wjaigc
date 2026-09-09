import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createSkillRun: vi.fn(),
  createVersionWithPlacement: vi.fn(),
  dispatchSkillRunExecution: vi.fn(),
  findActivePlacement: vi.fn(),
  findAsset: vi.fn(),
  findProject: vi.fn(),
  findVersion: vi.fn(),
  getSessionUser: vi.fn(),
  listEnabledPlatformExportPresets: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
}));
vi.mock('@/lib/multi-platform-export/presets', () => ({
  listEnabledPlatformExportPresets: mocks.listEnabledPlatformExportPresets,
}));
vi.mock('@/lib/skill-runtime/service', () => ({
  createSkillRun: mocks.createSkillRun,
  dispatchSkillRunExecution: mocks.dispatchSkillRunExecution,
}));
vi.mock('@/lib/asset-core/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asset-core/service')>();
  return {
    ...actual,
    createAssetService: () => ({
      createVersionWithPlacement: mocks.createVersionWithPlacement,
    }),
  };
});
vi.mock('@/lib/asset-core/storage', () => ({
  createPostgresAssetStorage: () => ({
    read: (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      findActivePlacement: mocks.findActivePlacement,
      findAsset: mocks.findAsset,
      findProject: mocks.findProject,
      findVersion: mocks.findVersion,
    }),
  }),
}));
vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {}, Config: class {}, HeaderUtils: { extractForwardHeaders: vi.fn() },
}));
vi.mock('@/lib/asset-core/task-projector', () => ({
  projectCompletedTaskToAssets: vi.fn(), recordTaskProjectionCompleted: vi.fn(),
}));

import { POST } from '@/app/api/simple-chat/chat/route';
import {
  alignSimpleChatMediaSlots,
  buildSimpleChatManagedAttachmentSelection,
  readSimpleChatStreamAssetReference,
} from '@/components/simple-chat/simple-chat-types';
import { resolveSimpleChatExportRequestContext } from '@/lib/multi-platform-export/simple-chat-intent';

const entityId = 'task-1:user-message-1:0';

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'request-1' },
    body: JSON.stringify(body),
  }));
}

describe('Simple Chat registered attachment export integration', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1', role: 'user', productType: 'chat', apiPermissions: { chat: true },
    });
    mocks.listEnabledPlatformExportPresets.mockResolvedValue([{
      id: 'instagram-post', version: 3, platform: 'instagram', usage: 'post',
      label: 'Instagram 帖子', width: 1080, height: 1080, recommendedFormat: 'jpeg',
      supportsTransparency: false, enabled: true,
    }]);
    mocks.createVersionWithPlacement.mockImplementation(async (input: {
      placement: { entityId: string; metadata?: Record<string, unknown> };
    }) => ({
      asset: { id: 'asset-1', ownerId: 'user-1' },
      version: {
        id: 'version-1', assetId: 'asset-1', ownerId: 'user-1',
        file: { url: '/uploads/source.png' },
      },
      placement: {
        id: 'placement-1', entityId: input.placement.entityId,
        ownerId: 'user-1', metadata: input.placement.metadata,
      },
      reused: false,
    }));
    mocks.findProject.mockImplementation(async (ownerId, projectId) => (
      ownerId === 'user-1' && projectId === 'project-1'
    ));
    mocks.findActivePlacement.mockImplementation(async (
      ownerId, projectId, workspace, workspaceId, entityType, requestedEntityId,
    ) => ownerId === 'user-1'
      && projectId === 'project-1'
      && workspace === 'chat'
      && workspaceId === 'standalone-chat:chat-project-1'
      && entityType === 'chat-attachment'
      && requestedEntityId === entityId
      ? { assetVersionId: 'version-1', entityId }
      : null);
    mocks.findVersion.mockImplementation(async (ownerId, projectId, versionId) => (
      ownerId === 'user-1' && projectId === 'project-1' && versionId === 'version-1'
        ? {
            id: 'version-1', assetId: 'asset-1',
            file: { url: '/uploads/source.png', availability: 'ready', mimeType: 'image/png' },
          }
        : null
    ));
    mocks.findAsset.mockImplementation(async (ownerId, projectId, assetId) => (
      ownerId === 'user-1' && projectId === 'project-1' && assetId === 'asset-1'
        ? { id: 'asset-1', kind: 'image', status: 'active' }
        : null
    ));
    mocks.createSkillRun.mockResolvedValue({ runId: 'run-1', reused: false });
    mocks.dispatchSkillRunExecution.mockResolvedValue({ started: true, completion: Promise.resolve() });
  });

  it('carries the created placement entity through ChatArea request construction and real source authorization', async () => {
    const registration = await post({
      assetAction: 'register',
      projectId: 'project-1',
      workspaceId: 'standalone-chat:chat-project-1',
      entityType: 'chat-attachment',
      entityId,
      idempotencyKey: 'simple-chat-attachment:task-1:user-message-1:0',
      image: { url: '/uploads/source.png', name: 'source.png', mimeType: 'image/png' },
    });
    const registrationBody = await registration.json();
    const reference = readSimpleChatStreamAssetReference(registrationBody);
    const media = alignSimpleChatMediaSlots([
      { id: 'upload-1', type: 'image', name: 'source.png', mimeType: 'image/png', url: '/uploads/source.png' },
    ], [reference]);
    const selection = buildSimpleChatManagedAttachmentSelection(media.imageRefs);
    const context = resolveSimpleChatExportRequestContext({
      messages: [],
      currentSourceVersionIds: selection.sourceVersionIds,
      currentSelectedEntityIds: selection.selectedEntityIds,
      currentSourceMessageId: 'user-message-1',
      currentAssetProjectId: 'project-1',
    });

    expect(registration.status).toBe(200);
    expect(registrationBody).toEqual({
      assetId: 'asset-1', assetVersionId: 'version-1', placementId: 'placement-1',
      entityId, url: '/uploads/source.png', name: 'source.png',
    });
    expect(registrationBody).not.toHaveProperty('ownerId');
    expect(context).toMatchObject({
      sourceVersionIds: ['version-1'], selectedEntityIds: [entityId],
      sourceMessageId: 'user-message-1', assetProjectId: 'project-1',
    });

    const requestBody = {
      messages: [{
        id: 'user-message-1', role: 'user',
        content: '把这些图片批量导出 Instagram 帖子尺寸', images: media.images,
      }],
      model: 'chat-model', providerId: 'provider-1',
      projectId: 'chat-project-1', taskId: 'task-1', responseMessageId: 'assistant-message-1',
      assetProjectId: context.assetProjectId, sourceMessageId: context.sourceMessageId,
      sourceVersionIds: context.sourceVersionIds, selectedEntityIds: context.selectedEntityIds,
      idempotencyKey: 'request-1',
    };
    const response = await post(requestBody);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"runId":"run-1"');
    expect(mocks.findActivePlacement).toHaveBeenCalledWith(
      'user-1', 'project-1', 'chat', 'standalone-chat:chat-project-1', 'chat-attachment', entityId,
    );
    expect(mocks.createSkillRun).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ id: 'user-1' }),
      request: expect.objectContaining({
        projectId: 'project-1', sourceVersionIds: ['version-1'], surface: 'simple-chat',
      }),
    }));

    const rejected = await post({ ...requestBody, selectedEntityIds: ['task-1:user-message-1:wrong'] });
    expect(rejected.status).toBe(404);
    await expect(rejected.json()).resolves.toMatchObject({
      code: 'SIMPLE_CHAT_EXPORT_SOURCE_FORBIDDEN',
    });
    expect(mocks.createSkillRun).toHaveBeenCalledTimes(1);
  });
});
