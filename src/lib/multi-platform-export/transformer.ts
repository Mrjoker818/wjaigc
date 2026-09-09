import { createHash } from 'node:crypto';

import {
  detectSupportedImageMimeType,
  type SupportedImageMimeType,
} from '@/lib/image-tools/file';
import { withSafeSharp } from '@/lib/safe-image-input';
import type { ExportFormat, MultiPlatformExportInput } from './types';
import type { AuthorizedExportImageSource } from './source-reader';

export type { AuthorizedExportImageSource } from './source-reader';

const DEFAULT_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_PIXELS = 40_000_000;
const DEFAULT_MAX_OUTPUT_BYTES = 80 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_PIXELS = 67_108_864;
const MIME_BY_FORMAT: Record<ExportFormat, SupportedImageMimeType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export class MultiPlatformExportTransformError extends Error {
  constructor(readonly code: string, options?: ErrorOptions) {
    super(code, options);
    this.name = 'MultiPlatformExportTransformError';
  }
}

export interface PlatformImageTarget {
  width: number;
  height: number;
  outputFormat: ExportFormat;
}

export interface TransformedExport {
  bytes: Buffer;
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  hasTransparency: boolean;
  sha256: string;
  metadata: {
    width: number;
    height: number;
    format: ExportFormat;
    hasAlpha: boolean;
  };
}

export interface TransformPlatformImageInput {
  source: AuthorizedExportImageSource;
  target: PlatformImageTarget;
  fit: MultiPlatformExportInput['fit'];
  background: MultiPlatformExportInput['background'];
  signal?: AbortSignal;
  limits?: {
    maxSourceBytes?: number;
    maxSourcePixels?: number;
    maxOutputBytes?: number;
    maxOutputPixels?: number;
  };
}

function fail(code: string, cause?: unknown): never {
  throw new MultiPlatformExportTransformError(
    code,
    cause === undefined ? undefined : { cause },
  );
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback;
}

function alphaFromBackground(background: MultiPlatformExportInput['background']): number {
  return background === 'transparent' ? 0 : Number.parseInt(background.slice(-2), 16);
}

async function outputHasTransparency(
  bytes: Buffer,
  hasAlpha: boolean | undefined,
  maxPixels: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!hasAlpha) return false;
  signal?.throwIfAborted();
  const stats = await withSafeSharp(
    bytes,
    { maxPixels, signal },
    pipeline => pipeline.extractChannel('alpha').stats(),
  );
  signal?.throwIfAborted();
  return stats.channels[0].min < 255;
}

