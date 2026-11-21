// @vitest-environment jsdom
import React, { useState } from 'react';
import net from 'node:net';
import tls from 'node:tls';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';
import { installJsdomMediaQueries } from '../helpers/jsdom-browser-apis';
import { reconcileImageBatchDeletion } from '@/lib/asset-core/batch-placement-delete';
import { isTerminalProcessingFailure } from '@/lib/video-processing-state';

const toast = vi.hoisted(() => ({ loading: vi.fn(() => 'offline-toast'), dismiss: vi.fn(),
  error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('pg', () => { throw new Error('ANNOTATION_BOUNDARY_DATABASE_FORBIDDEN'); });
vi.mock('@/lib/task-events-client', () => ({ taskEventsClient: {
  connect: () => undefined, disconnect: () => undefined, isConnected: () => false,
  onTaskEvent: () => () => undefined,
} }));

const a: CanvasImage = { id: 'boundary-a', url: '/offline/a-v1.png', annotationVersionId: 'a-v1',
  x: 100, y: 100, width: 200, height: 200, createdAt: 1 };
const b: CanvasImage = { id: 'boundary-b', url: '/offline/b-v1.png', annotationVersionId: 'b-v1',
  x: 400, y: 100, width: 200, height: 200, createdAt: 2 };
const oldAnnotation: CanvasAnnotationV2 = { id: 'old-a-region', projectId: 'boundary-project',
  sourceImageId: a.id, sourceVersionId: 'a-v1', type: 'region', status: 'ready',
  geometry: { kind: 'region', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
  instruction: '把区域改成蓝色', createdAt: 1, updatedAt: 1 };
const targetA = { label: 'only-from-A', confidence: 0.95, region: { x: 0.12, y: 0.18, w: 0.2, h: 0.25 } };
const annotationWrites: CanvasAnnotationV2[][] = [];
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
const violations: string[] = [];
let resolver: (() => Promise<Response>) | undefined;
let generationReply: (() => Promise<Response>) | undefined;
let pollReply: (() => Promise<Response>) | undefined;
let mediaState: CanvasImage[] = [];
const mediaWrites: CanvasImage[][] = [];
const deleteRequests: string[][] = [];
const placementDeletes: string[] = [];
let restoreMedia: (() => void) | undefined;

function Harness({ images = [a, b], annotations = [], selection }: {
  images?: CanvasImage[]; annotations?: CanvasAnnotationV2[]; selection?: CanvasImage | null;
}) {
  const [selected, setSelected] = useState<CanvasImage | null>(images[0]);
  return <InfiniteCanvas images={images} selectedImage={selection === undefined ? selected : selection} onSelectImage={setSelected}
    onImagesChange={() => undefined} onPreviewImage={() => undefined} onGenerateVariation={() => undefined}
    onFusion={() => undefined}
    onExtractKeywords={() => undefined} onAddImages={() => undefined} projectId="boundary-project"
    onRequestTaskPoll={async () => Response.json({ status: 'pending' })}
    initialAnnotations={annotations} initialViewState={{ offsetX: 0, offsetY: 0, zoom: 1 }}
    onAnnotationsChange={items => { annotationWrites.push(items); return true; }} />;
}

const managedOriginal: CanvasImage = { ...a, assetId: 'original-asset', assetVersionId: 'original-version', placementId: 'original-placement' };
function MediaHarness({ rejectDuplicate = false }: { rejectDuplicate?: boolean }) {
  const [images, setImages] = useState<CanvasImage[]>([managedOriginal]);
  const [selected, setSelected] = useState<CanvasImage | null>(managedOriginal);
  // Diagnostic readout only; the synthetic host never consumes this in rendering.
  // eslint-disable-next-line react-hooks/globals
  mediaState = images;
  return <InfiniteCanvas images={images} selectedImage={selected} onSelectImage={setSelected}
    onImagesChange={next => {
      mediaWrites.push(next);
      if (rejectDuplicate && next.length > images.length) return false;
      setImages(next); return true;
    }}
    onDeleteImages={async ids => {
      deleteRequests.push(ids);
      // The workspace's real legacy deletion reconciler, with its HTTP boundary synthetic.
      const result = await reconcileImageBatchDeletion(images.filter(image => ids.includes(image.id))
        .map(image => ({ ...image, projectId: 'boundary-project' })),
      async image => { placementDeletes.push(image.placementId); }, () => undefined);
      setImages(current => current.filter(image => !result.deletedIds.includes(image.id)));
      return result.deletedIds;
    }}
    onPreviewImage={() => undefined} onGenerateVariation={() => undefined}
    onFusion={() => undefined}
    onExtractKeywords={() => undefined} onAddImages={() => undefined} projectId="boundary-project"
    initialViewState={{ offsetX: 0, offsetY: 0, zoom: 1 }}
    onRequestTaskPoll={async body => {
      requests.push({ url: '/api/poll-task', body });
      if (pollReply) return pollReply();
      violations.push('unexpected poll'); throw new Error('UNEXPECTED_BOUNDARY_POLL');
    }} />;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
}
async function open(view: ReturnType<typeof render>, tool?: string) {
  await settle();
  fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
  await settle();
  if (tool) { fireEvent.click(view.getByRole('button', { name: tool })); await settle(); }
  return view.container.querySelector<HTMLElement>('[data-canvas-interaction-surface]')!;
}
function down(surface: HTMLElement, x: number, y: number, pointerId = 1) {
  fireEvent.pointerDown(surface, { pointerId, isPrimary: true, button: 0, clientX: x, clientY: y });
}
function up(surface: HTMLElement, x: number, y: number, pointerId = 1) {
  fireEvent.pointerUp(surface, { pointerId, isPrimary: true, button: 0, clientX: x, clientY: y });
}

beforeEach(() => {
  expect(Object.keys(process.env).filter(key => /^(PG|DATABASE|POSTGRES|TEST_POSTGRES|COZE_SUPABASE)|^WUJIE_.*DB|^WUJIE_AUTH_PERSISTENCE_MODE$/.test(key))).toEqual([]);
  vi.useFakeTimers(); annotationWrites.length = 0; requests.length = 0; violations.length = 0; resolver = undefined;
  generationReply = undefined; pollReply = undefined; mediaWrites.length = 0; deleteRequests.length = 0; placementDeletes.length = 0;
  Object.values(toast).forEach(notification => notification.mockClear());
  const denied = (): never => { violations.push('socket'); throw new Error('ANNOTATION_BOUNDARY_NETWORK_FORBIDDEN'); };
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(denied);
  vi.spyOn(tls, 'connect').mockImplementation(denied);
  vi.stubGlobal('React', React);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); } });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  restoreMedia = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false });
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly pointerId: number; readonly pointerType = 'mouse'; readonly isPrimary = true;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, toJSON: () => ({}),
  }));
  for (const key of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, value: () => key === 'hasPointerCapture' });
  }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ url, body });
    if (url === '/api/models?type=upscaler' || url === '/api/models?type=removebg' || url === '/api/models?type=3d') return Response.json({ models: [], providers: [] });
    if (url === '/api/auth/me') return Response.json({ success: true, user: { id: 'boundary-actor' } });
    if (url === '/api/annotations/resolve-target' && resolver) return resolver();
    if (url === '/api/generate' && generationReply) return generationReply();
    violations.push(url); throw new Error(`ANNOTATION_BOUNDARY_UNEXPECTED_REQUEST ${url}`);
  });
});
afterEach(() => {
  cleanup(); restoreMedia?.(); restoreMedia = undefined;
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const key of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) Reflect.deleteProperty(HTMLElement.prototype, key);
  expect(violations).toEqual([]);
});

