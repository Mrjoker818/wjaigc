import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CanvasDocumentMediaSync } from '@/lib/collaboration/document-media-sync';
import type { CanvasImage } from '@/lib/user-types';

const source: CanvasImage = { id: 'source', placementId: 'p1', assetVersionId: 'v1',
  url: '/api/serve-upload/source.png', x: 0, y: 0, width: 20, height: 20,
  originalWidth: 20, originalHeight: 20, rotation: 0, zIndex: 0, createdAt: 1 };
const result: CanvasImage = { ...source, id: 'result', placementId: 'p2', assetVersionId: 'v2',
  url: '/api/serve-upload/result.png', x: 40, zIndex: 1 };
function projection(images: CanvasImage[]): { placements: Record<string, { assetVersionId: string;
  x: number; y: number; width: number; height: number; rotation: number; zIndex: number }> } {
  return { placements: Object.fromEntries(images.map(image => [image.placementId!, {
    assetVersionId: image.assetVersionId!, x: image.x, y: image.y, width: image.width,
    height: image.height, rotation: image.rotation!, zIndex: image.zIndex!,
  }])) };
}
function directory(sequence: number, images: CanvasImage[]): Record<string, unknown> {
  return { success: true, projectId: 'project-a', sequence, readOnly: false,
    canvasImages: images, projection: projection(images) };
}
let sync: CanvasDocumentMediaSync;
beforeEach((): void => {
  vi.useFakeTimers(); sync = new CanvasDocumentMediaSync('project-a', () => undefined);
  sync.acceptDirectory(directory(1, [source])); sync.setDocument(projection([source]), 1);
});
afterEach((): void => { sync.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('joining an in-flight refresh waits for the newest accepted directory even when its HTTP reply is stale', async () => {
  let deliver!: (value: Response) => void;
  vi.stubGlobal('fetch', (): Promise<Response> => new Promise(resolve => { deliver = resolve; }));
  const original = sync.refresh({ projectId: 'project-a', documentSequence: 1 });
  sync.acceptDirectory(directory(3, [source, result]));
  let outcome: CanvasImage[] | undefined;
  const joined = sync.refresh({ projectId: 'project-a', documentSequence: 1, requireDirectorySequence: true })
    .then(images => { outcome = images; });
  deliver(Response.json(directory(2, [source])));
  await vi.advanceTimersByTimeAsync(0);
  expect(outcome).toBeUndefined();
  sync.setDocument(projection([source]), 2);
  await vi.advanceTimersByTimeAsync(0);
  expect(outcome).toBeUndefined();
  sync.setDocument(projection([source, result]), 3);
  await joined;
  expect(outcome?.map(image => image.id)).toEqual(['source', 'result']);
  expect((await original).map(image => image.id)).toEqual(['source', 'result']);
});

it('ordinary refresh still honors the caller minimum instead of silently waiting for a newer directory', async () => {
  vi.stubGlobal('fetch', async (): Promise<Response> => Response.json(directory(3, [source, result])));
  const images = await sync.refresh({ projectId: 'project-a', documentSequence: 1 });
  expect(images.map(image => image.id)).toEqual(['source']);
});

it('a stronger waiter joining an accepted refresh cannot finish on the intermediate websocket document', async () => {
  vi.stubGlobal('fetch', async (): Promise<Response> => Response.json(directory(2, [source])));
  let originalOutcome: CanvasImage[] | undefined;
  const original = sync.refresh({ projectId: 'project-a', documentSequence: 2 })
    .then(images => { originalOutcome = images; });
  await vi.advanceTimersByTimeAsync(0);
  expect(originalOutcome).toBeUndefined();

  sync.acceptDirectory(directory(3, [source, result]));
  let joinedOutcome: CanvasImage[] | undefined;
  const joined = sync.refresh({ projectId: 'project-a', documentSequence: 2, requireDirectorySequence: true })
    .then(images => { joinedOutcome = images; });
  sync.setDocument(projection([source]), 2);
  await vi.advanceTimersByTimeAsync(0);
  expect(originalOutcome).toBeUndefined();
  expect(joinedOutcome).toBeUndefined();

  sync.setDocument(projection([source, result]), 3);
  await Promise.all([original, joined]);
  expect(originalOutcome?.map(image => image.id)).toEqual(['source', 'result']);
  expect(joinedOutcome?.map(image => image.id)).toEqual(['source', 'result']);
});

it('canonical waiting is bounded when the matching websocket document never arrives', async () => {
  vi.stubGlobal('fetch', async (): Promise<Response> => Response.json(directory(3, [source, result])));
  const outcome = sync.refresh({ projectId: 'project-a', documentSequence: 1, requireDirectorySequence: true })
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await outcome).toMatchObject({ code: 'DOCUMENT_MEDIA_SYNC_TIMEOUT' });
});
