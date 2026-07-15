/**
 * S3 对象存储工具模块
 * 
 * 将图片持久化到 S3 对象存储，解决重新部署后本地文件丢失的问题。
 * 
 * 存储策略：
 * - 新图片：上传到 S3，返回 S3 key + presigned URL
 * - 旧图片：本地路径作为 key 查找 S3，找不到则回退到文件系统
 * - Key 格式：images/{filename}
 * 
 * 使用规范：
 * - 持久化存储 key（而非 URL），URL 随时可通过 key 重新生成
 * - 禁止自行拼接 URL，必须使用 generatePresignedUrl
 */

import { S3Storage } from 'coze-coding-dev-sdk';
import { saveImageDataMapping } from './image-source-map';

let _storage: S3Storage | null = null;

function getStorage(): S3Storage | null {
  if (_storage) return _storage;
  
  const endpointUrl = process.env.COZE_BUCKET_ENDPOINT_URL;
  const bucketName = process.env.COZE_BUCKET_NAME;
  // SDK supports empty accessKey/secretKey — it will auto-resolve credentials via workload identity
  const accessKey = process.env.COZE_BUCKET_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || '';
  const secretKey = process.env.COZE_BUCKET_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
  
  if (!endpointUrl || !bucketName) {
    console.warn('[s3-storage] S3 not configured: missing COZE_BUCKET_ENDPOINT_URL or COZE_BUCKET_NAME');
    return null;
  }
  
  try {
    _storage = new S3Storage({
      endpointUrl,
      accessKey,
      secretKey,
      bucketName,
      region: process.env.COZE_BUCKET_REGION || 'cn-beijing',
    });
    console.log(`[s3-storage] S3 initialized. Bucket: ${bucketName}, accessKey: ${accessKey ? 'provided' : 'auto-resolve'}`);
    return _storage;
  } catch (e) {
    console.error('[s3-storage] Failed to initialize S3:', e);
    return null;
  }
}

/** Check if S3 storage is available */
export function isS3Available(): boolean {
  return getStorage() !== null;
}

/**
 * Upload image buffer to S3
 * @returns S3 key if successful, null if failed
 */
export async function uploadImageToS3(
  buffer: Buffer,
  fileName: string,
  contentType: string = 'image/png'
): Promise<string | null> {
  const storage = getStorage();
  if (!storage) return null;
  
  try {
    // Sanitize filename for S3 key
    const safeName = fileName.replace(/[^a-zA-Z0-9._\-/]/g, '_');
    const key = await storage.uploadFile({
      fileContent: buffer,
      fileName: `images/${safeName}`,
      contentType,
    });
    console.log(`[s3-storage] Uploaded: ${key} (${(buffer.length / 1024).toFixed(0)}KB)`);
    // Return path with leading slash so URL concatenation (domainBase + savedPath) always works
    return key.startsWith('/') ? key : `/${key}`;
  } catch (e) {
    console.error('[s3-storage] Upload failed:', e);
    return null;
  }
}

/**
 * Upload image from URL to S3
 * @returns S3 key if successful, null if failed
 */
export async function uploadImageFromUrlToS3(url: string): Promise<string | null> {
  const storage = getStorage();
  if (!storage) return null;
  
  try {
    const key = await storage.uploadFromUrl({
      url,
      timeout: 30000,
    });
    console.log(`[s3-storage] Uploaded from URL: ${key}`);
    return key.startsWith('/') ? key : `/${key}`;
  } catch (e) {
    console.error('[s3-storage] Upload from URL failed:', e);
    return null;
  }
}

/**
 * Generate a presigned URL for an S3 key
 * @param key S3 object key
 * @param expireTime URL expiry in seconds (default 7 days)
 * @returns presigned URL or null
 */
export async function getS3PresignedUrl(
  key: string,
  expireTime: number = 604800 // 7 days
): Promise<string | null> {
  const storage = getStorage();
  if (!storage) return null;
  
  try {
    const url = await storage.generatePresignedUrl({ key, expireTime });
    return url;
  } catch (e) {
    console.error(`[s3-storage] Failed to generate presigned URL for ${key}:`, e);
    return null;
  }
}

/**
 * Read image from S3 by key
 * @returns Buffer or null
 */
export async function readImageFromS3(key: string): Promise<Buffer | null> {
  const storage = getStorage();
  if (!storage) return null;
  
  try {
    const data = await storage.readFile({ fileKey: key });
    return Buffer.from(data);
  } catch (e) {
    console.error(`[s3-storage] Failed to read ${key}:`, e);
    return null;
  }
}

