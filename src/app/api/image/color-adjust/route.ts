import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ColorAdjustParams {
  brightness?: number;   // -100 ~ 100
  contrast?: number;     // -100 ~ 100
  saturation?: number;   // -100 ~ 100
  temperature?: number;  // -100 ~ 100 (冷→暖)
  hue?: number;          // -180 ~ 180
  highlights?: number;   // -100 ~ 100
  shadows?: number;      // -100 ~ 100
}

function normalizeRange(value: number | undefined, min: number, max: number, def: number): number {
  if (value === undefined || value === null || isNaN(value)) return def;
  return Math.max(min, Math.min(max, value));
}

/**
 * 参数化色彩调整 API（纯 sharp 操作，不调用 AI 模型）
 * POST /api/image/color-adjust
 * Body: { imageUrl, brightness, contrast, saturation, temperature, hue, highlights, shadows }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageUrl } = body;
    const params: ColorAdjustParams = body.params || body;

    if (!imageUrl) {
      return NextResponse.json({ error: '缺少 imageUrl 参数' }, { status: 400 });
    }

    // 1. 下载或读取图片
    let imageBuffer: Buffer;
    if (imageUrl.startsWith('data:')) {
      const base64 = imageUrl.split(',')[1];
      imageBuffer = Buffer.from(base64, 'base64');
    } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const resp = await fetch(imageUrl);
      if (!resp.ok) {
        return NextResponse.json({ error: '无法下载图片' }, { status: 400 });
      }
      const arrayBuffer = await resp.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);
    } else {
      // 本地路径
      const localPath = join(process.cwd(), 'public', imageUrl.replace(/^\//, ''));
      if (existsSync(localPath)) {
        const { readFile } = await import('fs/promises');
        imageBuffer = await readFile(localPath);
      } else {
        return NextResponse.json({ error: '图片不存在' }, { status: 400 });
      }
    }

    // 2. 标准化参数
    const brightness = normalizeRange(params.brightness, -100, 100, 0);
    const contrast = normalizeRange(params.contrast, -100, 100, 0);
    const saturation = normalizeRange(params.saturation, -100, 100, 0);
    const temperature = normalizeRange(params.temperature, -100, 100, 0);
    const hue = normalizeRange(params.hue, -180, 180, 0);
    const highlights = normalizeRange(params.highlights, -100, 100, 0);
    const shadows = normalizeRange(params.shadows, -100, 100, 0);

    // 3. sharp 处理管线
    let pipeline = sharp(imageBuffer, { failOn: 'none' });
    const metadata = await pipeline.metadata();
    
    // 亮度/对比度/饱和度/色相通过 modulate 处理
    // modulate 的 brightness/contrast/saturation/hue 接收浮点数，1.0为原始值
    const mod: Record<string, number> = {};

    if (brightness !== 0) {
      // brightness -100~100 → 0.5~1.5 范围
      mod.brightness = 1 + brightness / 200;
    }
    if (saturation !== 0) {
      // saturation -100~100 → 0~2 范围
      mod.saturation = 1 + saturation / 100;
    }
    if (hue !== 0) {
      // hue 旋转度数，sharp 支持整数度数
      mod.hue = Math.round(hue);
    }
    if (Object.keys(mod).length > 0) {
      pipeline = pipeline.modulate(mod as any);
    }

    // 色温调整（temperature）：通过 RGB 通道线性调节
    // 色温偏暖 → 增加红、减少蓝；偏冷 → 减少红、增加蓝
    if (temperature !== 0) {
      const tempFactor = temperature / 100; // -1~1
      // 使用 linear 调整 RGB 通道增益
      const rGain = 1 + tempFactor * 0.15;  // 暖调加红
      const bGain = 1 - tempFactor * 0.15;  // 暖调减蓝
      pipeline = pipeline.linear([rGain, 1, bGain], [0, 0, 0]);
    }

    // 对比度：通过 linear + 灰度归一化实现增强
    if (contrast !== 0) {
      const contrastFactor = 1 + contrast / 100; // 0~2
      const midpoint = 0.5;
      // 使用 linear 做 S 曲线近似：out = factor * (in - mid) + mid
      // 先 modulate brightness 已经做了基础亮度，这里用 linear 做对比度拉伸
      const slope = contrastFactor;
      const intercept = midpoint * (1 - contrastFactor) * 255;
      pipeline = pipeline.linear([slope, slope, slope], [intercept, intercept, intercept]);
    }

    // 高光/阴影：通过 gamma 曲线调整
    if (highlights !== 0 || shadows !== 0) {
      // gamma > 1 压暗高光，gamma < 1 提亮阴影
      // 组合使用：先 gamma 调整整体，再用 linear 补偿
      const gammaVal = 1 - shadows / 200 + highlights / 200;
      pipeline = pipeline.gamma(Math.max(0.5, Math.min(2.0, gammaVal)));
    }

    // 4. 输出 PNG（保留透明通道）或 JPEG
    const isTransparent = metadata.format === 'png' && metadata.hasAlpha;
    let outputBuffer: Buffer;
    if (isTransparent) {
      outputBuffer = await pipeline.png({ quality: 95 }).toBuffer();
    } else {
      outputBuffer = await pipeline.jpeg({ quality: 92 }).toBuffer();
    }

    // 5. 保存到 serve-upload 目录
    const uploadDir = join(process.cwd(), 'public', 'api', 'serve-upload', 'color-adjust');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }
    const filename = `ca_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${isTransparent ? 'png' : 'jpg'}`;
    const outputPath = join(uploadDir, filename);
    await writeFile(outputPath, outputBuffer);

    const resultUrl = `/api/serve-upload/color-adjust/${filename}`;

    return NextResponse.json({
      success: true,
      url: resultUrl,
      width: metadata.width,
      height: metadata.height,
      format: isTransparent ? 'png' : 'jpg',
      size: outputBuffer.length,
    });
  } catch (error: any) {
    console.error('[color-adjust] 处理失败:', error);
    return NextResponse.json(
      { error: '色彩调整失败: ' + (error?.message || String(error)) },
      { status: 500 }
    );
  }
}
