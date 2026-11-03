import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerDataRoot } from '@/lib/server-data-root';

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
  let imagePath = '';

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
    if (imagePath) fs.rmSync(imagePath, { force: true });
  });

  it('does not duplicate /v1 when the selected provider base URL already includes it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'A red cube on a white background.' } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();
    const uploadDir = path.join(getServerDataRoot(), 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    imagePath = path.join(uploadDir, 'source.png');
    fs.writeFileSync(imagePath, image);

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
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });
});
