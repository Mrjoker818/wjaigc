// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CanvasWorkspace } from '@/components/canvas-workspace';
import { InfiniteCanvas } from '@/components/infinite-canvas';
import { toast } from 'sonner';
import type { AnnotationExecutionContext } from '@/components/infinite-canvas';
import type { CanvasImage } from '@/components/infinite-canvas';
import type { User } from '@/lib/user-types';
import { createCanvasDocument, applyCanvasImagePatch, readCanvasDocument } from '@/lib/collaboration/canvas-document';

// Parent confirmation, document hook/session and media sync are real. The
// lazy child is a consumer probe for focused callback cases; the final
// publication cases mount the real Canvas as well. Other lazy views, local
// user-cache discovery, notifications, HTTP and WS are controlled boundaries.
const capture = vi.hoisted(() => ({ context: undefined as AnnotationExecutionContext | undefined,
  images: [] as CanvasImage[], renderCanvas: false }));
vi.mock('next/dynamic', () => {
  let index = 0;
  return { default: (): ((props: React.ComponentProps<typeof InfiniteCanvas>) => React.JSX.Element | null) => {
    if (index++ !== 0) return (): null => null;
    return (props): React.JSX.Element | null => {
      capture.context = props.annotationExecutionContext; capture.images = props.images ?? [];
      return capture.renderCanvas ? <InfiniteCanvas {...props} /> : null;
    };
  } };
});
const user: User = { id: 'editor-a', name: 'Editor', role: 'user', createdAt: 1, updatedAt: 1 };
vi.mock('@/lib/user-manager', () => ({ UserManager: { getInstance: () => ({
  getUser: (): User => user, getProjects: (): [] => [], getProjectSyncRevision: (): number => 0,
  upsertUserFromServer: async (value: User): Promise<User> => value,
  waitForProjectHydration: async (): Promise<void> => undefined,
  flushProjectsToServer: async (): Promise<void> => undefined,
  onProjectsChanged: (): (() => void) => (): void => undefined,
  loadProjectsFromServer: async (): Promise<boolean> => true,
  getCanvasRendererMode: (): string => 'legacy', getWorkflowRendererMode: (): string => 'legacy',
  getCanvasKernelMode: (): string => 'legacy',
}) } }));
vi.mock('sonner', () => ({ Toaster: (): null => null,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/task-events-client', () => ({ taskEventsClient: {
  connect: (): void => undefined, disconnect: (): void => undefined,
  onTaskEvent: (): (() => void) => (): void => undefined, isConnected: (): boolean => false,
} }));

class Socket {
  static instances: Socket[] = [];
  static OPEN = 1;
  readyState = 1;
  binaryType: BinaryType = 'blob';
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { Socket.instances.push(this); }
  close(): void { this.readyState = 3; }
  send(): void {}
  snapshot(doc: Y.Doc, sequence: number): void {
    const update = Y.encodeStateAsUpdate(doc), bytes = new Uint8Array(9 + update.length);
    bytes[0] = 0x11;
    new DataView(bytes.buffer).setBigUint64(1, BigInt(sequence));
    bytes.set(update, 9);
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }
}
const reference = { assetId: 'asset-result', assetVersionId: 'version-result', placementId: 'placement-result',
  entityId: 'entity-result', kind: 'image', url: '/api/serve-upload/canonical-result.png' };
