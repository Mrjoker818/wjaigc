import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn().mockResolvedValue({
    'x-wujie-internal-user-id': 'user-1',
  }),
}));

import { CHAT_TOOLS, executeToolCall } from '@/lib/chat-tools';

describe('chat generate_image transparent output', () => {
  const capturedBodies: Record<string, unknown>[] = [];

  beforeEach(() => {
    capturedBodies.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ success: true, imageUrl: '/generated.png' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['gpt-image-2', 'gemini-3-pro-image-preview'])('omits unspecified quality for %s', async (model) => {
    await executeToolCall('generate_image', { prompt: 'test image' }, {
      chatApiKey: '', chatBaseUrl: '', origin: 'http://localhost:5000',
      userId: 'user-1', imageModel: model, imageProviderId: 'provider-1',
      deferAgentExecution: true,
    });
    expect(capturedBodies[0]).not.toHaveProperty('quality');
  });

  it.each(['auto', 'low', 'medium', 'high'])('preserves explicit quality %s separately from resolution', async (quality) => {
    await executeToolCall('generate_image', { prompt: 'test image', quality, resolution: '2K' }, {
      chatApiKey: '', chatBaseUrl: '', origin: 'http://localhost:5000',
      userId: 'user-1', imageModel: 'gpt-image-2', imageProviderId: 'provider-1',
    });
    expect(capturedBodies[0]).toMatchObject({ quality, resolution: '2K' });
  });

  it('publishes the background parameter in the Agent tool schema', () => {
    const generateTool = CHAT_TOOLS.find((tool) => tool.function.name === 'generate_image');
    expect(generateTool?.function.parameters.properties.background).toMatchObject({
      type: 'string',
      enum: ['auto', 'transparent', 'opaque'],
    });
  });

  it('uses explicit transparent mode and forces PNG', async () => {
    await executeToolCall('generate_image', {
      prompt: 'isolated bottle',
      background: 'transparent',
    }, {
      chatApiKey: '',
      chatBaseUrl: '',
      origin: 'http://localhost:5000',
      userId: 'user-1',
      imageModel: 'gpt-image-2',
      imageProviderId: 'provider-1',
    });

    expect(capturedBodies[0]).toMatchObject({
      background: 'transparent',
      output_format: 'png',
    });
  });

  it('detects explicit transparent intent from natural language', async () => {
    await executeToolCall('generate_image', {
      prompt: '生成一个无背景的透明 PNG 图标',
    }, {
      chatApiKey: '',
      chatBaseUrl: '',
      origin: 'http://localhost:5000',
      userId: 'user-1',
      imageModel: 'gpt-image-2',
      imageProviderId: 'provider-1',
    });

    expect(capturedBodies[0]).toMatchObject({ background: 'transparent' });
  });

  it('keeps ordinary prompts in automatic mode', async () => {
    await executeToolCall('generate_image', { prompt: '生成一张山水海报' }, {
      chatApiKey: '',
      chatBaseUrl: '',
      origin: 'http://localhost:5000',
      userId: 'user-1',
      imageModel: 'gpt-image-2',
      imageProviderId: 'provider-1',
    });

    expect(capturedBodies[0]).not.toHaveProperty('background');
    expect(capturedBodies[0]).not.toHaveProperty('output_format');
  });
});
