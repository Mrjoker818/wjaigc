import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';

interface PdfRequest {
  title: string;
  type: 'merge' | 'split' | 'markdown' | 'form' | 'watermark' | 'extract';
  // merge 用
  pdfUrls?: string[];
  // split 用
  pdfUrl?: string;
  pageRanges?: { start: number; end: number }[];
  // markdown 用
  content?: string;
  theme?: 'tech-blue' | 'emerald-green' | 'warm-orange' | 'dark-elegance' | 'minimal-gray';
  // form 用
  fields?: Record<string, string>;
  // watermark 用
  watermarkText?: string;
  // extract 用
  pageNumbers?: number[];
}

const THEMES: Record<string, { primary: [number, number, number]; secondary: [number, number, number]; bg: [number, number, number]; text: [number, number, number] }> = {
  'tech-blue': { primary: [0.11, 0.46, 0.92], secondary: [0.2, 0.6, 0.95], bg: [0.98, 0.98, 1], text: [0.1, 0.15, 0.25] },
  'emerald-green': { primary: [0.06, 0.55, 0.35], secondary: [0.12, 0.7, 0.45], bg: [0.97, 1, 0.98], text: [0.08, 0.2, 0.12] },
  'warm-orange': { primary: [0.9, 0.45, 0.1], secondary: [0.95, 0.6, 0.2], bg: [1, 0.99, 0.97], text: [0.25, 0.15, 0.08] },
  'dark-elegance': { primary: [0.83, 0.69, 0.22], secondary: [0.9, 0.75, 0.3], bg: [0.1, 0.1, 0.1], text: [0.92, 0.92, 0.92] },
  'minimal-gray': { primary: [0.25, 0.25, 0.25], secondary: [0.45, 0.45, 0.45], bg: [1, 1, 1], text: [0.15, 0.15, 0.15] },
};
// Simple markdown-to-PDF with basic formatting
async function buildMarkdownPdf(content: string, themeName: string): Promise<Uint8Array> {
  const theme = THEMES[themeName] || THEMES['tech-blue'];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const lines = content.split('\n');
  const margin = 60;
  const pageWidth = 595;
  const pageHeight = 842;
  const maxWidth = pageWidth - 2 * margin;
  const lineHeight = 18;
  const fontSize = 11;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function newPage() {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  }

  function drawText(text: string, opts: { size?: number; color?: [number, number, number]; bold?: boolean; italic?: boolean; indent?: number } = {}) {
    const { size = fontSize, color = theme.text, bold = false, italic = false, indent = 0 } = opts;
    const f = bold ? fontBold : italic ? fontItalic : font;
    const x = margin + indent;
    page.drawText(text, { x, y, size, font: f, color: rgb(...color), maxWidth: maxWidth - indent });
    y -= size + 6;
    if (y < margin + 40) newPage();
  }

  for (const line of lines) {
    if (!line.trim()) {
      y -= lineHeight / 2;
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      drawText(line.slice(4), { size: 14, color: theme.secondary, bold: true });
      continue;
    }
    if (line.startsWith('## ')) {
      drawText(line.slice(3), { size: 18, color: theme.primary, bold: true });
      y -= 4;
      page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, color: rgb(...theme.secondary), thickness: 1 });
      y -= 8;
      continue;
    }
    if (line.startsWith('# ')) {
      drawText(line.slice(2), { size: 24, color: theme.primary, bold: true });
      y -= 6;
      page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, color: rgb(...theme.primary), thickness: 2 });
      y -= 10;
      continue;
    }

    // Lists
    if (line.match(/^[\s]*[-*+]\s/)) {
      const text = line.replace(/^[\s]*[-*+]\s/, '');
      page.drawText('•', { x: margin + 8, y: y + 1, size: fontSize, font, color: rgb(...theme.primary) });
      drawText(text, { indent: 24 });
      continue;
    }
    if (line.match(/^[\s]*\d+[.)]\s/)) {
      const match = line.match(/^([\s]*\d+[.)]\s)(.*)/);
      if (match) {
        page.drawText(match[1].trim(), { x: margin + 4, y: y + 1, size: fontSize, font: fontBold, color: rgb(...theme.primary) });
        drawText(match[2], { indent: 24 });
      }
      continue;
    }

    // Code blocks
    if (line.startsWith('```')) continue;

    // Blockquote
    if (line.startsWith('> ')) {
      page.drawRectangle({ x: margin, y: y - 2, width: 3, height: lineHeight, color: rgb(...theme.secondary) });
      drawText(line.slice(2), { italic: true, indent: 12, color: [0.4, 0.4, 0.4] });
      continue;
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}$/)) {
      y -= 4;
      page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, color: rgb(...theme.secondary), thickness: 0.5, opacity: 0.3 });
      y -= 8;
      continue;
    }

    // Normal paragraph
    drawText(line);
  }

  return doc.save();
}

