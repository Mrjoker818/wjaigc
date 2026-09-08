import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';

const MAX_COMPLIANCE_BYTES = 25 * 1024 * 1024;
const MAX_COMPLIANCE_PIXELS = 40_000_000;
const BACKGROUND_SAMPLE_EDGE = 256;
const WHITE_RGB_DISTANCE = 10;

export interface ComplianceMediaFacts {
  mimeType: string;
  byteLength: number;
  width: number;
  height: number;
  pixelCount: number;
  longestEdge: number;
  hasAlpha: boolean;
  isAnimated: boolean;
  backgroundSampleCount: number;
  whiteBackgroundSampleCount: number;
  whiteBackgroundRatio: number;
}

function measureWhiteEdgeSamples(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
): Pick<ComplianceMediaFacts, 'backgroundSampleCount' | 'whiteBackgroundSampleCount' | 'whiteBackgroundRatio'> {
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

  for (let x = 0; x < width; x += 1) {
    sample(x, 0);
    if (height > 1) sample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sample(0, y);
    if (width > 1) sample(width - 1, y);
  }

  return {
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
  const sampled = await image.clone()
    .resize(BACKGROUND_SAMPLE_EDGE, BACKGROUND_SAMPLE_EDGE, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  input.signal.throwIfAborted();
  const background = measureWhiteEdgeSamples(
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
    isAnimated: Number(metadata.pages ?? 1) > 1,
    ...background,
  });
}
