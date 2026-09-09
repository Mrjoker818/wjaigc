import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createSkillRun: vi.fn(),
  dispatchSkillRunExecution: vi.fn(),
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
  listEnabledPlatformExportPresets: vi.fn(),
  authorizeSimpleChatExportSources: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: mocks.findProviderById,
  findProviderForModel: mocks.findProviderForModel,
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/multi-platform-export/presets', () => ({
  listEnabledPlatformExportPresets: mocks.listEnabledPlatformExportPresets,
}));
vi.mock('@/lib/multi-platform-export/simple-chat-source-authorization', () => ({
  authorizeSimpleChatExportSources: mocks.authorizeSimpleChatExportSources,
  SimpleChatExportSourceAuthorizationError: class extends Error {
    code = 'SIMPLE_CHAT_EXPORT_SOURCE_FORBIDDEN';
    status = 404;
  },
}));
vi.mock('@/lib/skill-runtime/service', () => ({
  createSkillRun: mocks.createSkillRun,
  dispatchSkillRunExecution: mocks.dispatchSkillRunExecution,
}));
vi.mock('@/lib/asset-core/service', () => ({
  AssetServiceError: class extends Error {},
  createAssetService: vi.fn(),
}));
vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {}, Config: class {}, HeaderUtils: { extractForwardHeaders: vi.fn() },
}));
vi.mock('@/lib/asset-core/task-projector', () => ({
  projectCompletedTaskToAssets: vi.fn(), recordTaskProjectionCompleted: vi.fn(),
}));

import { POST } from '@/app/api/simple-chat/chat/route';

const presets = [
  {
    id: 'instagram-post', version: 3, platform: 'instagram', usage: 'post',
    label: 'Instagram 帖子', width: 1080, height: 1080, recommendedFormat: 'jpeg',
    supportsTransparency: false, enabled: true,
  },
  {
    id: 'instagram-story', version: 2, platform: 'instagram', usage: 'story',
    label: 'Instagram 快拍', width: 1080, height: 1920, recommendedFormat: 'jpeg',
    supportsTransparency: false, enabled: true,
  },
];

function request(
  content: string,
  sourceVersionIds: string[] = ['version-source-1'],
  history: Array<{ id: string; role: string; content: string; images?: string[] }> = [],
  sourceMessageId = 'user-message-1',
): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'chat-request-1' },
    body: JSON.stringify({
      messages: [...history, { id: 'user-message-1', role: 'user', content, images: sourceVersionIds.length ? ['/managed.png'] : [] }],
      model: 'chat-model', providerId: 'provider-1',
      projectId: 'chat-project-1', taskId: 'task-1', responseMessageId: 'message-2',
      assetProjectId: 'project-1', sourceVersionIds,
      sourceMessageId,
      selectedEntityIds: sourceVersionIds.map((_, index) => `task-1:${sourceMessageId}:${index}`),
      idempotencyKey: 'chat-request-1',
    }),
  });
}

