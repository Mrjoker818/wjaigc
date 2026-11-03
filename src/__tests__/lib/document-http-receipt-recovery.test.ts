import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconcileDocumentHttpOrphan, type RecoveryOptions, type RecoveryReceipt } from '@/lib/collaboration/document-http-receipt-recovery';
import type { DocumentHttpOperationRecord } from '@/lib/collaboration/document-http-transport';

const token = 's'.repeat(43);
const fingerprint = createHash('sha256').update(token).digest('hex');
const digest = 'a'.repeat(64);
const operationId = 'operation_00000001';
const receipt: RecoveryReceipt = { operationId, sessionFingerprint: fingerprint, updateDigest: digest, documentSequence: 12 };
const envelope = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function expectStarted(started: Promise<void>, result: Promise<unknown>): Promise<void> {
  await Promise.race([started, result.then(() => { throw new Error('request did not start'); }, () => { throw new Error('request did not start'); })]);
}
function setup(fetcher: RecoveryOptions['fetch'] = async () => envelope({ success: true, receipt })) {
  const descriptor = { sessionToken: token, sessionFingerprint: fingerprint, actorId: 'actor-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '7', expiresAt: '2026-11-01T12:00:00.000Z', retainUntil: '2026-11-02T12:00:00.000Z' };
  const expected: DocumentHttpOperationRecord = { operationId, sessionFingerprint: fingerprint, updateDigest: digest, actorId: 'actor-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '7' };
  let stored: DocumentHttpOperationRecord | undefined = { ...expected };
  const journal = {
    get: vi.fn(() => stored && { ...stored }),
    removeConfirmedOrphan: vi.fn((_id: string, _expected: DocumentHttpOperationRecord, _receipt: RecoveryReceipt) => { void _id; void _expected; void _receipt; stored = undefined; }),
  };
  let owned = true;
  const controller = new AbortController();
  const options: RecoveryOptions = { sessionDescriptor: descriptor, expectedRecord: expected, pendingId: 'pending-1', journal,
    assertLease: () => { if (!owned) throw new Error('private lease'); }, signal: controller.signal, fetch: fetcher };
  return { options, descriptor, expected, journal, controller, replace: (value: DocumentHttpOperationRecord | undefined) => { stored = value; }, get: () => stored, lose: () => { owned = false; } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('orphan receipt reconciliation through controlled fetch and journal', () => {
  it('only removes the matching orphan after exact receipt and uses the fixed same-origin request', async () => {
    const fetcher = vi.fn(async () => envelope({ success: true, receipt })); const f = setup(fetcher);
    await expect(reconcileDocumentHttpOrphan(f.options)).resolves.toEqual({ state: 'confirmed', documentSequence: 12 });
    expect(f.get()).toBeUndefined(); expect(f.journal.removeConfirmedOrphan).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/collaboration/document-exchange-receipt');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    const headers = new Headers(init.headers); expect(headers.get('content-type')).toBe('application/json'); expect(headers.get('x-wujie-expected-actor-id')).toBe('actor-a');
    expect(JSON.parse(String(init.body))).toEqual({ projectId: 'project-a', sessionToken: token, operationId, updateDigest: digest });
  });
  it('keeps the journal when receipt is null', async () => {
    const f = setup(async () => envelope({ success: true, receipt: null }));
    await expect(reconcileDocumentHttpOrphan(f.options)).resolves.toEqual({ state: 'unresolved' });
    expect(f.get()).toEqual(f.expected); expect(f.journal.removeConfirmedOrphan).not.toHaveBeenCalled();
  });
  it.each([
    { ...receipt, operationId: 'operation_00000002' }, { ...receipt, sessionFingerprint: 'b'.repeat(64) },
    { ...receipt, updateDigest: 'b'.repeat(64) }, { ...receipt, documentSequence: -1 },
    { ...receipt, documentSequence: Number.MAX_SAFE_INTEGER + 1 }, { ...receipt, extra: true },
  ])('preserves the record on a mismatched or invalid receipt %#', async wrong => {
    const fetcher = vi.fn(async () => envelope({ success: true, receipt: wrong })); const f = setup(fetcher);
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(f.get()).toEqual(f.expected); expect(f.journal.removeConfirmedOrphan).not.toHaveBeenCalled();
  });
  it.each([{ success: false, receipt }, { success: true, receipt, extra: 1 }, { success: true }, { receipt }])('rejects an invalid envelope %#', async payload => {
    const fetcher = vi.fn(async () => envelope(payload)); const f = setup(fetcher); await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(f.get()).toEqual(f.expected);
  });
  it('does not treat 403 as a definite rejection and cancels its unread response body', async () => {
    const cancel = vi.fn(); const f = setup(async () => new Response(new ReadableStream({ cancel }), { status: 403, headers: { 'content-type': 'application/json' } }));
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED');
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.get()).toEqual(f.expected);
  });
  it('cancels an oversized streaming response and retains the record', async () => {
    const cancel = vi.fn(); const f = setup(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4097)); }, cancel }), { headers: { 'content-type': 'application/json' } }));
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED');
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.get()).toEqual(f.expected);
  });
  it('bounds a stalled body after headers and cancels the reader', async () => {
    vi.useFakeTimers(); const started = deferred<void>(), cancel = vi.fn();
    const f = setup(async () => { started.resolve(); return new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }); });
    const result = reconcileDocumentHttpOrphan(f.options).catch(error => error as Error); await expectStarted(started.promise, result);
    await vi.advanceTimersByTimeAsync(10_001); expect(await result).toEqual(expect.objectContaining({ message: 'DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED' }));
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.get()).toEqual(f.expected); expect(vi.getTimerCount()).toBe(0);
  });
  it('uses one ten-second budget across delayed headers and a stalled body', async () => {
    vi.useFakeTimers(); const started = deferred<void>(), response = deferred<Response>(), cancel = vi.fn();
    const f = setup(() => { started.resolve(); return response.promise; });
    const result = reconcileDocumentHttpOrphan(f.options).catch(error => error as Error); await expectStarted(started.promise, result);
    await vi.advanceTimersByTimeAsync(7_000);
    response.resolve(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }));
    await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(3_001);
    expect(await result).toEqual(expect.objectContaining({ message: 'DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED' }));
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.get()).toEqual(f.expected); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a response delivered after the header deadline without touching the record', async () => {
    vi.useFakeTimers(); const started = deferred<void>(), response = deferred<Response>(), cancel = vi.fn();
    const f = setup(() => { started.resolve(); return response.promise; });
    const result = reconcileDocumentHttpOrphan(f.options).catch(error => error as Error); await expectStarted(started.promise, result);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await result).toEqual(expect.objectContaining({ message: 'DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED' }));
    response.resolve(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }));
    await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledTimes(1); expect(f.get()).toEqual(f.expected);
  });
  it('cancels a late response after abort without inspecting or changing the journal', async () => {
    const started = deferred<void>(), response = deferred<Response>(), cancel = vi.fn();
    const f = setup(() => { started.resolve(); return response.promise; });
    const result = reconcileDocumentHttpOrphan(f.options).catch(error => error as Error); await expectStarted(started.promise, result);
    f.controller.abort(); expect(await result).toEqual(expect.objectContaining({ message: 'DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED' }));
    response.resolve(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }));
    await Promise.resolve(); await Promise.resolve(); expect(cancel).toHaveBeenCalledTimes(1); expect(f.get()).toEqual(f.expected);
  });
  it('refuses to delete if the journal changes while awaiting the response', async () => {
    const started = deferred<void>(), response = deferred<Response>();
    const f = setup(() => { started.resolve(); return response.promise; }); const result = reconcileDocumentHttpOrphan(f.options);
    await expectStarted(started.promise, result); const replacement = { ...f.expected, operationId: 'operation_00000002' }; f.replace(replacement);
    response.resolve(envelope({ success: true, receipt })); await expect(result).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED');
    expect(f.get()).toEqual(replacement); expect(f.journal.removeConfirmedOrphan).not.toHaveBeenCalled();
  });
  it('refuses to remove after lease loss during fetch', async () => {
    const started = deferred<void>(), response = deferred<Response>(); const f = setup(() => { started.resolve(); return response.promise; });
    const result = reconcileDocumentHttpOrphan(f.options); await expectStarted(started.promise, result); f.lose(); response.resolve(envelope({ success: true, receipt }));
    await expect(result).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED'); expect(f.get()).toEqual(f.expected);
  });
  it('freezes the original descriptor and record before asynchronous work', async () => {
    const started = deferred<void>(), response = deferred<Response>(); let sent: RequestInit | undefined;
    const f = setup((_url, init) => { sent = init; started.resolve(); return response.promise; }); const result = reconcileDocumentHttpOrphan(f.options);
    await expectStarted(started.promise, result); f.descriptor.projectId = 'other'; f.expected.operationId = 'operation_00000002';
    response.resolve(envelope({ success: true, receipt })); await expect(result).resolves.toEqual({ state: 'confirmed', documentSequence: 12 });
    expect(JSON.parse(String(sent?.body)).projectId).toBe('project-a'); expect(f.journal.removeConfirmedOrphan.mock.calls[0][1].operationId).toBe(operationId);
  });
  it('rejects mismatched descriptor and record before contacting the endpoint', async () => {
    const fetcher = vi.fn(async () => envelope({ success: true, receipt })); const f = setup(fetcher); f.expected.projectId = 'foreign';
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a forged token fingerprint before sending a request', async () => {
    const fetcher = vi.fn(async () => envelope({ success: true, receipt })); const f = setup(fetcher);
    f.descriptor.sessionToken = 'z'.repeat(43);
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED');
    expect(fetcher).not.toHaveBeenCalled(); expect(f.get()).toEqual(f.expected);
  });
  it('rejects an absent original journal without sending a request', async () => {
    const fetcher = vi.fn(async () => envelope({ success: true, receipt })); const f = setup(fetcher); f.replace(undefined);
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects an abort raised synchronously during the initial lease check', async () => {
    const fetcher = vi.fn(async () => envelope({ success: true, receipt })); const f = setup(fetcher);
    f.options.assertLease = () => { f.controller.abort(); };
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED');
    expect(fetcher).not.toHaveBeenCalled(); expect(f.get()).toEqual(f.expected);
  });
  it('rejects malformed UTF-8 even when the response otherwise looks successful', async () => {
    const f = setup(async () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }));
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED'); expect(f.get()).toEqual(f.expected);
  });
  it('cancels an unread response with an unsupported content type', async () => {
    const cancel = vi.fn(); const f = setup(async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/plain' } }));
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED');
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.get()).toEqual(f.expected);
  });
  it('never claims confirmation if journal removal did not remove the record', async () => {
    const f = setup(); f.journal.removeConfirmedOrphan.mockImplementation(() => {});
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow('DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED'); expect(f.get()).toEqual(f.expected);
  });
  it('hides network and storage errors without removing the record', async () => {
    const fetcher = vi.fn(async () => { throw new Error('private token or URL'); }); const f = setup(fetcher);
    await expect(reconcileDocumentHttpOrphan(f.options)).rejects.toThrow(/^DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED$/u); expect(fetcher).toHaveBeenCalledTimes(1); expect(f.get()).toEqual(f.expected);
    const g = setup(); g.journal.removeConfirmedOrphan.mockImplementation(() => { throw new Error('private storage'); });
    await expect(reconcileDocumentHttpOrphan(g.options)).rejects.toThrow(/^DOCUMENT_HTTP_RECEIPT_RECOVERY_FAILED$/u); expect(g.journal.removeConfirmedOrphan).toHaveBeenCalledTimes(1); expect(g.get()).toEqual(g.expected);
  });
});
