import { describe, expect, it } from 'vitest';

import { getVisibleLayersInPaintOrder } from '@/lib/layer-decomposition/layer-stack-order';
import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';

function layer(
  id: string,
  source: EditableLayerAsset['source'],
  role: EditableLayerAsset['role'] = 'subject',
  visible = true,
): EditableLayerAsset {
  return {
    id,
    name: id,
    role,
    imageUrl: `/${id}.png`,
    width: 8,
    height: 8,
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    blendMode: 'normal',
    visible,
    source,
  };
}

describe('getVisibleLayersInPaintOrder', () => {
  it('reverses Pear layers and paints local reconstruction assets last', () => {
    const ordered = getVisibleLayersInPaintOrder([
      layer('pear-top', 'pear-psd'),
      layer('pear-hidden', 'pear-psd', 'decoration', false),
      layer('pear-bottom', 'pear-psd', 'background'),
      layer('local-enhancement', 'local-enhanced', 'decoration'),
      layer('correction', 'local-enhanced', 'reconstruction-correction'),
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      'pear-bottom',
      'pear-top',
      'local-enhancement',
      'correction',
    ]);
  });

  it('preserves the existing order for a local-only layer stack', () => {
    const ordered = getVisibleLayersInPaintOrder([
      layer('background', 'local-enhanced', 'background'),
      layer('subject', 'local-enhanced'),
      layer('correction', 'local-enhanced', 'reconstruction-correction'),
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      'background',
      'subject',
      'correction',
    ]);
  });
});
