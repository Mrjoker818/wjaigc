import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getSafeMediaTypeFromResponse } from '@/lib/media-validation';
import { getServerDataRoot } from '@/lib/server-data-root';
import { readImageFromS3Bounded } from '@/lib/s3-storage';

import { withAssetCoreTransaction } from './storage';

const MAX_MEDIA_BYTES = 80 * 1024 * 1024;
const STORAGE_TIMEOUT_MS = 30_000;
const RECOVERY_PATH = /^recovery\/([a-zA-Z0-9_-]{1,128})\/([a-zA-Z0-9_-]{1,128})\.(png|jpe?g|webp|gif|bmp|avif)$/;

export interface ExactRecoveryMedia {
  buffer: Buffer;
  mimeType: string;
}

export class RecoveryMediaSizeLimitError extends Error {
  readonly code = 'RECOVERY_MEDIA_SIZE_LIMIT';

  constructor() {
    super('Recovery media exceeds the supplied byte limit');
    this.name = 'RecoveryMediaSizeLimitError';
  }
}

async function readExactLocalRecoveryMedia(relativePath: string, maxBytes?: number): Promise<Buffer | null> {
  const root = path.resolve(getServerDataRoot());
  const candidate = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  try {
    if (maxBytes !== undefined) {
      const handle = await fs.open(candidate, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size <= 0) return null;
        if (stat.size > maxBytes) throw new RecoveryMediaSizeLimitError();
        const chunks: Buffer[] = [];
        let total = 0;
        while (true) {
          const readSize = Math.min(64 * 1024, maxBytes - total + 1);
          const chunk = Buffer.allocUnsafe(readSize);
          const { bytesRead } = await handle.read(chunk, 0, readSize, null);
          if (bytesRead === 0) break;
          total += bytesRead;
          if (total > maxBytes) throw new RecoveryMediaSizeLimitError();
          chunks.push(chunk.subarray(0, bytesRead));
        }
        return Buffer.concat(chunks, total);
      } finally {
        await handle.close();
      }
    }
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MEDIA_BYTES) return null;
    return await fs.readFile(candidate);
  } catch (error) {
    if (error instanceof RecoveryMediaSizeLimitError) throw error;
    return null;
  }
}

export async function readExactRecoveryMedia(relativePath: string, maxBytes?: number): Promise<ExactRecoveryMedia | null> {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) {
    throw new TypeError('maxBytes must be a positive safe integer');
  }
  const effectiveMaxBytes = maxBytes === undefined ? MAX_MEDIA_BYTES : Math.min(MAX_MEDIA_BYTES, maxBytes);
  const match = RECOVERY_PATH.exec(relativePath);
  if (!match) return null;
  const fileUrl = `/api/serve-upload/${relativePath}`;
  const version = await withAssetCoreTransaction(async (client) => {
    const result = await client.query<{
      storage_key: string | null;
      checksum: string | null;
      mime_type: string | null;
      byte_size: string | null;
    }>(
      `SELECT storage_key, checksum, mime_type, byte_size::text
       FROM wujie_asset_versions
       WHERE id = $1 AND file_url = $2 AND availability = 'ready'`,
      [match[1], fileUrl],
    );
    return result.rows[0] ?? null;
  }, undefined, 'none');
  if (!version?.mime_type) return null;
  const declaredBytes = Number(version.byte_size || 0);
  if (maxBytes !== undefined && Number.isFinite(declaredBytes) && declaredBytes > effectiveMaxBytes) {
    throw new RecoveryMediaSizeLimitError();
  }
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_MEDIA_BYTES) return null;
  let storageBuffer: Buffer | null = null;
  if (version.storage_key) {
    const key = version.storage_key.replace(/^\/+/, '');
    if (maxBytes === undefined) {
      storageBuffer = await readImageFromS3Bounded(key, MAX_MEDIA_BYTES, STORAGE_TIMEOUT_MS);
    } else {
      try {
        storageBuffer = await readImageFromS3Bounded(
          key, effectiveMaxBytes, STORAGE_TIMEOUT_MS, { strict: true },
        );
        if (storageBuffer && storageBuffer.byteLength > effectiveMaxBytes) {
          throw new RecoveryMediaSizeLimitError();
        }
      } catch (error) {
        if (error instanceof RecoveryMediaSizeLimitError) throw error;
        if (error instanceof Error && 'code' in error && error.code === 'S3_READ_SIZE_LIMIT') {
          throw new RecoveryMediaSizeLimitError();
        }
        // A non-size S3 failure still permits the exact local attempt fallback.
      }
    }
  }
  const buffer = storageBuffer ?? await readExactLocalRecoveryMedia(relativePath,
    maxBytes === undefined ? undefined : effectiveMaxBytes);
  if (buffer && maxBytes !== undefined && buffer.byteLength > effectiveMaxBytes) {
    throw new RecoveryMediaSizeLimitError();
  }
  if (!buffer || (declaredBytes > 0 && buffer.byteLength !== declaredBytes)) return null;
  const mediaType = getSafeMediaTypeFromResponse(version.mime_type, buffer, false);
  if (!mediaType || mediaType.kind !== 'image') return null;
  if (version.checksum) {
    const normalized = version.checksum.trim().toLowerCase();
    if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(normalized)) return null;
    const actual = createHash('sha256').update(buffer).digest('hex');
    if (actual !== normalized.replace(/^sha256:/, '')) return null;
  }
  return { buffer, mimeType: mediaType.mimeType };
}
