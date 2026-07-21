import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkPromptSafety: vi.fn(),
  config: vi.fn(),
  logSafetyWarning: vi.fn(),
  extractForwardHeaders: vi.fn(),
  getApiProviders: vi.fn(),
  getRuntimeSettings: vi.fn(),
  getSessionUser: vi.fn(),
  stream: vi.fn(),
}));

vi.mock('@/lib/prompt-safety', () => ({
  checkPromptSafety: mocks.checkPromptSafety,
  logSafetyWarning: mocks.logSafetyWarning,
}));
vi.mock('@/lib/runtime-settings', () => ({
  getRuntimeSettings: mocks.getRuntimeSettings,
}));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: mocks.getApiProviders,
}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
}));
vi.mock('coze-coding-dev-sdk', () => ({
  Config: class {
    constructor(options: unknown) {
      mocks.config(options);
    }
  },
  HeaderUtils: {
    extractForwardHeaders: mocks.extractForwardHeaders,
  },
  LLMClient: class {
    stream(...args: unknown[]) {
      return mocks.stream(...args);
    }
  },
}));

import { POST } from '@/app/api/quick-create/compile/route';

const providerA = {
  id: 'provider-a',
  name: 'Provider A',
  baseUrl: 'https://provider-a.example/v1',
  apiKey: 'secret-provider-a',
  isEnabled: true,
  type: 'chat' as const,
  modelType: 'chat' as const,
  createdAt: 1,
  updatedAt: 1,
  sortOrder: 1,
  selectedModels: ['chat-a', 'shared-chat', 'gpt-4o-mini'],
  discoveredModels: [
    { id: 'chat-a', name: 'Chat A', providerId: 'provider-a', type: 'chat' as const },
    { id: 'shared-chat', name: 'Shared Chat A', providerId: 'provider-a', type: 'chat' as const },
    {
      id: 'gpt-4o-mini',
      name: 'Vision Chat',
      providerId: 'provider-a',
      type: 'chat' as const,
      capabilities: ['vision'],
    },
  ],
};

const providerB = {
  ...providerA,
  id: 'provider-b',
  name: 'Provider B',
  baseUrl: 'https://provider-b.example/v1',
  apiKey: 'secret-provider-b',
  sortOrder: 2,
  selectedModels: ['chat-b', 'shared-chat'],
  discoveredModels: [
    { id: 'chat-b', name: 'Chat B', providerId: 'provider-b', type: 'chat' as const },
    { id: 'shared-chat', name: 'Shared Chat B', providerId: 'provider-b', type: 'chat' as const },
  ],
};

const activeUser = {
  id: 'user-1',
  name: 'User',
  role: 'user' as const,
  status: 'active' as const,
  createdAt: 1,
  updatedAt: 1,
  chatModels: ['provider-a::chat-a'],
  apiPermissions: {
    image: true,
    chat: true,
    threeD: true,
    imageEdit: true,
    vectorize: true,
    vlm: true,
    layer: true,
    video: true,
    upscaler: true,
    removebg: true,
    audio: true,
  },
};

const compilePayload = {
  summary: '为产品创建高级静物主视觉',
  strategy: '使用居中构图与柔和侧光突出材质。',
  directions: [
    {
      title: '高级静物',
      description: '产品位于画面中央，背景简洁。',
      visualKeywords: ['studio lighting', 'premium'],
    },
  ],
  positivePrompt: 'premium product still life, studio lighting',
  negativePrompt: 'low quality, watermark',
  aspectRatio: '1:1',
  quality: 'high',
  outputCount: 1,
};

function request(overrides: Record<string, unknown> = {}, signal?: AbortSignal): NextRequest {
  return new NextRequest('http://localhost/api/quick-create/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: '创建一张高级产品主视觉',
      aspectRatio: '1:1',
      quality: 'high',
      outputCount: 1,
      referenceImages: [],
      ...overrides,
    }),
    signal,
  });
}

