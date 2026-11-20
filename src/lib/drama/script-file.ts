/** Bounded TXT/DOCX ingestion. ZIP metadata is inspected before any library decompresses it. */
import JSZip from 'jszip';
import { inflateRawSync } from 'node:zlib';
import { MAX_SOURCE_SCRIPT_CHARS, SourceScriptError } from './source-script';

export const SCRIPT_FILE_LIMITS = Object.freeze({
  uploadBytes: 5 * 1024 * 1024,
  entries: 256,
  entryBytes: 4 * 1024 * 1024,
  unpackedBytes: 16 * 1024 * 1024,
});
export interface ScriptFileResult { text: string; fileName: string; format: 'txt' | 'docx'; warnings: string[] }
function fail(code = 'DRAMA_SCRIPT_ZIP_INVALID'): never { throw new SourceScriptError(code); }

function extraFields(bytes: Buffer): void {
  let pos = 0;
  while (pos < bytes.length) {
    if (pos + 4 > bytes.length) fail();
    const id = bytes.readUInt16LE(pos); const size = bytes.readUInt16LE(pos + 2);
    if (id === 0x0001) fail('DRAMA_SCRIPT_ZIP64');
    pos += 4 + size;
    if (pos > bytes.length) fail();
  }
}

/** Validate both central and local headers, declared budgets, and actual bounded inflation. */
function preflightZip(bytes: Buffer): Set<string> {
  if (bytes.length < 22) fail();
  let eocd = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 22 - 65535); pos -= 1) {
    if (bytes.readUInt32LE(pos) === 0x06054b50 && pos + 22 + bytes.readUInt16LE(pos + 20) === bytes.length) { eocd = pos; break; }
  }
  if (eocd < 0) fail();
  if (eocd >= 20 && bytes.readUInt32LE(eocd - 20) === 0x07064b50) fail('DRAMA_SCRIPT_ZIP64');
  const disk = bytes.readUInt16LE(eocd + 4); const centralDisk = bytes.readUInt16LE(eocd + 6);
  const count = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12); const centralStart = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff) fail('DRAMA_SCRIPT_ZIP64');
  if (count > SCRIPT_FILE_LIMITS.entries) fail('DRAMA_SCRIPT_ENTRY_LIMIT');
  if (!count || disk || centralDisk || count !== bytes.readUInt16LE(eocd + 8) || centralStart + centralSize !== eocd) fail();
  const names = new Set<string>();
  const records: { method: number; compressed: number; unpacked: number; start: number; end: number; local: number }[] = [];
  let pos = centralStart; let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > eocd || bytes.readUInt32LE(pos) !== 0x02014b50) fail();
    const flags = bytes.readUInt16LE(pos + 8); const method = bytes.readUInt16LE(pos + 10);
    if (flags & 0x2041) fail('DRAMA_SCRIPT_ENCRYPTED');
    if (method !== 0 && method !== 8) fail();
    const compressed = bytes.readUInt32LE(pos + 20); const unpacked = bytes.readUInt32LE(pos + 24);
    const nameSize = bytes.readUInt16LE(pos + 28); const extraSize = bytes.readUInt16LE(pos + 30);
    const commentSize = bytes.readUInt16LE(pos + 32); const diskStart = bytes.readUInt16LE(pos + 34);
    const local = bytes.readUInt32LE(pos + 42);
    if ([compressed, unpacked, local].includes(0xffffffff) || diskStart === 0xffff) fail('DRAMA_SCRIPT_ZIP64');
    if (diskStart || !nameSize || pos + 46 + nameSize + extraSize + commentSize > eocd) fail();
    if (unpacked > SCRIPT_FILE_LIMITS.entryBytes || (total += unpacked) > SCRIPT_FILE_LIMITS.unpackedBytes) fail('DRAMA_SCRIPT_UNPACKED_LIMIT');
    const rawName = bytes.subarray(pos + 46, pos + 46 + nameSize);
    const name = rawName.toString('utf8');
    if (name.includes('\uFFFD') || /[\\\u0000-\u001f]/.test(name) || name.startsWith('/') || name.includes(':') || name.split('/').some(part => part === '.' || part === '..') || names.has(name)) fail();
    names.add(name);
    extraFields(bytes.subarray(pos + 46 + nameSize, pos + 46 + nameSize + extraSize));
    if (local + 30 > centralStart || bytes.readUInt32LE(local) !== 0x04034b50) fail();
    const localFlags = bytes.readUInt16LE(local + 6);
    if (bytes.readUInt32LE(local + 18) === 0xffffffff || bytes.readUInt32LE(local + 22) === 0xffffffff) fail('DRAMA_SCRIPT_ZIP64');
    if (localFlags & 0x2041) fail('DRAMA_SCRIPT_ENCRYPTED');
    if (localFlags !== flags || bytes.readUInt16LE(local + 8) !== method) fail();
    const localName = bytes.readUInt16LE(local + 26); const localExtra = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra; const end = start + compressed;
    if (end > centralStart || !rawName.equals(bytes.subarray(local + 30, local + 30 + localName))) fail();
    extraFields(bytes.subarray(local + 30 + localName, start));
    if (!(flags & 8) && (bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== unpacked)) fail();
    records.push({ method, compressed, unpacked, start, end, local });
    pos += 46 + nameSize + extraSize + commentSize;
  }
  if (pos !== eocd) fail();
  const ordered = [...records].sort((a, b) => a.local - b.local);
  if (ordered[0].local !== 0 || ordered.some((entry, i) => i > 0 && entry.local < ordered[i - 1].end)) fail();
  // A forged uncompressed-size field cannot bypass the budget. Inflate one entry at a time
  // with a hard native output cap, then require actual and advertised sizes to agree.
  for (const record of records) {
    let data: Buffer;
    try {
      const compressed = bytes.subarray(record.start, record.end);
      data = record.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: SCRIPT_FILE_LIMITS.entryBytes });
    } catch { fail('DRAMA_SCRIPT_UNPACKED_LIMIT'); }
    if (data.length !== record.unpacked) fail();
  }
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) fail('DRAMA_SCRIPT_NOT_DOCX');
  return names;
}

