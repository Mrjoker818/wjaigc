import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findProviderForModel: vi.fn(),
}));

vi.mock('@/lib/server-api-config', () => ({
  findProviderForModel: mocks.findProviderForModel,
}));

vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn().mockResolvedValue({}),
}));

import { executeToolCall } from '@/lib/chat-tools';

describe('Agent analyze_image tool', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mocks.findProviderForModel.mockReset();
    mocks.findProviderForModel.mockResolvedValue({
      apiKey: 'test-key',
      baseUrl: 'https://provider.example/v1',
      selectedModels: ['vision-model'],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('does not duplicate /v1 when the selected provider base URL already includes it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'A red cube on a white background.' } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeToolCall('analyze_image', {
      image_url: '/api/serve-upload/uploads/source.png',
    }, {
      chatApiKey: '',
      chatBaseUrl: '',
      origin: 'https://wjaigc.coze.site',
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
