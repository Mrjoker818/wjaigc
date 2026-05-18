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

let _storage: S3Storage | null = null;

function getStorage(): S3Storage | null {
  if (_storage) return _storage;
  
  const endpointUrl = process.env.COZE_BUCKET_ENDPOINT_URL;
  const bucketName = process.env.COZE_BUCKET_NAME;
  
  if (!endpointUrl || !bucketName) {
    console.warn('[s3-storage] S3 not configured: missing COZE_BUCKET_ENDPOINT_URL or COZE_BUCKET_NAME');
    return null;
  }
  
  try {
    _storage = new S3Storage({
      endpointUrl,
      accessKey: '',
      secretKey: '',
      bucketName,
      region: 'cn-beijing',
    });
    console.log(`[s3-storage] S3 initialized. Bucket: ${bucketName}`);
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
    return key;
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
    return key;
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
  } catch (e) {
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
  } catch (e) {
    return null;
  }
}

/**
 * Derive an S3 key from a local filename/path
 * e.g. "/api/serve-upload/gen-123.jpg" → "images/gen-123.jpg"
 * e.g. "gen-123.jpg" → "images/gen-123.jpg"
 */
export function deriveS3Key(localPath: string): string {
  // Extract filename from path
  const filename = localPath.split('/').pop() || localPath;
  return `images/${filename}`;
}

/**
 * Get presigned URL for a local image by deriving its S3 key
 * Used as fallback when local file is not found
 */
export async function getS3FallbackUrl(localPath: string): Promise<string | null> {
  const key = deriveS3Key(localPath);
  const exists = await s3FileExists(key);
  if (!exists) return null;
  return getS3PresignedUrl(key);
}

/**
 * Download image buffer from S3 by filename
 * Alias for readImageFromS3 with key derivation
 */
export async function downloadImageFromS3(filenameOrPath: string): Promise<Buffer | null> {
  const key = deriveS3Key(filenameOrPath);
  const resolvedKey = await resolveS3Key(key);
  if (!resolvedKey) return null;
  return readImageFromS3(resolvedKey);
}

/**
 * Get presigned URL for an image by filename
 * Used in generate route for reference image URL resolution
 */
export async function getS3ImageUrl(filenameOrPath: string): Promise<string | null> {
  const key = deriveS3Key(filenameOrPath);
  const resolvedKey = await resolveS3Key(key);
  if (!resolvedKey) return null;
  return getS3PresignedUrl(resolvedKey);
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
  const path = await import('path');
  const fs = await import('fs/promises');
  const { getServerDataRoot } = await import('./server-data-root');
  const dataRoot = getServerDataRoot();
  
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
      // Remote URL - download
      const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) {
        console.warn(`[s3-storage] Failed to download ${imageUrl}: ${resp.status}`);
        return null;
      }
      imageBuffer = Buffer.from(await resp.arrayBuffer());
      
      // Detect content type and extension
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('jpeg') || ct.includes('jpg')) { ext = '.jpg'; contentType = 'image/jpeg'; }
      else if (ct.includes('webp')) { ext = '.webp'; contentType = 'image/webp'; }
      else if (ct.includes('gif')) { ext = '.gif'; contentType = 'image/gif'; }
      else { ext = '.png'; contentType = 'image/png'; }
      
      // Also check URL path for extension hints
      try {
        const urlPath = new URL(imageUrl).pathname;
        if (urlPath.endsWith('.jpg') || urlPath.endsWith('.jpeg')) { ext = '.jpg'; contentType = 'image/jpeg'; }
        else if (urlPath.endsWith('.webp')) { ext = '.webp'; contentType = 'image/webp'; }
        else if (urlPath.endsWith('.gif')) { ext = '.gif'; contentType = 'image/gif'; }
      } catch {}
    }
    
    // Generate unique filename
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const baseName = subfolder ? `${subfolder.replace(/\//g, '_')}_${timestamp}` : `img_${timestamp}`;
    const filename = `${baseName}_${random}${ext}`;
    
    // Save to local filesystem
    const uploadsDir = path.join(dataRoot, 'public', 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });
    const localPath = path.join(uploadsDir, filename);
    await fs.writeFile(localPath, imageBuffer);
    
    // Upload to S3 (best-effort, don't block on failure)
    const s3Key = await uploadImageToS3(imageBuffer, filename, contentType).catch(e => {
      console.warn('[s3-storage] S3 upload failed during persistRemoteImage:', e);
      return null;
    });
    
    console.log(`[s3-storage] Persisted image: ${filename} (${(imageBuffer.length / 1024).toFixed(0)}KB, S3: ${s3Key ? 'yes' : 'no'})`);
    
    // Return stable local URL
    return `/api/serve-upload/${filename}`;
  } catch (e) {
    console.error('[s3-storage] persistRemoteImage failed:', e);
    return null;
  }
}