export async function readScriptFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<ScriptFileResult> {
  if (!Number.isFinite(file.size) || file.size < 1) fail('DRAMA_SOURCE_EMPTY');
  if (file.size > SCRIPT_FILE_LIMITS.uploadBytes) fail('DRAMA_SCRIPT_UPLOAD_LIMIT');
  if (!file.name || file.name.length > 255 || /[\/\\\u0000-\u001f]/.test(file.name)) fail('DRAMA_SCRIPT_FILENAME_INVALID');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'txt' && extension !== 'docx') fail('DRAMA_SCRIPT_FORMAT_UNSUPPORTED');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length > SCRIPT_FILE_LIMITS.uploadBytes) fail('DRAMA_SCRIPT_UPLOAD_LIMIT');
  let text: string; const warnings: string[] = [];
  if (extension === 'txt') {
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { fail('DRAMA_SCRIPT_UTF8_REQUIRED'); }
    if (text.includes('\u0000')) fail('DRAMA_SCRIPT_UTF8_REQUIRED');
  } else {
    const names = preflightZip(bytes);
    try {
      const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
      if (Object.keys(zip.files).length !== names.size) fail();
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: bytes });
      text = result.value;
      if (result.messages.length) warnings.push('DRAMA_SCRIPT_DOCX_WARNINGS: DOCX 中有未识别内容，请与原文件核对。');
    } catch (error) {
      if (error instanceof SourceScriptError) throw error;
      fail('DRAMA_SCRIPT_DOCX_INVALID');
    }
  }
  if (!text.trim()) fail('DRAMA_SOURCE_EMPTY');
  if (text.length > MAX_SOURCE_SCRIPT_CHARS) fail('DRAMA_SOURCE_LIMIT');
  return { text, fileName: file.name, format: extension, warnings };
}
