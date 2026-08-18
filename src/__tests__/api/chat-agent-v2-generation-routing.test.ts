import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

interface CapturedGenerateRequest {
  headers: Headers;
  body: Record<string, unknown>;
}

const mocks = vi.hoisted(() => ({
  appendUserJsonl: vi.fn(),
  authorizeAgentContext: vi.fn(),
  consumeCredits: vi.fn(),
  fetchWithTimeout: vi.fn(),
  fetchWithV1Retry: vi.fn(),
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  getApiProviders: vi.fn(),
  getInternalRequestHeaders: vi.fn(),
  getSessionUser: vi.fn(),
  prepareAdmittedAgentTaskExecution: vi.fn(),
  projectCompletedTaskToAssets: vi.fn(),
  recordTaskProjectionCompleted: vi.fn(),
  resolveTaskModel: vi.fn(),
  generateRequests: [] as CapturedGenerateRequest[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: mocks.appendUserJsonl }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: mocks.findProviderById,
  findProviderForModel: mocks.findProviderForModel,
  getApiProviders: mocks.getApiProviders,
  normalizeApiBaseUrl: (value: string) => value.replace(/\/+$/, ''),
}));
vi.mock('@/lib/api-helpers', () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
  fetchWithV1Retry: mocks.fetchWithV1Retry,
  getInternalApiUrl: (path: string) => `http://127.0.0.1:5000${path}`,
}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: mocks.getInternalRequestHeaders,
  requireApiAuthOrReject: vi.fn().mockResolvedValue({ userId: 'user-1', userRole: 'user' }),
}));
vi.mock('@/lib/prompt-safety', () => ({
  checkPromptSafety: () => ({ level: 'safe' }),
  logSafetyWarning: vi.fn(),
}));
vi.mock('@/lib/credits', () => ({
  consumeCredits: mocks.consumeCredits,
  refundCredits: vi.fn().mockResolvedValue(undefined),
  resolveConfiguredTokenPricing: vi.fn().mockResolvedValue(null),
  settleTokenCharge: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/op-log', () => ({
  logOperation: vi.fn(),
  logError: vi.fn(),
  startTimer: () => ({ end: () => 1 }),
  OP_ACTIONS: { CHAT: 'chat' },
}));
vi.mock('@/lib/task-core/model-catalog', () => ({ resolveTaskModel: mocks.resolveTaskModel }));
vi.mock('@/lib/agent-runtime/admission-gate', () => ({
  admitAuthorizedAgentExecution: vi.fn(async (input: {
    admit: (context: {
      mediaByVersionId: Record<string, string>;
      selectedEntityVersionIds: Record<string, string>;
    }) => Promise<Response>;
  }) => input.admit({
    mediaByVersionId: { 'canvas-source-version': '/api/serve-upload/source.png' },
    selectedEntityVersionIds: { 'canvas-source-entity': 'canvas-source-version' },
  })),
}));
vi.mock('@/lib/agent-runtime/surface-dispatch', () => ({
  prepareAdmittedAgentTaskExecution: mocks.prepareAdmittedAgentTaskExecution,
}));
vi.mock('@/lib/agent-runtime/context-adapters', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/agent-runtime/context-adapters')>(),
  authorizeAgentContext: mocks.authorizeAgentContext,
}));
vi.mock('@/lib/chat-generation-controls', () => ({ resolveChatControls: () => ({}) }));
vi.mock('@/lib/asset-core/service', () => {
  class AssetServiceError extends Error {
    code = 'ASSET_ERROR';
  }
  return {
    AssetServiceError,
    createAssetService: () => ({
      createVersionWithPlacement: vi.fn(async (input: { resolveFile: () => Promise<{ url: string }> }) => ({
        asset: { id: 'asset-generated' },
        version: { id: 'version-generated', assetId: 'asset-generated', file: await input.resolveFile() },
        placement: { id: 'placement-generated', entityId: 'assistant-message:0' },
        reused: false,
      })),
    }),
  };
});
vi.mock('@/lib/asset-core/task-projector', () => ({
  projectCompletedTaskToAssets: mocks.projectCompletedTaskToAssets,
  recordTaskProjectionCompleted: mocks.recordTaskProjectionCompleted,
}));
vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {},
  Config: class {},
  HeaderUtils: { extractForwardHeaders: vi.fn() },
}));

