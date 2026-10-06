// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';

// Only external event/HTTP and notification boundaries are replaced. The real
// canvas, controller, composer, submission client and task waiter execute.
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: { ...notifications, warning: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/task-events-client', () => ({ taskEventsClient: {
  connect: (): void => undefined,
  disconnect: (): void => undefined,
  isConnected: (): boolean => false,
  onTaskEvent: (): (() => void) => (): void => undefined,
} }));

const source: CanvasImage = { id: 'source', url: '/api/serve-upload/source.png', prompt: 'source',
  x: 100, y: 100, width: 200, height: 200, createdAt: 1, annotationVersionId: 'version-original',
  assetId: 'asset-source', assetVersionId: 'version-original', placementId: 'placement-source' };
const annotation: CanvasAnnotationV2 = { id: 'annotation-original', projectId: 'project-a',
  sourceImageId: 'source', sourceVersionId: 'version-original', type: 'text',
  geometry: { kind: 'text', point: { x: 0.5, y: 0.5 } }, instruction: 'make it blue',
  status: 'ready', createdAt: 1, updatedAt: 1 };
const reference = { assetId: 'asset-result', assetVersionId: 'version-result',
  placementId: 'placement-result', entityId: 'entity-result', kind: 'image',
  url: '/api/serve-upload/canonical-result.png' };
function completed(): Response {
  return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/raw-result.png' },
    assetProjection: { status: 'completed', references: [reference] } });
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
interface Context {
  identity: unknown;
  writable: boolean;
  canWaitForPublication?: boolean;
  confirmPublication: (payload: unknown, signal: AbortSignal) => Promise<boolean>;
}
interface HarnessProps {
  projectId?: string;
  images?: CanvasImage[];
  annotations?: CanvasAnnotationV2[];
  document?: boolean;
  context?: Context;
  onImagesChange: (images: CanvasImage[]) => boolean | void;
  poll?: (payload: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<Response>;
  onAnnotationsChange?: (annotations: CanvasAnnotationV2[]) => boolean;
}
function Harness({ projectId = 'project-a', images = [source], annotations = [annotation], document = false,
  context, onImagesChange, poll = async (): Promise<Response> => completed(),
  onAnnotationsChange = (): boolean => true }: HarnessProps): React.JSX.Element {
  const executionProps = { annotationExecutionContext: context };
  return <InfiniteCanvas {...executionProps} images={images} onImagesChange={onImagesChange}
    selectedImage={images[0]} onSelectImage={() => undefined} onPreviewImage={() => undefined}
    onGenerateVariation={() => undefined} onExtractKeywords={() => undefined} onFusion={() => undefined}
    onAddImages={() => undefined} projectId={projectId} initialAnnotations={annotations}
    documentMetadataMode={document} uploadAuthority={document ? 'document' : 'legacy'}
    onAnnotationsChange={onAnnotationsChange} onRequestTaskPoll={poll}
    initialViewState={{ offsetX: 0, offsetY: 0, zoom: 1 }} />;
}
async function settle(ms = 1): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function start(view: ReturnType<typeof render>): Promise<void> {
  await settle();
  fireEvent.keyDown(window, { key: 'c', code: 'KeyC' }); await settle();
  fireEvent.click(view.getByTestId('annotation-execute')); await settle(); await settle();
}
beforeEach((): void => {
  vi.useFakeTimers(); notifications.success.mockReset(); notifications.error.mockReset();
  const storage = new Map<string, string>([['wujie_selected_model', JSON.stringify({ model: 'offline::edit', providerId: 'offline' })]]);
  vi.stubGlobal('localStorage', { getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => { storage.set(key, value); },
    removeItem: (key: string): void => { storage.delete(key); } });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => url === '/api/annotations/execute'
    ? Response.json({ success: true, taskId: 'annotation-task' }) : completed());
});
afterEach((): void => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Break caught: the actual completion callback appends a second synthetic media
// entity even though the task already published its canonical document image.
it('document completion confirms the canonical image without synthetic append', async () => {
  const changes: CanvasImage[][] = [];
  let confirmed = false;
  const context: Context = { identity: 'editor-session-a', writable: true,
    confirmPublication: async (payload): Promise<boolean> => {
      confirmed = (payload as { assetProjection: { references: typeof reference[] } })
        .assetProjection.references[0].entityId === 'entity-result';
      return confirmed;
    } };
  const view = render(<Harness document context={context} onImagesChange={next => { changes.push(next); }} />);
  await start(view);
  expect(confirmed).toBe(true);
  expect(changes).toEqual([]);
  expect(notifications.success).toHaveBeenCalledTimes(1);
});

it('a workspace rejection of a private result cannot report success', async () => {
  const view = render(<Harness onImagesChange={() => false} />);
  await start(view);
  expect(notifications.success).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toMatch(/未|失败|拒绝/);
});

it('switching projects while submission is pending cannot append to the new project', async () => {
  const submit = deferred<Response>();
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => url === '/api/annotations/execute' ? submit.promise : completed());
  const changes: CanvasImage[][] = [];
  const onChange = (next: CanvasImage[]): void => { changes.push(next); };
  const view = render(<Harness document context={{ identity: 'a', writable: true, confirmPublication: async () => true }} onImagesChange={onChange} />);
  await start(view);
  view.rerender(<Harness document projectId="project-b" annotations={[{ ...annotation, id: 'annotation-b', projectId: 'project-b' }]}
    context={{ identity: 'b', writable: true, confirmPublication: async () => true }} onImagesChange={onChange} />);
  await settle(); submit.resolve(Response.json({ success: true, taskId: 'old-task' })); await settle(); await settle();
  expect(changes).toEqual([]);
  expect(notifications.success).not.toHaveBeenCalled();
});

