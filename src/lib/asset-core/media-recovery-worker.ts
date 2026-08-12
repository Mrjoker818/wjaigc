import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getSafeMediaTypeFromResponse, isAllowedPublicMediaExtension } from '@/lib/media-validation';
import { downloadPublicImage } from '@/lib/safe-image-download';
import { getServerDataRoot, isServerDataRootDurable } from '@/lib/server-data-root';
import { readImageFromS3Bounded, uploadImageToS3 } from '@/lib/s3-storage';

export interface AssetMediaRecoveryTarget {
  fileUrl: string;
  recoverySourceUrl: string | null;
  storageKey: string | null;
  checksum?: string | null;
  mimeType?: string | null;
  assetVersionId: string;
  attemptId: string;
}

export interface AssetMediaRecoveryExecution {
  success: boolean;
  method: string;
  url?: string;
  storageKey?: string;
  checksum?: string;
  mimeType?: string;
  byteSize?: number;
  error?: string;
  retryable?: boolean;
}

const MAX_RECOVERY_BYTES = 80 * 1024 * 1024;
const STORAGE_TIMEOUT_MS = 30_000;

function managedPathFromUrl(fileUrl: string): string | null {
  const prefix = '/api/serve-upload/';
  if (!fileUrl.startsWith(prefix)) return null;
  const relative = fileUrl.slice(prefix.length).replaceAll('\\', '/');
  const normalized = path.posix.normalize(relative);
  if (
    !normalized
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('\0')
    || !isAllowedPublicMediaExtension(path.posix.extname(normalized))
  ) return null;
  return normalized;
}

function normalizedIdentifier(value: string): string | null {
  const normalized = value.trim();
  return /^[a-zA-Z0-9_-]{1,128}$/.test(normalized) ? normalized : null;
}

function checksumFor(buffer: Buffer): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

function checksumMatches(buffer: Buffer, expected?: string | null): boolean {
  if (!expected) return true;
  const normalized = expected.trim().toLowerCase();
  if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(normalized)) return false;
  const expectedDigest = normalized.replace(/^sha256:/, '');
  return checksumFor(buffer).slice('sha256:'.length) === expectedDigest;
}

function isSupportedChecksum(expected?: string | null): boolean {
  return !expected || /^(?:sha256:)?[a-f0-9]{64}$/i.test(expected.trim());
}

function contentTypeForManagedPath(managedPath: string): string | null {
  const extension = path.posix.extname(managedPath).toLowerCase();
  return ({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
  } as Record<string, string>)[extension] ?? null;
}

function extensionForContentType(contentType?: string | null): string | null {
  return ({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
  } as Record<string, string>)[contentType?.trim().toLowerCase() || ''] ?? null;
}

function validateImage(
  buffer: Buffer,
  contentType: string,
  destinationPath: string,
  expectedChecksum?: string | null,
): { mimeType: string; checksum: string; byteSize: number } | null {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_RECOVERY_BYTES) return null;
  const mediaType = getSafeMediaTypeFromResponse(contentType, buffer, false);
  if (mediaType?.kind !== 'image') return null;
  const destinationExtension = path.posix.extname(destinationPath).slice(1).toLowerCase();
  const normalizedDestination = destinationExtension === 'jpeg' ? 'jpg' : destinationExtension;
  if (mediaType.extension !== normalizedDestination || !checksumMatches(buffer, expectedChecksum)) return null;
  return {
    mimeType: mediaType.mimeType,
    checksum: checksumFor(buffer),
    byteSize: buffer.byteLength,
  };
}

function resolveManagedPath(relativePath: string): string {
  const root = path.resolve(getServerDataRoot());
  const destination = path.resolve(root, ...relativePath.split('/'));
  const relativeToRoot = path.relative(root, destination);
  if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('Managed recovery path escapes the data root');
  }
  return destination;
}

async function writeManagedMedia(relativePath: string, buffer: Buffer): Promise<void> {
  const destination = resolveManagedPath(relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, buffer);
  await fs.rename(temporary, destination).catch(async (error) => {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  });
}

async function withStorageTimeout<T>(operation: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), STORAGE_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function executionMetadata(buffer: Buffer, mimeType: string) {
  return { checksum: checksumFor(buffer), mimeType, byteSize: buffer.byteLength };
}

