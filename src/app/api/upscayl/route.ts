import { NextRequest, NextResponse } from 'next/server';
import { performOnnxUpscale, isOnnxUpscaleAvailable } from '@/lib/image-tools/upscayl';
import { validateApiInputs } from '@/lib/api-validator';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { POST as imageEditPost } from '@/app/api/image-edit/route';

// AI mode executes image-edit in this route segment; imports do not inherit its limit.
export const maxDuration = 1800;

// /api/upscayl - 向后兼容的无损放大 API（已迁移到 ONNX CPU）
// 不再依赖 upscayl GPU (Vulkan)，使用 ONNX Real-ESRGAN CPU 放大

// GET: 获取放大服务状态
export async function GET() {
  const onnxAvailable = await isOnnxUpscaleAvailable();
  return NextResponse.json({
    available: onnxAvailable.available,
    engine: 'onnx-realesrgan',
    model: onnxAvailable.model || 'realesrgan-x4plus-fp16',
    source: 'local-cpu',
  });
}

// POST: 执行放大
export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const { imageUrl, scale, outputFormat, compression, upscaleMode } = body as {
      imageUrl: string;
      scale?: number;
      outputFormat?: string;
      compression?: number;
      upscaleMode?: string; // "cpu" | "ai"
    };

    if (!imageUrl) {
      return NextResponse.json({ error: '缺少图片URL' }, { status: 400 });
    }

    const upscaleScale = scale || 2;
    const format = outputFormat || 'png';

    // AI 放大模式: 委托给 /api/image-edit
    if (upscaleMode === 'ai') {
      const headers = new Headers(request.headers);
      headers.set('content-type', 'application/json');
      headers.delete('content-length');
      return imageEditPost(new NextRequest(new URL('/api/image-edit', request.url), {
        method: 'POST', headers, signal: request.signal,
        body: JSON.stringify({ ...body, action: 'upscale', scale: upscaleScale,
          upscaleMode: 'ai', engine: 'ai', outputFormat: format,
          compression: compression || 90 }),
      }));
    }

    // CPU 放大模式: ONNX Real-ESRGAN
    const onnxAvailable = await isOnnxUpscaleAvailable();
    if (!onnxAvailable.available) {
      return NextResponse.json({
        error: 'ONNX CPU 放大不可用，请检查 onnxruntime 和模型文件',
        fallback: true,
      }, { status: 503 });
    }

    const result = await performOnnxUpscale({
      imageUrl,
      scale: upscaleScale as 2 | 4,
      outputFormat: format as 'png' | 'jpg' | 'webp',
      compression: compression || 90,
    });

    if (!result.success) {
      return NextResponse.json({
        error: result.error || 'ONNX CPU 放大失败',
        fallback: true,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      imageUrl: result.imageUrl,
      scale: upscaleScale,
      engine: 'onnx-realesrgan',
    });
  } catch (error: unknown) {
    console.error('[upscayl] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: `放大失败: ${message}`,
      fallback: message.includes('not found') || message.includes('不可用') || message.includes('Blob'),
    }, { status: 500 });
  }
}
