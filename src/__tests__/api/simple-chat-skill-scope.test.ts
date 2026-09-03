import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/server-api-config', () => ({
  findProviderById: mocks.findProviderById,
  findProviderForModel: mocks.findProviderForModel,
}));

vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock('@/lib/asset-core/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asset-core/service')>();
  return {
    ...actual,
    createAssetService: () => ({
      createAssetVersion: vi.fn(),
      createWorkspacePlacement: vi.fn(),
      createVersionWithPlacement: vi.fn(),
    }),
  };
});

vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {},
  Config: class {},
  HeaderUtils: { extractForwardHeaders: vi.fn() },
}));

vi.mock('@/lib/asset-core/task-projector', () => ({
  projectCompletedTaskToAssets: vi.fn(),
  recordTaskProjectionCompleted: vi.fn(),
}));

import { POST } from '@/app/api/simple-chat/chat/route';
import { CANVAS_PRESET_SKILLS } from '@/lib/skill-runtime/canvas-presets';
import { SIMPLE_CHAT_PRESET_SKILLS } from '@/lib/skill-runtime/simple-chat-presets';

function request(skillId: unknown): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'chat-model',
      skillId,
    }),
  });
}

describe('POST /api/simple-chat/chat Skill scope', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      productType: 'chat',
      apiPermissions: { chat: true },
    });
  });

  it.each(CANVAS_PRESET_SKILLS.map(skill => [skill.id]))(
    'rejects Canvas Skill %s before provider lookup',
    async (skillId) => {
      const response = await POST(request(skillId));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        success: false,
        code: 'SKILL_SURFACE_FORBIDDEN',
        message: '此 Skill 不适用于当前工作区',
      });
      expect(mocks.findProviderForModel).not.toHaveBeenCalled();
      expect(mocks.findProviderById).not.toHaveBeenCalled();
    },
  );

  it.each(SIMPLE_CHAT_PRESET_SKILLS.map(skill => [skill.id]))(
    'allows Simple Chat Skill %s to reach provider resolution',
    async (skillId) => {
      mocks.findProviderForModel.mockResolvedValue(null);

      const response = await POST(request(skillId));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: '未找到可用的 API 提供商' });
      expect(mocks.findProviderForModel).toHaveBeenCalledTimes(1);
    },
  );

  it('returns the stable not-found contract for an unknown Skill', async () => {
    const response = await POST(request('unknown-simple-chat-skill'));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'SKILL_NOT_FOUND',
      message: 'Skill not found: unknown-simple-chat-skill',
    });
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });

  it.each([false, 0, null, '', '   ', {}, []])(
    'rejects invalid Skill ID %j before provider lookup',
    async (skillId) => {
      const response = await POST(request(skillId));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        success: false,
        code: 'SKILL_ID_INVALID',
        message: 'skillId must be a non-empty string of at most 256 characters',
      });
      expect(mocks.findProviderForModel).not.toHaveBeenCalled();
      expect(mocks.findProviderById).not.toHaveBeenCalled();
    },
  );

  it('rejects an oversized Skill ID at the Simple Chat boundary', async () => {
    const response = await POST(request('s'.repeat(257)));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'SKILL_ID_INVALID',
      message: 'skillId must be a non-empty string of at most 256 characters',
    });
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });
});