it('characterizes same-image version changes: old geometry becomes stale and cannot execute against v2', async () => {
  const view = render(<Harness images={[a]} annotations={[oldAnnotation]} />);
  const surface = await open(view, '框选区域');
  view.rerender(<Harness images={[{ ...a, url: '/offline/a-v2.png', annotationVersionId: 'a-v2' }]} annotations={[oldAnnotation]} />);
  await settle();
  down(surface, 140, 140); up(surface, 220, 220); await settle();
  const latest = annotationWrites.at(-1)!;
  console.info('VERSION_BOUNDARY_OBSERVED', JSON.stringify(latest));
  expect(latest.map(item => ({ source: item.sourceVersionId, status: item.status }))).toEqual([
    { source: 'a-v1', status: 'stale' }, { source: 'a-v2', status: 'ready' },
  ]);
  fireEvent.click(view.getByTestId('annotation-execute')); await settle();
  expect(requests.filter(item => item.url === '/api/annotations/execute')).toEqual([]);
});

it('rejects an A recognition result after pointer-down starts a B gesture before B pointer-up', async () => {
  const pendingA = deferred<Response>(); resolver = () => pendingA.promise;
  const view = render(<Harness />);
  const surface = await open(view);
  down(surface, 140, 140); up(surface, 140, 140); await settle();
  expect(requests.filter(item => item.url === '/api/annotations/resolve-target').map(item => item.body.sourceImageId)).toEqual([a.id]);
  down(surface, 440, 140, 2); await settle();
  await act(async () => { pendingA.resolve(Response.json({ success: true, target: targetA, requiresConfirmation: false, requestId: 'old-a' })); });
  await settle();
  const latest = annotationWrites.at(-1) ?? [];
  console.info('LATE_A_AFTER_B_DOWN_OBSERVED', JSON.stringify(latest));
  expect(latest.filter(item => item.sourceImageId === b.id && item.label === 'only-from-A')).toEqual([]);
});

