// ============================================================
// Image Tools — File Utilities
// ============================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import {
  UPSCALE_OUTPUT_DIR,
  INPAINT_OUTPUT_DIR,
  TEMP_DIR,
  IMAGE_MAX_SIZE_MB,
  IMAGE_MAX_EDGE,
} from './config';

/** 确保输出目录存在 */
export function ensureOutputDirs(): void {
  [UPSCALE_OUTPUT_DIR, INPAINT_OUTPUT_DIR, TEMP_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

/** 生成唯一文件名 */
export function generateFilename(prefix: string, ext: string): string {
  const timestamp = Date.now();
  const hash = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${timestamp}-${hash}.${ext}`;
}

/** 读取图片到 Buffer */
export async function readImageToBuffer(
  imageUrl: string,
): Promise<{ buffer: Buffer; width: number; height: number; format: string }> {
  let buffer: Buffer;

  if (imageUrl.startsWith('data:')) {
    // data: URL
    const base64 = imageUrl.split(',')[1];
    buffer = Buffer.from(base64, 'base64');
  } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    // 远程 URL
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error(`无法下载图片: ${resp.status}`);
    buffer = Buffer.from(await resp.arrayBuffer());
  } else {
    // 本地路径 (/uploads/xxx.png)
    let localPath: string;
    if (imageUrl.startsWith('/')) {
      localPath = path.join(process.cwd(), 'public', imageUrl);
    } else {
      localPath = imageUrl;
    }
    if (!fs.existsSync(localPath)) {
      throw new Error(`图片文件不存在: ${localPath}`);
    }
    buffer = await fs.promises.readFile(localPath);
  }

  // 校验大小
  const sizeMB = buffer.length / (1024 * 1024);
  if (sizeMB > IMAGE_MAX_SIZE_MB) {
    throw new Error(`图片大小 ${sizeMB.toFixed(1)}MB 超过限制 ${IMAGE_MAX_SIZE_MB}MB`);
  }

  // 获取元信息
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const format = meta.format || 'png';

  if (width === 0 || height === 0) {
    throw new Error('无法读取图片尺寸');
  }

  return { buffer, width, height, format };
}

/** 缩放图片使最长边不超过 maxEdge */
export async function resizeIfTooLarge(
  buffer: Buffer,
  maxEdge: number = IMAGE_MAX_EDGE,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;

  if (w <= maxEdge && h <= maxEdge) {
    return { buffer, width: w, height: h };
  }

  const ratio = Math.min(maxEdge / w, maxEdge / h);
  const newW = Math.round(w * ratio);
  const newH = Math.round(h * ratio);

  const resized = await sharp(buffer)
    .resize(newW, newH, { fit: 'fill' })
    .toBuffer();

  return { buffer: resized, width: newW, height: newH };
}

/** 保存 Buffer 到输出目录 */
export function saveOutputBuffer(
  buffer: Buffer,
  prefix: string,
  ext: string,
  outputDir: string,
): string {
  ensureOutputDirs();
  const filename = generateFilename(prefix, ext);
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, buffer);
  // 返回相对 public 的路径
  const relativePath = path.relative(
    path.join(process.cwd(), 'public'),
    filepath,
  );
  return '/' + relativePath.replace(/\\/g, '/');
}

/** 清理临时文件 */
export function cleanupTempFile(filepath: string): void {
  try {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  } catch {
    // 忽略清理错误
  }
}

/** 将 multipart form 的 File 读取为 Buffer */
export async function fileToBuffer(
  file: File,
): Promise<{ buffer: Buffer; name: string }> {
  const arrayBuffer = await file.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    name: file.name,
  };
}
