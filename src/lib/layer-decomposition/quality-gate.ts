import sharp from 'sharp';

import { getVisibleLayersInPaintOrder } from '@/lib/layer-decomposition/layer-stack-order';
import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';

const MAX_PIXELS = 67_108_864;
const MAX_AGGREGATE_PIXELS = 256_000_000;

export interface LayerQualityEvaluation {
  status: 'pass' | 'warning' | 'fail';
  score: number;
  warnings: string[];
  metrics: {
    reconstructionMae: number;
    duplicateRatio: number;
    emptyRatio: number;
    outOfBoundsRatio: number;
    decodedPixels: number;
  };
}

export interface LayerQualityOptions {
  loadLayer: (layer: EditableLayerAsset) => Promise<Buffer>;
  edgeContamination?: number;
}

function alphaSignature(raw: Buffer): string {
  const buckets = new Uint32Array(32);
  const pixelCount = raw.length / 4;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (raw[pixel * 4 + 3] > 31) buckets[pixel % buckets.length] += 1;
  }
  return Array.from(buckets).join(':');
}

function blendChannel(source: number, destination: number, mode: string): number {
  if (mode === 'multiply') return Math.round((source * destination) / 255);
  if (mode === 'screen') return 255 - Math.round(((255 - source) * (255 - destination)) / 255);
  return source;
}

export async function evaluateLayerQuality(
  sourceBuffer: Buffer,
  layers: EditableLayerAsset[],
  options: LayerQualityOptions,
): Promise<LayerQualityEvaluation> {
  const source = await sharp(sourceBuffer, {
    failOn: 'error',
    limitInputPixels: MAX_PIXELS,
  }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = source.info.width;
  const height = source.info.height;
  const canvas = Buffer.alloc(width * height * 4);
  let decodedPixels = 0;
  let emptyCount = 0;
  let outOfBoundsCount = 0;
  let duplicateCount = 0;
  const signatures = new Set<string>();
  const warnings: string[] = [];

  for (const layer of getVisibleLayersInPaintOrder(layers)) {
    const decoded = await sharp(await options.loadLayer(layer), {
      failOn: 'error',
      limitInputPixels: MAX_PIXELS,
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const layerWidth = decoded.info.width;
    const layerHeight = decoded.info.height;
    decodedPixels += layerWidth * layerHeight;
    if (decodedPixels > MAX_AGGREGATE_PIXELS) {
      warnings.push('DECODED_PIXEL_BUDGET_EXCEEDED');
      break;
    }
    if (
      layer.offsetX < 0
      || layer.offsetY < 0
      || layer.offsetX + layerWidth > width
      || layer.offsetY + layerHeight > height
    ) outOfBoundsCount += 1;

    let visiblePixels = 0;
    for (let index = 3; index < decoded.data.length; index += 4) {
      if (decoded.data[index] > 0) visiblePixels += 1;
    }
    if (visiblePixels === 0) emptyCount += 1;
    const signature = alphaSignature(decoded.data);
    if (signatures.has(signature)) duplicateCount += 1;
    signatures.add(signature);

    for (let y = 0; y < layerHeight; y += 1) {
      const targetY = layer.offsetY + y;
      if (targetY < 0 || targetY >= height) continue;
      for (let x = 0; x < layerWidth; x += 1) {
        const targetX = layer.offsetX + x;
        if (targetX < 0 || targetX >= width) continue;
        const sourceOffset = (y * layerWidth + x) * 4;
        const targetOffset = (targetY * width + targetX) * 4;
        const sourceAlpha = (decoded.data[sourceOffset + 3] / 255) * layer.opacity;
        if (sourceAlpha <= 0) continue;
        const destinationAlpha = canvas[targetOffset + 3] / 255;
        const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
        for (let channel = 0; channel < 3; channel += 1) {
          const blended = blendChannel(
            decoded.data[sourceOffset + channel],
            canvas[targetOffset + channel],
            layer.blendMode,
          );
          canvas[targetOffset + channel] = outputAlpha === 0 ? 0 : Math.round((
            blended * sourceAlpha
            + canvas[targetOffset + channel] * destinationAlpha * (1 - sourceAlpha)
          ) / outputAlpha);
        }
        canvas[targetOffset + 3] = Math.round(outputAlpha * 255);
      }
    }
  }

  let absoluteError = 0;
  let comparedChannels = 0;
  for (let offset = 0; offset < source.data.length; offset += 4) {
    if (source.data[offset + 3] === 0) continue;
    absoluteError += Math.abs(source.data[offset] - canvas[offset]);
    absoluteError += Math.abs(source.data[offset + 1] - canvas[offset + 1]);
    absoluteError += Math.abs(source.data[offset + 2] - canvas[offset + 2]);
    comparedChannels += 3;
  }
  const reconstructionMae = comparedChannels === 0
    ? 1
    : absoluteError / (comparedChannels * 255);
  const denominator = Math.max(1, layers.length);
  const duplicateRatio = duplicateCount / denominator;
  const emptyRatio = emptyCount / denominator;
  const outOfBoundsRatio = outOfBoundsCount / denominator;
  const fatalLimitViolation = decodedPixels > MAX_AGGREGATE_PIXELS;

  if (reconstructionMae > 0.22) warnings.push('RECONSTRUCTION_ERROR_HIGH');
  if (duplicateRatio > 0.25) warnings.push('DUPLICATE_LAYER_RATIO_HIGH');
  if (emptyRatio > 0) warnings.push('EMPTY_LAYERS_PRESENT');
  if (outOfBoundsRatio > 0) warnings.push('OUT_OF_BOUNDS_LAYERS_PRESENT');
  if ((options.edgeContamination || 0) > 0.05) warnings.push('EDGE_CONTAMINATION_HIGH');

  let status: LayerQualityEvaluation['status'];
  if (fatalLimitViolation || layers.length === 0 || reconstructionMae > 0.22) status = 'fail';
  else if (reconstructionMae > 0.12 || (options.edgeContamination || 0) > 0.05 || warnings.length > 0) {
    status = 'warning';
  } else status = 'pass';

  return {
    status,
    score: Math.max(0, Math.round((1 - reconstructionMae) * 100)),
    warnings,
    metrics: {
      reconstructionMae,
      duplicateRatio,
      emptyRatio,
      outOfBoundsRatio,
      decodedPixels,
    },
  };
}
