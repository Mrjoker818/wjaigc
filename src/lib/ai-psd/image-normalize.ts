/**
 * AI PSD 图像标准化
 * 统一所有图层尺寸为画布尺寸，处理透明度，输出标准PNG
 * 
 * 对照文档: 阶段5-图层处理层 → 1.标准化图层尺寸 2.统一PNG输出 5.生成图层缩略图
 */

import sharp from 'sharp';

/** 标准化选项 */
export interface NormalizeOptions {
  targetWidth: number;
  targetHeight: number;
  /** 是否保持透明背景（光效/装饰/氛围层） */
  preserveAlpha: boolean;
  /** 背景颜色（不透明层使用，默认白色） */
  backgroundColor?: string;
  /** 输出质量 1-100 */
  quality?: number;
}

/** 标准化结果 */
export interface NormalizeResult {
  success: boolean;
  buffer?: Buffer;
  width: number;
  height: number;
  error?: string;
}

/** 标准化图层图片到目标尺寸 */
export async function normalizeImage(
  input: Buffer | string,
  options: NormalizeOptions
): Promise<NormalizeResult> {
  const { targetWidth, targetHeight, preserveAlpha, backgroundColor = '#ffffff', quality = 95 } = options;

  try {
    let pipeline = sharp(input);

    // 获取原始元数据
    const metadata = await pipeline.metadata();
    const origWidth = metadata.width || targetWidth;
    const origHeight = metadata.height || targetHeight;

    // 如果尺寸不匹配，进行缩放（用cover模式保证填满，然后裁切）
    if (origWidth !== targetWidth || origHeight !== targetHeight) {
      pipeline = sharp(input).resize(targetWidth, targetHeight, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: false,
      });
    }

    // 根据是否需要透明度选择输出格式
    if (preserveAlpha) {
      // 透明背景层 → PNG with alpha
      const buffer = await pipeline
        .png({ quality, compressionLevel: 6 })
        .toBuffer();
      return { success: true, buffer, width: targetWidth, height: targetHeight };
    } else {
      // 不透明层 → PNG with solid background
      // 先resize，然后composite到纯色背景上
      const resizedBuffer = await sharp(input)
        .resize(targetWidth, targetHeight, {
          fit: 'cover',
          position: 'center',
          withoutEnlargement: false,
        })
        .toBuffer();

      const buffer = await sharp({
        create: {
          width: targetWidth,
          height: targetHeight,
          channels: 3,
          background: backgroundColor,
        },
      })
        .composite([{ input: resizedBuffer, blend: 'over' }])
        .png({ quality, compressionLevel: 6 })
        .toBuffer();

      return { success: true, buffer, width: targetWidth, height: targetHeight };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, width: targetWidth, height: targetHeight, error: `图像标准化失败: ${message}` };
  }
}

/** 生成缩略图 */
export async function generateThumbnail(
  input: Buffer | string,
  maxSize: number = 200
): Promise<Buffer | null> {
  try {
    const metadata = await sharp(input).metadata();
    const width = metadata.width || maxSize;
    const height = metadata.height || maxSize;
    const ratio = Math.min(maxSize / width, maxSize / height);

    return await sharp(input)
      .resize(Math.round(width * ratio), Math.round(height * ratio), { fit: 'inside' })
      .png({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

/** 从URL下载图片为Buffer */
export async function downloadImageToBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/** 确保图片是PNG格式 */
export async function ensurePng(input: Buffer): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  if (metadata.format === 'png') return input;
  return await sharp(input).png().toBuffer();
}

/** 合成整图预览（所有图层叠加） */
export async function compositePreview(
  layers: Array<{ buffer: Buffer; opacity?: number }>,
  width: number,
  height: number
): Promise<Buffer> {
  if (layers.length === 0) {
    // 空白画布
    return await sharp({
      create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    }).png().toBuffer();
  }

  // 第一层作为基底
  let result = await ensurePng(layers[0].buffer);

  // 依次叠加后续图层
  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i];
    let layerBuffer = await ensurePng(layer.buffer);

    // 如果指定了透明度，应用之
    if (layer.opacity !== undefined && layer.opacity < 1) {
      layerBuffer = await applyOpacity(layerBuffer, layer.opacity);
    }

    result = await sharp(result)
      .composite([{ input: layerBuffer, blend: 'over' }])
      .png()
      .toBuffer();
  }

  return result;
}

/** 应用透明度到图片 */
async function applyOpacity(input: Buffer, opacity: number): Promise<Buffer> {
  // 创建一个同尺寸的alpha通道
  const metadata = await sharp(input).metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;

  // 使用ensureAlpha确保有alpha通道，然后modulate调整
  return await sharp(input)
    .ensureAlpha(opacity)
    .png()
    .toBuffer();
}

/** 获取画布尺寸（根据比例和方向） */
export function getCanvasDimensions(ratio: string, customWidth?: number, customHeight?: number): { width: number; height: number } {
  if (ratio === 'custom' && customWidth && customHeight) {
    return { width: customWidth, height: customHeight };
  }

  // 标准化尺寸（基于2048长边）
  const dimensionMap: Record<string, { width: number; height: number }> = {
    '1:1': { width: 1024, height: 1024 },
    '4:3': { width: 1536, height: 1152 },
    '3:4': { width: 1152, height: 1536 },
    '16:9': { width: 1792, height: 1008 },
    '9:16': { width: 1008, height: 1792 },
    '3:2': { width: 1536, height: 1024 },
    '2:3': { width: 1024, height: 1536 },
    '21:9': { width: 2048, height: 878 },
  };

  return dimensionMap[ratio] || dimensionMap['16:9'];
}
