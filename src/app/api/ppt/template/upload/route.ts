import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';

/**
 * POST /api/ppt/template/upload
 * 解析用户上传的 .pptx 文件，提取母版信息和幻灯片结构作为模板参考
 */
export async function POST(req: NextRequest) {
  const authResult = await requireApiAuthOrReject(req);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '请上传 .pptx 文件' }, { status: 400 });
    }

    if (!file.name.endsWith('.pptx')) {
      return NextResponse.json({ error: '仅支持 .pptx 格式' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();

    // P2-2: 文件魔数校验 — PPTX 本质是 ZIP 文件，头4字节应为 50 4B 03 04
    const headerBytes = new Uint8Array(arrayBuffer.slice(0, 4));
    const isZip = headerBytes[0] === 0x50 && headerBytes[1] === 0x4B &&
                  headerBytes[2] === 0x03 && headerBytes[3] === 0x04;
    if (!isZip) {
      return NextResponse.json({ error: '文件内容不合法：不是有效的 PPTX（ZIP）格式' }, { status: 400 });
    }
    const JSZip = await import('jszip');
    const zip = await JSZip.default.loadAsync(arrayBuffer);

    // Extract slide master info from ppt/presentation.xml
    const presXml = await zip.file('ppt/presentation.xml')?.async('string');
    if (!presXml) {
      return NextResponse.json({ error: '无效的 PPTX 文件：缺少 presentation.xml' }, { status: 400 });
    }

    // Parse slide sizes
    const widthMatch = presXml.match(/sldSz[^>]*cx="(\d+)"/);
    const heightMatch = presXml.match(/sldSz[^>]*cy="(\d+)"/);
    const slideWidth = widthMatch ? Math.round(parseInt(widthMatch[1]) / 914400) : 10;
    const slideHeight = heightMatch ? Math.round(parseInt(heightMatch[1]) / 914400) : 7.5;

    // List slides
    const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    const slideCount = slideFiles.length;

    // Extract text from each slide for preview
    const slides: { index: number; texts: string[]; layout: string }[] = [];
    for (const slidePath of slideFiles) {
      const idxMatch = slidePath.match(/slide(\d+)\.xml$/);
      const idx = idxMatch ? parseInt(idxMatch[1]) - 1 : 0;
      const xml = await zip.file(slidePath)?.async('string');
      if (!xml) continue;

      // Extract all text elements
      const texts: string[] = [];
      const textRegex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
      let match;
      while ((match = textRegex.exec(xml)) !== null) {
        const t = match[1].trim();
        if (t) texts.push(t);
      }

      // Detect layout type from content
      let layout = 'content';
      if (texts.length <= 2 && texts.some(t => t.length > 30)) layout = 'title';
      else if (texts.every(t => t.startsWith('•') || t.startsWith('-') || t.startsWith('·'))) layout = 'bullet-list';
      else if (texts.length === 0) layout = 'image';

      slides.push({ index: idx, texts: texts.slice(0, 20), layout });
    }

    // Extract theme colors from ppt/theme/theme1.xml
    const themeColors: string[] = [];
    const themeXml = await zip.file('ppt/theme/theme1.xml')?.async('string');
    if (themeXml) {
      const colorRegex = /<a:srgbClr val="([0-9A-Fa-f]{6})"/g;
      let cm;
      while ((cm = colorRegex.exec(themeXml)) !== null) {
        themeColors.push(`#${cm[1]}`);
      }
    }

    return NextResponse.json({
      success: true,
      template: {
        fileName: file.name,
        slideWidth,
        slideHeight,
        slideCount,
        slides,
        themeColors: themeColors.slice(0, 12),
        aspectRatio: `${slideWidth}:${slideHeight}`,
      },
    });
  } catch (err: unknown) {
    console.error('[PPT Template Upload] Error:', err);
    return NextResponse.json({ error: '解析 PPTX 失败，请确认文件格式正确' }, { status: 500 });
  }
}
