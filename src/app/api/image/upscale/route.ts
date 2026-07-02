// ============================================================
// POST /api/image/upscale — 无损放大
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { performOnnxUpscale } from '@/lib/image-tools/upscayl';
import { IMAGE_MAX_SIZE_MB } from '@/lib/image-tools/config';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';

export async function POST(request: NextRequest) {
  let deductedCredits = 0;
  let sessionUser: any = null;
  try {
    const body = await request.json();

    const { imageUrl, scale, outputFormat, compression, upscaleMode } = body;

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: '缺少 imageUrl 参数' },
        { status: 400 },
      );
    }

    // 放大模式: cpu (ONNX本地) / ai (AI云端), 默认 cpu
    const mode = upscaleMode === 'ai' ? 'ai' : 'cpu';

    // 积分检查与扣除
    sessionUser = await getSessionUser(request).catch(() => null);
    deductedCredits = 0;
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'image_upscale');
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    // AI 放大模式: 委托给 /api/image-edit (action=upscale, upscaleMode=ai)
    if (mode === 'ai') {
      const baseUrl = process.env.DEPLOY_RUN_PORT
        ? `http://localhost:${process.env.DEPLOY_RUN_PORT}`
        : 'http://localhost:5000';
      const aiResp = await fetch(`${baseUrl}/api/image-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upscale',
          imageUrl,
          scale: scale || 2,
          upscaleMode: 'ai',
          outputFormat: outputFormat || 'png',
          compression: compression || 90,
        }),
        signal: AbortSignal.timeout(600000), // 10分钟超时
      });
      const aiResult = await aiResp.json() as Record<string, unknown>;
      if (!aiResp.ok || aiResult.error) {
        return NextResponse.json(
          { success: false, error: `AI放大失败: ${aiResult.error || '未知错误'}` },
          { status: aiResp.status },
        );
      }
      return NextResponse.json(aiResult);
    }

    // CPU 放大模式: ONNX Real-ESRGAN
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
    void IMAGE_MAX_SIZE_MB;

    const result = await performOnnxUpscale({
      imageUrl,
      scale: scale || 2,
      outputFormat: outputFormat || 'png',
      compression: compression || 90,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // 退款：放大失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `无损放大失败退款: ${msg.substring(0, 100)}`);
      } catch (refundErr) { console.error('[image/upscale] Refund failed:', refundErr); }
    }
    return NextResponse.json(
      { success: false, error: `放大请求处理失败: ${msg}` },
      { status: 500 },
    );
  }
}
