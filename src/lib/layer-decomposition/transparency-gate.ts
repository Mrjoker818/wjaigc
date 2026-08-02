import sharp from 'sharp';

import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';

const MAX_PIXELS = 67_108_864;
const TRANSPARENT_ALPHA_MAX = 15;
const FOREGROUND_ALPHA_MIN = 240;
const MIN_TRANSPARENT_RATIO = 0.002;
const MIN_FOREGROUND_RATIO = 0.005;

export interface TransparentSubjectGateResult {
  ok: boolean;
  code?: 'LAYER_TRANSPARENT_SUBJECT_UNAVAILABLE';
  transparentRatio: number;
  foregroundRatio: number;
  checkedLayerIds: string[];
}

export interface TransparentSubjectGateOptions {
  loadLayer(layer: EditableLayerAsset): Promise<Buffer>;
}

function candidateLayers(layers: EditableLayerAsset[]): EditableLayerAsset[] {
  const visible = layers.filter((layer) => layer.visible && layer.role !== 'background');
  const subjects = visible.filter((layer) => layer.role === 'subject');
  return subjects.length > 0 ? subjects : visible.filter((layer) => (
    layer.role !== 'reconstruction-correction'
    && layer.role !== 'reconstruction-reference'
  ));
}

export async function evaluateTransparentSubject(
  layers: EditableLayerAsset[],
  options: TransparentSubjectGateOptions,
): Promise<TransparentSubjectGateResult> {
  const candidates = candidateLayers(layers);
  let transparentPixels = 0;
  let foregroundPixels = 0;
  let totalPixels = 0;

  for (const layer of candidates) {
    const decoded = await sharp(await options.loadLayer(layer), {
      failOn: 'error',
      limitInputPixels: MAX_PIXELS,
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    totalPixels += decoded.info.width * decoded.info.height;
    for (let offset = 3; offset < decoded.data.length; offset += 4) {
      const alpha = decoded.data[offset];
      if (alpha <= TRANSPARENT_ALPHA_MAX) transparentPixels += 1;
      if (alpha >= FOREGROUND_ALPHA_MIN) foregroundPixels += 1;
    }
  }

  const transparentRatio = totalPixels === 0 ? 0 : transparentPixels / totalPixels;
  const foregroundRatio = totalPixels === 0 ? 0 : foregroundPixels / totalPixels;
  const ok = (
    transparentPixels >= Math.max(1, Math.ceil(totalPixels * MIN_TRANSPARENT_RATIO))
    && foregroundPixels >= Math.max(1, Math.ceil(totalPixels * MIN_FOREGROUND_RATIO))
  );

  return {
    ok,
    ...(ok ? {} : { code: 'LAYER_TRANSPARENT_SUBJECT_UNAVAILABLE' as const }),
    transparentRatio,
    foregroundRatio,
    checkedLayerIds: candidates.map((layer) => layer.id),
  };
}
