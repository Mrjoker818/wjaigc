import { createHash } from 'node:crypto';

import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveLayerSourceImage: vi.fn(),
  saveImageFile: vi.fn(),
}));

// @ts-expect-error Vitest supports virtual module mocks at runtime.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('@/lib/layer-decomposition/source-image', () => ({ resolveLayerSourceImage: mocks.resolveLayerSourceImage }));
vi.mock('@/lib/server-data-root', () => ({ saveImageFile: mocks.saveImageFile }));

async function png(width: number, height: number, transparentHalf: boolean): Promise<Buffer> {
  const channels = 4;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      data[offset] = 200;
      data[offset + 1] = 120;
      data[offset + 2] = 40;
      data[offset + 3] = transparentHalf && x < width / 2 ? 0 : 255;
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

function resolved(buffer: Buffer, width: number, height: number) {
  return { buffer, width, height, mimeType: 'image/png' };
}

const base = { resultUrl: 'https://provider.example.com/board.png', sourceHash: 'a'.repeat(64), modelId: 'gpt-image-2', providerId: 'p' };

describe('element board quality gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveImageFile.mockImplementation((_buffer: Buffer, filename: string) => `/api/serve-upload/element-boards/${filename}`);
  });

  it('measures real alpha=0 pixels', async () => {
    const { measureTransparentPixelRatio } = await import('@/lib/element-decomposition/board-result');
    expect(await measureTransparentPixelRatio(await png(300, 300, true))).toBeCloseTo(0.5, 2);
    expect(await measureTransparentPixelRatio(await png(300, 300, false))).toBe(0);
  });

  it('re-hosts a passing transparent board and reports the checks', async () => {
    const buffer = await png(512, 288, true);
    mocks.resolveLayerSourceImage.mockResolvedValue(resolved(buffer, 512, 288));
    const { finalizeElementBoardResult } = await import('@/lib/element-decomposition/board-result');

    const result = await finalizeElementBoardResult({ ...base, background: 'transparent' });
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    expect(result).toMatchObject({ imageUrl: `/api/serve-upload/element-boards/${sha256}.png`, width: 512, height: 288 });
    expect(result.report).toMatchObject({ sha256, sourceSha256: base.sourceHash, background: 'transparent' });
    expect(result.report.transparentPixelRatio).toBeGreaterThan(0.4);
    expect(mocks.saveImageFile).toHaveBeenCalledWith(buffer, `${sha256}.png`, 'element-boards');
  });

  it('rejects an opaque result when transparency was requested but accepts it on light gray', async () => {
    const buffer = await png(512, 512, false);
    mocks.resolveLayerSourceImage.mockResolvedValue(resolved(buffer, 512, 512));
    const { finalizeElementBoardResult } = await import('@/lib/element-decomposition/board-result');

    await expect(finalizeElementBoardResult({ ...base, background: 'transparent' }))
      .rejects.toMatchObject({ code: 'BOARD_TRANSPARENCY_MISSING' });
    await expect(finalizeElementBoardResult({ ...base, background: 'light-gray' }))
      .resolves.toMatchObject({ width: 512, height: 512 });
  });

  it('rejects unreadable, undersized and echoed results without saving them', async () => {
    const { finalizeElementBoardResult } = await import('@/lib/element-decomposition/board-result');

    mocks.resolveLayerSourceImage.mockRejectedValueOnce(new Error('HTTP 404'));
    await expect(finalizeElementBoardResult({ ...base, background: 'light-gray' }))
      .rejects.toMatchObject({ code: 'BOARD_RESULT_UNREADABLE' });

    const small = await png(128, 128, false);
    mocks.resolveLayerSourceImage.mockResolvedValueOnce(resolved(small, 128, 128));
    await expect(finalizeElementBoardResult({ ...base, background: 'light-gray' }))
      .rejects.toMatchObject({ code: 'BOARD_RESULT_TOO_SMALL' });

    const echoed = await png(512, 512, false);
    mocks.resolveLayerSourceImage.mockResolvedValueOnce(resolved(echoed, 512, 512));
    await expect(finalizeElementBoardResult({
      ...base,
      background: 'light-gray',
      sourceHash: createHash('sha256').update(echoed).digest('hex'),
    })).rejects.toMatchObject({ code: 'BOARD_RESULT_ECHOED_SOURCE' });

    expect(mocks.saveImageFile).not.toHaveBeenCalled();
  });
});
