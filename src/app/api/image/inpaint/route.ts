// ============================================================
// POST /api/image/inpaint — 涂抹消除/蒙版修图
// ============================================================
// 兼容入口：将请求转发到 /api/image-edit 的 inpaint 管线，
// 统一使用管理员配置的云端图像 API，不再依赖本地 IOPaint/LaMa。

import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 600;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      imageUrl: string;
      maskDataUrl: string;
      prompt?: string;
      editMode?: 'erase' | 'mask';
      model?: string;
      providerId?: string;
    };

    const { imageUrl, maskDataUrl, prompt, editMode, model, providerId } = body;

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

    // 转发到 /api/image-edit 的 inpaint 管线（云端 AI 修复）
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const cookie = request.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);

    const forwarded = await fetch(new URL('/api/image-edit', request.url), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'inpaint',
        imageUrl,
        maskImage: maskDataUrl,
        prompt,
        editMode: editMode || (prompt?.trim() ? 'mask' : 'erase'),
        model,
        providerId,
      }),
    });

    const result = await forwarded.json().catch(() => ({
      success: false,
      error: '图像修复服务返回格式异常',
    }));

    if (!forwarded.ok || !result.success) {
      return NextResponse.json(result, { status: forwarded.status || 500 });
    }

    return NextResponse.json({
      ...result,
      engine: result.engine || 'cloud-image-edit',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `修图请求处理失败: ${msg}` },
      { status: 500 },
    );
  }
}
