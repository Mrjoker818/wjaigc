import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { evaluateRemoveBgOutput } from '@/lib/image-tools/remove-bg-quality';

async function createSource(width = 4, height = 4): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 120, b: 210 },
    },
  }).png().toBuffer();
}

async function createRgba(
  alphas: number[],
  width = 4,
  height = 4,
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    pixels[offset] = 30;
    pixels[offset + 1] = 120;
    pixels[offset + 2] = 210;
    pixels[offset + 3] = alphas[index] ?? 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe('evaluateRemoveBgOutput', () => {
  it('accepts a same-size RGBA image with foreground and transparent background', async () => {
    const source = await createSource();
    const candidate = await createRgba([
      0, 0, 0, 0,
      0, 255, 255, 0,
      0, 255, 255, 0,
      0, 0, 0, 0,
    ]);

    const result = await evaluateRemoveBgOutput(source, candidate);

    expect(result.ok).toBe(true);
    expect(result.metrics.foregroundRatio).toBe(0.25);
    expect(result.metrics.transparentRatio).toBe(0.75);
  });

  it('rejects a white-flattened opaque result', async () => {
    const source = await createSource();
    const candidate = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    }).png().toBuffer();

    await expect(evaluateRemoveBgOutput(source, candidate)).resolves.toMatchObject({
      ok: false,
      code: 'NO_BACKGROUND_REMOVED',
    });
  });

  it('rejects a fully transparent result', async () => {
    const source = await createSource();
    const candidate = await createRgba(new Array(16).fill(0));

    await expect(evaluateRemoveBgOutput(source, candidate)).resolves.toMatchObject({
      ok: false,
      code: 'EMPTY_FOREGROUND',
    });
  });

  it('rejects output with dimensions different from the source', async () => {
    const source = await createSource();
    const candidate = await createRgba([0, 255, 0, 255], 2, 2);

    await expect(evaluateRemoveBgOutput(source, candidate)).resolves.toMatchObject({
      ok: false,
      code: 'DIMENSION_MISMATCH',
    });
  });
});
