import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: { baseUrl: 'https://llm.example.com/v1', apiKey: 'k', modelId: 'chat-1' } as Record<string, unknown> | null,
  writes: [] as Array<{ input: Record<string, unknown>; options: Record<string, unknown> }>,
  created: [] as Array<{ userId: string; projectId: string | null }>,
  access: { kind: 'personal', projectId: 'project-1' } as Record<string, unknown>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ getInternalRequestHeaders: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/drama/draft', () => ({
  dramaPlannerConfig: async () => mocks.config,
  writeDramaScript: async (_config: unknown, input: Record<string, unknown>, options: Record<string, unknown>) => {
    mocks.writes.push({ input, options });
    return {
      title: '雨夜来信', cast: [{ id: 'lin' }],
      episodes: [{ id: 'ep', scenes: [{ id: 'a', shots: [] }, { id: 'b', shots: [] }] }],
    };
  },
}));
vi.mock('@/lib/drama/store', () => ({
  createDramaProject: async (userId: string, projectId: string | null, doc: { title: string }) => {
    mocks.created.push({ userId, projectId });
    return { id: 'drama_1', title: doc.title };
  },
}));
vi.mock('@/lib/collaboration/generation-project-access', () => ({
  authorizeGenerationProject: async () => mocks.access,
  GenerationProjectAccessError: class extends Error {},
}));

import { buildChatToolGuide, CHAT_TOOLS, executeToolCall, PAID_CHAT_TOOLS } from '@/lib/chat-tools';

const context = {
  chatApiKey: 'k', chatBaseUrl: 'https://example.com', origin: 'https://app.example.com', userId: 'user-1', projectId: 'project-1',
};

beforeEach(() => {
  mocks.config = { baseUrl: 'https://llm.example.com/v1', apiKey: 'k', modelId: 'chat-1' };
  mocks.writes = [];
  mocks.created = [];
  mocks.access = { kind: 'personal', projectId: 'project-1' };
});

describe('create_drama_draft chat tool', () => {
  it('is a free tool listed in the tool guide', () => {
    expect(CHAT_TOOLS.some(tool => tool.function.name === 'create_drama_draft')).toBe(true);
    expect(PAID_CHAT_TOOLS.has('create_drama_draft')).toBe(false);
    expect(buildChatToolGuide(['create_drama_draft'])).toContain('在短剧工作台打开');
  });

  it('writes one script, saves it in the canvas project and returns the draft id', async () => {
    const result = await executeToolCall('create_drama_draft', { idea: '外卖员暴雨夜送错餐', style: 'anime', aspect_ratio: '16:9' }, context);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ dramaId: 'drama_1', title: '雨夜来信' });
    expect(result.resultText).toContain('1 集、2 场、1 个角色');
    expect(mocks.writes[0]).toEqual({ input: { idea: '外卖员暴雨夜送错餐', style: 'anime', aspectRatio: '16:9' }, options: { retry: false } });
    expect(mocks.created).toEqual([{ userId: 'user-1', projectId: 'project-1' }]);
  });

  it('rejects a missing idea and an unknown style before calling the planner', async () => {
    expect((await executeToolCall('create_drama_draft', { idea: '  ' }, context)).error).toBe('Missing required parameter: idea');
    expect((await executeToolCall('create_drama_draft', { idea: '故事', style: 'noir' }, context)).error).toBe('Invalid value for style');
    expect(mocks.writes).toHaveLength(0);
  });

  it('explains when no chat model is configured', async () => {
    mocks.config = null;
    const result = await executeToolCall('create_drama_draft', { idea: '故事' }, context);
    expect(result).toMatchObject({ success: false, error: 'DRAMA_PLANNER_NOT_CONFIGURED' });
    expect(mocks.created).toHaveLength(0);
  });

  it('saves without a canvas project when the chat has none', async () => {
    mocks.access = { kind: 'unscoped' };
    await executeToolCall('create_drama_draft', { idea: '故事' }, { ...context, projectId: undefined });
    expect(mocks.created).toEqual([{ userId: 'user-1', projectId: null }]);
  });
});
