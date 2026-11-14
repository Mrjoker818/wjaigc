import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import fontkit from '@pdf-lib/fontkit';
import {
  PDFDict, PDFDocument, PDFName, StandardFonts, adjustDimsForRotation, defaultTextFieldAppearanceProvider,
  degrees, rgb, type AppearanceProviderFor, type PDFFont, type PDFForm, type PDFTextField,
} from 'pdf-lib';
import { requireApiAuthOrReject } from '@/lib/api-auth';

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

const FONT_PATH = path.join(process.cwd(), 'src/lib/pdf/fonts/WujiePdfSansSC-Regular.ttf');
const graphemes = new Intl.Segmenter();
const words = new Intl.Segmenter('zh', { granularity: 'word' });
let fontBytes: Promise<Buffer> | undefined;

class UnsupportedPdfTextError extends Error {
  constructor() { super('PDF 字体不支持部分字符，请移除这些字符后重试'); }
}

async function embedChineseFont(document: PDFDocument, subset = true): Promise<PDFFont> {
  fontBytes ??= readFile(FONT_PATH).catch(error => {
    fontBytes = undefined;
    throw error;
  });
  document.registerFontkit(fontkit);
  return document.embedFont(await fontBytes, { subset });
}

function createFontSupportCheck(font: PDFFont): (text: string) => boolean {
  const characters = new Set(font.getCharacterSet());
  return text => {
    for (const unicode of text.replace(/[\r\n\t\f\v]/g, '')) {
      if (!characters.has(unicode.codePointAt(0)!)) return false;
    }
    return true;
  };
}

function registerFormFont(form: PDFForm, font: PDFFont): void {
  const { dict } = form.acroForm;
  const resourcesKey = PDFName.of('DR');
  const fontsKey = PDFName.of('Font');
  const resources = dict.lookupMaybe(resourcesKey, PDFDict) ?? form.doc.context.obj({});
  const fonts = resources.lookupMaybe(fontsKey, PDFDict) ?? form.doc.context.obj({});
  fonts.set(PDFName.of(font.name), font.ref);
  resources.set(fontsKey, fonts);
  dict.set(resourcesKey, resources);
}

function wrapPdfText(text: string, measure: (line: string) => number, availableWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  function flush() {
    if (line) lines.push(line.trimEnd());
    line = '';
  }

  for (const { segment: chunk } of words.segment(text)) {
    if (!chunk.trim() && !line) continue;
    if (measure(line + chunk) <= availableWidth) {
      line += chunk;
      continue;
    }
    if (measure(chunk) <= availableWidth) {
      flush();
      line = chunk.trimStart();
      continue;
    }
    for (const { segment } of graphemes.segment(chunk)) {
      if (line && measure(line + segment) > availableWidth) flush();
      if (line || segment.trim()) line += segment;
    }
  }
  flush();
  return lines;
}

const wrapChineseField: AppearanceProviderFor<PDFTextField> = (field, widget, font) => {
  if (!field.isMultiline()) return defaultTextFieldAppearanceProvider(field, widget, font);
  const originalText = field.getText() ?? '';
  const rotation = widget.getAppearanceCharacteristics()?.getRotation();
  const bounds = adjustDimsForRotation(widget.getRectangle(), rotation);
  const padding = (widget.getBorderStyle()?.getWidth() ?? 0) + 1;
  const width = bounds.width - 2 * padding;
  const height = bounds.height - 2 * padding;
  if (width <= 0 || height <= 0) return defaultTextFieldAppearanceProvider(field, widget, font);

  const appearance = widget.getDefaultAppearance() || field.acroField.getDefaultAppearance() || '';
  const fontSize = Number(/\/(?:[^\s]+)\s+(\d*\.?\d+)\s+Tf\b/.exec(appearance)?.[1]);
  const sourceLines = originalText.split(/\r\n|[\r\n]/);
  let size = fontSize > 0 ? fontSize : Math.min(12, height / font.heightAtSize(1));
  const wrapAtSize = () => sourceLines.flatMap(line => {
    const wrapped = wrapPdfText(line, value => font.widthOfTextAtSize(value, size), width - 0.01);
    return wrapped.length > 0 ? wrapped : [''];
  });
  let lines = wrapAtSize();
  while (!(fontSize > 0) && size > 4 && lines.length * font.heightAtSize(size) * 1.2 > height) {
    size = Math.max(4, size - 1);
    lines = wrapAtSize();
  }
  // Use the standard widget styling with line breaks only in the appearance stream.
  const getText = field.getText;
  field.getText = () => lines.join('\n');
  try {
    return defaultTextFieldAppearanceProvider(field, widget, font);
  } finally {
    field.getText = getText;
  }
};

