import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createSkillRun: vi.fn(),
  dispatchSkillRunExecution: vi.fn(),
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
  listEnabledPlatformExportPresets: vi.fn(),
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
  history: Array<{ role: string; content: string; images?: string[] }> = [],
): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'chat-request-1' },
    body: JSON.stringify({
      messages: [...history, { role: 'user', content, images: sourceVersionIds.length ? ['/managed.png'] : [] }],
      model: 'chat-model', providerId: 'provider-1',
      projectId: 'chat-project-1', taskId: 'task-1', responseMessageId: 'message-2',
      assetProjectId: 'project-1', sourceVersionIds,
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

  it('accepts a concise target answer only after the controlled clarification', async () => {
    const response = await POST(request('Instagram 帖子和故事尺寸', ['version-source-1'], [
      { role: 'user', content: '把这些图片批量导出平台尺寸', images: ['/managed.png'] },
      { role: 'assistant', content: '请指定目标平台或尺寸。' },
    ]));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"runId":"run-export-1"');
    expect(mocks.createSkillRun).toHaveBeenCalledTimes(1);
  });

  it('does not reactivate an already submitted export from unrelated follow-up text', async () => {
    mocks.findProviderForModel.mockResolvedValue(null);
    const response = await POST(request('谢谢', [], [
      { role: 'user', content: '把这些图片批量导出 Instagram 帖子尺寸', images: ['/managed.png'] },
      { role: 'assistant', content: '批量导出任务已提交。' },
    ]));

    expect(response.status).toBe(400);
    expect(mocks.createSkillRun).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).toHaveBeenCalledTimes(1);
  });
});
