import { NextResponse } from 'next/server';
import { getServerDataRoot } from '@/lib/server-data-root';
import { openServeUploadExportLocal, type OpenExportFile } from '@/lib/serve-upload-local-storage';
import { readBinaryFromS3Exact } from '@/lib/s3-storage';
import { recoverExportAssetBytes, validateExportAssetBytes } from './binary-persistence';
import { BINARY_MEDIA_CHUNK_BYTES, exportMediaDescriptor, MAX_ASSET_VIDEO_BYTES } from './binary-media-contract';

// Process-local admission, no pending queue: <=4 responses, <=512 MiB first-read/recovery buffers.
let active = 0;
let reserved = 0;
const verified = new Map<string, string>();

function reserve(bytes: number): () => void {
  if (reserved + bytes > MAX_ASSET_VIDEO_BYTES) throw new Error('MEDIA_BUSY');
  reserved += bytes;
  return () => { reserved -= bytes; };
}

async function readExact(file: OpenExportFile, start: number, length: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    signal.throwIfAborted();
    const part = await file.handle.read(bytes, offset, Math.min(length - offset, BINARY_MEDIA_CHUNK_BYTES), start + offset);
    signal.throwIfAborted();
    if (part.bytesRead === 0) throw new Error('Export truncated');
    offset += part.bytesRead;
  }
  await file.assertUnchanged();
  return bytes;
}

function selectedRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const suffix = match[1] === '';
  const first = Number(suffix ? match[2] : match[1]);
  const last = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || (suffix && first < 1)) return null;
  const start = suffix ? Math.max(0, size - first) : first;
  const end = suffix ? size - 1 : Math.min(last, size - 1);
  if (start >= size || end < start) return null;
  return { start, end: Math.min(end, start + BINARY_MEDIA_CHUNK_BYTES - 1) };
}

export async function serveBinaryMedia(request: Request, filename: string): Promise<NextResponse> {
  const descriptor = exportMediaDescriptor(filename);
  if (!descriptor) return new NextResponse(null, { status: 404 });
  if (active >= 4) return new NextResponse(null, { status: 503, headers: { 'Retry-After': '1' } });
  active++;
  let file: OpenExportFile | null = null;
  let closed = false;
  let streaming = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    try { await file?.handle.close(); } finally { active--; }
  };
  const onAbort = (): void => { if (streaming) void close().catch(() => undefined); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    const root = getServerDataRoot();
    file = await openServeUploadExportLocal(root, filename, descriptor.maxBytes);
    signal.throwIfAborted();
    if (!file) {
      const release = reserve(descriptor.maxBytes);
      try {
        const bytes = await readBinaryFromS3Exact(`exports/${filename}`, { maxBytes: descriptor.maxBytes, signal, timeoutMs: 60_000 });
        if (!bytes) { await close(); return new NextResponse(null, { status: 404 }); }
        await recoverExportAssetBytes({ bytes, filename, mimeType: descriptor.mimeType, signal });
      } finally { release(); }
      file = await openServeUploadExportLocal(root, filename, descriptor.maxBytes);
    }
    if (!file) throw new Error('Export missing');
    const cacheKey = `${root}/${filename}`;
    if (verified.get(cacheKey) !== file.identity) {
      const release = reserve(file.size);
      try {
        // One explicitly bounded initial validation. Future small ranges use identity + fd reads only.
        const bytes = await readExact(file, 0, file.size, signal);
        await validateExportAssetBytes({ bytes, filename, mimeType: descriptor.mimeType, signal });
        await file.assertUnchanged();
        if (verified.size >= 128) verified.delete(verified.keys().next().value!);
        verified.set(cacheKey, file.identity);
      } finally { release(); }
    }
    signal.throwIfAborted();
    await file.assertUnchanged();
    const rangeHeader = descriptor.video ? request.headers.get('range') : null;
    const range = selectedRange(rangeHeader, file.size);
    if (!range) {
      const size = file.size;
      await close();
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' } });
    }
    const headers: Record<string, string> = {
      'Content-Type': descriptor.mimeType, 'Content-Length': String(range.end - range.start + 1),
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400',
      ...(descriptor.video ? { 'Accept-Ranges': 'bytes' } : {}),
      ...(rangeHeader ? { 'Content-Range': `bytes ${range.start}-${range.end}/${file.size}` } : {}),
    };
    let position = range.start;
    const source = file;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        try {
          signal.throwIfAborted();
          if (closed) throw new Error('Media stream closed');
          await source.assertUnchanged();
          const bytes = await readExact(source, position, Math.min(BINARY_MEDIA_CHUNK_BYTES, range.end - position + 1), signal);
          signal.throwIfAborted();
          position += bytes.length;
          controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
          if (position > range.end) { controller.close(); await close(); }
        } catch (error) { controller.error(error); await close(); }
      },
      async cancel(): Promise<void> { await close(); },
    }, { highWaterMark: 0 });
    timer = setTimeout(onAbort, 60_000);
    timer.unref();
    streaming = true;
    return new NextResponse(body, { status: rangeHeader ? 206 : 200, headers });
  } catch (error) {
    await close();
    return new NextResponse(null, { status: error instanceof Error && error.message === 'MEDIA_BUSY' ? 503 : 404 });
  }
}
