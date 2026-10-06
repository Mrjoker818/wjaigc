// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimpleChatBridgeReception, type SimpleChatBridgeReceptionProps } from '@/components/canvas/simple-chat-bridge-reception';
import { canvasBridgeStorageKey, enqueueCanvasBridgeReferences, readCanvasBridgeJournal } from '@/lib/simple-chat-canvas-bridge';
import type { ConsumeCanvasBridgeInput } from '@/lib/simple-chat-canvas-bridge';
import { buildSimpleChatCanvasBridgeImages } from '@/components/simple-chat/simple-chat-types';
import { routeCanvasWorkspaceChange } from '@/lib/collaboration/canvas-document-image-bridge';
import { isCanvasTaskProjectionChange } from '@/lib/canvas-kernel/commands';
import { IncrementalHistoryManager } from '@/lib/canvas-incremental-history';
import type { CanvasImage } from '@/components/infinite-canvas';

// Execute the actual two production callbacks, not a hand-written boolean
// wrapper. Only React's state setter/toast boundary is replaced. This seam
// catches setImages returning true for a merely queued history change.
function productionCallback<T>(name: string, bindings: Record<string, unknown>): T {
  const file = resolve('src/components/canvas-workspace.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name
      && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!callback) throw new Error(`Missing actual callback: ${name}`);
  const js = ts.transpileModule(`const callback = ${callback.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return callback;`)(...Object.values(bindings)) as T;
}
function actualLegacyMerge(): {
  merge: ConsumeCanvasBridgeInput['mergeLegacy']; pending: { current: boolean };
  images: { current: CanvasImage[] }; queue: { current: unknown };
} {
  const pending = { current: true };
  const images = { current: [] as CanvasImage[] };
  const queue = { current: null as unknown };
  const setImages = productionCallback<(action: (previous: CanvasImage[]) => CanvasImage[]) => boolean>('setImages', {
    isDocumentHistoryRecoveryPending: () => false,
    historyLifecyclePendingRef: pending, latestImagesRef: images, prevImagesRef: { current: [] },
    queuedCanvasHistoryChangeRef: queue, historyProjectIdRef: { current: 'project-p' },
    collaborativeCanvasRef: { current: { projectId: 'project-p', authority: 'legacy' } },
    isCanvasTaskProjectionChange, routeCanvasWorkspaceChange,
    incrementalHistoryRef: { current: new IncrementalHistoryManager<CanvasImage>(50) },
    setImagesRaw: () => {}, toast: { error: () => {} },
  });
  return { pending, images, queue,
    merge: productionCallback<ConsumeCanvasBridgeInput['mergeLegacy']>('mergeChatBridgeLegacy', {
      historyLifecyclePendingRef: pending, setImages, buildSimpleChatCanvasBridgeImages,
    }) };
}

const scope = { actorId: 'actor-a', projectId: 'project-p' };
const reference = { assetVersionId: 'version-a', placementId: 'source-a', url: '/private.png' };
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(complete => { resolve = complete; }), resolve: value => resolve(value) };
}
function response(payload: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => payload } as Response;
}
function directory(): Response {
  return response({ success: true, projectId: 'project-p', sequence: 4, readOnly: false,
    projection: { placements: { 'destination-a': { assetVersionId: 'version-a', x: 200, y: 200,
      width: 512, height: 512, rotation: 0, zIndex: 1 } } },
    canvasImages: [{ id: 'image-a', placementId: 'destination-a', assetVersionId: 'version-a',
      url: '/api/serve-upload/a.png', x: 200, y: 200, width: 512, height: 512,
      originalWidth: 512, originalHeight: 512, rotation: 0, zIndex: 1, createdAt: 1 }] });
}
function accepted(): Response {
  return response({ success: true, placementId: 'destination-a', assetVersionId: 'version-a', documentSequence: 4 });
}
function props(overrides: Partial<SimpleChatBridgeReceptionProps> = {}): SimpleChatBridgeReceptionProps {
  return { ...scope, authority: 'document', ready: true, refreshMedia: async () => [],
    resolveReference: async () => reference, mergeLegacy: () => true, ...overrides };
}

