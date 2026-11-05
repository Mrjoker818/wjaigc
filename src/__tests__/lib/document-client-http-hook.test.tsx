// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, StrictMode, useLayoutEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { useCollaborativeCanvas } from '@/lib/collaboration/document-client';
import type { DocumentHttpConnectionOptions } from '@/lib/collaboration/document-http-connection';

const boundary = vi.hoisted(() => ({ open: vi.fn(), ConnectionError: class extends Error {
  constructor(readonly code: string) { super(code); }
} }));
vi.mock('@/lib/collaboration/document-http-connection', () => ({
  openDocumentHttpConnection: boundary.open, DocumentHttpConnectionError: boundary.ConnectionError,
}));
class Socket {
  readyState = 1; binaryType = 'arraybuffer';
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });
  drop(code: number, reason = ''): void { this.readyState = 3; this.onclose?.({ code, reason } as CloseEvent); }
  snapshot(doc: Y.Doc): void {
    const update = Y.encodeStateAsUpdate(doc), bytes = new Uint8Array(update.length + 9); bytes[0] = 0x11;
    new DataView(bytes.buffer).setBigUint64(1, BigInt(1)); bytes.set(update, 9);
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }
}
class WsSocket extends Socket {
  static readonly OPEN = 1; static instances: WsSocket[] = [];
  static created: (() => void) | undefined;
  constructor(readonly url: string, readonly protocols: string[]) { super(); WsSocket.instances.push(this); WsSocket.created?.(); }
}
function memory(): Storage {
  const values = new Map<string, string>();
  return { get length(): number { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }, clear: () => { values.clear(); } };
}
const response = (value: unknown): Response => ({ ok: true, status: 200, json: async () => value } as Response);
let doc: Y.Doc, payload: Record<string, unknown>;
const cleanup: Array<() => void> = [];
beforeEach(() => {
  vi.resetAllMocks(); WsSocket.instances = []; WsSocket.created = undefined; vi.stubGlobal('WebSocket', WsSocket);
  vi.stubGlobal('localStorage', memory()); vi.stubGlobal('sessionStorage', memory());
  vi.stubGlobal('isSecureContext', false);
  doc = createCanvasDocument();
  applyCanvasImagePatch(doc, { placementId: 'p1', assetVersionId: 'version-p1', x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0 }, 'fixture');
  payload = { success: true, projectId: 'project-a', ownerId: 'owner-a', sequence: 1, projection: readCanvasDocument(doc),
    canvasImages: [{ id: 'image-p1', placementId: 'p1', assetVersionId: 'version-p1', url: '/api/serve-upload/p1.png',
      x: 10, y: 20, width: 80, height: 60, originalWidth: 80, originalHeight: 60, rotation: 0, zIndex: 0, createdAt: 1 }], readOnly: false };
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) =>
    response(String(url).startsWith('/api/collaboration/document-project?') ? payload
      : String(url).startsWith('/api/collaboration/document-enable?')
        ? { success: true, projectId: 'project-a', enabled: false, featureEnabled: true, currentRevision: 0 }
        : { success: true, ticket: 'a'.repeat(43) })));
  boundary.open.mockImplementation(async (options: DocumentHttpConnectionOptions) => {
    options.assertCurrent(); const socket = new Socket(), session = options.createSession(socket as unknown as WebSocket, options.createPendingStore());
    socket.snapshot(doc);
    return { session, close: vi.fn(async () => { session.disconnect(); }) };
  });
});
afterEach(() => {
  while (cleanup.length) cleanup.pop()?.(); doc.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function mount(ownerId: string | null = null) {
  const result = renderHook(({ actor }: { actor: string }) => useCollaborativeCanvas('project-a', actor, ownerId), { initialProps: { actor: 'editor-a' } });
  cleanup.push(result.unmount); return result;
}
const ticketCount = (): number => vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/collaboration/document-ticket').length;

describe('product hook chooses the authorized document transport', () => {
  it('uses the HTTP manager and the real session without opening a WebSocket', async () => {
    payload.documentTransport = 'http'; const f = mount();
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(boundary.open).toHaveBeenCalledTimes(1); expect(WsSocket.instances).toHaveLength(0); expect(ticketCount()).toBe(0);
    expect(boundary.open.mock.calls[0][0]).toMatchObject({ actorId: 'editor-a', projectId: 'project-a', ownerId: 'owner-a' });
    expect(f.result.current.isWritable()).toBe(true);
  });
  it('preserves the original WS behavior for an old directory with no HTTP traces', async () => {
    const f = mount(); await waitFor(() => expect(WsSocket.instances).toHaveLength(1));
    act(() => WsSocket.instances[0].snapshot(doc));
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(boundary.open).not.toHaveBeenCalled(); expect(ticketCount()).toBe(1);
  });
  it.each(['ws', undefined])('does not give unresolved HTTP records to WS when directory mode is %s', async mode => {
    if (mode) payload.documentTransport = mode;
    localStorage.setItem('wujie-canvas-document-http-session-v1:editor-a:project-a', 'retained unknown descriptor');
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('recovery'));
    expect(WsSocket.instances).toHaveLength(0); expect(ticketCount()).toBe(0); expect(boundary.open).not.toHaveBeenCalled();
    expect(f.result.current.recoveryRetryReady).toBe(false);
    expect(localStorage.getItem('wujie-canvas-document-http-session-v1:editor-a:project-a')).toBe('retained unknown descriptor');
  });
  it('rejects an unknown writable transport instead of falling back to WS', async () => {
    payload.documentTransport = 'invalid'; const f = mount();
    await waitFor(() => expect(f.result.current.status).toBe('unavailable'));
    expect(WsSocket.instances).toHaveLength(0); expect(ticketCount()).toBe(0); expect(boundary.open).not.toHaveBeenCalled();
  });
  it('preserves read-only geometry without starting either writer', async () => {
    payload.documentTransport = 'http'; payload.readOnly = true; const f = mount();
    await waitFor(() => expect(f.result.current.status).toBe('read-only'));
    expect(f.result.current.canvasImages[0].placementId).toBe('p1'); expect(f.result.current.isWritable()).toBe(false);
    expect(boundary.open).not.toHaveBeenCalled(); expect(WsSocket.instances).toHaveLength(0); expect(ticketCount()).toBe(0);
  });
  it('does not admit a legacy owner while this scope still has HTTP records', async () => {
    localStorage.setItem('wujie-canvas-document-http-journal-v1:editor-a:project-a:pending', 'retained unknown journal');
    const f = mount('editor-a'); await waitFor(() => expect(f.result.current.status).toBe('recovery'));
    expect(f.result.current.authority).not.toBe('legacy'); expect(ticketCount()).toBe(0); expect(f.result.current.isWritable()).toBe(false);
  });
  it('does not issue even a WS ticket when HTTP trace storage cannot be inspected', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw Error('controlled storage refusal'); });
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('unavailable'));
    expect(ticketCount()).toBe(0); expect(WsSocket.instances).toHaveLength(0);
  });
  it('closes a completed HTTP connection when the product scope unmounts', async () => {
    payload.documentTransport = 'http'; const f = mount();
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    const connection = await boundary.open.mock.results[0].value; f.unmount();
    expect(connection.close).toHaveBeenCalledTimes(1); expect(connection.session.status).toBe('unavailable');
  });
  it('exports a safe pending-only recovery copy when no document session can be created', async () => {
    payload.documentTransport = 'http';
    boundary.open.mockImplementation(async (options: DocumentHttpConnectionOptions) => {
      options.onRecovery({ actorId: 'editor-a', projectId: 'project-a', pendingFrames: [{ frameBase64: 'AgAA', rejected: false }] });
      throw new boundary.ConnectionError('RECOVERY_REQUIRED');
    });
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('recovery'));
    const copy = JSON.parse(f.result.current.exportRecoveryCopy());
    expect(copy.pendingFrames).toEqual([{ frameBase64: 'AgAA', rejected: false }]); expect(copy).not.toHaveProperty('projection');
    expect(f.result.current.recoveryRetryReady).toBe(false); expect(WsSocket.instances).toHaveLength(0);
  });
  it('refuses a retained old session factory and closes only a late old connection after the actor changes', async () => {
    payload.documentTransport = 'http';
    let old!: DocumentHttpConnectionOptions;
    let finish!: (value: { session: ReturnType<DocumentHttpConnectionOptions['createSession']>; close: () => Promise<void> }) => void;
    let stale!: { session: ReturnType<DocumentHttpConnectionOptions['createSession']>; close: ReturnType<typeof vi.fn> };
    boundary.open.mockImplementationOnce((options: DocumentHttpConnectionOptions) => {
      old = options; const socket = new Socket(), session = options.createSession(socket as unknown as WebSocket, options.createPendingStore());
      socket.snapshot(doc); stale = { session, close: vi.fn(async () => { session.disconnect(); }) };
      return new Promise(resolve => { finish = resolve; });
    });
    const f = mount(); await waitFor(() => expect(boundary.open).toHaveBeenCalledTimes(1));
    f.rerender({ actor: 'editor-b' }); await waitFor(() => expect(boundary.open).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(() => old.createSession(new Socket() as unknown as WebSocket, old.createPendingStore())).toThrow();
    await act(async () => { finish(stale); await Promise.resolve(); });
    expect(stale.close).toHaveBeenCalledTimes(1); expect(f.result.current.isWritable()).toBe(true);
  });
  it('keeps an unknown HTTP start marker out of the WS path', async () => {
    localStorage.setItem('wujie-canvas-document-http-start-unknown-v1:editor-a:project-a', 'retained start uncertainty');
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('recovery'));
    expect(ticketCount()).toBe(0); expect(WsSocket.instances).toHaveLength(0);
  });
  it('does not bypass an available native writer lease already held by another page', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => callback(null) } });
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('unavailable'));
    expect(ticketCount()).toBe(0); expect(WsSocket.instances).toHaveLength(0);
  });
  it('releases a newly acquired WS lease when its pending store fails before any session is created', async () => {
    vi.stubGlobal('isSecureContext', true); let held = false;
    localStorage.setItem('wujie-canvas-document-pending-v1:editor-a:project-a:frame', 'AgAA');
    vi.stubGlobal('navigator', { locks: { request: async (name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
      held = true; vi.spyOn(localStorage, 'key').mockImplementation(() => { throw Error('controlled pending read failure'); });
      try { return await callback({ name, mode: 'exclusive' } as Lock); } finally { held = false; }
    } } });
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('unavailable'));
    expect(held).toBe(false); expect(ticketCount()).toBe(0); expect(WsSocket.instances).toHaveLength(0);
  });
  it('rechecks the authorized directory when the ticket reports a transport change', async () => {
    const previous = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === '/api/collaboration/document-ticket') {
        payload.documentTransport = 'http';
        return { ok: false, status: 409, json: async () => ({ success: false, code: 'DOCUMENT_TRANSPORT_CHANGED' }) } as Response;
      }
      return previous(url, init);
    });
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('saved'), { timeout: 2_500 });
    expect(boundary.open).toHaveBeenCalledTimes(1); expect(WsSocket.instances).toHaveLength(0); expect(ticketCount()).toBe(1);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/collaboration/document-project?')).length).toBeGreaterThanOrEqual(2);
  });
  it('bounds automatic HTTP reconnects and permits a fresh bounded attempt on user focus', async () => {
    vi.useFakeTimers(); payload.documentTransport = 'http';
    boundary.open.mockRejectedValue(new boundary.ConnectionError('UNAVAILABLE')); mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(boundary.open).toHaveBeenCalledTimes(4); expect(WsSocket.instances).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(boundary.open).toHaveBeenCalledTimes(8); expect(vi.getTimerCount()).toBe(0);
  });
  it('binds directory, owner status and WS ticket reads to the frozen actor', async () => {
    const f = mount('editor-a');
    await waitFor(() => expect(f.result.current.authority).toBe('legacy'));
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('x-wujie-expected-actor-id')).toBe('editor-a');
    f.unmount();
    mount(); await waitFor(() => expect(WsSocket.instances).toHaveLength(1));
    for (const [, init] of vi.mocked(fetch).mock.calls) expect(new Headers(init?.headers).get('x-wujie-expected-actor-id')).toBe('editor-a');
  });
  it('treats an actor mismatch as terminal without issuing a ticket or retrying', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 409, json: async () => ({ success: false, code: 'ACTOR_SCOPE_CHANGED' }) } as Response);
    const f = mount(); await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(f.result.current.authority).not.toBe('legacy'); expect(ticketCount()).toBe(0);
    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retains document authority and pending when an established editor is later reported not enabled', async () => {
    const f = mount(); await waitFor(() => expect(WsSocket.instances).toHaveLength(1));
    act(() => WsSocket.instances[0].snapshot(doc));
    act(() => f.result.current.applyLocalChange({ placementId: 'p1', x: 91 }));
    const pending = new Map(Array.from({ length: localStorage.length }, (_, i) => { const k = localStorage.key(i)!; return [k, localStorage.getItem(k)!]; }));
    const previous = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).startsWith('/api/collaboration/document-project?')
      ? { ok: false, status: 409, json: async () => ({ success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' }) } as Response : previous(url, init));
    vi.useFakeTimers(); act(() => WsSocket.instances[0].drop(1012, 'document transport changed'));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(f.result.current.authority).toBe('document'); expect(f.result.current.status).toBe('recovery');
    expect(JSON.parse(f.result.current.exportRecoveryCopy()).pendingFrames).toHaveLength(1);
    for (const [key, value] of pending) expect(localStorage.getItem(key)).toBe(value);
    expect(ticketCount()).toBe(1);
  });
  it('rejects retained retry and disconnect callbacks after an actor switch', async () => {
    payload.documentTransport = 'http';
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('saved'));
    const old = f.result.current;
    f.rerender({ actor: 'editor-b' }); await waitFor(() => expect(boundary.open).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    const connection = await boundary.open.mock.results[1].value;
    const retry = vi.spyOn(connection.session, 'retryRecovered');
    expect(() => old.retryRecovered()).toThrow(); expect(retry).not.toHaveBeenCalled();
    act(() => old.disconnect());
    expect(connection.close).not.toHaveBeenCalled(); expect(f.result.current.isWritable()).toBe(true);
  });
  it('closes a new WS if the second pending read fails during session creation', async () => {
    WsSocket.created = () => { vi.spyOn(localStorage, 'key').mockImplementation(() => { throw Error('controlled second read'); }); };
    localStorage.setItem('unrelated-fixture-key', 'fixture');
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('unavailable'));
    expect(WsSocket.instances).toHaveLength(1); expect(WsSocket.instances[0].close).toHaveBeenCalledOnce();
  });
  it('exports only raw pending when access is denied before any trusted snapshot', async () => {
    localStorage.setItem('wujie-canvas-document-pending-v1:editor-a:project-a:frame', 'AgAA');
    const f = mount(); await waitFor(() => expect(WsSocket.instances).toHaveLength(1));
    act(() => WsSocket.instances[0].drop(1008, 'document unavailable'));
    expect(f.result.current.status).toBe('recovery');
    const copy = JSON.parse(f.result.current.exportRecoveryCopy());
    expect(copy.pendingFrames).toHaveLength(1); expect(copy.unconfirmedOnly).toBe(true); expect(copy).not.toHaveProperty('projection');
  });
  it('exports existing pending without a projection when HTTP traces block a WS writer', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { locks: { request: async (name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => callback({ name, mode: 'exclusive' } as Lock) } });
    localStorage.setItem('wujie-canvas-document-http-start-unknown-v1:editor-a:project-a', '1');
    localStorage.setItem('wujie-canvas-document-pending-v1:editor-a:project-a:frame', 'AgAA');
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('recovery'));
    const copy = JSON.parse(f.result.current.exportRecoveryCopy());
    expect(copy.unconfirmedOnly).toBe(true); expect(copy.pendingFrames).toHaveLength(1); expect(copy).not.toHaveProperty('projection');
    expect(localStorage.getItem('wujie-canvas-document-pending-v1:editor-a:project-a:frame')).toBe('AgAA');
  });
  it('does not advertise export when HTTP traces exist but their storage cannot be safely read', async () => {
    localStorage.setItem('wujie-canvas-document-http-start-unknown-v1:editor-a:project-a', '1');
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('recovery'));
    expect((f.result.current as typeof f.result.current & { recoveryExportReady?: boolean }).recoveryExportReady).toBe(false);
  });
  it('does not advertise an empty manager recovery copy as user content', async () => {
    payload.documentTransport = 'http';
    boundary.open.mockImplementation(async (options: DocumentHttpConnectionOptions) => {
      options.onRecovery({ actorId: 'editor-a', projectId: 'project-a', pendingFrames: [] });
      throw new boundary.ConnectionError('RECOVERY_REQUIRED');
    });
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('recovery'));
    expect(f.result.current.recoveryExportReady).toBe(false);
    expect(() => f.result.current.exportRecoveryCopy()).toThrow();
  });
  it('rechecks HTTP mode changes without classifying them as lost authorization', async () => {
    payload.documentTransport = 'http';
    boundary.open.mockImplementationOnce(async () => { payload.documentTransport = 'ws'; throw new boundary.ConnectionError('TRANSPORT_CHANGED'); });
    const f = mount(); await waitFor(() => expect(WsSocket.instances).toHaveLength(1), { timeout: 2_500 });
    act(() => WsSocket.instances[0].snapshot(doc));
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(boundary.open).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/collaboration/document-project?')).length).toBeGreaterThanOrEqual(2);
  });
  it('rechecks mode even when a rejected WS session receives 1012', async () => {
    localStorage.setItem('wujie-canvas-document-pending-v1:editor-a:project-a:frame', 'AwAA');
    const f = mount(); await waitFor(() => expect(WsSocket.instances).toHaveLength(1));
    act(() => WsSocket.instances[0].snapshot(doc)); expect(f.result.current.status).toBe('rejected');
    payload.documentTransport = 'http'; vi.useFakeTimers();
    act(() => WsSocket.instances[0].drop(1012, 'document transport changed'));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(boundary.open).toHaveBeenCalledTimes(1); expect(WsSocket.instances).toHaveLength(1);
    expect(localStorage.getItem('wujie-canvas-document-pending-v1:editor-a:project-a:frame')).toBe('AwAA');
  });
  it('releases a WS lease and preserves recovery when a reinspection becomes read-only', async () => {
    vi.stubGlobal('isSecureContext', true); let held = false;
    vi.stubGlobal('navigator', { locks: { request: async (name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
      held = true; try { return await callback({ name, mode: 'exclusive' } as Lock); } finally { held = false; }
    } } });
    const f = mount(); await waitFor(() => expect(WsSocket.instances).toHaveLength(1));
    act(() => WsSocket.instances[0].snapshot(doc)); act(() => f.result.current.applyLocalChange({ placementId: 'p1', x: 91 }));
    expect(held).toBe(true); payload.readOnly = true; vi.useFakeTimers();
    act(() => WsSocket.instances[0].drop(1012, 'document transport changed'));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(held).toBe(false); expect(f.result.current.status).toBe('recovery');
    expect(f.result.current.isWritable()).toBe(false); expect(f.result.current.recoveryRetryReady).toBe(false);
    expect(JSON.parse(f.result.current.exportRecoveryCopy()).pendingFrames).toHaveLength(1);
  });
  it('does not expose old document content to the first committed layout of a different actor', async () => {
    const seen: Array<{ actor: string; status: string; authority: string; count: number }> = [];
    const f = renderHook(({ actor }) => {
      const value = useCollaborativeCanvas('project-a', actor);
      useLayoutEffect(() => { seen.push({ actor, status: value.status, authority: value.authority, count: value.canvasImages.length }); }, [actor, value]);
      return value;
    }, { initialProps: { actor: 'editor-a' } }); cleanup.push(f.unmount);
    await waitFor(() => expect(WsSocket.instances).toHaveLength(1)); act(() => WsSocket.instances[0].snapshot(doc));
    expect(f.result.current.status).toBe('saved');
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    f.rerender({ actor: 'editor-b' });
    expect(seen.filter(item => item.actor === 'editor-b')).not.toHaveLength(0);
    for (const item of seen.filter(item => item.actor === 'editor-b')) {
      expect(item.count).toBe(0); expect(item.authority).toBe('unknown'); expect(item.status).toBe('checking');
    }
  });
  it.each([['editor', 'AgAA'], ['editor', 'AwAA'], ['owner', 'AgAA'], ['owner', 'AwAA']] as const)(
    'keeps remounted %s out of legacy while its original pending %s exists', async (kind, frame) => {
      localStorage.setItem('wujie-canvas-document-pending-v1:editor-a:project-a:frame', frame);
      if (kind === 'editor') vi.mocked(fetch).mockResolvedValue({ ok: false, status: 409,
        json: async () => ({ success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' }) } as Response);
      const f = mount(kind === 'owner' ? 'editor-a' : null);
      await waitFor(() => expect(f.result.current.status).toBe('recovery'));
      expect(f.result.current.authority).not.toBe('legacy'); expect(f.result.current.recoveryRetryReady).toBe(false);
      expect(localStorage.getItem('wujie-canvas-document-pending-v1:editor-a:project-a:frame')).toBe(frame);
      expect(ticketCount()).toBe(0); expect(WsSocket.instances).toHaveLength(0);
    });
  it('does not infer an empty legacy scope when original pending storage is unreadable', async () => {
    vi.spyOn(localStorage, 'key').mockImplementation(() => { throw Error('controlled pending read failure'); });
    localStorage.setItem('unrelated-fixture', 'force key inspection');
    const f = mount('editor-a'); await waitFor(() => expect(f.result.current.status).toBe('unavailable'));
    expect(f.result.current.authority).not.toBe('legacy'); expect(ticketCount()).toBe(0);
  });
  it('does not reactivate old A callbacks when the committed actor changes A to B to A', async () => {
    payload.documentTransport = 'http';
    const f = mount(); await waitFor(() => expect(f.result.current.status).toBe('saved')); const oldA = f.result.current;
    f.rerender({ actor: 'editor-b' }); await waitFor(() => expect(f.result.current.status).toBe('saved'));
    f.rerender({ actor: 'editor-a' }); await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(() => oldA.retryRecovered()).toThrow(); act(() => oldA.disconnect());
    expect(f.result.current.isWritable()).toBe(true); expect(f.result.current.canvasImages).toHaveLength(1);
    act(() => f.result.current.applyLocalChange({ placementId: 'p1', x: 65 }));
    expect(f.result.current.status).toBe('pending'); expect(f.result.current.images.p1.x).toBe(65);
  });
  it('retains current scope updates through a StrictMode effect cleanup and remount', async () => {
    payload.documentTransport = 'http';
    const f = renderHook(() => useCollaborativeCanvas('project-a', 'editor-a'), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children),
    }); cleanup.push(f.unmount);
    await waitFor(() => expect(f.result.current.status).toBe('saved'));
    expect(f.result.current.canvasImages).toHaveLength(1);
    act(() => f.result.current.applyLocalChange({ placementId: 'p1', x: 66 }));
    expect(f.result.current.status).toBe('pending'); expect(f.result.current.images.p1.x).toBe(66);
    expect(f.result.current.isWritable()).toBe(true);
  });
});