it.each(['version', 'url', 'placement', 'removed'] as const)('a %s change during polling isolates the late private result', async change => {
  const poll = deferred<Response>();
  let started = false;
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    if (url === '/api/annotations/execute') return Response.json({ success: true, taskId: 'annotation-task' });
    if (url === '/api/poll-task') { started = true; return poll.promise; }
    return Response.json({});
  });
  const changes: CanvasImage[][] = [];
  const onChange = (next: CanvasImage[]): void => { changes.push(next); };
  const requestPoll = (payload: Record<string, unknown>): Promise<Response> => {
    expect(payload).toEqual({ taskId: 'annotation-task' }); started = true; return poll.promise;
  };
  const view = render(<Harness onImagesChange={onChange} poll={requestPoll} />);
  await start(view);
  expect(started).toBe(true);
  const nextImages = change === 'removed' ? [] : [{ ...source,
    ...(change === 'version' ? { annotationVersionId: 'version-new', assetVersionId: 'version-new' } : {}),
    ...(change === 'url' ? { url: '/api/serve-upload/replaced.png' } : {}),
    ...(change === 'placement' ? { placementId: 'placement-new' } : {}) }];
  view.rerender(<Harness images={nextImages} onImagesChange={onChange} poll={requestPoll} />);
  await settle(); poll.resolve(completed()); await settle();
  expect(changes).toEqual([]);
  expect(notifications.success).not.toHaveBeenCalled();
});

it('revoking document writability during polling isolates completion', async () => {
  const poll = deferred<Response>();
  let started = false;
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    if (url === '/api/annotations/execute') return Response.json({ success: true, taskId: 'annotation-task' });
    if (url === '/api/poll-task') { started = true; return poll.promise; }
    return Response.json({});
  });
  let confirmations = 0;
  const confirmPublication = async (): Promise<boolean> => { confirmations++; return true; };
  const changes: CanvasImage[][] = [];
  const onChange = (next: CanvasImage[]): void => { changes.push(next); };
  const requestPoll = (payload: Record<string, unknown>): Promise<Response> => {
    expect(payload).toEqual({ taskId: 'annotation-task' }); started = true; return poll.promise;
  };
  const view = render(<Harness document context={{ identity: 'a', writable: true, confirmPublication }} onImagesChange={onChange} poll={requestPoll} />);
  await start(view);
  expect(started).toBe(true);
  view.rerender(<Harness document context={{ identity: 'a', writable: false, confirmPublication }} onImagesChange={onChange} poll={requestPoll} />);
  await settle(); poll.resolve(completed()); await settle();
  expect(confirmations).toBe(0); expect(changes).toEqual([]);
  expect(notifications.success).not.toHaveBeenCalled();
});

