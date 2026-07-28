import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { refineLayerAssets } from '@/lib/layer-decomposition/post-process';
import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';

async function makeHaloLayer(role: EditableLayerAsset['role']): Promise<Buffer> {
  const width = 32;
  const height = 32;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 6; y < 26; y++) {
    for (let x = 6; x < 26; x++) {
      const offset = (y * width + x) * 4;
      const edge = x === 6 || x === 25 || y === 6 || y === 25;
      raw[offset] = edge ? 255 : role === 'shadow' ? 60 : 220;
      raw[offset + 1] = edge ? 255 : role === 'shadow' ? 60 : 30;
      raw[offset + 2] = edge ? 255 : role === 'shadow' ? 60 : 30;
      raw[offset + 3] = edge ? 120 : role === 'shadow' ? 80 : 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function asset(id: string, role: EditableLayerAsset['role']): EditableLayerAsset {
  return {
    id,
    name: id,
    role,
    imageUrl: `/layers/${id}.png`,
    width: 32,
    height: 32,
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    source: 'pear-psd',
  };
}

describe('layer edge post-processing', () => {
  it('reduces white edge contamination without deleting semi-transparent shadow', async () => {
    const subject = await makeHaloLayer('subject');
    const shadow = await makeHaloLayer('shadow');
    const buffers = new Map([
      ['subject', subject],
      ['shadow', shadow],
    ]);
    const persistLayer = vi.fn(async (_buffer: Buffer, filename: string) => `/refined/${filename}`);

    const result = await refineLayerAssets(
      [asset('subject', 'subject'), asset('shadow', 'shadow')],
      {
        loadLayer: async (layer) => buffers.get(layer.id)!,
        persistLayer,
      },
    );

    expect(result.metrics.edgeContamination).toBeLessThan(0.03);
    expect(result.metrics.alphaCoverage.shadow).toBeGreaterThan(0.01);
    expect(result.layers.find((layer) => layer.id === 'shadow')).toBeDefined();
  });
});