export async function transformPlatformImage(
  input: TransformPlatformImageInput,
): Promise<TransformedExport> {
  input.signal?.throwIfAborted();
  const maxSourceBytes = positiveLimit(input.limits?.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES);
  const maxSourcePixels = positiveLimit(input.limits?.maxSourcePixels, DEFAULT_MAX_SOURCE_PIXELS);
  const maxOutputBytes = positiveLimit(input.limits?.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  const maxOutputPixels = positiveLimit(input.limits?.maxOutputPixels, DEFAULT_MAX_OUTPUT_PIXELS);
  const { width, height, outputFormat } = input.target;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width * height > maxOutputPixels
  ) fail('EXPORT_OUTPUT_PIXEL_LIMIT');
  if (input.fit !== 'cover' && input.fit !== 'contain') fail('EXPORT_FIT_INVALID');
  if (!MIME_BY_FORMAT[outputFormat]) fail('EXPORT_OUTPUT_FORMAT_INVALID');
  if (!Buffer.isBuffer(input.source.bytes) || input.source.bytes.length < 1) {
    fail('EXPORT_SOURCE_FORMAT_INVALID');
  }
  if (input.source.bytes.length > maxSourceBytes) fail('EXPORT_SOURCE_BYTE_LIMIT');
  const actualSourceMime = detectSupportedImageMimeType(input.source.bytes);
  if (!actualSourceMime || actualSourceMime !== input.source.mimeType) {
    fail('EXPORT_SOURCE_FORMAT_INVALID');
  }

  const backgroundAlpha = alphaFromBackground(input.background);
  if (!Number.isInteger(backgroundAlpha)) fail('EXPORT_BACKGROUND_INVALID');
  if (outputFormat === 'jpeg' && (backgroundAlpha < 255 || input.source.hasTransparency)) {
    fail('EXPORT_TRANSPARENCY_FORMAT_CONFLICT');
  }

  try {
    input.signal?.throwIfAborted();
    const actualSourceSha256 = createHash('sha256').update(input.source.bytes).digest('hex');
    if (input.source.sha256 !== actualSourceSha256) fail('EXPORT_SOURCE_INTEGRITY_INVALID');
    const sourceMetadata = await withSafeSharp(
      input.source.bytes,
      { maxPixels: maxSourcePixels, signal: input.signal },
      pipeline => pipeline.metadata(),
    );
    if (
      sourceMetadata.width !== input.source.width
      || sourceMetadata.height !== input.source.height
      || sourceMetadata.format !== actualSourceMime.replace('image/', '').replace('jpg', 'jpeg')
    ) fail('EXPORT_SOURCE_METADATA_INVALID');

    const bytes = await withSafeSharp(
      input.source.bytes,
      { maxPixels: maxSourcePixels, signal: input.signal },
      async pipeline => {
        let output = pipeline
          .rotate()
          .resize(width, height, {
            fit: input.fit,
            position: 'centre',
            background: input.background === 'transparent' ? '#00000000' : input.background,
          });
        if (outputFormat === 'jpeg') output = output.jpeg({ quality: 92, mozjpeg: true });
        if (outputFormat === 'png') output = output.png({ compressionLevel: 9 });
        if (outputFormat === 'webp') output = output.webp({ quality: 92 });
        return output.toBuffer();
      },
    );
    input.signal?.throwIfAborted();
    if (bytes.length < 1 || bytes.length > maxOutputBytes) fail('EXPORT_OUTPUT_BYTE_LIMIT');

    const mimeType = detectSupportedImageMimeType(bytes);
    const expectedMimeType = MIME_BY_FORMAT[outputFormat];
    if (!mimeType || mimeType !== expectedMimeType) fail('EXPORT_OUTPUT_FORMAT_INVALID');
    const metadata = await withSafeSharp(
      bytes,
      { maxPixels: maxOutputPixels, signal: input.signal },
      pipeline => pipeline.metadata(),
    );
    input.signal?.throwIfAborted();
    if (
      metadata.width !== width
      || metadata.height !== height
      || metadata.format !== outputFormat
    ) fail('EXPORT_OUTPUT_METADATA_INVALID');
    const hasTransparency = await outputHasTransparency(
      bytes,
      metadata.hasAlpha,
      maxOutputPixels,
      input.signal,
    );
    if (outputFormat === 'jpeg' && (metadata.hasAlpha || hasTransparency)) {
      fail('EXPORT_OUTPUT_ALPHA_INVALID');
    }
    const containHasPadding = input.fit === 'contain'
      && input.source.width * height !== input.source.height * width;
    if (
      input.fit === 'contain'
      && backgroundAlpha < 255
      && (containHasPadding || input.source.hasTransparency)
      && !hasTransparency
    ) {
      fail('EXPORT_OUTPUT_ALPHA_INVALID');
    }

    return {
      bytes,
      mimeType,
      width,
      height,
      hasTransparency,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      metadata: {
        width,
        height,
        format: outputFormat,
        hasAlpha: Boolean(metadata.hasAlpha),
      },
    };
  } catch (error) {
    input.signal?.throwIfAborted();
    if (error instanceof MultiPlatformExportTransformError) throw error;
    fail('EXPORT_IMAGE_TRANSFORM_FAILED', error);
  }
}
