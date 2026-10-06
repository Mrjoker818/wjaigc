/**
 * Shared image buffer fetching utility.
 * Handles data URLs, local paths, S3, and external URLs.
 * Extracted from image-edit/route.ts for reuse in poll-task and other routes.
 */

import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { exportMediaDescriptor } from '@/lib/asset-core/binary-media-contract';
import { isAllowedPublicMediaExtension } from '@/lib/media-validation';

export class ImageEditInputTooLargeError extends Error {
  readonly code = 'IMAGE_EDIT_INPUT_TOO_LARGE';

  constructor() {
    super('图片输入超过大小限制');
    this.name = 'ImageEditInputTooLargeError';
  }
}

function assertBounded(buffer: Buffer, maxBytes: number): Buffer {
  if (buffer.byteLength > maxBytes) throw new ImageEditInputTooLargeError();
  return buffer;
}

async function readLocalFile(filePath: string, maxBytes: number | undefined): Promise<Buffer> {
  if (maxBytes === undefined) return await fs.readFile(filePath);
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size > maxBytes) throw new ImageEditInputTooLargeError();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const readSize = Math.min(64 * 1024, maxBytes - total + 1);
      const chunk = Buffer.allocUnsafe(readSize);
      const { bytesRead } = await handle.read(chunk, 0, readSize, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new ImageEditInputTooLargeError();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

async function readHttpResponse(response: Response, maxBytes: number | undefined): Promise<Buffer> {
  if (maxBytes === undefined) return Buffer.from(await response.arrayBuffer());
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ImageEditInputTooLargeError();
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new ImageEditInputTooLargeError();
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function normalizeLocalImagePath(url: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    throw new Error('Unsafe local image path');
  }

  const pathname = decoded.split(/[?#]/, 1)[0];
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')) {
    throw new Error('Unsafe local image path');
  }

  const relativePath = pathname
    .replace(/^\/api\/serve-upload\//, '')
    .replace(/^\/+/, '');
  const segments = relativePath.split('/');
  if (!relativePath || ['system', 'users'].includes(segments[0].toLowerCase())
    || (segments[0].toLowerCase() === 'exports' && segments[0] !== 'exports')
    || segments.some(segment => !segment || segment.includes('..')
      || !/^[a-zA-Z0-9._-]+$/.test(segment))
    || !isAllowedPublicMediaExtension(path.extname(segments[segments.length - 1]))) {
    throw new Error('Unsafe local image path');
  }
  if (segments[0] === 'exports' && (segments.length !== 2
    || !exportMediaDescriptor(segments[1])?.mimeType.startsWith('image/'))) {
    throw new Error('Unsafe local image path');
  }
  return segments.join('/');
}

function resolveInsideDirectory(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Unsafe local image path');
  }
  return resolvedPath;
}

/**
 * Fetch an image as a Buffer from various URL types:
 * - data:image/...;base64,...
 * - /api/serve-upload/xxx, /uploads/xxx (local paths)
 * - https://... (external URLs)
 */
export async function fetchImageBuffer(url: string, options?: { maxBytes: number }): Promise<Buffer> {
  const maxBytes = options?.maxBytes;
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) {
    throw new TypeError('maxBytes must be a positive safe integer');
  }
  // data URL
  if (url.startsWith('data:')) {
    const matches = url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (matches) {
      if (maxBytes !== undefined && Buffer.byteLength(matches[2], 'base64') > maxBytes) {
        throw new ImageEditInputTooLargeError();
      }
      const buffer = Buffer.from(matches[2], 'base64');
      return maxBytes === undefined ? buffer : assertBounded(buffer, maxBytes);
    }
    throw new Error('Invalid data URL format');
  }
  // blob URL - cannot be resolved server-side
  if (url.startsWith('blob:')) {
    throw new Error('Blob URLs cannot be processed server-side');
  }
  if (/^https?:\/\//i.test(url)) {
    const parsed = new URL(url);
    const localPort = String(process.env.DEPLOY_RUN_PORT || 5000);
    if (!parsed.username && !parsed.password && parsed.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.port === localPort
      && (parsed.pathname.startsWith('/api/serve-upload/') || parsed.pathname.startsWith('/uploads/'))) {
      return fetchImageBuffer(parsed.pathname, options);
    }
  }
  // local path (e.g., /api/serve-upload/xxx, /uploads/xxx)
  if (url.startsWith('/')) {
    const relativePath = normalizeLocalImagePath(url);
    if (relativePath.startsWith('recovery/')) {
      const { readExactRecoveryMedia } = await import('@/lib/asset-core/recovery-media');
      let recovery;
      try {
        recovery = maxBytes === undefined
          ? await readExactRecoveryMedia(relativePath)
          : await readExactRecoveryMedia(relativePath, maxBytes);
      } catch (error) {
        if (maxBytes !== undefined && error instanceof Error && 'code' in error
          && error.code === 'RECOVERY_MEDIA_SIZE_LIMIT') throw new ImageEditInputTooLargeError();
        throw error;
      }
      if (recovery) return maxBytes === undefined ? recovery.buffer : assertBounded(recovery.buffer, maxBytes);
      throw new Error('Recovered media is unavailable or failed validation');
    }
    if (relativePath.startsWith('exports/')) {
      const filename = relativePath.slice('exports/'.length);
      const descriptor = exportMediaDescriptor(filename);
      if (!descriptor || !descriptor.mimeType.startsWith('image/')) throw new Error('Unsafe local image path');
      const limit = Math.min(maxBytes ?? 50 * 1024 * 1024, 50 * 1024 * 1024);
      const deadline = AbortSignal.timeout(30_000);
      const { getServerDataRoot } = await import('@/lib/server-data-root');
      const { readServeUploadExportLocal } = await import('@/lib/serve-upload-local-storage');
      let bytes = await readServeUploadExportLocal(getServerDataRoot(), filename, limit);
      if (!bytes) {
        const { readBinaryFromS3Exact } = await import('@/lib/s3-storage');
        bytes = await readBinaryFromS3Exact(`exports/${filename}`, { maxBytes: limit, timeoutMs: 5000, signal: deadline });
      }
      if (!bytes) throw new Error('Export image is unavailable');
      const { validateExportAssetBytes } = await import('@/lib/asset-core/binary-persistence');
      await validateExportAssetBytes({ bytes, filename, mimeType: descriptor.mimeType, signal: deadline });
      deadline.throwIfAborted();
      return bytes;
    }
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    const localPath = resolveInsideDirectory(path.join(workspacePath, 'public'), relativePath);
    if (fsSync.existsSync(localPath)) return await readLocalFile(localPath, maxBytes);
    const { getServerDataRoot } = await import('@/lib/server-data-root');
    const dataRoot = await getServerDataRoot();
    const persistentPath = resolveInsideDirectory(dataRoot, relativePath);
    if (fsSync.existsSync(persistentPath)) return await readLocalFile(persistentPath, maxBytes);
    const uploadPath = resolveInsideDirectory(path.join(dataRoot, 'uploads'), path.basename(relativePath));
    if (fsSync.existsSync(uploadPath)) return await readLocalFile(uploadPath, maxBytes);
    // 3. Try S3 object storage fallback (short timeout, try both 'images/' and 'uploads/' prefixes)
    const { isS3Available, downloadImageFromS3, readImageFromS3Bounded, S3BoundedReadError } = await import('@/lib/s3-storage');
    if (isS3Available()) {
      try {
        for (const prefix of ['images/', 'uploads/']) {
          const s3Key = `${prefix}${relativePath}`;
          const s3Buffer = maxBytes === undefined
            ? await Promise.race([
              downloadImageFromS3(s3Key),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
            ])
            : await readImageFromS3Bounded(s3Key, maxBytes, 5000, { strict: true });
          if (s3Buffer) return maxBytes === undefined ? s3Buffer : assertBounded(s3Buffer, maxBytes);
        }
      } catch (error) {
        if (error instanceof ImageEditInputTooLargeError) throw error;
        if (error instanceof S3BoundedReadError && error.code === 'S3_READ_SIZE_LIMIT') {
          throw new ImageEditInputTooLargeError();
        }
        // Other storage failures retain the original fallback behavior.
      }
    }
    // 4. Try source URL mapping with a pinned, bounded public download.
    const filename = relativePath;
    try {
      const { getImageSourceUrl } = await import('@/lib/image-source-map');
      const sourceUrl = await getImageSourceUrl(filename);
      if (sourceUrl) {
        const { downloadPublicImage, SafeImageDownloadError } = await import('@/lib/safe-image-download');
        try {
          const deadline = AbortSignal.timeout(5000);
          const { buffer, mimeType } = await downloadPublicImage(sourceUrl, {
            maxBytes: Math.min(maxBytes ?? 50 * 1024 * 1024, 50 * 1024 * 1024),
            timeoutMs: 5000,
            signal: deadline,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'],
          });
          const { getSafeMediaTypeFromResponse } = await import('@/lib/media-validation');
          const safeMedia = getSafeMediaTypeFromResponse(mimeType, buffer, false);
          const expectedExtension = path.extname(filename).toLowerCase().slice(1);
          if (!safeMedia || (safeMedia.extension !== expectedExtension
            && !(safeMedia.extension === 'jpg' && expectedExtension === 'jpeg'))) {
            throw new Error('Source-map image does not match its saved path');
          }
          const { validateRecoveredSourceMedia } = await import('@/lib/asset-core/binary-media-validation');
          await validateRecoveredSourceMedia(buffer, safeMedia.mimeType, deadline);
          deadline.throwIfAborted();
          // Re-save to local for future use.
          try {
            const cachePath = resolveInsideDirectory(dataRoot, filename);
            await fs.mkdir(path.dirname(cachePath), { recursive: true });
            await fs.writeFile(cachePath, buffer);
          } catch { /* ignore save failure */ }
          return buffer;
        } catch (error) {
          if (error instanceof ImageEditInputTooLargeError) throw error;
          if (error instanceof SafeImageDownloadError && error.message === 'Remote image exceeds the size limit') {
            throw new ImageEditInputTooLargeError();
          }
          // Ignore other re-download failures.
        }
      }
    } catch (error) {
      if (error instanceof ImageEditInputTooLargeError) throw error;
      // Ignore other source-map failures.
    }
    // 5. Try localhost fetch (serve-upload API, 3s timeout)
    try {
      const port = process.env.DEPLOY_RUN_PORT || 5000;
      const res = await fetch(`http://localhost:${port}${url}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return await readHttpResponse(res, maxBytes);
    } catch (error) {
      if (error instanceof ImageEditInputTooLargeError) throw error;
      // Localhost is unavailable.
    }
    // 6. Try current domain fetch (3s timeout)
    try {
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
      if (domain) {
        const domainBase = domain.replace(/\/+$/, '');
        const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
        const fullUrl = `${base}${url}`;
        const domainRes = await fetch(fullUrl, { signal: AbortSignal.timeout(3000) });
        if (domainRes.ok) return await readHttpResponse(domainRes, maxBytes);
      }
    } catch (error) {
      if (error instanceof ImageEditInputTooLargeError) throw error;
      // Domain is unavailable.
    }
    throw new Error(`无法获取原始图片：文件已过期或不存在，请重新生成图片`);
  }
  // external URL
  const { downloadPublicImage, SafeImageDownloadError } = await import('@/lib/safe-image-download');
  const deadline = AbortSignal.timeout(30_000);
  let downloaded;
  try {
    downloaded = await downloadPublicImage(url, {
      maxBytes: Math.min(maxBytes ?? 50 * 1024 * 1024, 50 * 1024 * 1024),
      timeoutMs: 30_000,
      signal: deadline,
      allowedMimeTypes: [
        'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp',
        'application/octet-stream',
      ],
      allowMissingContentTypeAsOctetStream: true,
    });
  } catch (error) {
    if (error instanceof SafeImageDownloadError && error.message === 'Remote image exceeds the size limit') {
      throw new ImageEditInputTooLargeError();
    }
    throw error;
  }
  const { getSafeMediaTypeFromResponse, inferSafeRasterImageType } = await import('@/lib/media-validation');
  const safeMedia = downloaded.mimeType === 'application/octet-stream'
    ? inferSafeRasterImageType(downloaded.buffer)
    : getSafeMediaTypeFromResponse(downloaded.mimeType, downloaded.buffer, false);
  if (!safeMedia) throw new Error('Remote image has invalid media content');
  const { validateRecoveredSourceMedia } = await import('@/lib/asset-core/binary-media-validation');
  await validateRecoveredSourceMedia(downloaded.buffer, safeMedia.mimeType, deadline);
  deadline.throwIfAborted();
  return downloaded.buffer;
}
