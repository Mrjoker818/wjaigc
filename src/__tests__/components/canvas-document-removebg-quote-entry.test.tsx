// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';
import { claimRemoveBgSubmissionMarker, findRemoveBgSubmissionMarker } from '@/lib/canvas-removebg-submission-marker';

const source: CanvasImage = {
  id: 'source-image', url: '/original.png', x: 12, y: 24,
  width: 320, height: 240, originalWidth: 640, originalHeight: 480,
  assetVersionId: 'source-version', placementId: 'source-placement',
};

beforeEach(() => {
  const storage = new Map<string, string>([['wujie_engine_removebg', 'local']]);
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (name: string, callback: () => Promise<unknown>): Promise<unknown> => {
      const run = (queues.get(name) || Promise.resolve()).then(callback);
      queues.set(name, run.catch(() => undefined));
      return run;
    },
  } });
  vi.stubGlobal('localStorage', {
    get length() { return storage.size; },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  });
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('Image', class {
    onerror: (() => void) | null = null;
    set src(value: string) { if (value === '/original.png') queueMicrotask(() => this.onerror?.()); }
  });
});

afterEach(() => { Reflect.deleteProperty(navigator, 'locks'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function renderCanvas(image: CanvasImage = source, submitted?: Promise<Response>,
  recovered = Response.json({ success: true, found: true, taskId: 'prior-task', status: 'processing' }),
  polled = Response.json({ success: true, status: 'processing' }), documentMode = true) {
  const requests: Array<{ body: Record<string, unknown>; key: string | null }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === '/api/auth/me') return Response.json({ success: true, user: { id: 'source-editor' } });
    if (url.startsWith('/api/tasks/recover?')) return recovered;
    if (url === '/api/image-edit') {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      requests.push({ body, key: new Headers(init?.headers).get('Idempotency-Key') });
      if (body.quoteOnly) return Response.json({ success: true, quote: {
        total: 5, components: { removebg: 5 }, token: 'signed-test-quote',
        expiresAt: Date.now() + 300_000, service: 'remove-background',
      } });
      return submitted || Response.json({ success: false, code: 'CONTROLLED_SUBMISSION' }, { status: 409 });
    }
    if (url === '/api/models?type=removebg') return Response.json({ providers: [], models: [] });
    return Response.json({ success: true });
  });
  vi.stubGlobal('fetch', fetch);
  const onImagesChange = vi.fn();
  const view = render(<InfiniteCanvas images={[image]} onImagesChange={onImagesChange}
    selectedImage={image} onSelectImage={() => undefined} onPreviewImage={() => undefined}
    onGenerateVariation={() => undefined} onExtractKeywords={() => undefined}
    onFusion={() => undefined} onAddImages={() => undefined}
    projectId="source-shared" documentMetadataMode={documentMode}
    onRequestTaskPoll={async () => polled} />);
  return { ...view, requests, fetch, onImagesChange };
}

async function openRemoveBackground(container: HTMLElement): Promise<HTMLButtonElement> {
  const toolbar = await waitFor(() => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-image-toolbar-main-action]'))
      .find(candidate => candidate.textContent?.trim() === '移除背景');
    expect(button).toBeTruthy();
    return button!;
  });
  fireEvent.click(toolbar);
  return await waitFor(() => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(candidate => candidate.textContent?.trim() === '查看去背景报价');
    expect(button).toBeTruthy();
    return button!;
  });
}

