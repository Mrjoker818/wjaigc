import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ handler: undefined as ((event: unknown) => void) | undefined }));
vi.mock('@/lib/task-events-client', () => ({ taskEventsClient: {
  isConnected: (): boolean => true,
  onTaskEvent: (handler: (event: unknown) => void): (() => void) => {
    boundary.handler = handler; return (): void => { boundary.handler = undefined; };
  },
} }));
import { waitForAnnotationTaskResult } from '@/features/annotations/annotation-task-client';

const reference = { assetId: 'asset-result', assetVersionId: 'version-result', placementId: 'placement-result',
  entityId: 'entity-result', kind: 'image', url: '/api/serve-upload/canonical-result.png' };
function completed(projection?: unknown): Record<string, unknown> {
  return { taskId: 'annotation-task', status: 'completed', result: {
    imageUrl: '/api/serve-upload/raw-result.png', ...(projection ? { assetProjection: projection } : {}),
  } };
}
beforeEach((): void => { vi.useFakeTimers(); boundary.handler = undefined; });
afterEach((): void => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// Break caught: resolving an SSE completion before owned canonical publication
// invites InfiniteCanvas to append a second, unregistered local result.
it('document completion ignores even a completed SSE projection until owned polling confirms it', async () => {
  const fetchBoundary = vi.fn().mockResolvedValue(Response.json(completed({ status: 'completed', references: [reference] })));
  vi.stubGlobal('fetch', fetchBoundary);
  const options = { requireCanonicalPublication: true, pollIntervalMs: 100, timeoutMs: 1_000 };
  let resolved = false;
  const pending = waitForAnnotationTaskResult('annotation-task', options).then(result => { resolved = true; return result; });
  boundary.handler?.({ taskId: 'annotation-task', type: 'completed', task: completed({ status: 'completed', references: [reference] }) });
  await vi.advanceTimersByTimeAsync(0);
  expect(resolved).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toMatchObject({ imageUrl: '/api/serve-upload/canonical-result.png' });
});

it('document polling never reports 100 or returns raw output while canonical publication is pending', async () => {
  let polls = 0;
  vi.stubGlobal('fetch', async (): Promise<Response> => Response.json(polls++ === 0
    ? completed({ status: 'projection_pending' }) : completed({ status: 'completed', references: [reference] })));
  const progress = vi.fn();
  const options = { requireCanonicalPublication: true, pollIntervalMs: 100, timeoutMs: 1_000, onProgress: progress };
  let resolved = false;
  const pending = waitForAnnotationTaskResult('annotation-task', options).then(result => { resolved = true; return result; });
  await vi.advanceTimersByTimeAsync(100);
  expect(resolved).toBe(false);
  expect(progress.mock.calls.some(([value]) => value === 100)).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toMatchObject({ imageUrl: reference.url });
});

it.each([
  { status: 'completed', references: [] },
  { status: 'completed', references: [{ ...reference, assetVersionId: '' }] },
  { status: 'completed', references: [{ ...reference, kind: 'video' }] },
  { status: 'completed', references: [{ ...reference, url: 'data:image/png;base64,AAAA' }] },
])('document mode rejects incomplete canonical references rather than resolving raw output: %j', async projection => {
  let polls = 0;
  vi.stubGlobal('fetch', async (): Promise<Response> => Response.json(completed(polls++ === 0
    ? projection : { status: 'completed', references: [reference] })));
  const options = { requireCanonicalPublication: true, pollIntervalMs: 100, timeoutMs: 1_000 };
  let resolved = false;
  const pending = waitForAnnotationTaskResult('annotation-task', options).then(result => { resolved = true; return result; });
  await vi.advanceTimersByTimeAsync(100);
  expect(resolved).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toMatchObject({ imageUrl: reference.url });
});

it('an early document SSE completion cannot hide an owned-polling permission denial', async () => {
  vi.stubGlobal('fetch', async (): Promise<Response> => Response.json({ code: 'DOCUMENT_FORBIDDEN', error: 'No access' }, { status: 403 }));
  const options = { requireCanonicalPublication: true, pollIntervalMs: 100, timeoutMs: 1_000 };
  const outcome = waitForAnnotationTaskResult('annotation-task', options).then(result => ({ result }), error => ({ error }));
  boundary.handler?.({ taskId: 'annotation-task', type: 'completed', task: completed() });
  await vi.advanceTimersByTimeAsync(100);
  await expect(outcome).resolves.toMatchObject({ error: { code: 'DOCUMENT_FORBIDDEN' } });
});
