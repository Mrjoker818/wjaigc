/**
 * AI PSD 阴影层生成
 * 为PSD中的主体/产品层生成投影效果
 * 
 * 对照文档: 13.2生成要求 → fx/shadow图层
 * - 阴影为独立透明图层
 * - 模糊方向和强度由LLM规划决定
 * - 保存为带alpha通道的PNG
 */

import sharp from 'sharp';

/** 阴影参数 */
export interface ShadowParams {
  /** 模糊半径(px) */
  blurRadius: number;
  /** 水平偏移(px) */
  offsetX: number;
  /** 垂直偏移(px) */
  offsetY: number;
  /** 阴影颜色 */
  color: string;
  /** 阴影透明度 0-1 */
  opacity: number;
}

/** 默认阴影参数 */
export const DEFAULT_SHADOW: ShadowParams = {
  blurRadius: 20,
  offsetX: 5,
  offsetY: 10,
  color: '#000000',
  opacity: 0.35,
};

/** 从主体图层提取alpha通道并生成阴影层 */
export async function generateShadowLayer(
  subjectBuffer: Buffer,
  params: Partial<ShadowParams> = {}
): Promise<Buffer> {
  const { blurRadius, offsetX, offsetY, color, opacity } = { ...DEFAULT_SHADOW, ...params };

  try {
    // 获取主体图片尺寸
    const metadata = await sharp(subjectBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    // 扩展画布以容纳阴影偏移和模糊
    const padding = blurRadius * 2 + Math.abs(offsetX) + Math.abs(offsetY);
    const canvasWidth = width + padding * 2;
    const canvasHeight = height + padding * 2;

    // 提取alpha通道
    const alphaChannel = await sharp(subjectBuffer)
      .ensureAlpha()
      .extractChannel('alpha')
      .toBuffer();

    // 从alpha通道创建阴影形状
    const shadowShape = await sharp(alphaChannel)
      .resize(width, height)
      .toBuffer();

    // 将阴影形状放到扩展画布上，应用颜色和透明度
    const shadowColor = hexToRgb(color);
    const shadowWithColor = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: {
          r: shadowColor.r,
          g: shadowColor.g,
          b: shadowColor.b,
          alpha: opacity,
        },
      },
    })
      .composite([{ input: shadowShape, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // 应用模糊
    const blurredShadow = await sharp(shadowWithColor)
      .blur(blurRadius)
      .png()
      .toBuffer();

    // 将阴影放到扩展画布中心+偏移
    const shadowOnCanvas = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{
        input: blurredShadow,
        left: padding + offsetX,
        top: padding + offsetY,
        blend: 'over',
      }])
      .png()
      .toBuffer();

    // 裁切回原始尺寸（居中）
    const cropX = Math.floor((canvasWidth - width) / 2);
    const cropY = Math.floor((canvasHeight - height) / 2);

    return await sharp(shadowOnCanvas)
      .extract({ left: cropX, top: cropY, width, height })
      .png()
      .toBuffer();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ai-psd-shadow] 阴影生成失败:', message);
    // 回退：返回全透明图层
    return sharp({
      create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
  }
}

/** 从LLM规划中解析阴影参数 */
export function parseShadowParams(layerPrompt?: string): Partial<ShadowParams> {
  if (!layerPrompt) return {};

  const params: Partial<ShadowParams> = {};

  // 尝试解析模糊半径
  const blurMatch = layerPrompt.match(/blur[:\s]*(\d+)/i);
  if (blurMatch) params.blurRadius = parseInt(blurMatch[1], 10);

  // 尝试解析偏移
  const offsetMatch = layerPrompt.match(/offset[:\s]*(-?\d+)\s*,\s*(-?\d+)/i);
  if (offsetMatch) {
    params.offsetX = parseInt(offsetMatch[1], 10);
    params.offsetY = parseInt(offsetMatch[2], 10);
  }

  // 尝试解析透明度
  const opacityMatch = layerPrompt.match(/opacity[:\s]*([\d.]+)/i);
  if (opacityMatch) params.opacity = Math.min(1, parseFloat(opacityMatch[1]));

  // 阴影类型推断
  if (layerPrompt.includes('soft') || layerPrompt.includes('柔和')) {
    params.blurRadius = params.blurRadius || 25;
    params.opacity = params.opacity || 0.25;
  } else if (layerPrompt.includes('hard') || layerPrompt.includes('硬')) {
    params.blurRadius = params.blurRadius || 5;
    params.opacity = params.opacity || 0.5;
  } else if (layerPrompt.includes('long') || layerPrompt.includes('长投影')) {
    params.blurRadius = params.blurRadius || 8;
    params.offsetX = params.offsetX || 15;
    params.offsetY = params.offsetY || 25;
    params.opacity = params.opacity || 0.4;
  }

  return params;
}

/** hex转rgb */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 0, g: 0, b: 0 };
}
