import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saved: [] as Array<{ buffer: Buffer; filename: string; subDir: string }>,
}));

vi.mock('@/lib/server-data-root', () => ({
  saveImageFile: (buffer: Buffer, filename: string, subDir: string) => {
    mocks.saved.push({ buffer: Buffer.from(buffer), filename, subDir });
    return `/api/serve-upload/${subDir}/${filename}`;
  },
}));

import { postProcessLocalRemoveBG } from '@/lib/remove-bg-postprocess';

async function createFixture(): Promise<{ source: Buffer; rgba: Buffer; mask: Buffer }> {
  const width = 4;
  const height = 4;
  const rgbaRaw = Buffer.alloc(width * height * 4);
  const maskRaw = Buffer.alloc(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const foreground = index === 5 || index === 6 || index === 9 || index === 10;
    rgbaRaw[offset] = 40;
    rgbaRaw[offset + 1] = 130;
    rgbaRaw[offset + 2] = 220;
    rgbaRaw[offset + 3] = foreground ? 255 : 0;
    maskRaw[index] = foreground ? 255 : 0;
  }

  const rgba = await sharp(rgbaRaw, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
  const mask = await sharp(maskRaw, {
    raw: { width, height, channels: 1 },
  }).png().toBuffer();
  const source = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 130, b: 220 },
    },
  }).png().toBuffer();

  return { source, rgba, mask };
}

describe('postProcessLocalRemoveBG', () => {
  beforeEach(() => {
    mocks.saved.length = 0;
  });

  it('persists the transparent RGBA result without flattening it onto white', async () => {
    const { source, rgba, mask } = await createFixture();

    const result = await postProcessLocalRemoveBG(
      rgba.toString('base64'),
      mask.toString('base64'),
      source,
    );

    expect(result?.quality.ok).toBe(true);
    expect(mocks.saved).toHaveLength(2);
    const persistedSubject = mocks.saved[0].buffer;
    const metadata = await sharp(persistedSubject).metadata();
    const raw = await sharp(persistedSubject).ensureAlpha().raw().toBuffer();
    expect(metadata.hasAlpha).toBe(true);
    expect(raw[3]).toBe(0);
  });
});
