import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { evaluateTransparentSubject } from '@/lib/layer-decomposition/transparency-gate';
import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';

function layer(id: string, role: EditableLayerAsset['role']): EditableLayerAsset {
  return {
    id,
    name: id,
    role,
    imageUrl: `/${id}.png`,
    width: 4,
    height: 4,
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    source: 'local-enhanced',
  };
}

async function png(alpha: number[]): Promise<Buffer> {
  const pixels = Buffer.alloc(4 * 4 * 4, 220);
  for (let index = 0; index < alpha.length; index += 1) {
    pixels[index * 4 + 3] = alpha[index];
  }
  return sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer();
}

describe('transparent subject quality gate', () => {
  it('rejects a full opaque original that is mislabeled as a transparent subject', async () => {
    const opaque = await png(Array(16).fill(255));

    const result = await evaluateTransparentSubject([layer('subject', 'subject')], {
      loadLayer: async () => opaque,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'LAYER_TRANSPARENT_SUBJECT_UNAVAILABLE',
    });
  });

  it('accepts a subject layer with both real foreground and alpha-zero background pixels', async () => {
    const transparent = await png([
      0, 0, 0, 0,
      0, 255, 255, 0,
      0, 255, 255, 0,
      0, 0, 0, 0,
    ]);

    const result = await evaluateTransparentSubject([layer('subject', 'subject')], {
      loadLayer: async () => transparent,
    });

    expect(result.ok).toBe(true);
    expect(result.transparentRatio).toBeGreaterThan(0);
    expect(result.foregroundRatio).toBeGreaterThan(0);
  });

  it('falls back to non-background editable layers when a provider does not semantically name its subject', async () => {
    const transparent = await png([
      0, 0, 0, 0,
      0, 255, 255, 0,
      0, 255, 255, 0,
      0, 0, 0, 0,
    ]);

    const result = await evaluateTransparentSubject([layer('provider-layer', 'unknown')], {
      loadLayer: async () => transparent,
    });

    expect(result.ok).toBe(true);
  });
});
