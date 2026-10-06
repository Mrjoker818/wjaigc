// ============================================================
// Image Tools — File Utilities
// ============================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  UPSCALE_OUTPUT_DIR,
  INPAINT_OUTPUT_DIR,
  TEMP_DIR,
  UPSCALE_OUTPUT_URL_PREFIX,
  INPAINT_OUTPUT_URL_PREFIX,
  PUBLIC_DIR,
} from './config';

export { readImageToBuffer, resizeIfTooLarge } from './image-input';
export { detectSupportedImageMimeType } from './image-mime';
export type { SupportedImageMimeType } from './image-mime';

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
      const publicTarget = path.join(/* turbopackIgnore: true */ PUBLIC_DIR, urlPrefix.replace(/^\//, ''), filename);
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