function successfulStream(payload: unknown = compilePayload): AsyncIterable<{ content: string }> {
  return (async function* streamChunks() {
    const serialized = JSON.stringify(payload);
    const midpoint = Math.floor(serialized.length / 2);
    yield { content: serialized.slice(0, midpoint) };
    yield { content: serialized.slice(midpoint) };
  })();
}

async function readSse(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split(/\r?\n\r?\n/)
    .map((block: string) => block
      .split(/\r?\n/)
      .filter((line: string) => line.startsWith('data:'))
      .map((line: string) => line.slice(5).trimStart())
      .join('\n'))
    .filter(Boolean)
    .map((data: string) => JSON.parse(data) as Record<string, unknown>);
}

function eventTypes(events: Array<Record<string, unknown>>): unknown[] {
  return events.map((event: Record<string, unknown>) => event.type);
}

describe('POST /api/quick-create/compile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(activeUser);
    mocks.getApiProviders.mockResolvedValue([providerA, providerB]);
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultChatModel: 'provider-b::chat-b',
      quickCreateChatModel: 'provider-a::chat-a',
      quickCreateAutoModelRouting: true,
    });
    mocks.checkPromptSafety.mockReturnValue({ safe: true, level: 'pass', reason: '' });
    mocks.extractForwardHeaders.mockReturnValue({ 'x-request-id': 'request-1' });
    mocks.stream.mockImplementation(() => successfulStream());
  });

  it('rejects unauthenticated requests before reading provider configuration', async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const events = await readSse(await POST(request()));

    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'UNAUTHORIZED',
    }));
    expect(mocks.getApiProviders).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('rejects disabled users and users without chat permission', async () => {
    mocks.getSessionUser.mockResolvedValue({ ...activeUser, status: 'disabled' });
    const disabledEvents = await readSse(await POST(request()));
    expect(disabledEvents).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'ACCOUNT_DISABLED',
    }));

    mocks.getSessionUser.mockResolvedValue({
      ...activeUser,
      status: 'active',
      apiPermissions: { ...activeUser.apiPermissions, chat: false },
    });
    const forbiddenEvents = await readSse(await POST(request()));
    expect(forbiddenEvents).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'CHAT_PERMISSION_DENIED',
    }));
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('rejects users without an explicitly assigned chat model', async () => {
    mocks.getSessionUser.mockResolvedValue({ ...activeUser, chatModels: [] });

    const response = await POST(request());
    const events = await readSse(response);

    expect(response.status).toBe(200);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'NO_AVAILABLE_MODEL',
    }));
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('supports legacy bare model assignments', async () => {
    mocks.getSessionUser.mockResolvedValue({ ...activeUser, chatModels: ['chat-a'] });

    const events = await readSse(await POST(request()));
    const resultEvent = events.find((event: Record<string, unknown>) => event.type === 'result');

    expect(resultEvent).toEqual(expect.objectContaining({
      type: 'result',
      result: expect.objectContaining({
        model: 'chat-a',
        providerId: 'provider-a',
        modelSource: 'quick-create-default',
      }),
    }));
  });

  it('prevents provider-bound assignments from authorizing the same model id on another provider', async () => {
    mocks.getSessionUser.mockResolvedValue({
      ...activeUser,
      chatModels: ['provider-a::shared-chat'],
    });
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultChatModel: 'provider-b::shared-chat',
      quickCreateChatModel: 'provider-b::shared-chat',
      quickCreateAutoModelRouting: false,
    });

    const events = await readSse(await POST(request({ chatModelOverride: 'provider-b::shared-chat' })));

    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'MODEL_NOT_AUTHORIZED',
    }));
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('uses deterministic automatic routing and reports the selected source', async () => {
    mocks.getSessionUser.mockResolvedValue({
      ...activeUser,
      chatModels: ['provider-a::chat-a', 'provider-b::chat-b'],
    });

    const events = await readSse(await POST(request({
      chatModelOverride: 'provider-b::chat-b',
      recentChatModel: 'provider-a::chat-a',
    })));
    const resultEvent = events.find((event: Record<string, unknown>) => event.type === 'result');

    expect(resultEvent).toEqual(expect.objectContaining({
      result: expect.objectContaining({
        model: 'chat-b',
        providerId: 'provider-b',
        providerName: 'Provider B',
        modelSource: 'task-override',
      }),
    }));
    expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'secret-provider-b',
      modelBaseUrl: 'https://provider-b.example/v1',
    }));
  });

  it('does not use global, recent, or first-available fallbacks when automatic routing is disabled', async () => {
    mocks.getSessionUser.mockResolvedValue({
      ...activeUser,
      chatModels: ['provider-a::chat-a', 'provider-b::chat-b'],
    });
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultChatModel: 'provider-b::chat-b',
      quickCreateChatModel: '',
      quickCreateAutoModelRouting: false,
    });

    const events = await readSse(await POST(request({ recentChatModel: 'provider-a::chat-a' })));

    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'NO_AVAILABLE_MODEL',
    }));
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('does not send reference images to a text-only chat model', async () => {
    const referenceImage = 'https://assets.example/reference.png';

    await readSse(await POST(request({ referenceImages: [referenceImage] })));

    const messages = mocks.stream.mock.calls[0]?.[0] as Array<{ content: unknown }>;
    expect(typeof messages[0]?.content).toBe('string');
    expect(JSON.stringify(messages)).not.toContain(referenceImage);
  });

  it('sends valid reference images only to a vision-capable model', async () => {
    const referenceImage = 'data:image/png;base64,aGVsbG8=';
    mocks.getSessionUser.mockResolvedValue({
      ...activeUser,
      chatModels: ['provider-a::gpt-4o-mini'],
    });
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultChatModel: 'provider-a::gpt-4o-mini',
      quickCreateChatModel: 'provider-a::gpt-4o-mini',
      quickCreateAutoModelRouting: true,
    });

    await readSse(await POST(request({ referenceImages: [referenceImage] })));

    const messages = mocks.stream.mock.calls[0]?.[0] as Array<{ content: unknown }>;
    expect(messages[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text' }),
      {
        type: 'image_url',
        image_url: { url: referenceImage, detail: 'high' },
      },
    ]));
  });

  it('streams status and delta events before the validated result and done event', async () => {
    const events = await readSse(await POST(request()));
    const types = eventTypes(events);

    expect(types[0]).toBe('status');
    expect(types).toContain('delta');
    expect(types.indexOf('result')).toBeGreaterThan(types.indexOf('delta'));
    expect(types.at(-2)).toBe('status');
    expect(types.at(-1)).toBe('done');
    expect(events.at(-2)).toEqual(expect.objectContaining({ type: 'status', phase: 'ready' }));
  });

  it('returns a validation error for invalid model JSON without emitting a result event', async () => {
    mocks.stream.mockImplementation(() => successfulStream('{invalid-json'));

    const events = await readSse(await POST(request()));

    expect(eventTypes(events)).not.toContain('result');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'COMPILE_FAILED',
      message: '模型未返回完整的 JSON 对象',
    }));
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('does not expose provider credentials, base URLs, or upstream error details in SSE output', async () => {
    mocks.stream.mockImplementation(() => {
      throw new Error('upstream https://provider-a.example/v1 rejected secret-provider-a');
    });

    const response = await POST(request());
    const text = await response.text();

    expect(text).not.toContain('secret-provider-a');
    expect(text).not.toContain('provider-a.example');
    expect(text).not.toContain('upstream');
    expect(text).toContain('快速创作编译失败，请稍后重试');
  });

  it('returns the safe cancellation error code when the request is aborted', async () => {
    const controller = new AbortController();
    mocks.stream.mockImplementation(() => (async function* abortingStream() {
      controller.abort();
      yield { content: JSON.stringify(compilePayload) };
    })());

    const events = await readSse(await POST(request({}, controller.signal)));

    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'REQUEST_CANCELLED',
    }));
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
