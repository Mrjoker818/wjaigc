import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  extractForwardHeaders: vi.fn(),
  getApiProviders: vi.fn(),
  getBrandIpProject: vi.fn(),
  getRequestUser: vi.fn(),
  requireApiAuthOrReject: vi.fn(),
  stream: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  getRequestUser: mocks.getRequestUser,
  requireApiAuthOrReject: mocks.requireApiAuthOrReject,
}));
vi.mock('@/lib/brand-ip-storage', () => ({
  getBrandIpProject: mocks.getBrandIpProject,
}));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: mocks.getApiProviders,
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

import { POST } from '@/app/api/brand-ip/strategy/route';

const provider = {
  id: 'provider-a',
  name: 'Provider A',
  baseUrl: 'https://provider-a.example/v1',
  apiKey: 'secret-provider-a',
  isEnabled: true,
  type: 'chat' as const,
  modelType: 'chat' as const,
  createdAt: 1,
  updatedAt: 1,
  selectedModels: ['chat-a'],
  discoveredModels: [
    { id: 'chat-a', name: 'Chat A', providerId: 'provider-a', type: 'chat' as const },
  ],
};

const activeUser = {
  id: 'user-a',
  name: 'User A',
  role: 'user' as const,
  status: 'active' as const,
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
  createdAt: 1,
  updatedAt: 1,
};

const activeProject = {
  id: 'project-a',
  userId: 'user-a',
  name: '山野食品',
  brief: {
    brandName: '山野食品',
    objective: '打造亲和且可延展的品牌角色',
    audience: '城市年轻家庭',
    personality: ['自然', '温暖'],
  },
  directions: [],
  confirmedDirectionId: null,
  immutableCore: [],
  controlledVariables: [],
  currentStage: 'strategy' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const strategyPayload = {
  summary: '以自然陪伴感建立可长期运营的角色资产。',
  directions: [
    {
      id: 'direction-forest',
      name: '森林向导',
      concept: '以拟人化山野伙伴连接食材产地与家庭餐桌。',
      scores: { brandRole: 90, ownability: 82, feasibility: 88 },
    },
  ],
  immutableCore: [
    { id: 'core-tone', label: '情绪基调', value: '自然、温暖、可信赖' },
  ],
  controlledVariables: [
    { id: 'variable-season', label: '季节服饰', value: '随营销季节变化', risk: 'low' },
  ],
};

function request(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/brand-ip/strategy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'project-a', ...body }),
  });
}

function successfulStream(payload: unknown = strategyPayload): AsyncIterable<{ content: string }> {
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

describe('POST /api/brand-ip/strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-a',
      userRole: 'user',
    });
    mocks.getRequestUser.mockResolvedValue({ user: activeUser, source: 'cookie' });
    mocks.getBrandIpProject.mockResolvedValue(activeProject);
    mocks.getApiProviders.mockResolvedValue([provider]);
    mocks.extractForwardHeaders.mockReturnValue({ 'x-request-id': 'request-1' });
    mocks.stream.mockImplementation(() => successfulStream());
  });

  it('rejects an unauthenticated request before reading a project or provider configuration', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(new Response(null, { status: 401 }));

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.getBrandIpProject).not.toHaveBeenCalled();
    expect(mocks.getApiProviders).not.toHaveBeenCalled();
  });

  it('does not disclose a project that does not belong to the authenticated user', async () => {
    mocks.getBrandIpProject.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.getBrandIpProject).toHaveBeenCalledWith('project-a', 'user-a');
    expect(mocks.getApiProviders).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('returns a real SSE error when no server-authorized chat model is available', async () => {
    mocks.getApiProviders.mockResolvedValue([]);

    const response = await POST(request());
    const events = await readSse(response);

    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'NO_AVAILABLE_MODEL',
    }));
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('streams model text, validates the strategy result, and ends with done', async () => {
    const response = await POST(request());
    const events = await readSse(response);
    const eventTypes = events.map((event: Record<string, unknown>) => event.type);
    const result = events.find((event: Record<string, unknown>) => event.type === 'result');

    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(eventTypes[0]).toBe('status');
    expect(eventTypes).toContain('delta');
    expect(eventTypes.indexOf('result')).toBeGreaterThan(eventTypes.indexOf('delta'));
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(result).toEqual(expect.objectContaining({
      result: expect.objectContaining({
        directions: [expect.objectContaining({
          id: 'direction-forest',
          status: 'draft',
        })],
        model: 'chat-a',
        providerId: 'provider-a',
      }),
    }));
    expect(mocks.config).toHaveBeenCalledWith({
      apiKey: 'secret-provider-a',
      modelBaseUrl: 'https://provider-a.example/v1',
    });
  });

  it('does not expose provider credentials or upstream details when model streaming fails', async () => {
    mocks.stream.mockImplementation(() => {
      throw new Error('upstream https://provider-a.example/v1 rejected secret-provider-a');
    });

    const response = await POST(request());
    const text = await response.text();

    expect(text).not.toContain('secret-provider-a');
    expect(text).not.toContain('provider-a.example');
    expect(text).not.toContain('upstream');
    expect(text).toContain('品牌策略分析失败，请稍后重试');
  });
});
