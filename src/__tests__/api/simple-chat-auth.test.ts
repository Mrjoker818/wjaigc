import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
  createAssetVersion: vi.fn(),
  createWorkspacePlacement: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/server-api-config', () => ({
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
      createAssetVersion: mocks.createAssetVersion,
      createWorkspacePlacement: mocks.createWorkspacePlacement,
    }),
  };
});

vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {},
  Config: class {},
  HeaderUtils: { extractForwardHeaders: vi.fn() },
}));

import { POST } from '@/app/api/simple-chat/chat/route';
import { AssetServiceError } from '@/lib/asset-core/service';

function request(): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'chat-model',
    }),
  });
}

function registerRequest(overrides: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assetAction: 'register',
      projectId: 'canvas-project-a',
      workspaceId: 'standalone-chat:chat-project-a',
      entityType: 'chat-result',
      entityId: 'message-a:0',
      idempotencyKey: 'simple-chat:message-a:0',
      image: { url: '/api/serve-upload/generated.png', name: 'Generated image' },
      ...overrides,
    }),
  });
}

describe('POST /api/simple-chat/chat', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      productType: 'chat',
      apiPermissions: { chat: true },
    });
    mocks.createAssetVersion.mockResolvedValue({
      asset: { id: 'asset-a' },
      version: {
        id: 'version-a',
        assetId: 'asset-a',
        file: { url: '/api/serve-upload/generated.png' },
      },
      reused: false,
    });
    mocks.createWorkspacePlacement.mockResolvedValue({
      placement: { id: 'chat-placement-a' },
      reused: false,
    });
  });

  it('rejects unauthenticated requests before looking up a provider', async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });

  it('rejects a signed-in user without intelligent-chat permission', async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      productType: 'canvas',
      apiPermissions: { chat: false },
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });

  it('registers a chat placement with the session actor before provider lookup', async () => {
    const response = await POST(registerRequest());

    expect(response.status).toBe(200);
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
    expect(mocks.createAssetVersion).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      projectId: 'canvas-project-a',
      idempotencyKey: 'simple-chat:message-a:0',
    }));
    expect(mocks.createWorkspacePlacement).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      projectId: 'canvas-project-a',
      workspace: 'chat',
      workspaceId: 'standalone-chat:chat-project-a',
      entityType: 'chat-result',
      entityId: 'message-a:0',
      assetVersionId: 'version-a',
    }));
    await expect(response.json()).resolves.toEqual({
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'chat-placement-a',
      url: '/api/serve-upload/generated.png',
      name: 'Generated image',
    });
  });

  it('fails closed with the non-enumerating not-found shape for a foreign project', async () => {
    mocks.createAssetVersion.mockRejectedValue(new AssetServiceError('ASSET_NOT_FOUND'));

    const response = await POST(registerRequest({ projectId: 'foreign-project' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'ASSET_NOT_FOUND' });
    expect(mocks.createWorkspacePlacement).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });
});
