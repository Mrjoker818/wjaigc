import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { evaluateAndCorrectReconstruction } from '@/lib/element-decomposition/reconstruction';
import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';

function layer(imageUrl: string): EditableLayerAsset {
  return {
    id: 'layer-1',
    name: 'subject/main',
    role: 'subject',
    imageUrl,
    width: 8,
    height: 8,
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    source: 'local-enhanced',
  };
}

async function rgba(mutator?: (pixels: Buffer) => void): Promise<Buffer> {
  const pixels = Buffer.alloc(8 * 8 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 220;
    pixels[offset + 1] = 40;
    pixels[offset + 2] = 30;
    pixels[offset + 3] = 255;
  }
  mutator?.(pixels);
  return sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
}

describe('evaluateAndCorrectReconstruction', () => {
  it('reports an exact native reconstruction without creating correction assets', async () => {
    const source = await rgba();
    const persistLayer = vi.fn();

    const report = await evaluateAndCorrectReconstruction({
      source,
      layers: [layer('/exact.png')],
      loadLayer: async () => source,
      persistLayer,
    });

    expect(report.native).toMatchObject({ rgbMae: 0, alphaMae: 0, mismatchedPixelRatio: 0 });
    expect(report.corrected).toEqual(report.native);
    expect(report.correctionApplied).toBe(false);
    expect(persistLayer).not.toHaveBeenCalled();
  });

  it('creates a sparse correction layer for a missing opaque source pixel', async () => {
    const source = await rgba();
    const missing = await rgba((pixels) => {
      pixels[3] = 0;
    });
    const persisted = new Map<string, Buffer>();

    const report = await evaluateAndCorrectReconstruction({
      source,
      layers: [layer('/missing.png')],
      loadLayer: async () => missing,
      persistLayer: async (buffer, filename) => {
        persisted.set(filename, buffer);
        return `/layers/${filename}`;
      },
    });

    expect(report.native.rgbMae).toBeGreaterThan(0);
    expect(report.native.mismatchedPixelRatio).toBeGreaterThan(0);
    expect(report.correctionApplied).toBe(true);
    expect(report.correctionLayer).toMatchObject({
      name: 'reconstruction/correction',
      role: 'reconstruction-correction',
    });
    expect(report.corrected.rgbMae).toBe(0);
    expect(persisted.size).toBe(1);
  });

  it('keeps native metrics and creates a pixel-perfect reference for transparent-source mismatches', async () => {
    const source = await rgba((pixels) => {
      pixels[3] = 0;
    });
    const opaque = await rgba();

    const report = await evaluateAndCorrectReconstruction({
      source,
      layers: [layer('/opaque.png')],
      loadLayer: async () => opaque,
      persistLayer: async (_buffer, filename) => `/layers/${filename}`,
    });

    expect(report.native.alphaMae).toBeGreaterThan(0);
    expect(report.correctionApplied).toBe(true);
    expect(report.correctionLayer).toBeUndefined();
    expect(report.pixelPerfectReferenceLayer).toMatchObject({
      name: 'reconstruction/pixel-perfect-reference',
      role: 'reconstruction-reference',
    });
    expect(report.corrected.alphaMae).toBe(0);
    expect(report.native.alphaMae).toBeGreaterThan(report.corrected.alphaMae);
  });
});
