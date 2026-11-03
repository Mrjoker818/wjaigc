'use client';

import type * as YTypes from 'yjs';
// The document session uses the same Yjs instance.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Y: typeof YTypes = require('yjs');
import type { DocumentExchangeSessionDescriptor } from './document-exchange-session-protocol';
import type { PendingDocumentUpdateStore } from './document-client';

const ENDPOINT = '/api/collaboration/document-exchange';
const MAX_FRAME = 1_048_577;
const MAX_PULL = 5 * 1024 * 1024;
const MAX_RECEIPT = 4096;
const MAX_QUEUE = 256;
const MAX_WRITE_COUNT = 64;
const MAX_WRITE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const DOMAIN = new TextEncoder().encode('wujie-document-update-v1\0');

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
type Work = { kind: 'pull'; resolve: () => void; reject: (error: Error) => void }
  | { kind: 'write'; frame: Uint8Array; pendingId: string; operationId: string; recovered: boolean; prepared: Promise<{ hash: string } | { error: Error }> };

export interface DocumentHttpOperationRecord {
  operationId: string;
  sessionFingerprint: string;
  updateDigest: string;
  actorId: string;
  projectId: string;
  ownerId: string;
  grantGeneration: string;
}

/** Synchronous durable storage. put must be atomic and survive page reload before returning. */
export interface DocumentHttpOperationJournal {
  get(pendingId: string): DocumentHttpOperationRecord | undefined;
  put(pendingId: string, record: DocumentHttpOperationRecord): void;
  remove(pendingId: string): void;
}

export interface DocumentHttpTransportOptions {
  sessionDescriptor: DocumentExchangeSessionDescriptor;
  /** Must be the exact durable store supplied to the canvas document session. */
  pendingStore: PendingDocumentUpdateStore;
  /** A durable journal scoped to the same pending store, never a transient in-memory map. */
  operationJournal: DocumentHttpOperationJournal;
  fetch?: Fetch;
  pollIntervalMs?: number;
}

export interface DocumentHttpTransport {
  /** Attach this socket to createCanvasDocumentSession or replaceSocket before start(). */
  readonly socket: WebSocket;
  start(): Promise<void>;
  pull(): Promise<void>;
  close(): void;
}

