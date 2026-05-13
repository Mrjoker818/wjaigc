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
    return await storage.fileExists({ fileKey: key });
  } catch (e) {
    return false;
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
  return readImageFromS3(key);
}

/**
 * Get presigned URL for an image by filename
 * Used in generate route for reference image URL resolution
 */
export async function getS3ImageUrl(filenameOrPath: string): Promise<string | null> {
  const key = deriveS3Key(filenameOrPath);
  const exists = await s3FileExists(key);
  if (!exists) return null;
  return getS3PresignedUrl(key);
}