import { POST as canvasChatPost } from '@/app/api/chat/route';
import { POST as standaloneChatPost } from '@/app/api/simple-chat/chat/route';

const canvasChatProvider = {
  id: 'canvas-chat-provider',
  apiKey: 'canvas-chat-key',
  baseUrl: 'https://canvas-chat.example/v1',
  advancedParams: {},
};
const standaloneChatProvider = {
  id: 'standalone-chat-provider',
  apiKey: 'standalone-chat-key',
  baseUrl: 'https://standalone-chat.example/v1',
  advancedParams: {},
};

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function canvasToolCallResponse(): Response {
  return jsonResponse({
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'canvas-tool-call',
          type: 'function',
          function: {
            name: 'generate_image',
            arguments: JSON.stringify({ prompt: 'Canvas exact prompt', aspect_ratio: '16:9' }),
          },
        }],
      },
    }],
  });
}

function canvasImg2ImgToolCallResponse(): Response {
  return jsonResponse({
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'canvas-img2img-tool-call',
          type: 'function',
          function: {
            name: 'img2img',
            arguments: JSON.stringify({
              prompt: 'Canvas exact variation',
              image_url: '/api/serve-upload/source.png',
              strength: 0.65,
            }),
          },
        }],
      },
    }],
  });
}

function standaloneToolCallResponse(): Response {
  const event = JSON.stringify({
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id: 'standalone-tool-call',
          function: {
            name: 'generate_image',
            arguments: JSON.stringify({ prompt: 'Standalone exact prompt', size: '1024x1024' }),
          },
        }],
      },
    }],
  });
  return new Response(`data: ${event}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function canvasRequest(): NextRequest {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'Exact.Canvas.Chat',
      providerId: canvasChatProvider.id,
      messages: [{ role: 'user', content: 'Generate from canvas' }],
      stream: false,
      enableTools: true,
      isAgentMode: true,
      imageModel: 'Exact.Canvas.Image',
      imageProviderId: 'canvas-image-provider',
      projectId: 'canvas-project',
      sessionId: 'canvas-session',
      messageId: 'canvas-message',
    }),
  });
}

function canvasImg2ImgRequest(): NextRequest {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'Exact.Canvas.Chat',
      providerId: canvasChatProvider.id,
      messages: [{ role: 'user', content: 'Vary the selected canvas image' }],
      stream: false,
      enableTools: true,
      isAgentMode: true,
      imageModel: 'Exact.Canvas.Image',
      imageProviderId: 'canvas-image-provider',
      projectId: 'canvas-project',
      sessionId: 'canvas-session',
      messageId: 'canvas-message',
      sourceVersionIds: ['canvas-source-version'],
      selectedEntityIds: ['canvas-source-entity'],
    }),
  });
}

function standaloneRequest(overrides: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Generate from standalone chat' }],
      model: 'Exact.Standalone.Chat',
      providerId: standaloneChatProvider.id,
      imageModel: 'Exact.Standalone.Image',
      imageProviderId: 'standalone-image-provider',
      projectId: 'standalone-project',
      taskId: 'standalone-task',
      responseMessageId: 'standalone-message',
      assetProjectId: 'asset-project',
      ...overrides,
    }),
  });
}

async function runCanvas(mode: 'legacy' | 'shadow' | 'agent-v2'): Promise<CapturedGenerateRequest> {
  process.env.WUJIE_AGENT_RUNTIME_MODE = mode;
  mocks.generateRequests.length = 0;
  mocks.fetchWithV1Retry
    .mockReset()
    .mockResolvedValueOnce(canvasToolCallResponse())
    .mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'Canvas complete' } }],
    }));

  const response = await canvasChatPost(canvasRequest());
  expect(response.status).toBe(200);
  await response.json();
  expect(mocks.generateRequests).toHaveLength(1);
  return mocks.generateRequests[0];
}

async function runCanvasImg2Img(mode: 'legacy' | 'shadow' | 'agent-v2'): Promise<CapturedGenerateRequest> {
  process.env.WUJIE_AGENT_RUNTIME_MODE = mode;
  mocks.generateRequests.length = 0;
  mocks.fetchWithV1Retry
    .mockReset()
    .mockResolvedValueOnce(canvasImg2ImgToolCallResponse())
    .mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'Canvas variation complete' } }],
    }));

  const response = await canvasChatPost(canvasImg2ImgRequest());
  expect(response.status).toBe(200);
  await response.json();
  expect(mocks.generateRequests).toHaveLength(1);
  return mocks.generateRequests[0];
}

async function runStandalone(mode: 'legacy' | 'shadow' | 'agent-v2'): Promise<CapturedGenerateRequest> {
  process.env.WUJIE_AGENT_RUNTIME_MODE = mode;
  mocks.generateRequests.length = 0;
  mocks.fetchWithTimeout.mockReset().mockResolvedValueOnce(standaloneToolCallResponse());

  const response = await standaloneChatPost(standaloneRequest());
  expect(response.status).toBe(200);
  const events = await response.text();
  expect(events).toContain('/api/serve-upload/generated.png');
  expect(mocks.generateRequests).toHaveLength(1);
  return mocks.generateRequests[0];
}

describe('chat-originated Agent generation routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateRequests.length = 0;
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1', name: 'User', role: 'user', status: 'active',
      productType: 'canvas,chat', apiPermissions: { chat: true },
      createdAt: 1, updatedAt: 1,
    });
    mocks.consumeCredits.mockResolvedValue({ success: true, cost: 1 });
    mocks.getInternalRequestHeaders.mockResolvedValue({
      'x-internal-request': 'true',
      'x-internal-user-id': 'user-1',
      'x-wujie-internal-secret': 'test-secret',
    });
    mocks.getApiProviders.mockResolvedValue([canvasChatProvider]);
    mocks.findProviderById.mockImplementation(async (providerId: string) => (
      providerId === standaloneChatProvider.id ? standaloneChatProvider : canvasChatProvider
    ));
    mocks.findProviderForModel.mockResolvedValue(standaloneChatProvider);
    mocks.resolveTaskModel.mockResolvedValue({ kind: 'chat' });
    mocks.prepareAdmittedAgentTaskExecution.mockResolvedValue({
      runId: undefined,
      execute: vi.fn().mockResolvedValue(undefined),
    });
    mocks.authorizeAgentContext.mockResolvedValue({
      mediaByVersionId: { 'canvas-source-version': '/api/serve-upload/source.png' },
      selectedEntityVersionIds: { 'canvas-source-entity': 'canvas-source-version' },
    });
    mocks.projectCompletedTaskToAssets.mockResolvedValue({
      versions: [{
        id: 'version-generated',
        assetId: 'asset-generated',
        file: { url: '/api/serve-upload/generated.png' },
      }],
      placements: [{ id: 'placement-generated', entityId: 'assistant-message:0' }],
      reused: false,
    });
    mocks.recordTaskProjectionCompleted.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (!url.endsWith('/api/generate')) throw new Error(`Unexpected fetch URL: ${url}`);
      mocks.generateRequests.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return jsonResponse({
        success: true,
        imageUrls: ['/api/serve-upload/generated.png'],
        directImageUrls: ['/api/serve-upload/generated.png'],
      });
    }));
  });

  afterEach(() => {
    delete process.env.WUJIE_AGENT_RUNTIME_MODE;
    vi.unstubAllGlobals();
  });

  it('sends strict exact routing through the real Canvas Agent-v2 generation path', async () => {
    const submitted = await runCanvas('agent-v2');

    expect(submitted.headers.get('x-wujie-agent-strict-routing')).toBe('true');
    expect(submitted.headers.get('x-wujie-agent-defer-execution')).toBe('true');
    expect(submitted.headers.get('idempotency-key'))
      .toBe('chat-agent:canvas-message:1:0:generate_image');
    expect(submitted.body).toMatchObject({
      prompt: 'Canvas exact prompt',
      model: 'Exact.Canvas.Image',
      providerId: 'canvas-image-provider',
      submitOnly: true,
    });
  });

  it('sends strict exact routing through the real Canvas Agent-v2 img2img path', async () => {
    const submitted = await runCanvasImg2Img('agent-v2');

    expect(submitted.headers.get('x-wujie-agent-strict-routing')).toBe('true');
    expect(submitted.headers.get('x-wujie-agent-defer-execution')).toBe('true');
    expect(submitted.headers.get('idempotency-key'))
      .toBe('chat-agent:canvas-message:1:0:img2img');
    expect(submitted.body).toMatchObject({
      prompt: expect.stringContaining('Canvas exact variation'),
      model: 'Exact.Canvas.Image',
      providerId: 'canvas-image-provider',
      referenceImages: ['http://localhost:5000/api/serve-upload/source.png'],
      submitOnly: true,
    });
  });

  it('sends strict exact routing through the real standalone Agent-v2 generation path', async () => {
    const submitted = await runStandalone('agent-v2');

    expect(submitted.headers.get('x-wujie-agent-strict-routing')).toBe('true');
    expect(submitted.headers.get('x-wujie-agent-defer-execution')).toBe('true');
    expect(submitted.headers.get('idempotency-key'))
      .toBe('simple-chat:standalone-task:standalone-message:generate');
    expect(submitted.body).toMatchObject({
      prompt: 'Standalone exact prompt',
      model: 'Exact.Standalone.Image',
      providerId: 'standalone-image-provider',
      submitOnly: true,
    });
  });

  it('reuses the authoritative poll projection instead of projecting the same task twice', async () => {
    process.env.WUJIE_AGENT_RUNTIME_MODE = 'agent-v2';
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
      queueMicrotask(callback);
      return 0;
    }) as typeof setTimeout);
    mocks.fetchWithTimeout.mockReset().mockResolvedValueOnce(standaloneToolCallResponse());
    mocks.prepareAdmittedAgentTaskExecution.mockImplementationOnce(async (input: {
      execute: () => Promise<void>;
    }) => ({ runId: 'durable-task-1', execute: input.execute }));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/generate')) {
        mocks.generateRequests.push({
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return jsonResponse({ success: true, taskIds: ['durable-task-1'] });
      }
      if (url.endsWith('/api/poll-task')) {
        return jsonResponse({
          success: true,
          status: 'completed',
          imageUrl: '/api/serve-upload/generated.png',
          assetProjection: {
            status: 'completed',
            references: [{
              assetId: 'asset-generated',
              assetVersionId: 'version-generated',
              placementId: 'placement-generated',
              entityId: 'standalone-message:0',
              url: '/api/serve-upload/generated.png',
            }],
          },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const response = await standaloneChatPost(standaloneRequest());
    const events = await response.text();

    expect(mocks.projectCompletedTaskToAssets).not.toHaveBeenCalled();
    expect(events).toContain('"assetVersionId":"version-generated"');
    expect(events).toContain('"placementId":"placement-generated"');
    timeoutSpy.mockRestore();
  });

  it('preserves authorized source versions in the durable generation submission', async () => {
    process.env.WUJIE_AGENT_RUNTIME_MODE = 'agent-v2';
    mocks.fetchWithTimeout.mockReset().mockResolvedValueOnce(standaloneToolCallResponse());

    const response = await standaloneChatPost(standaloneRequest({
      messages: [{
        role: 'user',
        content: 'Generate from this image',
        images: ['/api/serve-upload/source.png'],
      }],
      sourceVersionIds: ['canvas-source-version'],
      selectedEntityIds: ['canvas-source-entity'],
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.generateRequests).toHaveLength(1);
    expect(mocks.generateRequests[0].body).toMatchObject({
      assetParentVersionIds: ['canvas-source-version'],
      assetWorkspace: 'chat',
      assetWorkspaceId: 'standalone-chat:standalone-project',
      assetSourceEntityId: 'standalone-message',
    });
  });

  it.each(['legacy', 'shadow'] as const)(
    'does not broaden Canvas %s generation into strict/deferred execution',
    async mode => {
      const submitted = await runCanvas(mode);
      expect(submitted.headers.get('x-wujie-agent-strict-routing')).toBeNull();
      expect(submitted.headers.get('x-wujie-agent-defer-execution')).toBeNull();
    },
  );

  it.each(['legacy', 'shadow'] as const)(
    'does not broaden Canvas %s img2img into strict/deferred execution',
    async mode => {
      const submitted = await runCanvasImg2Img(mode);
      expect(submitted.headers.get('x-wujie-agent-strict-routing')).toBeNull();
      expect(submitted.headers.get('x-wujie-agent-defer-execution')).toBeNull();
    },
  );

  it.each(['legacy', 'shadow'] as const)(
    'does not broaden standalone %s generation into strict/deferred execution',
    async mode => {
      const submitted = await runStandalone(mode);
      expect(submitted.headers.get('x-wujie-agent-strict-routing')).toBeNull();
      expect(submitted.headers.get('x-wujie-agent-defer-execution')).toBeNull();
    },
  );
});
