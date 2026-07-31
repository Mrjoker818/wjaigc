import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  fetchWithV1Retry: vi.fn(),
  resolveLayerSourceImage: vi.fn(),
}));

vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: mocks.fetchWithV1Retry }));
vi.mock('@/lib/layer-decomposition/source-image', () => ({
  resolveLayerSourceImage: mocks.resolveLayerSourceImage,
}));

const sourceBytes = Buffer.from('89504e470d0a1a0a', 'hex');

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    name: 'Provider',
    baseUrl: 'https://images.example.com/v1',
    apiKey: 'secret',
    isEnabled: true,
    type: 'image' as const,
    modelType: 'image' as const,
    selectedModels: ['image-model'],
    discoveredModels: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('element board direct provider protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveLayerSourceImage.mockResolvedValue({
      buffer: sourceBytes,
      mimeType: 'image/png',
      width: 1,
      height: 1,
    });
  });

  it('resolves managed source media and sends transportable image data without internal source hash', async () => {
    mocks.fetchWithV1Retry.mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: 'https://cdn.example.com/board.png' }],
    }), { status: 200 }));
    const { submitElementBoardProviderTask } = await import(
      '@/lib/element-decomposition/board-provider-client'
    );

    await submitElementBoardProviderTask({
      provider: provider({ compatProfile: 'apimart' }),
      modelId: 'image-model',
      sourceUrl: '/api/serve-upload/uploads/source.png',
      sourceHash: 'a'.repeat(64),
      aspectRatio: '16:9',
      background: 'transparent',
    });

    expect(mocks.resolveLayerSourceImage).toHaveBeenCalledWith(
      '/api/serve-upload/uploads/source.png',
      expect.any(Object),
    );
    const [, endpoint, request] = mocks.fetchWithV1Retry.mock.calls[0];
    expect(endpoint).toBe('/images/generations');
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(JSON.stringify(body)).toContain('data:image/png;base64,');
    expect(body).not.toHaveProperty('source_hash');
  });

  it('uses chat completions and includes the source image for Gemini image providers', async () => {
    mocks.fetchWithV1Retry.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: 'image', data: 'cmVzdWx0', mimeType: 'image/png' }] } }],
    }), { status: 200 }));
    const { submitElementBoardProviderTask } = await import(
      '@/lib/element-decomposition/board-provider-client'
    );

    const result = await submitElementBoardProviderTask({
      provider: provider({ compatProfile: 'gemini-image' }),
      modelId: 'gemini-2.5-flash-image-preview',
      sourceUrl: '/api/serve-upload/uploads/source.png',
      sourceHash: 'b'.repeat(64),
      aspectRatio: '1:1',
      background: 'light-gray',
    });

    const [, endpoint, request] = mocks.fetchWithV1Retry.mock.calls[0];
    expect(endpoint).toBe('/chat/completions');
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(JSON.stringify(body)).toContain('data:image/png;base64,');
    expect(result.directUrl).toBe('data:image/png;base64,cmVzdWx0');
  });

  it('uses multipart immediately for multipart-only edit providers', async () => {
    mocks.fetchWithV1Retry.mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: 'https://cdn.example.com/board.png' }],
    }), { status: 200 }));
    const { submitElementBoardProviderTask } = await import(
      '@/lib/element-decomposition/board-provider-client'
    );

    await submitElementBoardProviderTask({
      provider: provider({ compatProfile: 'openai' }),
      modelId: 'custom-edit-model',
      sourceUrl: '/api/serve-upload/uploads/source.png',
      sourceHash: 'c'.repeat(64),
      aspectRatio: '4:3',
      background: 'transparent',
    });

    expect(mocks.fetchWithV1Retry).toHaveBeenCalledTimes(1);
    const [, endpoint, request] = mocks.fetchWithV1Retry.mock.calls[0];
    expect(endpoint).toBe('/images/edits');
    expect(request.body).toBeInstanceOf(FormData);
    expect(new Headers(request.headers).has('Content-Type')).toBe(false);
    expect((request.body as FormData).get('image')).toBeInstanceOf(Blob);
  });
});
