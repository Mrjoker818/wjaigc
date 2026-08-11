import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
  createAssetVersion: vi.fn(),
  createWorkspacePlacement: vi.fn(),
  createVersionWithPlacement: vi.fn(),
  getInternalApiUrl: vi.fn((path: string) => `http://127.0.0.1:5000${path}`),
  getInternalRequestHeaders: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/server-api-config', () => ({
  findProviderForModel: mocks.findProviderForModel,
}));

vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-helpers')>();
  return {
    ...actual,
    getInternalApiUrl: mocks.getInternalApiUrl,
  };
});

vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: mocks.getInternalRequestHeaders,
}));

vi.mock('@/lib/asset-core/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asset-core/service')>();
  return {
    ...actual,
    createAssetService: () => ({
      createAssetVersion: mocks.createAssetVersion,
      createWorkspacePlacement: mocks.createWorkspacePlacement,
      createVersionWithPlacement: mocks.createVersionWithPlacement,
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

function imageToolRequest(
  origin = 'https://attacker.example',
): NextRequest {
  return new NextRequest(`${origin}/api/simple-chat/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Generate a lighthouse at night' }],
      model: 'chat-model',
      providerId: 'chat-provider',
      imageModel: 'image-model',
      imageProviderId: 'image-provider',
    }),
  });
}

function imageToolCallResponse(): Response {
  const toolCall = JSON.stringify({
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id: 'tool-call-1',
          function: {
            name: 'generate_image',
            arguments: JSON.stringify({ prompt: 'A lighthouse at night', size: '1024x1024' }),
          },
        }],
      },
    }],
  });
  return new Response(`data: ${toolCall}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
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

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('POST /api/simple-chat/chat', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getInternalApiUrl.mockImplementation((path: string) => `http://127.0.0.1:5000${path}`);
    mocks.getInternalRequestHeaders.mockResolvedValue({
      Authorization: 'Bearer internal-test',
      'x-wujie-internal-secret': 'internal-secret',
    });
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
    mocks.createVersionWithPlacement.mockImplementation(async (input: {
      resolveFile: () => Promise<{ url: string }>;
    }) => {
      const file = await input.resolveFile();
      return {
        asset: { id: 'asset-a' },
        version: { id: 'version-a', assetId: 'asset-a', file },
        placement: { id: 'chat-placement-a' },
        reused: false,
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
    expect(mocks.createVersionWithPlacement).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      projectId: 'canvas-project-a',
      idempotencyKey: 'simple-chat:message-a:0',
      placement: expect.objectContaining({
        workspace: 'chat',
        workspaceId: 'standalone-chat:chat-project-a',
        entityType: 'chat-result',
        entityId: 'message-a:0',
      }),
    }));
    expect(mocks.createAssetVersion).not.toHaveBeenCalled();
    expect(mocks.createWorkspacePlacement).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'chat-placement-a',
      url: '/api/serve-upload/generated.png',
      name: 'Generated image',
    });
  });

  it('fails closed with the non-enumerating not-found shape for a foreign project', async () => {
    mocks.createVersionWithPlacement.mockRejectedValue(new AssetServiceError('ASSET_NOT_FOUND'));

    const response = await POST(registerRequest({ projectId: 'foreign-project' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'ASSET_NOT_FOUND' });
    expect(mocks.createWorkspacePlacement).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });

  it('I7 ignores a hostile request origin and calls save-image only through getInternalApiUrl', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      url: '/api/serve-upload/uploads/persisted.png',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const hostile = new NextRequest('https://attacker.example/api/simple-chat/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assetAction: 'register',
        projectId: 'canvas-project-a',
        workspaceId: 'standalone-chat:chat-project-a',
        entityType: 'chat-result',
        entityId: 'message-a:0',
        idempotencyKey: 'simple-chat:hostile-origin:0',
        image: { url: tinyPng, name: 'Generated image' },
      }),
    });

    const response = await POST(hostile);
    const responseBody = await response.clone().json();

    expect(mocks.getInternalApiUrl).toHaveBeenCalledWith('/api/save-image');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/api/save-image',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://attacker.example/api/save-image',
      expect.anything(),
    );
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
  });

  it('C1 sends a direct generate_image tool request with internal auth only to getInternalApiUrl', async () => {
    mocks.findProviderForModel.mockResolvedValue({
      id: 'chat-provider',
      apiKey: 'chat-key',
      baseUrl: 'https://chat.example/v1',
      advancedParams: {},
    });
    const fetchMock = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url === 'https://chat.example/v1/chat/completions') return imageToolCallResponse();
      if (url === 'http://127.0.0.1:5000/api/generate') {
        return jsonResponse({ success: true, directImageUrls: ['/api/serve-upload/direct.png'] });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(imageToolRequest());
    const events = await response.text();
    const secretUrls = fetchMock.mock.calls
      .filter(([, init]) => new Headers(init?.headers).get('x-wujie-internal-secret') === 'internal-secret')
      .map(([input]) => String(input));

    expect(events).toContain('/api/serve-upload/direct.png');
    expect(mocks.getInternalApiUrl).toHaveBeenCalledWith('/api/generate');
    expect(secretUrls).toEqual(['http://127.0.0.1:5000/api/generate']);
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://attacker.example/api/generate',
      expect.anything(),
    );
  });

  it('C1 sends async generate_image polling with internal auth only to getInternalApiUrl', async () => {
    vi.useFakeTimers();
    mocks.findProviderForModel.mockResolvedValue({
      id: 'chat-provider',
      apiKey: 'chat-key',
      baseUrl: 'https://chat.example/v1',
      advancedParams: {},
    });
    const fetchMock = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url === 'https://chat.example/v1/chat/completions') return imageToolCallResponse();
      if (url === 'http://127.0.0.1:5000/api/generate') {
        return jsonResponse({ success: true, taskIds: ['task-async-1'] });
      }
      if (url === 'http://127.0.0.1:5000/api/poll-task') {
        return jsonResponse({ status: 'completed', imageUrl: '/api/serve-upload/async.png' });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(imageToolRequest());
    const eventsPromise = response.text();
    await vi.runAllTimersAsync();
    const events = await eventsPromise;
    const secretUrls = fetchMock.mock.calls
      .filter(([, init]) => new Headers(init?.headers).get('x-wujie-internal-secret') === 'internal-secret')
      .map(([input]) => String(input));

    expect(events).toContain('/api/serve-upload/async.png');
    expect(mocks.getInternalApiUrl).toHaveBeenCalledWith('/api/generate');
    expect(mocks.getInternalApiUrl).toHaveBeenCalledWith('/api/poll-task');
    expect(secretUrls).toEqual([
      'http://127.0.0.1:5000/api/generate',
      'http://127.0.0.1:5000/api/poll-task',
    ]);
    expect(secretUrls.every(url => !url.startsWith('https://attacker.example'))).toBe(true);
  });

  it('I4 derives a stable registration digest from original data content, not persisted URLs', async () => {
    const persistedUrls = [
      '/api/serve-upload/uploads/first.png',
      '/api/serve-upload/uploads/second.png',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      url: persistedUrls.shift(),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await POST(registerRequest({ image: { url: tinyPng, name: 'Stable' } }));
    await POST(registerRequest({ image: { url: tinyPng, name: 'Stable' } }));

    const digests = mocks.createVersionWithPlacement.mock.calls.map(([input]) => input.requestDigest);
    expect(digests).toHaveLength(2);
    expect(new Set(digests).size).toBe(1);
  });

  it.each([
    ['blob URL', 'blob:https://example.test/123'],
    ['file URL', 'file:///etc/passwd'],
    ['javascript URL', 'javascript:alert(1)'],
    ['arbitrary relative URL', 'images/private.png'],
    ['arbitrary root path', '/private/image.png'],
    ['oversized HTTP URL', `https://example.test/${'x'.repeat(4097)}`],
    ['invalid data image', 'data:image/png;base64,%%%'],
  ])('M1 rejects %s', async (_label, url) => {
    const response = await POST(registerRequest({ image: { url } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'ASSET_REQUEST_INVALID' });
    expect(mocks.createVersionWithPlacement).not.toHaveBeenCalled();
  });

  it.each([
    ['projectId', { projectId: 'p'.repeat(129) }],
    ['workspaceId', { workspaceId: 'w'.repeat(257) }],
    ['entityId', { entityId: 'e'.repeat(257) }],
    ['idempotencyKey', { idempotencyKey: 'i'.repeat(257) }],
    ['image name', { image: { url: '/api/serve-upload/generated.png', name: 'n'.repeat(257) } }],
    ['mime type', { image: { url: '/api/serve-upload/generated.png', mimeType: 'm'.repeat(129) } }],
  ])('M1 rejects oversized %s', async (_label, overrides) => {
    const response = await POST(registerRequest(overrides));

    expect(response.status).toBe(400);
    expect(mocks.createVersionWithPlacement).not.toHaveBeenCalled();
  });

  it.each([
    '/api/serve-upload/uploads/generated.png',
    '/uploads/generated.png',
    'https://cdn.example.test/generated.png',
    'http://127.0.0.1/generated.png',
  ])('M1 accepts an allowed media URL: %s', async (url) => {
    const response = await POST(registerRequest({ image: { url } }));

    expect(response.status).toBe(200);
    expect(mocks.createVersionWithPlacement).toHaveBeenCalledTimes(1);
  });
});
