import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { evaluateLayerQuality } from '@/lib/layer-decomposition/quality-gate';
import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';

describe('layer reconstruction quality gate', () => {
  it('fails when recomposition differs materially from the source', async () => {
    const source = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#ef1f1f' },
    }).png().toBuffer();
    const wrong = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#ffffff' },
    }).png().toBuffer();
    const layer: EditableLayerAsset = {
      id: 'background',
      name: '背景',
      role: 'background',
      imageUrl: '/wrong.png',
      width: 8,
      height: 8,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      source: 'local-enhanced',
    };

    const quality = await evaluateLayerQuality(source, [layer], {
      loadLayer: async () => wrong,
    });
    expect(quality.status).toBe('fail');
    expect(quality.warnings).toContain('RECONSTRUCTION_ERROR_HIGH');
  });
});
