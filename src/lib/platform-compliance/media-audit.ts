import { createHash } from 'node:crypto';

import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';

const MAX_COMPLIANCE_BYTES = 25 * 1024 * 1024;
const MAX_COMPLIANCE_PIXELS = 40_000_000;
const BACKGROUND_SAMPLE_EDGE = 256;
const BACKGROUND_SAMPLE_REGION = 'corner-depth-zones' as const;
const BACKGROUND_SAMPLE_REGION_COUNT = 4;
const BACKGROUND_SAMPLE_MAX_DEPTH_RATIO = 0.24;
const BACKGROUND_SAMPLE_AXIS_POINTS = 8;
const WHITE_RGB_DISTANCE = 10;

export interface ComplianceMediaFacts {
  mimeType: string;
  byteLength: number;
  sourceDigest: string;
  width: number;
  height: number;
  pixelCount: number;
  longestEdge: number;
  hasAlpha: boolean;
  hasTransparentPixels: boolean;
  isAnimated: boolean;
  backgroundSampleRegion: typeof BACKGROUND_SAMPLE_REGION;
  backgroundSampleRegionCount: number;
  backgroundSampleMaxDepthRatio: number;
  backgroundSampleCount: number;
  whiteBackgroundSampleCount: number;
  whiteBackgroundRatio: number;
  outerBackgroundSampleCount: number;
  whiteOuterBackgroundSampleCount: number;
  whiteOuterBackgroundRatio: number;
  deepBackgroundSampleCount: number;
  whiteDeepBackgroundSampleCount: number;
  whiteDeepBackgroundRatio: number;
}

function measureWhiteBackgroundSamples(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
): Pick<ComplianceMediaFacts,
  | 'backgroundSampleRegion'
  | 'backgroundSampleRegionCount'
  | 'backgroundSampleMaxDepthRatio'
  | 'backgroundSampleCount'
  | 'whiteBackgroundSampleCount'
  | 'whiteBackgroundRatio'
  | 'outerBackgroundSampleCount'
  | 'whiteOuterBackgroundSampleCount'
  | 'whiteOuterBackgroundRatio'
  | 'deepBackgroundSampleCount'
  | 'whiteDeepBackgroundSampleCount'
  | 'whiteDeepBackgroundRatio'> {
  const isWhite = (x: number, y: number): boolean => {
    const offset = (y * width + x) * channels;
    const redDistance = 255 - pixels[offset];
    const greenDistance = 255 - pixels[offset + 1];
    const blueDistance = 255 - pixels[offset + 2];
    const alpha = pixels[offset + 3];
    const distance = Math.sqrt(
      redDistance * redDistance + greenDistance * greenDistance + blueDistance * blueDistance,
    );
    return alpha === 255 && distance <= WHITE_RGB_DISTANCE;
  };

  const maxXDepth = Math.floor((width - 1) * BACKGROUND_SAMPLE_MAX_DEPTH_RATIO);
  const maxYDepth = Math.floor((height - 1) * BACKGROUND_SAMPLE_MAX_DEPTH_RATIO);
  const xPointCount = Math.min(BACKGROUND_SAMPLE_AXIS_POINTS, maxXDepth + 1);
  const yPointCount = Math.min(BACKGROUND_SAMPLE_AXIS_POINTS, maxYDepth + 1);
  const outerCoordinates = new Set<string>();
  const deepCoordinates = new Set<string>();
  for (let xIndex = 0; xIndex < xPointCount; xIndex += 1) {
    const xDepth = xPointCount === 1 ? 0 : Math.floor(xIndex * maxXDepth / (xPointCount - 1));
    for (let yIndex = 0; yIndex < yPointCount; yIndex += 1) {
      const yDepth = yPointCount === 1 ? 0 : Math.floor(yIndex * maxYDepth / (yPointCount - 1));
      const target = xDepth === 0 || yDepth === 0 ? outerCoordinates : deepCoordinates;
      target.add(`${xDepth},${yDepth}`);
      target.add(`${width - xDepth - 1},${yDepth}`);
      target.add(`${xDepth},${height - yDepth - 1}`);
      target.add(`${width - xDepth - 1},${height - yDepth - 1}`);
    }
  }
  for (const coordinate of outerCoordinates) deepCoordinates.delete(coordinate);
  const countWhite = (coordinates: ReadonlySet<string>): number => {
    let count = 0;
    for (const coordinate of coordinates) {
      const [x, y] = coordinate.split(',').map(Number);
      if (isWhite(x, y)) count += 1;
    }
    return count;
  };
  const outerBackgroundSampleCount = outerCoordinates.size;
  const deepBackgroundSampleCount = deepCoordinates.size;
  const whiteOuterBackgroundSampleCount = countWhite(outerCoordinates);
  const whiteDeepBackgroundSampleCount = countWhite(deepCoordinates);
  const backgroundSampleCount = outerBackgroundSampleCount + deepBackgroundSampleCount;
  const whiteBackgroundSampleCount = whiteOuterBackgroundSampleCount
    + whiteDeepBackgroundSampleCount;

  return {
    backgroundSampleRegion: BACKGROUND_SAMPLE_REGION,
    backgroundSampleRegionCount: BACKGROUND_SAMPLE_REGION_COUNT,
    backgroundSampleMaxDepthRatio: BACKGROUND_SAMPLE_MAX_DEPTH_RATIO,
    backgroundSampleCount,
    whiteBackgroundSampleCount,
    whiteBackgroundRatio: backgroundSampleCount === 0
      ? 0
      : whiteBackgroundSampleCount / backgroundSampleCount,
    outerBackgroundSampleCount,
    whiteOuterBackgroundSampleCount,
    whiteOuterBackgroundRatio: outerBackgroundSampleCount === 0
      ? 0
      : whiteOuterBackgroundSampleCount / outerBackgroundSampleCount,
    deepBackgroundSampleCount,
    whiteDeepBackgroundSampleCount,
    whiteDeepBackgroundRatio: deepBackgroundSampleCount === 0
      ? 0
      : whiteDeepBackgroundSampleCount / deepBackgroundSampleCount,
  };
}