describe('document canvas remove-background quote entry', () => {
  it('previews a signed quote for the selected version without submitting or adding a result', async () => {
    const { container, requests, onImagesChange } = renderCanvas();
    const begin = await openRemoveBackground(container);
    fireEvent.click(begin);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      body: { action: 'remove_background', projectId: 'source-shared', imageUrl: '/original.png',
        assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
        assetSelectedEntityIds: ['source-image'], engine: 'local', quoteOnly: true },
    });
    expect(requests[0].key).toBeTruthy();
    expect(container.textContent).toContain('5 积分');
    expect(onImagesChange).not.toHaveBeenCalled();
  });

  it('submits only after confirmation with the preview key and leaves published assets to the document', async () => {
    const submitted = Promise.resolve(Response.json({ success: true, status: 'completed',
      taskId: 'task-rembg', imageUrl: '/api/serve-upload/exports/primary.png',
      maskUrl: '/api/serve-upload/exports/mask.png',
      assetProjection: { status: 'completed', references: [
        { url: '/api/serve-upload/exports/published-primary.png', assetVersionId: 'primary-version' },
        { url: '/api/serve-upload/exports/published-mask.png', assetVersionId: 'mask-version' },
      ] }, quote: { total: 5, components: { removebg: 5 } },
    }));
    const { container, requests, onImagesChange } = renderCanvas(source, submitted);
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(container.textContent).toContain('5 积分'));
    expect(requests).toHaveLength(1);
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('确认报价并开始去背景'));
    expect(confirm).toBeTruthy();
    fireEvent.click(confirm!);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].key).toBe(requests[0].key);
    expect(requests[1].body).toMatchObject({ ...requests[0].body,
      quoteOnly: false, quoteToken: 'signed-test-quote' });
    await waitFor(() => expect(findRemoveBgSubmissionMarker(localStorage, {
      projectId: 'source-shared', imageId: 'source-image', sourceVersionId: 'source-version',
    }, 'source-editor')).toBeNull());
    await waitFor(() => expect(onImagesChange).toHaveBeenCalled());
    expect(onImagesChange.mock.calls.every(([images]) => (images as CanvasImage[])
      .every(image => image.url !== '/api/serve-upload/exports/primary.png'
        && image.url !== '/api/serve-upload/exports/mask.png'))).toBe(true);
  });

  it('does not submit a document image without an asset version', async () => {
    const { container, requests } = renderCanvas({ ...source, assetVersionId: undefined });
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(requests).toHaveLength(0));
  });

  it('invalidates a quote when collaboration updates the selected image before confirmation', async () => {
    const { container, requests, rerender, onImagesChange } = renderCanvas();
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(container.textContent).toContain('5 积分'));
    const revised = { ...source, url: '/revised.png', assetVersionId: 'revised-version' };
    rerender(<InfiniteCanvas images={[revised]} onImagesChange={onImagesChange}
      selectedImage={revised} onSelectImage={() => undefined} onPreviewImage={() => undefined}
      onGenerateVariation={() => undefined} onExtractKeywords={() => undefined}
      onFusion={() => undefined} onAddImages={() => undefined}
      projectId="source-shared" documentMetadataMode
      onRequestTaskPoll={async () => Response.json({ status: 'processing' })} />);
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('确认报价并开始去背景'))!;
    fireEvent.click(confirm);
    await waitFor(() => expect(container.textContent).not.toContain('本次报价'));
    expect(requests).toHaveLength(1);
  });

  it('hides the stale amount immediately when the local remove-background model changes', async () => {
    const { container, requests } = renderCanvas();
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(container.textContent).toContain('本次报价：5 积分'));
    fireEvent.click(Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('BiRefNet 人像'))!);
    await waitFor(() => expect(container.textContent).not.toContain('本次报价：5 积分'));
    expect(container.textContent).toContain('查看去背景报价');
    expect(requests).toHaveLength(1);
  });

  it('does not create a second charged submission when another tab already owns this source', async () => {
    const { container, requests, fetch } = renderCanvas();
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(container.textContent).toContain('5 积分'));
    await claimRemoveBgSubmissionMarker(navigator.locks, localStorage, {
      version: 1, actorId: 'source-editor', projectId: 'source-shared',
      imageId: 'source-image', sourceVersionId: 'source-version',
      idempotencyKey: 'other-tab-key', createdAt: 1,
    });
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('确认报价并开始去背景'))!;
    fireEvent.click(confirm);
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/tasks/recover?'))).toBe(true));
    expect(requests).toHaveLength(1);
  });

  it('persists one source marker before sending the paid POST', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    const { container, requests } = renderCanvas(source, pending);
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(container.textContent).toContain('5 积分'));
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('确认报价并开始去背景'))!;
    fireEvent.click(confirm);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(findRemoveBgSubmissionMarker(localStorage, {
      projectId: 'source-shared', imageId: 'source-image', sourceVersionId: 'source-version',
    }, 'source-editor')?.idempotencyKey).toBe(requests[0].key);
    release(Response.json({ success: false, code: 'IMAGE_EDIT_QUOTE_CHANGED' }, { status: 409 }));
  });

  it('shows an unknown-state checkpoint rather than a retryable failure when the paid response is lost', async () => {
    const lost = Promise.reject(new Error('connection lost'));
    void lost.catch(() => undefined);
    const { container, requests, onImagesChange } = renderCanvas(source, lost);
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(container.textContent).toContain('5 积分'));
    fireEvent.click(Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('确认报价并开始去背景'))!);
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() => expect(onImagesChange.mock.calls.some(([images]) =>
      (images as CanvasImage[]).some(image => image.processing?.status.includes('状态待核对')))).toBe(true));
    expect(findRemoveBgSubmissionMarker(localStorage, {
      projectId: 'source-shared', imageId: 'source-image', sourceVersionId: 'source-version',
    }, 'source-editor')).not.toBeNull();
  });

  it('rechecks the original completed task publication before clearing its source marker', async () => {
    const recovered = Response.json({ success: true, found: true, taskId: 'prior-task',
      status: 'completed', assetProjectionStatus: 'projection_pending' });
    const polled = Response.json({ success: true, taskId: 'prior-task', status: 'completed',
      imageUrl: '/api/serve-upload/exports/primary.png', maskUrl: '/api/serve-upload/exports/mask.png',
      assetProjection: { status: 'completed', references: [
        { url: '/api/serve-upload/exports/primary.png', assetVersionId: 'primary-version' },
        { url: '/api/serve-upload/exports/mask.png', assetVersionId: 'mask-version' },
      ] } });
    const { container, requests } = renderCanvas(source, undefined, recovered, polled);
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(container.textContent).toContain('5 积分'));
    await claimRemoveBgSubmissionMarker(navigator.locks, localStorage, {
      version: 1, actorId: 'source-editor', projectId: 'source-shared',
      imageId: 'source-image', sourceVersionId: 'source-version',
      idempotencyKey: 'prior-key', createdAt: 1,
    });
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('确认报价并开始去背景'))!;
    fireEvent.click(confirm);
    await waitFor(() => expect(findRemoveBgSubmissionMarker(localStorage, {
      projectId: 'source-shared', imageId: 'source-image', sourceVersionId: 'source-version',
    }, 'source-editor')).toBeNull());
    expect(requests).toHaveLength(1);
  });

  it('keeps a completed attempt blocked until a verified two-asset publication is recovered', async () => {
    const recovered = Response.json({ success: true, found: true, taskId: 'prior-task',
      status: 'completed', assetProjectionStatus: 'completed' });
    const { container, requests } = renderCanvas(source, undefined, recovered);
    await claimRemoveBgSubmissionMarker(navigator.locks, localStorage, {
      version: 1, actorId: 'source-editor', projectId: 'source-shared',
      imageId: 'source-image', sourceVersionId: 'source-version',
      idempotencyKey: 'prior-key', createdAt: 1,
    });
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(requests).toHaveLength(0));
    expect(findRemoveBgSubmissionMarker(localStorage, {
      projectId: 'source-shared', imageId: 'source-image', sourceVersionId: 'source-version',
    }, 'source-editor')).not.toBeNull();
  });

  it('keeps the original attempt blocked when recovered media URLs disagree with published asset references', async () => {
    const recovered = Response.json({ success: true, found: true, taskId: 'prior-task',
      status: 'completed', assetProjectionStatus: 'completed', publication: {
        imageUrl: '/api/serve-upload/exports/unpublished-primary.png',
        maskUrl: '/api/serve-upload/exports/mask.png', references: [
          { url: '/api/serve-upload/exports/primary.png', assetVersionId: 'primary-version' },
          { url: '/api/serve-upload/exports/mask.png', assetVersionId: 'mask-version' },
        ] } });
    const { container, requests } = renderCanvas(source, undefined, recovered);
    await claimRemoveBgSubmissionMarker(navigator.locks, localStorage, {
      version: 1, actorId: 'source-editor', projectId: 'source-shared',
      imageId: 'source-image', sourceVersionId: 'source-version',
      idempotencyKey: 'prior-key', createdAt: 1,
    });
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(requests).toHaveLength(0));
    expect(findRemoveBgSubmissionMarker(localStorage, {
      projectId: 'source-shared', imageId: 'source-image', sourceVersionId: 'source-version',
    }, 'source-editor')).not.toBeNull();
  });

  it('clears a persisted attempt only when recovery reports an authoritative failed task', async () => {
    const recovered = Response.json({ success: true, found: true, taskId: 'prior-task', status: 'failed' });
    const { container, requests } = renderCanvas(source, undefined, recovered);
    await claimRemoveBgSubmissionMarker(navigator.locks, localStorage, {
      version: 1, actorId: 'source-editor', projectId: 'source-shared',
      imageId: 'source-image', sourceVersionId: 'source-version',
      idempotencyKey: 'prior-key', createdAt: 1,
    });
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(findRemoveBgSubmissionMarker(localStorage, {
      projectId: 'source-shared', imageId: 'source-image', sourceVersionId: 'source-version',
    }, 'source-editor')).toBeNull());
    expect(requests).toHaveLength(0);
  });

  it('removes the pending processing frame after verified recovery of the same task', async () => {
    const pending = Promise.resolve(Response.json({ success: true, taskId: 'prior-task',
      status: 'publication-pending', retryAfterMs: 1500 }, { status: 202 }));
    const recovered = Response.json({ success: true, found: true, taskId: 'prior-task',
      status: 'completed', assetProjectionStatus: 'completed', publication: {
        imageUrl: '/api/serve-upload/exports/primary.png',
        maskUrl: '/api/serve-upload/exports/mask.png', references: [
          { url: '/api/serve-upload/exports/primary.png', assetVersionId: 'primary-version' },
          { url: '/api/serve-upload/exports/mask.png', assetVersionId: 'mask-version' },
        ] } });
    const { container, requests, onImagesChange } = renderCanvas(source, pending, recovered);
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(container.textContent).toContain('5 积分'));
    fireEvent.click(Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('确认报价并开始去背景'))!);
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() => expect(onImagesChange.mock.calls.some(([images]) =>
      (images as CanvasImage[]).some(image => image.processing?.taskId === 'prior-task'))).toBe(true));
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(findRemoveBgSubmissionMarker(localStorage, {
      projectId: 'source-shared', imageId: 'source-image', sourceVersionId: 'source-version',
    }, 'source-editor')).toBeNull());
    expect(onImagesChange.mock.lastCall?.[0]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ processing: expect.objectContaining({ taskId: 'prior-task' }) }),
    ]));
    expect(requests).toHaveLength(2);
  });

  it('keeps the original attempt pending when the server has completed but canvas publication is delayed', async () => {
    const pending = Promise.resolve(Response.json({ success: true, taskId: 'prior-task',
      status: 'publication-pending', retryAfterMs: 1500 }, { status: 202 }));
    const { container, requests, onImagesChange } = renderCanvas(source, pending);
    fireEvent.click(await openRemoveBackground(container));
    await waitFor(() => expect(container.textContent).toContain('5 积分'));
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('确认报价并开始去背景'))!;
    fireEvent.click(confirm);
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() => expect(onImagesChange.mock.calls.some(([images]) =>
      (images as CanvasImage[]).some(image => image.processing?.status.includes('画布发布待核对')))).toBe(true));
    expect(findRemoveBgSubmissionMarker(localStorage, {
      projectId: 'source-shared', imageId: 'source-image', sourceVersionId: 'source-version',
    }, 'source-editor')).not.toBeNull();
  });

  it('preserves the personal canvas direct remove-background request without document quote fields', async () => {
    const { container, requests } = renderCanvas(source, undefined, undefined, undefined, false);
    const toolbar = await waitFor(() => Array.from(container.querySelectorAll<HTMLButtonElement>('[data-image-toolbar-main-action]'))
      .find(button => button.textContent?.trim() === '移除背景')!);
    fireEvent.click(toolbar);
    const begin = await waitFor(() => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '开始去背景')!);
    fireEvent.click(begin);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toMatchObject({ action: 'remove_background', imageUrl: '/original.png', engine: 'local' });
    expect(requests[0].body).not.toHaveProperty('quoteOnly');
    expect(requests[0].body).not.toHaveProperty('assetSelectedEntityIds');
    expect(requests[0].key).toBeNull();
  });
});
