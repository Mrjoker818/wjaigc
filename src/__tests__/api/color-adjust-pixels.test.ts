import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  fetchImageBuffer: vi.fn(),
  saveImageFile: vi.fn(),
  requireApiAuthOrReject: vi.fn(),
  savedBuffer: Buffer.alloc(0) as Buffer<ArrayBufferLike>,
}));

vi.mock('@/lib/fetch-image-buffer', () => ({ fetchImageBuffer: mocks.fetchImageBuffer }));
vi.mock('@/lib/server-data-root', () => ({
  saveImageFile: (buffer: Buffer) => {
    mocks.savedBuffer = buffer;
    return '/api/serve-upload/color-adjust/result.png';
  },
}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/api-validator', () => ({ validateApiInputs: () => null }));

import { POST } from '@/app/api/image/color-adjust/route';

async function rgbaFixture(): Promise<Buffer> {
  return sharp(Buffer.from([
    20, 40, 80, 0,
    80, 120, 160, 64,
    120, 90, 30, 128,
    180, 160, 140, 255,
  ]), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
}

async function call(params: Record<string, number>) {
  return POST(new NextRequest('http://localhost/api/image/color-adjust', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: '/source.png', params }),
  }));
}

describe('color adjustment pixels', () => {
  beforeEach(async () => {
    mocks.fetchImageBuffer.mockReset();
    mocks.requireApiAuthOrReject.mockReset();
    mocks.requireApiAuthOrReject.mockResolvedValue({ authenticated: true, userId: 'user-1' });
    mocks.fetchImageBuffer.mockResolvedValue(await rgbaFixture());
    mocks.savedBuffer = Buffer.alloc(0);
  });

  it('keeps neutral RGBA pixels byte-identical', async () => {
    const source = await rgbaFixture();
    const response = await call({});
    const sourceRaw = await sharp(source).ensureAlpha().raw().toBuffer();
    const outputRaw = await sharp(mocks.savedBuffer).ensureAlpha().raw().toBuffer();

    expect(response.status).toBe(200);
    expect(outputRaw).toEqual(sourceRaw);
  });

  it('preserves every alpha byte while applying color changes', async () => {
    const source = await rgbaFixture();
    const response = await call({ brightness: 40, saturation: -60, hue: 45 });
    const sourceRaw = await sharp(source).ensureAlpha().raw().toBuffer();
    const outputRaw = await sharp(mocks.savedBuffer).ensureAlpha().raw().toBuffer();

    expect(response.status).toBe(200);
    expect([3, 7, 11, 15].map((index) => outputRaw[index])).toEqual(
      [3, 7, 11, 15].map((index) => sourceRaw[index]),
    );
  });
});
