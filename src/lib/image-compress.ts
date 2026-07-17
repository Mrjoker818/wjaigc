/**
 * 图片压缩工具 — 前端 + 后端
 *
 * 前端：Canvas API 压缩 + 尺寸限制
 * 后端：Sharp 压缩（在 save-image route 中集成）
 */

// ─── 前端压缩 ────────────────────────────────────────────────────────

export interface CompressOptions {
  maxWidth?: number;       // 最大宽度，默认 2048
  maxHeight?: number;      // 最大高度，默认 2048
  quality?: number;        // JPEG/WebP 质量 0-1，默认 0.85
  format?: 'jpeg' | 'webp' | 'png'; // 输出格式，默认 jpeg
  maxSizeKB?: number;      // 目标最大体积(KB)，超过则递减质量重试
}

export interface CompressResult {
  dataUrl: string;
  width: number;
  height: number;
  sizeKB: number;
  format: string;
}

/**
 * 前端图片压缩
 * 使用 Canvas API 进行缩放和格式转换
 */
export async function compressImage(
  source: string | File | Blob,
  options: CompressOptions = {}
): Promise<CompressResult> {
  const {
    maxWidth = 2048,
    maxHeight = 2048,
    quality = 0.85,
    format = 'jpeg',
    maxSizeKB,
  } = options;

  // 1. 加载图片
  const img = await loadImage(source);

  // 2. 计算目标尺寸
  const { width, height } = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, maxWidth, maxHeight);

  // 3. Canvas 绘制
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  // 4. 导出
  const mimeType = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  let dataUrl = canvas.toDataURL(mimeType, quality);

  // 5. 如果有体积限制，递减质量重试
  if (maxSizeKB && format !== 'png') {
    let currentQuality = quality;
    let attempts = 0;
    while (getDataUrlSizeKB(dataUrl) > maxSizeKB && currentQuality > 0.1 && attempts < 5) {
      currentQuality *= 0.8;
      dataUrl = canvas.toDataURL(mimeType, currentQuality);
      attempts++;
    }
    // 如果还是超，缩小尺寸重试
    if (getDataUrlSizeKB(dataUrl) > maxSizeKB && width > 512) {
      const scale = 0.75;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL(mimeType, 0.75);
    }
  }

  return {
    dataUrl,
    width,
    height,
    sizeKB: getDataUrlSizeKB(dataUrl),
    format,
  };
}

/** 智能判断是否需要压缩（大于阈值的图片才压缩） */
export function shouldCompress(file: File | Blob, thresholdKB = 1024): boolean {
  return file.size > thresholdKB * 1024;
}

/** 将 File/Blob/data URL 压缩后上传到 /api/save-image */
export async function compressAndSave(
  source: string | File | Blob,
  options: CompressOptions = {}
): Promise<string> {
  // 如果是 data URL 且不超过阈值，直接保存
  if (typeof source === 'string' && source.startsWith('data:') && !options.maxSizeKB) {
    const sizeKB = getDataUrlSizeKB(source);
    if (sizeKB < 1024) {
      // 小图直接保存
      const resp = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: source }),
      });
      const data = await resp.json();
      return data.url || source;
    }
  }

  // 压缩
  const result = await compressImage(source, options);

  // 保存
  const resp = await fetch('/api/save-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: result.dataUrl }),
  });
  const data = await resp.json();
  return data.url || result.dataUrl;
}

// ─── 辅助函数 ────────────────────────────────────────────────────────

function loadImage(source: string | File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    // 先绑定 onload/onerror，再设置 src（防止缓存图片在绑定前触发load）
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));

    if (typeof source === 'string') {
      img.src = source;
    } else {
      const url = URL.createObjectURL(source);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    }
  });
}

function fitSize(w: number, h: number, maxW: number, maxH: number): { width: number; height: number } {
  if (w <= maxW && h <= maxH) return { width: w, height: h };
  const ratio = Math.min(maxW / w, maxH / h);
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

function getDataUrlSizeKB(dataUrl: string): number {
  // base64 部分的实际字节 ≈ 原始字节，但 base64 有 33% 开销
  const base64 = dataUrl.split(',')[1] || '';
  return Math.round((base64.length * 3) / 4 / 1024);
}
