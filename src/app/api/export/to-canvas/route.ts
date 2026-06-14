import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// POST /api/export/to-canvas - 发送结果到无限画布
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageUrls, projectName } = body;

    if (!imageUrls?.length) {
      return NextResponse.json({ error: '缺少imageUrls' }, { status: 400 });
    }

    // 返回确认，前端自行处理画布添加
    return NextResponse.json({
      success: true,
      imageUrls,
      projectName,
      message: '已准备好发送到无限画布',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
