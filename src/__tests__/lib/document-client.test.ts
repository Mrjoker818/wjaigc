// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { applyCanvasImagePatch, assertCanvasDocumentTransition, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { createBrowserPendingUpdateStore, createCanvasDocumentSession, type PendingDocumentUpdateStore } from '@/lib/collaboration/document-client';

const placement = (placementId: string, x: number) => ({
  placementId, assetVersionId: `version-${placementId}`,
  x, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
});

function frame(type: 0x11 | 0x12, sequence: number, update: Uint8Array<ArrayBufferLike> = new Uint8Array()): ArrayBuffer {
  const bytes = new Uint8Array(9 + update.length);
  bytes[0] = type;
  new DataView(bytes.buffer).setBigUint64(1, BigInt(sequence));
  bytes.set(update, 9);
  return bytes.buffer;
}

class FakeSocket {
  static readonly OPEN = 1;
  readyState = FakeSocket.OPEN;
  binaryType: BinaryType = 'blob';
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn<(data: ArrayBuffer | Uint8Array) => void>();
  close = vi.fn(() => { this.readyState = 3; });

  receive(data: ArrayBuffer): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  drop(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

describe('canvas document browser session', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('destroys a permission-revoked session while retaining an exportable durable fork', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length(): number { return values.size; },
      key: (index: number): string | null => [...values.keys()][index] ?? null,
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); },
    });
    const managers = vi.spyOn(Y.UndoManager.prototype, 'addToScope');
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const store = createBrowserPendingUpdateStore('revoked-session', 'owner-a');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket, undefined, store);
    const undo = managers.mock.contexts[0] as Y.UndoManager;
    managers.mockRestore();
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    session.applyLocalChange({ placementId: 'p1', x: 140 });
    const pending = store.load();
    const lateMessage = socket.onmessage;
    try {
      socket.drop(1008, 'document unavailable');
      expect(undo.doc.isDestroyed).toBe(true);
      expect(undo.trackedOrigins.has(undo)).toBe(false);
      expect(() => session.applyLocalChange({ placementId: 'p1', x: 200 })).toThrow();
      expect(() => session.undoLocal()).toThrow();
      expect(() => session.replaceSocket(new FakeSocket() as unknown as WebSocket)).toThrow();
      expect(() => session.retryRecovered()).toThrow();
      expect(session.exportRecoveryCopy().projection.placements.p1.x).toBe(140);
      expect(session.exportRecoveryCopy().pendingFrames).toHaveLength(1);
      lateMessage?.({ data: frame(0x12, 2) } as MessageEvent);
      expect(store.load()).toEqual(pending);
      expect(socket.send).toHaveBeenCalledTimes(1);
    } finally {
      session.disconnect();
      server.destroy();
      for (const entry of store.load()) store.remove(entry.id);
    }
  });

  it('converges an independently edited whole transform under opposite update orders', () => {
    const seed = createCanvasDocument();
    applyCanvasImagePatch(seed, placement('p1', 10), 'seed');
    const sockets = [new FakeSocket(), new FakeSocket()];
    const sessions = sockets.map(socket => createCanvasDocumentSession(socket as unknown as WebSocket));
    const replicas = [createCanvasDocument(), createCanvasDocument()];
    const firstTransform = { x: 101, y: 102, width: 103, height: 104, rotation: 15, zIndex: 6 };
    const secondTransform = { x: 201, y: 202, width: 203, height: 204, rotation: 25, zIndex: 7 };
    const firstPlacement = { assetVersionId: 'version-p1', ...firstTransform };
    const secondPlacement = { assetVersionId: 'version-p1', ...secondTransform };
    try {
      const snapshot = Y.encodeStateAsUpdate(seed);
      for (const socket of sockets) socket.receive(frame(0x11, 1, snapshot));
      for (const replica of replicas) Y.applyUpdate(replica, snapshot);
      sessions[0].applyLocalChange({ placementId: 'p1', ...firstTransform });
      sessions[1].applyLocalChange({ placementId: 'p1', ...secondTransform });
      // Both edits exist before either socket receives the other's update.
      expect(sessions[0].images.p1).toEqual(firstPlacement);
      expect(sessions[1].images.p1).toEqual(secondPlacement);
      const updates = sockets.map(socket => {
        const sent = socket.send.mock.calls[0][0];
        return (sent instanceof Uint8Array ? sent : new Uint8Array(sent)).subarray(1);
      });
      for (const index of [0, 1]) Y.applyUpdate(replicas[0], updates[index]);
      for (const index of [1, 0]) Y.applyUpdate(replicas[1], updates[index]);
      sockets[0].receive(frame(0x11, 2, updates[1]));
      sockets[1].receive(frame(0x11, 2, updates[0]));
      const winner = sessions[0].images.p1;
      expect([firstPlacement, secondPlacement]).toContainEqual(winner);
      expect(sessions[1].images.p1).toEqual(winner);
      for (const replica of replicas) expect(readCanvasDocument(replica).placements.p1).toEqual(winner);
      for (const socket of sockets) expect(socket.send).toHaveBeenCalledTimes(1);
    } finally {
      for (const session of sessions) session.disconnect();
      for (const replica of replicas) replica.destroy();
      seed.destroy();
    }
  });

  it('merges a remote placement without echoing it, and local undo preserves that remote edit', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    applyCanvasImagePatch(server, placement('p2', 20), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    expect(session.status).toBe('saved');

    session.applyLocalChange({ placementId: 'p1', x: 100 });
    expect(session.status).toBe('pending');
    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = socket.send.mock.calls[0][0];
    const sentBytes = sent instanceof Uint8Array ? sent : new Uint8Array(sent);
    expect(sentBytes[0]).toBe(0x02);
    Y.applyUpdate(server, sentBytes.subarray(1));

    applyCanvasImagePatch(server, { placementId: 'p2', x: 200 }, 'other-user');
    socket.receive(frame(0x11, 2, Y.encodeStateAsUpdate(server)));
    expect(session.images.p2.x).toBe(200);
    expect(socket.send).toHaveBeenCalledTimes(1);

    session.undoLocal();
    expect(session.images.p1.x).toBe(10);
    expect(session.images.p2.x).toBe(200);
    expect(socket.send).toHaveBeenCalledTimes(2);
    session.disconnect();
  });

  it('commits a multi-selection move as one update and one local undo step', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    applyCanvasImagePatch(server, placement('p2', 20), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));

    session.applyLocalChange([
      { placementId: 'p1', x: 100 },
      { placementId: 'p2', x: 200 },
    ]);
    expect(session.images.p1.x).toBe(100);
    expect(session.images.p2.x).toBe(200);
    expect(socket.send).toHaveBeenCalledTimes(1);

    session.undoLocal();
    expect(session.images.p1.x).toBe(10);
    expect(session.images.p2.x).toBe(20);
    session.disconnect();
  });

  it('rejects an invalid second multi-selection patch without changing the first', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    applyCanvasImagePatch(server, placement('p2', 20), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));

    expect(() => session.applyLocalChange([
      { placementId: 'p1', x: 100 },
      { placementId: 'p2', x: Number.NaN },
    ])).toThrow();
    expect(session.images.p1.x).toBe(10);
    expect(session.images.p2.x).toBe(20);
    expect(socket.send).toHaveBeenCalledTimes(0);
    session.disconnect();
  });

  it('local undo does not replace a newer remote transform on the same placement', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));

    session.applyLocalChange({ placementId: 'p1', x: 100 });
    const sent = socket.send.mock.calls[0][0];
    Y.applyUpdate(server, sent instanceof Uint8Array ? sent.subarray(1) : new Uint8Array(sent).subarray(1));
    applyCanvasImagePatch(server, { placementId: 'p1', x: 200 }, 'other-user');
    socket.receive(frame(0x11, 2, Y.encodeStateAsUpdate(server)));
    expect(session.images.p1.x).toBe(200);

    session.undoLocal();
    expect(session.images.p1.x).toBe(200);
    session.disconnect();
  });

  it('local redo restores only the local edit after undo', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    applyCanvasImagePatch(server, placement('p2', 20), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    session.applyLocalChange({ placementId: 'p1', x: 100 });
    applyCanvasImagePatch(server, { placementId: 'p2', x: 200 }, 'other-user');
    socket.receive(frame(0x11, 2, Y.encodeStateAsUpdate(server)));

    session.undoLocal();
    expect(session.images.p1.x).toBe(10);
    session.redoLocal();
    expect(session.images.p1.x).toBe(100);
    expect(session.images.p2.x).toBe(200);
    session.disconnect();
  });

  it('never reports saved while a local edit is unacknowledged or the socket has dropped', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    session.applyLocalChange({ placementId: 'p1', x: 120 });
    expect(session.status).toBe('pending');
    socket.drop();
    expect(session.status).toBe('unavailable');
    expect(session.images.p1.x).toBe(120);
    session.disconnect();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('only declares a local edit saved after the matching server acknowledgement', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    session.applyLocalChange({ placementId: 'p1', x: 120 });
    session.applyLocalChange({ placementId: 'p1', x: 130 });
    socket.receive(frame(0x12, 2));
    expect(session.status).toBe('pending');
    socket.receive(frame(0x12, 3));
    expect(session.status).toBe('saved');
    session.disconnect();
  });

  it('replays an unacknowledged edit after reconnecting without claiming it was saved early', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const first = new FakeSocket();
    const session = createCanvasDocumentSession(first as unknown as WebSocket);
    first.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    session.applyLocalChange({ placementId: 'p1', x: 140 });
    first.drop();

    const second = new FakeSocket();
    session.replaceSocket(second as unknown as WebSocket);
    second.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    expect(session.status).toBe('pending');
    expect(second.send).toHaveBeenCalledTimes(1);
    const replay = second.send.mock.calls[0][0];
    const replayBytes = replay instanceof Uint8Array ? replay : new Uint8Array(replay);
    Y.applyUpdate(server, replayBytes.subarray(1));
    expect(server.getMap<Record<string, number>>('transforms').get('p1')?.x).toBe(140);
    second.receive(frame(0x12, 2));
    expect(session.status).toBe('saved');
    session.disconnect();
  });

  it('stops automatic replay after repeated ambiguous disconnects and retains an explicit retry', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const first = new FakeSocket();
    const session = createCanvasDocumentSession(first as unknown as WebSocket);
    first.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    session.applyLocalChange({ placementId: 'p1', x: 140 });
    let current = first;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      current.drop(1006);
      const next = new FakeSocket();
      session.replaceSocket(next as unknown as WebSocket);
      next.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
      expect(next.send).toHaveBeenCalledTimes(1);
      current = next;
    }
    current.drop(1006);
    const held = new FakeSocket();
    session.replaceSocket(held as unknown as WebSocket);
    held.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    expect(session.status).toBe('recovery');
    expect(held.send).not.toHaveBeenCalled();
    expect(session.images.p1.x).toBe(140);
    session.retryRecovered();
    expect(held.send).toHaveBeenCalledTimes(1);
    session.disconnect();
  });

  it('quarantines a permanently rejected update across reload while retaining its bytes', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const store = createBrowserPendingUpdateStore('reject-test-project', 'reject-test-actor');
    const first = new FakeSocket();
    const firstSession = createCanvasDocumentSession(first as unknown as WebSocket, undefined, store);
    first.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    firstSession.applyLocalChange({ placementId: 'p1', x: 140 });
    expect(store.load()).toHaveLength(1);
    const retainedFrame = store.load()[0].frame;

    first.drop(4400);
    expect(firstSession.status).toBe('rejected');
    expect(store.load()[0].rejected).toBe(true);
    const recovery = firstSession.exportRecoveryCopy();
    expect(recovery.projection.placements.p1.x).toBe(140);
    expect(recovery.pendingFrames).toEqual([{
      frameBase64: btoa(String.fromCharCode(...retainedFrame)), rejected: true,
      intent: { placements: { p1: {
        assetVersionId: 'version-p1', x: 140, y: 20,
        width: 80, height: 60, rotation: 0, zIndex: 0,
      } } },
    }]);
    firstSession.disconnect();

    const second = new FakeSocket();
    const secondSession = createCanvasDocumentSession(second as unknown as WebSocket, undefined, store);
    second.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    expect(secondSession.status).toBe('rejected');
    expect(secondSession.images.p1.x).toBe(140);
    expect(second.send).not.toHaveBeenCalled();
    expect(store.load()).toMatchObject([{ frame: retainedFrame, rejected: true,
      intent: recovery.pendingFrames[0].intent }]);
    secondSession.disconnect();
    for (const entry of store.load()) store.remove(entry.id);
  });

  it('does not replay a rejected frame after reload when localStorage cannot rewrite its marker', () => {
    const values = new Map<string, string>();
    const fallback = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (value.startsWith('v2:Aw')) throw new Error('storage cannot rewrite frame');
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => fallback.get(key) ?? null,
      setItem: (key: string, value: string) => { fallback.set(key, value); },
      removeItem: (key: string) => { fallback.delete(key); },
    });
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const store = createBrowserPendingUpdateStore('readonly-test-project', 'readonly-test-actor');
    const first = new FakeSocket();
    const firstSession = createCanvasDocumentSession(first as unknown as WebSocket, undefined, store);
    first.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    firstSession.applyLocalChange({ placementId: 'p1', x: 140 });
    first.drop(4400);
    expect(firstSession.status).toBe('rejected');
    expect(store.load()[0].rejected).toBe(true);
    expect([...values.keys()].some(key => key.startsWith('wujie-canvas-document-rejected-v1:'))).toBe(true);
    firstSession.disconnect();

    fallback.clear(); // A fresh tab has no access to the previous tab's sessionStorage.

    const second = new FakeSocket();
    const recovered = createCanvasDocumentSession(second as unknown as WebSocket, undefined,
      createBrowserPendingUpdateStore('readonly-test-project', 'readonly-test-actor'));
    second.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    expect(recovered.status).toBe('rejected');
    expect(second.send).not.toHaveBeenCalled();
    recovered.disconnect();
  });

  it('quarantines persisted uncertainty across tabs when both localStorage marker writes fail', () => {
    const values = new Map<string, string>();
    const fallback = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (value.startsWith('v2:Aw') || value === '1') throw new Error('storage quota exceeded');
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => fallback.get(key) ?? null,
      setItem: (key: string, value: string) => { fallback.set(key, value); },
      removeItem: (key: string) => { fallback.delete(key); },
    });
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const store = createBrowserPendingUpdateStore('cookie-fallback-project', 'cookie-fallback-actor');
    const first = new FakeSocket();
    const firstSession = createCanvasDocumentSession(first as unknown as WebSocket, undefined, store);
    first.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    firstSession.applyLocalChange({ placementId: 'p1', x: 140 });
    first.drop(4400);
    expect(firstSession.status).toBe('rejected');
    firstSession.disconnect();
    fallback.clear();

    const second = new FakeSocket();
    const recovered = createCanvasDocumentSession(second as unknown as WebSocket, undefined,
      createBrowserPendingUpdateStore('cookie-fallback-project', 'cookie-fallback-actor'));
    second.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    expect(recovered.status).toBe('recovery');
    expect(second.send).not.toHaveBeenCalled();
    expect(recovered.exportRecoveryCopy().pendingFrames[0].intent?.placements)
      .toMatchObject({ p1: { x: 140 } });
    recovered.disconnect();
    for (const entry of store.load()) store.remove(entry.id);
  });

  it('retains recoverable bytes without replay when every cross-tab marker and deletion fails', () => {
    const values = new Map<string, string>();
    const fallback = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (value.startsWith('v2:Aw') || value === '1') throw new Error('storage quota exceeded');
        values.set(key, value);
      },
      removeItem: () => { throw new Error('storage is read-only'); },
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => fallback.get(key) ?? null,
      setItem: (key: string, value: string) => { fallback.set(key, value); },
      removeItem: (key: string) => { fallback.delete(key); },
    });
    const originalCookie = Object.getOwnPropertyDescriptor(document, 'cookie');
    Object.defineProperty(document, 'cookie', {
      configurable: true, get: () => '', set: () => undefined,
    });
    try {
      const server = createCanvasDocument();
      applyCanvasImagePatch(server, placement('p1', 10), 'seed');
      const store = createBrowserPendingUpdateStore('blocked-cookie-project', 'blocked-cookie-actor');
      const first = new FakeSocket();
      const firstSession = createCanvasDocumentSession(first as unknown as WebSocket, undefined, store);
      first.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
      firstSession.applyLocalChange({ placementId: 'p1', x: 140 });
      first.drop(4400);
      expect(firstSession.status).toBe('rejected');
      expect(firstSession.exportRecoveryCopy().pendingFrames[0].intent?.placements).toMatchObject({
        p1: { x: 140 },
      });
      expect(store.load()).toHaveLength(1);
      firstSession.disconnect();
      fallback.clear();

      const second = new FakeSocket();
      const recovered = createCanvasDocumentSession(second as unknown as WebSocket, undefined,
        createBrowserPendingUpdateStore('blocked-cookie-project', 'blocked-cookie-actor'));
      second.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
      expect(recovered.status).toBe('recovery');
      expect(second.send).not.toHaveBeenCalled();
      expect(recovered.exportRecoveryCopy().pendingFrames[0].intent?.placements)
        .toMatchObject({ p1: { x: 140 } });
      recovered.disconnect();
    } finally {
      if (originalCookie) Object.defineProperty(document, 'cookie', originalCookie);
      else Reflect.deleteProperty(document, 'cookie');
    }
  });

  it('exports readable intent even when rejected bytes cannot form a valid local fork', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    const store = createBrowserPendingUpdateStore('invalid-fork-project', 'invalid-fork-actor');
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const invalid = createCanvasDocument();
    applyCanvasImagePatch(invalid, placement('p1', 10), 'seed');
    invalid.getMap<Record<string, number>>('transforms').set('p1', {
      x: Number.NaN, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    });
    const update = new Uint8Array(Y.encodeStateAsUpdate(invalid).length + 1);
    update[0] = 0x02;
    update.set(Y.encodeStateAsUpdate(invalid), 1);
    const id = store.append(update, { placements: { p1: { x: 140 } } });
    store.markRejected?.(id);

    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket, undefined, store);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    expect(session.status).toBe('rejected');
    expect(session.images.p1.x).toBe(10);
    expect(socket.send).not.toHaveBeenCalled();
    expect(session.exportRecoveryCopy().pendingFrames[0].intent)
      .toEqual({ placements: { p1: { x: 140 } } });
    session.disconnect();
  });

  it('holds an unconfirmed edit after remount until explicit retry and acknowledgement', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const persisted = new Map<string, Uint8Array>();
    let nextId = 0;
    const store: PendingDocumentUpdateStore = {
      load: () => [...persisted].map(([id, frame]) => ({ id, frame })),
      append: frame => {
        const id = `update-${++nextId}`;
        persisted.set(id, new Uint8Array(frame));
        return id;
      },
      remove: id => { persisted.delete(id); },
    };
    const first = new FakeSocket();
    const firstSession = createCanvasDocumentSession(first as unknown as WebSocket, undefined, store);
    first.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    firstSession.applyLocalChange({ placementId: 'p1', x: 140 });
    expect(firstSession.status).toBe('pending');
    expect(persisted.size).toBe(1);
    firstSession.disconnect();

    const second = new FakeSocket();
    const secondSession = createCanvasDocumentSession(second as unknown as WebSocket, undefined, store);
    second.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    expect(secondSession.images.p1.x).toBe(140);
    expect(secondSession.status).toBe('recovery');
    expect(second.send).not.toHaveBeenCalled();
    expect(persisted.size).toBe(1);
    secondSession.retryRecovered();
    expect(secondSession.status).toBe('pending');
    expect(second.send).toHaveBeenCalledTimes(1);
    const sent = second.send.mock.calls[0][0] as Uint8Array;
    Y.applyUpdate(server, sent.subarray(1));
    second.receive(frame(0x12, 2));
    expect(secondSession.status).toBe('saved');
    expect(persisted.size).toBe(0);
    secondSession.disconnect();
  });

  it('rejects a local edit without changing the document when the durable pending store is full', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const store: PendingDocumentUpdateStore = {
      load: () => [],
      append: () => { throw new Error('storage full'); },
      remove: () => {},
    };
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket, undefined, store);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));

    expect(() => session.applyLocalChange({ placementId: 'p1', x: 140 }))
      .toThrow('storage full');
    expect(session.images.p1.x).toBe(10);
    expect(socket.send).toHaveBeenCalledTimes(0);
    session.disconnect();
  });

  it('rejects a group edit without changing the document when the durable pending store is full', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const store: PendingDocumentUpdateStore = {
      load: () => [],
      append: () => { throw new Error('storage full'); },
      remove: () => {},
    };
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket, undefined, store);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    const group = {
      id: 'group-a', name: 'Reference', note: '', imageIds: ['p1'],
      x: 0, y: 0, collapsed: false,
    };
    expect(() => session.applyLocalGroups({ [group.id]: group })).toThrow('storage full');
    expect(session.projection.groupDefinitions?.[group.id]).toBeUndefined();
    expect(socket.send).toHaveBeenCalledTimes(0);
    session.disconnect();
  });

  it('rejects an annotation edit without changing the document when the durable pending store is full', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const store: PendingDocumentUpdateStore = {
      load: () => [],
      append: () => { throw new Error('storage full'); },
      remove: () => {},
    };
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket, undefined, store);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    const annotation = {
      id: 'annotation-a', projectId: 'project-a', sourceImageId: 'p1',
      sourceVersionId: 'version-p1', type: 'region' as const,
      geometry: { kind: 'region' as const, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      status: 'ready' as const, createdAt: 1, updatedAt: 2,
    };

    expect(() => session.applyLocalAnnotations({ [annotation.id]: annotation })).toThrow('storage full');
    expect(session.projection.annotationRecords?.[annotation.id]).toBeUndefined();
    expect(socket.send).toHaveBeenCalledTimes(0);
    session.disconnect();
  });

  it('does not apply or send undo when its pending update cannot be persisted', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    let storageFull = false;
    let nextId = 0;
    const persisted = new Map<string, Uint8Array>();
    const store: PendingDocumentUpdateStore = {
      load: () => [...persisted].map(([id, frame]) => ({ id, frame })),
      append: update => {
        if (storageFull) throw new Error('storage full');
        const id = `update-${++nextId}`;
        persisted.set(id, new Uint8Array(update));
        return id;
      },
      remove: id => { persisted.delete(id); },
    };
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket, undefined, store);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    session.applyLocalChange({ placementId: 'p1', x: 140 });
    socket.receive(frame(0x12, 2));
    expect(session.status).toBe('saved');
    storageFull = true;

    expect(() => session.undoLocal()).toThrow('storage full');
    expect(session.images.p1.x).toBe(140);
    expect(socket.send).toHaveBeenCalledTimes(1);
    session.disconnect();
  });

  it('does not apply or send redo when its pending update cannot be persisted', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    let storageFull = false;
    let nextId = 0;
    const persisted = new Map<string, Uint8Array>();
    const store: PendingDocumentUpdateStore = {
      load: () => [...persisted].map(([id, frame]) => ({ id, frame })),
      append: update => {
        if (storageFull) throw new Error('storage full');
        const id = `update-${++nextId}`;
        persisted.set(id, new Uint8Array(update));
        return id;
      },
      remove: id => { persisted.delete(id); },
    };
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket, undefined, store);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    session.applyLocalChange({ placementId: 'p1', x: 140 });
    socket.receive(frame(0x12, 2));
    session.undoLocal();
    socket.receive(frame(0x12, 3));
    expect(session.images.p1.x).toBe(10);
    storageFull = true;

    expect(() => session.redoLocal()).toThrow('storage full');
    expect(session.images.p1.x).toBe(10);
    expect(socket.send).toHaveBeenCalledTimes(2);
    session.disconnect();
  });

  it('consumes one acknowledgement per replayed update even when both were already committed at one sequence', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const first = new FakeSocket();
    const session = createCanvasDocumentSession(first as unknown as WebSocket);
    first.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    session.applyLocalChange({ placementId: 'p1', x: 120 });
    session.applyLocalChange({ placementId: 'p1', x: 130 });
    for (const call of first.send.mock.calls) {
      const sent = call[0] instanceof Uint8Array ? call[0] : new Uint8Array(call[0]);
      Y.applyUpdate(server, sent.subarray(1));
    }
    first.drop();

    const second = new FakeSocket();
    session.replaceSocket(second as unknown as WebSocket);
    second.receive(frame(0x11, 3, Y.encodeStateAsUpdate(server)));
    expect(second.send).toHaveBeenCalledTimes(2);
    second.receive(frame(0x12, 3));
    expect(session.status).toBe('pending');
    second.receive(frame(0x12, 3));
    expect(session.status).toBe('saved');
    session.disconnect();
  });

  it('rejects edits during reconnect before the new socket is open and synced', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const first = new FakeSocket();
    const session = createCanvasDocumentSession(first as unknown as WebSocket);
    first.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    first.drop();

    const second = new FakeSocket();
    second.readyState = 0;
    session.replaceSocket(second as unknown as WebSocket);
    expect(session.status).toBe('connecting');
    expect(() => session.applyLocalChange({ placementId: 'p1', x: 300 }))
      .toThrow('尚未连接');
    expect(session.images.p1.x).toBe(10);
    expect(second.send).toHaveBeenCalledTimes(0);
    session.disconnect();
  });

  it('persists a complete group definition and tombstones its removal', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    const group = {
      id: 'group-a', name: 'Reference', note: 'move together',
      imageIds: ['p1'], x: 5, y: 6, collapsed: false,
    };

    session.applyLocalGroups({ 'group-a': group });
    expect(session.projection.groupDefinitions?.['group-a']).toEqual(group);
    const first = socket.send.mock.calls[0][0];
    Y.applyUpdate(server, (first instanceof Uint8Array ? first : new Uint8Array(first)).subarray(1));
    expect(readCanvasDocument(server).groupDefinitions?.['group-a']).toEqual(group);
    socket.receive(frame(0x12, 2));

    session.applyLocalGroups({});
    expect(session.projection.groupTombstones?.['group-a']).toBe(true);
    expect(session.projection.groupDefinitions?.['group-a']).toEqual(group);
    expect(socket.send).toHaveBeenCalledTimes(2);
    session.disconnect();
  });

  it('undoing an acknowledged new group preserves server monotone metadata history', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    const group = {
      id: 'group-a', name: 'New group', note: '', imageIds: ['p1'],
      x: 0, y: 0, collapsed: false,
    };
    session.applyLocalGroups({ [group.id]: group });
    const created = socket.send.mock.calls[0][0];
    Y.applyUpdate(server, (created instanceof Uint8Array ? created : new Uint8Array(created)).subarray(1));
    socket.receive(frame(0x12, 2));

    const beforeUndo = createCanvasDocument();
    Y.applyUpdate(beforeUndo, Y.encodeStateAsUpdate(server));
    session.undoLocal();
    const undoFrame = socket.send.mock.calls[1]?.[0];
    expect(undoFrame).toBeDefined();
    const candidate = createCanvasDocument();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(beforeUndo));
    Y.applyUpdate(candidate, (undoFrame instanceof Uint8Array ? undoFrame : new Uint8Array(undoFrame)).subarray(1));
    expect(() => assertCanvasDocumentTransition(beforeUndo, candidate)).not.toThrow();
    expect(readCanvasDocument(candidate).groupDefinitions?.[group.id]).toEqual(group);
    expect(readCanvasDocument(candidate).groupTombstones?.[group.id]).toBe(true);
    session.redoLocal();
    expect(session.projection.groupTombstones?.[group.id]).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(2);
    session.disconnect();
  });

  it('persists structured annotation records without broadcasting remote metadata back', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    const annotation = {
      id: 'annotation-a', projectId: 'project-a', sourceImageId: 'p1',
      sourceVersionId: 'version-p1', type: 'region' as const,
      geometry: { kind: 'region' as const, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      status: 'ready' as const, createdAt: 1, updatedAt: 2,
    };

    session.applyLocalAnnotations({ 'annotation-a': annotation });
    const sent = socket.send.mock.calls[0][0];
    Y.applyUpdate(server, (sent instanceof Uint8Array ? sent : new Uint8Array(sent)).subarray(1));
    expect(readCanvasDocument(server).annotationRecords?.['annotation-a']).toEqual(annotation);
    socket.receive(frame(0x12, 2));
    server.getMap('annotationRecords').set('annotation-a', { ...annotation, label: 'Remote' });
    socket.receive(frame(0x11, 3, Y.encodeStateAsUpdate(server)));
    expect(session.projection.annotationRecords?.['annotation-a'].label).toBe('Remote');
    expect(socket.send).toHaveBeenCalledTimes(1);
    session.disconnect();
  });

  it('undoing an acknowledged new annotation preserves server monotone metadata history', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));
    const annotation = {
      id: 'annotation-a', projectId: 'project-a', sourceImageId: 'p1',
      sourceVersionId: 'version-p1', type: 'region' as const,
      geometry: { kind: 'region' as const, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      status: 'ready' as const, createdAt: 1, updatedAt: 2,
    };
    session.applyLocalAnnotations({ [annotation.id]: annotation });
    const created = socket.send.mock.calls[0][0];
    Y.applyUpdate(server, (created instanceof Uint8Array ? created : new Uint8Array(created)).subarray(1));
    socket.receive(frame(0x12, 2));

    const beforeUndo = createCanvasDocument();
    Y.applyUpdate(beforeUndo, Y.encodeStateAsUpdate(server));
    session.undoLocal();
    const undoFrame = socket.send.mock.calls[1]?.[0];
    expect(undoFrame).toBeDefined();
    const candidate = createCanvasDocument();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(beforeUndo));
    Y.applyUpdate(candidate, (undoFrame instanceof Uint8Array ? undoFrame : new Uint8Array(undoFrame)).subarray(1));
    expect(() => assertCanvasDocumentTransition(beforeUndo, candidate)).not.toThrow();
    expect(readCanvasDocument(candidate).annotationRecords?.[annotation.id]).toEqual(annotation);
    expect(readCanvasDocument(candidate).annotationTombstones?.[annotation.id]).toBe(true);
    session.redoLocal();
    expect(session.projection.annotationTombstones?.[annotation.id]).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(2);
    session.disconnect();
  });

  it('keeps a remote group added before the local UI applies its own stale group edit', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const original = {
      id: 'group-a', name: 'Original', note: '', imageIds: ['p1'],
      x: 0, y: 0, collapsed: false,
    };
    server.getMap('groupDefinitions').set(original.id, original);
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));

    const remote = { ...original, id: 'group-b', name: 'Remote' };
    server.getMap('groupDefinitions').set(remote.id, remote);
    socket.receive(frame(0x11, 2, Y.encodeStateAsUpdate(server)));
    session.applyLocalGroups(
      { [original.id]: { ...original, name: 'Local' } },
      { [original.id]: original },
    );

    expect(session.projection.groupDefinitions?.['group-a'].name).toBe('Local');
    expect(session.projection.groupDefinitions?.['group-b']).toEqual(remote);
    expect(session.projection.groupTombstones?.['group-b']).toBeUndefined();
    session.disconnect();
  });

  it('keeps a remote annotation added before the local UI applies its own stale annotation list', () => {
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, placement('p1', 10), 'seed');
    const socket = new FakeSocket();
    const session = createCanvasDocumentSession(socket as unknown as WebSocket);
    socket.receive(frame(0x11, 1, Y.encodeStateAsUpdate(server)));

    const original = {
      id: 'annotation-a', projectId: 'project-a', sourceImageId: 'p1',
      sourceVersionId: 'version-p1', type: 'region' as const,
      geometry: { kind: 'region' as const, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      status: 'ready' as const, createdAt: 1, updatedAt: 2,
    };
    const remote = { ...original, id: 'annotation-b' };
    server.getMap('annotationRecords').set(remote.id, remote);
    socket.receive(frame(0x11, 2, Y.encodeStateAsUpdate(server)));
    session.applyLocalAnnotations({ [original.id]: original }, {});

    expect(session.projection.annotationRecords?.['annotation-a']).toEqual(original);
    expect(session.projection.annotationRecords?.['annotation-b']).toEqual(remote);
    expect(session.projection.annotationTombstones?.['annotation-b']).toBeUndefined();
    session.disconnect();
  });
});
