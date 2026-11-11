import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  requireAuth: vi.fn(), listUsers: vi.fn(), providers: vi.fn(),
  storageReady: vi.fn(), persist: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mock.requireAuth }));
vi.mock('@/lib/server-auth', () => ({ listManagedUsers: mock.listUsers }));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: mock.providers }));
vi.mock('@/lib/generated-audio-storage', () => ({
  isGeneratedAudioFormat: (format: string) => format === 'mp3' || format === 'wav',
  ensureGeneratedAudioStorage: mock.storageReady,
  persistGeneratedAudioResponse: mock.persist,
}));

import { POST } from '@/app/api/audio/generate/route';

const provider = {
  id: 'voice-provider',
  type: 'audio',
  isEnabled: true,
  baseUrl: 'https://tts.example.invalid/v1',
  apiKey: 'synthetic-value',
  name: '测试供应商',
  selectedModels: ['voice-tts-a'],
  discoveredModels: [{ id: 'voice-tts-b', name: 'Disabled model', providerId: 'voice-provider', type: 'audio' }],
};
const user = { id: 'synthetic-user', role: 'user', status: 'active', apiPermissions: { audio: true } };

function generate(fields: Record<string, unknown> = {}) {
  return POST(new NextRequest('http://localhost/api/audio/generate', {
    method: 'POST',
    body: JSON.stringify({ text: '合成语音测试', ...fields }),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mock.fetch);
  mock.requireAuth.mockResolvedValue({ source: 'cookie', userId: user.id, user });
  mock.providers.mockResolvedValue([provider]);
  mock.persist.mockResolvedValue({ filename: 'test.mp3', audioUrl: '/test.mp3', size: 100 });
  mock.fetch.mockImplementation(async () => new Response('fixture', { status: 200 }));
});
afterEach(() => vi.unstubAllGlobals());

describe('TTS provider admission and submission', () => {
  it.each([
    { providerId: 'unknown-provider', model: 'voice-tts-a' },
    { providerId: 'voice-provider', model: 'voice-tts-b' },
  ])('rejects an unavailable exact provider/model selection before submission', async (selection) => {
    expect((await generate(selection)).status).toBe(403);
    expect(mock.fetch).not.toHaveBeenCalled();
  });

  it('checks the current user when a workflow invokes the route internally', async () => {
    mock.requireAuth.mockResolvedValue({ source: 'internal', userId: user.id, user });
    mock.listUsers.mockResolvedValue([{ ...user, apiPermissions: { audio: false } }]);
    expect((await generate()).status).toBe(403);
    expect(mock.fetch).not.toHaveBeenCalled();
  });

  it('resolves the exact configured model and submits a single versioned POST', async () => {
    expect((await generate({ providerId: provider.id, model: 'voice-tts-a' })).status).toBe(200);
    expect(mock.fetch).toHaveBeenCalledExactlyOnceWith('https://tts.example.invalid/v1/audio/speech',
      expect.objectContaining({ method: 'POST', redirect: 'manual' }));
    const body = JSON.parse(mock.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('voice-tts-a');
    expect(mock.persist.mock.calls[0][2]).toBe(user.id);
  });

  it('stops after an ambiguous provider response and omits private error text', async () => {
    mock.fetch.mockRejectedValue(new Error('synthetic provider-only diagnostic marker'));
    const response = await generate();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, code: 'AUDIO_RESULT_UNCONFIRMED', retryable: false });
    expect(mock.fetch).toHaveBeenCalledOnce();
    expect(mock.persist).not.toHaveBeenCalled();
  });

  it('does not send a generation when the deployment storage is unavailable', async () => {
    mock.storageReady.mockRejectedValueOnce(new Error('synthetic database detail'));
    const response = await generate();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, code: 'AUDIO_STORAGE_UNAVAILABLE' });
    expect(mock.fetch).not.toHaveBeenCalled();
  });
});
