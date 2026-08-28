import { describe, expect, it } from 'vitest';

import { editableLayerAssetsToDesignLayers } from '@/lib/editable-layer-adapter';
import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';
import { buildSceneFromEditableLayerAssets } from '@/lib/psd-export';

describe('editable layer adapter', () => {
  it('maps persisted layer geometry without forcing every layer to full canvas', () => {
    const asset: EditableLayerAsset = {
      id: 'pear-subject',
      parentId: 'group-product',
      name: '产品主体',
      role: 'subject',
      imageUrl: '/api/serve-upload/layer.png',
      width: 640,
      height: 480,
      offsetX: 120,
      offsetY: 75,
      opacity: 0.65,
      blendMode: 'multiply',
      visible: true,
      source: 'pear-psd',
      qualityWarnings: ['边缘需要复核'],
    };

    const [layer] = editableLayerAssetsToDesignLayers([asset], 1600, 900);

    expect(layer).toMatchObject({
      id: 'pear-subject',
      parentId: 'group-product',
      offsetX: 120,
      offsetY: 75,
      sourceWidth: 640,
      sourceHeight: 480,
      opacity: 0.65,
      blendMode: 'multiply',
      imageDataUrl: '/api/serve-upload/layer.png',
      source: 'pear-psd',
    });
    expect(layer.boundingBox).toEqual({ x: 120, y: 75, width: 640, height: 480 });
    expect(layer.bbox).toEqual([120, 75, 760, 555]);
    expect(layer.warnings).toContain('边缘需要复核');
  });

  it('clips invalid geometry to the document without changing the persisted asset', () => {
    const asset: EditableLayerAsset = {
      id: 'outside', name: '装饰', role: 'decoration', imageUrl: '/outside.png',
      width: 400, height: 300, offsetX: 900, offsetY: -20, opacity: 2,
      blendMode: '', visible: false, source: 'local-enhanced',
    };

    const [layer] = editableLayerAssetsToDesignLayers([asset], 1000, 800);

    expect(layer.boundingBox).toEqual({ x: 900, y: 0, width: 100, height: 280 });
    expect(layer.opacity).toBe(1);
    expect(layer.role).toBe('deco');
    expect(asset).toMatchObject({ offsetX: 900, offsetY: -20, width: 400, height: 300 });
  });

  it('builds PSD export groups from the same persisted layer contract', () => {
    const assets: EditableLayerAsset[] = [{
      id: 'subject', parentId: 'product', name: '主体', role: 'subject',
      imageUrl: '/subject.png', width: 40, height: 30, offsetX: 5, offsetY: 6,
      opacity: 1, blendMode: 'normal', visible: true, source: 'pear-psd',
    }];

    const scene = buildSceneFromEditableLayerAssets({
      width: 100,
      height: 80,
      layers: assets,
      psdUrl: '/result.psd',
      engine: 'pear',
      quality: { status: 'warning', score: 84, warnings: ['REVIEW_EDGE'] },
    });

    expect(scene.layers[0]).toMatchObject({ id: 'subject', offsetX: 5, offsetY: 6 });
    expect(scene.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'group-product', layerIds: ['subject'] }),
    ]));
    expect(scene.exportNotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'warning', message: 'REVIEW_EDGE' }),
    ]));
  });
});
