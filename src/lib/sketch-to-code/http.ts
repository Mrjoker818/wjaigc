import { NextResponse } from 'next/server';

export class SketchHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = 'SketchHttpError'; }
}
export function sketchHttpId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256 || value !== value.trim() || /\p{Cc}/u.test(value)) throw new SketchHttpError(400, 'SKETCH_INPUT_INVALID');
  return value;
}
/** Only plain data descriptors: neither getters nor toJSON are input authority. */
export function sketchFields(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new SketchHttpError(400, 'SKETCH_INPUT_INVALID');
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key) || fields && !fields.includes(key) || !d || !('value' in d)) throw new SketchHttpError(400, 'SKETCH_INPUT_INVALID');
    copy[key] = d.value as unknown;
  }
  return copy;
}
export function sketchJson(value: Record<string, unknown>, status: number, requestId: string): NextResponse {
  return NextResponse.json({ ...value, requestId }, { status, headers: { 'Cache-Control': 'private, no-store', 'x-request-id': requestId } });
}
export function sketchError(error: unknown, requestId: string): NextResponse {
  const known = error instanceof SketchHttpError;
  return sketchJson({ success: false, code: known ? error.code : 'SKETCH_TASK_UNAVAILABLE', retryable: false }, known ? error.status : 503, requestId);
}
export function sketchAuthResponse(response: NextResponse, requestId: string): NextResponse {
  // Authentication service owns rejection status, not its potentially different envelope.
  return sketchJson({ success: false, code: 'AUTHENTICATION_REQUIRED', retryable: false }, response.status, requestId);
}

const MAX_BODY = 6 * 1024 * 1024;
const START_FIELDS = ['projectId', 'imageDataUrl', 'instruction', 'providerId', 'modelId', 'idempotencyKey'] as const;
/** Independent 10s ingress budget; never await a hung read or cancel on failure. */
export async function readSketchBody(request: { body: ReadableStream<Uint8Array> | null; headers: Headers; signal: AbortSignal }): Promise<Record<string, unknown>> {
  const invalid = (): SketchHttpError => new SketchHttpError(400, 'SKETCH_BODY_INVALID');
  if (request.signal.aborted) throw invalid();
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?\s*$/i.test(request.headers.get('content-type') ?? '')) throw new SketchHttpError(415, 'SKETCH_CONTENT_TYPE_INVALID');
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_BODY) {
    try { void request.body?.cancel().catch(() => undefined); } catch { /* rejection still returns promptly */ }
    throw new SketchHttpError(413, 'SKETCH_BODY_LIMIT');
  }
  if (!request.body) throw invalid();
  const reader = request.body.getReader(); let stopped = false; let cancelled = false;
  const cancel = (): void => {
    if (cancelled) return; cancelled = true;
    try { void reader.cancel().catch(() => undefined); } catch { /* no blocking cancellation */ }
  };
  let rejectStop!: (error: SketchHttpError) => void;
  const stop = new Promise<never>((_, reject) => { rejectStop = reject; });
  // Also handle abort before the first read/race has been registered.
  void stop.catch(() => undefined);
  const abort = (): void => { stopped = true; cancel(); rejectStop(invalid()); };
  const timer = setTimeout(() => { stopped = true; cancel(); rejectStop(new SketchHttpError(408, 'SKETCH_BODY_TIMEOUT')); }, 10_000);
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    if (request.signal.aborted) abort();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      if (stopped) return await stop;
      const chunk = await Promise.race([reader.read(), stop]);
      if (stopped || request.signal.aborted) throw invalid();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw invalid();
      size += chunk.value.byteLength;
      if (size > MAX_BODY) throw new SketchHttpError(413, 'SKETCH_BODY_LIMIT');
      chunks.push(chunk.value.slice());
    }
    const bytes = Buffer.concat(chunks); let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { throw invalid(); }
    const fields = sketchFields(value, START_FIELDS);
    if (Object.keys(fields).length !== START_FIELDS.length || START_FIELDS.some(key => typeof fields[key] !== 'string')) throw invalid();
    return fields;
  } catch (error) { cancel(); throw error instanceof SketchHttpError ? error : invalid(); }
  finally {
    clearTimeout(timer); request.signal.removeEventListener('abort', abort);
    try { reader.releaseLock(); } catch { /* pending real read may still own its stream */ }
  }
}
