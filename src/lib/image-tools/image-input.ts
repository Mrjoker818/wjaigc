import sharp from 'sharp';
import { readImageToolsLocalFile } from './local-image-reader';
import { IMAGE_MAX_EDGE, IMAGE_MAX_SIZE_MB, PUBLIC_DIR } from './config';

/** One deadline covers both response headers and the complete body. */
async function readHttpImage(imageUrl: string): Promise<Buffer> {
  const maxBytes = IMAGE_MAX_SIZE_MB * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('图片大小限制配置无效');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('下载图片超时（30s）')), 30_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let completed = false;
  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`无法下载图片: ${response.status}`);
    const declaredSize = Number(response.headers.get('content-length'));
    if (declaredSize > maxBytes) {
      throw new Error(`图片大小超过限制 ${IMAGE_MAX_SIZE_MB}MB`);
    }
    if (!response.body) throw new Error('无法下载图片: 响应体为空');
    reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`图片大小超过限制 ${IMAGE_MAX_SIZE_MB}MB`);
      chunks.push(Buffer.from(value));
    }
    completed = true;
    return Buffer.concat(chunks, size);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    // Abort native fetch on every failure, including status/size rejection;
    // do not drain an untrusted, potentially unfinished response body.
    if (!completed) controller.abort();
    reader?.releaseLock();
  }
}

/** Read image bytes and dimensions without importing output-directory operations. */
export async function readImageToBuffer(
  imageUrl: string,
): Promise<{ buffer: Buffer; width: number; height: number; format: string }> {
  let buffer: Buffer = Buffer.alloc(0);

  if (imageUrl.startsWith('data:')) {
    const base64 = imageUrl.split(',')[1];
    buffer = Buffer.from(base64, 'base64');
  } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    buffer = await readHttpImage(imageUrl);
  } else {
    const { getServerDataRoot } = await import('@/lib/server-data-root');
    const local = await readImageToolsLocalFile(
      getServerDataRoot(), PUBLIC_DIR, imageUrl, IMAGE_MAX_SIZE_MB * 1024 * 1024,
    );
    if (!local) throw new Error(`图片文件不存在: ${imageUrl}`);
    buffer = local;
  }

  const sizeMB = buffer.length / (1024 * 1024);
  if (sizeMB > IMAGE_MAX_SIZE_MB) {
    throw new Error(`图片大小 ${sizeMB.toFixed(1)}MB 超过限制 ${IMAGE_MAX_SIZE_MB}MB`);
  }

  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const format = meta.format || 'png';

  if (width === 0 || height === 0) {
    throw new Error('无法读取图片尺寸');
  }

  return { buffer, width, height, format };
}

/** Resize an image so its longest edge does not exceed maxEdge. */
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
