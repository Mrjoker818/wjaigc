import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasImage } from '@/lib/user-types';
import type { CanvasDocumentProjection, CanvasPlacement } from '@/lib/collaboration/canvas-document';
import { CanvasDocumentMediaSync, parseDocumentMediaDirectory } from '@/lib/collaboration/document-media-sync';

function placement(version = 'version-p1'): CanvasPlacement {
  return { assetVersionId: version, x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0 };
}
function media(id = 'p1', version = `version-${id}`): CanvasImage {
  return { id: `image-${id}`, placementId: id, assetVersionId: version,
    url: `/api/serve-upload/${version}.png`, x: 10, y: 20, width: 80, height: 60,
    originalWidth: 80, originalHeight: 60, rotation: 0, zIndex: 0, createdAt: 1 };
}
function directory(sequence = 1, images: CanvasImage[] = [media()]): Record<string, unknown> {
  return { success: true, projectId: 'project-a', sequence, readOnly: false,
    canvasImages: images, projection: { placements: Object.fromEntries(images.map(image => [
      image.placementId!, placement(image.assetVersionId),
    ])) } };
}
function response(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const live: CanvasDocumentMediaSync[] = [];
function create(): CanvasDocumentMediaSync {
  const sync = new CanvasDocumentMediaSync('project-a', () => {});
  live.push(sync);
  sync.acceptDirectory(directory());
  sync.setDocument({ placements: { p1: placement() } }, 1);
  return sync;
}

describe('document media sequence coordination', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { live.splice(0).forEach(sync => sync.stop()); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('accepts a ready video without a thumbnail and preserves its playback identity', () => {
    const video: CanvasImage = { ...media('video'), url: '', mediaType: 'video',
      videoUrl: '/api/serve-upload/tiny-valid.mp4', mediaAvailability: 'ready' };
    const parsed = parseDocumentMediaDirectory(directory(4, [video]), 'project-a');
    expect(parsed.sequence).toBe(4);
    expect(parsed.canvasImages).toMatchObject([{ id: 'image-video', placementId: 'video',
      assetVersionId: 'version-video', url: '', mediaType: 'video',
      videoUrl: '/api/serve-upload/tiny-valid.mp4' }]);
    video.videoUrl = '/caller-mutated.mp4';
    expect(parsed.canvasImages[0].videoUrl).toBe('/api/serve-upload/tiny-valid.mp4');
  });

  it('refreshes a mixed image/video directory against the live WS projection', async () => {
    const sync = create();
    const video: CanvasImage = { ...media('video'), url: '', mediaType: 'video',
      videoUrl: '/api/serve-upload/tiny-valid.mp4', mediaAvailability: 'ready' };
    sync.setDocument({ placements: { p1: { ...placement(), x: 91 }, video: placement('version-video') } }, 4);
    vi.mocked(fetch).mockResolvedValue(response(directory(4, [media(), video])));
    const result = sync.refresh({ projectId: 'project-a', documentSequence: 4 });
    // Attach a rejection handler before advancing fake time so the RED has no unhandled rejection.
    const outcome = result.then(images => ({ images }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await outcome).toMatchObject({ images: [
      { placementId: 'p1', assetVersionId: 'version-p1', x: 91, url: '/api/serve-upload/version-p1.png' },
      { placementId: 'video', assetVersionId: 'version-video', url: '', mediaType: 'video',
        videoUrl: '/api/serve-upload/tiny-valid.mp4' },
    ] });
    expect(sync.view.complete).toBe(true);
    expect(sync.lastError).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, null, '', '   ', 42])('rejects video playback URL %s even with a valid thumbnail', videoUrl => {
    const sync = create();
    const payload = directory(2, [{ ...media(), mediaType: 'video' }]);
    (payload.canvasImages as Record<string, unknown>[])[0].videoUrl = videoUrl;
    expect(() => sync.acceptDirectory(payload)).toThrow(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_UNAVAILABLE' }));
    expect(sync.view.images).toMatchObject([{ placementId: 'p1', url: '/api/serve-upload/version-p1.png' }]);
  });

  it.each([undefined, 'image', 'audio'])('does not let videoUrl bypass the image URL or media-kind guard for %s', mediaType => {
    const sync = create();
    const payload = directory(2);
    const image = (payload.canvasImages as Record<string, unknown>[])[0];
    image.url = ''; image.mediaType = mediaType; image.videoUrl = '/api/serve-upload/tiny-valid.mp4';
    expect(() => sync.acceptDirectory(payload)).toThrow(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_UNAVAILABLE' }));
    expect(sync.view.images).toMatchObject([{ placementId: 'p1', url: '/api/serve-upload/version-p1.png' }]);
  });

  it('coalesces callers to the highest target and waits for WS even after a future HTTP directory', async () => {
    const sync = create();
    const request = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(request.promise);
    const first = sync.refresh({ projectId: 'project-a', documentSequence: 2 });
    const second = sync.refresh({ projectId: 'project-a', documentSequence: 4 });
    expect(second).toBe(first);
    const done = vi.fn(); void first.then(done);
    request.resolve(response(directory(5, [media(), media('p2')])));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).not.toHaveBeenCalled();
    expect(sync.view.images.map(image => image.placementId)).toEqual(['p1']);
    sync.setDocument({ placements: { p1: placement(), p2: placement('version-p2') } }, 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).not.toHaveBeenCalled();
    sync.setDocument({ placements: { p1: { ...placement(), x: 91 }, p2: placement('version-p2') } }, 4);
    expect(await first).toMatchObject([{ placementId: 'p1', x: 91 }, { placementId: 'p2' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries WS-leading HTTP at 500ms then 1000ms and never renders an old version', async () => {
    const sync = create();
    sync.setDocument({ placements: { p1: placement('version-new') } }, 4);
    expect(sync.view.images).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(response(directory(1)))
      .mockResolvedValueOnce(response(directory(3)))
      .mockResolvedValueOnce(response(directory(4, [media('p1', 'version-new')])));
    const result = sync.refresh({ projectId: 'project-a', documentSequence: 4 });
    await vi.advanceTimersByTimeAsync(499);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(sync.view.images).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject([{ assetVersionId: 'version-new' }]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores older directories and resolves a target subsequently tombstoned without resurrection', async () => {
    const sync = create();
    sync.acceptDirectory(directory(5, [media('p1', 'version-new')]));
    sync.acceptDirectory(directory(2));
    sync.setDocument({ placements: { p1: placement('version-new') } }, 5);
    expect(sync.view.images).toMatchObject([{ assetVersionId: 'version-new' }]);
    const request = deferred<Response>(); vi.mocked(fetch).mockReturnValue(request.promise);
    const result = sync.refresh({ projectId: 'project-a', documentSequence: 6 });
    sync.setDocument({ placements: { p1: { ...placement('version-new'), deleted: true } } }, 7);
    const payload = directory(7, []);
    payload.projection = { placements: { p1: { ...placement('version-new'), deleted: true } } };
    request.resolve(response(payload));
    expect(await result).toEqual([]);
    expect(sync.view.complete).toBe(true);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid target %s before network', async sequence => {
    const sync = create();
    await expect(sync.refresh({ projectId: 'project-a', documentSequence: sequence }))
      .rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SYNC_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a different project without issuing HTTP', async () => {
    const sync = create();
    await expect(sync.refresh({ projectId: 'other', documentSequence: 2 }))
      .rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SYNC_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['fetch', 'json'])('bounds an abort-ignoring %s to 10 seconds and ignores late success', async phase => {
    const sync = create();
    const late = deferred<unknown>();
    vi.mocked(fetch).mockImplementation(() => phase === 'fetch'
      ? late.promise as Promise<Response>
      : Promise.resolve({ ...response(null), json: () => late.promise } as Response));
    const settled = vi.fn();
    const pending = sync.refresh({ projectId: 'project-a', documentSequence: 2 }).catch(error => { settled(error); });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_TIMEOUT' }));
    await pending;
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    late.resolve(phase === 'fetch' ? response(directory(2, [media('p2')])) : directory(2, [media('p2')]));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync.view.images.map(image => image.placementId)).toEqual(['p1']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not extend the 30-second batch deadline for raised targets while waiting on WS', async () => {
    const sync = create();
    vi.mocked(fetch).mockResolvedValue(response(directory(100)));
    const settled = vi.fn();
    const first = sync.refresh({ projectId: 'project-a', documentSequence: 2 });
    void first.catch(settled);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(sync.refresh({ projectId: 'project-a', documentSequence: 99 })).toBe(first);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_TIMEOUT' }));
    expect(vi.getTimerCount()).toBe(0);
    sync.setDocument({ placements: { p1: placement() } }, 100);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('applies the 30-second deadline during the third GET and releases its abort listener', async () => {
    const sync = create();
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve(response({}, 503)), 9_900);
    }));
    const result = sync.refresh({ projectId: 'project-a', documentSequence: 2 });
    const failed = vi.fn(); void result.catch(failed);
    await vi.advanceTimersByTimeAsync(21_300);
    expect(fetch).toHaveBeenCalledTimes(3);
    const signal = vi.mocked(fetch).mock.calls[2][1]?.signal;
    await vi.advanceTimersByTimeAsync(8_699);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_TIMEOUT' }));
    expect(signal?.aborted).toBe(true);
    // Only the deliberately noncooperative fake's own timer remains.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('counts fetch and JSON against one shared 10-second GET budget', async () => {
    const sync = create(); const body = deferred<unknown>(); const headers = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(headers.promise);
    const failed = vi.fn();
    void sync.refresh({ projectId: 'project-a', documentSequence: 2 }).catch(failed);
    await vi.advanceTimersByTimeAsync(9_000);
    headers.resolve({ ...response(null), json: () => body.promise } as Response);
    await vi.advanceTimersByTimeAsync(999);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_TIMEOUT' }));
    body.reject(new Error('late private body'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('merges 200 callers and remote bursts into one GET and returns an independent authorized copy', async () => {
    const sync = create(); const request = deferred<Response>();
    let concurrent = 0; let maximum = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      concurrent += 1; maximum = Math.max(maximum, concurrent);
      try { return await request.promise; } finally { concurrent -= 1; }
    });
    const promises = Array.from({ length: 200 }, (_, index) => {
      sync.setDocument({ placements: { p1: placement(), p2: placement('version-p2') } }, index + 2);
      sync.autoRefresh();
      return sync.refresh({ projectId: 'project-a', documentSequence: index + 2 });
    });
    expect(new Set(promises).size).toBe(1);
    request.resolve(response(directory(201, [media(), media('p2')])));
    const results = await Promise.all(promises);
    expect(results.every(images => images === results[0])).toBe(true);
    expect(results[0]).toHaveLength(2);
    results[0][0].url = '/caller-mutated';
    expect(sync.view.images[0].url).toBe('/api/serve-upload/version-p1.png');
    expect(maximum).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves live metadata against current exact versions while tombstoned references stay hidden', async () => {
    const sync = create();
    const projection: CanvasDocumentProjection = { placements: { p1: placement(), p2: placement('version-p2') },
      groupDefinitions: { g: { id: 'g', name: 'G', note: '', imageIds: ['p1', 'p2'] },
        dead: { id: 'dead', name: 'D', note: '', imageIds: ['absent'] } },
      groupTombstones: { dead: true },
      annotationRecords: { a: { id: 'a', projectId: 'project-a', sourceImageId: 'p2', sourceVersionId: 'version-p2',
        type: 'region', geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } },
        status: 'ready', createdAt: 1, updatedAt: 1 } } };
    sync.setDocument(projection, 2);
    expect(sync.view.complete).toBe(false);
    expect(sync.view.groups).toEqual([]);
    vi.mocked(fetch).mockResolvedValue(response(directory(3, [media(), media('p2')])));
    expect(await sync.refresh({ projectId: 'project-a', documentSequence: 2 })).toHaveLength(2);
    expect(sync.view.groups).toMatchObject([{ id: 'g', imageIds: ['image-p1', 'image-p2'] }]);
    expect(sync.view.annotations).toMatchObject([{ sourceImageId: 'image-p2', sourceVersionId: 'version-p2' }]);
    projection.placements.p2 = placement('version-next');
    projection.annotationRecords!.a.status = 'stale';
    sync.acceptDirectory(directory(4, [media(), { ...media('p2', 'version-next'), id: 'image-next' }]));
    sync.setDocument(projection, 4);
    expect(sync.view.groups[0].imageIds).toEqual(['image-p1', 'image-next']);
    expect(sync.view.annotations[0]).toMatchObject({ sourceImageId: 'image-next', sourceVersionId: 'version-p2', status: 'stale' });
    projection.placements.p2.deleted = true;
    projection.groupDefinitions!.g.imageIds = ['p1']; projection.annotationTombstones = { a: true };
    sync.setDocument(projection, 5);
    expect(sync.view.images.map(image => image.placementId)).toEqual(['p1']);
    expect(sync.view.annotations).toEqual([]);
    expect(sync.view.complete).toBe(true);
  });

  it.each(['fetch', 'json', 'retry', 'ws'])('stop releases waiters, timers and late rejection during %s', async phase => {
    const sync = create();
    const late = deferred<unknown>();
    vi.mocked(fetch).mockImplementation(() => phase === 'fetch' ? late.promise as Promise<Response>
      : Promise.resolve(phase === 'json' ? { ...response(null), json: () => late.promise } as Response
        : phase === 'retry' ? response({}, 503) : response(directory(2))));
    const settled = vi.fn();
    const pending = sync.refresh({ projectId: 'project-a', documentSequence: 2 }).catch(settled);
    await vi.advanceTimersByTimeAsync(0);
    sync.stop();
    await pending;
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_CANCELLED' }));
    if (phase === 'fetch' || phase === 'json') {
      expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
      late.reject(new Error('private URL must not leak'));
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 'DOCUMENT_DISABLED', 'DOCUMENT_PROJECT_NOT_ENABLED', 'read-only'])(
    'terminates immediately on access loss %s without reading non-JSON permission bodies', async denial => {
      const lost = vi.fn();
      const sync = new CanvasDocumentMediaSync('project-a', () => {}, lost); live.push(sync);
      sync.acceptDirectory(directory()); sync.setDocument({ placements: { p1: placement() } }, 1);
      const reply = typeof denial === 'number' ? response(null, denial)
        : denial === 'read-only' ? response({ ...directory(2), readOnly: true })
          : response({ code: denial }, 503);
      const json = vi.spyOn(reply, 'json');
      if (typeof denial === 'number') json.mockRejectedValue(new Error('private body'));
      vi.mocked(fetch).mockResolvedValue(reply);
      const done = vi.fn();
      void sync.refresh({ projectId: 'project-a', documentSequence: 2 }).catch(done);
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_UNAVAILABLE' }));
      expect(lost).toHaveBeenCalledTimes(1);
      if (typeof denial === 'number') expect(json).not.toHaveBeenCalled();
      await expect(sync.refresh({ projectId: 'project-a', documentSequence: 2 })).rejects.toBeInstanceOf(Error);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

  it('fails after exactly three HTTP attempts and suppresses automatic restart until explicit refresh', async () => {
    const sync = create();
    sync.setDocument({ placements: { p1: placement(), p2: placement('version-p2') } }, 2);
    vi.mocked(fetch).mockResolvedValue(response({}, 503));
    sync.autoRefresh();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sync.lastError).toMatchObject({ code: 'DOCUMENT_MEDIA_SYNC_UNAVAILABLE' });
    for (let i = 3; i < 100; i += 1) {
      sync.setDocument({ placements: { p1: placement(), p2: placement('version-p2') } }, i);
      sync.autoRefresh();
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.mocked(fetch).mockResolvedValue(response(directory(99, [media(), media('p2')])));
    expect(await sync.refresh({ projectId: 'project-a', documentSequence: 99 })).toHaveLength(2);
    expect(sync.lastError).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not turn a temporary failed refresh into success using an already complete cached directory', async () => {
    const sync = create(); vi.mocked(fetch).mockResolvedValue(response({}, 503));
    const done = vi.fn(); const failed = vi.fn();
    void sync.refresh({ projectId: 'project-a', documentSequence: 1 }).then(done, failed);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(done).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_UNAVAILABLE' }));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('raising a target while waiting on WS schedules another GET without needing a WS event', async () => {
    const sync = create();
    vi.mocked(fetch).mockResolvedValueOnce(response(directory(2))).mockResolvedValue(response(directory(5)));
    const first = sync.refresh({ projectId: 'project-a', documentSequence: 2 });
    void first.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.refresh({ projectId: 'project-a', documentSequence: 5 })).toBe(first);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(2);
    sync.setDocument({ placements: { p1: placement() } }, 5);
    expect(await first).toHaveLength(1);
  });

  it('does not accumulate rejection handlers on the shared batch during automatic bursts', async () => {
    const sync = create(); const request = deferred<Response>();
    sync.setDocument({ placements: { p1: placement(), p2: placement('version-p2') } }, 2);
    vi.mocked(fetch).mockReturnValue(request.promise);
    const pending = sync.refresh({ projectId: 'project-a', documentSequence: 2 });
    const subscriptions = vi.spyOn(pending, 'catch');
    for (let sequence = 3; sequence <= 100; sequence += 1) {
      sync.setDocument({ placements: { p1: placement(), p2: placement('version-p2') } }, sequence);
      sync.autoRefresh();
    }
    const count = subscriptions.mock.calls.length;
    subscriptions.mockRestore();
    request.resolve(response(directory(100, [media(), media('p2')])));
    expect(await pending).toHaveLength(2);
    expect(count).toBe(0);
  });

  it('does not overlap a new batch with a timed-out transport that ignores abort', async () => {
    const sync = create(); const late = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(late.promise).mockResolvedValue(response(directory(2)));
    const first = sync.refresh({ projectId: 'project-a', documentSequence: 2 });
    void first.catch(() => {});
    await vi.advanceTimersByTimeAsync(10_000);
    const rejected = vi.fn(); const succeeded = vi.fn();
    void sync.refresh({ projectId: 'project-a', documentSequence: 2 }).then(succeeded, rejected);
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_UNAVAILABLE' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    late.resolve(response(directory(999, [media('p2')])));
    await vi.advanceTimersByTimeAsync(0);
    sync.setDocument({ placements: { p1: placement() } }, 2);
    expect(await sync.refresh({ projectId: 'project-a', documentSequence: 2 })).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never renders colliding image IDs across current and future catalogs', () => {
    const sync = create();
    sync.acceptDirectory(directory(3, [media('p1', 'version-future'), { ...media('p2'), id: 'image-p1-old' }]));
    // The HTTP catalog is internally unique, but reuses the old current image ID.
    const next = directory(4, [{ ...media('p1', 'version-future'), id: 'image-future' },
      { ...media('p2'), id: 'image-p1' }]);
    sync.acceptDirectory(next);
    sync.setDocument({ placements: { p1: placement(), p2: placement('version-p2') } }, 2);
    expect(new Set(sync.view.images.map(image => image.id)).size).toBe(sync.view.images.length);
    expect(sync.view.complete).toBe(false);
  });

  it('retains all 2000 current versions plus 2000 future versions, then prunes superseded catalogs', () => {
    const sync = create();
    const old = Array.from({ length: 2000 }, (_, i) => media(`p${i}`, `version-old-${i}`));
    const future = old.map((image, i) => ({ ...image, assetVersionId: `version-next-${i}` }));
    const projection = (images: CanvasImage[]): CanvasDocumentProjection => ({
      placements: Object.fromEntries(images.map(image => [image.placementId!, placement(image.assetVersionId)])),
    });
    sync.acceptDirectory(directory(2, old)); sync.setDocument(projection(old), 2);
    sync.acceptDirectory(directory(4, future));
    expect(sync.view.images).toHaveLength(2000);
    expect(sync.view.images.every(image => image.assetVersionId!.startsWith('version-old-'))).toBe(true);
    // Each half remains usable without another GET; no referenced current media was evicted.
    sync.setDocument(projection(future), 4);
    expect(sync.view.images).toHaveLength(2000);
    expect(sync.view.images.every(image => image.assetVersionId!.startsWith('version-next-'))).toBe(true);
    const third = old.map((image, i) => ({ ...image, assetVersionId: `version-third-${i}` }));
    sync.acceptDirectory(directory(6, third)); sync.setDocument(projection(third), 6);
    sync.setDocument(projection(old), 7);
    expect(sync.view.images).toEqual([]);
    expect(sync.view.complete).toBe(false);
    expect(() => sync.acceptDirectory(directory(8, [...third, media('overflow')]))).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['project', 'sequence', 'array', 'duplicate-placement', 'duplicate-image', 'missing', 'wrong-version', 'ghost', 'deleted', 'processing', 'url', 'metadata'])(
    'rejects malformed %s directories atomically without leaking details', kind => {
      const sync = create();
      const payload = directory(2);
      const images = payload.canvasImages as CanvasImage[];
      const projection = payload.projection as CanvasDocumentProjection;
      if (kind === 'project') payload.projectId = 'other';
      if (kind === 'sequence') payload.sequence = 1.5;
      if (kind === 'array') payload.canvasImages = {};
      if (kind === 'duplicate-placement') images.push({ ...media(), id: 'another' });
      if (kind === 'duplicate-image') { images.push({ ...media('p2'), id: 'image-p1' }); projection.placements.p2 = placement('version-p2'); }
      if (kind === 'missing') images.length = 0;
      if (kind === 'wrong-version') images[0].assetVersionId = 'version-other';
      if (kind === 'ghost') delete projection.placements.p1;
      if (kind === 'deleted') projection.placements.p1.deleted = true;
      if (kind === 'processing') images[0].isProcessingPlaceholder = true;
      if (kind === 'url') images[0].url = '';
      if (kind === 'metadata') projection.groupDefinitions = {
        g: { id: 'g', name: 'g', note: '', imageIds: ['absent'] },
      };
      expect(() => sync.acceptDirectory(payload)).toThrow(expect.objectContaining({ code: 'DOCUMENT_MEDIA_SYNC_UNAVAILABLE' }));
      expect(sync.view.images).toMatchObject([{ assetVersionId: 'version-p1' }]);
    });
});
