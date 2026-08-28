import sharp from 'sharp';

import { getVisibleLayersInPaintOrder } from '@/lib/layer-decomposition/layer-stack-order';
import type {
  EditableLayerAsset,
  ReconstructionMetrics,
  ReconstructionReport,
} from '@/lib/layer-decomposition/types';

const MAX_PIXELS = 67_108_864;
const MAX_AGGREGATE_PIXELS = 256_000_000;

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

async function decodeRgba(buffer: Buffer): Promise<RawImage> {
  const decoded = await sharp(buffer, {
    failOn: 'error',
    limitInputPixels: MAX_PIXELS,
  }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height };
}

function blendChannel(source: number, destination: number, mode: string): number {
  if (mode === 'multiply') return Math.round((source * destination) / 255);
  if (mode === 'screen') return 255 - Math.round(((255 - source) * (255 - destination)) / 255);
  return source;
}

async function renderLayers(
  width: number,
  height: number,
  layers: EditableLayerAsset[],
  loadLayer: (layer: EditableLayerAsset) => Promise<Buffer>,
): Promise<Buffer> {
  const canvas = Buffer.alloc(width * height * 4);
  let aggregatePixels = 0;

  for (const layer of getVisibleLayersInPaintOrder(layers)) {
    const decoded = await decodeRgba(await loadLayer(layer));
    aggregatePixels += decoded.width * decoded.height;
    if (aggregatePixels > MAX_AGGREGATE_PIXELS) {
      throw new Error('Layer reconstruction exceeds the aggregate pixel limit');
    }

    for (let y = 0; y < decoded.height; y += 1) {
      const targetY = layer.offsetY + y;
      if (targetY < 0 || targetY >= height) continue;
      for (let x = 0; x < decoded.width; x += 1) {
        const targetX = layer.offsetX + x;
        if (targetX < 0 || targetX >= width) continue;
        const sourceOffset = (y * decoded.width + x) * 4;
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

  return canvas;
}

function luminance(data: Buffer, offset: number): number {
  return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
}

function calculateSsim(source: Buffer, candidate: Buffer): number {
  const pixels = source.length / 4;
  if (pixels === 0) return 1;
  let sourceMean = 0;
  let candidateMean = 0;
  for (let offset = 0; offset < source.length; offset += 4) {
    sourceMean += luminance(source, offset);
    candidateMean += luminance(candidate, offset);
  }
  sourceMean /= pixels;
  candidateMean /= pixels;

  let sourceVariance = 0;
  let candidateVariance = 0;
  let covariance = 0;
  for (let offset = 0; offset < source.length; offset += 4) {
    const sourceDelta = luminance(source, offset) - sourceMean;
    const candidateDelta = luminance(candidate, offset) - candidateMean;
    sourceVariance += sourceDelta * sourceDelta;
    candidateVariance += candidateDelta * candidateDelta;
    covariance += sourceDelta * candidateDelta;
  }
  const denominator = Math.max(1, pixels - 1);
  sourceVariance /= denominator;
  candidateVariance /= denominator;
  covariance /= denominator;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const score = (
    (2 * sourceMean * candidateMean + c1)
    * (2 * covariance + c2)
  ) / (
    (sourceMean ** 2 + candidateMean ** 2 + c1)
    * (sourceVariance + candidateVariance + c2)
  );
  return Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0));
}

function measure(source: RawImage, candidate: Buffer): ReconstructionMetrics {
  let rgbError = 0;
  let alphaError = 0;
  let maxChannelError = 0;
  let mismatchedPixels = 0;
  const pixels = source.width * source.height;

  for (let offset = 0; offset < source.data.length; offset += 4) {
    let mismatch = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(source.data[offset + channel] - candidate[offset + channel]);
      maxChannelError = Math.max(maxChannelError, delta);
      if (delta > 1) mismatch = true;
      if (channel === 3) alphaError += delta;
      else rgbError += delta;
    }
    if (mismatch) mismatchedPixels += 1;
  }

  return {
    widthMatches: candidate.length === source.data.length,
    heightMatches: candidate.length === source.data.length,
    alphaMae: alphaError / Math.max(1, pixels * 255),
    rgbMae: rgbError / Math.max(1, pixels * 3 * 255),
    maxChannelError: maxChannelError / 255,
    mismatchedPixelRatio: mismatchedPixels / Math.max(1, pixels),
    ssim: calculateSsim(source.data, candidate),
  };
}

function createAsset(input: {
  name: string;
  role: 'reconstruction-correction' | 'reconstruction-reference';
  imageUrl: string;
  width: number;
  height: number;
}): EditableLayerAsset {
  return {
    id: `${input.role}-${Date.now()}`,
    name: input.name,
    role: input.role,
    imageUrl: input.imageUrl,
    width: input.width,
    height: input.height,
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    source: 'local-enhanced',
  };
}

export async function evaluateAndCorrectReconstruction(input: {
  source: Buffer;
  layers: EditableLayerAsset[];
  loadLayer: (layer: EditableLayerAsset) => Promise<Buffer>;
  persistLayer: (buffer: Buffer, filename: string) => string | Promise<string>;
}): Promise<ReconstructionReport> {
  const source = await decodeRgba(input.source);
  const rendered = await renderLayers(source.width, source.height, input.layers, input.loadLayer);
  const native = measure(source, rendered);
  if (native.mismatchedPixelRatio === 0) {
    return { native, corrected: native, correctionApplied: false };
  }

  let requiresReference = false;
  const correction = Buffer.alloc(source.data.length);
  const corrected = Buffer.from(rendered);
  let correctionPixels = 0;
  for (let offset = 0; offset < source.data.length; offset += 4) {
    let mismatch = false;
    for (let channel = 0; channel < 4; channel += 1) {
      if (Math.abs(source.data[offset + channel] - rendered[offset + channel]) > 1) mismatch = true;
    }
    if (!mismatch) continue;
    if (source.data[offset + 3] < 255) {
      requiresReference = true;
      continue;
    }
    source.data.copy(correction, offset, offset, offset + 4);
    source.data.copy(corrected, offset, offset, offset + 4);
    correctionPixels += 1;
  }

  if (requiresReference) {
    const filename = `pixel-perfect-reference-${Date.now()}.png`;
    const sourcePng = await sharp(source.data, {
      raw: { width: source.width, height: source.height, channels: 4 },
    }).png().toBuffer();
    const imageUrl = await input.persistLayer(sourcePng, filename);
    return {
      native,
      corrected: measure(source, source.data),
      correctionApplied: true,
      pixelPerfectReferenceLayer: createAsset({
        name: 'reconstruction/pixel-perfect-reference',
        role: 'reconstruction-reference',
        imageUrl,
        width: source.width,
        height: source.height,
      }),
    };
  }

  if (correctionPixels > 0) {
    const filename = `reconstruction-correction-${Date.now()}.png`;
    const correctionPng = await sharp(correction, {
      raw: { width: source.width, height: source.height, channels: 4 },
    }).png().toBuffer();
    const imageUrl = await input.persistLayer(correctionPng, filename);
    return {
      native,
      corrected: measure(source, corrected),
      correctionApplied: true,
      correctionLayer: createAsset({
        name: 'reconstruction/correction',
        role: 'reconstruction-correction',
        imageUrl,
        width: source.width,
        height: source.height,
      }),
    };
  }

  return { native, corrected: native, correctionApplied: false };
}