function fail(message: string): Error { return new Error(message); }
class DefinitiveDocumentRejection extends Error {}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
function boundedText(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
function arrayBuffer(bytes: Uint8Array): ArrayBuffer { return bytes.slice().buffer as ArrayBuffer; }
function sequenceFrame(type: number, sequence: number): ArrayBuffer {
  const bytes = new Uint8Array(9); bytes[0] = type;
  new DataView(bytes.buffer).setBigUint64(1, BigInt(sequence)); return bytes.buffer;
}
async function digestUpdate(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(DOMAIN.length + bytes.length); input.set(DOMAIN); input.set(bytes, DOMAIN.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** A fail-closed HTTP adapter for the existing session; it never creates or renews a session. */
export function createDocumentHttpTransport(options: DocumentHttpTransportOptions): DocumentHttpTransport {
  const { pendingStore, operationJournal } = options;
  if (!operationJournal || typeof operationJournal.get !== 'function' || typeof operationJournal.put !== 'function' || typeof operationJournal.remove !== 'function') throw fail('DOCUMENT_HTTP_JOURNAL_REQUIRED');
  const descriptor = { ...options.sessionDescriptor };
  if (typeof descriptor.sessionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(descriptor.sessionToken) ||
      typeof descriptor.sessionFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(descriptor.sessionFingerprint) ||
      !boundedText(descriptor.projectId) || !boundedText(descriptor.actorId) || !boundedText(descriptor.ownerId) ||
      typeof descriptor.grantGeneration !== 'string' || !/^(?:0|[1-9]\d{0,18})$/u.test(descriptor.grantGeneration) ||
      BigInt(descriptor.grantGeneration) > BigInt('9223372036854775807') ||
      !boundedText(descriptor.expiresAt) || !boundedText(descriptor.retainUntil) ||
      !Number.isFinite(Date.parse(descriptor.expiresAt)) || !Number.isFinite(Date.parse(descriptor.retainUntil)) ||
      Date.parse(descriptor.expiresAt) > Date.parse(descriptor.retainUntil)) {
    throw fail('DOCUMENT_HTTP_DESCRIPTOR_INVALID');
  }
  const pollInterval = options.pollIntervalMs ?? 1500;
  if (!Number.isSafeInteger(pollInterval) || pollInterval < 1000 || pollInterval > 60_000) throw fail('DOCUMENT_HTTP_INTERVAL_INVALID');
  const request = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const queue: Work[] = [];
  let mirror = new Y.Doc();
  let initialized = false;
  let started = false;
  let busy = false;
  let closed = false;
  let epoch = 0;
  let lastPull = -1;
  let lastAck = -1;
  let interval: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const recoveredIds = new Set(pendingStore.load().map(update => update.id));
  let writeCount = 0;
  let writeBytes = 0;
  let identityCheck: Promise<void> | undefined;
  function identityMatches(record: DocumentHttpOperationRecord): boolean {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(record.operationId)
      && /^[a-f0-9]{64}$/u.test(record.updateDigest)
      && record.sessionFingerprint === descriptor.sessionFingerprint && record.actorId === descriptor.actorId
      && record.projectId === descriptor.projectId && record.ownerId === descriptor.ownerId
      && record.grantGeneration === descriptor.grantGeneration;
  }
  async function validateIdentity(expected: number): Promise<void> {
    identityCheck ??= crypto.subtle.digest('SHA-256', new TextEncoder().encode(descriptor.sessionToken)).then(buffer => {
      const fingerprint = Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
      if (fingerprint !== descriptor.sessionFingerprint) throw fail('DOCUMENT_HTTP_DESCRIPTOR_MISMATCH');
    });
    await identityCheck; checkEpoch(expected);
  }
  function sameRecord(a: DocumentHttpOperationRecord | undefined, b: DocumentHttpOperationRecord): boolean {
    return !!a && identityMatches(a) && a.operationId === b.operationId && a.updateDigest === b.updateDigest;
  }
  async function prepareWrite(work: { pendingId: string; frame: Uint8Array; operationId: string; recovered: boolean }, expected: number): Promise<{ hash: string } | { error: Error }> {
    try {
      const hash = await digestUpdate(work.frame.subarray(1)); checkEpoch(expected);
      const wanted: DocumentHttpOperationRecord = { operationId: work.operationId, sessionFingerprint: descriptor.sessionFingerprint,
        updateDigest: hash, actorId: descriptor.actorId, projectId: descriptor.projectId, ownerId: descriptor.ownerId,
        grantGeneration: descriptor.grantGeneration };
      const existing = operationJournal.get(work.pendingId);
      if (work.recovered) {
        if (!sameRecord(existing, wanted)) throw fail('DOCUMENT_HTTP_JOURNAL_MISMATCH');
      } else {
        if (existing) throw fail('DOCUMENT_HTTP_JOURNAL_COLLISION');
        operationJournal.put(work.pendingId, wanted);
        if (!sameRecord(operationJournal.get(work.pendingId), wanted)) throw fail('DOCUMENT_HTTP_JOURNAL_WRITE_FAILED');
      }
      checkEpoch(expected); return { hash };
    } catch (error) {
      stop(); return { error: error instanceof Error ? error : fail('DOCUMENT_HTTP_JOURNAL_FAILED') };
    }
  }

  const socketLike = {
    readyState: 1, binaryType: 'arraybuffer' as BinaryType,
    onmessage: null as ((event: MessageEvent) => void) | null,
    onclose: null as ((event: CloseEvent) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    send(data: ArrayBuffer | ArrayBufferView): void {
      if (closed || !initialized) { stop(); throw fail('DOCUMENT_HTTP_RECOVERY_REQUIRED'); }
      const length = data.byteLength;
      if (length < 2 || length > MAX_FRAME || writeCount >= MAX_WRITE_COUNT || writeBytes + length > MAX_WRITE_BYTES || queue.length >= MAX_QUEUE) {
        stop(); throw fail('DOCUMENT_HTTP_QUEUE_INVALID');
      }
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data.slice(0))
        : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      if (bytes[0] !== 0x02) { stop(); throw fail('DOCUMENT_HTTP_FRAME_INVALID'); }
      try { Y.decodeUpdate(bytes.subarray(1)); } catch { stop(); throw fail('DOCUMENT_HTTP_FRAME_INVALID'); }
      let record: ReturnType<PendingDocumentUpdateStore['load']>[number] | undefined;
      let prior: DocumentHttpOperationRecord | undefined;
      try {
        const durable = pendingStore.load();
        const pendingIndex = queue.filter(item => item.kind === 'write').length + (busyWrite ? 1 : 0);
        record = durable[pendingIndex];
        if (!record || !boundedText(record.id, 512) || record.rejected || !sameBytes(record.frame, bytes)) throw fail('DOCUMENT_HTTP_PENDING_MISMATCH');
        prior = operationJournal.get(record.id);
        if (recoveredIds.has(record.id) && (!prior || !identityMatches(prior))) throw fail('DOCUMENT_HTTP_RECOVERY_REQUIRED');
        if (!recoveredIds.has(record.id) && prior) throw fail('DOCUMENT_HTTP_JOURNAL_COLLISION');
      } catch (error) { stop(); throw error; }
      const partial = { frame: bytes, pendingId: record.id, operationId: prior?.operationId ?? crypto.randomUUID(), recovered: recoveredIds.has(record.id) };
      writeCount += 1; writeBytes += bytes.length;
      const prepared = prepareWrite(partial, epoch);
      queue.push({ kind: 'write', ...partial, prepared });
      void pump();
    },
    close(): void { stop(); },
  };
  let busyWrite: Extract<Work, { kind: 'write' }> | null = null;
  const socket = socketLike as unknown as WebSocket;
  function stop(code: 1006 | 4400 = 1006): void {
    if (closed) return;
    closed = true; epoch += 1; socketLike.readyState = 3;
    if (interval !== undefined) clearTimeout(interval);
    controller?.abort();
    for (const work of queue.splice(0)) if (work.kind === 'pull') work.reject(fail('DOCUMENT_HTTP_CLOSED'));
    mirror.destroy();
    socketLike.onclose?.({ code, reason: code === 4400 ? 'document rejected' : 'document HTTP unavailable' } as CloseEvent);
  }
  function checkEpoch(expected: number): void { if (closed || epoch !== expected) throw fail('DOCUMENT_HTTP_CLOSED'); }
  function schedule(): void {
    if (closed || !started) return;
    if (interval !== undefined) clearTimeout(interval);
    interval = setTimeout(() => { interval = undefined; void pull().catch(() => undefined); }, pollInterval);
  }
  async function exchange(frame: Uint8Array, operationId: string | undefined, expected: number): Promise<{ response: Response; read(limit: number): Promise<Uint8Array>; finish(): void }> {
    checkEpoch(expected);
    await validateIdentity(expected);
    const abort = new AbortController(); controller = abort;
    let timedOut = false;
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let finished = false;
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = (): void => reject(fail(timedOut ? 'DOCUMENT_HTTP_TIMEOUT' : 'DOCUMENT_HTTP_CLOSED'));
      abort.signal.addEventListener('abort', onAbort, { once: true });
    });
    // A synchronous fetch throw can occur before the first race attaches a handler.
    void cancelled.catch(() => undefined);
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, TIMEOUT_MS);
    const race = <T,>(p: Promise<T>): Promise<T> => Promise.race([p, cancelled]);
    const classify = (error: unknown): unknown => abort.signal.aborted
      ? fail(timedOut ? 'DOCUMENT_HTTP_TIMEOUT' : 'DOCUMENT_HTTP_CLOSED') : error;
    const cancelBody = (value: Response): void => {
      try { if (value.body && !value.body.locked) void value.body.cancel().catch(() => undefined); } catch { /* Best effort after abort. */ }
    };
    const finish = (): void => {
      if (finished) return;
      finished = true;
      abort.abort();
      if (reader) { try { void reader.cancel().catch(() => undefined); } catch { /* Already released. */ } }
      else if (response) cancelBody(response);
      clearTimeout(timer);
      abort.signal.removeEventListener('abort', onAbort);
      if (controller === abort) controller = undefined;
    };
    try {
      const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'x-wujie-document-session': descriptor.sessionToken,
        'x-wujie-project-id': descriptor.projectId, 'x-wujie-expected-actor-id': descriptor.actorId };
      if (operationId) headers['x-wujie-document-operation-id'] = operationId;
      if (!operationId && lastPull >= 0) headers['x-wujie-document-after-sequence'] = String(lastPull);
      const pendingResponse = request(ENDPOINT, { method: 'POST', headers, body: arrayBuffer(frame), signal: abort.signal,
        credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      // A controlled fetch, or a non-compliant implementation, can resolve after abort.
      void pendingResponse.then(value => { if (abort.signal.aborted || closed || epoch !== expected) cancelBody(value); }, () => undefined);
      response = await race(pendingResponse); checkEpoch(expected);
      const current = response;
      const read = async (limit: number): Promise<Uint8Array> => {
        const declared = current.headers.get('content-length');
        if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) throw fail('DOCUMENT_HTTP_RESPONSE_TOO_LARGE');
        if (!current.body) throw fail('DOCUMENT_HTTP_RESPONSE_EMPTY');
        reader = current.body.getReader(); const activeReader = reader; const chunks: Uint8Array[] = []; let length = 0;
        try {
          while (true) {
            const part = await race(activeReader.read()); checkEpoch(expected); if (part.done) break;
            length += part.value.length; if (length > limit) throw fail('DOCUMENT_HTTP_RESPONSE_TOO_LARGE'); chunks.push(part.value);
          }
        } catch (error) { throw classify(error); }
        finally { void activeReader.cancel().catch(() => undefined); activeReader.releaseLock(); if (reader === activeReader) reader = undefined; }
        const out = new Uint8Array(length); let at = 0; for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; } return out;
      };
      return { response: current, read, finish };
    } catch (error) { const classified = classify(error); finish(); throw classified; }
  }

  async function doPull(expected: number): Promise<void> {
    const vector = Y.encodeStateVector(mirror); const frame = new Uint8Array(vector.length + 1); frame[0] = 1; frame.set(vector, 1);
    const result = await exchange(frame, undefined, expected);
    try {
      const { response } = result;
      if (response.headers.get('x-wujie-document-session-fingerprint') !== descriptor.sessionFingerprint) throw fail('DOCUMENT_HTTP_PULL_IDENTITY');
      if (response.status === 204) { if (!initialized) throw fail('DOCUMENT_HTTP_INITIAL_EMPTY'); return; }
      if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/octet-stream') throw fail('DOCUMENT_HTTP_PULL_FAILED');
      const bytes = await result.read(MAX_PULL); checkEpoch(expected);
      if (bytes.length < 11 || bytes[0] !== 0x11) throw fail('DOCUMENT_HTTP_PULL_FRAME');
      const raw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(1);
      if (raw > BigInt(Number.MAX_SAFE_INTEGER) || Number(raw) < lastPull) throw fail('DOCUMENT_HTTP_PULL_SEQUENCE');
      const next = new Y.Doc();
      try {
        Y.applyUpdate(next, Y.encodeStateAsUpdate(mirror)); Y.applyUpdate(next, bytes.subarray(9));
        if (next.store.pendingStructs || next.store.pendingDs) throw fail('DOCUMENT_HTTP_PULL_DEPENDENCY');
        if (Y.encodeStateAsUpdate(next).byteLength > MAX_PULL) throw fail('DOCUMENT_HTTP_MIRROR_TOO_LARGE');
        checkEpoch(expected); socketLike.onmessage?.({ data: arrayBuffer(bytes) } as MessageEvent); checkEpoch(expected);
        mirror.destroy(); mirror = next; lastPull = Number(raw); initialized = true;
      } catch (error) { next.destroy(); throw error; }
    } finally { result.finish(); }
  }
  async function doWrite(work: Extract<Work, { kind: 'write' }>, expected: number): Promise<void> {
    const prepared = await work.prepared; checkEpoch(expected);
    if ('error' in prepared) throw prepared.error;
    const { hash } = prepared;
    const expectedRecord: DocumentHttpOperationRecord = { operationId: work.operationId, sessionFingerprint: descriptor.sessionFingerprint,
      updateDigest: hash, actorId: descriptor.actorId, projectId: descriptor.projectId, ownerId: descriptor.ownerId,
      grantGeneration: descriptor.grantGeneration };
    if (!sameRecord(operationJournal.get(work.pendingId), expectedRecord)) throw fail('DOCUMENT_HTTP_JOURNAL_MISMATCH');
    const result = await exchange(work.frame, work.operationId, expected);
    try {
      const { response } = result;
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (response.status === 422 && contentType === 'application/json') {
        const body = await result.read(MAX_RECEIPT); checkEpoch(expected);
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
            Object.keys(parsed).sort().join(',') === 'code,success' &&
            (parsed as Record<string, unknown>).success === false &&
            (parsed as Record<string, unknown>).code === 'DOCUMENT_EXCHANGE_REJECTED') {
          throw new DefinitiveDocumentRejection('DOCUMENT_EXCHANGE_REJECTED');
        }
        throw fail('DOCUMENT_HTTP_WRITE_FAILED');
      }
      if (response.status !== 200 || contentType !== 'application/json') throw fail('DOCUMENT_HTTP_WRITE_FAILED');
      const bytes = await result.read(MAX_RECEIPT); checkEpoch(expected);
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail('DOCUMENT_HTTP_RECEIPT_INVALID');
      const envelope = parsed as Record<string, unknown>; const value = envelope.receipt;
      if (Object.keys(envelope).sort().join(',') !== 'receipt,success' || envelope.success !== true || !value || typeof value !== 'object' || Array.isArray(value)) throw fail('DOCUMENT_HTTP_RECEIPT_INVALID');
      const receipt = value as Record<string, unknown>;
      if (Object.keys(receipt).sort().join(',') !== 'documentSequence,operationId,sessionFingerprint,updateDigest' ||
          receipt.operationId !== work.operationId || receipt.sessionFingerprint !== descriptor.sessionFingerprint || receipt.updateDigest !== hash ||
          !Number.isSafeInteger(receipt.documentSequence) || (receipt.documentSequence as number) < 0 || (receipt.documentSequence as number) < lastAck || (!work.recovered && (receipt.documentSequence as number) < lastPull)) throw fail('DOCUMENT_HTTP_RECEIPT_MISMATCH');
      const head = pendingStore.load()[0];
      if (!head || head.rejected || head.id !== work.pendingId || !sameBytes(head.frame, work.frame)) throw fail('DOCUMENT_HTTP_PENDING_MISMATCH');
      if (!sameRecord(operationJournal.get(work.pendingId), expectedRecord)) throw fail('DOCUMENT_HTTP_JOURNAL_MISMATCH');
      checkEpoch(expected); lastAck = receipt.documentSequence as number;
      socketLike.onmessage?.({ data: sequenceFrame(0x12, lastAck) } as MessageEvent); checkEpoch(expected);
      // Verify durable cleanup before sending the next operation.
      let stillPending: boolean;
      try { stillPending = pendingStore.load().some(item => item.id === work.pendingId); }
      catch { throw fail('DOCUMENT_HTTP_PENDING_CLEANUP_UNCONFIRMED'); }
      if (stillPending) throw fail('DOCUMENT_HTTP_PENDING_CLEANUP_UNCONFIRMED');
      try {
        if (sameRecord(operationJournal.get(work.pendingId), expectedRecord)) operationJournal.remove(work.pendingId);
      } catch {
        // Keep the journal on storage failure; the original operation identity remains recoverable.
      }
    } finally { result.finish(); }
  }
  async function pump(): Promise<void> {
    if (busy || closed) return;
    const work = queue.shift(); if (!work) { schedule(); return; }
    busy = true; busyWrite = work.kind === 'write' ? work : null; const expected = epoch;
    try {
      if (work.kind === 'pull') { await doPull(expected); work.resolve(); }
      else await doWrite(work, expected);
    } catch (error) {
      if (work.kind === 'pull') work.reject(error instanceof Error ? error : fail('DOCUMENT_HTTP_UNAVAILABLE'));
      stop(work.kind === 'write' && error instanceof DefinitiveDocumentRejection && !closed && epoch === expected ? 4400 : 1006);
    } finally { if (work.kind === 'write') { writeCount -= 1; writeBytes -= work.frame.length; } busyWrite = null; busy = false; if (!closed) void pump(); }
  }
  function pull(): Promise<void> {
    if (closed || !started || queue.length >= MAX_QUEUE) return Promise.reject(fail('DOCUMENT_HTTP_CLOSED'));
    if (interval !== undefined) { clearTimeout(interval); interval = undefined; }
    return new Promise<void>((resolve, reject) => { queue.push({ kind: 'pull', resolve, reject }); void pump(); });
  }
  return {
    socket,
    start(): Promise<void> {
      if (started || closed) return Promise.reject(fail('DOCUMENT_HTTP_ALREADY_STARTED'));
      try {
        for (const id of recoveredIds) {
          const record = operationJournal.get(id);
          if (record && !identityMatches(record)) throw fail('DOCUMENT_HTTP_RECOVERY_SCOPE_MISMATCH');
        }
      } catch (error) { stop(); return Promise.reject(error); }
      started = true; return pull();
    },
    pull,
    close: stop,
  };
}
