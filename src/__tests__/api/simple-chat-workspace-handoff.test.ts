import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  resolveSimpleChatWorkspaceHandoff: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/simple-chat-workspace-handoff-server', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/simple-chat-workspace-handoff-server')>();
  return { ...actual, resolveSimpleChatWorkspaceHandoff: mocks.resolveSimpleChatWorkspaceHandoff };
});

import { POST } from '@/app/api/simple-chat/workspace-handoff/route';
import { SimpleChatWorkspaceHandoffError } from '@/lib/simple-chat-workspace-handoff-server';

const body = {
  targetProjectId: 'canvas-1',
  chatProjectId: 'chat-1',
  chatTaskId: 'task-1',
  chatMessageId: 'message-1',
};

const handoff = {
  text: '最终方案',
  images: [{
    imageIndex: 0,
    assetRef: {
      url: '/api/serve-upload/managed.png',
      assetVersionId: 'version-1',
      placementId: 'placement-1',
    },
    sourceTrace: {
      source: 'simple-chat' as const,
      chatProjectId: 'chat-1',
      chatTaskId: 'task-1',
      messageId: 'message-1',
      createdAt: '2026-08-27T00:00:00.000Z',
    },
  }],
  sourceTrace: {
    source: 'simple-chat' as const,
    chatProjectId: 'chat-1',
    chatTaskId: 'task-1',
    messageId: 'message-1',
    createdAt: '2026-08-27T00:00:00.000Z',
  },
  warnings: [] as Array<'UNMANAGED_IMAGE_SKIPPED'>,
};

function request(value: unknown, expectedActorUserId?: string): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/workspace-handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
      ...(expectedActorUserId !== undefined ? { 'x-wujie-expected-actor-id': expectedActorUserId } : {}) },
    body: JSON.stringify(value),
  });
}

describe('POST /api/simple-chat/workspace-handoff', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1', role: 'user' });
    mocks.resolveSimpleChatWorkspaceHandoff.mockResolvedValue(handoff);
  });

  it('returns 401 without a session', async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(request(body));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ success: false, code: 'UNAUTHORIZED' });
    expect(mocks.resolveSimpleChatWorkspaceHandoff).not.toHaveBeenCalled();
  });

  it('returns structured JSON when the auth dependency rejects', async () => {
    mocks.getSessionUser.mockRejectedValue(new Error('session backend unavailable'));

    const response = await POST(request(body));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'HANDOFF_RESOLVE_FAILED',
    });
    expect(mocks.resolveSimpleChatWorkspaceHandoff).not.toHaveBeenCalled();
  });

  it('rejects a changed cookie actor before parsing the body or resolving private chat', async () => {
    const input = request(body, 'previous-user');
    const readBody = vi.spyOn(input, 'json');
    const response = await POST(input);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ success: false, code: 'ACTOR_CHANGED' });
    expect(readBody).not.toHaveBeenCalled();
    expect(mocks.resolveSimpleChatWorkspaceHandoff).not.toHaveBeenCalled();
  });

  it('accepts the matching expected actor while preserving the session actor as authority', async () => {
    const response = await POST(request(body, 'user-1'));
    expect(response.status).toBe(200);
    expect(mocks.resolveSimpleChatWorkspaceHandoff).toHaveBeenCalledWith({ actorUserId: 'user-1', ...body });
    await expect(response.json()).resolves.toEqual({ success: true, handoff });
  });

  it('returns 400 for malformed identifiers', async () => {
    const response = await POST(request({ ...body, chatMessageId: 'invalid id' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, code: 'INVALID_HANDOFF' });
    expect(mocks.resolveSimpleChatWorkspaceHandoff).not.toHaveBeenCalled();
  });

  it('returns 403 when target ownership cannot be proven', async () => {
    mocks.resolveSimpleChatWorkspaceHandoff.mockRejectedValue(
      new SimpleChatWorkspaceHandoffError('FORBIDDEN', 403),
    );

    const response = await POST(request(body));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ success: false, code: 'FORBIDDEN' });
  });

  it('returns 404 when the actor-scoped source message is missing', async () => {
    mocks.resolveSimpleChatWorkspaceHandoff.mockRejectedValue(
      new SimpleChatWorkspaceHandoffError('HANDOFF_SOURCE_NOT_FOUND', 404),
    );

    const response = await POST(request(body));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ success: false, code: 'HANDOFF_SOURCE_NOT_FOUND' });
  });

  it('injects the session actor and returns a structured 200 payload', async () => {
    const response = await POST(request(body));

    expect(response.status).toBe(200);
    expect(mocks.resolveSimpleChatWorkspaceHandoff).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      ...body,
    });
    await expect(response.json()).resolves.toEqual({ success: true, handoff });
  });
});
