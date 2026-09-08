import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';

const MAX_COMPLIANCE_BYTES = 25 * 1024 * 1024;
const MAX_COMPLIANCE_PIXELS = 40_000_000;
const BACKGROUND_SAMPLE_EDGE = 256;
const BACKGROUND_SAMPLE_INSET_RATIOS = [0, 0.04, 0.08, 0.12] as const;
const BACKGROUND_SAMPLES_PER_RING = 64;
const WHITE_RGB_DISTANCE = 10;

export interface ComplianceMediaFacts {
  mimeType: string;
  byteLength: number;
  width: number;
  height: number;
  pixelCount: number;
  longestEdge: number;
  hasAlpha: boolean;
  hasTransparentPixels: boolean;
  isAnimated: boolean;
  backgroundSampleRingCount: number;
  backgroundSampleCount: number;
  whiteBackgroundSampleCount: number;
  whiteBackgroundRatio: number;
}

function ringCoordinate(
  index: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): readonly [number, number] {
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (height === 1) return [left + index, top];
  if (width === 1) return [left, top + index];
  if (index < width) return [left + index, top];
  if (index < width + height - 2) return [right, top + index - width + 1];
  if (index < width * 2 + height - 2) {
    return [right - (index - width - height + 2), bottom];
  }
  return [left, bottom - (index - width * 2 - height + 3)];
}

function measureWhiteBackgroundSamples(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
): Pick<ComplianceMediaFacts,
  | 'backgroundSampleRingCount'
  | 'backgroundSampleCount'
  | 'whiteBackgroundSampleCount'
  | 'whiteBackgroundRatio'> {
  let backgroundSampleCount = 0;
  let whiteBackgroundSampleCount = 0;
  const sample = (x: number, y: number): void => {
    const offset = (y * width + x) * channels;
    const redDistance = 255 - pixels[offset];
    const greenDistance = 255 - pixels[offset + 1];
    const blueDistance = 255 - pixels[offset + 2];
    const alpha = pixels[offset + 3];
    const distance = Math.sqrt(
      redDistance * redDistance + greenDistance * greenDistance + blueDistance * blueDistance,
    );
    backgroundSampleCount += 1;
    if (alpha === 255 && distance <= WHITE_RGB_DISTANCE) whiteBackgroundSampleCount += 1;
  };

  const maximumInset = Math.floor((Math.min(width, height) - 1) / 2);
  const insets = [...new Set(BACKGROUND_SAMPLE_INSET_RATIOS.map(
    ratio => Math.min(maximumInset, Math.floor((Math.min(width, height) - 1) * ratio)),
  ))];
  for (const inset of insets) {
    const left = inset;
    const top = inset;
    const right = width - inset - 1;
    const bottom = height - inset - 1;
    const ringLength = right === left
      ? bottom - top + 1
      : bottom === top
        ? right - left + 1
        : 2 * (right - left + 1) + 2 * (bottom - top - 1);
    const sampleCount = Math.min(BACKGROUND_SAMPLES_PER_RING, ringLength);
    for (let index = 0; index < sampleCount; index += 1) {
      const ringIndex = Math.floor(index * ringLength / sampleCount);
      const [x, y] = ringCoordinate(ringIndex, left, top, right, bottom);
      sample(x, y);
    }
  }

  return {
    backgroundSampleRingCount: insets.length,
    backgroundSampleCount,
    whiteBackgroundSampleCount,
    whiteBackgroundRatio: backgroundSampleCount === 0
      ? 0
      : whiteBackgroundSampleCount / backgroundSampleCount,
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