it('keeps the existing request-sequence protection once both A and B gestures have pointer-up', async () => {
  const pendingA = deferred<Response>(); const pendingB = deferred<Response>(); let calls = 0;
  resolver = () => ++calls === 1 ? pendingA.promise : pendingB.promise;
  const view = render(<Harness />); const surface = await open(view);
  down(surface, 140, 140); up(surface, 140, 140); await settle();
  down(surface, 440, 140, 2); up(surface, 440, 140, 2); await settle();
  expect(requests.filter(item => item.url === '/api/annotations/resolve-target').map(item => item.body.sourceImageId)).toEqual([a.id, b.id]);
  await act(async () => { pendingA.resolve(Response.json({ success: true, target: targetA, requiresConfirmation: false, requestId: 'old-a' })); });
  expect(annotationWrites.at(-1) ?? []).toEqual([]);
  await act(async () => { pendingB.resolve(Response.json({ success: true,
    target: { label: 'only-from-B', confidence: 0.96, region: { x: 0.5, y: 0.5, w: 0.1, h: 0.2 } },
    requiresConfirmation: false, requestId: 'current-b' })); });
  const latest = annotationWrites.at(-1)!;
  console.info('TWO_RELEASED_GESTURES_OBSERVED', JSON.stringify(latest));
  expect(latest).toHaveLength(1);
  expect(latest[0]).toMatchObject({ sourceImageId: b.id, sourceVersionId: 'b-v1', label: 'only-from-B' });
});

it.each([false, true])('duplicate/delete leaves the managed original untouched with controlled rejection=%s', async rejectDuplicate => {
  render(<MediaHarness rejectDuplicate={rejectDuplicate} />); await settle();
  fireEvent.keyDown(window, { key: 'a', code: 'KeyA', ctrlKey: true }); await settle();
  fireEvent.keyDown(window, { key: 'd', code: 'KeyD', ctrlKey: true }); await settle();
  const attempt = mediaWrites.find(items => items.length === 2)!;
  expect(attempt).toHaveLength(2);
  const duplicate = attempt.find(image => image.id !== a.id)!;
  expect({ assetId: duplicate.assetId, versionId: duplicate.assetVersionId, placementId: duplicate.placementId })
    .toEqual({ assetId: undefined, versionId: undefined, placementId: undefined });
  expect(duplicate.id).not.toBe(a.id);
  fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' }); await settle();
  console.info('COPY_DELETE_OBSERVED', JSON.stringify({ rejectDuplicate, duplicate, deleteRequests, placementDeletes, remaining: mediaState }));
  expect(deleteRequests.flat()).not.toContain(a.id);
  expect(placementDeletes).toEqual([]);
  expect(mediaState).toEqual([managedOriginal]);
  if (!rejectDuplicate) expect(deleteRequests).toEqual([[duplicate.id]]);
});

