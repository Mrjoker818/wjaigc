// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { applyCanvasImagePatch, createCanvasDocument } from '@/lib/collaboration/canvas-document';
import { createBrowserPendingUpdateStore, useCollaborativeCanvas } from '@/lib/collaboration/document-client';

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  readonly url: string;
  readonly protocols: string[];
  readyState = 1;
  binaryType: BinaryType = 'blob';
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => { this.readyState = 3; });
  send = vi.fn();

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeSocket.instances.push(this);
  }

  snapshot(update: Uint8Array<ArrayBufferLike>): void {
    const bytes = new Uint8Array(9 + update.length);
    bytes[0] = 0x11;
    new DataView(bytes.buffer).setBigUint64(1, BigInt(1));
    bytes.set(update, 9);
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }

  drop(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

const response = (status: number, data: unknown): Response => ({
  ok: status >= 200 && status < 300, status, json: async () => data,
} as Response);

function storageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('useCollaborativeCanvas', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('localStorage', storageMock());
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(
      url.startsWith('/api/collaboration/document-project?')
        ? response(200, {
          success: true, projectId: 'project-a', ownerId: 'owner-a', sequence: 1,
          projection: { placements: {
            p1: { assetVersionId: 'version-p1', x: 10, y: 20,
              width: 80, height: 60, rotation: 0, zIndex: 0 },
          } },
          canvasImages: [{
            id: 'image-p1', placementId: 'p1', assetVersionId: 'version-p1',
            url: '/api/serve-upload/p1.png', x: 10, y: 20,
            width: 80, height: 60, originalWidth: 80, originalHeight: 60,
            rotation: 0, zIndex: 0, createdAt: 1,
          }], readOnly: false,
        })
        : response(200, { success: true, ticket: 'a'.repeat(43) }),
    )));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    [401, 'AUTHENTICATION_REQUIRED'],
    [403, 'DOCUMENT_FORBIDDEN'],
    [503, 'DOCUMENT_DISABLED'],
    [409, 'DOCUMENT_PROJECT_NOT_ENABLED'],
    [401, 'invalid-json'],
  ])('destroys a connected document on terminal ticket %s/%s and retains recovery', async (httpStatus, code) => {
    const managers = vi.spyOn(Y.UndoManager.prototype, 'addToScope');
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const undo = managers.mock.contexts[0] as Y.UndoManager;
    const doc = undo.doc;
    const destroyed = vi.spyOn(undo, 'destroy');
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'seed');
    const socket = FakeSocket.instances[0];
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    act(() => result.current.applyLocalChange({ placementId: 'p1', x: 91 }));
    const store = createBrowserPendingUpdateStore('project-a', 'owner-a');
    const pending = store.load();
    expect(pending).toHaveLength(1);
    const lateMessage = socket.onmessage;
    const lateClose = socket.onclose;
    const denial = response(httpStatus, { success: false, code });
    if (code === 'invalid-json') denial.json = async () => { throw new SyntaxError('invalid JSON'); };
    vi.mocked(fetch).mockResolvedValue(denial);
    vi.useFakeTimers();
    act(() => socket.drop());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(doc.isDestroyed).toBe(true);
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(undo.trackedOrigins.has(undo)).toBe(false);
    expect(result.current.status).toBe('recovery');
    expect(result.current.authority).toBe('document');
    expect(result.current.recoveryRetryReady).toBe(false);
    expect(() => result.current.applyLocalChange({ placementId: 'p1', x: 200 })).toThrow();
    expect(() => result.current.undoLocal()).toThrow();
    expect(() => result.current.redoLocal()).toThrow();
    expect(() => result.current.applyLocalGroups([])).toThrow();
    expect(() => result.current.applyLocalAnnotations([])).toThrow();
    expect(() => result.current.retryRecovered()).toThrow();
    const copy = JSON.parse(result.current.exportRecoveryCopy());
    expect(copy.projection.placements.p1.x).toBe(91);
    expect(copy.pendingFrames).toHaveLength(1);
    expect(store.load()).toEqual(pending);
    const calls = vi.mocked(fetch).mock.calls.length;
    act(() => {
      const ack = new Uint8Array(9);
      ack[0] = 0x12;
      new DataView(ack.buffer).setBigUint64(1, BigInt(2));
      lateMessage?.({ data: ack.buffer } as MessageEvent);
      lateClose?.({ code: 1006 } as CloseEvent);
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(calls);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(store.load()).toEqual(pending);
    expect(result.current.exportRecoveryCopy()).toContain('"x": 91');
    unmount();
    server.destroy();
  });

  it('destroys a revoked socket immediately without waiting for another ticket', async () => {
    const managers = vi.spyOn(Y.UndoManager.prototype, 'addToScope');
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const undo = managers.mock.contexts[0] as Y.UndoManager;
    const destroyed = vi.spyOn(undo, 'destroy');
    vi.useFakeTimers();
    const calls = vi.mocked(fetch).mock.calls.length;
    act(() => FakeSocket.instances[0].drop(1008, 'document unavailable'));
    expect(undo.doc.isDestroyed).toBe(true);
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('unavailable');
    expect(() => result.current.applyLocalChange({ placementId: 'p1', x: 90 })).toThrow();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(calls);
    unmount();
  });

  it.each(['logout', 'switch-project'])('cleans real Yjs resources after connected %s and ignores an in-flight ticket', async action => {
    const managers = vi.spyOn(Y.UndoManager.prototype, 'addToScope');
    const { result, rerender, unmount } = renderHook(
      ({ projectId, actorId }) => useCollaborativeCanvas(projectId, actorId),
      { initialProps: { projectId: 'project-a', actorId: 'owner-a' as string | null } },
    );
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const undo = managers.mock.contexts[0] as Y.UndoManager;
    const destroyed = vi.spyOn(undo, 'destroy');
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'seed');
    const socket = FakeSocket.instances[0];
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    act(() => result.current.applyLocalChange({ placementId: 'p1', x: 91 }));
    const store = createBrowserPendingUpdateStore('project-a', 'owner-a');
    const pending = store.load();
    let finishTicket: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishTicket = resolve; }));
    vi.useFakeTimers();
    act(() => socket.drop());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(finishTicket).toBeTypeOf('function');
    vi.mocked(fetch).mockResolvedValue(response(409, { code: 'DOCUMENT_PROJECT_NOT_ENABLED' }));
    rerender(action === 'logout'
      ? { projectId: 'project-a', actorId: null }
      : { projectId: 'project-b', actorId: 'owner-a' });
    await act(async () => { finishTicket?.(response(200, { ticket: 'a'.repeat(43) })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(undo.doc.isDestroyed).toBe(true);
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(undo.trackedOrigins.has(undo)).toBe(false);
    expect(socket.onmessage).toBeNull();
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(result.current.images).toEqual({});
    expect(() => result.current.applyLocalChange({ placementId: 'p1', x: 200 })).toThrow();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(store.load()).toEqual(pending);
    unmount();
    server.destroy();
  });

  it('ignores a late successful ticket after socket revocation and recovers only after explicit retry on remount', async () => {
    const fetchNormally = vi.mocked(fetch).getMockImplementation()!;
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'seed');
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    let finishTicket: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishTicket = resolve; }));
    vi.useFakeTimers();
    // A failed send starts revalidation before the queued close event reveals
    // that access was revoked. Keep the real session and its durable update.
    socket.send.mockImplementationOnce(() => { throw new Error('transport closed'); });
    act(() => result.current.applyLocalChange({ placementId: 'p1', x: 91 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(finishTicket).toBeTypeOf('function');
    act(() => socket.drop(1008, 'document unavailable'));
    expect(result.current.status).toBe('recovery');
    expect(result.current.recoveryRetryReady).toBe(false);
    expect(result.current.exportRecoveryCopy()).toContain('"x": 91');
    await act(async () => { finishTicket?.(response(200, { ticket: 'a'.repeat(43) })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(FakeSocket.instances).toHaveLength(1);
    unmount();

    vi.useRealTimers();
    vi.mocked(fetch).mockImplementation(fetchNormally);
    const recovered = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    const recoveredSocket = FakeSocket.instances[1];
    act(() => recoveredSocket.snapshot(Y.encodeStateAsUpdate(server)));
    expect(recovered.result.current.status).toBe('recovery');
    expect(recovered.result.current.images.p1.x).toBe(91);
    expect(recoveredSocket.send).not.toHaveBeenCalled();
    act(() => recovered.result.current.retryRecovered());
    expect(recoveredSocket.send).toHaveBeenCalledTimes(1);
    expect(recovered.result.current.status).toBe('pending');
    recovered.unmount();
    server.destroy();
  });

  it('retries a temporary 503 after a budget close without destroying the live document', async () => {
    const managers = vi.spyOn(Y.UndoManager.prototype, 'addToScope');
    const { unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const doc = (managers.mock.contexts[0] as Y.UndoManager).doc;
    vi.mocked(fetch).mockResolvedValueOnce(response(503, { code: 'DOCUMENT_INTERNAL_ERROR' }));
    vi.useFakeTimers();
    act(() => FakeSocket.instances[0].drop(1008, 'operation queue'));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(doc.isDestroyed).toBe(false);
    expect(FakeSocket.instances).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(FakeSocket.instances).toHaveLength(2);
    expect(doc.isDestroyed).toBe(false);
    unmount();
  });

  it('keeps pending frames scoped to actor and project across browser store instances', () => {
    const first = createBrowserPendingUpdateStore('project-a', 'owner-a');
    const id = first.append(new Uint8Array([0x02, 0x11, 0x22]));
    expect(createBrowserPendingUpdateStore('project-a', 'owner-a').load())
      .toEqual([{ id, frame: new Uint8Array([0x02, 0x11, 0x22]) }]);
    expect(createBrowserPendingUpdateStore('project-a', 'other-actor').load()).toEqual([]);
    expect(createBrowserPendingUpdateStore('project-b', 'owner-a').load()).toEqual([]);
    first.remove(id);
    expect(createBrowserPendingUpdateStore('project-a', 'owner-a').load()).toEqual([]);
  });

  it('can retain a valid 512 KiB document update within the server frame budget', () => {
    const store = createBrowserPendingUpdateStore('project-a', 'owner-a');
    const frame = new Uint8Array(512 * 1024 + 1);
    frame[0] = 0x02;
    frame[frame.length - 1] = 0x7f;
    const id = store.append(frame);
    expect(store.load()).toEqual([{ id, frame }]);
  });

  it('holds a pending canvas edit after remount until explicit retry and acknowledgement', async () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'seed');
    const first = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    act(() => FakeSocket.instances[0].snapshot(Y.encodeStateAsUpdate(server)));
    act(() => first.result.current.applyLocalChange({ placementId: 'p1', x: 91 }));
    expect(first.result.current.status).toBe('pending');
    first.unmount();

    const second = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    const recoveredSocket = FakeSocket.instances[1];
    act(() => recoveredSocket.snapshot(Y.encodeStateAsUpdate(server)));
    expect(second.result.current.images.p1.x).toBe(91);
    expect(second.result.current.status).toBe('recovery');
    expect(second.result.current.recoveryRetryReady).toBe(true);
    expect(recoveredSocket.send).not.toHaveBeenCalled();
    expect(second.result.current.exportRecoveryCopy()).toContain('"x": 91');
    act(() => second.result.current.retryRecovered());
    expect(second.result.current.status).toBe('pending');
    expect(recoveredSocket.send).toHaveBeenCalledTimes(1);
    const frame = recoveredSocket.send.mock.calls[0][0] as Uint8Array;
    Y.applyUpdate(server, frame.subarray(1));
    const ack = new Uint8Array(9);
    ack[0] = 0x12;
    new DataView(ack.buffer).setBigUint64(1, BigInt(2));
    act(() => recoveredSocket.onmessage?.({ data: ack.buffer } as MessageEvent));
    expect(second.result.current.status).toBe('saved');
    expect(createBrowserPendingUpdateStore('project-a', 'owner-a').load()).toEqual([]);
    second.unmount();
  });

  it('keeps recovery export visible when a pending placement has no authorized media', async () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'seed');
    const local = createCanvasDocument();
    Y.applyUpdate(local, Y.encodeStateAsUpdate(server));
    const before = Y.encodeStateVector(local);
    applyCanvasImagePatch(local, {
      placementId: 'p2', assetVersionId: 'unavailable-version-p2',
      x: 30, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    }, 'local');
    const update = Y.encodeStateAsUpdate(local, before);
    const frame = new Uint8Array(update.length + 1);
    frame[0] = 0x02;
    frame.set(update, 1);
    const store = createBrowserPendingUpdateStore('project-a', 'owner-a');
    store.append(frame, { placements: { p2: { assetVersionId: 'unavailable-version-p2' } } });

    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    expect(result.current.status).toBe('recovery');
    expect(result.current.recoveryRetryReady).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
    expect(result.current.exportRecoveryCopy()).toContain('unavailable-version-p2');
    expect(() => result.current.retryRecovered()).toThrow('协作媒体投影不完整');
    unmount();
    for (const entry of store.load()) store.remove(entry.id);
  });

  it('checks project authority, then connects with an in-memory one-time ticket', async () => {
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    expect(result.current.authority).toBe('unknown');
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    expect(socket.url).toBe('ws://localhost:3000/api/collaboration/document');
    expect(socket.protocols).toEqual(['wujie-document-v1', `wujie-document-ticket.${'a'.repeat(43)}`]);
    expect(result.current.authority).toBe('document');
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'seed');
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    expect(result.current.status).toBe('saved');
    act(() => result.current.applyLocalChange({ placementId: 'p1', x: 90 }));
    expect(result.current.images.p1.x).toBe(90);
    expect(result.current.status).toBe('pending');
    unmount();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('hydrates authorized editor media and keeps its geometry aligned with the document', async () => {
    const media = {
      id: 'image-a', placementId: 'p1', assetId: 'asset-a',
      assetVersionId: 'version-p1', url: '/api/serve-upload/a.png',
      x: 10, y: 20, width: 80, height: 60,
      originalWidth: 80, originalHeight: 60,
      rotation: 0, zIndex: 0, createdAt: 1,
    };
    vi.mocked(fetch).mockImplementation((url: string | URL | Request) => Promise.resolve(
      String(url).startsWith('/api/collaboration/document-project?')
        ? response(200, {
          success: true, projectId: 'project-a', ownerId: 'owner-a', sequence: 1,
          projection: { placements: {
            p1: { assetVersionId: 'version-p1', x: 10, y: 20,
              width: 80, height: 60, rotation: 0, zIndex: 0 },
          } }, canvasImages: [media], readOnly: false,
        })
        : response(200, { success: true, ticket: 'a'.repeat(43) }),
    ));
    const { result } = renderHook(() => useCollaborativeCanvas('project-a', 'editor-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(result.current.canvasImages).toMatchObject([{ id: 'image-a', x: 10 }]);

    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 90, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'remote');
    act(() => FakeSocket.instances[0].snapshot(Y.encodeStateAsUpdate(server)));
    expect(result.current.canvasImages).toMatchObject([{
      id: 'image-a', url: '/api/serve-upload/a.png', x: 90,
    }]);
  });

  it('projects remote metadata using image IDs and writes complete local records to Yjs', async () => {
    const { result } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'seed');
    server.getMap('groupDefinitions').set('group-a', {
      id: 'group-a', name: 'Shared', note: 'server', imageIds: ['p1'],
      x: 3, y: 4, collapsed: false,
    });
    server.getMap('annotationRecords').set('annotation-a', {
      id: 'annotation-a', projectId: 'project-a', sourceImageId: 'p1',
      sourceVersionId: 'version-p1', type: 'region',
      geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } },
      status: 'ready', createdAt: 1, updatedAt: 1,
    });
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    expect(result.current.groups).toMatchObject([{
      id: 'group-a', note: 'server', imageIds: ['image-p1'],
    }]);
    expect(result.current.annotations).toMatchObject([{
      id: 'annotation-a', sourceImageId: 'image-p1',
    }]);

    act(() => result.current.applyLocalGroups([{
      id: 'group-a', name: 'Shared', note: 'changed', imageIds: ['image-p1'],
      x: 3, y: 4, collapsed: false,
    }]));
    expect(result.current.groups[0].note).toBe('changed');
    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = socket.send.mock.calls[0][0] as Uint8Array;
    Y.applyUpdate(server, sent.subarray(1));
    expect(server.getMap<Record<string, unknown>>('groupDefinitions').get('group-a')?.imageIds)
      .toEqual(['p1']);
  });

  it('passes the rendered group baseline through image-ID mapping so a concurrent remote group survives', async () => {
    const { result } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'seed');
    const original = {
      id: 'group-a', name: 'Original', note: '', imageIds: ['p1'],
      x: 0, y: 0, collapsed: false,
    };
    server.getMap('groupDefinitions').set(original.id, original);
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    const renderedBaseline = result.current.groups;

    server.getMap('groupDefinitions').set('group-b', { ...original, id: 'group-b', name: 'Remote' });
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    act(() => result.current.applyLocalGroups(
      [{ ...renderedBaseline[0], name: 'Local' }], renderedBaseline,
    ));

    expect(result.current.groups.map(group => group.name).sort()).toEqual(['Local', 'Remote']);
    expect(result.current.groups.find(group => group.id === 'group-b')).toBeTruthy();
  });

  it('blocks writes when the document references media absent from the authorized projection', async () => {
    const { result } = renderHook(() => useCollaborativeCanvas('project-a', 'editor-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'seed');
    applyCanvasImagePatch(server, {
      placementId: 'p2', assetVersionId: 'version-p2',
      x: 30, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    }, 'remote');
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    expect(result.current.status).toBe('unavailable');
    act(() => {
      expect(() => result.current.applyLocalChange({ placementId: 'p1', x: 90 }))
        .toThrow('媒体投影');
    });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('switching project destroys the old socket and allows the ordinary legacy path only after a 409', async () => {
    const { result, rerender } = renderHook(
      ({ projectId, actorId }) => useCollaborativeCanvas(projectId, actorId),
      { initialProps: { projectId: 'project-a', actorId: 'owner-a' } },
    );
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const oldSocket = FakeSocket.instances[0];
    vi.mocked(fetch).mockImplementation((url: string | URL | Request) => Promise.resolve(
      String(url).startsWith('/api/collaboration/document-project?')
        ? response(409, { success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' })
        : response(500, {}),
    ));
    rerender({ projectId: 'project-b', actorId: 'owner-a' });
    expect(oldSocket.close).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.authority).toBe('legacy'));
    expect(result.current.status).toBe('disabled');
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('rechecks a legacy project on focus after another tab enables document authority', async () => {
    let enabled = false;
    vi.mocked(fetch).mockImplementation((url: string | URL | Request) => Promise.resolve(
      String(url).startsWith('/api/collaboration/document-project?')
        ? enabled
          ? response(200, {
            success: true, projectId: 'project-a', ownerId: 'owner-a', sequence: 1,
            projection: { placements: {} }, canvasImages: [], readOnly: false,
          })
          : response(409, { success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' })
        : response(200, { success: true, ticket: 'a'.repeat(43) }),
    ));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(result.current.authority).toBe('legacy'));
    expect(FakeSocket.instances).toHaveLength(0);

    enabled = true;
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.authority).toBe('document'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    unmount();
  });

  it('rechecks a newly created project after transient 403 without treating denial as legacy authority', async () => {
    let inspections = 0;
    vi.mocked(fetch).mockImplementation((url: string | URL | Request) => {
      if (!String(url).startsWith('/api/collaboration/document-project?')) {
        throw new Error('A non-document project must not request a document ticket');
      }
      inspections += 1;
      return Promise.resolve(inspections === 1
        ? response(403, { success: false, code: 'DOCUMENT_FORBIDDEN' })
        : response(409, { success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' }));
    });
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-new', 'owner-a'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.authority).toBe('unknown');
    await waitFor(() => expect(result.current.authority).toBe('legacy'), { timeout: 3_000 });
    expect(inspections).toBe(2);
    expect(FakeSocket.instances).toHaveLength(0);
    unmount();
  });

  it('keeps an enabled but broken document out of the legacy save path', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(409, {
      success: false, code: 'DOCUMENT_AUTHORITY_CONFLICT',
    }));
    const { result } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.authority).not.toBe('legacy');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('rejects a successful-looking document response for a different project', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(200, {
      success: true, projectId: 'project-other', ownerId: 'owner-a', sequence: 1,
      projection: { placements: {} }, canvasImages: [], readOnly: false,
    }));
    const { result } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.authority).toBe('unknown');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('logout removes access and prevents a stale ticket response from opening a socket', async () => {
    let finishRead: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const { result, rerender } = renderHook(
      ({ actorId }) => useCollaborativeCanvas('project-a', actorId),
      { initialProps: { actorId: 'owner-a' as string | null } },
    );
    rerender({ actorId: null });
    act(() => finishRead?.(response(200, {
      success: true, projectId: 'project-a', ownerId: 'owner-a', sequence: 1,
      projection: { placements: {} }, canvasImages: [], readOnly: false,
    })));
    await waitFor(() => expect(result.current.status).toBe('disabled'));
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('explicit disconnect cancels an already scheduled reconnect', async () => {
    const { result } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    act(() => FakeSocket.instances[0].drop());
    expect(result.current.status).toBe('unavailable');
    act(() => result.current.disconnect());
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
