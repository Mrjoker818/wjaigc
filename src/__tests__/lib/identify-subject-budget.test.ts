import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithV1Retry: vi.fn(),
  getApiProviders: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForFeature: vi.fn(async () => null),
  getApiProviders: mocks.getApiProviders,
}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: mocks.fetchWithV1Retry }));
vi.mock('@/lib/safe-image-input', () => ({
  loadSafeImageInput: vi.fn(async () => ({ mimeType: 'image/png', buffer: Buffer.from('png') })),
  safeSharp: vi.fn(),
}));

import { identifyImageSubject, resetVisionModelHealth } from '@/lib/identify-subject';

const models = ['gpt-4o-a', 'gpt-4o-b', 'gpt-4o-c', 'gpt-4o-d', 'gpt-4o-e', 'gpt-4o-f'];
const triedModels = () => mocks.fetchWithV1Retry.mock.calls.map(call => JSON.parse(String(call[2].body)).model);
const answer = () => new Response(JSON.stringify({ choices: [{ message: { content: 'EN: a cat\nZH: 一只猫' } }] }));

describe('identifyImageSubject fallback budget', () => {
  beforeEach(() => {
    resetVisionModelHealth();
    mocks.fetchWithV1Retry.mockReset();
    mocks.getApiProviders.mockResolvedValue([{
      id: 'relay', baseUrl: 'https://relay.example/v1', apiKey: 'k', isEnabled: true, selectedModels: models,
    }]);
  });

  it('stops after four failing models', async () => {
    mocks.fetchWithV1Retry.mockResolvedValue(new Response('down', { status: 503 }));

    await expect(identifyImageSubject('/api/serve-upload/a.png')).resolves.toBeNull();
    expect(triedModels()).toEqual(['gpt-4o-a', 'gpt-4o-b', 'gpt-4o-c', 'gpt-4o-d']);
  });

  it('skips models that just failed and tries the last good model first', async () => {
    mocks.fetchWithV1Retry
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(answer());
    await expect(identifyImageSubject('/api/serve-upload/a.png')).resolves.toEqual({ en: 'a cat', zh: '一只猫' });

    mocks.fetchWithV1Retry.mockClear();
    mocks.fetchWithV1Retry.mockResolvedValue(answer());
    await identifyImageSubject('/api/serve-upload/a.png');
    expect(triedModels()).toEqual(['gpt-4o-b']);
  });
});
