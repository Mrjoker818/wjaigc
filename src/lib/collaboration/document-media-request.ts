import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { CanvasShareHttpError } from '@/lib/canvas-share/request';
import { binaryExtensions } from '@/lib/asset-core/binary-media-contract';
import { mediaImportCommandSchema } from './canvas-asset-command';

export class DocumentMediaError extends Error {
  constructor(readonly code: 'DOCUMENT_MEDIA_INVALID' | 'DOCUMENT_MEDIA_TOO_LARGE' | 'DOCUMENT_MEDIA_BUSY'
    | 'DOCUMENT_MEDIA_CANCELLED' | 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' | 'DOCUMENT_MEDIA_CONFLICT') {
    super(code);
  }
}
const id = z.string().min(1).max(256).refine(value => !!value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const base = z.object({ projectId: id, idempotencyKey: id, command: mediaImportCommandSchema }).strict();
const uploadSchema = base.extend({ filename: z.string().min(1).max(200).refine(value =>
  value === value.normalize('NFC') && /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(value) && !/[. ]$/u.test(value)) });
const adoptionSchema = base.extend({ taskId: id, outputIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), sourceVersionId: id.optional() });
const versionImportSchema = base.extend({ sourceVersionId: id });
export type MediaUploadRequest = z.infer<typeof uploadSchema>;
export type MediaAdoptionRequest = z.infer<typeof adoptionSchema>;
export type MediaImportCommand = z.infer<typeof mediaImportCommandSchema>;
export interface MediaVersionImportRequest {
  projectId: string;
  sourceVersionId: string;
  idempotencyKey: string;
  command: MediaImportCommand;
}
export function parseMediaVersionImport(value: unknown): MediaVersionImportRequest {
  const result = versionImportSchema.safeParse(value);
  if (!result.success) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  return result.data;
}
export const IMAGE_IMPORT_LIMIT = 32 * 1024 * 1024;
export const VIDEO_IMPORT_LIMIT = 512 * 1024 * 1024;

export function mediaImportLimit(mimeType: string): number {
  if (!binaryExtensions(mimeType) || !/^(image|video)\//u.test(mimeType)) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  return mimeType.startsWith('video/') ? VIDEO_IMPORT_LIMIT : IMAGE_IMPORT_LIMIT;
}
function parseJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID'); }
}
export function parseUploadHeaders(headers: Headers): { metadata: MediaUploadRequest; mimeType: string } {
  const encoded = headers.get('x-wujie-asset-import');
  if (!encoded || encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.length > 6144 || bytes.toString('base64url') !== encoded) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  const result = uploadSchema.safeParse(parseJson(bytes));
  if (!result.success) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  const mimeType = headers.get('content-type') ?? '';
  mediaImportLimit(mimeType);
  const extension = result.data.filename.split('.').pop()?.toLowerCase();
  if (!extension || !binaryExtensions(mimeType)?.includes(extension)) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  return { metadata: result.data, mimeType };
}
export function parseMediaAdoption(value: unknown): MediaAdoptionRequest {
  const result = adoptionSchema.safeParse(value);
  if (!result.success) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  return result.data;
}

export interface MediaDeadline { signal: AbortSignal; dispose(): void }
export function mediaDeadline(parent?: AbortSignal, milliseconds: number = 300_000): MediaDeadline {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new DocumentMediaError('DOCUMENT_MEDIA_CANCELLED'));
  const timer = setTimeout(abort, milliseconds);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  return { signal: controller.signal, dispose: (): void => { clearTimeout(timer); parent?.removeEventListener('abort', abort); } };
}
export function assertMediaActive(signal: AbortSignal): void {
  if (signal.aborted) throw new DocumentMediaError('DOCUMENT_MEDIA_CANCELLED');
}
export async function mediaAwait<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  assertMediaActive(signal);
  let rejectAbort: (reason: unknown) => void = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject): void => { rejectAbort = reject; });
  const abort = (): void => rejectAbort(new DocumentMediaError('DOCUMENT_MEDIA_CANCELLED'));
  signal.addEventListener('abort', abort, { once: true });
  try { return await Promise.race([operation, aborted]); }
  finally { signal.removeEventListener('abort', abort); }
}

let activePreparations = 0;
let reservedBytes = 0;
/** Reserve the format ceiling, never the untrusted Content-Length. No wait queue. */
export function reserveMediaPreparation(maxBytes: number, signal: AbortSignal): () => void {
  assertMediaActive(signal);
  if (activePreparations >= 2 || reservedBytes + maxBytes > VIDEO_IMPORT_LIMIT) throw new DocumentMediaError('DOCUMENT_MEDIA_BUSY');
  activePreparations++; reservedBytes += maxBytes;
  let released = false;
  return (): void => { if (!released) { released = true; activePreparations--; reservedBytes -= maxBytes; } };
}

