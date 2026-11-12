// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
// @ts-expect-error The existing jsdom dependency has no installed declarations.
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';
import { applyCanvasImagePatch, assertCanvasDocumentTransition, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { createBrowserPendingUpdateStore, useCollaborativeCanvas } from '@/lib/collaboration/document-client';
import { createDocumentHttpBrowserStorage } from '@/lib/collaboration/document-http-browser-storage';

const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const digest = (value: Uint8Array): string => createHash('sha256').update('wujie-document-update-v1\0').update(value).digest('hex');
const token = 'a'.repeat(43), ticket = 't'.repeat(43), cookieFingerprint = hash(token);
const descriptor = () => ({ actorId: 'editor-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '7',
  sessionToken: token, sessionFingerprint: cookieFingerprint,
  expiresAt: '2030-01-01T00:00:00.000Z', retainUntil: '2030-02-01T00:00:00.000Z' });
interface Receipt { operationId: string; sessionFingerprint: string; updateDigest: string; documentSequence: number }
let canonical: Y.Doc, sequence: number, writes: number, loseResponse: boolean, grant: string, readonly: boolean;
let requested: Array<{ url: string; body: unknown; headers: Headers }>, operations: string[];
let receipts: Map<string, Receipt>, held: Map<string, symbol>, wsAttempts: number;
const cleanups: Array<() => void> = [];
let safeRequests: Array<{url: string; action: string}>;
const safeViews: Array<() => { status: string; sequence: number; mediaCount: number }> = [];
class UnexpectedWebSocket { static readonly OPEN = 1; constructor() { wsAttempts++; throw Error('unexpected legacy WS'); } }
function json(data: unknown, status = 200): Response { return Response.json(data, { status }); }
function lockPlatform() {
  return { request: (name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>): Promise<void> => {
    if (held.has(name)) return Promise.resolve().then(() => callback(null));
    const identity = Symbol(name); held.set(name, identity);
    return Promise.resolve().then(() => callback({ name, mode: 'exclusive' } as Lock))
      .finally(() => { if (held.get(name) === identity) held.delete(name); });
  } };
}
function directory(): Response {
  const projection = readCanvasDocument(canonical), placement = projection.placements.p1;
  return json({ success: true, projectId: 'project-a', ownerId: 'owner-a', documentTransport: 'http',
    sequence, projection, readOnly: readonly, canvasImages: [{
      ...placement, id: 'image-p1', placementId: 'p1', url: '/api/serve-upload/p1.png', originalWidth: 80, originalHeight: 60, createdAt: 1,
    }] });
}
/** Controlled transport only: actual hook/manager/storage/session/Yjs run unmocked. */
async function transport(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input), headers = new Headers(init.headers);
  let body: unknown = undefined;
  if (typeof init.body === 'string') body = JSON.parse(init.body) as unknown;
  requested.push({ url, body, headers });
  const route=url.split('?')[0];let action='request';
  if(route.endsWith('document-exchange-session')){const candidate=(body as {action?:unknown})?.action;action=candidate==='start'||candidate==='renew'?candidate:'other';}
  if(route.endsWith('document-exchange') && init.body instanceof ArrayBuffer){const first=new Uint8Array(init.body)[0];action=first===1?'pull':first===2?'write':'other';}
  safeRequests.push({url:route,action});
  if (url.startsWith('/api/collaboration/document-project?')) return directory();
  if (url === '/api/collaboration/document-ticket') {
    if (headers.get('x-wujie-document-transport') !== 'http') return json({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' }, 409);
    return json({ success: true, ticket });
  }
  if (url === '/api/collaboration/document-exchange-session') {
    if (grant !== '7') return json({ success: false, code: 'DOCUMENT_EXCHANGE_FORBIDDEN' }, 403);
    return json({ success: true, session: descriptor() });
  }
  if (url === '/api/collaboration/document-exchange') {
    if (headers.get('x-wujie-document-session') !== token || grant !== '7') return json({ success: false, code: 'DOCUMENT_EXCHANGE_FORBIDDEN' }, 403);
    const frame = new Uint8Array(init.body as ArrayBuffer);
    if (frame[0] === 1) {
      const update = Y.encodeStateAsUpdate(canonical, frame.subarray(1)), result = new Uint8Array(update.length + 9);
      result[0] = 0x11; new DataView(result.buffer).setBigUint64(1, BigInt(sequence)); result.set(update, 9);
      return new Response(result.buffer, { headers: { 'Content-Type': 'application/octet-stream',
        'x-wujie-document-session-fingerprint': cookieFingerprint } });
    }
    if (frame[0] !== 2) throw Error('invalid controlled frame');
    const operationId = headers.get('x-wujie-document-operation-id')!, updateDigest = digest(frame.subarray(1));
    operations.push(operationId);
    let receipt = receipts.get(operationId);
    if (receipt && receipt.updateDigest !== updateDigest) return json({ success: false, code: 'DOCUMENT_EXCHANGE_CONFLICT' }, 409);
    if (!receipt) {
      const next = createCanvasDocument(); Y.applyUpdate(next, Y.encodeStateAsUpdate(canonical)); Y.applyUpdate(next, frame.subarray(1));
      assertCanvasDocumentTransition(canonical, next); canonical.destroy(); canonical = next; sequence++; writes++;
      receipt = { operationId, updateDigest, sessionFingerprint: cookieFingerprint, documentSequence: sequence };
      receipts.set(operationId, receipt);
    }
    if (loseResponse) { loseResponse = false; throw Error('controlled reply lost after canonical commit'); }
    return json({ success: true, receipt });
  }
  if (url === '/api/collaboration/document-exchange-receipt') {
    if (grant !== '7') return json({ success: false, code: 'DOCUMENT_EXCHANGE_FORBIDDEN' }, 403);
    const query = body as { operationId: string; updateDigest: string };
    const value = receipts.get(query.operationId);
    return json({ success: true, receipt: value?.updateDigest === query.updateDigest ? value : null });
  }
  throw Error('unexpected controlled endpoint');
}
beforeEach(() => {
  const dom = new JSDOM('', { url: 'https://fixture.invalid/' });
  vi.stubGlobal('localStorage', dom.window.localStorage); vi.stubGlobal('sessionStorage', dom.window.sessionStorage);
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('isSecureContext', true); held = new Map();
  vi.stubGlobal('navigator', { locks: lockPlatform() }); vi.stubGlobal('WebSocket', UnexpectedWebSocket);
  vi.stubGlobal('fetch', vi.fn(transport));
  canonical = createCanvasDocument(); applyCanvasImagePatch(canonical, {
    placementId: 'p1', assetVersionId: 'version-p1', x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
  }, 'controlled canonical seed');
  sequence = 1; writes = 0; grant = '7'; readonly = false; loseResponse = false; requested = []; safeRequests = []; operations = []; receipts = new Map(); wsAttempts = 0;
});
afterEach(async () => {
  console.info('SAFE_TRACE requests', safeRequests);console.info('SAFE_TRACE ui',safeViews.splice(0).map(view=>view()));
  while (cleanups.length) cleanups.pop()?.();
  await Promise.resolve(); await Promise.resolve(); canonical.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function mount() {
  const f = renderHook(() => useCollaborativeCanvas('project-a', 'editor-a', 'owner-a'));
  cleanups.push(f.unmount);safeViews.push(()=>({status:f.result.current.status,sequence:f.result.current.appliedServerSequence,mediaCount:f.result.current.canvasImages.length})); return f;
}
const starts = (): number => requested.filter(item => item.url.endsWith('document-exchange-session') && (item.body as { action?: string })?.action === 'start').length;
const renews = (): number => requested.filter(item => item.url.endsWith('document-exchange-session') && (item.body as { action?: string })?.action === 'renew').length;
const tickets = (): number => requested.filter(item => item.url.endsWith('document-ticket')).length;

describe('actual product hook with actual HTTP connection and controlled server', () => {
  it('initializes the real product session and confirms an edit with a durable exact receipt', async () => {
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(f.result.current.isWritable()).toBe(true); expect(tickets()).toBe(1); expect(starts()).toBe(1); expect(wsAttempts).toBe(0);
    expect(safeRequests.some(item=>item.action==='pull')).toBe(true);
    act(() => f.result.current.applyLocalChange({ placementId: 'p1', x: 51 }));
    await act(async () => { await f.result.current.waitForPendingUpdates(); });
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(readCanvasDocument(canonical).placements.p1.x).toBe(51); expect(writes).toBe(1);
    expect(createBrowserPendingUpdateStore('project-a', 'editor-a').load()).toHaveLength(0);
  });
  it('renews a stored original descriptor without requesting a new ticket or session', async () => {
    const storage = createDocumentHttpBrowserStorage({ actorId: 'editor-a', projectId: 'project-a',
      pendingStore: createBrowserPendingUpdateStore('project-a', 'editor-a'), assertLease: () => {} });
    await storage.saveDescriptor(descriptor()); const f = mount();
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(tickets()).toBe(0); expect(starts()).toBe(0); expect(renews()).toBe(1); expect(wsAttempts).toBe(0);
  });
  it('rebuilds recovery after a lost response and retries the identical operation only on explicit user action', async () => {
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('saved'));
    loseResponse = true; act(() => f.result.current.applyLocalChange({ placementId: 'p1', x: 62 }));
    // Recovery is visible before the renewed session and media are ready to resend.
    await waitFor(() => {
      expect(f.result.current.status).toBe('recovery');
      expect(f.result.current.recoveryRetryReady).toBe(true);
    }, { timeout: 2_500 });
    expect(writes).toBe(1); expect(operations).toHaveLength(1);
    expect(tickets()).toBe(1); expect(starts()).toBe(1);
    act(() => f.result.current.retryRecovered());
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(operations).toEqual([operations[0], operations[0]]); expect(writes).toBe(1);
    expect(createBrowserPendingUpdateStore('project-a', 'editor-a').load()).toHaveLength(0);
  });
  it('keeps the original pending and grant when a renewed authorization is rejected', async () => {
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('saved'));
    grant = '8'; act(() => f.result.current.applyLocalChange({ placementId: 'p1', x: 73 }));
    await waitFor(() => expect(f.result.current.status).toBe('recovery'), { timeout: 2_500 });
    expect(writes).toBe(0); expect(tickets()).toBe(1); expect(starts()).toBe(1);
    expect(createBrowserPendingUpdateStore('project-a', 'editor-a').load()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('wujie-canvas-document-http-session-v1:editor-a:project-a')!).grantGeneration).toBe('7');
    expect(f.result.current.recoveryRetryReady).toBe(false);
    expect(JSON.parse(f.result.current.exportRecoveryCopy()).pendingFrames).toHaveLength(1);
  });
  it('keeps a second writer out without minting while the first same-scope hook owns the lease', async () => {
    const first = mount(); await waitFor(() => expect(first.result.current.status).toBe('saved'));
    const second = mount(); await waitFor(() => expect(second.result.current.status).toBe('unavailable'));
    expect(first.result.current.isWritable()).toBe(true); expect(tickets()).toBe(1); expect(starts()).toBe(1); expect(wsAttempts).toBe(0);
  });
  it('never initializes an HTTP writer for the existing read-only project mode', async () => {
    readonly = true; const f = mount();
    await waitFor(() => expect(f.result.current.status).toBe('read-only'));
    expect(tickets()).toBe(0); expect(starts()).toBe(0); expect(renews()).toBe(0); expect(held.size).toBe(0);
  });
});
