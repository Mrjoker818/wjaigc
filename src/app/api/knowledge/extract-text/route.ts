import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * POST /api/knowledge/extract-text
 * Body: { fileUrl: string, fileType: 'pdf' | 'docx' | 'txt' | 'md' }
 * Returns: { text: string, pageCount?: number }
 * 
 * Extracts text content from PDF, Word, TXT, and Markdown files
 * for knowledge base indexing and AI reference.
 */
export async function POST(req: NextRequest) {
  const tmpPath: string | null = null;

  try {
    const body = await req.json();
    const { fileUrl, fileType } = body;

    if (!fileUrl) {
      return NextResponse.json({ error: 'fileUrl is required' }, { status: 400 });
    }

    // Download the file
    let arrayBuffer: ArrayBuffer;

    if (fileUrl.startsWith('data:')) {
      // Base64 data URL
      const base64 = fileUrl.split(',')[1];
      arrayBuffer = Buffer.from(base64, 'base64').buffer;
    } else if (fileUrl.startsWith('http')) {
      // HTTP URL - download
      const resp = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) {
        return NextResponse.json({ error: `Failed to download file: ${resp.status}` }, { status: 400 });
      }
      arrayBuffer = await resp.arrayBuffer();
    } else if (fileUrl.startsWith('/')) {
      // Local file - read from public directory
      const localPath = path.join(process.cwd(), 'public', fileUrl);
      if (!fs.existsSync(localPath)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      arrayBuffer = fs.readFileSync(localPath).buffer;
    } else {
      return NextResponse.json({ error: 'Unsupported file URL format' }, { status: 400 });
    }

    const buffer = Buffer.from(arrayBuffer);
    const detectedType = fileType || detectFileType(fileUrl);

    switch (detectedType) {
      case 'pdf':
        return await extractPdfText(buffer);

      case 'docx':
        return await extractDocxText(buffer);

      case 'txt':
      case 'md':
        return extractPlainText(buffer);

      default:
        return NextResponse.json({ error: `Unsupported file type: ${detectedType}` }, { status: 400 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Knowledge Extract] error:', message);
    return NextResponse.json({ error: 'Text extraction failed', details: message }, { status: 500 });
  }
}

function detectFileType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.doc')) return 'docx';
  if (lower.endsWith('.txt')) return 'txt';
  if (lower.endsWith('.md')) return 'md';
  if (lower.endsWith('.markdown')) return 'md';
  return 'unknown';
}

async function extractPdfText(buffer: Buffer): Promise<NextResponse> {
  try {
    // Extract text from PDF buffer using simple stream parsing
    // PDFs store text in BT...ET blocks within page content streams
    const raw = buffer.toString('latin1');
    const textParts: string[] = [];

    // Extract text between BT and ET markers (text blocks in PDF content streams)
    const btRegex = /BT\s*([\s\S]*?)\s*ET/g;
    let match;
    while ((match = btRegex.exec(raw)) !== null) {
      const block = match[1];
      // Extract text within parentheses (Tj operator) or brackets (TJ operator)
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;

      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        const decoded = decodePdfString(tjMatch[1]);
        if (decoded.trim()) textParts.push(decoded);
      }

      let tjArrMatch;
      while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
        const arrContent = tjArrMatch[1];
        const strRegex = /\(([^)]*)\)/g;
        let strMatch;
        while ((strMatch = strRegex.exec(arrContent)) !== null) {
          const decoded = decodePdfString(strMatch[1]);
          if (decoded.trim()) textParts.push(decoded);
        }
      }
    }

    // Also try to find stream objects that might contain uncompressed text
    if (textParts.length === 0) {
      const streamRegex = /stream\s*\n([\s\S]*?)\nendstream/g;
      while ((match = streamRegex.exec(raw)) !== null) {
        const streamContent = match[1];
        const tjRegex = /\(([^)]*)\)\s*Tj/g;
        let tjMatch;
        while ((tjMatch = tjRegex.exec(streamContent)) !== null) {
          const decoded = decodePdfString(tjMatch[1]);
          if (decoded.trim()) textParts.push(decoded);
        }
      }
    }

    const text = textParts.join('\n').slice(0, 100000);

    return NextResponse.json({
      text: text || '(PDF text extraction yielded no readable content - the PDF may use compressed streams)',
      pageCount: undefined,
      metadata: {
        note: 'Basic extraction - for full text extraction, consider using OCR or a dedicated PDF parser',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PDF Extract] error:', message);
    return NextResponse.json({ error: 'PDF extraction failed', details: message }, { status: 500 });
  }
}

function decodePdfString(str: string): string {
  // Handle PDF escape sequences and octal codes
  return str
    .replace(/\\([nrtbf\\()])/g, (_, c) => {
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', '(': '(', ')': ')' };
      return map[c] || c;
    })
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

async function extractDocxText(buffer: Buffer): Promise<NextResponse> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });

    return NextResponse.json({
      text: result.value.slice(0, 100000),
      metadata: {
        warnings: result.messages.map(m => m.message),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[DOCX Extract] error:', message);
    return NextResponse.json({ error: 'DOCX extraction failed', details: message }, { status: 500 });
  }
}

function extractPlainText(buffer: Buffer): NextResponse {
  const text = buffer.toString('utf-8').slice(0, 100000);
  return NextResponse.json({
    text,
    metadata: { encoding: 'utf-8' },
  });
}