declare const bodyBrand: unique symbol;
export interface ReadMediaBody { readonly [bodyBrand]: true }
interface BodyData { bytes?: Buffer; checksum: string; byteSize: number }
const bodies = new WeakMap<ReadMediaBody, BodyData>();
export function mediaBodyIdentity(body: ReadMediaBody): { checksum: string; byteSize: number } {
  const value = bodies.get(body);
  if (!value) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  return { checksum: value.checksum, byteSize: value.byteSize };
}
export function consumeMediaBody(body: ReadMediaBody): BodyData {
  const value = bodies.get(body);
  if (!value) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  bodies.delete(body);
  return value;
}
/** Hash every received byte on replays too; replay mode retains no body chunks. */
export async function readMediaBody(
  request: Request, maxBytes: number, signal: AbortSignal, discard: boolean = false,
): Promise<ReadMediaBody> {
  assertMediaActive(signal);
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^(0|[1-9][0-9]*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)))) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  if (declared !== null && Number(declared) > maxBytes) {
    void request.body?.cancel().catch((): void => undefined);
    throw new DocumentMediaError('DOCUMENT_MEDIA_TOO_LARGE');
  }
  if (!request.body) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  const deadline = mediaDeadline(signal, 120_000);
  const reader = request.body.getReader();
  const hash = createHash('sha256');
  const chunks: Buffer[] = [];
  let byteSize = 0;
  let complete = false;
  try {
    while (true) {
      const entry = await mediaAwait(reader.read(), deadline.signal);
      if (entry.done) break;
      byteSize += entry.value.byteLength;
      if (byteSize > maxBytes) throw new DocumentMediaError('DOCUMENT_MEDIA_TOO_LARGE');
      hash.update(entry.value);
      if (!discard) chunks.push(Buffer.from(entry.value));
    }
    assertMediaActive(deadline.signal);
    if (!byteSize || (declared !== null && Number(declared) !== byteSize)) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
    complete = true;
    const capability = Object.freeze({}) as ReadMediaBody;
    bodies.set(capability, { ...(discard ? {} : { bytes: Buffer.concat(chunks, byteSize) }), byteSize, checksum: hash.digest('hex') });
    return capability;
  } finally {
    if (!complete) void reader.cancel().catch((): void => undefined);
    reader.releaseLock(); deadline.dispose();
  }
}
export async function readMediaAdoptionJson(request: Request): Promise<MediaAdoptionRequest> {
  const deadline = mediaDeadline(request.signal, 120_000);
  try {
    const body = consumeMediaBody(await readMediaBody(request, 8192, deadline.signal));
    return parseMediaAdoption(parseJson(body.bytes!));
  } finally { deadline.dispose(); }
}
export async function readMediaVersionImportJson(request: Request): Promise<MediaVersionImportRequest> {
  const deadline = mediaDeadline(request.signal, 120_000);
  try {
    const body = consumeMediaBody(await readMediaBody(request, 8192, deadline.signal));
    return parseMediaVersionImport(parseJson(body.bytes!));
  } finally { deadline.dispose(); }
}

export function mediaImportResponse(data: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}
export function mediaImportFailure(error: unknown): NextResponse {
  if (error instanceof Error && error.message === 'ASSET_MEDIA_BUSY') return mediaImportResponse({ success: false, code: 'DOCUMENT_MEDIA_BUSY' }, 503);
  if (error instanceof CanvasShareHttpError) return mediaImportResponse({ success: false, code: 'DOCUMENT_MEDIA_INVALID' }, error.status);
  const statuses: Readonly<Record<string, number>> = {
    CANVAS_TASK_PUBLICATION_UNAVAILABLE: 503,
    DOCUMENT_FORBIDDEN: 403, DOCUMENT_ASSET_FORBIDDEN: 403, DOCUMENT_MEDIA_SOURCE_FORBIDDEN: 403,
    DOCUMENT_DISABLED: 503, DOCUMENT_PROJECT_NOT_ENABLED: 503, DOCUMENT_MEDIA_BUSY: 503,
    DOCUMENT_MEDIA_INVALID: 400, DOCUMENT_ASSET_COMMAND_INVALID: 400, DOCUMENT_MEDIA_CANCELLED: 400,
    DOCUMENT_MEDIA_TOO_LARGE: 413, DOCUMENT_MEDIA_CONFLICT: 409, DOCUMENT_ASSET_COMMAND_CONFLICT: 409,
  };
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
  if (Object.hasOwn(statuses, code)) return mediaImportResponse({ success: false, code }, statuses[code]);
  if (error instanceof Error && /^ASSET_(?:BINARY_FORMAT|FILENAME|MIME_TYPE|BYTES|MEDIA_PARSE)/u.test(error.message)) {
    return mediaImportResponse({ success: false, code: 'DOCUMENT_MEDIA_INVALID' }, 400);
  }
  return mediaImportResponse({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' }, 500);
}
