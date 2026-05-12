// ============================================================
// POST /api/image/inpaint — 涂抹消除/蒙版修图
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { inpaintFromUrls } from '@/lib/image-tools/iopaint-client';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      imageUrl: string;
      maskDataUrl: string;
      prompt?: string;
    };

    const { imageUrl, maskDataUrl, prompt } = body;

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: '缺少 imageUrl 参数' },
        { status: 400 },
      );
    }

    if (!maskDataUrl) {
      return NextResponse.json(
        { success: false, error: '缺少蒙版数据 (maskDataUrl)' },
        { status: 400 },
      );
    }

    // 验证 maskDataUrl 格式
    if (!maskDataUrl.startsWith('data:image/')) {
      return NextResponse.json(
        { success: false, error: '蒙版数据格式无效，必须为 data:image/... 格式' },
        { status: 400 },
      );
    }

    const result = await inpaintFromUrls(imageUrl, maskDataUrl, prompt);

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `修图请求处理失败: ${msg}` },
      { status: 500 },
    );
  }
}
