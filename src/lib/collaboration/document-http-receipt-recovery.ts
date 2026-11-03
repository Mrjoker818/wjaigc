'use client';

import type { DocumentExchangeSessionDescriptor } from './document-exchange-session-protocol';
import type { DocumentHttpOperationRecord } from './document-http-transport';

export interface RecoveryReceipt { operationId: string; sessionFingerprint: string; updateDigest: string; documentSequence: number }
export interface RecoveryJournal {
  get(id: string): DocumentHttpOperationRecord | undefined;
  removeConfirmedOrphan(id: string, expected: DocumentHttpOperationRecord, receipt: RecoveryReceipt): void;
}
export interface RecoveryOptions {
  sessionDescriptor: DocumentExchangeSessionDescriptor;
  pendingId: string;
  expectedRecord: DocumentHttpOperationRecord;
  journal: RecoveryJournal;
  assertLease(): void;
  signal: AbortSignal;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

const failure = (): Error => new Error('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED');
const safe = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
  && v === v.trim() && !/[\u0000-\u001f\u007f]/u.test(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const generation = (v: unknown): v is string => typeof v === 'string' && /^(?:0|[1-9]\d{0,18})$/u.test(v)
  && BigInt(v) <= BigInt('9223372036854775807');
const recordKeys = ['operationId', 'sessionFingerprint', 'updateDigest', 'actorId', 'projectId', 'ownerId', 'grantGeneration'] as const;
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function record(value: unknown): DocumentHttpOperationRecord {
  if (!exact(value, recordKeys) || typeof value.operationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(value.operationId)
    || !hex(value.sessionFingerprint) || !hex(value.updateDigest) || !safe(value.actorId) || !safe(value.projectId)
    || !safe(value.ownerId) || !generation(value.grantGeneration)) throw failure();
  return { operationId: value.operationId, sessionFingerprint: value.sessionFingerprint, updateDigest: value.updateDigest,
    actorId: value.actorId, projectId: value.projectId, ownerId: value.ownerId, grantGeneration: value.grantGeneration };
}
function matches(a: DocumentHttpOperationRecord, b: DocumentHttpOperationRecord): boolean {
  return recordKeys.every(key => a[key] === b[key]);
}
function isReceipt(value: unknown, expected: DocumentHttpOperationRecord): value is RecoveryReceipt {
  return exact(value, ['operationId', 'sessionFingerprint', 'updateDigest', 'documentSequence'])
    && value.operationId === expected.operationId && value.sessionFingerprint === expected.sessionFingerprint
    && value.updateDigest === expected.updateDigest && typeof value.documentSequence === 'number'
    && Number.isSafeInteger(value.documentSequence) && value.documentSequence >= 0;
}
function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try { void reader.cancel().catch(() => undefined); } catch { /* Do not expose stream errors. */ }
}
function cancelBody(response: Response): void {
  try { if (response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); } catch { /* Best effort. */ }
}

/** Read one exact receipt; never replay or infer the result of an unknown operation. */
export async function reconcileDocumentHttpOrphan(options: RecoveryOptions): Promise<{ state: 'unresolved' } | { state: 'confirmed'; documentSequence: number }> {
  try {
    const source = options.sessionDescriptor;
    const descriptor = { sessionToken: source.sessionToken, sessionFingerprint: source.sessionFingerprint,
      actorId: source.actorId, projectId: source.projectId, ownerId: source.ownerId, grantGeneration: source.grantGeneration };
    const expected = Object.freeze(record(options.expectedRecord));
    const { pendingId, journal, signal, assertLease } = options;
    const fetcher = options.fetch ?? globalThis.fetch;
    if (!safe(pendingId, 512) || !journal || typeof journal.get !== 'function' || typeof journal.removeConfirmedOrphan !== 'function'
      || typeof assertLease !== 'function' || !signal || typeof signal.addEventListener !== 'function' || typeof fetcher !== 'function'
      || typeof descriptor.sessionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(descriptor.sessionToken)
      || !hex(descriptor.sessionFingerprint) || !safe(descriptor.actorId) || !safe(descriptor.projectId) || !safe(descriptor.ownerId)
      || !generation(descriptor.grantGeneration) || (descriptor.ownerId === descriptor.actorId) !== (descriptor.grantGeneration === '0')
      || descriptor.sessionFingerprint !== expected.sessionFingerprint || descriptor.actorId !== expected.actorId
      || descriptor.projectId !== expected.projectId || descriptor.ownerId !== expected.ownerId || descriptor.grantGeneration !== expected.grantGeneration) throw failure();

    let stopped = false, finished = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let response: Response | undefined;
    const requestAbort = new AbortController();
    let rejectStop: (reason: Error) => void = () => {};
    const stopping = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
    // Abort can fire synchronously before the first race attaches its rejection handler.
    void stopping.catch(() => undefined);
    const stop = (): void => {
      if (stopped || finished) return;
      stopped = true; rejectStop(failure());
      requestAbort.abort();
      if (reader) cancelReader(reader); else if (response) cancelBody(response);
    };
    const check = (): void => { if (stopped || signal.aborted) throw failure(); assertLease(); if (stopped || signal.aborted) throw failure(); };
    const timer = setTimeout(stop, 10_000);
    signal.addEventListener('abort', stop, { once: true });
    try {
      check();
      const first = journal.get(pendingId);
      check();
      if (!first || !matches(record(first), expected)) throw failure();
      const hashBuffer = await Promise.race([crypto.subtle.digest('SHA-256', new TextEncoder().encode(descriptor.sessionToken)), stopping]);
      check();
      const tokenHash = Array.from(new Uint8Array(hashBuffer), byte => byte.toString(16).padStart(2, '0')).join('');
      if (tokenHash !== descriptor.sessionFingerprint) throw failure();
      const request = Promise.resolve().then(() => {
        check();
        return fetcher('/api/collaboration/document-exchange-receipt', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: requestAbort.signal,
          headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': descriptor.actorId },
          body: JSON.stringify({ projectId: descriptor.projectId, sessionToken: descriptor.sessionToken,
            operationId: expected.operationId, updateDigest: expected.updateDigest }),
        });
      }).then(value => { if (stopped || finished || signal.aborted) cancelBody(value); return value; });
      response = await Promise.race([request, stopping]);
      check();
      if (response.status !== 200 || response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') throw failure();
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > 4096)) throw failure();
      if (!response.body) throw failure();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const next = await Promise.race([reader.read(), stopping]);
        check();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 4096) throw failure();
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!exact(data, ['success', 'receipt']) || data.success !== true) throw failure();
      if (data.receipt === null) { check(); return { state: 'unresolved' }; }
      if (!isReceipt(data.receipt, expected)) throw failure();
      const confirmed = Object.freeze({ operationId: data.receipt.operationId, sessionFingerprint: data.receipt.sessionFingerprint,
        updateDigest: data.receipt.updateDigest, documentSequence: data.receipt.documentSequence });
      check();
      const current = journal.get(pendingId);
      check();
      if (!current || !matches(record(current), expected)) throw failure();
      journal.removeConfirmedOrphan(pendingId, expected, confirmed);
      check();
      if (journal.get(pendingId) !== undefined) throw failure();
      check();
      return { state: 'confirmed', documentSequence: confirmed.documentSequence };
    } finally {
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', stop);
      requestAbort.abort();
      if (reader) { cancelReader(reader); try { reader.releaseLock(); } catch { /* Reader already released. */ } }
      else if (response) cancelBody(response);
    }
  } catch { throw failure(); }
}
