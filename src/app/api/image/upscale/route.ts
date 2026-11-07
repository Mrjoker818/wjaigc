// ============================================================
// POST /api/image/upscale — 无损放大（AI 云端）
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { validateApiInputs } from '@/lib/api-validator';
import { POST as imageEditPost } from '@/app/api/image-edit/route';

// AI mode executes image-edit in this route segment; imports do not inherit its limit.
export const maxDuration = 1800;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }


    const { imageUrl, scale: requestedScale, outputFormat, compression } = body;
    const scale = requestedScale === '2' ? 2 : requestedScale === '4' ? 4 : requestedScale ?? 2;

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: '缺少 imageUrl 参数' },
        { status: 400 },
      );
    }

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

    // 本地 ONNX 放大已移除，统一走 image-edit 的 AI 云端准入、计费与任务生命周期。
    // Keep the original request credentials and project/version identity; do not
    // charge once here and then submit an unauthenticated second request.
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    return await imageEditPost(new NextRequest(new URL('/api/image-edit', request.url), {
      method: 'POST', headers, signal: request.signal,
      body: JSON.stringify({ ...body, action: 'upscale', scale,
        upscaleMode: 'ai', engine: 'ai', outputFormat: outputFormat || 'png',
        compression: compression || 90 }),
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `放大请求处理失败: ${msg}` },
      { status: 500 },
    );
  }
}