describe('real Canvas chat bridge reception and feedback', () => {
  let posts: number;
  let post: () => Promise<Response>;
  beforeEach(async () => {
    posts = 0;
    post = async () => accepted();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { get length(): number { return values.size; },
      key: (index: number): string | null => [...values.keys()][index] ?? null,
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); }, clear: (): void => { values.clear(); } } as Storage);
    vi.stubGlobal('crypto', webcrypto);
    const tails = new Map<string, Promise<unknown>>();
    const locks = { request: <T,>(name: string, callback: (lock: Lock) => T | Promise<T>): Promise<T> => {
      const next = (tails.get(name) ?? Promise.resolve()).then(() => callback({ name, mode: 'exclusive' }));
      tails.set(name, next.catch(() => undefined));
      return next;
    }, query: async () => ({ held: [], pending: [] }) } as LockManager;
    Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') { posts += 1; return post(); }
      if (String(input).includes('document-project')) return directory();
      throw new Error('UNEXPECTED_HTTP');
    });
    await enqueueCanvasBridgeReferences({ ...scope, storage: localStorage, locks,
      isCurrent: () => true, references: [reference] });
  });
  afterEach(() => { cleanup(); Reflect.deleteProperty(navigator, 'locks'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('shows retained work on 403 and retries the same command to confirmed, without another transfer', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method !== 'POST') return directory();
      bodies.push(String(init.body));
      return bodies.length === 1 ? response({ success: false, code: 'FORBIDDEN' }, 403) : accepted();
    });
    render(<SimpleChatBridgeReception {...props()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('待办已保留');
    expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('pending');
    fireEvent.click(screen.getByRole('button', { name: '重试接收' }));
    await waitFor(() => expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('confirmed'));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(screen.getByRole('status').textContent).toContain('接收已确认');
  });

  it('does not consume before hydration/authority is ready', async () => {
    const original = localStorage.getItem(canvasBridgeStorageKey(scope));
    const view = render(<SimpleChatBridgeReception {...props({ ready: false, authority: 'unknown' })} />);
    await act(async () => {});
    expect(posts).toBe(0);
    expect(localStorage.getItem(canvasBridgeStorageKey(scope))).toBe(original);
    view.rerender(<SimpleChatBridgeReception {...props()} />);
    await waitFor(() => expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('confirmed'));
  });

  it('does not cancel its own refresh when callback identity changes while still ready', async () => {
    const refreshed = deferred<Array<{ placementId: string; assetVersionId: string }>>();
    const view = render(<SimpleChatBridgeReception {...props({ refreshMedia: () => refreshed.promise })} />);
    await waitFor(() => expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('accepted'));
    view.rerender(<SimpleChatBridgeReception {...props({ refreshMedia: async () => [] })} />);
    await act(async () => { refreshed.resolve([]); });
    await waitFor(() => expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('confirmed'));
    expect(posts).toBe(1);
  });

  it.each(['actor', 'project', 'actor-roundtrip', 'project-roundtrip', 'unmount'] as const)('drops a late response after %s changes', async change => {
    const late = deferred<Response>(); post = () => late.promise;
    const view = render(<SimpleChatBridgeReception {...props()} />);
    await waitFor(() => expect(posts).toBe(1));
    const pendingRaw = localStorage.getItem(canvasBridgeStorageKey(scope));
    if (change === 'unmount') view.unmount();
    else {
      view.rerender(<SimpleChatBridgeReception {...props(change.startsWith('actor') ? { actorId: 'actor-b' } : { projectId: 'project-q' })} />);
      if (change.endsWith('roundtrip')) view.rerender(<SimpleChatBridgeReception {...props({ ready: false })} />);
    }
    await act(async () => { late.resolve(accepted()); });
    expect(localStorage.getItem(canvasBridgeStorageKey(scope))).toBe(pendingRaw);
    expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].receipt).toBeUndefined();
    expect(screen.queryByText(/接收已确认/)).toBeNull();
    if (change.endsWith('roundtrip')) {
      post = async () => accepted();
      view.rerender(<SimpleChatBridgeReception {...props()} />);
      await waitFor(() => expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('confirmed'));
      expect(posts).toBe(2);
    }
  });

  it('retains legacy journal when managed merge refuses and uses original slot on retry', async () => {
    const slots: number[][] = [];
    let canMerge = false;
    const mergeLegacy: SimpleChatBridgeReceptionProps['mergeLegacy'] = references => {
      slots.push(references.map(item => item.bridgeSlot)); return canMerge;
    };
    render(<SimpleChatBridgeReception {...props({ authority: 'legacy', mergeLegacy })} />);
    expect((await screen.findByRole('alert')).textContent).toContain('待办已保留');
    expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('pending');
    canMerge = true;
    fireEvent.click(screen.getByRole('button', { name: '重试接收' }));
    await waitFor(() => expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('confirmed'));
    expect(slots).toEqual([[0], [0]]);
    expect(posts).toBe(0);
  });

  it('keeps an owner-404 old record and does not treat it as an empty successful merge', async () => {
    localStorage.removeItem(canvasBridgeStorageKey(scope));
    const old = JSON.stringify({ projectId: 'project-p', images: [{ assetVersionId: 'version-a', placementId: 'source-a' }] });
    localStorage.setItem('wujie_canvas_bridge', old);
    render(<SimpleChatBridgeReception {...props({ resolveReference: async () => { throw new Error('ASSET_NOT_FOUND'); } })} />);
    expect((await screen.findByRole('alert')).textContent).toContain('原记录已保留');
    expect(localStorage.getItem('wujie_canvas_bridge')).toBe(old);
    expect(posts).toBe(0);
    expect(screen.queryByText(/接收已确认/)).toBeNull();
  });

  it('fails visibly without Web Locks instead of consuming through an unlocked fallback', async () => {
    const raw = localStorage.getItem(canvasBridgeStorageKey(scope));
    Reflect.deleteProperty(navigator, 'locks');
    render(<SimpleChatBridgeReception {...props()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('待办已保留');
    expect(screen.getByRole('alert').textContent).toContain('浏览器锁不可用');
    expect(localStorage.getItem(canvasBridgeStorageKey(scope))).toBe(raw);
    expect(posts).toBe(0);
  });

  it('receives a newly appended item on the matching cross-tab storage event only', async () => {
    localStorage.removeItem(canvasBridgeStorageKey(scope));
    render(<SimpleChatBridgeReception {...props()} />);
    await act(async () => {});
    await enqueueCanvasBridgeReferences({ ...scope, storage: localStorage, locks: navigator.locks,
      isCurrent: () => true, references: [reference] });
    fireEvent(window, new StorageEvent('storage', { key: canvasBridgeStorageKey({ ...scope, actorId: 'actor-b' }) }));
    await act(async () => {});
    expect(posts).toBe(0);
    fireEvent(window, new StorageEvent('storage', { key: canvasBridgeStorageKey(scope) }));
    await waitFor(() => expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('confirmed'));
    expect(posts).toBe(1);
  });

  it('does not mark a queued legacy history change confirmed, and retries only after application is possible', async () => {
    const actual = actualLegacyMerge();
    actual.pending.current = false;
    const owner = deferred<typeof reference>();
    // ready was true when the effect began, then undo/redo became pending
    // before owner resolution returned. The merge guard must be synchronous.
    render(<SimpleChatBridgeReception {...props({ authority: 'legacy', mergeLegacy: actual.merge,
      resolveReference: () => owner.promise })} />);
    await screen.findByRole('status');
    await act(async () => { actual.pending.current = true; owner.resolve(reference); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('待办已保留'));
    expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('pending');
    expect(actual.images.current).toEqual([]);
    expect(actual.queue.current).toBeNull();
    actual.pending.current = false;
    fireEvent.click(screen.getByRole('button', { name: '重试接收' }));
    await waitFor(() => expect(readCanvasBridgeJournal(localStorage, scope)?.items[0].state).toBe('confirmed'));
    expect(actual.images.current.map(image => [image.assetVersionId, image.placementId, image.x, image.y]))
      .toEqual([['version-a', 'source-a', 200, 200]]);
    expect(actual.queue.current).toBeNull();
    expect(posts).toBe(0);
  });

  it('uses the actual wrapper to deduplicate a prior item without moving the next original slot', () => {
    const actual = actualLegacyMerge();
    actual.pending.current = false;
    actual.images.current = buildSimpleChatCanvasBridgeImages([reference], 1);
    expect(actual.merge([{ ...reference, bridgeSlot: 0 }, {
      assetVersionId: 'version-b', placementId: 'source-b', url: '/b.png', bridgeSlot: 1,
    }])).toBe(true);
    expect(actual.images.current.map(image => [image.placementId, image.x, image.y]))
      .toEqual([['source-a', 200, 200], ['source-b', 420, 200]]);
    expect(new Set(actual.images.current.map(image => image.id)).size).toBe(2);
    expect(actual.queue.current).toBeNull();
  });
});
