/**
 * Shared image buffer fetching utility.
 * Handles data URLs, local paths, S3, and external URLs.
 * Extracted from image-edit/route.ts for reuse in poll-task and other routes.
 */

import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';

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
    // Sanitize path to prevent directory traversal attacks
    // ★ 先 decodeURIComponent 再过滤，防止 %2e%2e%2f 绕过
    const decoded = decodeURIComponent(url);
    const sanitizedUrl = decoded.replace(/\.\./g, '').replace(/\/\//g, '/');
    // Strip /api/serve-upload/ prefix to get the actual file path
    // e.g., /api/serve-upload/uploads/gen-xxx.png → uploads/gen-xxx.png
    const relativePath = sanitizedUrl.replace(/^\/api\/serve-upload\//, '').replace(/^\//, '');
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    // 1. Try local public directory (dev)
    const localPath = path.normalize(path.join(workspacePath, 'public', sanitizedUrl));
    const allowedPublicDir = path.normalize(path.join(workspacePath, 'public'));
    if (localPath.startsWith(allowedPublicDir) && fsSync.existsSync(localPath)) return await fs.readFile(localPath);
    // 2. Try persistent data directory (using stripped path for correct resolution)
    const { getServerDataRoot } = await import('@/lib/server-data-root');
    const dataRoot = await getServerDataRoot();
    const normalizedDataRoot = path.normalize(dataRoot);
    // Try with stripped /api/serve-upload/ prefix (correct mapping)
    const persistentPath = path.normalize(path.join(dataRoot, relativePath));
    if (persistentPath.startsWith(normalizedDataRoot) && fsSync.existsSync(persistentPath)) return await fs.readFile(persistentPath);
    // Fallback: try exact sanitizedUrl under dataRoot (for other path patterns)
    const fallbackPath = path.normalize(path.join(dataRoot, sanitizedUrl.replace(/^\//, '')));
    if (fallbackPath.startsWith(normalizedDataRoot) && fsSync.existsSync(fallbackPath)) return await fs.readFile(fallbackPath);
    // Try uploads/ prefix under dataRoot (legacy pattern)
    const uploadPath = path.normalize(path.join(dataRoot, 'uploads', path.basename(sanitizedUrl)));
    if (uploadPath.startsWith(normalizedDataRoot) && fsSync.existsSync(uploadPath)) return await fs.readFile(uploadPath);
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
