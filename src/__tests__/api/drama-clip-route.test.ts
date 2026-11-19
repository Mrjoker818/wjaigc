import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  productType: 'canvas,video' as string,
  saved: [] as Array<{ name: string; dir: string; size: number }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => ({ authenticated: true, userId: 'user-a', userRole: 'user', user: { id: 'user-a', role: 'user', productType: mocks.productType } }),
}));
vi.mock('@/lib/server-data-root', () => ({
  saveImageFile: (buffer: Buffer, name: string, dir: string) => {
    mocks.saved.push({ name, dir, size: buffer.length });
    return `/api/serve-upload/${dir}/${name}`;
  },
}));

import { POST } from '@/app/api/drama/clip/route';

const mp4 = new Uint8Array([0, 0, 0, 0x18, ...[...'ftypisom'].map(c => c.charCodeAt(0)), 0, 0, 0, 0]);

function post(file?: File) {
  const body = new FormData();
  if (file) body.append('file', file);
  return POST(new NextRequest('http://localhost/api/drama/clip', { method: 'POST', body }));
}

beforeEach(() => { mocks.productType = 'canvas,video'; mocks.saved = []; });

describe('POST /api/drama/clip', () => {
  it('stores an MP4 where renders read shot videos', async () => {
    const response = await post(new File([mp4], '01_视频.mp4', { type: 'video/mp4' }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.videoUrl).toMatch(/^\/api\/serve-upload\/drama-clips\/clip_\d+_[a-f0-9]{8}\.mp4$/u);
    expect(mocks.saved).toEqual([expect.objectContaining({ dir: 'drama-clips', size: mp4.length })]);
  });

  it('checks the bytes, not the declared type', async () => {
    const response = await post(new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], 'x.mp4', { type: 'video/mp4' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('只能上传 MP4、WebM 或 MOV 视频');
    expect((await post(new File([mp4], 'x.png', { type: 'image/png' }))).status).toBe(400);
    expect(mocks.saved).toEqual([]);
  });

  it('needs a file and the video platform', async () => {
    expect((await post()).status).toBe(400);
    mocks.productType = 'chat';
    expect((await post(new File([mp4], 'a.mp4', { type: 'video/mp4' }))).status).toBe(403);
  });
});
