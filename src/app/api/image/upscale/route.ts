// ============================================================
// POST /api/image/upscale — 无损放大
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { performOnnxUpscale } from '@/lib/image-tools/upscayl';
import { IMAGE_MAX_SIZE_MB } from '@/lib/image-tools/config';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { validateApiInputs } from '@/lib/api-validator';
import { POST as imageEditPost } from '@/app/api/image-edit/route';

// AI mode executes image-edit in this route segment; imports do not inherit its limit.
export const maxDuration = 1800;

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

    // AI mode uses the image-edit admission, billing, and task lifecycle as-is.
    // Keep the original request credentials and project/version identity; do not
    // charge once here and then submit an unauthenticated second request.
    if (mode === 'ai') {
      const headers = new Headers(request.headers);
      headers.set('content-type', 'application/json');
      headers.delete('content-length');
      return imageEditPost(new NextRequest(new URL('/api/image-edit', request.url), {
        method: 'POST', headers, signal: request.signal,
        body: JSON.stringify({ ...body, action: 'upscale', scale,
          upscaleMode: 'ai', engine: 'ai', outputFormat: outputFormat || 'png',
          compression: compression || 90 }),
      }));
    }

    // CPU 放大保持既有同步积分合同
    sessionUser = await getSessionUser(request).catch(() => null);
    deductedCredits = 0;
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'image_upscale');
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
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