it('a late cancellation response cannot reset annotations of a newer run', async () => {
  const cancellation = deferred<Response>();
  let submission = 0;
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    if (url === '/api/annotations/execute') return Response.json({ success: true, taskId: `task-${++submission}` });
    if (url === '/api/cancel-task') return cancellation.promise;
    return Response.json({});
  });
  let latest: CanvasAnnotationV2[] = [];
  const view = render(<Harness onImagesChange={() => undefined}
    onAnnotationsChange={next => { latest = next; return true; }}
    poll={async () => Response.json({ status: 'processing', progress: 20 })} />);
  await start(view); expect(submission).toBe(1);
  fireEvent.click(view.getByRole('button', { name: '取消' })); await settle();
  fireEvent.click(view.getByTestId('annotation-execute')); await settle();
  expect(submission).toBe(2); expect(latest[0].status).toBe('running');
  cancellation.resolve(Response.json({ success: true })); await settle();
  expect(latest[0].status).toBe('running');
  expect(view.getByRole('button', { name: '取消' })).toBeTruthy();
});

it('the unchanged private project still accepts exactly one result', async () => {
  const changes: CanvasImage[][] = [];
  const view = render(<Harness onImagesChange={next => { changes.push(next); return true; }} />);
  await start(view);
  expect(changes).toHaveLength(1); expect(changes[0]).toHaveLength(2);
  expect(changes[0][0]).toEqual(source);
  expect(changes[0][1]).toMatchObject({ url: '/api/serve-upload/raw-result.png', generatedFromImageId: 'source' });
  expect(notifications.success).toHaveBeenCalledTimes(1);
});

it('document publication pending stays below 100 and keeps waiting rather than appending raw output', async () => {
  const changes: CanvasImage[][] = [];
  let polls = 0;
  const view = render(<Harness document context={{ identity: 'a', writable: true, confirmPublication: async () => true }}
    onImagesChange={next => { changes.push(next); }} poll={async () => {
      polls++; return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/raw-result.png' },
        assetProjection: { status: 'projection_pending' } });
    }} />);
  await start(view); expect(polls).toBe(1);
  expect(changes).toEqual([]); expect(notifications.success).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: '取消' })).toBeTruthy();
  expect(view.getByText('等待协作结果发布')).toBeTruthy();
});

it('canonical refresh failure cannot mark submitted annotations done', async () => {
  let latest: CanvasAnnotationV2[] = [];
  const view = render(<Harness document context={{ identity: 'a', writable: true, confirmPublication: async () => false }}
    onImagesChange={() => undefined} onAnnotationsChange={next => { latest = next; return true; }} />);
  await start(view);
  expect(notifications.success).not.toHaveBeenCalled();
  expect(latest[0].status).not.toBe('done');
  expect(view.getByRole('alert').textContent).toContain('同步尚未确认');
});

it('a source mismatch is explicit and never automatically rebinds or submits old annotations', async () => {
  let submissions = 0;
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    if (url === '/api/annotations/execute') submissions++;
    return Response.json({});
  });
  const view = render(<Harness images={[{ ...source, annotationVersionId: 'version-new' }]} onImagesChange={() => undefined} />);
  await start(view);
  expect(submissions).toBe(0);
  expect(view.getByRole('alert').textContent).toContain('重新确认批注');
});

