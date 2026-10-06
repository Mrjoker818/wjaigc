// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';

const clip: CanvasImage = { id: 'video-a', placementId: 'video-a', assetVersionId: 'version-a',
  url: '', videoUrl: '/api/serve-upload/exports/clip.mp4', mediaType: 'video',
  x: 0, y: 0, width: 256, height: 192, rotation: 0, zIndex: 1, createdAt: 1 };

function canvas(projectId: string = 'project-a', image: CanvasImage = clip): React.JSX.Element {
  return <InfiniteCanvas images={[image]} onImagesChange={() => undefined}
    selectedImage={null} onSelectImage={() => undefined} onPreviewImage={() => undefined}
    onGenerateVariation={() => undefined} onExtractKeywords={() => undefined}
    onFusion={() => undefined} onAddImages={() => undefined} projectId={projectId}
    onRequestTaskPoll={async () => new Response('{}')} />;
}

async function settle(): Promise<void> {
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear() });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('real InfiniteCanvas native video recovery', () => {
  it('recovers the same preview after 503 Retry-After without an asset upload', async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === clip.videoUrl) {
        requests.push(init ?? {});
        return requests.length === 1 ? new Response(null, { status: 503, headers: { 'Retry-After': '1' } })
          : new Response(null, { status: 206, headers: { 'Content-Type': 'video/mp4' } });
      }
      return new Response('{}');
    });
    const view = render(canvas()); await settle(); vi.useFakeTimers();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const node = view.container.querySelector<HTMLVideoElement>('[data-canvas-video-preview]')!;
    fireEvent.error(node); await settle();
    expect(requests).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(requests).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); await settle();
    expect(requests).toHaveLength(2);
    for (const input of requests) {
      expect(input.method).toBe('GET');
      expect(input.headers).toEqual({ Range: 'bytes=0-63' });
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.instances[0]).toBe(node);
    expect(view.container.querySelector('[data-canvas-video-preview]')).toBe(node);
    expect(node.getAttribute('src')).toBe(clip.videoUrl);
  });

  it('stops automatic recovery after three busy responses and exposes an explicit retry', async () => {
    let probes = 0;
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url === clip.videoUrl) { probes++; return new Response(null, { status: 503, headers: { 'Retry-After': '1' } }); }
      return new Response('{}');
    });
    const view = render(canvas()); await settle(); vi.useFakeTimers();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const node = view.container.querySelector('[data-canvas-video-preview]')!;
    fireEvent.error(node); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(probes).toBe(3); expect(load).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: '重新加载视频' }).hasAttribute('disabled')).toBe(false);
    fireEvent.error(node); await settle();
    expect(probes).toBe(3);
  });

  it('aborts a pending preview probe on project switch and rejects its late success', async () => {
    const pending: { signal?: AbortSignal; resolve?: (response: Response) => void } = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === clip.videoUrl) {
        pending.signal = init?.signal as AbortSignal;
        return new Promise<Response>(resolve => { pending.resolve = resolve; });
      }
      return new Response('{}');
    });
    const view = render(canvas()); await settle();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    fireEvent.error(view.container.querySelector('[data-canvas-video-preview]')!); await settle();
    expect(pending.signal?.aborted).toBe(false);
    view.rerender(canvas('project-b'));
    expect(pending.signal?.aborted).toBe(true);
    pending.resolve?.(new Response(null, { status: 206, headers: { 'Content-Type': 'video/mp4' } })); await settle();
    expect(load).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 200])('does not reload on unauthorized/missing/non-video response %s', async (status) => {
    let probes = 0;
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url === clip.videoUrl) { probes++; return new Response(null, { status, headers: { 'Content-Type': 'text/html' } }); }
      return new Response('{}');
    });
    const view = render(canvas()); await settle();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    fireEvent.error(view.container.querySelector('[data-canvas-video-preview]')!); await settle();
    expect(probes).toBe(1); expect(load).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: '重新加载视频' }).hasAttribute('disabled')).toBe(false);
  });

  it('does not probe external video URLs with same-origin credentials', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => { requests.push(url); return new Response('{}'); });
    const view = render(canvas('project-a', { ...clip, videoUrl: 'https://example.org/clip.mp4' })); await settle();
    requests.length = 0;
    fireEvent.error(view.container.querySelector('[data-canvas-video-preview]')!); await settle();
    expect(requests).toEqual([]);
    expect(view.getByRole('button', { name: '重新加载视频' }).hasAttribute('disabled')).toBe(false);
  });

  it('terminates a probe that ignores abort and never applies its late response', async () => {
    const pending: { signal?: AbortSignal; resolve?: (response: Response) => void } = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === clip.videoUrl) { pending.signal = init?.signal as AbortSignal;
        return new Promise<Response>(resolve => { pending.resolve = resolve; }); }
      return new Response('{}');
    });
    const view = render(canvas()); await settle(); vi.useFakeTimers();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    fireEvent.error(view.container.querySelector('[data-canvas-video-preview]')!); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(pending.signal?.aborted).toBe(true);
    expect(view.getByRole('button', { name: '重新加载视频' }).hasAttribute('disabled')).toBe(false);
    pending.resolve?.(new Response(null, { status: 206, headers: { 'Content-Type': 'video/mp4' } })); await settle();
    expect(load).not.toHaveBeenCalled();
  });

  it('does not let duplicate native errors bypass server Retry-After', async () => {
    let probes = 0;
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url === clip.videoUrl) { probes++; return new Response(null, { status: 503, headers: { 'Retry-After': '2' } }); }
      return new Response('{}');
    });
    const view = render(canvas()); await settle(); vi.useFakeTimers();
    const node = view.container.querySelector('[data-canvas-video-preview]')!;
    fireEvent.error(node); await settle(); fireEvent.error(node); await settle();
    expect(probes).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); }); expect(probes).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(probes).toBe(2);
  });

  it('cancels the response stream before native reload rather than buffering an ignored Range', async () => {
    const order: string[] = [];
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url === clip.videoUrl) return new Response(new ReadableStream({ cancel(): void { order.push('cancel'); } }),
        { status: 200, headers: { 'Content-Type': 'video/mp4' } });
      return new Response('{}');
    });
    const view = render(canvas()); await settle();
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => { order.push('load'); });
    const node = view.container.querySelector('[data-canvas-video-preview]')!;
    fireEvent.error(node); await settle();
    expect(order).toEqual(['cancel', 'load']);
    Object.defineProperties(node, { videoWidth: { value: 32 }, videoHeight: { value: 24 } });
    fireEvent.loadedMetadata(node);
    expect(view.queryByRole('button', { name: '重新加载视频' })).toBeNull();
  });

  it('bounds repeated native load failures even when every probe succeeds', async () => {
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => url === clip.videoUrl
      ? new Response(null, { status: 206, headers: { 'Content-Type': 'video/mp4' } }) : new Response('{}'));
    const view = render(canvas()); await settle();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const node = view.container.querySelector('[data-canvas-video-preview]')!;
    for (let i = 0; i < 4; i++) { fireEvent.error(node); await settle(); }
    expect(load).toHaveBeenCalledTimes(3);
    const button = view.getByRole('button', { name: '重新加载视频' });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button); await settle(); expect(load).toHaveBeenCalledTimes(4);
    expect(view.container.querySelectorAll('video')).toHaveLength(1);
  });

  it.each(['unmount', 'source'] as const)('invalidates a pending probe on %s without applying its late response', async (change) => {
    const pending: { signal?: AbortSignal; resolve?: (response: Response) => void } = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === clip.videoUrl) { pending.signal = init?.signal as AbortSignal;
        return new Promise<Response>(resolve => { pending.resolve = resolve; }); }
      return new Response('{}');
    });
    const view = render(canvas()); await settle();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    fireEvent.error(view.container.querySelector('[data-canvas-video-preview]')!); await settle();
    if (change === 'unmount') view.unmount();
    else view.rerender(canvas('project-a', { ...clip, videoUrl: '/api/serve-upload/exports/new.webm', assetVersionId: 'version-b' }));
    expect(pending.signal?.aborted).toBe(true);
    pending.resolve?.(new Response(null, { status: 206, headers: { 'Content-Type': 'video/mp4' } })); await settle();
    expect(load).not.toHaveBeenCalled();
  });

  it('recovers inline playback through its real play overlay and keeps native controls/ref events', async () => {
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => url === clip.videoUrl
      ? new Response(null, { status: 206, headers: { 'Content-Type': 'video/mp4' } }) : new Response('{}'));
    const view = render(canvas()); await settle();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    fireEvent.click(view.getByText('VIDEO'));
    const inline = view.container.querySelector<HTMLVideoElement>('video:not([data-canvas-video-preview])')!;
    expect(inline.autoplay).toBe(true); expect(inline.loop).toBe(false);
    fireEvent.error(inline); await settle();
    expect(load.mock.instances[0]).toBe(inline);
    Object.defineProperties(inline, { videoWidth: { value: 32 }, videoHeight: { value: 24 }, duration: { value: 120 } });
    fireEvent.loadedMetadata(inline); fireEvent.durationChange(inline);
    inline.currentTime = 30; fireEvent.timeUpdate(inline);
    expect(view.container.textContent).toContain('0:30');
    expect(view.container.textContent).toContain('2:00');
    expect(view.container.querySelector('[style*="width: 25%"]')).not.toBeNull();
    fireEvent.ended(inline);
    expect(view.container.querySelector('video:not([data-canvas-video-preview])')).toBeNull();
    expect(view.getByText('VIDEO')).toBeTruthy();
  });

  it('never lets a timed-out probe rejection abort a newer manual retry in the same scope', async () => {
    const pending: Array<{ signal: AbortSignal; resolve: (r: Response) => void; reject: (e: Error) => void }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === clip.videoUrl) return new Promise<Response>((resolve, reject) => {
        pending.push({ signal: init?.signal as AbortSignal, resolve, reject });
      });
      return new Response('{}');
    });
    const view = render(canvas()); await settle(); vi.useFakeTimers();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    fireEvent.error(view.container.querySelector('[data-canvas-video-preview]')!); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(pending[0].signal.aborted).toBe(true);
    fireEvent.click(view.getByRole('button', { name: '重新加载视频' })); await settle();
    expect(pending).toHaveLength(2);
    pending[0].reject(new Error('old late rejection')); await settle();
    expect(pending[1].signal.aborted).toBe(false);
    pending[1].resolve(new Response(null, { status: 206, headers: { 'Content-Type': 'video/mp4' } })); await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retires the background preview while inline playback is mounted so it cannot cover controls', async () => {
    let probes = 0;
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url === clip.videoUrl) { probes++; return new Response(null, { status: 503, headers: { 'Retry-After': '1' } }); }
      return new Response('{}');
    });
    const view = render(canvas()); await settle(); vi.useFakeTimers();
    const background = view.container.querySelector('[data-canvas-video-preview]')!;
    fireEvent.click(view.getByText('VIDEO'));
    const inline = view.container.querySelector<HTMLVideoElement>('video:not([data-canvas-video-preview])')!;
    Object.defineProperties(inline, { videoWidth: { value: 32 }, videoHeight: { value: 24 } });
    fireEvent.loadedMetadata(inline);
    fireEvent.error(background); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(probes).toBe(0);
    expect(view.container.querySelector('[data-canvas-video-preview]')).toBeNull();
    expect(view.queryByRole('button', { name: '重新加载视频' })).toBeNull();
    expect(view.container.querySelector('video')).toBe(inline);
  });
});