describe('POST /api/simple-chat/chat multi-platform export intent', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1', role: 'user', productType: 'chat', apiPermissions: { chat: true },
    });
    mocks.listEnabledPlatformExportPresets.mockResolvedValue(presets);
    mocks.createSkillRun.mockResolvedValue({ runId: 'run-export-1', reused: false });
    mocks.dispatchSkillRunExecution.mockResolvedValue({ started: true, completion: Promise.resolve() });
    mocks.authorizeSimpleChatExportSources.mockResolvedValue({
      sourceVersionIds: ['version-source-1'], mediaUrls: ['/managed.png'],
    });
  });

  it('creates the shared local Skill Run with the Simple Chat surface and no model bindings', async () => {
    const response = await POST(request('把这些图片批量导出 Instagram 帖子和故事尺寸，完整留白'));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"type":"multi_platform_export"');
    expect(body).toContain('"runId":"run-export-1"');
    expect(mocks.createSkillRun).toHaveBeenCalledWith({
      actor: expect.objectContaining({ id: 'user-1' }),
      request: expect.objectContaining({
        skillId: 'preset-multi-platform-export', skillVersion: 1,
        surface: 'simple-chat', projectId: 'project-1',
        workspaceId: 'standalone-chat:chat-project-1',
        sourceVersionIds: ['version-source-1'], modelBindings: {},
        inputValues: {
          sourceAssetVersionIds: ['version-source-1'],
          targetPresetIds: ['instagram-post-v3', 'instagram-story-v2'],
          fit: 'contain', background: '#ffffffff',
          namingTemplate: '{project}-{asset}-{platform}-{size}-{index}',
        },
      }),
    });
    expect(mocks.authorizeSimpleChatExportSources).toHaveBeenCalledWith({
      actorUserId: 'user-1', projectId: 'project-1',
      workspaceId: 'standalone-chat:chat-project-1', taskId: 'task-1',
      messageId: 'user-message-1', sourceVersionIds: ['version-source-1'],
      entityIds: ['task-1:user-message-1:0'], messageImageUrls: ['/managed.png'],
    });
    expect(mocks.dispatchSkillRunExecution).toHaveBeenCalledWith({
      actorUserId: 'user-1', runId: 'run-export-1', recoveryOnly: false,
    });
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });

  it('treats the managed attachment as the source when the text only names the batch targets', async () => {
    const response = await POST(request('批量导出 Instagram 帖子尺寸'));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"runId":"run-export-1"');
    expect(mocks.createSkillRun).toHaveBeenCalledTimes(1);
  });

  it('asks for missing managed sources or targets without submitting or calling the LLM', async () => {
    const noSources = await POST(request('把这些图片批量导出 Instagram 帖子尺寸', []));
    expect(await noSources.text()).toContain('请先附加要导出的受管图片');

    const noTargets = await POST(request('把这些图片批量导出平台尺寸'));
    expect(await noTargets.text()).toContain('请指定目标平台或尺寸');

    expect(mocks.createSkillRun).not.toHaveBeenCalled();
    expect(mocks.dispatchSkillRunExecution).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });

  it('rejects an attachment outside the exact source message before creating a Run', async () => {
    mocks.authorizeSimpleChatExportSources.mockRejectedValue(
      Object.assign(new Error('forbidden'), {
        code: 'SIMPLE_CHAT_EXPORT_SOURCE_FORBIDDEN', status: 404,
      }),
    );
    const response = await POST(request('把这些图片批量导出 Instagram 帖子尺寸'));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'SIMPLE_CHAT_EXPORT_SOURCE_FORBIDDEN',
    });
    expect(mocks.createSkillRun).not.toHaveBeenCalled();
    expect(mocks.dispatchSkillRunExecution).not.toHaveBeenCalled();
  });

  it('accepts a concise target answer only after the controlled clarification', async () => {
    const response = await POST(request('Instagram 帖子和故事尺寸', ['version-source-1'], [
      { id: 'source-message-1', role: 'user', content: '把这些图片批量导出平台尺寸', images: ['/managed.png'] },
      { id: 'clarification-1', role: 'assistant', content: '请指定目标平台或尺寸。' },
    ], 'source-message-1'));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"runId":"run-export-1"');
    expect(mocks.createSkillRun).toHaveBeenCalledTimes(1);
  });

  it('does not reactivate an already submitted export from unrelated follow-up text', async () => {
    mocks.findProviderForModel.mockResolvedValue(null);
    const response = await POST(request('谢谢', [], [
      { id: 'source-message-1', role: 'user', content: '把这些图片批量导出 Instagram 帖子尺寸', images: ['/managed.png'] },
      { id: 'result-message-1', role: 'assistant', content: '批量导出任务已提交。' },
    ]));

    expect(response.status).toBe(400);
    expect(mocks.createSkillRun).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch the same persisted Run twice for a duplicate idempotency key', async () => {
    mocks.createSkillRun
      .mockResolvedValueOnce({ runId: 'run-export-1', reused: false })
      .mockResolvedValueOnce({ runId: 'run-export-1', reused: true });

    const first = await POST(request('把这些图片批量导出 Instagram 帖子尺寸'));
    const duplicate = await POST(request('把这些图片批量导出 Instagram 帖子尺寸'));

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.text()).toContain('"runId":"run-export-1"');
    expect(mocks.createSkillRun).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchSkillRunExecution).toHaveBeenCalledTimes(1);
  });
});