export async function POST(req: NextRequest) {
  try {
    const body: PdfRequest = await req.json();
    const { type, title } = body;

    switch (type) {
      case 'merge': {
        if (!body.pdfUrls || body.pdfUrls.length < 2) {
          return NextResponse.json({ error: '至少需要 2 个 PDF 文件进行合并' }, { status: 400 });
        }
        const mergedDoc = await PDFDocument.create();
        for (const url of body.pdfUrls) {
          try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (!resp.ok) continue;
            const pdfBytes = await resp.arrayBuffer();
            const srcDoc = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
            copiedPages.forEach(p => mergedDoc.addPage(p));
          } catch {
            // Skip failed URLs
          }
        }
        if (mergedDoc.getPageCount() === 0) {
          return NextResponse.json({ error: '没有成功合并任何页面，请检查 PDF URL 是否可访问' }, { status: 400 });
        }
        const mergedBytes = await mergedDoc.save();
        return new NextResponse(new Uint8Array(mergedBytes), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(title || 'merged')}.pdf"`,
          },
        });
      }

      case 'split': {
        if (!body.pdfUrl) {
          return NextResponse.json({ error: '请提供 PDF URL' }, { status: 400 });
        }
        const resp = await fetch(body.pdfUrl, { signal: AbortSignal.timeout(30000) });
        if (!resp.ok) return NextResponse.json({ error: `获取 PDF 失败: ${resp.status}` }, { status: 400 });
        const pdfBytes = await resp.arrayBuffer();
        const srcDoc = await PDFDocument.load(pdfBytes);
        const totalPages = srcDoc.getPageCount();

        const ranges = body.pageRanges || [{ start: 0, end: totalPages - 1 }];
        // For split, return the first range only (single PDF response)
        const range = ranges[0];
        if (!range) return NextResponse.json({ error: '请提供页面范围' }, { status: 400 });
        const outDoc = await PDFDocument.create();
        const start = Math.max(0, range.start);
        const end = Math.min(totalPages - 1, range.end);
        const copiedPages = await outDoc.copyPages(srcDoc, Array.from({ length: end - start + 1 }, (_, i) => start + i));
        copiedPages.forEach(p => outDoc.addPage(p));
        const outBytes = await outDoc.save();
        return new NextResponse(new Uint8Array(outBytes), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(title || 'split')}.pdf"`,
          },
        });
      }

      case 'markdown': {
        if (!body.content) {
          return NextResponse.json({ error: '请提供 Markdown 内容' }, { status: 400 });
        }
        const pdfBytes = await buildMarkdownPdf(body.content, body.theme || 'tech-blue');
        return new NextResponse(new Uint8Array(pdfBytes), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(title || 'document')}.pdf"`,
          },
        });
      }

      case 'form': {
        // Fill form fields in a PDF (requires a template PDF with form fields)
        if (!body.pdfUrl || !body.fields) {
          return NextResponse.json({ error: '请提供 PDF URL 和表单字段' }, { status: 400 });
        }
        const resp = await fetch(body.pdfUrl, { signal: AbortSignal.timeout(30000) });
        if (!resp.ok) return NextResponse.json({ error: `获取 PDF 失败: ${resp.status}` }, { status: 400 });
        const pdfBytes = await resp.arrayBuffer();
        const doc = await PDFDocument.load(pdfBytes);
        const form = doc.getForm();
        for (const [key, value] of Object.entries(body.fields)) {
          try {
            const field = form.getTextField(key);
            field.setText(value);
          } catch {
            // Skip fields that don't exist
          }
        }
        const outBytes = await doc.save();
        return new NextResponse(new Uint8Array(outBytes), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(title || 'filled-form')}.pdf"`,
          },
        });
      }

      case 'watermark': {
        if (!body.pdfUrl || !body.watermarkText) {
          return NextResponse.json({ error: '请提供 PDF URL 和水印文字' }, { status: 400 });
        }
        const resp = await fetch(body.pdfUrl, { signal: AbortSignal.timeout(30000) });
        if (!resp.ok) return NextResponse.json({ error: `获取 PDF 失败: ${resp.status}` }, { status: 400 });
        const pdfBytes = await resp.arrayBuffer();
        const doc = await PDFDocument.load(pdfBytes);
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pages = doc.getPages();
        for (const page of pages) {
          const { width, height } = page.getSize();
          // Diagonal watermark repeated
          for (let x = -width; x < width * 2; x += 200) {
            for (let y = -height; y < height * 2; y += 150) {
              page.drawText(body.watermarkText, {
                x, y, size: 40, font, color: rgb(0.8, 0.8, 0.8), opacity: 0.15,
                rotate: degrees(45),
              });
            }
          }
        }
        const outBytes = await doc.save();
        return new NextResponse(new Uint8Array(outBytes), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(title || 'watermarked')}.pdf"`,
          },
        });
      }

      case 'extract': {
        if (!body.pdfUrl) {
          return NextResponse.json({ error: '请提供 PDF URL' }, { status: 400 });
        }
        const resp = await fetch(body.pdfUrl, { signal: AbortSignal.timeout(30000) });
        if (!resp.ok) return NextResponse.json({ error: `获取 PDF 失败: ${resp.status}` }, { status: 400 });
        const pdfBytes = await resp.arrayBuffer();
        const srcDoc = await PDFDocument.load(pdfBytes);
        const totalPages = srcDoc.getPageCount();
        const pageNums = body.pageNumbers || [0];
        const outDoc = await PDFDocument.create();
        for (const n of pageNums) {
          if (n >= 0 && n < totalPages) {
            const [copied] = await outDoc.copyPages(srcDoc, [n]);
            outDoc.addPage(copied);
          }
        }
        const outBytes = await outDoc.save();
        return new NextResponse(new Uint8Array(outBytes), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(title || 'extracted')}.pdf"`,
          },
        });
      }

      default:
        return NextResponse.json({ error: `不支持的 PDF 操作类型: ${type}` }, { status: 400 });
    }
  } catch (err: unknown) {
    console.error('[PDF Generate] Error:', err);
    return NextResponse.json({ error: 'PDF 生成失败，请检查输入参数' }, { status: 500 });
  }
}
