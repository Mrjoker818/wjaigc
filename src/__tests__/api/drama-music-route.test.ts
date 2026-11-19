import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  productType: 'canvas,video' as string,
  stored: [] as Array<{ format: string; ownerId: string; type: string | null; size: number }>,
  fail: null as Error | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => ({ authenticated: true, userId: 'user-a', userRole: 'user', user: { id: 'user-a', role: 'user', productType: mocks.productType } }),
}));
vi.mock('@/lib/generated-audio-storage', () => ({
  persistGeneratedAudioResponse: async (response: Response, format: string, ownerId: string) => {
    if (mocks.fail) throw mocks.fail;
    const bytes = await response.arrayBuffer();
    mocks.stored.push({ format, ownerId, type: response.headers.get('content-type'), size: bytes.byteLength });
    return { audioUrl: `/api/serve-upload/generated-audio/tts_1_${format}`, format };
  },
}));

import { POST } from '@/app/api/drama/music/route';

const mp3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64]);
const wav = new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WAVE'].map(c => c.charCodeAt(0))));

function post(file?: File) {
  const body = new FormData();
  if (file) body.append('file', file);
  return POST(new NextRequest('http://localhost/api/drama/music', { method: 'POST', body }));
}

beforeEach(() => { mocks.productType = 'canvas,video'; mocks.stored = []; mocks.fail = null; });

describe('POST /api/drama/music', () => {
  it('stores MP3 and WAV by their content, not their name', async () => {
    const first = await post(new File([mp3], '雨夜.mp3', { type: 'audio/mpeg' }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ success: true, audioUrl: '/api/serve-upload/generated-audio/tts_1_mp3', name: '雨夜.mp3' });
    const second = await post(new File([wav], 'theme.mp3', { type: 'audio/mpeg' }));
    expect(second.status).toBe(200);
    expect(mocks.stored).toEqual([
      { format: 'mp3', ownerId: 'user-a', type: 'audio/mpeg', size: mp3.length },
      { format: 'wav', ownerId: 'user-a', type: 'audio/wav', size: wav.length },
    ]);
  });

  it('rejects a missing file, other formats and files the store cannot decode', async () => {
    expect((await post()).status).toBe(400);
    const png = await post(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])], 'a.mp3'));
    expect(png.status).toBe(400);
    expect((await png.json()).error).toBe('只能上传 MP3 或 WAV 音乐');
    mocks.fail = new TypeError('生成音频文件无效');
    const broken = await post(new File([mp3], 'broken.mp3'));
    expect(broken.status).toBe(400);
    expect((await broken.json()).error).toMatch(/读不出来/);
    expect(mocks.stored).toEqual([]);
  });

  it('requires the video platform', async () => {
    mocks.productType = 'chat';
    const response = await post(new File([mp3], 'a.mp3'));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('VIDEO_PLATFORM_FORBIDDEN');
  });
});
