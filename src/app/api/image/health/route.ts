// ============================================================
// GET /api/image/health — 本地图像工具健康检测
// ============================================================

import { NextResponse } from 'next/server';
import { isUpscaylAvailable } from '@/lib/image-tools/upscayl';
import { checkIOPaintHealth } from '@/lib/image-tools/iopaint-client';
import { LOCAL_AI_ENABLED } from '@/lib/image-tools/config';

export async function GET() {
  const [iopaint, upscayl] = await Promise.all([
    checkIOPaintHealth(),
    isUpscaylAvailable(),
  ]);

  return NextResponse.json({
    localAiEnabled: LOCAL_AI_ENABLED,
    iopaint: {
      available: iopaint.available,
      baseUrl: iopaint.baseUrl,
      model: iopaint.model,
      error: iopaint.error,
    },
    upscayl: {
      available: upscayl.available,
      models: upscayl.models,
      error: upscayl.error,
    },
  });
}
