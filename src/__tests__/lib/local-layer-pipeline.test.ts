import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { runLocalLayerPipeline } from '@/lib/layer-decomposition/local-pipeline';

async function productScene(): Promise<Buffer> {
  const width = 64;
  const height = 48;
  const raw = Buffer.alloc(width * height * 4, 255);
  for (let y = 10; y < 37; y++) {
    for (let x = 20; x < 45; x++) {
      const offset = (y * width + x) * 4;
      raw[offset] = 210;
      raw[offset + 1] = 30;
      raw[offset + 2] = 45;
      raw[offset + 3] = 255;
    }
  }
  for (let y = 38; y < 42; y++) {
    for (let x = 18; x < 48; x++) {
      const offset = (y * width + x) * 4;
      raw[offset] = 110;
      raw[offset + 1] = 110;
      raw[offset + 2] = 110;
      raw[offset + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe('enhanced local layer pipeline', () => {
  it('creates bounded editable layers without a GPU', async () => {
    const persistLayer = vi.fn(async (_buffer: Buffer, filename: string) => `/local/${filename}`);
    const result = await runLocalLayerPipeline(await productScene(), {
      taskId: 'local-test',
      persistLayer,
    });

    expect(result.layers.length).toBeGreaterThanOrEqual(2);
    expect(result.layers.length).toBeLessThanOrEqual(12);
    expect(result.layers.every((layer) => layer.source === 'local-enhanced')).toBe(true);
    expect(result.layers.some((layer) => layer.role === 'background')).toBe(true);
    expect(result.layers.some((layer) => layer.role === 'subject')).toBe(true);
    expect(result.quality.status).not.toBe('fail');
  });
});
