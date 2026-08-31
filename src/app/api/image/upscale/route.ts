// ============================================================
// POST /api/image/upscale — 无损放大
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { performOnnxUpscale } from '@/lib/image-tools/upscayl';
import { IMAGE_MAX_SIZE_MB } from '@/lib/image-tools/config';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { validateApiInputs } from '@/lib/api-validator';

export async function POST(request: NextRequest) {
  let deductedCredits = 0;
  let sessionUser: import('@/lib/user-types').User | null = null;
  async function refundFailure(reason: string): Promise<void> {
    if (deductedCredits <= 0 || !sessionUser) return;
    const amount = deductedCredits;
    // 不对结果不确定的退款重复调用；失败日志交由账务核对。
    deductedCredits = 0;
    try {
      const refund = await refundCredits(sessionUser.id, amount, `无损放大失败退款: ${reason.substring(0, 100)}`);
      if (!refund.success) console.error('[image/upscale] Refund failed:', { userId: sessionUser.id, amount });
    } catch (refundErr) { console.error('[image/upscale] Refund failed:', refundErr); }
  }
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }


    const { imageUrl, scale: requestedScale, outputFormat, compression, upscaleMode } = body;
    const scale = requestedScale === '2' ? 2 : requestedScale === '4' ? 4 : requestedScale ?? 2;

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: '缺少 imageUrl 参数' },
        { status: 400 },
      );
    }

    // 放大模式: cpu (ONNX本地) / ai (AI云端), 默认 cpu
    const mode = upscaleMode === 'ai' ? 'ai' : 'cpu';

    if (scale !== 2 && scale !== 4) {
      return NextResponse.json(
        { success: false, error: `不支持的放大倍率: ${scale}，仅支持 2 和 4` },
        { status: 400 },
      );
    }
    if (outputFormat && !['png', 'jpg', 'webp'].includes(outputFormat)) {
      return NextResponse.json(
        { success: false, error: `不支持的输出格式: ${outputFormat}，仅支持 png/jpg/webp` },
        { status: 400 },
      );
    }

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
          scale,
          upscaleMode: 'ai',
          outputFormat: outputFormat || 'png',
          compression: compression || 90,
        }),
        signal: AbortSignal.timeout(600000), // 10分钟超时
      });
      const aiResult = await aiResp.json() as Record<string, unknown>;
      if (!aiResp.ok || aiResult.error) {
        await refundFailure(`AI放大失败 (${aiResp.status})`);
        return NextResponse.json(
          { success: false, error: `AI放大失败: ${aiResult.error || '未知错误'}` },
          { status: aiResp.status },
        );
      }
      return NextResponse.json(aiResult);
    }

    // CPU 放大模式: ONNX Real-ESRGAN
    // 校验文件大小 (通过 URL 检查受限，后端会在读取时检查)
    void IMAGE_MAX_SIZE_MB;

    const result = await performOnnxUpscale({
      imageUrl,
      scale,
      outputFormat: outputFormat || 'png',
      compression: compression || 90,
    });

    if (!result.success) {
      await refundFailure(result.error || '本地放大失败');
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // 退款：放大失败时退还积分
    await refundFailure(msg);
    return NextResponse.json(
      { success: false, error: `放大请求处理失败: ${msg}` },
      { status: 500 },
    );
  }
}