/**
 * Check if a file exists in S3
 */
export async function s3FileExists(key: string): Promise<boolean> {
  const storage = getStorage();
  if (!storage) return false;
  
  try {
    // SDK uploadFile adds hash suffix, so exact match may fail
    // Use listFiles with prefix to find matching files
    const baseName = key.replace(/\.[^.]+$/, ''); // e.g. "images/gen-123" from "images/gen-123.jpg"
    const result = await storage.listFiles({ prefix: baseName });
    const keys: string[] = result?.keys || [];
    // Check if any key starts with our baseName (ignoring hash suffix)
    return keys.some(k => {
      const kBase = k.replace(/\.[^.]+$/, '');
      return kBase === baseName || k.startsWith(baseName + '_');
    });
  } catch {
    return false;
  }
}

/**
 * Find the actual S3 key for a filename (accounting for hash suffix added by SDK)
 * e.g. deriveS3Key gives "images/gen-123.jpg", but actual key may be "images/gen-123_49b583ab.jpg"
 */
export async function resolveS3Key(baseKey: string): Promise<string | null> {
  const storage = getStorage();
  if (!storage) return null;

  try {
    // First try exact match (fast path for files uploaded without hash)
    const exists = await storage.fileExists({ fileKey: baseKey });
    if (exists) return baseKey;

    // Extract base name without extension for prefix search
    const lastDot = baseKey.lastIndexOf('.');
    const prefix = lastDot > 0 ? baseKey.substring(0, lastDot) : baseKey;
    const ext = lastDot > 0 ? baseKey.substring(lastDot) : '';

    // List files with prefix to find hash-suffixed version
    const result = await storage.listFiles({ prefix });
    const keys: string[] = result?.keys || [];

    // Find key that matches: prefix + _hash + ext
    for (const k of keys) {
      const kLastDot = k.lastIndexOf('.');
      const kBase = kLastDot > 0 ? k.substring(0, kLastDot) : k;
      const kExt = kLastDot > 0 ? k.substring(kLastDot) : '';
      if (kExt === ext && (kBase === prefix || kBase.startsWith(prefix + '_'))) {
        return k;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Derive an S3 key from a local filename/path
 * e.g. "/api/serve-upload/gen-123.jpg" → "images/gen-123.jpg"
 * e.g. "gen-123.jpg" → "images/gen-123.jpg"
 */
export function deriveS3Key(localPath: string): string {
  // Normalize: strip leading slashes/slashes, keep subdirectory structure
  const normalized = localPath.replace(/^\/+/, '');
  // If already starts with images/, use as-is
  if (normalized.startsWith('images/')) return normalized;
  // Otherwise prefix with images/
  return `images/${normalized}`;
}

/**
 * Get presigned URL for a local image by deriving its S3 key
 * Used as fallback when local file is not found
 */
export async function getS3FallbackUrl(localPath: string): Promise<string | null> {
  const key = deriveS3Key(localPath);
  const exists = await s3FileExists(key);
  if (exists) {
    const resolvedKey = await resolveS3Key(key);
    if (resolvedKey) return getS3PresignedUrl(resolvedKey);
  }
  
  // Fallback: try with just the basename
  const basename = localPath.split('/').pop() || localPath;
  if (basename !== localPath) {
    const basenameKey = `images/${basename}`;
    const basenameExists = await s3FileExists(basenameKey);
    if (basenameExists) {
      const basenameResolvedKey = await resolveS3Key(basenameKey);
      if (basenameResolvedKey) return getS3PresignedUrl(basenameResolvedKey);
    }
  }
  
  return null;
}

/**
 * Download image buffer from S3 by filename
 * Alias for readImageFromS3 with key derivation
 */
export async function downloadImageFromS3(filenameOrPath: string): Promise<Buffer | null> {
  // Try with full relative path first (preserves subdirectory like uploads/)
  const key = deriveS3Key(filenameOrPath);
  const resolvedKey = await resolveS3Key(key);
  if (resolvedKey) return readImageFromS3(resolvedKey);
  
  // Fallback: try with just the basename (old format without subdirectory)
  const basename = filenameOrPath.split('/').pop() || filenameOrPath;
  if (basename !== filenameOrPath) {
    const basenameKey = `images/${basename}`;
    const basenameResolvedKey = await resolveS3Key(basenameKey);
    if (basenameResolvedKey) return readImageFromS3(basenameResolvedKey);
  }
  
  return null;
}

/**
 * Get presigned URL for an image by filename
 * Used in generate route for reference image URL resolution
 */
export async function getS3ImageUrl(filenameOrPath: string): Promise<string | null> {
  // Try with full relative path first (preserves subdirectory like uploads/)
  const key = deriveS3Key(filenameOrPath);
  const resolvedKey = await resolveS3Key(key);
  if (resolvedKey) return getS3PresignedUrl(resolvedKey);
  
  // Fallback: try with just the basename (old format without subdirectory)
  const basename = filenameOrPath.split('/').pop() || filenameOrPath;
  if (basename !== filenameOrPath) {
    const basenameKey = `images/${basename}`;
    const basenameResolvedKey = await resolveS3Key(basenameKey);
    if (basenameResolvedKey) return getS3PresignedUrl(basenameResolvedKey);
  }
  
  return null;
}

/**
 * 检测图片是否包含真正的透明像素（alpha < 255）
 *
 * 仅检查 hasAlpha/channel 数不够：很多 PNG 以 RGBA 模式存储但所有 alpha=255（完全不透明），
 * 这种情况可以安全转 JPEG，而不会丢失任何透明信息。
 *
 * @param imageBuffer 图片 Buffer
 * @returns true 表示图片中有至少一个半透明/全透明像素，不可转 JPEG
 */
async function hasRealTransparency(imageBuffer: Buffer): Promise<boolean> {
  try {
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(imageBuffer).metadata();

    // 没有 alpha 通道，肯定不透明
    if (!metadata.hasAlpha && metadata.channels !== 4) {
      return false;
    }

    // 有 alpha 通道，提取 alpha 通道数据检查是否有非 255 值
    const { data, info } = await sharp(imageBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 只检查 RGBA 格式（channels=4）
    if (info.channels !== 4) {
      return false;
    }

    // 采样检测 alpha 通道（每 4 字节第 4 个是 alpha）
    // 为性能考虑，大图采样检测
    const totalPixels = info.width * info.height;
    const step = totalPixels > 4000000 ? Math.floor(totalPixels / 100000) : (totalPixels > 1000000 ? 16 : 4);
    for (let i = 0; i < totalPixels; i += step) {
      const offset = i * 4 + 3; // alpha 通道偏移
      if (offset < data.length && data[offset] < 255) {
        return true; // 发现透明像素
      }
    }

    return false; // 所有采样 alpha 均为 255，无真正透明
  } catch {
    // 检测失败时保守处理，假定有透明
    return true;
  }
}

/**
 * Persist a remote/base64 image: download → save local + upload S3 → return stable URL
 * 
 * This is the core function for ensuring images survive redeployment.
 * - Downloads the image from a remote URL or decodes from base64 data URL
 * - Saves to local public/uploads/ directory
 * - Uploads to S3 for long-term storage
 * - Returns the local serve-upload URL (/api/serve-upload/filename)
 * 
 * @param imageUrl Remote URL or base64 data URL
 * @param subfolder Optional subfolder (e.g. "generate/taskId")
 * @returns Stable local URL (/api/serve-upload/...) or null on failure
 */
export async function persistRemoteImage(
  imageUrl: string,
  subfolder: string = ''
): Promise<string | null> {
  await import('path');
  await import('fs/promises');
  const { getServerDataRoot } = await import('./server-data-root');
  getServerDataRoot();
  
  try {
    let imageBuffer: Buffer;
    let ext = '.png';
    let contentType = 'image/png';
    
    if (imageUrl.startsWith('data:')) {
      // Base64 data URL
      const match = imageUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
      if (!match) {
        console.warn('[s3-storage] Invalid data URL format');
        return null;
      }
      ext = match[1] === 'jpeg' ? '.jpg' : `.${match[1]}`;
      contentType = `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}`;
      imageBuffer = Buffer.from(match[2], 'base64');
    } else {
      // Remote URL - download (2min timeout for large 4K images)
      const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(120000) });
      if (!resp.ok) {
        console.warn(`[s3-storage] Failed to download ${imageUrl}: ${resp.status}`);
        return null;
      }
      imageBuffer = Buffer.from(await resp.arrayBuffer());
      
      // Compress extremely large images (>15MB) to reduce storage and improve browser loading
      // Note: DO NOT downscale - preserve original resolution for quality
      // 4K images (typically 5-12MB as PNG) should NOT be compressed to preserve detail
      let wasCompressedAsPng = false;
      let wasCompressedAsJpeg = false;
      if (imageBuffer.length > 15 * 1024 * 1024) {
        try {
          const sharp = (await import('sharp')).default;
          const metadata = await sharp(imageBuffer).metadata();
          const sizeMB = imageBuffer.length / (1024 * 1024);

          // 检测是否真正有透明像素（而非仅 hasAlpha 标记）
          const reallyHasTransparency = await hasRealTransparency(imageBuffer);

          if (reallyHasTransparency) {
            // 有真正透明像素 — 必须保留 PNG 格式，仅优化压缩
            imageBuffer = await sharp(imageBuffer)
              .png({ quality: 90, compressionLevel: 9, palette: true, effort: 8 })
              .toBuffer();
            wasCompressedAsPng = true;
            console.log(`[s3-storage] Re-compressed PNG (has transparency): ${metadata.width}x${metadata.height}, ${(sizeMB).toFixed(1)}MB → ${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB`);
          } else {
            // 无透明像素 — 安全转 JPEG，大幅减小体积
            imageBuffer = await sharp(imageBuffer)
              .jpeg({ quality: 92 })
              .toBuffer();
            wasCompressedAsJpeg = true;
            console.log(`[s3-storage] Compressed to JPEG (no transparency): ${metadata.width}x${metadata.height}, ${(sizeMB).toFixed(1)}MB → ${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB`);
          }
        } catch (compressErr) {
          console.warn('[s3-storage] Image compression failed, keeping original:', compressErr);
        }
      }
      
      // Detect content type and extension from response headers
      // (before potential compression overrides the format)
      let detectedExt = '.png';
      let detectedContentType = 'image/png';
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('jpeg') || ct.includes('jpg')) { detectedExt = '.jpg'; detectedContentType = 'image/jpeg'; }
      else if (ct.includes('webp')) { detectedExt = '.webp'; detectedContentType = 'image/webp'; }
      else if (ct.includes('gif')) { detectedExt = '.gif'; detectedContentType = 'image/gif'; }
      
      // Also check URL path for extension hints
      try {
        const urlPath = new URL(imageUrl).pathname;
        if (urlPath.endsWith('.jpg') || urlPath.endsWith('.jpeg')) { detectedExt = '.jpg'; detectedContentType = 'image/jpeg'; }
        else if (urlPath.endsWith('.webp')) { detectedExt = '.webp'; detectedContentType = 'image/webp'; }
        else if (urlPath.endsWith('.gif')) { detectedExt = '.gif'; detectedContentType = 'image/gif'; }
      } catch {}
      
      // If compression changed the format, override detected values
      if (wasCompressedAsPng) { detectedExt = '.png'; detectedContentType = 'image/png'; }
      else if (wasCompressedAsJpeg) { detectedExt = '.jpg'; detectedContentType = 'image/jpeg'; }
      
      ext = detectedExt;
      contentType = detectedContentType;
    }
    
    // Generate unique filename
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const baseName = subfolder ? `${subfolder.replace(/\//g, '_')}_${timestamp}` : `img_${timestamp}`;
    const filename = `${baseName}_${random}${ext}`;
    
    // Save to local filesystem using saveImageFile for consistent directory layout
    // (saveImageFile saves to {dataRoot}/{subfolder}/ which serve-upload can find)
    const { saveImageFile } = await import('./server-data-root');
    const localUrl = saveImageFile(imageBuffer, filename, subfolder || 'generate');
    
    // Upload to S3 (best-effort, don't block on failure)
    const s3Key = await uploadImageToS3(imageBuffer, filename, contentType).catch(e => {
      console.warn('[s3-storage] S3 upload failed during persistRemoteImage:', e);
      return null;
    });
    
    console.log(`[s3-storage] Persisted image: ${filename} (${(imageBuffer.length / 1024).toFixed(0)}KB, S3: ${s3Key ? 'yes' : 'no'})`);
    
    // Record sourceUrl mapping for future recovery (e.g., redeployment without S3)
    // Always record mapping — previously only recorded when subfolder was set,
    // which missed img_ format files that have no subfolder
    if (imageUrl && imageUrl.startsWith('http')) {
      // Use the full relative path as the key (e.g., "generate/img_xxx.jpg" or "gen-xxx.png")
      const mappingKey = subfolder ? `${subfolder}/${filename}` : filename;
      saveImageDataMapping(mappingKey, imageUrl).catch((e: unknown) => {
        console.warn('[s3-storage] Failed to save source mapping for', mappingKey, e);
      });
    }
    
    // Return stable local URL (already in correct /api/serve-upload/{subDir}/{filename} format)
    return localUrl;
  } catch (e) {
    console.error('[s3-storage] persistRemoteImage failed:', e);
    return null;
  }
}
