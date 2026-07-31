import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { compositeMaskedEdit } from '@/lib/image-tools/masked-edit-composite';

async function rawRgba(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).ensureAlpha().raw().toBuffer();
}

describe('compositeMaskedEdit', () => {
  it('changes only white mask pixels and preserves every other RGBA byte', async () => {
    const sourcePixels = Buffer.from([
      10, 20, 30, 40, 50, 60, 70, 80,
      90, 100, 110, 120, 130, 140, 150, 160,
    ]);
    const editedPixels = Buffer.from([
      210, 220, 230, 240, 211, 221, 231, 241,
      212, 222, 232, 242, 213, 223, 233, 243,
    ]);
    const maskPixels = Buffer.from([0, 255, 0, 255]);

    const source = await sharp(sourcePixels, {
      raw: { width: 2, height: 2, channels: 4 },
    }).png().toBuffer();
    const edited = await sharp(editedPixels, {
      raw: { width: 2, height: 2, channels: 4 },
    }).png().toBuffer();
    const mask = await sharp(maskPixels, {
      raw: { width: 2, height: 2, channels: 1 },
    }).png().toBuffer();

    const result = await compositeMaskedEdit({ source, edited, mask });

    expect(await rawRgba(result)).toEqual(Buffer.from([
      10, 20, 30, 40, 211, 221, 231, 80,
      90, 100, 110, 120, 213, 223, 233, 160,
    ]));
    expect((await sharp(result).metadata()).format).toBe('png');
  });

  it('blends RGB by fractional mask coverage and preserves source alpha', async () => {
    const source = await sharp(Buffer.from([10, 30, 50, 77]), {
      raw: { width: 1, height: 1, channels: 4 },
    }).png().toBuffer();
    const edited = await sharp(Buffer.from([110, 130, 150, 255]), {
      raw: { width: 1, height: 1, channels: 4 },
    }).png().toBuffer();
    const mask = await sharp(Buffer.from([128]), {
      raw: { width: 1, height: 1, channels: 1 },
    }).png().toBuffer();

    const result = await compositeMaskedEdit({ source, edited, mask });

    expect(await rawRgba(result)).toEqual(Buffer.from([60, 80, 100, 77]));
  });

  it('rejects an edited image whose dimensions do not match the source', async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#11223344' },
    }).png().toBuffer();
    const edited = await sharp({
      create: { width: 1, height: 1, channels: 4, background: '#ffffffff' },
    }).png().toBuffer();
    const mask = await sharp(Buffer.from([255, 255, 255, 255]), {
      raw: { width: 2, height: 2, channels: 1 },
    }).png().toBuffer();

    await expect(compositeMaskedEdit({ source, edited, mask }))
      .rejects.toThrow('edited image dimensions must match source');
  });
});