async function startPanorama(view: ReturnType<typeof render>) {
  await settle();
  fireEvent.contextMenu(view.container.querySelector('[data-canvas-interaction-surface]')!, { clientX: 140, clientY: 140 });
  await settle();
  fireEvent.click(view.getByRole('button', { name: '生成720全景图' }));
  await settle();
}

it('panorama immediate success replaces its single placeholder and preserves the source', async () => {
  generationReply = async () => Response.json({ success: true, imageUrl: '/offline/panorama.png', usedModel: 'offline-used' });
  const view = render(<MediaHarness />); await startPanorama(view);
  const placeholder = mediaWrites.flat().find(image => image.isProcessingPlaceholder)!;
  console.info('PANORAMA_IMMEDIATE_OBSERVED', JSON.stringify(mediaState));
  expect(placeholder).toBeDefined();
  expect(mediaState).toHaveLength(2);
  expect(mediaState.find(image => image.id === placeholder.id)).toMatchObject({ url: '/offline/panorama.png', isProcessingPlaceholder: false });
  expect(mediaState.find(image => image.id === placeholder.id)?.processing).toBeUndefined();
  expect(mediaState[0]).toEqual(managedOriginal);
  expect(requests.filter(item => item.url === '/api/poll-task')).toEqual([]);
});

it.each(['completed', 'failed'] as const)('panorama polling reaches a visible %s terminal on the same placeholder', async status => {
  generationReply = async () => Response.json({ success: true, taskId: 'offline-panorama-task', usedModel: 'offline-used' });
  pollReply = async () => Response.json(status === 'completed'
    ? { status, imageUrl: '/offline/panorama-polled.png' }
    : { status, error: '合成全景失败' });
  const view = render(<MediaHarness />); await startPanorama(view);
  const placeholder = mediaState.find(image => image.isProcessingPlaceholder)!;
  expect(placeholder).toBeDefined();
  await act(async () => { await vi.advanceTimersByTimeAsync(801); });
  const final = mediaState.find(image => image.id === placeholder.id)!;
  console.info('PANORAMA_POLL_TERMINAL_OBSERVED', JSON.stringify({ status, final, polls: requests.filter(item => item.url === '/api/poll-task') }));
  expect(mediaState).toHaveLength(2); expect(mediaState[0]).toEqual(managedOriginal);
  expect(requests.filter(item => item.url === '/api/poll-task')).toHaveLength(1);
  if (status === 'completed') {
    expect(final).toMatchObject({ url: '/offline/panorama-polled.png', isProcessingPlaceholder: false });
    expect(final.processing).toBeUndefined();
  } else {
    expect(final.processing?.error).toContain('合成全景失败');
    console.info('PANORAMA_FAILURE_RENDER_OBSERVED', JSON.stringify({
      recognizedAsTerminal: isTerminalProcessingFailure(final.processing),
      hasErrorPanel: Boolean(view.container.querySelector('[data-popup="task-error"]')),
      hasFailureActions: Boolean(view.container.querySelector('[data-popup="task-failure-actions"]')),
      visibleStatus: [...view.container.querySelectorAll('[role="status"]')].map(node => node.textContent),
    }));
    expect(isTerminalProcessingFailure(final.processing), 'a failed poll must render the terminal failure branch').toBe(true);
    expect(view.container.querySelector('[data-popup="task-error"]')?.textContent).toContain('合成全景失败');
    expect(view.container.querySelector('[data-popup="task-failure-actions"]')).not.toBeNull();
  }
});

it.each(['escape-cancel', 'version-change', 'selection-away-back', 'same-source-new-gesture'] as const)(
  'followup semantic lifecycle ignores a pending result after %s', async change => {
    const pending = deferred<Response>(); resolver = () => pending.promise;
    const view = render(<Harness />); const surface = await open(view);
    down(surface, 140, 140); up(surface, 140, 140); await settle();
    if (change === 'escape-cancel') {
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    } else if (change === 'version-change') {
      view.rerender(<Harness images={[{ ...a, url: '/offline/a-v2.png', annotationVersionId: 'a-v2' }, b]} />);
    } else if (change === 'selection-away-back') {
      view.rerender(<Harness selection={b} />); await settle();
      view.rerender(<Harness selection={a} />);
    } else {
      down(surface, 200, 200, 2);
    }
    await settle();
    await act(async () => { pending.resolve(Response.json({ success: true, target: targetA, requiresConfirmation: false })); });
    await settle();
    console.info('FOLLOWUP_LIFECYCLE_OBSERVED', JSON.stringify({ change, writes: annotationWrites }));
    expect(annotationWrites.flat().filter(item => item.label === 'only-from-A')).toEqual([]);
  },
);

