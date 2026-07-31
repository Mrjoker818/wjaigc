import sharp from 'sharp';

const MAX_INPUT_PIXELS = 67_108_864;
const TRANSPARENT_ALPHA_MAX = 15;
const FOREGROUND_ALPHA_MIN = 240;
const MIN_FOREGROUND_RATIO = 0.005;
const MIN_TRANSPARENT_RATIO = 0.002;
const MAX_EDGE_HALO_RATIO = 0.12;
const HALO_COLOR_DISTANCE = 48;

export interface RemoveBgQualityMetrics {
  width: number;
  height: number;
  foregroundRatio: number;
  transparentRatio: number;
  partialAlphaRatio: number;
  edgeHaloRatio: number;
}

export type RemoveBgQualityCode =
  | 'DIMENSION_MISMATCH'
  | 'ALPHA_MISSING'
  | 'EMPTY_FOREGROUND'
  | 'NO_BACKGROUND_REMOVED'
  | 'EDGE_HALO_HIGH';

export interface RemoveBgQualityResult {
  ok: boolean;
  code?: RemoveBgQualityCode;
  metrics: RemoveBgQualityMetrics;
}

interface DecodedRgba {
  data: Buffer;
  width: number;
  height: number;
  hadAlpha: boolean;
}

async function decodeRgba(buffer: Buffer): Promise<DecodedRgba> {
  const image = sharp(buffer, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
  });
  const metadata = await image.metadata();
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
    hadAlpha: metadata.hasAlpha === true || metadata.channels === 4,
  };
}

function emptyMetrics(width: number, height: number): RemoveBgQualityMetrics {
  return {
    width,
    height,
    foregroundRatio: 0,
    transparentRatio: 0,
    partialAlphaRatio: 0,
    edgeHaloRatio: 0,
  };
}

export async function evaluateRemoveBgOutput(
  sourceBuffer: Buffer,
  candidateBuffer: Buffer,
): Promise<RemoveBgQualityResult> {
  const [source, candidate] = await Promise.all([
    decodeRgba(sourceBuffer),
    decodeRgba(candidateBuffer),
  ]);

  if (source.width !== candidate.width || source.height !== candidate.height) {
    return {
      ok: false,
      code: 'DIMENSION_MISMATCH',
      metrics: emptyMetrics(candidate.width, candidate.height),
    };
  }

  const pixelCount = candidate.width * candidate.height;
  let foregroundCount = 0;
  let transparentCount = 0;
  let partialAlphaCount = 0;
  let haloCount = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const alpha = candidate.data[offset + 3];

    if (alpha <= TRANSPARENT_ALPHA_MAX) {
      transparentCount += 1;
      continue;
    }
    if (alpha >= FOREGROUND_ALPHA_MIN) {
      foregroundCount += 1;
      continue;
    }

    partialAlphaCount += 1;
    const redDiff = candidate.data[offset] - source.data[offset];
    const greenDiff = candidate.data[offset + 1] - source.data[offset + 1];
    const blueDiff = candidate.data[offset + 2] - source.data[offset + 2];
    const colorDistance = Math.sqrt(
      redDiff * redDiff + greenDiff * greenDiff + blueDiff * blueDiff,
    );
    if (colorDistance > HALO_COLOR_DISTANCE) haloCount += 1;
  }

  const metrics: RemoveBgQualityMetrics = {
    width: candidate.width,
    height: candidate.height,
    foregroundRatio: foregroundCount / pixelCount,
    transparentRatio: transparentCount / pixelCount,
    partialAlphaRatio: partialAlphaCount / pixelCount,
    edgeHaloRatio: partialAlphaCount === 0 ? 0 : haloCount / partialAlphaCount,
  };

  if (metrics.foregroundRatio < MIN_FOREGROUND_RATIO) {
    return { ok: false, code: 'EMPTY_FOREGROUND', metrics };
  }
  if (metrics.transparentRatio < MIN_TRANSPARENT_RATIO) {
    return {
      ok: false,
      code: candidate.hadAlpha ? 'NO_BACKGROUND_REMOVED' : 'NO_BACKGROUND_REMOVED',
      metrics,
    };
  }
  if (metrics.edgeHaloRatio > MAX_EDGE_HALO_RATIO) {
    return { ok: false, code: 'EDGE_HALO_HIGH', metrics };
  }

  return { ok: true, metrics };
}