it('permission denial from owned polling cannot be reported as document success', async () => {
  let confirmations = 0;
  const view = render(<Harness document context={{ identity: 'a', writable: true,
    confirmPublication: async () => { confirmations++; return true; } }} onImagesChange={() => undefined}
    poll={async () => Response.json({ code: 'DOCUMENT_FORBIDDEN', message: '编辑权限已失效' }, { status: 403 })} />);
  await start(view);
  expect(confirmations).toBe(0); expect(notifications.success).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toContain('编辑权限已失效');
});

it('a late old submit finally cannot clear the newer project execution', async () => {
  const oldSubmit = deferred<Response>();
  let submissions = 0;
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    if (url === '/api/annotations/execute') {
      submissions++; return submissions === 1 ? oldSubmit.promise : Response.json({ success: true, taskId: 'new-task' });
    }
    return Response.json({});
  });
  const onChange = (): void => undefined;
  const view = render(<Harness document context={{ identity: 'a', writable: true, confirmPublication: async () => true }} onImagesChange={onChange} />);
  await start(view);
  view.rerender(<Harness document projectId="project-b" annotations={[{ ...annotation, id: 'annotation-b', projectId: 'project-b' }]}
    context={{ identity: 'b', writable: true, confirmPublication: async () => true }} onImagesChange={onChange}
    poll={async () => Response.json({ status: 'processing', progress: 30 })} />);
  await start(view);
  expect(submissions).toBe(2);
  oldSubmit.resolve(Response.json({ success: true, taskId: 'old-task' })); await settle();
  expect(view.getByRole('button', { name: '取消' })).toBeTruthy();
  expect(notifications.success).not.toHaveBeenCalled();
});

it('unmounting while submitting never confirms or appends the late result', async () => {
  const submit = deferred<Response>();
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => url === '/api/annotations/execute' ? submit.promise : Response.json({}));
  const changes: CanvasImage[][] = [];
  const view = render(<Harness onImagesChange={next => { changes.push(next); }} />);
  await start(view); view.unmount();
  submit.resolve(Response.json({ success: true, taskId: 'old-task' })); await settle();
  expect(changes).toEqual([]); expect(notifications.success).not.toHaveBeenCalled();
});

it('canonical document confirmation pending does not display completion at 100 percent', async () => {
  const confirmation = deferred<boolean>();
  const view = render(<Harness document context={{ identity: 'a', writable: true,
    confirmPublication: () => confirmation.promise }} onImagesChange={() => undefined} />);
  await start(view);
  expect(Number(view.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100);
  expect(view.getByText('等待协作媒体同步')).toBeTruthy();
  expect(notifications.success).not.toHaveBeenCalled();
  confirmation.resolve(true); await settle();
  expect(notifications.success).toHaveBeenCalledTimes(1);
});

it('a live document session can finish waiting through transient media unavailability without admitting a new edit', async () => {
  const confirmation = deferred<boolean>();
  const context: Context = { identity: 'a', writable: true, canWaitForPublication: true,
    confirmPublication: () => confirmation.promise };
  const view = render(<Harness document context={context} onImagesChange={() => undefined} />);
  await start(view);
  view.rerender(<Harness document context={{ ...context, writable: false }} onImagesChange={() => undefined} />);
  await settle();
  expect(view.getByRole('button', { name: '取消' })).toBeTruthy();
  confirmation.resolve(true); await settle();
  expect(notifications.success).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByTestId('annotation-execute')); await settle();
  expect(view.getByRole('alert').textContent).toMatch(/不可编辑|权限/);
});

it('a writable private workspace with no publication waiting capability still accepts one result', async () => {
  const changes: CanvasImage[][] = [];
  const view = render(<Harness context={{ identity: 'private-a', writable: true, canWaitForPublication: false,
    confirmPublication: async () => false }} onImagesChange={next => { changes.push(next); return true; }} />);
  await start(view);
  expect(changes).toHaveLength(1);
  expect(notifications.success).toHaveBeenCalledTimes(1);
});
