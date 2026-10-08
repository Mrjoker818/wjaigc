// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { applyCanvasAssetCommand, captureDocumentPlacementRemovalSnapshot } from '@/lib/collaboration/canvas-asset-command';
import { canUseLegacyCanvasPersistence, routeCanvasWorkspaceChange } from '@/lib/collaboration/canvas-document-image-bridge';
import { createBrowserPendingUpdateStore, useCollaborativeCanvas } from '@/lib/collaboration/document-client';

// The fallback reproduces the old consumer's rendered-state guard on the RED
// tree; the new live method must also reject invalidated retained callbacks.
function uploadWritable(canvas: ReturnType<typeof useCollaborativeCanvas>): boolean {
  const live = (canvas as ReturnType<typeof useCollaborativeCanvas> & { isWritable?: () => boolean }).isWritable;
  return live ? live() : canvas.status === 'saved' || canvas.status === 'pending';
}

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

  snapshot(update: Uint8Array<ArrayBufferLike>, sequence = 1): void {
    const bytes = new Uint8Array(9 + update.length);
    bytes[0] = 0x11;
    new DataView(bytes.buffer).setBigUint64(1, BigInt(sequence));
    bytes.set(update, 9);
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }

  acknowledge(sequence: number): void {
    const bytes = new Uint8Array(9);
    bytes[0] = 0x12;
    new DataView(bytes.buffer).setBigUint64(1, BigInt(sequence));
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

async function connectMediaHook(): Promise<{
  hook: ReturnType<typeof renderHook<ReturnType<typeof useCollaborativeCanvas>, unknown>>;
  server: Y.Doc; socket: FakeSocket;
}> {
  const hook = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  const server = createCanvasDocument();
  applyCanvasImagePatch(server, { placementId: 'p1', assetVersionId: 'version-p1',
    x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0 }, 'seed');
  const socket = FakeSocket.instances[0];
  act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
  return { hook, server, socket };
}

interface HistoryScope { projectId: string; actorId: string | null }
type HistoryHook = ReturnType<typeof renderHook<ReturnType<typeof useCollaborativeCanvas>, HistoryScope>>;
const historyCleanups: Array<() => void> = [];
const historyTransform = { x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0 };

// Real hook/session/Y.Doc. Only the socket and authorized HTTP directory are
// controlled; each directory is a complete projection of the current server.
async function connectHistoryHook(onLayout?: (scope: HistoryScope) => void): Promise<{
  hook: HistoryHook; server: Y.Doc; socket: FakeSocket;
  commit(): void; publish(): Promise<void>; switchScope(scope: HistoryScope): Promise<void>;
}> {
  const server = createCanvasDocument();
  applyCanvasImagePatch(server, { placementId: 'p1', assetVersionId: 'version-p1',
    ...historyTransform, groupId: null, annotation: '' }, 'seed');
  let sequence = 1;
  vi.mocked(fetch).mockImplementation((url: string | URL | Request) => {
    if (!String(url).startsWith('/api/collaboration/document-project?')) {
      return Promise.resolve(response(200, { success: true, ticket: 'a'.repeat(43) }));
    }
    const projectId = new URL(String(url), 'http://localhost').searchParams.get('projectId');
    const projection = readCanvasDocument(server);
    const canvasImages = Object.entries(projection.placements).filter(([, placement]) => !placement.deleted)
      .map(([placementId, placement]) => ({ ...placement, id: `image-${placementId}`, placementId,
        url: `/api/serve-upload/${placementId}.png`, originalWidth: 80, originalHeight: 60, createdAt: 1 }));
    return Promise.resolve(response(200, { success: true, projectId, ownerId: 'owner-a', sequence,
      projection, canvasImages, readOnly: false }));
  });
  let scope: HistoryScope = { projectId: 'project-a', actorId: 'owner-a' };
  const hook = renderHook((current: HistoryScope) => {
    const canvas = useCollaborativeCanvas(current.projectId, current.actorId);
    useLayoutEffect(() => { onLayout?.(current); }, [current]);
    return canvas;
  }, {
    initialProps: scope,
  });
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  let socket = FakeSocket.instances[0];
  act(() => socket.snapshot(Y.encodeStateAsUpdate(server), sequence));
  await waitFor(() => expect(hook.result.current.status).toBe('saved'));
  let consumed = 0;
  const commit = (): void => {
    act(() => {
      for (; consumed < socket.send.mock.calls.length; consumed++) {
        const frame = socket.send.mock.calls[consumed][0] as Uint8Array;
        Y.applyUpdate(server, frame.subarray(1));
        socket.acknowledge(++sequence);
      }
      socket.snapshot(Y.encodeStateAsUpdate(server), sequence);
    });
  };
  const publish = async (): Promise<void> => {
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server), ++sequence));
    await act(async () => { await hook.result.current.refreshMedia({ projectId: scope.projectId, documentSequence: sequence }); });
  };
  const switchScope = async (next: HistoryScope): Promise<void> => {
    const sockets = FakeSocket.instances.length;
    scope = next;
    hook.rerender(next);
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(sockets + 1));
    socket = FakeSocket.instances.at(-1)!;
    consumed = 0;
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server), sequence));
    await waitFor(() => expect(hook.result.current.status).toBe('saved'));
  };
  historyCleanups.push(() => { hook.unmount(); server.destroy(); });
  return { hook, server, get socket() { return socket; }, commit, publish, switchScope };
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
    while (historyCleanups.length) historyCleanups.pop()?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mockOwnerStatus(read: (projectId: string, init?: RequestInit) => Promise<Response>): void {
    const transport = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (!String(url).startsWith('/api/collaboration/document-enable?')) return transport(url, init);
      const projectId = new URL(String(url), 'http://localhost').searchParams.get('projectId')!;
      return read(projectId, init);
    });
  }

  it.each([true, false])('does not probe a disabled owner document when the feature flag is %s', async featureEnabled => {
    mockOwnerStatus(projectId => Promise.resolve(response(200, { success: true, projectId,
      featureEnabled, enabled: false, currentRevision: 0 })));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a', 'owner-a'));
    await waitFor(() => expect(result.current.authority).toBe('legacy'));
    expect(result.current.status).toBe('disabled');
    expect(vi.mocked(fetch).mock.calls.map(call => String(call[0])))
      .toEqual(['/api/collaboration/document-enable?projectId=project-a']);
    expect(FakeSocket.instances).toHaveLength(0);
    unmount();
  });

  it('retains authoritative read-only geometry for an enabled owner document while the feature flag is off', async () => {
    const transport = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const reply = await transport(url, init);
      return String(url).startsWith('/api/collaboration/document-project?')
        ? response(200, { ...await reply.json(), readOnly: true }) : reply;
    });
    mockOwnerStatus(projectId => Promise.resolve(response(200, { success: true, projectId,
      featureEnabled: false, enabled: true, currentRevision: 1 })));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a', 'owner-a'));
    await waitFor(() => expect(result.current.status).toBe('read-only'));
    expect(result.current.authority).toBe('document');
    expect(result.current.canvasImages[0]).toMatchObject({ placementId: 'p1', x: 10, y: 20 });
    expect(result.current.isWritable()).toBe(false);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.map(call => String(call[0])))
      .toEqual(['/api/collaboration/document-enable?projectId=project-a', '/api/collaboration/document-project?projectId=project-a']);
    unmount();
  });

  it('does not use the owner-only status endpoint for an invited editor', async () => {
    const { unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'editor-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(vi.mocked(fetch).mock.calls.map(call => String(call[0])))
      .toEqual(['/api/collaboration/document-project?projectId=project-a', '/api/collaboration/document-ticket']);
    unmount();
  });

  it('blocks legacy writes as soon as the owner status confirms enablement, before the directory arrives', async () => {
    const transport = vi.mocked(fetch).getMockImplementation()!;
    let finishDirectory!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation((url, init) => String(url).startsWith('/api/collaboration/document-project?')
      ? new Promise(resolve => { finishDirectory = resolve; }) : transport(url, init));
    let enabled = false;
    mockOwnerStatus(projectId => Promise.resolve(response(200, { success: true, projectId,
      featureEnabled: true, enabled, currentRevision: 1 })));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a', 'owner-a'));
    await waitFor(() => expect(result.current.authority).toBe('legacy'));
    enabled = true;
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.authority).toBe('document'));
    expect(result.current.status).toBe('checking');
    expect(result.current.isWritable()).toBe(false);
    expect(FakeSocket.instances).toHaveLength(0);
    const directory = await transport('/api/collaboration/document-project?projectId=project-a');
    await act(async () => { finishDirectory(directory); });
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    unmount();
  });

  it('does not revert a confirmed enabled owner document to legacy on a conflicting directory 409', async () => {
    vi.mocked(fetch).mockResolvedValue(response(409, { success: false, code: 'DOCUMENT_PROJECT_NOT_ENABLED' }));
    mockOwnerStatus(projectId => Promise.resolve(response(200, { success: true, projectId,
      featureEnabled: true, enabled: true, currentRevision: 1 })));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a', 'owner-a'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.authority).toBe('document');
    expect(result.current.isWritable()).toBe(false);
    expect(FakeSocket.instances).toHaveLength(0);
    unmount();
  });

  it('revokes retained legacy consumer admission before React commits enabled owner status', async () => {
    const transport = vi.mocked(fetch).getMockImplementation()!;
    let boundary: { authority: string; persistence: boolean; insertion: boolean; route: string } | undefined;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (!String(url).startsWith('/api/collaboration/document-project?')) return transport(url, init);
      boundary = { authority: retained.authority, persistence: canUseLegacyCanvasPersistence('project-a', retained),
        insertion: retained.projectId === 'project-a' && retained.authority === 'legacy',
        route: routeCanvasWorkspaceChange('project-a', retained, [], []).kind };
      return new Promise<Response>(() => {});
    });
    let enabled = false;
    mockOwnerStatus(projectId => Promise.resolve(response(200, { success: true, projectId,
      featureEnabled: true, enabled, currentRevision: 1 })));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a', 'owner-a'));
    await waitFor(() => expect(result.current.authority).toBe('legacy'));
    const retained = result.current;
    expect(canUseLegacyCanvasPersistence('project-a', retained)).toBe(true);
    enabled = true;
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(boundary).toBeDefined());
    expect(boundary).toEqual({ authority: 'document', persistence: false, insertion: false, route: 'blocked' });
    expect(retained.status).toBe('disabled'); // This object is still the old React render.
    unmount();
    expect(canUseLegacyCanvasPersistence('project-a', retained)).toBe(false);
  });

  it.each(['malformed', 'wrong-project', 'conflict'] as const)('fails closed on %s owner status without a directory or ticket request', async scenario => {
    mockOwnerStatus(() => Promise.resolve(response(scenario === 'conflict' ? 409 : 200,
      scenario === 'conflict' ? { success: false, code: 'DOCUMENT_AUTHORITY_CONFLICT' }
        : { success: true, projectId: scenario === 'wrong-project' ? 'project-b' : 'project-a',
          featureEnabled: true, enabled: scenario === 'malformed' ? 'false' : false, currentRevision: 0 })));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a', 'owner-a'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.authority).toBe('unknown');
    expect(result.current.isWritable()).toBe(false);
    expect(vi.mocked(fetch).mock.calls.map(call => String(call[0])))
      .toEqual(['/api/collaboration/document-enable?projectId=project-a']);
    expect(FakeSocket.instances).toHaveLength(0);
    unmount();
  });

  it.each(['malformed', 'unauthorized'] as const)('revokes retained legacy admission on a later %s owner status', async scenario => {
    let attempts = 0;
    mockOwnerStatus(projectId => Promise.resolve(++attempts === 1
      ? response(200, { success: true, projectId, featureEnabled: true, enabled: false, currentRevision: 0 })
      : scenario === 'unauthorized' ? new Response('<html>login</html>', { status: 401 })
        : response(200, { success: true, projectId, featureEnabled: true, enabled: 'false', currentRevision: 0 })));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a', 'owner-a'));
    await waitFor(() => expect(result.current.authority).toBe('legacy'));
    const retained = result.current;
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(canUseLegacyCanvasPersistence('project-a', retained)).toBe(false);
    expect(routeCanvasWorkspaceChange('project-a', retained, [], []).kind).toBe('blocked');
    expect(FakeSocket.instances).toHaveLength(0);
    unmount();
  });

  it('retries a newly persisted owner project without allowing legacy writes on a transient 403', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    mockOwnerStatus(projectId => Promise.resolve(++attempts === 1
      ? response(403, { success: false, code: 'DOCUMENT_FORBIDDEN' })
      : response(200, { success: true, projectId, featureEnabled: true, enabled: false, currentRevision: 0 })));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a', 'owner-a'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.status).toBe('unavailable');
    expect(result.current.authority).toBe('unknown');
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current.authority).toBe('legacy');
    expect(attempts).toBe(2);
    expect(vi.mocked(fetch).mock.calls.every(call => String(call[0]).startsWith('/api/collaboration/document-enable?'))).toBe(true);
    unmount();
  });

  it.each([true, false])('stops owner admission on a 401 with a JSON body: %s', async json => {
    vi.useFakeTimers();
    mockOwnerStatus(() => Promise.resolve(json
      ? response(401, { success: false, code: 'UNAUTHORIZED' }) : new Response('<html>login</html>', { status: 401 })));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a', 'owner-a'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.status).toBe('unavailable');
    expect(result.current.authority).toBe('document');
    expect(result.current.isWritable()).toBe(false);
    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => { await vi.advanceTimersByTimeAsync(100_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(0);
    unmount();
  });

  it('exhausts a forbidden owner status retry budget without opening the legacy canvas', async () => {
    vi.useFakeTimers();
    mockOwnerStatus(() => Promise.resolve(response(403, { success: false, code: 'DOCUMENT_FORBIDDEN' })));
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a', 'owner-a'));
    await act(async () => { await vi.advanceTimersByTimeAsync(100_000); });
    expect(result.current.status).toBe('unavailable');
    expect(result.current.authority).toBe('unknown');
    expect(result.current.isWritable()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(11);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it.each(['project', 'owner', 'actor'] as const)('discards a delayed owner status after the %s changes', async changed => {
    let finish!: (value: Response) => void;
    let oldSignal: AbortSignal | null | undefined;
    mockOwnerStatus((projectId, init) => {
      if (projectId === 'project-b') return Promise.resolve(response(200, { success: true, projectId,
        featureEnabled: true, enabled: false, currentRevision: 0 }));
      oldSignal = init?.signal;
      return new Promise(resolve => { finish = resolve; });
    });
    const { result, rerender, unmount } = renderHook(({ projectId, ownerId, actorId }) =>
      useCollaborativeCanvas(projectId, actorId, ownerId), {
      initialProps: { projectId: 'project-a', ownerId: 'owner-a', actorId: 'owner-a' },
    });
    await act(async () => { await Promise.resolve(); });
    rerender({ projectId: changed === 'project' ? 'project-b' : 'project-a',
      ownerId: changed === 'owner' ? 'other-owner' : 'owner-a',
      actorId: changed === 'actor' ? 'editor-a' : 'owner-a' });
    await waitFor(() => expect(changed === 'project' ? result.current.authority : FakeSocket.instances.length)
      .toBe(changed === 'project' ? 'legacy' : 1));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { finish(response(200, { success: true, projectId: 'project-a',
      featureEnabled: true, enabled: false, currentRevision: 0 })); });
    expect(result.current.authority).toBe(changed === 'project' ? 'legacy' : 'document');
    expect(result.current.projectId).toBe(changed === 'project' ? 'project-b' : 'project-a');
    unmount();
  });

  it('reports current writable media immediately after HTTP confirmation before React commits its saved render', async () => {
    const { hook: { result, unmount }, server, socket } = await connectMediaHook();
    const original = result.current.canvasImages[0];
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    applyCanvasImagePatch(server, { placementId: 'p2', assetVersionId: 'version-p2',
      x: 30, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1 }, 'remote');
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server), 2));
    expect(result.current.status).toBe('unavailable');
    const retained = result.current;
    expect(uploadWritable(retained)).toBe(false);
    await act(async () => {
      const confirmation = retained.refreshMedia({ projectId: 'project-a', documentSequence: 2 });
      finish(response(200, { success: true, projectId: 'project-a', sequence: 2, readOnly: false,
        projection: readCanvasDocument(server), canvasImages: [original,
          { ...original, id: 'image-p2', placementId: 'p2', assetVersionId: 'version-p2' }] }));
      expect(await confirmation).toHaveLength(2);
      expect(retained.status).toBe('unavailable');
      expect(uploadWritable(retained)).toBe(true);
    });
    expect(result.current.status).toBe('saved');
    unmount(); server.destroy();
  });

  it('rejects the retained saved readiness synchronously on disconnect and unmount', async () => {
    const { hook: { result, unmount }, server } = await connectMediaHook();
    const retained = result.current;
    expect(uploadWritable(retained)).toBe(true);
    act(() => retained.disconnect());
    expect(retained.status).toBe('saved');
    expect(uploadWritable(retained)).toBe(false);
    unmount(); expect(uploadWritable(retained)).toBe(false); server.destroy();
  });

  it.each([{ projectId: 'project-b', actorId: 'owner-a' },
    { projectId: 'project-a', actorId: 'editor-b' }, { projectId: 'project-a', actorId: null }])(
    'rejects retained saved readiness in the layout generation-change window for %s', async scope => {
      const retained: { current?: ReturnType<typeof useCollaborativeCanvas> } = {};
      const observed: boolean[] = [];
      const f = await connectHistoryHook(() => { if (retained.current) observed.push(uploadWritable(retained.current)); });
      retained.current = f.hook.result.current;
      expect(uploadWritable(retained.current)).toBe(true);
      f.hook.rerender(scope);
      expect(observed).toEqual([false]);
      expect(uploadWritable(retained.current)).toBe(false);
    });

  it('waits for the actual pending ACK through the current hook', async () => {
    const f = await connectHistoryHook(); let pending!: Promise<number>;
    act(() => { f.hook.result.current.applyLocalChange({ placementId: 'p1', x: 100 }); pending = f.hook.result.current.waitForPendingUpdates(); });
    const handled = pending.catch(() => -1); f.commit(); expect(await pending).toBe(2); await handled;
  });
  it.each([{ projectId: 'project-b', actorId: 'owner-a' }, { projectId: 'project-a', actorId: 'editor-b' }])('rejects stale ACK wait callbacks after switching to %s', async scope => {
    const f = await connectHistoryHook(); const oldWait = f.hook.result.current.waitForPendingUpdates;
    await f.switchScope(scope); await expect(oldWait()).rejects.toThrow('协作文档作用域已改变');
  });
  it('rejects an ACK waiter when the account changes during the pending await', async () => {
    const f = await connectHistoryHook(); let pending!: Promise<number>; let settled = false;
    act(() => { f.hook.result.current.applyLocalChange({ placementId: 'p1', x: 100 }); pending = f.hook.result.current.waitForPendingUpdates(); });
    const handled = pending.then(value => { settled = true; return { value }; }, error => { settled = true; return { error: String(error.message) }; });
    await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    await f.switchScope({ projectId: 'project-a', actorId: 'editor-b' }); expect(await handled).toEqual({ error: 'DOCUMENT_PENDING_CONFIRMATION_UNAVAILABLE' });
  });
  it('rechecks scope after ACK fulfillment before handing success to the hook caller', async () => {
    const f = await connectHistoryHook(); let pending!: Promise<number>;
    act(() => { f.hook.result.current.applyLocalChange({ placementId: 'p1', x: 100 }); pending = f.hook.result.current.waitForPendingUpdates(); });
    const handled = pending.then(value => ({ value }), error => ({ error: String(error.message) }));
    act(() => { f.socket.acknowledge(2); f.hook.rerender({ projectId: 'project-a', actorId: 'editor-b' }); });
    expect(await handled).toEqual({ error: '协作文档作用域已改变' });
  });

  it('restores removal group and annotation identities through the real hook in a single pending frame', async () => {
    const f = await connectHistoryHook();
    const group = { id: 'group-a', name: 'original', note: '', imageIds: ['p1'], x: 0, y: 0, collapsed: false };
    f.server.getMap('groupDefinitions').set(group.id, group);
    f.server.getMap('annotationRecords').set('annotation-a', { id: 'annotation-a', projectId: 'project-a',
      sourceImageId: 'p1', sourceVersionId: 'version-p1', type: 'text', geometry: { kind: 'text', point: { x: 0.2, y: 0.3 } },
      label: 'original note', status: 'ready', createdAt: 1, updatedAt: 2 });
    const command = { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' } as const;
    const snapshot = captureDocumentPlacementRemovalSnapshot(readCanvasDocument(f.server), 'project-a', command);
    applyCanvasAssetCommand(f.server, command, 'p1');
    f.server.getMap('groupDefinitions').set(group.id, { ...group, name: 'remote renamed', imageIds: [] });
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: historyTransform }, 'p3');
    await f.publish();
    const frames = f.socket.send.mock.calls.length;
    act(() => f.hook.result.current.restorePlacementHistoryMetadata({ previousPlacementId: 'p1',
      nextPlacementId: 'p3', assetVersionId: 'version-p1', removal: { projectId: 'project-a', snapshot,
        annotationIds: { 'annotation-a': 'annotation-new' } } }));
    expect(f.socket.send.mock.calls).toHaveLength(frames + 1);
    expect(f.hook.result.current.groups).toEqual([{ ...group, name: 'remote renamed', imageIds: ['image-p3'] }]);
    expect(f.hook.result.current.annotations).toMatchObject([{ id: 'annotation-new', sourceImageId: 'image-p3',
      sourceVersionId: 'version-p1', label: 'original note' }]);
    const pending = createBrowserPendingUpdateStore('project-a', 'owner-a').load();
    expect(pending).toHaveLength(1);
    expect(pending[0].intent).toMatchObject({ annotationRecords: { 'annotation-new': { sourceImageId: 'p3' } } });
    f.commit();
    expect(readCanvasDocument(f.server).annotationTombstones?.['annotation-a']).toBe(true);
  });

  it('rejects a structurally valid foreign project restoration before writing through the hook', async () => {
    const f = await connectHistoryHook();
    const command = { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' } as const;
    const snapshot = captureDocumentPlacementRemovalSnapshot(readCanvasDocument(f.server), 'project-foreign', command);
    applyCanvasAssetCommand(f.server, command, 'p1');
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: historyTransform }, 'p3');
    await f.publish();
    const frames = f.socket.send.mock.calls.length;
    expect(() => act(() => f.hook.result.current.restorePlacementHistoryMetadata({ previousPlacementId: 'p1',
      nextPlacementId: 'p3', assetVersionId: 'version-p1', removal: { projectId: 'project-foreign',
        snapshot, annotationIds: {} } }))).toThrow();
    expect(f.socket.send.mock.calls).toHaveLength(frames);
    expect(createBrowserPendingUpdateStore('project-a', 'owner-a').load()).toHaveLength(0);
  });

  it.each(['actor', 'project'] as const)('old removal restoration callback stays invalid after a %s scope switch', async field => {
    const f = await connectHistoryHook();
    const old = f.hook.result.current;
    const command = { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' } as const;
    const snapshot = captureDocumentPlacementRemovalSnapshot(readCanvasDocument(f.server), 'project-a', command);
    applyCanvasAssetCommand(f.server, command, 'p1');
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: historyTransform }, 'p3');
    await f.publish();
    await f.switchScope({ actorId: field === 'actor' ? 'owner-b' : 'owner-a',
      projectId: field === 'project' ? 'project-b' : 'project-a' });
    const frames = f.socket.send.mock.calls.length;
    expect(() => old.restorePlacementHistoryMetadata({ previousPlacementId: 'p1',
      nextPlacementId: 'p3', assetVersionId: 'version-p1', removal: { projectId: 'project-a',
        snapshot, annotationIds: {} } })).toThrow();
    expect(f.socket.send.mock.calls).toHaveLength(frames);
  });

  it.each(['undo', 'redo'] as const)('awaits a real media %s and exposes its busy barrier until fulfillment', async direction => {
    const f = await connectHistoryHook();
    let finish!: () => void;
    const events: string[] = [];
    const operation = (): Promise<void> => new Promise(resolve => {
      events.push('started'); finish = (): void => { events.push('finished'); resolve(); };
    });
    act(() => f.hook.result.current.recordMediaHistory({
      undo: direction === 'undo' ? operation : (): void => {},
      redo: direction === 'redo' ? operation : (): void => {},
    }));
    if (direction === 'redo') await act(async () => { await f.hook.result.current.undoLocal(); });
    let returned!: void | Promise<void>;
    act(() => { returned = direction === 'undo' ? f.hook.result.current.undoLocal() : f.hook.result.current.redoLocal(); });
    expect(events).toEqual(['started']);
    expect(returned).toBeInstanceOf(Promise);
    let settled = false;
    const wait = Promise.resolve(returned).then(() => { settled = true; });
    await act(async () => { await Promise.resolve(); });
    expect(settled).toBe(false);
    expect(() => f.hook.result.current.undoLocal()).toThrow();
    expect(() => f.hook.result.current.redoLocal()).toThrow();
    expect(() => f.hook.result.current.applyLocalChange({ placementId: 'p1', x: 70 })).toThrow();
    expect(f.hook.result.current.images.p1.x).toBe(10);
    await act(async () => { finish(); await wait; });
    expect(events).toEqual(['started', 'finished']);
    expect(settled).toBe(true);
    act(() => f.hook.result.current.applyLocalChange({ placementId: 'p1', x: 70 }));
    expect(f.hook.result.current.images.p1.x).toBe(70);
  });

  it.each(['undo', 'redo'] as const)('propagates real media %s rejection and retries the same history item', async direction => {
    const f = await connectHistoryHook();
    let fail = true;
    const events: string[] = [];
    const operation = async (): Promise<void> => { events.push(fail ? 'failed' : 'retried'); if (fail) throw new Error('media unavailable'); };
    act(() => f.hook.result.current.recordMediaHistory({
      undo: direction === 'undo' ? operation : (): void => {},
      redo: direction === 'redo' ? operation : (): void => {},
    }));
    if (direction === 'redo') await act(async () => { await f.hook.result.current.undoLocal(); });
    let outcome: unknown;
    await act(async () => {
      try { await (direction === 'undo' ? f.hook.result.current.undoLocal() : f.hook.result.current.redoLocal()); }
      catch (error) { outcome = error; }
    });
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe('media unavailable');
    fail = false;
    await act(async () => { await (direction === 'undo' ? f.hook.result.current.undoLocal() : f.hook.result.current.redoLocal()); });
    expect(events).toEqual(['failed', 'retried']);
  });

  it('restores optional fields and continues geometry on a canonical replacement through the real hook', async () => {
    const f = await connectHistoryHook();
    act(() => f.hook.result.current.applyLocalChange({ placementId: 'p1', x: 100, annotation: 'local' })); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1');
    await f.publish();
    act(() => f.hook.result.current.recordMediaHistory({
      undo: async (): Promise<void> => {
        applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...historyTransform, x: 100 } }, 'p3');
        await f.publish();
        const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
        f.hook.result.current.restorePlacementHistoryMetadata(binding);
        f.hook.result.current.rebindPlacementHistory(binding);
      },
      redo: async (): Promise<void> => {
        applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p3', expectedAssetVersionId: 'version-p1' }, 'p3');
        await f.publish();
      },
    }));
    await act(async () => { await f.hook.result.current.undoLocal(); }); f.commit();
    expect(f.hook.result.current.images.p3).toMatchObject({ x: 100, annotation: 'local' });
    expect(f.hook.result.current.canvasImages).toMatchObject([{ placementId: 'p3', x: 100 }]);
    await act(async () => { await f.hook.result.current.undoLocal(); }); f.commit();
    expect(f.hook.result.current.images.p3).toMatchObject({ x: 10, annotation: '' });
    expect(f.hook.result.current.images.p1.deleted).toBe(true);
    await act(async () => { await f.hook.result.current.redoLocal(); }); f.commit();
    expect(f.hook.result.current.images.p3).toMatchObject({ x: 100, annotation: 'local' });
    await act(async () => { await f.hook.result.current.redoLocal(); });
    expect(f.hook.result.current.images.p3.deleted).toBe(true);
    expect(f.hook.result.current.canvasImages).toEqual([]);
  });

  it.each(['connecting', 'read-only', 'legacy', 'disabled'] as const)('does not admit media history without an editable %s session', async kind => {
    if (kind !== 'connecting') vi.mocked(fetch).mockResolvedValue(kind === 'legacy'
      ? response(409, { code: 'DOCUMENT_PROJECT_NOT_ENABLED' })
      : response(200, { success: true, projectId: 'project-a', sequence: 1,
        projection: { placements: {} }, canvasImages: [], readOnly: true }));
    const hook = renderHook(() => useCollaborativeCanvas('project-a', kind === 'disabled' ? null : 'owner-a'));
    historyCleanups.push(() => hook.unmount());
    if (kind === 'connecting') await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    else await waitFor(() => expect(hook.result.current.status).not.toBe('checking'));
    let calls = 0;
    expect(() => hook.result.current.recordMediaHistory({ undo: (): void => { calls++; }, redo: (): void => {} })).toThrow();
    const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
    expect(() => hook.result.current.restorePlacementHistoryMetadata(binding)).toThrow();
    expect(() => hook.result.current.rebindPlacementHistory(binding)).toThrow();
    expect(() => hook.result.current.undoLocal()).toThrow();
    expect(() => hook.result.current.redoLocal()).toThrow();
    expect(calls).toBe(0);
    expect(hook.result.current.images).toEqual(kind === 'connecting' ? { p1: expect.any(Object) } : {});
  });

  it.each(['incomplete', 'rejected', 'unavailable', 'disconnected'] as const)('keeps new media history fail-closed while %s', async kind => {
    const f = await connectHistoryHook();
    act(() => f.hook.result.current.applyLocalChange({ placementId: 'p1', x: 100 }));
    const pending = createBrowserPendingUpdateStore('project-a', 'owner-a').load();
    let calls = 0;
    const record = (): void => f.hook.result.current.recordMediaHistory({ undo: (): void => { calls++; }, redo: (): void => {} });
    if (kind === 'incomplete') {
      vi.mocked(fetch).mockResolvedValue(response(503, {}));
      applyCanvasImagePatch(f.server, { placementId: 'p2', assetVersionId: 'version-p2', ...historyTransform }, 'remote');
      act(() => f.socket.snapshot(Y.encodeStateAsUpdate(f.server), 2));
    } else if (kind === 'disconnected') act(() => f.hook.result.current.disconnect());
    else act(() => f.socket.drop(kind === 'rejected' ? 4400 : 1006));
    const durable = createBrowserPendingUpdateStore('project-a', 'owner-a').load();
    const frames = f.socket.send.mock.calls.length;
    expect(record).toThrow();
    const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
    expect(() => f.hook.result.current.restorePlacementHistoryMetadata(binding)).toThrow();
    expect(() => f.hook.result.current.rebindPlacementHistory(binding)).toThrow();
    expect(() => f.hook.result.current.undoLocal()).toThrow();
    expect(() => f.hook.result.current.redoLocal()).toThrow();
    expect(f.socket.send.mock.calls).toHaveLength(frames);
    expect(createBrowserPendingUpdateStore('project-a', 'owner-a').load()).toEqual(durable);
    expect(pending).toHaveLength(1);
    expect(calls).toBe(0);
  });

  describe.each(['switch-actor', 'switch-project'] as const)('pending media history on %s', action => {
    it.each(['fulfill', 'reject'] as const)('does not advance the new session on old %s', async outcome => {
      const f = await connectHistoryHook();
      const old = f.hook.result.current;
      let finish!: () => void;
      const events: string[] = [];
      act(() => old.recordMediaHistory({
        undo: (): Promise<void> => new Promise((resolve, reject) => {
          events.push('started'); finish = (): void => {
            events.push(outcome); if (outcome === 'reject') reject(new Error('old media failed')); else resolve();
          };
        }), redo: (): void => { events.push('old redo'); },
      }));
      let returned!: void | Promise<void>;
      act(() => { returned = old.undoLocal(); });
      let failure: unknown;
      const observed = Promise.resolve(returned).catch(error => { failure = error; });
      expect(events).toEqual(['started']);
      expect(returned).toBeInstanceOf(Promise);
      await f.switchScope(action === 'switch-actor'
        ? { projectId: 'project-a', actorId: 'editor-b' }
        : { projectId: 'project-b', actorId: 'owner-a' });
      act(() => f.hook.result.current.applyLocalChange({ placementId: 'p1', x: 200 })); f.commit();
      const frames = f.socket.send.mock.calls.length;
      await act(async () => { finish(); await observed; });
      expect(events).toEqual(['started', outcome]);
      if (outcome === 'reject') expect(failure).toBeInstanceOf(Error);
      else expect(failure).toBeUndefined();
      expect(f.hook.result.current.status).toBe('saved');
      expect(f.hook.result.current.images.p1.x).toBe(200);
      expect(f.socket.send.mock.calls).toHaveLength(frames);
      expect(() => old.redoLocal()).toThrow('作用域');
      await act(async () => { await f.hook.result.current.undoLocal(); }); f.commit();
      expect(f.hook.result.current.images.p1.x).toBe(10);
      await act(async () => { await f.hook.result.current.redoLocal(); }); f.commit();
      expect(f.hook.result.current.images.p1.x).toBe(200);
      expect(events).toEqual(['started', outcome]);
    });
  });

  it('retains valid callbacks on a same-scope rerender and creates no synthetic history boundary', async () => {
    const f = await connectHistoryHook();
    const retained = f.hook.result.current;
    f.hook.rerender({ projectId: 'project-a', actorId: 'owner-a' });
    act(() => retained.applyLocalChange({ placementId: 'p1', x: 100 })); f.commit();
    const events: string[] = [];
    act(() => retained.recordMediaHistory({ undo: (): void => { events.push('undo'); }, redo: (): void => { events.push('redo'); } }));
    await act(async () => { await retained.undoLocal(); });
    expect(events).toEqual(['undo']);
    expect(f.hook.result.current.images.p1.x).toBe(100);
    await act(async () => { await retained.undoLocal(); }); f.commit();
    expect(f.hook.result.current.images.p1.x).toBe(10);
    await act(async () => { await retained.redoLocal(); }); f.commit();
    expect(f.hook.result.current.images.p1.x).toBe(100);
    await act(async () => { await retained.redoLocal(); });
    expect(events).toEqual(['undo', 'redo']);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  describe.each(['switch-actor', 'switch-project'] as const)('retained callbacks after a ready %s', action => {
  it.each(['patch', 'groups', 'annotations', 'undo', 'redo', 'record', 'restore', 'bind'] as const)('rejects stale %s before touching the new session', async operation => {
    const f = await connectHistoryHook();
    act(() => f.hook.result.current.applyLocalChange({ placementId: 'p1', x: 100, annotation: 'local' })); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1');
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...historyTransform, x: 100 } }, 'p3');
    await f.publish();
    const old = f.hook.result.current;
    await f.switchScope(action === 'switch-actor'
      ? { projectId: 'project-a', actorId: 'editor-b' }
      : { projectId: 'project-b', actorId: 'owner-a' });
    act(() => f.hook.result.current.applyLocalChange({ placementId: 'p3', x: 200 })); f.commit();
    const frames = f.socket.send.mock.calls.length;
    const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
    let staleMediaCalls = 0;
    const mutations = {
      patch: (): void => old.applyLocalChange({ placementId: 'p3', x: 99 }),
      groups: (): void => old.applyLocalGroups([]),
      annotations: (): void => old.applyLocalAnnotations([]),
      undo: (): void | Promise<void> => old.undoLocal(),
      redo: (): void | Promise<void> => old.redoLocal(),
      record: (): void => old.recordMediaHistory({ undo: (): void => { staleMediaCalls++; }, redo: (): void => {} }),
      restore: (): void => old.restorePlacementHistoryMetadata(binding),
      bind: (): void => old.rebindPlacementHistory(binding),
    };
    act(() => expect(mutations[operation]).toThrow('作用域'));
    expect(f.socket.send.mock.calls).toHaveLength(frames);
    expect(f.hook.result.current.images.p3).toMatchObject({ x: 200 });
    expect(f.hook.result.current.images.p3.annotation).toBeUndefined();
    await act(async () => { await f.hook.result.current.undoLocal(); });
    expect(f.hook.result.current.images.p3.x).toBe(100);
    expect(staleMediaCalls).toBe(0);
  });
  });

  describe.each(['switch-actor', 'switch-project'] as const)('scope invalidation during committed %s layout', action => {
    it.each(['patch', 'record', 'undo'] as const)('rejects old %s before the passive session cleanup', async operation => {
      const layout: { retained?: ReturnType<typeof useCollaborativeCanvas> } = {};
      let outcome: unknown;
      let mediaCalls = 0;
      const f = await connectHistoryHook(scope => {
        const old = layout.retained;
        if (!old || (scope.projectId === 'project-a' && scope.actorId === 'owner-a')) return;
        try {
          if (operation === 'patch') old.applyLocalChange({ placementId: 'p1', x: 99 });
          else if (operation === 'record') old.recordMediaHistory({ undo: (): void => { mediaCalls++; }, redo: (): void => {} });
          else old.undoLocal();
          outcome = 'accepted';
        } catch (error) { outcome = error; }
      });
      const old = f.hook.result.current;
      layout.retained = old;
      if (operation === 'undo') act(() => old!.recordMediaHistory({ undo: (): void => { mediaCalls++; }, redo: (): void => {} }));
      const oldSocket = f.socket;
      const frames = oldSocket.send.mock.calls.length;
      const pending = createBrowserPendingUpdateStore('project-a', 'owner-a').load();
      await f.switchScope(action === 'switch-actor'
        ? { projectId: 'project-a', actorId: 'editor-b' }
        : { projectId: 'project-b', actorId: 'owner-a' });
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toContain('作用域');
      expect(oldSocket.send.mock.calls).toHaveLength(frames);
      expect(createBrowserPendingUpdateStore('project-a', 'owner-a').load()).toEqual(pending);
      expect(mediaCalls).toBe(0);
      expect(f.hook.result.current.images.p1.x).toBe(10);
      act(() => f.hook.result.current.applyLocalChange({ placementId: 'p1', x: 200 }));
      expect(f.hook.result.current.images.p1.x).toBe(200);
    });
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

  it.each(['image', 'video'])('refreshes remote media (%s) in the existing session', async mediaType => {
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'editor-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, {
      placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0,
    }, 'seed');
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    const firstImage = result.current.canvasImages[0];
    const secondImage = { ...firstImage, id: 'image-p2', placementId: 'p2',
      assetVersionId: 'version-p2', mediaType,
      url: mediaType === 'video' ? '' : '/api/serve-upload/p2.png',
      ...(mediaType === 'video' ? { videoUrl: '/api/serve-upload/p2.mp4' } : {}) };
    vi.mocked(fetch).mockResolvedValue(response(200, {
      success: true, projectId: 'project-a', sequence: 2, readOnly: false,
      projection: { placements: {
        p1: result.current.images.p1,
        p2: { ...result.current.images.p1, assetVersionId: 'version-p2' },
      } }, canvasImages: [firstImage, secondImage],
    }));
    applyCanvasImagePatch(server, {
      placementId: 'p2', assetVersionId: 'version-p2',
      x: 30, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    }, 'remote');
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server), 2));
    await waitFor(() => expect(result.current.canvasImages.some(
      image => image.placementId === 'p2' && image.assetVersionId === 'version-p2',
    )).toBe(true));
    expect(result.current.canvasImages[1]).toMatchObject({ mediaType, x: 30 });
    if (mediaType === 'video') expect(result.current.canvasImages[1]).toMatchObject({
      url: '', videoUrl: '/api/serve-upload/p2.mp4',
    });
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.send).not.toHaveBeenCalled();
    unmount();
    server.destroy();
  });

  it('retains current media and pending geometry when HTTP has a future replacement', async () => {
    const managers = vi.spyOn(Y.UndoManager.prototype, 'addToScope');
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const undo = managers.mock.contexts[0] as Y.UndoManager;
    const socket = FakeSocket.instances[0];
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, { placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0 }, 'seed');
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
    const media = result.current.canvasImages[0];
    act(() => result.current.applyLocalChange({ placementId: 'p1', x: 91 }));
    const store = createBrowserPendingUpdateStore('project-a', 'owner-a');
    const pending = store.load();
    vi.mocked(fetch).mockResolvedValue(response(200, {
      success: true, projectId: 'project-a', sequence: 3, readOnly: false,
      projection: { placements: {
        p1: { ...result.current.images.p1, assetVersionId: 'version-future', x: 999 },
        p2: { ...result.current.images.p1, assetVersionId: 'version-p2' },
      } }, canvasImages: [
        { ...media, assetVersionId: 'version-future', url: '/api/serve-upload/future.png' },
        { ...media, id: 'image-p2', placementId: 'p2', assetVersionId: 'version-p2' },
      ],
    }));
    applyCanvasImagePatch(server, { placementId: 'p2', assetVersionId: 'version-p2',
      x: 30, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1 }, 'remote');
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server), 2));
    await waitFor(() => expect(result.current.canvasImages).toHaveLength(2));
    expect(result.current.canvasImages.find(image => image.placementId === 'p1'))
      .toMatchObject({ assetVersionId: 'version-p1', x: 91 });
    expect(store.load()).toEqual(pending);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(undo.doc.isDestroyed).toBe(false);
    act(() => result.current.undoLocal());
    expect(result.current.images.p1.x).toBe(10);
    act(() => result.current.redoLocal());
    expect(result.current.images.p1.x).toBe(91);
    server.getMap('assetVersions').set('p1', 'version-future');
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server), 3));
    expect(result.current.canvasImages.find(image => image.placementId === 'p1'))
      .toMatchObject({ assetVersionId: 'version-future', x: 91 });
    server.getMap('tombstones').set('p2', true);
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server), 4));
    expect(result.current.canvasImages.map(image => image.placementId)).toEqual(['p1']);
    expect(FakeSocket.instances).toHaveLength(1);
    unmount(); server.destroy();
  });

  it('explicit media wait ignores ACK and merges targets without changing pending metadata or UndoManager', async () => {
    const managers = vi.spyOn(Y.UndoManager.prototype, 'addToScope');
    const { hook: { result, unmount }, server, socket } = await connectMediaHook();
    const undo = managers.mock.contexts[0] as Y.UndoManager;
    const group = { id: 'g', name: 'G', note: 'local', imageIds: ['image-p1'], x: 1, y: 2, collapsed: false };
    const annotation = { id: 'a', projectId: 'project-a', sourceImageId: 'image-p1',
      sourceVersionId: 'version-p1', type: 'region' as const,
      geometry: { kind: 'region' as const, region: { x: 0, y: 0, w: 1, h: 1 } },
      status: 'ready' as const, createdAt: 1, updatedAt: 1 };
    act(() => {
      result.current.applyLocalChange({ placementId: 'p1', x: 91 });
      result.current.applyLocalGroups([group]);
      result.current.applyLocalAnnotations([annotation]);
    });
    const store = createBrowserPendingUpdateStore('project-a', 'owner-a');
    const pending = store.load();
    expect(pending).toHaveLength(3);
    const media = result.current.canvasImages[0];
    vi.mocked(fetch).mockResolvedValue(response(200, {
      success: true, projectId: 'project-a', sequence: 5, readOnly: false,
      projection: { placements: { p1: { ...result.current.images.p1, x: 999 } } }, canvasImages: [media],
    }));
    const done = vi.fn();
    let first!: Promise<unknown>; let second!: Promise<unknown>;
    act(() => {
      first = result.current.refreshMedia({ projectId: 'project-a', documentSequence: 2 });
      second = result.current.refreshMedia({ projectId: 'project-a', documentSequence: 4 });
      void first.then(done);
    });
    expect(second).toBe(first);
    await act(async () => { await Promise.resolve(); });
    expect(done).not.toHaveBeenCalled();
    expect(store.load()).toEqual(pending);
    const ack = new Uint8Array(9); ack[0] = 0x12;
    new DataView(ack.buffer).setBigUint64(1, BigInt(10));
    act(() => socket.onmessage?.({ data: ack.buffer } as MessageEvent));
    expect(result.current.appliedServerSequence).toBe(1);
    expect(done).not.toHaveBeenCalled();
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server), 3));
    expect(done).not.toHaveBeenCalled();
    await act(async () => { socket.snapshot(Y.encodeStateAsUpdate(server), 4); await first; });
    expect(done).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ x: 91 })]));
    expect(result.current.groups).toEqual([group]);
    expect(result.current.annotations).toEqual([annotation]);
    expect(store.load()).toEqual(pending.slice(1));
    expect(socket.send).toHaveBeenCalledTimes(3);
    expect(undo.doc.isDestroyed).toBe(false);
    act(() => result.current.undoLocal());
    expect(result.current.annotations).toEqual([]);
    expect(result.current.groups).toEqual([group]);
    expect(FakeSocket.instances).toHaveLength(1);
    unmount(); server.destroy();
  });

  it('focus starts one fresh bounded media batch after failure without reconnecting', async () => {
    const { hook: { result, unmount }, server, socket } = await connectMediaHook();
    vi.useFakeTimers();
    const image = result.current.canvasImages[0];
    vi.mocked(fetch).mockResolvedValue(response(503, {}));
    applyCanvasImagePatch(server, { placementId: 'p2', assetVersionId: 'version-p2',
      x: 30, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1 }, 'remote');
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server), 2));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(result.current.status).toBe('unavailable');
    const calls = vi.mocked(fetch).mock.calls.length;
    act(() => socket.snapshot(Y.encodeStateAsUpdate(server), 3));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).toHaveBeenCalledTimes(calls);
    vi.mocked(fetch).mockResolvedValue(response(200, {
      success: true, projectId: 'project-a', sequence: 3, readOnly: false,
      projection: { placements: result.current.images }, canvasImages: [image,
        { ...image, id: 'image-p2', placementId: 'p2', assetVersionId: 'version-p2' }],
    }));
    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.canvasImages).toHaveLength(2);
    expect(result.current.status).toBe('saved');
    expect(FakeSocket.instances).toHaveLength(1);
    unmount(); server.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds initial JSON inspection and never opens a late session after timeout', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockResolvedValue({ ...response(200, {}), json: () => new Promise(resolve => { finish = resolve; }) });
    const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(result.current.status).toBe('unavailable');
    await act(async () => { finish({ success: true, projectId: 'project-a', sequence: 1, readOnly: false,
      projection: { placements: {} }, canvasImages: [] }); });
    expect(FakeSocket.instances).toHaveLength(0);
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403, 'DOCUMENT_DISABLED', 'DOCUMENT_PROJECT_NOT_ENABLED', 'read-only'])(
    'runtime media denial %s releases explicit waiters and retains the sole recovery frames', async denial => {
      const { hook: { result, unmount }, server, socket } = await connectMediaHook();
      act(() => result.current.applyLocalChange({ placementId: 'p1', x: 91 }));
      const store = createBrowserPendingUpdateStore('project-a', 'owner-a');
      const original = store.load();
      const payload = { success: true, projectId: 'project-a', sequence: 2, readOnly: true,
        projection: { placements: result.current.images }, canvasImages: result.current.canvasImages };
      const denied = typeof denial === 'number' ? response(denial, null)
        : denial === 'read-only' ? response(200, payload) : response(503, { code: denial });
      if (typeof denial === 'number') denied.json = async () => { throw new Error('private response'); };
      vi.mocked(fetch).mockResolvedValue(denied);
      const rejected = vi.fn();
      await act(async () => {
        await result.current.refreshMedia({ projectId: 'project-a', documentSequence: 2 }).catch(rejected);
      });
      expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_UNAVAILABLE' }));
      expect(result.current.status).toBe('recovery');
      expect(result.current.recoveryRetryReady).toBe(false);
      expect(JSON.parse(result.current.exportRecoveryCopy()).pendingFrames).toHaveLength(1);
      expect(result.current.exportRecoveryCopy()).toContain('"x": 91');
      expect(store.load()).toEqual(original);
      expect(socket.onmessage).toBeNull();
      expect(() => result.current.applyLocalChange({ placementId: 'p1', x: 99 })).toThrow();
      expect(() => result.current.undoLocal()).toThrow();
      expect(() => result.current.retryRecovered()).toThrow();
      vi.useFakeTimers();
      const calls = vi.mocked(fetch).mock.calls.length;
      act(() => window.dispatchEvent(new Event('focus')));
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(fetch).toHaveBeenCalledTimes(calls);
      expect(vi.getTimerCount()).toBe(0);
      expect(FakeSocket.instances).toHaveLength(1);
      unmount(); server.destroy();
    });

  it.each(['switch-project', 'switch-actor', 'logout', 'unmount'])(
    'cancels an abort-ignoring media JSON result on %s without contaminating a new generation', async action => {
      const hook = renderHook(({ projectId, actorId }) => useCollaborativeCanvas(projectId, actorId), {
        initialProps: { projectId: 'project-a', actorId: 'owner-a' as string | null },
      });
      await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
      const server = createCanvasDocument();
      applyCanvasImagePatch(server, { placementId: 'p1', assetVersionId: 'version-p1',
        x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0 }, 'seed');
      const socket = FakeSocket.instances[0];
      act(() => socket.snapshot(Y.encodeStateAsUpdate(server)));
      act(() => hook.result.current.applyLocalChange({ placementId: 'p1', x: 91 }));
      const store = createBrowserPendingUpdateStore('project-a', 'owner-a');
      const pending = store.load();
      const oldRefresh = hook.result.current.refreshMedia;
      let resolve!: (value: unknown) => void;
      vi.mocked(fetch).mockResolvedValueOnce({ ...response(200, {}), json: () => new Promise(yes => { resolve = yes; }) });
      let wait!: Promise<unknown>; const rejected = vi.fn();
      await act(async () => { wait = oldRefresh({ projectId: 'project-a', documentSequence: 2 }).catch(rejected); });
      expect(resolve).toBeTypeOf('function');
      const signal = vi.mocked(fetch).mock.calls.at(-1)?.[1]?.signal;
      vi.mocked(fetch).mockResolvedValue(response(409, { code: 'DOCUMENT_PROJECT_NOT_ENABLED' }));
      if (action === 'unmount') hook.unmount();
      else hook.rerender({ projectId: action === 'switch-project' ? 'project-b' : 'project-a',
        actorId: action === 'logout' ? null : action === 'switch-actor' ? 'actor-b' : 'owner-a' });
      await act(async () => { await wait; resolve({ success: true, projectId: 'project-a', sequence: 2, readOnly: false,
        projection: { placements: {} }, canvasImages: [] }); });
      expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_CANCELLED' }));
      expect(signal?.aborted).toBe(true);
      expect(store.load()).toEqual(pending);
      expect(socket.onmessage).toBeNull();
      if (action !== 'unmount') {
        expect(hook.result.current.canvasImages).toEqual([]);
        expect(hook.result.current.authority).not.toBe('document');
        hook.unmount();
      }
      server.destroy();
    });

  it.each(['read-only', 'legacy', 'disabled', 'initial'])(
    'explicit refresh never elevates %s into an editable session', async kind => {
      let finish!: (value: Response) => void;
      if (kind === 'initial') vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      else vi.mocked(fetch).mockResolvedValue(kind === 'legacy'
        ? response(409, { code: 'DOCUMENT_PROJECT_NOT_ENABLED' })
        : response(200, { success: true, projectId: 'project-a', sequence: 1, readOnly: true,
          projection: { placements: {} }, canvasImages: [] }));
      const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', kind === 'disabled' ? null : 'owner-a'));
      if (kind !== 'initial') await waitFor(() => expect(result.current.status).not.toBe('checking'));
      const calls = vi.mocked(fetch).mock.calls.length;
      await expect(result.current.refreshMedia({ projectId: 'project-a', documentSequence: 1 }))
        .rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SYNC_UNAVAILABLE' });
      expect(fetch).toHaveBeenCalledTimes(calls);
      expect(FakeSocket.instances).toHaveLength(0);
      unmount();
      if (kind === 'initial') await act(async () => { finish(response(409, { code: 'DOCUMENT_PROJECT_NOT_ENABLED' })); });
    });

  it.each(['missing-media', 'duplicate', 'unsafe-sequence'])(
    'initial %s stays unavailable without accepting a broken directory', async kind => {
      const initialFetch = vi.mocked(fetch).getMockImplementation()!;
      const initial = await initialFetch('/api/collaboration/document-project?projectId=project-a');
      const payload = await initial.json();
      if (kind === 'missing-media') payload.canvasImages = [];
      if (kind === 'duplicate') payload.canvasImages.push(payload.canvasImages[0]);
      if (kind === 'unsafe-sequence') payload.sequence = Number.MAX_SAFE_INTEGER + 1;
      vi.mocked(fetch).mockResolvedValue(response(200, payload));
      const { result, unmount } = renderHook(() => useCollaborativeCanvas('project-a', 'owner-a'));
      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(result.current.authority).not.toBe('legacy');
      expect(result.current.canvasImages).toEqual([]);
      expect(FakeSocket.instances).toHaveLength(0);
      unmount();
    });

  it('rejects a retained refresh callback from an old actor generation before HTTP', async () => {
    const { result, rerender, unmount } = renderHook(({ actorId }) => useCollaborativeCanvas('project-a', actorId), {
      initialProps: { actorId: 'owner-a' },
    });
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const server = createCanvasDocument();
    applyCanvasImagePatch(server, { placementId: 'p1', assetVersionId: 'version-p1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0 }, 'seed');
    act(() => FakeSocket.instances[0].snapshot(Y.encodeStateAsUpdate(server)));
    const oldRefresh = result.current.refreshMedia;
    rerender({ actorId: 'other' });
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    act(() => FakeSocket.instances[1].snapshot(Y.encodeStateAsUpdate(server)));
    const calls = vi.mocked(fetch).mock.calls.length;
    await expect(oldRefresh({ projectId: 'project-a', documentSequence: 1 }))
      .rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SYNC_CANCELLED' });
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(result.current.status).toBe('saved');
    unmount(); server.destroy();
  });

  it('media failure does not hide a rejected recovery copy or erase its pending frames', async () => {
    const { hook: { result, unmount }, server, socket } = await connectMediaHook();
    act(() => result.current.applyLocalChange({ placementId: 'p1', x: 91 }));
    vi.useFakeTimers(); vi.mocked(fetch).mockResolvedValue(response(503, {}));
    applyCanvasImagePatch(server, { placementId: 'p2', assetVersionId: 'version-p2',
      x: 30, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1 }, 'remote');
    act(() => { socket.snapshot(Y.encodeStateAsUpdate(server), 2); socket.drop(4400); });
    const store = createBrowserPendingUpdateStore('project-a', 'owner-a');
    const pending = store.load();
    expect(pending[0].rejected).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.status).toBe('rejected');
    expect(result.current.recoveryRetryReady).toBe(false);
    const copy = JSON.parse(result.current.exportRecoveryCopy());
    expect(copy.pendingFrames).toHaveLength(1);
    expect(copy.projection.placements.p1.x).toBe(91);
    expect(copy.projection.placements.p2.assetVersionId).toBe('version-p2');
    expect(store.load()).toEqual(pending);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.send).toHaveBeenCalledTimes(1);
    unmount(); server.destroy(); expect(vi.getTimerCount()).toBe(0);
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
