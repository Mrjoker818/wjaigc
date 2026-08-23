import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { verifyGeneratedImageAlpha } from '@/lib/generated-image-alpha';

async function transparentPng(): Promise<Buffer> {
  return sharp(Buffer.from([
    255, 0, 0, 255,
    255, 0, 0, 0,
  ]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
}

describe('generated image alpha verification', () => {
  it('verifies a PNG with at least one transparent pixel', async () => {
    await expect(verifyGeneratedImageAlpha(await transparentPng())).resolves.toMatchObject({
      status: 'verified',
      format: 'png',
      hasTransparentPixels: true,
    });
  });

  it('rejects an RGBA PNG whose alpha channel is entirely opaque', async () => {
    const opaque = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    }).png().toBuffer();

    await expect(verifyGeneratedImageAlpha(opaque)).resolves.toMatchObject({
      status: 'opaque',
      hasTransparentPixels: false,
    });
  });

  it('does not mistake a raster checkerboard for transparency', async () => {
    const checkerboard = await sharp(Buffer.from([
      220, 220, 220, 255, 255, 255,
      255, 255, 255, 220, 220, 220,
    ]), { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();

    await expect(verifyGeneratedImageAlpha(checkerboard)).resolves.toMatchObject({
      status: 'opaque',
      hasTransparentPixels: false,
    });
  });

  it('marks malformed bytes as invalid', async () => {
    await expect(verifyGeneratedImageAlpha(Buffer.from('not-an-image'))).resolves.toMatchObject({
      status: 'invalid',
    });
  });
});
