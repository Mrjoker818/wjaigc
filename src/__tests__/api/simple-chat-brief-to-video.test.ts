import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authorizeSources: vi.fn(),
  createSkillRun: vi.fn(),
  dispatchSkillRunExecution: vi.fn(),
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
  listPresets: vi.fn(),
  resolveTaskModelCatalog: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: mocks.findProviderById,
  findProviderForModel: mocks.findProviderForModel,
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/task-core/model-catalog', () => ({
  resolveTaskModel: vi.fn(), resolveTaskModelCatalog: mocks.resolveTaskModelCatalog,
}));
vi.mock('@/lib/multi-platform-export/presets', () => ({
  listEnabledPlatformExportPresets: mocks.listPresets,
}));
vi.mock('@/lib/multi-platform-export/simple-chat-source-authorization', () => ({
  authorizeSimpleChatExportSources: mocks.authorizeSources,
}));
vi.mock('@/lib/skill-runtime/service', () => ({
  createSkillRun: mocks.createSkillRun,
  dispatchSkillRunExecution: mocks.dispatchSkillRunExecution,
}));
vi.mock('@/lib/asset-core/service', () => ({
  AssetServiceError: class extends Error {}, createAssetService: vi.fn(),
}));
vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {}, Config: class {}, HeaderUtils: { extractForwardHeaders: vi.fn() },
}));
vi.mock('@/lib/asset-core/task-projector', () => ({
  projectCompletedTaskToAssets: vi.fn(), recordTaskProjectionCompleted: vi.fn(),
}));

import { POST } from '@/app/api/simple-chat/chat/route';

const videoCapability = {
  providerId: 'video-provider-1', modelId: 'video-model-1', kind: 'video',
  allowedDurationsSeconds: [5, 10], allowedRatios: ['9:16'], allowedSizes: ['1080p'],
  supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame'],
};

function request(content: string, withAttachment = true): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'chat-video-1' },
    body: JSON.stringify({
      messages: [{ id: 'user-1', role: 'user', content,
        images: withAttachment ? ['/managed/frame.png'] : [] }],
      model: 'chat-model-1', providerId: 'chat-provider-1',
      projectId: 'chat-project-1', taskId: 'task-1', assetProjectId: 'project-1',
      responseMessageId: 'assistant-1', sourceMessageId: 'user-1',
      sourceVersionIds: withAttachment ? ['frame-v1'] : [],
      selectedEntityIds: withAttachment ? ['task-1:user-1:0'] : [],
    }),
  });
}

function historyRequest(
  history: Array<{ id: string; role: string; content: string }>,
  content: string,
): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'chat-video-history-1' },
    body: JSON.stringify({
      messages: [...history, { id: 'user-latest', role: 'user', content, images: [] }],
      model: 'chat-model-1', providerId: 'chat-provider-1',
      projectId: 'chat-project-1', taskId: 'task-1', assetProjectId: 'project-1',
      responseMessageId: 'assistant-latest', sourceMessageId: 'user-latest',
      sourceVersionIds: [], selectedEntityIds: [],
    }),
  });
}

describe('POST /api/simple-chat/chat Brief to video intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-owner', role: 'user', productType: 'chat', apiPermissions: { chat: true },
    });
    mocks.resolveTaskModelCatalog.mockResolvedValue([videoCapability]);
    mocks.authorizeSources.mockResolvedValue({ sourceVersionIds: ['frame-v1'] });
    mocks.createSkillRun.mockResolvedValue({ runId: 'run-video-1', reused: false });
    mocks.dispatchSkillRunExecution.mockResolvedValue({ started: true, completion: Promise.resolve() });
  });

  it('creates the shared Skill Run with frozen chat and video bindings after authorizing attachments', async () => {
    const response = await POST(request(
      '根据 Brief：展示轻薄防晒霜的通勤使用场景，生成最终成片。平台：抖音；时长：5秒；比例：9:16；视频模型：video-model-1',
    ));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"type":"brief_to_video"');
    expect(mocks.authorizeSources).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-owner', projectId: 'project-1', sourceVersionIds: ['frame-v1'],
    }));
    expect(mocks.createSkillRun).toHaveBeenCalledWith({
      actor: expect.objectContaining({ id: 'user-owner' }),
      request: expect.objectContaining({
        skillId: 'preset-brief-to-video-film', skillVersion: 1, surface: 'simple-chat',
        projectId: 'project-1', workspaceId: 'standalone-chat:chat-project-1',
        sourceVersionIds: ['frame-v1'],
        modelBindings: {
          orchestrator: { providerId: 'chat-provider-1', modelId: 'chat-model-1' },
          video: { providerId: 'video-provider-1', modelId: 'video-model-1' },
        },
        inputValues: expect.objectContaining({
          brief: '展示轻薄防晒霜的通勤使用场景', platform: '抖音',
          durationSeconds: 5, aspectRatio: '9:16', startFrame: 'frame-v1',
        }),
      }),
    });
    expect(mocks.dispatchSkillRunExecution).toHaveBeenCalledWith({
      actorUserId: 'user-owner', runId: 'run-video-1', recoveryOnly: false,
    });
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });

  it('asks the first missing field and does not create a Run', async () => {
    const response = await POST(request('根据这份 Brief 生成最终视频', false));

    expect(await response.text()).toContain('请提供具体 Brief 或脚本内容');
    expect(mocks.createSkillRun).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });

  it('continues every field in a multi-turn clarification chain without reactivating an old Run', async () => {
    const response = await POST(historyRequest([
      { id: 'user-0', role: 'user', content: '根据这份 Brief 生成最终视频' },
      { id: 'assistant-0', role: 'assistant', content: '请提供具体 Brief 或脚本内容。' },
      { id: 'user-1', role: 'user', content: 'Brief：新品通勤短片' },
      { id: 'assistant-1', role: 'assistant', content: '请指定发布平台。' },
      { id: 'user-2', role: 'user', content: '平台：抖音' },
      { id: 'assistant-2', role: 'assistant', content: '请指定视频时长。' },
      { id: 'user-3', role: 'user', content: '时长：5秒' },
      { id: 'assistant-3', role: 'assistant', content: '请指定画面比例。' },
      { id: 'user-4', role: 'user', content: '比例：9:16' },
      { id: 'assistant-4', role: 'assistant', content: '请指定要使用的视频模型。' },
    ], '视频模型：video-model-1'));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"runId":"run-video-1"');
    expect(mocks.createSkillRun).toHaveBeenCalledTimes(1);
  });

  it('does not intercept an ambiguous video discussion', async () => {
    mocks.findProviderForModel.mockResolvedValue(null);
    const response = await POST(request('请分析这份 Brief 的视频方向', false));

    expect(response.status).toBe(400);
    expect(mocks.createSkillRun).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).toHaveBeenCalledTimes(1);
  });
});
