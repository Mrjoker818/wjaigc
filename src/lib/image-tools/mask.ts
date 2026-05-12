// ============================================================
// Image Tools — Mask Utilities
// ============================================================

import sharp from 'sharp';

/**
 * 验证 mask 并统一尺寸
 * 白色区域 = 需要擦除/修复
 * 黑色区域 = 保留
 */
export async function validateAndNormalizeMask(
  maskBuffer: Buffer,
  targetWidth: number,
  targetHeight: number,
): Promise<Buffer> {
  const meta = await sharp(maskBuffer).metadata();
  const maskW = meta.width || 0;
  const maskH = meta.height || 0;

  if (maskW === 0 || maskH === 0) {
    throw new Error('无法读取蒙版尺寸');
  }

  // 如果尺寸不一致，缩放到目标尺寸
  if (maskW !== targetWidth || maskH !== targetHeight) {
    const resized = await sharp(maskBuffer)
      .resize(targetWidth, targetHeight, { fit: 'fill' })
      .ensureAlpha()
      .toBuffer();

    return convertToBinaryMask(resized, targetWidth, targetHeight);
  }

  return convertToBinaryMask(maskBuffer, targetWidth, targetHeight);
}

/**
 * 将 mask 转为严格黑白 PNG
 * - 亮度 > 127 → 白色 (255)
 * - 亮度 ≤ 127 → 黑色 (0)
 */
async function convertToBinaryMask(
  maskBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const { data, info } = await sharp(maskBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    // 如果 alpha 接近透明，视为黑色（保留区域）
    const a = channels >= 4 ? data[offset + 3] : 255;

    const brightness = (r + g + b) / 3;
    const isWhite = a > 127 && brightness > 127;
    const val = isWhite ? 255 : 0;

    data[offset] = val;
    data[offset + 1] = val;
    data[offset + 2] = val;
    if (channels >= 4) {
      data[offset + 3] = 255;
    }
  }

  return sharp(data, {
    raw: { width, height, channels: channels as 3 | 4 },
  })
    .png()
    .toBuffer();
}

/**
 * 从 data URL 创建 mask buffer
 */
export function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('无效的 data URL');
  return Buffer.from(base64, 'base64');
}

/**
 * 创建空白黑色 mask (全保留)
 */
export async function createEmptyMask(
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}
