import { NextRequest } from 'next/server';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'text/plain',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'application/json',
  'text/csv',
  'text/html',
  'application/xml',
  'text/xml',
];

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return Response.json({ error: '未提供文件' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: `文件大小超过限制 (最大 ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    // 解析文件内容
    let text = '';
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (file.type === 'text/plain' || ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'json' || ext === 'xml' || ext === 'html' || ext === 'htm') {
      text = buffer.toString('utf-8');
    } else if (file.type === 'application/pdf' || ext === 'pdf') {
      // PDF 基础文本提取（使用简单方法）
      text = extractPdfText(buffer);
    } else if (file.type.includes('word') || ext === 'doc' || ext === 'docx') {
      // Word 文档基础文本提取
      text = extractDocxText(buffer);
    } else {
      // 尝试作为文本读取
      try {
        text = buffer.toString('utf-8');
      } catch {
        return Response.json({ error: '无法解析文件类型' }, { status: 400 });
      }
    }

    if (!text.trim()) {
      return Response.json({ error: '文件内容为空或无法提取文本' }, { status: 400 });
    }

    const truncated = text.slice(0, 50000); // 限制 50KB
    const lines = text.length;
    const chars = text.length;

    return Response.json({
      success: true,
      text: truncated,
      truncated: text.length > 50000,
      stats: { lines, chars, originalSize: file.size },
      filename: file.name,
    });
  } catch (e: unknown) {
    return Response.json({ error: `文件解析失败: ${e instanceof Error ? e.message : '未知错误'}` }, { status: 500 });
  }
}

function extractPdfText(buffer: Buffer): string {
  const str = buffer.toString('latin1');
  const results: string[] = [];

  // 匹配 PDF 文本流 (BT...ET)
  const streamRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let match;
  while ((match = streamRegex.exec(str)) !== null) {
    const content = match[1];
    // 匹配 Tj, TJ, ' 等文本操作符
    const textRegex = /\(([^)]*)\)\s*Tj/g;
    let textMatch;
    while ((textMatch = textRegex.exec(content)) !== null) {
      const t = textMatch[1];
      if (t.trim()) results.push(t);
    }
    // 匹配 TJ 数组
    const tjRegex = /\[([^\]]*)\]\s*TJ/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(content)) !== null) {
      const arrContent = tjMatch[1];
      const arrTextRegex = /\(([^)]*)\)/g;
      let arrTextMatch;
      while ((arrTextMatch = arrTextRegex.exec(arrContent)) !== null) {
        if (arrTextMatch[1].trim()) results.push(arrTextMatch[1]);
      }
    }
  }

  return results.join('\n') || '(PDF 文本提取受限，建议直接粘贴文本内容)';
}

function extractDocxText(buffer: Buffer): string {
  // DOCX 是 ZIP 格式，尝试提取文本
  try {
    // 简单方法：搜索 XML 中的文本节点
    const str = buffer.toString('utf-8');
    // 匹配 <w:t> 标签中的文本
    const regex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
    const results: string[] = [];
    let match;
    while ((match = regex.exec(str)) !== null) {
      const t = match[1].trim();
      if (t) results.push(t);
    }
    if (results.length > 0) return results.join(' ');

    // 备选：匹配普通文本
    const fallbackRegex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
    const fallback = str.match(fallbackRegex);
    if (fallback) {
      return fallback.map(f => f.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ');
    }
  } catch {
    // ignore
  }
  return '(DOCX 文本提取受限，建议直接粘贴文本内容)';
}
