import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const events = vi.hoisted(() => ({ listener: undefined as ((event: unknown) => void) | undefined }));
vi.mock('@/lib/task-events-client', () => ({ taskEventsClient: {
  isConnected: (): boolean => false,
  onTaskEvent: (listener: (event: unknown) => void): (() => void) => {
    events.listener = listener; return (): void => { events.listener = undefined; };
  },
} }));
import { waitForAnnotationTaskResult } from '@/features/annotations/annotation-task-client';
beforeEach((): void => { vi.useFakeTimers(); });
afterEach((): void => { vi.useRealTimers(); vi.unstubAllGlobals(); });
// Break caught: subscribing after an already-aborted signal never delivers its
// abort event; an old run can poll forever and reach completion after teardown.
it('an already-aborted wait rejects before any HTTP or progress', async () => {
  const controller = new AbortController(); controller.abort();
  let requests = 0;
  vi.stubGlobal('fetch', async (): Promise<Response> => { requests++; return Response.json({ status: 'processing' }); });
  const progress: number[] = [];
  const outcome = waitForAnnotationTaskResult('old-task', { signal: controller.signal, timeoutMs: 20,
    onProgress: value => { progress.push(value); } }).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(20);
  expect(await outcome).toMatchObject({ code: 'ANNOTATION_TASK_CANCELLED' });
  expect(requests).toBe(0); expect(progress).toEqual([]);
});

it('a transport ignoring abort cannot deliver late 100-percent progress or reschedule', async () => {
  const controller = new AbortController();
  let release!: (response: Response) => void;
  let requests = 0;
  const response = new Promise<Response>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', (): Promise<Response> => { requests++; return response; });
  const progress: number[] = [];
  const outcome = waitForAnnotationTaskResult('old-task', { signal: controller.signal,
    onProgress: value => { progress.push(value); } }).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1); expect(requests).toBe(1);
  controller.abort();
  expect(await outcome).toMatchObject({ code: 'ANNOTATION_TASK_CANCELLED' });
  release(Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/result.png' } }));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(progress).toEqual([]); expect(requests).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});
