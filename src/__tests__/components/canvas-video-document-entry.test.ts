// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actualTransferCallback, contractDeferred } from '../helpers/canvas-chat-transfer-contract-fixture';
import { buildCompletedVideoCanvasMedia } from '@/lib/video-processing-state';
import { hasDirectVideoPollingTimedOut } from '@/lib/video-task-polling';
import { webcrypto } from 'node:crypto';
import { commitDocumentCanvasFile } from '@/lib/collaboration/document-canvas-upload';

function fixture() {
  const actor = { current: { id: 'actor-a' } }, project = { current: { id: 'project-a' } };
  const mounted = { current: true }, epoch = { current: 1 };
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  const writes: unknown[] = [], errors: string[] = [], success: string[] = [];
  const authority = { projectId: 'project-a', authority: 'document', isWritable: () => true,
    refreshMedia: vi.fn(async (): Promise<unknown[]> => []), recordMediaHistory: vi.fn() };
  const ref = { current: authority };
  const counts = vi.fn();
  const bindings = {
    currentUserRef: actor, currentProjectRef: project, isMountedRef: mounted,
    historyProjectIdRef: { current: 'project-a' }, historyTransitionEpochRef: epoch,
    collaborativeCanvasRef: ref, historyLifecyclePendingRef: { current: false },
    isDocumentHistoryRecoveryPending: () => false, latestImagesRef: { current: [{ id: 'source',
      url: '/source.mp4', videoUrl: '/source.mp4', assetVersionId: 'version-source', placementId: 'placement-source' }] },
    setImages: (value: unknown) => { writes.push(value); return true; },
    setActiveGenerationCount: counts, themeStyle: 'monochrome',
    createVideoRetryPayload: (value: unknown) => value,
    buildVideoFailureProcessing: (_value: unknown, message: string) => ({ message }),
    buildCompletedVideoCanvasMedia,
    hasDirectVideoPollingTimedOut, awaitStableImageUrl: async (url: string) => url,
    commitDocumentCanvasFile, loadCanvasImageSize: async () => ({ width: 32, height: 24 }),
    getCanvasImageDisplaySize: (width: number, height: number) => ({ width, height }),
    toast: { error: (value: string) => errors.push(value), success: (value: string) => success.push(value) },
    UserManagerCore: { getInstance: () => ({ recordUsage: vi.fn() }) },
    videoPanelRef: { current: null },
  };
  const callback = actualTransferCallback<(value: Record<string, unknown>) => Promise<void>>('handleVideoGenerate', bindings);
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init?.body || '{}')), headers: new Headers(init?.headers) });
    return Response.json({ error: 'controlled provider rejection' }, { status: 403 });
  });
  return { callback, actor, project, mounted, epoch, ref, requests, writes, errors, success, authority, counts };
}
const params = { prompt: 'scene', model: 'video-model', aspectRatio: '16:9', duration: 5, quality: 'std' };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('actual video canvas entry', () => {
  it('settles the chain promise without late toast/counter or recursive polling when its scope expires', async () => {
    vi.useFakeTimers();
    const f = fixture(), entered = contractDeferred<void>(), response = contractDeferred<Response>();
    let settled = false;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === '/api/poll-task') { entered.release(); return response.promise; }
      return Response.json({ taskId: 'video-task' });
    });
    const pending = f.callback({ ...params, mode: 'multi-shot', chainContinuity: true,
      multiShotScenes: [{ id: 'one', prompt: 'one', duration: 5 }, { id: 'two', prompt: 'two', duration: 5 }] });
    void pending.then(() => { settled = true; });
    await entered.promise;
    f.project.current = { id: 'project-b' };
    response.release(Response.json({ status: 'processing' }));
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(settled).toBe(true);
    expect(f.errors).toEqual([]);
    expect(f.success).toEqual([]);
    expect(f.counts).toHaveBeenCalledTimes(1);
  });
  it('chains through a real controlled frame upload and canonical task receipts, not save-image', async () => {
    vi.stubGlobal('crypto', webcrypto);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:controlled-decode' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    const f = fixture();
    let task = 0;
    const frame = { id: 'frame', assetId: 'frame-asset', assetVersionId: 'frame-version', placementId: 'frame-placement',
      url: '/managed-frame.png', mediaType: 'image', width: 32, height: 24, originalWidth: 32, originalHeight: 24 };
    f.authority.refreshMedia.mockResolvedValue([frame, ...[1, 2].map(index => ({ id: `result-${index}`, assetId: `asset-${index}`,
      assetVersionId: `version-${index}`, placementId: `placement-${index}`, mediaType: 'video', videoUrl: `/result-${index}.mp4`,
      url: `/result-${index}.mp4`, width: 512, height: 288, originalWidth: 1920, originalHeight: 1080 }))]);
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      f.requests.push({ url, body, headers: new Headers(init?.headers) });
      if (url === '/api/video/extract-frame') return Response.json({ imageUrl: '/frame.png' });
      if (url === '/frame.png') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
      if (url === '/api/collaboration/document-assets/upload') return Response.json({ success: true,
        placementId: frame.placementId, assetVersionId: frame.assetVersionId, documentSequence: 9,
        assetReference: { ...frame, entityId: frame.id, kind: 'image' } });
      if (body.action === 'publish-canvas-task') {
        const index = Number(String(body.taskId).slice(-1));
        return Response.json({ success: true, projectId: 'project-a', taskId: body.taskId, documentSequence: index,
          placementId: `placement-${index}`, assetVersionId: `version-${index}`,
          assetReference: { entityId: `result-${index}`, assetId: `asset-${index}`, assetVersionId: `version-${index}`,
            placementId: `placement-${index}`, kind: 'video', url: `/result-${index}.mp4` } });
      }
      if (url === '/api/poll-task') return Response.json({ status: 'completed', videoUrl: `/raw-${task}.mp4` });
      return Response.json({ taskId: `video-task-${++task}` });
    });
    await f.callback({ ...params, mode: 'multi-shot', chainContinuity: true,
      multiShotScenes: [{ id: 'one', prompt: 'one', duration: 5 }, { id: 'two', prompt: 'two', duration: 5 }] });
    expect(f.requests.filter(request => request.url === '/api/collaboration/document-assets/upload')).toHaveLength(1);
    expect(f.requests.filter(request => request.body.action === 'publish-canvas-task')).toHaveLength(2);
    const submits = f.requests.filter(request => request.url === '/api/video/generate' && !request.body.action);
    expect(submits[1]?.body.imageUrl).toBe(frame.url);
    expect(submits[1]?.body.assetParentVersionIds).toEqual([frame.assetVersionId]);
    expect(f.requests.some(request => request.url === '/api/save-image')).toBe(false);
    expect(f.authority.recordMediaHistory).toHaveBeenCalledTimes(2);
  });
  it.each(['text2video', 'video-extend'])('%s confirms canonical task import, directory and history without legacy persistence', async mode => {
    const f = fixture();
    const reference = { entityId: 'result', assetId: 'asset-result', assetVersionId: 'version-result', placementId: 'placement-result', kind: 'video', url: '/result.mp4' };
    f.authority.refreshMedia.mockResolvedValue([{ id: 'result', assetId: 'asset-result', assetVersionId: 'version-result', placementId: 'placement-result',
      mediaType: 'video', videoUrl: '/result.mp4', url: '/result.mp4', width: 512, height: 288, originalWidth: 1920, originalHeight: 1080 }]);
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      f.requests.push({ url, body, headers: new Headers(init?.headers) });
      if (body.action === 'publish-canvas-task') return Response.json({ success: true, projectId: 'project-a', taskId: 'video-task',
        placementId: 'placement-result', assetVersionId: 'version-result', documentSequence: 7, assetReference: reference });
      if (url === '/api/poll-task') return Response.json({ status: 'completed', videoUrl: '/raw-provider.mp4' });
      f.ref.current = { ...f.authority };
      return Response.json({ taskId: 'video-task' });
    });
    await f.callback({ ...params, mode, videoUrl: '/source.mp4' });
    await vi.waitFor(() => expect(f.authority.recordMediaHistory).toHaveBeenCalledTimes(1), { timeout: 250 });
    expect(f.requests.some(request => request.body.action === 'publish-canvas-task')).toBe(true);
    expect(f.authority.refreshMedia).toHaveBeenCalledWith({ projectId: 'project-a', documentSequence: 7, requireDirectorySequence: true });
    expect(f.requests.some(request => request.url === '/api/save-image')).toBe(false);
    expect(f.writes).toEqual([]);
  });
  it.each(['text2video', 'video-extend', 'multi-shot'])('binds %s to the actual document project before submission', async mode => {
    const f = fixture();
    await f.callback({ ...params, mode, videoUrl: '/source.mp4', chainContinuity: mode === 'multi-shot',
      multiShotScenes: [{ id: 'one', prompt: 'one', duration: 5 }, { id: 'two', prompt: 'two', duration: 5 }] });
    expect(f.requests[0]?.body.projectId).toBe('project-a');
    expect(f.requests[0]?.body.assetWorkspace).toBe('canvas');
    expect(f.requests[0]?.headers.get('idempotency-key')).toMatch(/^canvas-video:/);
    expect(f.requests[0]?.headers.get('x-wujie-expected-actor-id')).toBe('actor-a');
    expect(f.writes).toEqual([]);
  });
  it('does not write failure state or toast into a switched project after submit', async () => {
    const f = fixture(), response = contractDeferred<Response>(), entered = contractDeferred<void>();
    vi.stubGlobal('fetch', async () => { entered.release(); return response.promise; });
    const pending = f.callback({ ...params, mode: 'text2video' });
    await entered.promise;
    const before = f.writes.length;
    f.project.current = { id: 'project-b' };
    response.release(Response.json({ error: 'old request failed' }, { status: 403 }));
    await pending;
    expect(f.writes.length).toBe(before);
    expect(f.errors).toEqual([]);
  });
});
