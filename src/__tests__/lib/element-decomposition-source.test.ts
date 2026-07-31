import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const { resolveLayerSourceImage } = vi.hoisted(() => ({
  resolveLayerSourceImage: vi.fn(),
}));

vi.mock('@/lib/layer-decomposition/source-image', () => ({
  resolveLayerSourceImage,
}));

import { freezeElementSource } from '@/lib/element-decomposition/source-snapshot';
import type { ElementDecomposeRequest } from '@/lib/element-decomposition/types';

function request(overrides: Partial<ElementDecomposeRequest> = {}): ElementDecomposeRequest {
  return {
    projectId: 'project-1',
    sourceImageId: 'canvas-image-1',
    imageUrl: 'https://cdn.example.com/source.png',
    outputMode: 'both',
    board: { aspectRatio: '1:1', background: 'light-gray' },
    layers: { engine: 'smart' },
    ...overrides,
  };
}

describe('freezeElementSource', () => {
  beforeEach(() => {
    resolveLayerSourceImage.mockReset();
  });

  it('produces the same hash for identical bytes resolved from different URLs', async () => {
    const buffer = await sharp({
      create: { width: 3, height: 2, channels: 4, background: '#336699' },
    }).png().toBuffer();
    resolveLayerSourceImage.mockResolvedValue({
      buffer,
      mimeType: 'image/png',
      width: 3,
      height: 2,
    });

    const first = await freezeElementSource(request());
    const second = await freezeElementSource(request({ imageUrl: '/api/serve-upload/source.png' }));

    expect(first.sha256).toBe(second.sha256);
    expect(first).toMatchObject({
      sourceImageId: 'canvas-image-1',
      canonicalUrl: 'https://cdn.example.com/source.png',
      width: 3,
      height: 2,
      mimeType: 'image/png',
    });
    expect(second.canonicalUrl).toBe('/api/serve-upload/source.png');
  });

  it('changes the hash when the resolved image bytes change', async () => {
    const firstBuffer = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#000000' },
    }).png().toBuffer();
    const secondBuffer = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#ffffff' },
    }).png().toBuffer();
    resolveLayerSourceImage
      .mockResolvedValueOnce({ buffer: firstBuffer, mimeType: 'image/png', width: 2, height: 2 })
      .mockResolvedValueOnce({ buffer: secondBuffer, mimeType: 'image/png', width: 2, height: 2 });

    const first = await freezeElementSource(request());
    const second = await freezeElementSource(request());

    expect(first.sha256).not.toBe(second.sha256);
  });

  it('rejects an empty source image id before resolving the image', async () => {
    await expect(freezeElementSource(request({ sourceImageId: '  ' })))
      .rejects.toThrow('sourceImageId');
    expect(resolveLayerSourceImage).not.toHaveBeenCalled();
  });
});
