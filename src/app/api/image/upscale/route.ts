// ============================================================
// POST /api/image/upscale — 无损放大
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { performUpscale } from '@/lib/image-tools/upscayl';
import { IMAGE_MAX_SIZE_MB } from '@/lib/image-tools/config';
import type { UpscaleParams } from '@/lib/image-tools/upscayl';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits } from '@/lib/credits';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UpscaleParams;

    const { imageUrl, model, scale, tileSize, outputFormat, compression } =
      body;

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: '缺少 imageUrl 参数' },
        { status: 400 },
      );
    }

    // 积分检查与扣除
    const sessionUser = await getSessionUser(request).catch(() => null);
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'image_upscale');
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
    }

    // 校验 scale
    if (scale && scale !== 2 && scale !== 4) {
      return NextResponse.json(
        { success: false, error: `不支持的放大倍率: ${scale}，仅支持 2 和 4` },
        { status: 400 },
      );
    }

    // 校验 outputFormat
    if (outputFormat && !['png', 'jpg', 'webp'].includes(outputFormat)) {
      return NextResponse.json(
        {
          success: false,
          error: `不支持的输出格式: ${outputFormat}，仅支持 png/jpg/webp`,
        },
        { status: 400 },
      );
    }

    // 校验文件大小 (通过 URL 检查受限，后端会在读取时检查)
    void IMAGE_MAX_SIZE_MB; // 已在 file.ts 中使用
    void tileSize; // 保留参数，后续可能用于分块处理

    const result = await performUpscale({
      imageUrl,
      model,
      scale: scale || 2,
      tileSize,
      outputFormat: outputFormat || 'png',
      compression: compression || 90,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `放大请求处理失败: ${msg}` },
      { status: 500 },
    );
  }
}
