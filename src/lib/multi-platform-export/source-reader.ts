import { createHash } from 'node:crypto';

import {
  AssetServiceError,
  createAssetService,
  type ResolveAssetReferenceInput,
} from '@/lib/asset-core/service';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import {
  detectSupportedImageMimeType,
  type SupportedImageMimeType,
} from '@/lib/image-tools/image-mime';
import {
  loadSafeImageInput,
  withSafeSharp,
  type DecodedSafeImage,
  type SafeImageInputOptions,
} from '@/lib/safe-image-input';
import {
  readImageFromS3Bounded,
  S3BoundedReadError,
  type S3BoundedReadOptions,
} from '@/lib/s3-storage';

const DEFAULT_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_PIXELS = 40_000_000;
const MAX_SOURCE_COUNT = 20;

export class MultiPlatformExportSourceError extends Error {
  constructor(readonly code: string, options?: ErrorOptions) {
    super(code, options);
    this.name = 'MultiPlatformExportSourceError';
  }
}

export interface AuthorizedExportImageSource {
  versionId: string;
  assetId?: string;
  assetName: string;
  bytes: Buffer;
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  hasTransparency: boolean;
  sha256: string;
}

export interface ExportSourceReaderDependencies {
  resolveAssetReference(input: ResolveAssetReferenceInput): Promise<WorkspaceAssetReference & {
    storageKey?: string;
    checksum?: string;
    mimeType?: string;
    byteSize?: number;
  }>;
  loadImage(input: string, options: SafeImageInputOptions): Promise<DecodedSafeImage>;
  readS3(
    key: string,
    maxBytes: number,
    timeoutMs: number,
    options?: S3BoundedReadOptions,
  ): Promise<Buffer | null>;
}

export interface ReadAuthorizedExportSourcesInput {
  actorUserId: string;
  projectId: string;
  sourceVersionIds: readonly string[];
  signal?: AbortSignal;
  limits?: {
    maxSourceBytes?: number;
    maxSourcePixels?: number;
  };
  dependencies?: Partial<ExportSourceReaderDependencies>;
}

function fail(code: string, cause?: unknown): never {
  throw new MultiPlatformExportSourceError(
    code,
    cause === undefined ? undefined : { cause },
  );
}

function errorChainContains(error: unknown, pattern: RegExp): boolean {
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (pattern.test(String((current as { message?: unknown }).message ?? ''))) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function validateLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback;
}

async function hasTransparentPixels(
  bytes: Buffer,
  metadataHasAlpha: boolean | undefined,
  maxPixels: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!metadataHasAlpha) return false;
  signal?.throwIfAborted();
  const stats = await withSafeSharp(
    bytes,
    { maxPixels, signal },
    pipeline => pipeline.extractChannel('alpha').stats(),
  );
  signal?.throwIfAborted();
  return stats.channels[0].min < 255;
}

function defaultDependencies(): ExportSourceReaderDependencies {
  return {
    resolveAssetReference: input => createAssetService().resolveReadableAssetReference(input),
    loadImage: loadSafeImageInput,
    readS3: readImageFromS3Bounded,
  };
}