it.each(['low-confidence', 'error'] as const)('followup stale %s cannot cancel or switch the new B gesture', async outcome => {
  const pending = deferred<Response>(); resolver = () => pending.promise;
  const view = render(<Harness />); const surface = await open(view);
  down(surface, 140, 140); up(surface, 140, 140); await settle();
  down(surface, 440, 140, 2); await settle();
  await act(async () => { pending.resolve(outcome === 'low-confidence'
    ? Response.json({ success: true, target: targetA, requiresConfirmation: true })
    : Response.json({ success: false, message: '合成旧识别失败' }, { status: 500 })); });
  await settle();
  expect(view.getByRole('button', { name: '智能标记对象' }).getAttribute('aria-pressed')).toBe('true');
  expect(view.container.querySelector('[data-annotation-kind="draft-semantic-object"]')).not.toBeNull();
  expect(annotationWrites.flat()).toEqual([]);
});

it('followup a current semantic result still commits to its original source and version', async () => {
  resolver = async () => Response.json({ success: true, target: targetA, requiresConfirmation: false });
  const view = render(<Harness />); const surface = await open(view);
  down(surface, 140, 140); up(surface, 140, 140); await settle();
  expect(annotationWrites.at(-1)).toHaveLength(1);
  expect(annotationWrites.at(-1)![0]).toMatchObject({ sourceImageId: a.id, sourceVersionId: 'a-v1', status: 'ready', label: 'only-from-A' });
});

it('followup panorama cancellation is removable without deleting the source or submitting again', async () => {
  generationReply = async () => Response.json({ success: true, taskId: 'offline-cancel-task', usedModel: 'offline-used' });
  pollReply = async () => Response.json({ status: 'cancelled' });
  const view = render(<MediaHarness />); await startPanorama(view);
  await act(async () => { await vi.advanceTimersByTimeAsync(801); });
  expect(mediaState[0]).toEqual(managedOriginal);
  const failed = mediaState.find(image => image.isProcessingPlaceholder)!;
  expect(isTerminalProcessingFailure(failed.processing)).toBe(true);
  fireEvent.click(view.getByRole('button', { name: /^移除$/ })); await settle();
  expect(mediaState).toEqual([managedOriginal]);
  expect(requests.filter(item => item.url === '/api/generate')).toHaveLength(1);
  expect(placementDeletes).toEqual([]);
});

it('followup panorama running progress still completes the same frame with one submission', async () => {
  generationReply = async () => Response.json({ success: true, taskId: 'offline-running-task', usedModel: 'offline-used' });
  let polls = 0;
  pollReply = async () => Response.json(++polls === 1
    ? { status: 'running', progress: 40 }
    : { status: 'completed', imageUrl: '/offline/panorama-after-running.png' });
  const view = render(<MediaHarness />); await startPanorama(view);
  const placeholder = mediaState.find(image => image.isProcessingPlaceholder)!;
  await act(async () => { await vi.advanceTimersByTimeAsync(801); });
  const running = mediaState.find(image => image.id === placeholder.id)!;
  expect(running.isProcessingPlaceholder).toBe(true);
  expect(isTerminalProcessingFailure(running.processing)).toBe(false);
  expect(running.processing?.progress).toBeGreaterThan(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(801); });
  expect(mediaState.find(image => image.id === placeholder.id)).toMatchObject({
    url: '/offline/panorama-after-running.png', isProcessingPlaceholder: false,
  });
  expect(mediaState.find(image => image.id === placeholder.id)?.processing).toBeUndefined();
  expect(mediaState[0]).toEqual(managedOriginal);
  expect(polls).toBe(2);
  expect(requests.filter(item => item.url === '/api/generate')).toHaveLength(1);
});
