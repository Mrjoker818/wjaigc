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

async function readExactLocalRecoveryMedia(relativePath: string): Promise<Buffer | null> {
  const root = path.resolve(getServerDataRoot());
  const candidate = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MEDIA_BYTES) return null;
    return await fs.readFile(candidate);
  } catch {
    return null;
  }
}

export async function readExactRecoveryMedia(relativePath: string): Promise<ExactRecoveryMedia | null> {
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
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_MEDIA_BYTES) return null;
  const storageBuffer = version.storage_key
    ? await readImageFromS3Bounded(
      version.storage_key.replace(/^\/+/, ''),
      MAX_MEDIA_BYTES,
      STORAGE_TIMEOUT_MS,
    )
    : null;
  const buffer = storageBuffer ?? await readExactLocalRecoveryMedia(relativePath);
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
