import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { videoForbidden } from '@/lib/drama/access';
import { readScriptFile, SCRIPT_FILE_LIMITS } from '@/lib/drama/script-file';
import { MAX_SOURCE_SCRIPT_CHARS, parseSourceScript, SourceScriptError } from '@/lib/drama/source-script';
import { DramaDocumentError, parseDramaProject } from '@/lib/drama/schema';
import { DIRECTOR_STYLE_IDS } from '@/lib/video-director/director-styles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_REQUEST_BYTES = SCRIPT_FILE_LIMITS.uploadBytes + 64 * 1024;
const settings = z.object({
  title: z.string().max(200).optional(), style: z.enum(DIRECTOR_STYLE_IDS).optional(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3', '3:4', '21:9']).optional(),
  fileName: z.string().max(255).optional(), format: z.enum(['text', 'txt', 'docx']).optional(),
});

/** Bound the actual stream, including chunked requests, before JSON or multipart allocates a body. */
async function readBody(request: NextRequest): Promise<ArrayBuffer> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) throw new SourceScriptError('DRAMA_SCRIPT_UPLOAD_LIMIT');
  if (!request.body) throw new SourceScriptError('DRAMA_SOURCE_EMPTY');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new SourceScriptError('DRAMA_SCRIPT_UPLOAD_LIMIT'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let pos = 0;
  for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.length; }
  return bytes.buffer;
}

/** Preview only: no project storage, background jobs, generation models or paid calls. */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const denied = videoForbidden(auth.user); if (denied) return denied;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^(?:application\/json|multipart\/form-data)(?:;|$)/i.test(contentType)) {
      return NextResponse.json({ error: '请粘贴剧本或上传 UTF-8 TXT、DOCX 文件', code: 'DRAMA_SCRIPT_CONTENT_TYPE' }, { status: 415 });
    }
    const bytes = await readBody(request);
    let text: string; let options: z.infer<typeof settings>; let warnings: string[] = [];
    if (/^multipart\//i.test(contentType)) {
      const form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
      if (form.getAll('file').length !== 1) throw new SourceScriptError('DRAMA_SCRIPT_FILE_REQUIRED');
      const file = form.get('file');
      if (!file || typeof file === 'string') throw new SourceScriptError('DRAMA_SCRIPT_FILE_REQUIRED');
      const fields: Record<string, unknown> = {};
      for (const key of ['title', 'style', 'aspectRatio']) {
        if (form.getAll(key).length > 1) throw new SourceScriptError('DRAMA_SCRIPT_SETTINGS_INVALID');
        const value = form.get(key); if (value !== null) fields[key] = value;
      }
      options = settings.parse(fields);
      const loaded = await readScriptFile(file);
      text = loaded.text; warnings = loaded.warnings;
      options = { ...options, fileName: loaded.fileName, format: loaded.format };
    } else {
      const body = z.object({ ...settings.shape, text: z.string().max(MAX_SOURCE_SCRIPT_CHARS) }).parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      text = body.text; options = settings.parse(body);
    }
    const parsed = parseSourceScript(text, options);
    return NextResponse.json({ success: true, ...parsed, doc: parseDramaProject(parsed.doc), warnings: [...warnings, ...parsed.warnings] });
  } catch (error) {
    if (error instanceof SourceScriptError) {
      return NextResponse.json({ error: '无法导入剧本，请检查格式、编码及文件大小后重试', code: error.code },
        { status: /LIMIT/.test(error.code) ? 413 : 400 });
    }
    if (error instanceof DramaDocumentError) {
      return NextResponse.json({ error: '剧本结构超出限制或格式不正确，请分段后导入', code: error.code }, { status: error.code === 'DRAMA_DOC_TOO_LARGE' ? 413 : 400 });
    }
    return NextResponse.json({ error: '请求内容不正确，请检查剧本或上传文件后重试', code: 'DRAMA_SCRIPT_IMPORT_INVALID' }, { status: 400 });
  }
}
