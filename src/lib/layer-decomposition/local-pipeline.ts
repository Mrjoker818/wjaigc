import sharp from 'sharp';

import { evaluateLayerQuality } from '@/lib/layer-decomposition/quality-gate';
import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';
import { saveImageFile } from '@/lib/server-data-root';

const MAX_PIXELS = 16_777_216;
const MAX_LOCAL_LAYERS = 12;

export interface LocalLayerPipelineOptions {
  taskId?: string;
  persistLayer?: (
    buffer: Buffer,
    filename: string,
    layer: EditableLayerAsset,
  ) => string | Promise<string>;
}

export interface LocalLayerPipelineResult {
  width: number;
  height: number;
  layers: EditableLayerAsset[];
  buffers: Map<string, Buffer>;
  quality: Awaited<ReturnType<typeof evaluateLayerQuality>>;
}

interface LabColor { l: number; a: number; b: number }

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(red: number, green: number, blue: number): LabColor {
  const r = srgbToLinear(red);
  const g = srgbToLinear(green);
  const b = srgbToLinear(blue);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const transform = (value: number) => value > 0.008856
    ? Math.cbrt(value)
    : 7.787 * value + 16 / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function deltaE(
  leftL: number,
  leftA: number,
  leftB: number,
  rightL: number,
  rightA: number,
  rightB: number,
): number {
  return Math.hypot(leftL - rightL, leftA - rightA, leftB - rightB);
}

function safeTaskName(taskId?: string): string {
  return (taskId || 'local').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

interface Component {
  pixels: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  luminance: number;
  saturation: number;
}

export async function runLocalLayerPipeline(
  sourceBuffer: Buffer,
  options: LocalLayerPipelineOptions = {},
): Promise<LocalLayerPipelineResult> {
  const decoded = await sharp(sourceBuffer, {
    failOn: 'error',
    limitInputPixels: MAX_PIXELS,
  }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = decoded.info.width;
  const height = decoded.info.height;
  const pixels = width * height;
  if (pixels <= 0 || pixels > MAX_PIXELS) throw new Error('Local layer source exceeds the pixel limit');
  const raw = decoded.data;

  const labL = new Float32Array(pixels);
  const labA = new Float32Array(pixels);
  const labB = new Float32Array(pixels);
  const luminance = new Float32Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const lab = rgbToLab(raw[offset], raw[offset + 1], raw[offset + 2]);
    labL[pixel] = lab.l;
    labA[pixel] = lab.a;
    labB[pixel] = lab.b;
    luminance[pixel] = 0.2126 * raw[offset] + 0.7152 * raw[offset + 1] + 0.0722 * raw[offset + 2];
  }

  const gradient = new Float32Array(pixels);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = -luminance[index - width - 1] + luminance[index - width + 1]
        - 2 * luminance[index - 1] + 2 * luminance[index + 1]
        - luminance[index + width - 1] + luminance[index + width + 1];
      const gy = -luminance[index - width - 1] - 2 * luminance[index - width] - luminance[index - width + 1]
        + luminance[index + width - 1] + 2 * luminance[index + width] + luminance[index + width + 1];
      gradient[index] = Math.hypot(gx, gy);
    }
  }

  const border = new Set<number>();
  for (let x = 0; x < width; x += 1) {
    border.add(x);
    border.add((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    border.add(y * width);
    border.add(y * width + width - 1);
  }
  let meanL = 0;
  let meanA = 0;
  let meanB = 0;
  let meanR = 0;
  let meanG = 0;
  let meanBlue = 0;
  for (const index of border) {
    meanL += labL[index];
    meanA += labA[index];
    meanB += labB[index];
    meanR += raw[index * 4];
    meanG += raw[index * 4 + 1];
    meanBlue += raw[index * 4 + 2];
  }
  meanL /= border.size;
  meanA /= border.size;
  meanB /= border.size;
  meanR = Math.round(meanR / border.size);
  meanG = Math.round(meanG / border.size);
  meanBlue = Math.round(meanBlue / border.size);

  const background = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  for (const index of border) {
    if (background[index]) continue;
    background[index] = 1;
    queue[tail++] = index;
  }
  while (head < tail) {
    const current = queue[head++];
    const x = current % width;
    const y = Math.floor(current / width);
    const neighbors = [
      x > 0 ? current - 1 : -1,
      x + 1 < width ? current + 1 : -1,
      y > 0 ? current - width : -1,
      y + 1 < height ? current + width : -1,
    ];
    for (const next of neighbors) {
      if (next < 0 || background[next]) continue;
      const distanceToMean = deltaE(labL[next], labA[next], labB[next], meanL, meanA, meanB);
      const distanceToNeighbor = deltaE(
        labL[next], labA[next], labB[next],
        labL[current], labA[current], labB[current],
      );
      if ((distanceToMean <= 24 || distanceToNeighbor <= 8) && gradient[next] < 80) {
        background[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  const visited = new Uint8Array(pixels);
  const components: Component[] = [];
  const minimumComponent = Math.max(16, Math.floor(pixels * 0.001));
  for (let seed = 0; seed < pixels; seed += 1) {
    if (background[seed] || visited[seed] || raw[seed * 4 + 3] === 0) continue;
    head = 0;
    tail = 1;
    queue[0] = seed;
    visited[seed] = 1;
    const componentPixels: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let lightSum = 0;
    let saturationSum = 0;
    while (head < tail) {
      const index = queue[head++];
      componentPixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const offset = index * 4;
      const maximum = Math.max(raw[offset], raw[offset + 1], raw[offset + 2]);
      const minimum = Math.min(raw[offset], raw[offset + 1], raw[offset + 2]);
      lightSum += luminance[index];
      saturationSum += maximum === 0 ? 0 : ((maximum - minimum) / maximum) * 255;
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || background[next] || visited[next] || raw[next * 4 + 3] === 0) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (componentPixels.length < minimumComponent) continue;
    components.push({
      pixels: componentPixels,
      minX,
      minY,
      maxX,
      maxY,
      luminance: lightSum / componentPixels.length,
      saturation: saturationSum / componentPixels.length,
    });
  }
  components.sort((left, right) => right.pixels.length - left.pixels.length);

  const persistLayer = options.persistLayer || ((buffer: Buffer, filename: string) => (
    saveImageFile(buffer, filename, 'layer-decomposition')
  ));
  const layers: EditableLayerAsset[] = [];
  const buffers = new Map<string, Buffer>();
  const taskName = safeTaskName(options.taskId);

  const backgroundRaw = Buffer.alloc(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    backgroundRaw[offset] = background[pixel] ? raw[offset] : meanR;
    backgroundRaw[offset + 1] = background[pixel] ? raw[offset + 1] : meanG;
    backgroundRaw[offset + 2] = background[pixel] ? raw[offset + 2] : meanBlue;
    backgroundRaw[offset + 3] = 255;
  }
  const backgroundPng = await sharp(backgroundRaw, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
  const backgroundAsset: EditableLayerAsset = {
    id: 'local-background',
    name: '背景',
    role: 'background',
    imageUrl: '',
    width,
    height,
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    source: 'local-enhanced',
  };
  backgroundAsset.imageUrl = await persistLayer(
    backgroundPng,
    `${taskName}_background.png`,
    backgroundAsset,
  );
  layers.push(backgroundAsset);
  buffers.set(backgroundAsset.id, backgroundPng);

  let elementNumber = 1;
  for (const [componentIndex, component] of components.slice(0, MAX_LOCAL_LAYERS - 1).entries()) {
    const layerWidth = component.maxX - component.minX + 1;
    const layerHeight = component.maxY - component.minY + 1;
    const componentRaw = Buffer.alloc(layerWidth * layerHeight * 4);
    for (const pixel of component.pixels) {
      const sourceX = pixel % width;
      const sourceY = Math.floor(pixel / width);
      const target = ((sourceY - component.minY) * layerWidth + sourceX - component.minX) * 4;
      const source = pixel * 4;
      raw.copy(componentRaw, target, source, source + 4);
    }
    const isShadow = componentIndex > 0
      && component.luminance < 145
      && component.saturation < 45
      && component.minY > height * 0.45;
    const role = componentIndex === 0 ? 'subject' : isShadow ? 'shadow' : 'decoration';
    const name = role === 'subject' ? '主体' : role === 'shadow' ? '阴影' : `元素 ${elementNumber++}`;
    const png = await sharp(componentRaw, {
      raw: { width: layerWidth, height: layerHeight, channels: 4 },
    }).png().toBuffer();
    const id = `local-${role}-${componentIndex + 1}`;
    const asset: EditableLayerAsset = {
      id,
      name,
      role,
      imageUrl: '',
      width: layerWidth,
      height: layerHeight,
      offsetX: component.minX,
      offsetY: component.minY,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      source: 'local-enhanced',
      qualityWarnings: ['本地图层为 CPU 推断结果，请复核边缘和遮挡关系'],
    };
    asset.imageUrl = await persistLayer(png, `${taskName}_${id}.png`, asset);
    layers.push(asset);
    buffers.set(id, png);
  }

  if (layers.length === 1) {
    const originalPng = await sharp(sourceBuffer).ensureAlpha().png().toBuffer();
    const subject: EditableLayerAsset = {
      id: 'local-subject-1',
      name: '主体',
      role: 'subject',
      imageUrl: '',
      width,
      height,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      source: 'local-enhanced',
      qualityWarnings: ['未能可靠分离背景，主体层保留完整原图'],
    };
    subject.imageUrl = await persistLayer(originalPng, `${taskName}_subject.png`, subject);
    layers.push(subject);
    buffers.set(subject.id, originalPng);
  }

  const quality = await evaluateLayerQuality(sourceBuffer, layers, {
    loadLayer: async (layer) => buffers.get(layer.id)!,
  });
  return { width, height, layers, buffers, quality };
}
