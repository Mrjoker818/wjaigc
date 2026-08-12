/**
 * Shared image buffer fetching utility.
 * Handles data URLs, local paths, S3, and external URLs.
 * Extracted from image-edit/route.ts for reuse in poll-task and other routes.
 */

import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';

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
  if (!relativePath || segments.some(segment => !segment || segment === '.' || segment === '..')) {
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
export async function fetchImageBuffer(url: string): Promise<Buffer> {
  // data URL
  if (url.startsWith('data:')) {
    const matches = url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (matches) return Buffer.from(matches[2], 'base64');
    throw new Error('Invalid data URL format');
  }
  // blob URL - cannot be resolved server-side
  if (url.startsWith('blob:')) {
    throw new Error('Blob URLs cannot be processed server-side');
  }
  // local path (e.g., /api/serve-upload/xxx, /uploads/xxx)
  if (url.startsWith('/')) {
    const relativePath = normalizeLocalImagePath(url);
    if (relativePath.startsWith('recovery/')) {
      const { readExactRecoveryMedia } = await import('@/lib/asset-core/recovery-media');
      const recovery = await readExactRecoveryMedia(relativePath);
      if (recovery) return recovery.buffer;
      throw new Error('Recovered media is unavailable or failed validation');
    }
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    const localPath = resolveInsideDirectory(path.join(workspacePath, 'public'), relativePath);
    if (fsSync.existsSync(localPath)) return await fs.readFile(localPath);
    const { getServerDataRoot } = await import('@/lib/server-data-root');
    const dataRoot = await getServerDataRoot();
    const persistentPath = resolveInsideDirectory(dataRoot, relativePath);
    if (fsSync.existsSync(persistentPath)) return await fs.readFile(persistentPath);
    const uploadPath = resolveInsideDirectory(path.join(dataRoot, 'uploads'), path.basename(relativePath));
    if (fsSync.existsSync(uploadPath)) return await fs.readFile(uploadPath);
    // 3. Try S3 object storage fallback (short timeout, try both 'images/' and 'uploads/' prefixes)
    const { isS3Available, downloadImageFromS3 } = await import('@/lib/s3-storage');
    if (isS3Available()) {
      try {
        for (const prefix of ['images/', 'uploads/']) {
          const s3Key = `${prefix}${relativePath}`;
          const s3Buffer = await Promise.race([
            downloadImageFromS3(s3Key),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
          ]);
          if (s3Buffer) return s3Buffer;
        }
      } catch { /* S3 failure, continue */ }
    }
    // 4. Try source URL mapping (re-download from original external URL, 5s timeout)
    const filename = relativePath;
    try {
      const { getImageSourceUrl } = await import('@/lib/image-source-map');
      const sourceUrl = await getImageSourceUrl(filename);
      if (sourceUrl) {
        console.log(`[fetchImageBuffer] Re-downloading from source: ${sourceUrl.substring(0, 80)}...`);
        try {
          const srcRes = await fetch(sourceUrl, { signal: AbortSignal.timeout(5000) });
          if (srcRes.ok) {
            const buffer = Buffer.from(await srcRes.arrayBuffer());
            // Re-save to local for future use
            try {
              const dir = path.join(dataRoot, 'uploads');
              await fs.mkdir(dir, { recursive: true });
              await fs.writeFile(path.join(dir, filename), buffer);
            } catch { /* ignore save failure */ }
            return buffer;
          }
        } catch { /* ignore re-download failure */ }
      }
    } catch { /* ignore source map failure */ }
    // 5. Try localhost fetch (serve-upload API, 3s timeout)
    try {
      const port = process.env.DEPLOY_RUN_PORT || 5000;
      const res = await fetch(`http://localhost:${port}${url}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch { /* localhost not available */ }
    // 6. Try current domain fetch (3s timeout)
    try {
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
      if (domain) {
        const domainBase = domain.replace(/\/+$/, '');
        const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
        const fullUrl = `${base}${url}`;
        const domainRes = await fetch(fullUrl, { signal: AbortSignal.timeout(3000) });
        if (domainRes.ok) return Buffer.from(await domainRes.arrayBuffer());
      }
    } catch { /* domain not available */ }
    throw new Error(`无法获取原始图片：文件已过期或不存在，请重新生成图片`);
  }
  // external URL
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
