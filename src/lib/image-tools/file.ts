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
  UPSCALE_OUTPUT_URL_PREFIX,
  INPAINT_OUTPUT_URL_PREFIX,
  PUBLIC_DIR,
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
  let buffer: Buffer = Buffer.alloc(0);

  if (imageUrl.startsWith('data:')) {
    // data: URL
    const base64 = imageUrl.split(',')[1];
    buffer = Buffer.from(base64, 'base64');
  } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    // 远程 URL
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error(`无法下载图片: ${resp.status}`);
    buffer = Buffer.from(await resp.arrayBuffer());
  } else if (imageUrl.startsWith('/api/serve-upload/')) {
    // serve-upload 路径：从服务器数据目录直接读取，避免 HTTP 回环
    const relativePath = imageUrl.replace('/api/serve-upload/', '');
    const { getServerDataRoot } = await import('@/lib/server-data-root');
    const dataRoot = getServerDataRoot();
    const possibleDirs = [
      path.join(dataRoot, 'uploads'),
      dataRoot,
    ];
    let found = false;
    for (const dir of possibleDirs) {
      const fullPath = path.join(dir, relativePath);
      if (fs.existsSync(fullPath)) {
        buffer = await fs.promises.readFile(fullPath);
        found = true;
        break;
      }
    }
    // 开发环境：也尝试 public 目录
    if (!found && process.env.COZE_PROJECT_ENV !== 'PROD') {
      const pubPath = path.join(PUBLIC_DIR, imageUrl);
      if (fs.existsSync(pubPath)) {
        buffer = await fs.promises.readFile(pubPath);
        found = true;
      }
      // /outputs/xxx 路径
      const pubOutputs = path.join(PUBLIC_DIR, relativePath);
      if (!found && fs.existsSync(pubOutputs)) {
        buffer = await fs.promises.readFile(pubOutputs);
        found = true;
      }
    }
    if (!found) {
      throw new Error(`serve-upload 图片文件不存在: ${relativePath} (搜索目录: ${possibleDirs.join(', ')})`);
    }
  } else if (imageUrl.startsWith('/outputs/')) {
    // /outputs/xxx 路径：开发环境从 public/outputs，生产环境从 dataRoot/uploads
    const relPath = imageUrl.replace(/^\/outputs\//, '');
    const { getServerDataRoot } = await import('@/lib/server-data-root');
    const dataRoot = getServerDataRoot();
    const candidates = [
      path.join(dataRoot, 'uploads', relPath),
      path.join(PUBLIC_DIR, 'outputs', relPath),
    ];
    let found = false;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        buffer = await fs.promises.readFile(p);
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`outputs 图片文件不存在: ${imageUrl}`);
    }
  } else if (imageUrl.startsWith('/')) {
    // 本地公共路径 (/uploads/xxx.png)
    const localPath = path.join(process.cwd(), 'public', imageUrl);
    if (!fs.existsSync(localPath)) {
      throw new Error(`图片文件不存在: ${localPath}`);
    }
    buffer = await fs.promises.readFile(localPath);
  } else {
    // 绝对路径
    if (!fs.existsSync(imageUrl)) {
      throw new Error(`图片文件不存在: ${imageUrl}`);
    }
    buffer = await fs.promises.readFile(imageUrl);
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

/** 保存 Buffer 到输出目录，返回可访问的 URL */
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

  // 根据输出目录确定 URL 前缀
  let urlPrefix = '';
  if (outputDir === UPSCALE_OUTPUT_DIR) {
    urlPrefix = UPSCALE_OUTPUT_URL_PREFIX;
  } else if (outputDir === INPAINT_OUTPUT_DIR) {
    urlPrefix = INPAINT_OUTPUT_URL_PREFIX;
  } else if (outputDir.startsWith(PUBLIC_DIR)) {
    // 回退：public 下的路径转为相对URL
    const rel = path.relative(PUBLIC_DIR, filepath).replace(/\\/g, '/');
    urlPrefix = '/' + rel.replace(/\/[^/]+$/, '');
  } else {
    // 其他路径：作为 serve-upload 路径返回
    urlPrefix = '/api/serve-upload' + path.dirname(filepath).replace(/\\/g, '/');
  }

  // 开发环境：额外复制到 public 目录供 Next.js 静态serve
  if (process.env.COZE_PROJECT_ENV !== 'PROD' && !filepath.startsWith(PUBLIC_DIR)) {
    try {
      const publicTarget = path.join(PUBLIC_DIR, urlPrefix.replace(/^\//, ''), filename);
      fs.mkdirSync(path.dirname(publicTarget), { recursive: true });
      fs.copyFileSync(filepath, publicTarget);
    } catch { /* best effort */ }
  }

  return `${urlPrefix}/${filename}`;
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
