/**
 * 计算像素尺寸 - 从画面比例和质量推算
 * 从 generate/route.ts 提取，避免在 API route 文件中导出非 HTTP 方法函数
 */
import { getModelSpecificPixelSize } from './api-compatibility';

export function calculateActualPixelsFromRatio(aspectRatio: string, quality?: string, modelId?: string): string | null {
  // 直接使用 api-compatibility 中的模型像素表推算
  if (!aspectRatio || !quality) return null;
  try {
    const pixelSize = getModelSpecificPixelSize(modelId || '', aspectRatio, quality);
    if (pixelSize) {
      const [w, h] = pixelSize.split('x').map(Number);
      if (w > 0 && h > 0) return pixelSize;
    }
  } catch {
    // fallback: 从比例推算基础尺寸
  }

  // Fallback: 从 aspectRatio 比例 + quality 推算
  const ratioMatch = aspectRatio.match(/^(\d+):(\d+)$/);
  if (!ratioMatch) return null;
  const [, rw, rh] = ratioMatch.map(Number);
  const ratio = rw / rh;

  // 根据质量确定长边像素
  // ★ 支持 '1K'/'2K'/'3K'/'4K' 和 'standard'/'hd'/'high' 等常见质量值
  // 统一使用大写格式进行匹配，避免大小写不匹配问题
  const qualityUpper = quality.toUpperCase();
  const qualityPixels: Record<string, number> = {
    '1K': 1024, '2K': 2048, '3K': 3072, '4K': 4096, '8K': 8192,
    'STANDARD': 1024, 'STD': 1024,     // standard → 1K (OpenAI 默认)
    'HD': 1792, 'HIGH': 1792,          // hd → 1792 (OpenAI DALL-E 3 hd 模式)
    'LOW': 1024, 'MEDIUM': 1024, 'AUTO': 1024, // 通用质量兜底
  };
  const longEdge = qualityPixels[qualityUpper];
  if (!longEdge) return null;

  if (ratio >= 1) {
    // 横向或正方形
    return `${longEdge}x${Math.round(longEdge / ratio)}`;
  } else {
    // 纵向
    return `${Math.round(longEdge * ratio)}x${longEdge}`;
  }
}