export async function readAuthorizedExportSources(
  input: ReadAuthorizedExportSourcesInput,
): Promise<AuthorizedExportImageSource[]> {
  const { sourceVersionIds } = input;
  if (
    sourceVersionIds.length < 1
    || sourceVersionIds.length > MAX_SOURCE_COUNT
    || new Set(sourceVersionIds).size !== sourceVersionIds.length
  ) fail('EXPORT_SOURCE_COUNT_INVALID');

  const defaults = defaultDependencies();
  const dependencies: ExportSourceReaderDependencies = {
    resolveAssetReference: input.dependencies?.resolveAssetReference ?? defaults.resolveAssetReference,
    loadImage: input.dependencies?.loadImage ?? defaults.loadImage,
    readS3: input.dependencies?.readS3 ?? defaults.readS3,
  };
  const maxSourceBytes = validateLimit(input.limits?.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES);
  const maxSourcePixels = validateLimit(input.limits?.maxSourcePixels, DEFAULT_MAX_SOURCE_PIXELS);
  const sources: AuthorizedExportImageSource[] = [];

  for (const versionId of sourceVersionIds) {
    input.signal?.throwIfAborted();
    let reference: Awaited<ReturnType<ExportSourceReaderDependencies['resolveAssetReference']>>;
    try {
      reference = await dependencies.resolveAssetReference({
        actorUserId: input.actorUserId,
        projectId: input.projectId,
        assetVersionId: versionId,
      });
    } catch (error) {
      input.signal?.throwIfAborted();
      if (error instanceof AssetServiceError && error.code === 'ASSET_NOT_FOUND') throw error;
      fail('EXPORT_SOURCE_UNAVAILABLE', error);
    }
    input.signal?.throwIfAborted();
    if (reference.kind !== 'image') fail('EXPORT_SOURCE_FORMAT_INVALID');

    let image: DecodedSafeImage;
    try {
      const storedBytes = reference.storageKey
        ? await dependencies.readS3(
          reference.storageKey,
          maxSourceBytes,
          30_000,
          { signal: input.signal, strict: true },
        )
        : null;
      if (reference.storageKey && !storedBytes) {
        fail('EXPORT_SOURCE_UNAVAILABLE');
      }
      if (storedBytes) {
        const detectedMimeType = detectSupportedImageMimeType(storedBytes);
        image = {
          buffer: storedBytes,
          mimeType: reference.mimeType ?? detectedMimeType ?? '',
        };
      } else {
        image = await dependencies.loadImage(reference.url, {
          maxBytes: maxSourceBytes,
          maxPixels: maxSourcePixels,
          signal: input.signal,
        });
      }
    } catch (error) {
      input.signal?.throwIfAborted();
      if (error instanceof S3BoundedReadError) {
        if (error.code === 'S3_READ_SIZE_LIMIT') {
          fail('EXPORT_SOURCE_BYTE_LIMIT', error);
        }
        fail('EXPORT_SOURCE_UNAVAILABLE', error);
      }
      if (error instanceof MultiPlatformExportSourceError) throw error;
      if (errorChainContains(error, /size limit|byte limit|exceeds.*size/i)) {
        fail('EXPORT_SOURCE_BYTE_LIMIT', error);
      }
      if (errorChainContains(error, /private or reserved address/i)) {
        fail('REMOTE_MEDIA_PRIVATE_ADDRESS', error);
      }
      if (errorChainContains(error, /pixel dimensions|pixel limit/i)) {
        fail('EXPORT_SOURCE_PIXEL_LIMIT', error);
      }
      fail('EXPORT_SOURCE_FORMAT_INVALID', error);
    }

    input.signal?.throwIfAborted();
    if (!Buffer.isBuffer(image.buffer) || image.buffer.length < 1 || image.buffer.length > maxSourceBytes) {
      fail('EXPORT_SOURCE_BYTE_LIMIT');
    }
    if (reference.byteSize !== undefined && reference.byteSize !== image.buffer.length) {
      fail('EXPORT_SOURCE_INTEGRITY_INVALID');
    }
    if (reference.checksum) {
      const expectedChecksum = reference.checksum.trim().toLowerCase().replace(/^sha256:/, '');
      const actualChecksum = createHash('sha256').update(image.buffer).digest('hex');
      if (!/^[a-f0-9]{64}$/.test(expectedChecksum) || expectedChecksum !== actualChecksum) {
        fail('EXPORT_SOURCE_INTEGRITY_INVALID');
      }
    }
    const actualMimeType = detectSupportedImageMimeType(image.buffer);
    if (!actualMimeType || actualMimeType !== image.mimeType) {
      fail('EXPORT_SOURCE_FORMAT_INVALID');
    }

    let metadata;
    try {
      metadata = await withSafeSharp(
        image.buffer,
        { maxPixels: maxSourcePixels, signal: input.signal },
        pipeline => pipeline.metadata(),
      );
    } catch (error) {
      input.signal?.throwIfAborted();
      if (errorChainContains(error, /pixel/i)) fail('EXPORT_SOURCE_PIXEL_LIMIT', error);
      fail('EXPORT_SOURCE_FORMAT_INVALID', error);
    }
    input.signal?.throwIfAborted();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (
      !Number.isSafeInteger(width)
      || !Number.isSafeInteger(height)
      || width < 1
      || height < 1
      || width * height > maxSourcePixels
    ) fail('EXPORT_SOURCE_PIXEL_LIMIT');

    const hasTransparency = await hasTransparentPixels(
      image.buffer,
      metadata.hasAlpha,
      maxSourcePixels,
      input.signal,
    );
    sources.push({
      versionId,
      ...(reference.assetId ? { assetId: reference.assetId } : {}),
      assetName: reference.name?.trim() || versionId,
      bytes: image.buffer,
      mimeType: actualMimeType,
      width,
      height,
      hasTransparency,
      sha256: createHash('sha256').update(image.buffer).digest('hex'),
    });
  }

  return sources;
}