const completion = { status: 'completed', assetProjection: { status: 'completed', references: [reference] } };
let server: Y.Doc;
let images: Array<Record<string, unknown>>;
let sequence: number;
let holdDirectory: boolean;
let directoryResolve: ((value: Response) => void) | undefined;
let readOnly: boolean;
function storage(): Storage {
  const values = new Map<string, string>();
  return { get length(): number { return values.size; }, clear: (): void => values.clear(),
    getItem: (key: string): string | null => values.get(key) ?? null,
    key: (index: number): string | null => [...values.keys()][index] ?? null,
    setItem: (key: string, value: string): void => { values.set(key, value); },
    removeItem: (key: string): void => { values.delete(key); } };
}
function directory(): Response {
  return Response.json({ success: true, projectId: 'project-a', ownerId: 'owner-a', sequence,
    projection: readCanvasDocument(server), canvasImages: images, readOnly,
    workspace: { id: 'project-a', userId: 'owner-a', name: 'Shared', createdAt: 1, updatedAt: 1,
      canvasImages: [], settings: {} } });
}
async function mountWorkspace(): Promise<ReturnType<typeof render>> {
  const view = render(<CanvasWorkspace initialUser={user} onLoggedOut={() => undefined} />);
  await waitFor(() => expect(Socket.instances.length).toBe(1));
  act(() => Socket.instances[0].snapshot(server, sequence));
  await waitFor(() => expect(capture.context?.writable).toBe(true));
  return view;
}
function addResult(overrides: Record<string, unknown> = {}): void {
  applyCanvasImagePatch(server, { placementId: String(overrides.placementId ?? 'placement-result'),
    assetVersionId: String(overrides.assetVersionId ?? 'version-result'),
    x: 40, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1 }, 'remote');
  images.push({ ...reference, id: 'entity-result', x: 40, y: 20, width: 80, height: 60,
    originalWidth: 80, originalHeight: 60, rotation: 0, zIndex: 1, createdAt: 1, ...overrides });
  sequence++;
}
function seedRunnableAnnotation(): void {
  capture.renderCanvas = true;
  localStorage.setItem('wujie_selected_model', JSON.stringify({ model: 'offline::edit', providerId: 'offline' }));
  images[0].annotationVersionId = 'entity-source:asset:version-source';
  server.getMap('annotationRecords').set('annotation-original', { id: 'annotation-original', projectId: 'project-a',
    sourceImageId: 'placement-source', sourceVersionId: 'entity-source:asset:version-source', type: 'text',
    geometry: { kind: 'text', point: { x: 0.5, y: 0.5 } }, instruction: 'make it blue',
    status: 'ready', createdAt: 1, updatedAt: 1 });
}
beforeEach((): void => {
  capture.context = undefined; capture.renderCanvas = false; Socket.instances = []; sequence = 1; holdDirectory = false;
  vi.mocked(toast.success).mockClear();
  directoryResolve = undefined; readOnly = false;
  window.history.replaceState(null, '', '/?projectId=project-a');
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  server = createCanvasDocument();
  applyCanvasImagePatch(server, { placementId: 'placement-source', assetVersionId: 'version-source',
    x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0 }, 'seed');
  images = [{ id: 'entity-source', assetId: 'asset-source', assetVersionId: 'version-source',
    placementId: 'placement-source', url: '/api/serve-upload/source.png', x: 10, y: 20,
    width: 80, height: 60, originalWidth: 80, originalHeight: 60, rotation: 0, zIndex: 0, createdAt: 1 }];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.startsWith('/api/collaboration/document-project?')) {
      if (holdDirectory) return new Promise(resolve => { directoryResolve = resolve; });
      return directory();
    }
    if (url.includes('document-ticket')) return Response.json({ success: true, ticket: 'a'.repeat(43) });
    if (url === '/api/session') return Response.json({ success: true, user });
    if (url === '/api/annotations/execute') return Response.json({ success: true, taskId: 'annotation-task' });
    if (url === '/api/poll-task') return Response.json(completion);
    return Response.json({ success: true, providers: [], models: [], tasks: [], favorites: [] });
  });
});
afterEach((): void => { cleanup(); server?.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('the parent confirms a freshly authorized full canonical identity without a second media insertion', async () => {
  await mountWorkspace(); addResult();
  act(() => Socket.instances[0].snapshot(server, sequence));
  await waitFor(() => expect(capture.context?.writable).toBe(true));
  let confirmed = false;
  await act(async () => { confirmed = await capture.context!.confirmPublication(completion, new AbortController().signal); });
  expect(confirmed).toBe(true);
  expect(capture.images.map(image => image.id)).toEqual(['entity-source', 'entity-result']);
});

it('HTTP ahead of WS keeps confirmation pending until the matching document arrives', async () => {
  await mountWorkspace(); addResult();
  let outcome: boolean | undefined;
  const promise = capture.context!.confirmPublication(completion, new AbortController().signal)
    .then(value => { outcome = value; });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(outcome).toBeUndefined();
  await act(async () => { Socket.instances[0].snapshot(server, sequence); await promise; });
  expect(outcome).toBe(true);
});

for (const field of ['id', 'assetId', 'assetVersionId', 'placementId', 'url'] as const) {
  it(`a different canonical ${field} cannot confirm another media identity`, async () => {
    await mountWorkspace(); addResult({ [field]: field === 'url' ? '/api/serve-upload/other.png' : 'other-identity' });
    act(() => Socket.instances[0].snapshot(server, sequence));
    await waitFor(() => expect(capture.context?.writable).toBe(true));
    let outcome = true;
    await act(async () => { outcome = await capture.context!.confirmPublication(completion, new AbortController().signal); });
    expect(outcome).toBe(false);
  });
}

it('read-only authorization returned while refreshing rejects the retained confirmation', async () => {
  await mountWorkspace(); addResult(); readOnly = true;
  let outcome = true;
  await act(async () => { outcome = await capture.context!.confirmPublication(completion, new AbortController().signal).catch(() => false); });
  expect(outcome).toBe(false);
});

it('unmounting during a pending authorized directory cannot confirm a late response', async () => {
  const view = await mountWorkspace(); addResult(); holdDirectory = true;
  const outcome = capture.context!.confirmPublication(completion, new AbortController().signal).catch(() => false);
  await waitFor(() => expect(directoryResolve).toBeDefined());
  view.unmount(); directoryResolve!(directory());
  expect(await outcome).toBe(false);
});

it('an aborted waiting run cannot confirm even if the transport delivers a late valid directory', async () => {
  await mountWorkspace(); addResult(); holdDirectory = true;
  const controller = new AbortController();
  const outcome = capture.context!.confirmPublication(completion, controller.signal).catch(() => false);
  await waitFor(() => expect(directoryResolve).toBeDefined()); controller.abort();
  await act(async () => { Socket.instances[0].snapshot(server, sequence); directoryResolve!(directory()); });
  expect(await outcome).toBe(false);
});

it('WS ahead of HTTP allows an already-started confirmation to await the authorized directory', async () => {
  await mountWorkspace();
  const retained = capture.context!;
  holdDirectory = true; addResult();
  act(() => Socket.instances[0].snapshot(server, sequence));
  await waitFor(() => expect(directoryResolve).toBeDefined());
  let outcome: boolean | undefined;
  const promise = retained.confirmPublication(completion, new AbortController().signal)
    .then(value => { outcome = value; });
  await act(async () => { await Promise.resolve(); });
  expect(outcome).toBeUndefined();
  await act(async () => { directoryResolve!(directory()); await promise; });
  expect(outcome).toBe(true);
});

for (const order of ['http-first', 'ws-first'] as const) {
  it(`the real parent and Canvas complete one canonical result across ${order} publication`, async () => {
    seedRunnableAnnotation();
    const view = await mountWorkspace();
    if (order === 'ws-first') holdDirectory = true;
    addResult();
    fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
    fireEvent.click(await view.findByTestId('annotation-execute'));
    await view.findByText('等待协作媒体同步');
    expect(Number(view.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100);
    expect(toast.success).not.toHaveBeenCalled();
    act(() => Socket.instances[0].snapshot(server, sequence));
    if (order === 'ws-first') {
      await waitFor(() => expect(directoryResolve).toBeDefined());
      expect(view.getByRole('button', { name: '取消' })).toBeTruthy();
      await act(async () => { directoryResolve!(directory()); });
    }
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(capture.images.map(image => image.id)).toEqual(['entity-source', 'entity-result']);
  });
}

it('the real parent and Canvas stop a retained run when the directory revokes write access', async () => {
  seedRunnableAnnotation();
  const view = await mountWorkspace(); holdDirectory = true; addResult();
  fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
  fireEvent.click(await view.findByTestId('annotation-execute'));
  await waitFor(() => expect(directoryResolve).toBeDefined()); readOnly = true;
  await act(async () => { directoryResolve!(directory()); });
  await waitFor(() => expect(capture.context?.canWaitForPublication).toBe(false));
  expect(toast.success).not.toHaveBeenCalled();
  expect(capture.images.map(image => image.id)).toEqual(['entity-source']);
  expect(view.queryByRole('button', { name: '取消' })).toBeNull();
});