export async function executeAssetMediaRecovery(
  target: AssetMediaRecoveryTarget,
): Promise<AssetMediaRecoveryExecution> {
  const managedPath = managedPathFromUrl(target.fileUrl);
  const versionId = normalizedIdentifier(target.assetVersionId);
  const attemptId = normalizedIdentifier(target.attemptId);
  if (!managedPath || !versionId || !attemptId) {
    return { success: false, method: 'none', retryable: false, error: 'No controlled media destination is available' };
  }

  const contentType = target.mimeType || contentTypeForManagedPath(managedPath);
  const extension = extensionForContentType(contentType);
  const validationPath = managedPath;
  if (!contentType || !extension) {
    return { success: false, method: 'none', retryable: false, error: 'No supported media type is available' };
  }
  if (!isSupportedChecksum(target.checksum)) {
    return { success: false, method: 'none', retryable: false, error: 'Asset version checksum is invalid' };
  }

  let localCandidate: { buffer: Buffer; mimeType: string } | null = null;
  try {
    const localBuffer = await fs.readFile(resolveManagedPath(managedPath));
    const local = validateImage(localBuffer, contentType, validationPath, target.checksum);
    if (local && isServerDataRootDurable()) {
      return {
        success: true,
        method: 'managed-storage',
        url: target.fileUrl,
        ...(target.storageKey ? { storageKey: target.storageKey } : {}),
        ...local,
      };
    }
    if (local) localCandidate = { buffer: localBuffer, mimeType: local.mimeType };
  } catch {
    // Continue to exact object storage and recovery source checks.
  }

  let exactManagedMediaInvalid = false;
  if (target.storageKey) {
    const exactKey = target.storageKey.replace(/^\/+/, '');
    const s3Buffer = await readImageFromS3Bounded(exactKey, MAX_RECOVERY_BYTES, STORAGE_TIMEOUT_MS);
    const s3Media = s3Buffer ? validateImage(s3Buffer, contentType, validationPath, target.checksum) : null;
    if (s3Buffer && s3Media) {
      return {
        success: true,
        method: 'managed-storage',
        url: `/api/serve-upload/recovery/${versionId}/${attemptId}.${extension}`,
        storageKey: exactKey,
        ...s3Media,
      };
    }
    exactManagedMediaInvalid = Boolean(s3Buffer && !s3Media);
  }

  if (localCandidate) {
    const candidatePath = `recovery/${versionId}/${attemptId}.${extension}`;
    await writeManagedMedia(candidatePath, localCandidate.buffer);
    const uploadedKey = await withStorageTimeout(uploadImageToS3(
      localCandidate.buffer,
      candidatePath,
      localCandidate.mimeType,
    ));
    const normalizedStorageKey = uploadedKey?.replace(/^\/+/, '') || null;
    if (normalizedStorageKey || isServerDataRootDurable()) {
      return {
        success: true,
        method: 'managed-storage',
        url: `/api/serve-upload/${candidatePath}`,
        ...(normalizedStorageKey ? { storageKey: normalizedStorageKey } : {}),
        ...executionMetadata(localCandidate.buffer, localCandidate.mimeType),
      };
    }
  }

  if (!target.recoverySourceUrl) {
    return {
      success: false,
      method: 'managed-storage',
      ...(exactManagedMediaInvalid ? { retryable: false } : {}),
      error: exactManagedMediaInvalid
        ? 'Managed media failed integrity validation and no recovery source is available'
        : 'Managed media and recovery source are unavailable',
    };
  }

  try {
    const downloaded = await downloadPublicImage(target.recoverySourceUrl, {
      maxBytes: MAX_RECOVERY_BYTES,
      timeoutMs: 30_000,
    });
    const mediaType = getSafeMediaTypeFromResponse(downloaded.mimeType, downloaded.buffer, false);
    if (mediaType?.kind !== 'image') {
      return { success: false, method: 'source-url', retryable: false, error: 'Recovery source is not a valid image' };
    }
    if (mediaType.extension !== extension) {
      return { success: false, method: 'source-url', retryable: false, error: 'Recovery source type does not match the managed destination' };
    }
    if (!checksumMatches(downloaded.buffer, target.checksum)) {
      return { success: false, method: 'source-url', retryable: false, error: 'Recovery source checksum does not match the asset version' };
    }

    const candidatePath = `recovery/${versionId}/${attemptId}.${mediaType.extension}`;
    await writeManagedMedia(candidatePath, downloaded.buffer);
    const uploadedKey = await withStorageTimeout(uploadImageToS3(
      downloaded.buffer,
      candidatePath,
      mediaType.mimeType,
    ));
    const normalizedStorageKey = uploadedKey?.replace(/^\/+/, '') || null;
    if (!normalizedStorageKey && !isServerDataRootDurable()) {
      return { success: false, method: 'source-url', error: 'Recovery output could not be persisted durably' };
    }
    return {
      success: true,
      method: 'source-url',
      url: `/api/serve-upload/${candidatePath}`,
      ...(normalizedStorageKey ? { storageKey: normalizedStorageKey } : {}),
      ...executionMetadata(downloaded.buffer, mediaType.mimeType),
    };
  } catch (error) {
    return {
      success: false,
      method: 'source-url',
      error: error instanceof Error ? error.message : 'Recovery source download failed',
    };
  }
}
