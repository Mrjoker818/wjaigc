import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  productType: 'canvas,video' as string,
  seconds: 6 as number | null,
  stored: [] as Array<{ format: string; ownerId: string }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => ({ authenticated: true, userId: 'user-a', userRole: 'user', user: { id: 'user-a', role: 'user', productType: mocks.productType } }),
}));
vi.mock('@/lib/drama/audio-upload', async original => ({
  ...await original<typeof import('@/lib/drama/audio-upload')>(),
  probeAudioSeconds: async () => mocks.seconds,
}));
vi.mock('@/lib/generated-audio-storage', () => ({
  persistGeneratedAudioResponse: async (_response: Response, format: string, ownerId: string) => {
    mocks.stored.push({ format, ownerId });
    return { audioUrl: `/api/serve-upload/generated-audio/tts_1_${format}`, format };
  },
}));

import { POST } from '@/app/api/drama/voice-sample/route';

const mp3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64]);

function post(file?: File) {
  const body = new FormData();
  if (file) body.append('file', file);
  return POST(new NextRequest('http://localhost/api/drama/voice-sample', { method: 'POST', body }));
}

beforeEach(() => { mocks.productType = 'canvas,video'; mocks.seconds = 6; mocks.stored = []; });

describe('POST /api/drama/voice-sample', () => {
  it('stores a 2–15 second MP3 or WAV for the user and returns its length', async () => {
    const response = await post(new File([mp3], '林夏.mp3', { type: 'audio/mpeg' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, audioUrl: '/api/serve-upload/generated-audio/tts_1_mp3', name: '林夏.mp3', durationSec: 6 });
    expect(mocks.stored).toEqual([{ format: 'mp3', ownerId: 'user-a' }]);
  });

  it('says how long the sample must be when it is too short or too long', async () => {
    mocks.seconds = 40;
    const long = await post(new File([mp3], 'long.mp3'));
    expect(long.status).toBe(400);
    expect((await long.json()).error).toContain('这段是 40.0 秒');
    mocks.seconds = 1;
    expect((await post(new File([mp3], 'short.mp3'))).status).toBe(400);
    mocks.seconds = null;
    expect((await (await post(new File([mp3], 'bad.mp3'))).json()).error).toMatch(/读不出来/);
    expect(mocks.stored).toEqual([]);
  });

  it('rejects other formats and users without the video platform', async () => {
    expect((await post(new File([new Uint8Array(16)], 'a.mp3'))).status).toBe(400);
    mocks.productType = 'canvas';
    expect((await post(new File([mp3], 'a.mp3'))).status).toBe(403);
  });
});