export async function auditComplianceMedia(input: {
  imageInput: string;
  signal: AbortSignal;
}): Promise<ComplianceMediaFacts> {
  const decoded = await loadSafeImageInput(input.imageInput, {
    maxBytes: MAX_COMPLIANCE_BYTES,
    maxPixels: MAX_COMPLIANCE_PIXELS,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  const image = safeSharp(decoded.buffer, {
    maxPixels: MAX_COMPLIANCE_PIXELS,
    signal: input.signal,
  });
  const metadata = await image.metadata();
  input.signal.throwIfAborted();
  if (!metadata.width || !metadata.height) throw new Error('COMPLIANCE_IMAGE_DIMENSIONS_INVALID');
  const [sampled, imageStats] = await Promise.all([
    image.clone()
      .resize(BACKGROUND_SAMPLE_EDGE, BACKGROUND_SAMPLE_EDGE, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    image.clone().stats(),
  ]);
  input.signal.throwIfAborted();
  const background = measureWhiteBackgroundSamples(
    sampled.data,
    sampled.info.width,
    sampled.info.height,
    sampled.info.channels,
  );

  return Object.freeze({
    mimeType: decoded.mimeType,
    byteLength: decoded.buffer.byteLength,
    sourceDigest: createHash('sha256').update(decoded.buffer).digest('hex'),
    width: metadata.width,
    height: metadata.height,
    pixelCount: metadata.width * metadata.height,
    longestEdge: Math.max(metadata.width, metadata.height),
    hasAlpha: metadata.hasAlpha === true,
    hasTransparentPixels: !imageStats.isOpaque,
    isAnimated: Number(metadata.pages ?? 1) > 1,
    ...background,
  });
}
