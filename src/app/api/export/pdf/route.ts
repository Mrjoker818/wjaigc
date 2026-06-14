import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      content = '',
      title = '',
      brandName = '',
      type = 'packaging', // packaging | display3d
    } = body;

    if (!content) {
      return NextResponse.json({ error: '请提供方案内容' }, { status: 400 });
    }

    // Generate a simple HTML-based PDF content that can be printed
    // For actual PDF generation, you would use a library like puppeteer or jsPDF
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title || '方案报告'} - ${brandName}</title>
<style>
  body { font-family: 'Microsoft YaHei', sans-serif; padding: 40px; color: #333; }
  h1 { color: #1a1a1a; border-bottom: 2px solid #d9a15f; padding-bottom: 10px; }
  h2 { color: #333; margin-top: 30px; }
  table { border-collapse: collapse; width: 100%; margin: 15px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; font-size: 14px; }
  th { background: #f5f5f5; }
  .brand { color: #d9a15f; }
  .footer { margin-top: 40px; color: #999; font-size: 12px; border-top: 1px solid #eee; padding-top: 15px; }
</style>
</head>
<body>
<h1>${title || '方案报告'} <span class="brand">| ${brandName}</span></h1>
${content}
<div class="footer">
  <p>由无界AI ${type === 'display3d' ? '3D展陈系统Pro' : '品牌包装系统Pro'} 生成</p>
  <p>生成时间: ${new Date().toLocaleString('zh-CN')}</p>
  <p style="color: #999;">注意：此文档为AI辅助生成，相关尺寸/材质/成本等数据仅供参考，实际落地请以专业人员确认数据为准。</p>
</div>
</body>
</html>`;

    return NextResponse.json({
      success: true,
      htmlContent,
      title: title || '方案报告',
      brandName,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}
