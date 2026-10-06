import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
  createVersionWithPlacement: vi.fn(),
  projectCompletedTaskToAssets: vi.fn(),
  recordTaskProjectionCompleted: vi.fn(),
  getInternalApiUrl: vi.fn((path: string) => `http://127.0.0.1:5000${path}`),
  getInternalRequestHeaders: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/collaboration/task-result-publication', () => ({
  projectCanvasTaskResult: vi.fn(async () => null),
}));

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
      createVersionWithPlacement: mocks.createVersionWithPlacement,
    }),
  };
});

vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {},
  Config: class {},
  HeaderUtils: { extractForwardHeaders: vi.fn() },
}));

vi.mock('@/lib/asset-core/task-projector', () => ({
  projectCompletedTaskToAssets: mocks.projectCompletedTaskToAssets,
  recordTaskProjectionCompleted: mocks.recordTaskProjectionCompleted,
}));

import { POST } from '@/app/api/simple-chat/chat/route';

interface StreamImageEvent {
  type: 'image';
  imageUrl: string;
  imageRef?: unknown;
}

function imageToolRequest(): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Generate a lighthouse at night' }],
      model: 'chat-model',
      providerId: 'chat-provider',
      imageModel: 'requested-image-model',
      imageProviderId: 'requested-image-provider',
      projectId: 'chat-project',
      taskId: 'chat-task',
      responseMessageId: 'assistant-message',
      assetProjectId: 'canvas-project',
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

function readImageEvent(stream: string): StreamImageEvent {
  const event = stream
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)) as Record<string, unknown>)
    .find(candidate => candidate.type === 'image');
  expect(event).toBeDefined();
  return event as unknown as StreamImageEvent;
}

describe('simple chat generated image source trace', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getInternalApiUrl.mockImplementation((path: string) => `http://127.0.0.1:5000${path}`);
    mocks.getInternalRequestHeaders.mockResolvedValue({ Authorization: 'Bearer internal-test' });
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      productType: 'chat',
      apiPermissions: { chat: true },
    });
    mocks.findProviderForModel.mockResolvedValue({
      id: 'chat-provider',
      apiKey: 'chat-key',
      baseUrl: 'https://chat.example/v1',
      advancedParams: {},
    });
    mocks.createVersionWithPlacement.mockImplementation(async (input: {
      resolveFile: () => Promise<{ url: string }>;
      placement: { metadata?: Record<string, unknown> };
    }) => {
      const file = await input.resolveFile();
      return {
        asset: { id: 'asset-direct' },
        version: { id: 'version-direct', assetId: 'asset-direct', file },
        placement: { id: 'placement-direct', metadata: input.placement.metadata },
        reused: false,
      };
    });
    mocks.projectCompletedTaskToAssets.mockResolvedValue({
      versions: [{
        id: 'version-projected',
        assetId: 'asset-projected',
        file: { url: '/api/serve-upload/projected.png' },
      }],
      placements: [{ id: 'placement-projected', entityId: 'assistant-message:0' }],
      reused: false,
    });
    mocks.recordTaskProjectionCompleted.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('emits a direct SSE image reference with complete actual execution provenance', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url === 'https://chat.example/v1/chat/completions') return imageToolCallResponse();
      if (url === 'http://127.0.0.1:5000/api/generate') {
        return jsonResponse({
          success: true,
          directImageUrls: ['/api/serve-upload/direct.png'],
          model: 'actual-direct-model',
          providerId: 'actual-direct-provider',
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const response = await POST(imageToolRequest());
    const event = readImageEvent(await response.text());
    const sourceTrace = {
      source: 'simple-chat',
      chatProjectId: 'chat-project',
      chatTaskId: 'chat-task',
      messageId: 'assistant-message',
      modelId: 'actual-direct-model',
      providerId: 'actual-direct-provider',
      createdAt: expect.any(String),
    };

    expect(event.imageRef).toEqual({
      assetId: 'asset-direct',
      assetVersionId: 'version-direct',
      placementId: 'placement-direct',
      url: '/api/serve-upload/direct.png',
      name: 'A lighthouse at night',
      sourceTrace,
    });
    expect(typeof event.imageRef).toBe('object');
    expect(mocks.createVersionWithPlacement).toHaveBeenCalledWith(expect.objectContaining({
      placement: expect.objectContaining({
        metadata: expect.objectContaining({ sourceTrace }),
      }),
    }));
  });

  it('emits a projected SSE image reference with complete task provenance', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url === 'https://chat.example/v1/chat/completions') return imageToolCallResponse();
      if (url === 'http://127.0.0.1:5000/api/generate') {
        return jsonResponse({
          success: true,
          taskIds: ['generation-task-1'],
          model: 'actual-projected-model',
          providerId: 'actual-projected-provider',
        });
      }
      if (url === 'http://127.0.0.1:5000/api/poll-task') {
        return jsonResponse({
          status: 'completed',
          imageUrl: '/api/serve-upload/projected.png',
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const response = await POST(imageToolRequest());
    const streamPromise = response.text();
    await vi.runAllTimersAsync();
    const event = readImageEvent(await streamPromise);

    expect(event.imageRef).toEqual({
      assetId: 'asset-projected',
      assetVersionId: 'version-projected',
      placementId: 'placement-projected',
      entityId: 'assistant-message:0',
      url: '/api/serve-upload/projected.png',
      name: 'A lighthouse at night',
      sourceTrace: {
        source: 'simple-chat',
        chatProjectId: 'chat-project',
        chatTaskId: 'chat-task',
        messageId: 'assistant-message',
        modelId: 'actual-projected-model',
        providerId: 'actual-projected-provider',
        generationTaskIds: ['generation-task-1'],
        createdAt: expect.any(String),
      },
    });
    expect(mocks.projectCompletedTaskToAssets).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'generation-task-1',
      sourceEntityId: 'assistant-message',
    }));
  });

  it('projects a completed task again when its stored projection lacks a chat placement', async () => {
    vi.useFakeTimers();
    mocks.projectCompletedTaskToAssets.mockResolvedValueOnce({
      versions: [{
        id: 'version-without-placement',
        assetId: 'asset-projected',
        file: { url: '/api/serve-upload/projected.png' },
      }],
      placements: [{ id: 'placement-projected', entityId: 'assistant-message:0' }],
      reused: true,
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url === 'https://chat.example/v1/chat/completions') return imageToolCallResponse();
      if (url === 'http://127.0.0.1:5000/api/generate') {
        return jsonResponse({ success: true, taskIds: ['generation-task-1'] });
      }
      if (url === 'http://127.0.0.1:5000/api/poll-task') {
        return jsonResponse({
          status: 'completed',
          imageUrl: '/api/serve-upload/projected.png',
          assetProjection: { status: 'completed', versionIds: ['version-without-placement'] },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const response = await POST(imageToolRequest());
    const streamPromise = response.text();
    await vi.runAllTimersAsync();
    const event = readImageEvent(await streamPromise);

    expect(event.imageRef).toEqual(expect.objectContaining({
      assetId: 'asset-projected',
      assetVersionId: 'version-without-placement',
      placementId: 'placement-projected',
      entityId: 'assistant-message:0',
      url: '/api/serve-upload/projected.png',
    }));
  });
});
