import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userId: 'user-a' as string | null,
  productType: 'canvas,video' as string,
  handoff: { text: '雨夜收到一封信' as string | null } as Record<string, unknown>,
  handoffError: null as Error | null,
  config: { baseUrl: 'https://llm.example.com/v1', apiKey: 'k', modelId: 'chat-1' } as Record<string, unknown> | null,
  ideas: [] as string[],
  created: [] as Array<{ userId: string; projectId: string | null; references?: unknown }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => (mocks.userId
    ? { authenticated: true, userId: mocks.userId, userRole: 'user', user: { id: mocks.userId, role: 'user', productType: mocks.productType } }
    : NextResponse.json({ error: 'Authentication required' }, { status: 401 })),
}));
vi.mock('@/lib/simple-chat-workspace-handoff-server', () => {
  class SimpleChatWorkspaceHandoffError extends Error {
    constructor(readonly code: string, readonly status: number) { super(code); }
  }
  return {
    SimpleChatWorkspaceHandoffError,
    resolveSimpleChatWorkspaceHandoff: async () => {
      if (mocks.handoffError) throw mocks.handoffError;
      return mocks.handoff;
    },
  };
});
vi.mock('@/lib/collaboration/generation-project-access', () => ({
  authorizeGenerationProject: async (input: { projectId: string }) => ({ kind: 'personal', projectId: input.projectId }),
  GenerationProjectAccessError: class extends Error {},
}));
vi.mock('@/lib/drama/draft', () => ({
  dramaPlannerConfig: async () => mocks.config,
  writeDramaScript: async (_config: unknown, input: { idea: string }) => {
    mocks.ideas.push(input.idea);
    return { title: '雨夜来信' };
  },
}));
vi.mock('@/lib/drama/store', () => ({
  createDramaProject: async (userId: string, projectId: string | null, doc: { references?: unknown }) => {
    mocks.created.push({ userId, projectId, ...(doc.references ? { references: doc.references } : {}) });
    return { id: 'drama_9', projectId, title: '雨夜来信' };
  },
}));

import { POST } from '@/app/api/drama/from-chat/route';
import { SimpleChatWorkspaceHandoffError } from '@/lib/simple-chat-workspace-handoff-server';

const intent = { targetProjectId: 'canvas-1', chatProjectId: 'chat-p', chatTaskId: 'chat-t', chatMessageId: 'msg-1' };
const post = (body: unknown) => new NextRequest('http://localhost/api/drama/from-chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  mocks.userId = 'user-a';
  mocks.productType = 'canvas,video';
  mocks.handoff = { text: '雨夜收到一封信', images: [] };
  mocks.handoffError = null;
  mocks.config = { baseUrl: 'https://llm.example.com/v1', apiKey: 'k', modelId: 'chat-1' };
  mocks.ideas = [];
  mocks.created = [];
});

describe('POST /api/drama/from-chat', () => {
  it('writes the chat message into a draft bound to the target canvas project', async () => {
    const response = await POST(post(intent));
    expect(response.status).toBe(201);
    expect((await response.json()).project.id).toBe('drama_9');
    expect(mocks.ideas).toEqual(['雨夜收到一封信']);
    expect(mocks.created).toEqual([{ userId: 'user-a', projectId: 'canvas-1' }]);
  });

  it('keeps the managed images of the message on the draft for the bible to pick', async () => {
    mocks.handoff = { text: '雨夜收到一封信', images: [
      { imageIndex: 0, assetRef: { url: '/api/serve-upload/uploads/a.png', name: '林夏照片' } },
      { imageIndex: 1, assetRef: { url: 'data:image/png;base64,AAAA' } },
      { imageIndex: 2, assetRef: { url: 'https://cdn.example.com/b.png' } },
    ] };
    expect((await POST(post(intent))).status).toBe(201);
    expect(mocks.created[0].references).toEqual([
      { url: '/api/serve-upload/uploads/a.png', name: '林夏照片', source: 'chat' },
      { url: 'https://cdn.example.com/b.png', name: '对话图片 3', source: 'chat' },
    ]);
  });

  it('rejects incomplete intents and unauthenticated callers', async () => {
    expect((await POST(post({ ...intent, chatMessageId: '' }))).status).toBe(400);
    mocks.userId = null;
    expect((await POST(post(intent))).status).toBe(401);
    expect(mocks.created).toHaveLength(0);
  });

  it('refuses a message without text', async () => {
    mocks.handoff = { text: null, images: [] };
    const response = await POST(post(intent));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('DRAMA_HANDOFF_NO_TEXT');
    expect(mocks.ideas).toHaveLength(0);
  });

  it('maps handoff errors to readable messages', async () => {
    mocks.handoffError = new SimpleChatWorkspaceHandoffError('FORBIDDEN', 403);
    const response = await POST(post(intent));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('无权');
  });

  it('reports a missing chat model', async () => {
    mocks.config = null;
    const response = await POST(post(intent));
    expect(response.status).toBe(503);
    expect(mocks.created).toHaveLength(0);
  });
});
