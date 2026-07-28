import sharp from 'sharp';

import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';
import { saveImageFile } from '@/lib/server-data-root';

const MAX_LAYER_PIXELS = 67_108_864;

export interface RefineLayerOptions {
  loadLayer: (layer: EditableLayerAsset) => Promise<Buffer>;
  persistLayer?: (
    buffer: Buffer,
    filename: string,
    layer: EditableLayerAsset,
  ) => string | Promise<string>;
}

export interface RefinedLayerResult {
  layers: EditableLayerAsset[];
  buffers: Map<string, Buffer>;
  metrics: {
    edgeContamination: number;
    alphaCoverage: Record<string, number>;
    removedFragments: number;
  };
}

function median(values: number[]): number {
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)] || 0;
}

function removeTinyAlphaComponents(
  raw: Buffer,
  width: number,
  height: number,
): number {
  const pixels = width * height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  const minimumSize = Math.max(16, Math.floor(pixels * 0.00002));
  let removed = 0;

  for (let seed = 0; seed < pixels; seed += 1) {
    if (visited[seed] || raw[seed * 4 + 3] < 16) continue;
    let head = 0;
    let tail = 1;
    queue[0] = seed;
    visited[seed] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor] || raw[neighbor * 4 + 3] < 16) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (tail >= minimumSize) continue;
    for (let index = 0; index < tail; index += 1) raw[queue[index] * 4 + 3] = 0;
    removed += tail;
  }
  return removed;
}

function decontaminateFringe(
  raw: Buffer,
  width: number,
  height: number,
): { fringe: number; contaminated: number } {
  const source = Buffer.from(raw);
  let fringe = 0;
  let contaminated = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = source[offset + 3];
      if (alpha === 0 || alpha >= 251) continue;
      fringe += 1;
      const red: number[] = [];
      const green: number[] = [];
      const blue: number[] = [];
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = (ny * width + nx) * 4;
          if (source[neighbor + 3] < 251) continue;
          red.push(source[neighbor]);
          green.push(source[neighbor + 1]);
          blue.push(source[neighbor + 2]);
        }
      }
      if (red.length < 3) continue;
      const target = [median(red), median(green), median(blue)];
      const whiteFringe = source[offset] > 235
        && source[offset + 1] > 235
        && source[offset + 2] > 235
        && Math.min(...target) < 220;
      raw[offset] = target[0];
      raw[offset + 1] = target[1];
      raw[offset + 2] = target[2];
      if (whiteFringe && raw[offset] > 235 && raw[offset + 1] > 235 && raw[offset + 2] > 235) {
        contaminated += 1;
      }
    }
  }
  return { fringe, contaminated };
}

export async function refineLayerAssets(
  layers: EditableLayerAsset[],
  options: RefineLayerOptions,
): Promise<RefinedLayerResult> {
  const refined: EditableLayerAsset[] = [];
  const buffers = new Map<string, Buffer>();
  const alphaCoverage: Record<string, number> = {};
  let totalFringe = 0;
  let contaminatedFringe = 0;
  let removedFragments = 0;

  for (const layer of layers) {
    const input = await options.loadLayer(layer);
    const decoded = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_LAYER_PIXELS,
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const width = decoded.info.width;
    const height = decoded.info.height;
    const raw = Buffer.from(decoded.data);
    if (width !== layer.width || height !== layer.height) {
      throw new Error(`Layer ${layer.id} dimensions do not match its metadata`);
    }

    if (layer.role !== 'shadow') {
      removedFragments += removeTinyAlphaComponents(raw, width, height);
      const fringe = decontaminateFringe(raw, width, height);
      totalFringe += fringe.fringe;
      contaminatedFringe += fringe.contaminated;
    }

    let visiblePixels = 0;
    for (let index = 3; index < raw.length; index += 4) {
      if (raw[index] > 0) visiblePixels += 1;
    }
    alphaCoverage[layer.id] = visiblePixels / (width * height);
    if (visiblePixels === 0) continue;

    const png = await sharp(raw, {
      raw: { width, height, channels: 4 },
      limitInputPixels: MAX_LAYER_PIXELS,
    }).png().toBuffer();
    const filename = `${layer.id.replace(/[^A-Za-z0-9_-]/g, '_')}_refined.png`;
    const imageUrl = await (options.persistLayer || ((buffer, name) => (
      saveImageFile(buffer, name, 'layer-decomposition')
    )))(png, filename, layer);
    refined.push({ ...layer, imageUrl });
    buffers.set(layer.id, png);
  }

  return {
    layers: refined,
    buffers,
    metrics: {
      edgeContamination: totalFringe === 0 ? 0 : contaminatedFringe / totalFringe,
      alphaCoverage,
      removedFragments,
    },
  };
}