// Simple markdown-to-PDF with basic formatting
async function buildMarkdownPdf(content: string, themeName: string): Promise<Uint8Array> {
  const theme = THEMES[themeName] || THEMES['tech-blue'];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const supportsStandardFont = createFontSupportCheck(font);
  const chineseFont = supportsStandardFont(content) ? null : await embedChineseFont(doc);
  const supportsChineseFont = chineseFont ? createFontSupportCheck(chineseFont) : null;

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
    const baseFont = bold ? fontBold : italic ? fontItalic : font;
    const f = chineseFont && !supportsStandardFont(text) ? chineseFont : baseFont;
    const x = margin + indent;
    const normalized = text.replace(/\r/g, '').replace(/\t/g, '    ');
    if (f === chineseFont && supportsChineseFont && !supportsChineseFont(normalized)) throw new UnsupportedPdfTextError();
    const wrapped = wrapPdfText(normalized, value => f.widthOfTextAtSize(value, size), maxWidth - indent);
    for (const line of wrapped) {
      if (y < margin + 40) newPage();
      page.drawText(line, { x, y, size, font: f, color: rgb(...color) });
      y -= size + 6;
    }
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
      if (y < margin + 40) newPage();
      const text = line.replace(/^[\s]*[-*+]\s/, '');
      page.drawText('•', { x: margin + 8, y: y + 1, size: fontSize, font, color: rgb(...theme.primary) });
      drawText(text, { indent: 24 });
      continue;
    }
    if (line.match(/^[\s]*\d+[.)]\s/)) {
      const match = line.match(/^([\s]*\d+[.)]\s)(.*)/);
      if (match) {
        if (y < margin + 40) newPage();
        page.drawText(match[1].trim(), { x: margin + 4, y: y + 1, size: fontSize, font: fontBold, color: rgb(...theme.primary) });
        drawText(match[2], { indent: 24 });
      }
      continue;
    }

    // Code blocks
    if (line.startsWith('```')) continue;

    // Blockquote
    if (line.startsWith('> ')) {
      if (y < margin + 40) newPage();
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
  const authResult = await requireApiAuthOrReject(req);
  if (authResult instanceof NextResponse) return authResult;
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
        const supportsDefaultFont = createFontSupportCheck(form.getDefaultFont());
        let chineseFont: PDFFont | undefined;
        let supportsChineseFont: ((text: string) => boolean) | undefined;
        for (const [key, value] of Object.entries(body.fields)) {
          if (typeof value !== 'string') continue;
          let field;
          try {
            field = form.getTextField(key);
            field.setText(value);
          } catch {
            // A template may omit the field or restrict the size of its value.
            continue;
          }
          if (!supportsDefaultFont(value)) {
            // Editable fields need the full font for their appearance and later edits.
            if (!chineseFont) {
              chineseFont = await embedChineseFont(doc, false);
              supportsChineseFont = createFontSupportCheck(chineseFont);
              registerFormFont(form, chineseFont);
            }
            if (!supportsChineseFont?.(value)) throw new UnsupportedPdfTextError();
            field.updateAppearances(chineseFont, wrapChineseField);
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
        const standardFont = await doc.embedFont(StandardFonts.Helvetica);
        const font = createFontSupportCheck(standardFont)(body.watermarkText) ? standardFont : await embedChineseFont(doc);
        if (font !== standardFont && !createFontSupportCheck(font)(body.watermarkText)) throw new UnsupportedPdfTextError();
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
    if (err instanceof UnsupportedPdfTextError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error('[PDF Generate] Error:', err);
    return NextResponse.json({ error: 'PDF 生成失败，请检查输入参数' }, { status: 500 });
  }
}
