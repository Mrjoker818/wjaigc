// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';
import { findUpscaleSubmissionMarker } from '@/lib/canvas-upscale-submission-marker';

const image: CanvasImage = {
  id: 'image-a', url: '/original.png', x: 12, y: 24,
  width: 320, height: 240, originalWidth: 640, originalHeight: 480,
};
let browserStorage: Map<string, string>;

beforeEach(() => {
  browserStorage = new Map<string, string>();
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (name: string, callback: () => Promise<unknown>): Promise<unknown> => {
      const run = (queues.get(name) || Promise.resolve()).then(callback);
      queues.set(name, run.catch(() => undefined));
      return run;
    },
  } });
  vi.stubGlobal('localStorage', {
    get length() { return browserStorage.size; },
    key: (index: number) => Array.from(browserStorage.keys())[index] ?? null,
    getItem: (key: string) => browserStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { browserStorage.set(key, value); },
    removeItem: (key: string) => { browserStorage.delete(key); },
    clear: () => { browserStorage.clear(); },
  });
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('Image', class {
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(value: string) {
      if (value === '/original.png') queueMicrotask(() => this.onerror?.());
    }
  });
});
afterEach(() => { Reflect.deleteProperty(navigator, 'locks'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function renderSelectedImage(selected: CanvasImage, quoteModel = false, quoteChanged = false,
  pendingSubmit?: Promise<Response>, pollResponse = new Response('{}'),
  recoverResponse = Response.json({ success: true, found: false }), authGate?: Promise<void>,
  activeConflict = false) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
    if (url === '/api/auth/me') {
      await authGate;
      return Response.json({ success: true, user: { id: 'actor-a' } });
    }
    if (url.startsWith('/api/tasks/recover?')) return recoverResponse;
    if (url === '/api/models?type=upscaler' && quoteModel) {
      return Response.json({ providers: [{ id: 'provider-302', name: '302.AI' }],
        models: [{ id: '302-esrgan', providerId: 'provider-302', name: 'ESRGAN' }] });
    }
    if (url === '/api/image-edit') {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      if (body.quoteOnly) return Response.json({ success: true, quote: { total: 7,
        components: { upscale: 7, enhance: 0 }, token: 'offline-quote-token',
        expiresAt: Date.now() + 300_000, service: 'upscale-only' } });
      if (body.quoteToken && pendingSubmit) return pendingSubmit;
      if (body.quoteToken && quoteChanged) {
        return Response.json({ success: false, code: 'IMAGE_EDIT_QUOTE_CHANGED' }, { status: 409 });
      }
      if (body.quoteToken && activeConflict) {
        return Response.json({ success: false, code: 'IMAGE_EDIT_ACTIVE_ATTEMPT', taskId: 'original-task',
          idempotencyKey: 'original-key', status: 'processing' }, { status: 409 });
      }
      return new Response(JSON.stringify({ success: false, error: 'controlled rejection' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  const onImagesChange = vi.fn();
  const onRequestTaskPoll = vi.fn(async () => pollResponse);
  const canvasFor = (current: CanvasImage) => <InfiniteCanvas
    images={[current]}
    onImagesChange={onImagesChange}
    selectedImage={current}
    onSelectImage={() => undefined}
    onPreviewImage={() => undefined}
    onGenerateVariation={() => undefined}
    onExtractKeywords={() => undefined}
    onFusion={() => undefined}
    onAddImages={() => undefined}
    projectId="project-a"
    documentMetadataMode
    onRequestTaskPoll={onRequestTaskPoll}
  />;
  const view = render(canvasFor(selected));
  return { ...view, fetch, onImagesChange, onRequestTaskPoll,
    rerenderImage: (current: CanvasImage) => view.rerender(canvasFor(current)) };
}

async function submitUpscale(container: HTMLElement): Promise<void> {
  const toolbarButton = await waitFor(() => {
    const buttons = Array.from(container.querySelectorAll('[data-image-toolbar-main-action]'));
    const button = buttons.find(candidate => candidate.textContent?.trim() === '放大');
    expect(button).toBeTruthy();
    return button as HTMLElement;
  });
  fireEvent.click(toolbarButton);
  const submitButton = await waitFor(() => {
    const button = container.querySelector<HTMLButtonElement>('button[title="开始放大"]');
    expect(button?.disabled).toBe(false);
    return button!;
  });
  fireEvent.click(submitButton);
}

async function preview302Upscale(container: HTMLElement): Promise<void> {
  const toolbarButton = await waitFor(() => {
    const button = Array.from(container.querySelectorAll('[data-image-toolbar-main-action]'))
      .find(candidate => candidate.textContent?.trim() === '放大');
    expect(button).toBeTruthy();
    return button as HTMLElement;
  });
  fireEvent.click(toolbarButton);
  const aiButton = await waitFor(() => {
    const button = container.querySelector<HTMLButtonElement>('button[title^="仅使用专用 AI 超分"]');
    expect(button).toBeTruthy();
    return button!;
  });
  fireEvent.click(aiButton);
  const previewButton = await waitFor(() => {
    const button = container.querySelector<HTMLButtonElement>('button[title="查看放大报价"]');
    expect(button?.disabled).toBe(false);
    return button!;
  });
  fireEvent.click(previewButton);
  await waitFor(() => expect(container.textContent).toContain('本次报价：7 积分'));
}

describe('document canvas upscale entry', () => {
  it('adopts the original owned attempt after a different-key active-task conflict', async () => {
    const { container, fetch } = renderSelectedImage({ ...image, assetVersionId: 'version-a' }, true,
      false, undefined, new Response('{}'),
      Response.json({ success: true, found: true, taskId: 'original-task', status: 'processing' }),
      undefined, true);
    await preview302Upscale(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    await waitFor(() => expect(findUpscaleSubmissionMarker(localStorage,
      { projectId: 'project-a', imageId: 'image-a', sourceVersionId: 'version-a' }, 'actor-a')?.idempotencyKey)
      .toBe('original-key'));
    expect(Array.from(browserStorage.keys()).filter(key => key.startsWith('wujie:upscale302:attempt:')))
      .toHaveLength(1);
    const recheck = await waitFor(() => container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]')!);
    fireEvent.click(recheck);
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('idempotencyKey=original-key'))).toBe(true));
    expect(fetch.mock.calls.filter(([url, init]) => url === '/api/image-edit'
      && Boolean(JSON.parse(String(init?.body)).quoteToken))).toHaveLength(1);
  });

  it('does not send the paid POST when cross-tab locks are unavailable', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    const { container, fetch } = renderSelectedImage({ ...image, assetVersionId: 'version-a' }, true);
    await preview302Upscale(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    await waitFor(() => expect(container.textContent).toContain('提交状态未知'));
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(1);
    expect(Array.from(browserStorage.keys()).filter(key => key.startsWith('wujie:upscale302:attempt:'))).toHaveLength(0);
  });

  it('does not let an unresolved source block a different image after selection changes', async () => {
    browserStorage.set('wujie:upscale302:attempt:stored-key', JSON.stringify({ version: 1,
      actorId: 'actor-a', projectId: 'project-a', imageId: 'image-a', sourceVersionId: 'version-a',
      idempotencyKey: 'stored-key', createdAt: Date.now() }));
    const view = renderSelectedImage({ ...image, assetVersionId: 'version-a' });
    await waitFor(() => expect(view.fetch.mock.calls.some(([url]) => url === '/api/auth/me')).toBe(true));
    view.rerenderImage({ ...image, id: 'image-b', assetVersionId: 'version-b' });
    await submitUpscale(view.container);
    await waitFor(() => expect(view.fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(1));
    expect(view.fetch.mock.calls.some(([url]) => url.startsWith('/api/tasks/recover?'))).toBe(false);
  });

  it('does not let version one uncertainty block the same image ID at version two', async () => {
    let rejectSubmit: ((error: Error) => void) | undefined;
    const pendingSubmit = new Promise<Response>((_resolve, reject) => { rejectSubmit = reject; });
    const view = renderSelectedImage({ ...image, assetVersionId: 'version-a' }, true, false, pendingSubmit);
    await preview302Upscale(view.container);
    fireEvent.click(view.container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    await waitFor(() => expect(view.fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(2));
    rejectSubmit?.(new TypeError('response lost'));
    await waitFor(() => expect(view.container.textContent).toContain('提交状态未知'));
    view.rerenderImage({ ...image, assetVersionId: 'version-b' });
    const preview = await waitFor(() => {
      const button = view.container.querySelector<HTMLButtonElement>('button[title="查看放大报价"]');
      expect(button?.disabled).toBe(false);
      return button!;
    });
    fireEvent.click(preview);
    await waitFor(() => expect(view.fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(3));
    const requests = view.fetch.mock.calls.filter(([url]) => url === '/api/image-edit');
    expect(JSON.parse(String(requests[2][1]?.body))).toMatchObject({ quoteOnly: true,
      assetParentVersionIds: ['version-b'] });
    expect(Array.from(browserStorage.keys()).some(key => key.startsWith('wujie:upscale302:attempt:'))).toBe(true);
  });

  it('does not expose another account\'s stored attempt to the current account', async () => {
    browserStorage.set('wujie:upscale302:attempt:other-key', JSON.stringify({ version: 1,
      actorId: 'actor-b', projectId: 'project-a', imageId: 'image-a', sourceVersionId: 'version-a',
      idempotencyKey: 'other-key', createdAt: Date.now() }));
    const { container, fetch } = renderSelectedImage({ ...image, assetVersionId: 'version-a' }, true);
    await preview302Upscale(container);
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(1);
    expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/tasks/recover?'))).toBe(false);
  });

  it.each([
    ['processing', true], ['completed', false],
  ] as const)('recovers a stored %s task by key without resending its paid POST', async (status, remains): Promise<void> => {
    const markerKey = 'wujie:upscale302:attempt:stored-key';
    browserStorage.set(markerKey, JSON.stringify({ version: 1, actorId: 'actor-a', projectId: 'project-a',
      imageId: 'image-a', sourceVersionId: 'version-a', idempotencyKey: 'stored-key', createdAt: Date.now() }));
    const { container, fetch } = renderSelectedImage({ ...image, assetVersionId: 'version-a' },
      true, false, undefined, new Response('{}'),
      Response.json({ success: true, found: true, taskId: 'original-task', status }));
    const toolbar = await waitFor(() => Array.from(container.querySelectorAll<HTMLElement>('[data-image-toolbar-main-action]'))
      .find(button => button.textContent?.trim() === '放大')!);
    fireEvent.click(toolbar);
    const aiButton = await waitFor(() => container.querySelector<HTMLButtonElement>('button[title^="仅使用专用 AI 超分"]')!);
    fireEvent.click(aiButton);
    const action = await waitFor(() => container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]')!);
    fireEvent.click(action);
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/tasks/recover?'))).toBe(true));
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(0);
    expect(browserStorage.has(markerKey)).toBe(remains);
    if (status === 'processing') expect(container.textContent).toContain('原任务 original-task · processing');
  });

  it('blocks auto-mode re-submission and permits read-only recovery despite missing model and invalid dimensions', async () => {
    browserStorage.set('wujie:upscale302:attempt:stored-key', JSON.stringify({ version: 1,
      actorId: 'actor-a', projectId: 'project-a', imageId: 'image-a', sourceVersionId: 'version-a',
      idempotencyKey: 'stored-key', createdAt: Date.now() }));
    const { container, fetch } = renderSelectedImage({ ...image, assetVersionId: 'version-a',
      originalWidth: 8192, originalHeight: 8192 }, false);
    const toolbar = await waitFor(() => Array.from(container.querySelectorAll<HTMLElement>('[data-image-toolbar-main-action]'))
      .find(button => button.textContent?.trim() === '放大')!);
    fireEvent.click(toolbar);
    const recheck = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]');
      expect(button?.disabled).toBe(false);
      return button!;
    });
    fireEvent.click(recheck);
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/tasks/recover?'))).toBe(true));
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(0);
  });

  it('cannot submit in auto mode while refresh actor verification is still pending', async () => {
    browserStorage.set('wujie:upscale302:attempt:stored-key', JSON.stringify({ version: 1,
      actorId: 'actor-a', projectId: 'project-a', imageId: 'image-a', sourceVersionId: 'version-a',
      idempotencyKey: 'stored-key', createdAt: Date.now() }));
    let releaseAuth: (() => void) | undefined;
    const authGate = new Promise<void>(resolve => { releaseAuth = resolve; });
    const { container, fetch } = renderSelectedImage({ ...image, assetVersionId: 'version-a' },
      false, false, undefined, new Response('{}'),
      Response.json({ success: true, found: false }), authGate);
    const toolbar = await waitFor(() => Array.from(container.querySelectorAll<HTMLElement>('[data-image-toolbar-main-action]'))
      .find(button => button.textContent?.trim() === '放大')!);
    fireEvent.click(toolbar);
    const auto = await waitFor(() => container.querySelector<HTMLButtonElement>('button[title^="自动选择专用 AI"]')!);
    fireEvent.click(auto);
    const recheck = await waitFor(() => container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]')!);
    fireEvent.click(recheck);
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(0);
    releaseAuth?.();
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/tasks/recover?'))).toBe(true));
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(0);
  });

  it('keeps the old key unresolved when exact recovery fails', async () => {
    const markerKey = 'wujie:upscale302:attempt:stored-key';
    browserStorage.set(markerKey, JSON.stringify({ version: 1, actorId: 'actor-a', projectId: 'project-a',
      imageId: 'image-a', sourceVersionId: 'version-a', idempotencyKey: 'stored-key', createdAt: Date.now() }));
    const { container, fetch } = renderSelectedImage({ ...image, assetVersionId: 'version-a' },
      true, false, undefined, new Response('{}'), new Response('offline', { status: 503 }));
    const toolbar = await waitFor(() => Array.from(container.querySelectorAll<HTMLElement>('[data-image-toolbar-main-action]'))
      .find(button => button.textContent?.trim() === '放大')!);
    fireEvent.click(toolbar);
    const action = await waitFor(() => container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]')!);
    fireEvent.click(action);
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/tasks/recover?'))).toBe(true));
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(0);
    expect(browserStorage.has(markerKey)).toBe(true);
  });

  it('refresh after a paid POST cannot obtain a new quote while the old key is unresolved', async () => {
    let rejectSubmit: ((error: Error) => void) | undefined;
    const pendingSubmit = new Promise<Response>((_resolve, reject) => { rejectSubmit = reject; });
    const first = renderSelectedImage({ ...image, assetVersionId: 'version-a' }, true, false, pendingSubmit);
    await preview302Upscale(first.container);
    fireEvent.click(first.container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    await waitFor(() => expect(first.fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(2));
    const markerText = Array.from(browserStorage.entries())
      .find(([key]) => key.startsWith('wujie:upscale302:attempt:'))?.[1];
    expect(markerText).toBeTruthy();
    expect(markerText).not.toContain('offline-quote-token');
    expect(markerText).not.toContain('/original.png');
    expect(JSON.parse(markerText!)).toMatchObject({ version: 1, actorId: 'actor-a',
      projectId: 'project-a', imageId: 'image-a', sourceVersionId: 'version-a',
      idempotencyKey: expect.any(String) });
    rejectSubmit?.(new TypeError('response lost'));
    await waitFor(() => expect(first.container.textContent).toContain('提交状态未知'));
    first.unmount();

    const second = renderSelectedImage({ ...image, assetVersionId: 'version-a' }, true);
    const toolbar = await waitFor(() => Array.from(second.container.querySelectorAll<HTMLElement>('[data-image-toolbar-main-action]'))
      .find(button => button.textContent?.trim() === '放大')!);
    fireEvent.click(toolbar);
    const aiButton = await waitFor(() => second.container.querySelector<HTMLButtonElement>('button[title^="仅使用专用 AI 超分"]')!);
    fireEvent.click(aiButton);
    const action = await waitFor(() => second.container.querySelector<HTMLButtonElement>('button[title="查看放大报价"]')
      || second.container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]'));
    fireEvent.click(action!);
    await waitFor(() => expect(second.fetch.mock.calls.some(([url]) => url.startsWith('/api/tasks/recover?'))).toBe(true));
    expect(second.fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(0);
  });

  it('never sends the paid POST when the browser cannot persist its recovery key', async () => {
    const { container, fetch } = renderSelectedImage({ ...image, assetVersionId: 'version-a' }, true);
    await preview302Upscale(container);
    const originalSet = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string): void => {
      if (key.startsWith('wujie:upscale302:attempt:')) throw new Error('storage quota');
      originalSet(key, value);
    });
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    await waitFor(() => expect(container.textContent).toContain('提交状态未知'));
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(1);
  });

  it('shows the 302 price without starting a task and submits only after explicit confirmation', async () => {
    const { container, fetch, onImagesChange } = renderSelectedImage(
      { ...image, assetVersionId: 'version-a' }, true);
    await preview302Upscale(container);
    const requests = fetch.mock.calls.filter(([url]) => url === '/api/image-edit');
    expect(requests).toHaveLength(1);
    const preview = JSON.parse(String(requests[0][1]?.body)) as Record<string, unknown>;
    expect(preview).toMatchObject({ action: 'upscale', projectId: 'project-a',
      assetParentVersionIds: ['version-a'], upscaleModel: '302-esrgan', quoteOnly: true });
    expect(onImagesChange).not.toHaveBeenCalled();

    const confirm = container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]');
    expect(confirm?.disabled).toBe(false);
    fireEvent.click(confirm!);
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(2));
    const confirmed = fetch.mock.calls.filter(([url]) => url === '/api/image-edit')[1];
    const submitted = JSON.parse(String(confirmed[1]?.body)) as Record<string, unknown>;
    expect(submitted).toMatchObject({ action: 'upscale', projectId: 'project-a',
      assetParentVersionIds: ['version-a'], upscaleModel: '302-esrgan', quoteToken: 'offline-quote-token' });
    expect(submitted.quoteOnly).toBeUndefined();
    const quotedIntent = { ...preview };
    const confirmedIntent = { ...submitted };
    delete quotedIntent.quoteOnly;
    delete confirmedIntent.quoteToken;
    expect(confirmedIntent).toEqual(quotedIntent);
    expect(confirmed[1]?.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': expect.any(String) }));
    expect(confirmed[1]?.headers).toEqual(requests[0][1]?.headers);
  });

  it('does not submit or create a canvas result when the 302 quote is cancelled', async () => {
    const { container, fetch, onImagesChange } = renderSelectedImage(
      { ...image, assetVersionId: 'version-a' }, true);
    await preview302Upscale(container);
    const cancel = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '取消' && button.closest('[data-toolbar="edit-mode"]'));
    expect(cancel).toBeTruthy();
    fireEvent.click(cancel!);
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(1);
    expect(onImagesChange).not.toHaveBeenCalled();
  });

  it('does not present a misleading cancel action while the paid submission is pending', async () => {
    let releaseSubmit: ((response: Response) => void) | undefined;
    const pendingSubmit = new Promise<Response>(resolve => { releaseSubmit = resolve; });
    const { container } = renderSelectedImage({ ...image, assetVersionId: 'version-a' },
      true, false, pendingSubmit);
    await preview302Upscale(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    const cancel = await waitFor(() => {
      const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find(candidate => candidate.textContent?.trim() === '取消'
          && candidate.closest('[data-toolbar="edit-mode"]'));
      expect(button).toBeTruthy();
      return button!;
    });
    expect(cancel.disabled).toBe(true);
    releaseSubmit?.(Response.json({ success: false, code: 'IMAGE_EDIT_QUOTE_CHANGED' }, { status: 409 }));
    await waitFor(() => expect(container.querySelector('button[title="查看放大报价"]')).not.toBeNull());
  });

  it('rechecks an unknown paid submission read-only without resending its POST', async () => {
    let rejectSubmit: ((error: Error) => void) | undefined;
    const pendingSubmit = new Promise<Response>((_resolve, reject) => { rejectSubmit = reject; });
    const { container, fetch } = renderSelectedImage(
      { ...image, assetVersionId: 'version-a' }, true, false, pendingSubmit);
    await preview302Upscale(container);
    const originalNow = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(originalNow);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(2));
    rejectSubmit?.(new TypeError('network response lost'));
    const recheck = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]');
      expect(button?.disabled).toBe(false);
      expect(container.textContent).toContain('提交状态未知');
      return button!;
    });
    now.mockReturnValue(originalNow + 360_000);
    fireEvent.click(recheck);
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/tasks/recover?'))).toBe(true));
    const calls = fetch.mock.calls.filter(([url]) => url === '/api/image-edit');
    expect(calls.map(([, init]) => Boolean(JSON.parse(String(init?.body)).quoteOnly))).toEqual([true, false]);
    const paidKey = (calls[1][1]?.headers as Record<string, string>)['Idempotency-Key'];
    expect(fetch.mock.calls.some(([url]) => url.includes(`idempotencyKey=${paidKey}`))).toBe(true);
  });

  it('releases the uncertain quote only after the original task is confirmed failed', async () => {
    let rejectSubmit: ((error: Error) => void) | undefined;
    const pendingSubmit = new Promise<Response>((_resolve, reject) => { rejectSubmit = reject; });
    const { container, fetch } = renderSelectedImage(
      { ...image, assetVersionId: 'version-a' }, true, false, pendingSubmit);
    await preview302Upscale(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(2));
    rejectSubmit?.(new TypeError('network response lost'));
    const recheck = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]');
      expect(button).toBeTruthy();
      return button!;
    });
    fetch.mockImplementation(async (url: string) => url === '/api/auth/me'
      ? Response.json({ success: true, user: { id: 'actor-a' } })
      : Response.json({ success: true, found: true, taskId: 'original-task', status: 'failed' }));
    fireEvent.click(recheck);
    await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[title="查看放大报价"]');
      expect(button?.disabled).toBe(false);
    });
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(2);
  });

  it('keeps an explicitly unknown provider submission tied to the original paid task', async () => {
    const acceptedUnknown = Promise.resolve(Response.json({ success: true,
      status: 'submission-unknown', taskId: 'original-task' }, { status: 202 }));
    const { container, fetch } = renderSelectedImage(
      { ...image, assetVersionId: 'version-a' }, true, false, acceptedUnknown);
    await preview302Upscale(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]'))
        .toBeTruthy();
      expect(container.textContent).toContain('提交状态未知');
    });
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(2);
  });

  it('does not unlock a paid attempt when an accepted task cannot be confirmed by polling', async () => {
    const accepted = Promise.resolve(Response.json({ success: true,
      status: 'processing', taskId: 'original-task' }));
    const pollFailure = Response.json({ retryable: false, error: 'poll lookup unavailable' });
    const { container, fetch, onRequestTaskPoll } = renderSelectedImage(
      { ...image, assetVersionId: 'version-a' }, true, false, accepted, pollFailure);
    await preview302Upscale(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]'))
        .toBeTruthy();
      expect(container.textContent).toContain('提交状态未知');
    }, { timeout: 3000 });
    expect(onRequestTaskPoll).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'original-task' }), expect.any(Object));
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(2);
  });

  it('reopens an uncertain upscale with the frozen preset despite changed image metadata', async () => {
    let rejectSubmit: ((error: Error) => void) | undefined;
    const pendingSubmit = new Promise<Response>((_resolve, reject) => { rejectSubmit = reject; });
    const { container, fetch } = renderSelectedImage(
      { ...image, assetVersionId: 'version-a' }, true, false, pendingSubmit);
    await preview302Upscale(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]')!);
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(2));
    rejectSubmit?.(new TypeError('network response lost'));
    await waitFor(() => expect(container.textContent).toContain('提交状态未知'));
    fireEvent.keyDown(document, { key: 'Escape' });
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      naturalWidth = 3000;
      naturalHeight = 2000;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    fireEvent.click(container.querySelector<HTMLElement>('[data-canvas-image-id="image-a"]')!);
    const toolbarButton = await waitFor(() => {
      const button = Array.from(container.querySelectorAll<HTMLElement>('[data-image-toolbar-main-action]'))
        .find(candidate => candidate.textContent?.trim() === '放大');
      expect(button).toBeTruthy();
      return button!;
    });
    fireEvent.click(toolbarButton!);
    const recheck = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[title="核对原放大任务"]');
      expect(button?.disabled).toBe(false);
      return button!;
    });
    fireEvent.click(recheck);
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/tasks/recover?'))).toBe(true));
    const calls = fetch.mock.calls.filter(([url]) => url === '/api/image-edit');
    expect(calls).toHaveLength(2);
    const paidKey = (calls[1][1]?.headers as Record<string, string>)['Idempotency-Key'];
    expect(fetch.mock.calls.some(([url]) => url.includes(`idempotencyKey=${paidKey}`))).toBe(true);
  });

  it('rejects a stale 302 quote and permits a fresh preview without sending the old token again', async () => {
    const { container, fetch } = renderSelectedImage(
      { ...image, assetVersionId: 'version-a' }, true, true);
    await preview302Upscale(container);
    const confirm = container.querySelector<HTMLButtonElement>('button[title="确认报价并开始放大"]');
    fireEvent.click(confirm!);
    const previewButton = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[title="查看放大报价"]');
      expect(button?.disabled).toBe(false);
      return button!;
    });
    fireEvent.click(previewButton);
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(3));
    const bodies = fetch.mock.calls.filter(([url]) => url === '/api/image-edit')
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(bodies.map(body => body.quoteOnly === true ? 'preview' : body.quoteToken ? 'confirm' : 'other'))
      .toEqual(['preview', 'confirm', 'preview']);
  });

  it('sends the exact project and source version from the selected image', async () => {
    const { container, fetch } = renderSelectedImage({ ...image, assetVersionId: 'version-a' });
    await submitUpscale(container);
    const request = await waitFor(() => {
      const call = fetch.mock.calls.find(([url]) => url === '/api/image-edit');
      expect(call).toBeTruthy();
      return call!;
    });
    expect(request[1]?.method).toBe('POST');
    const body = JSON.parse((request[1] as RequestInit).body as string);
    expect(body).toMatchObject({ action: 'upscale', imageUrl: '/original.png',
      projectId: 'project-a', assetParentVersionIds: ['version-a'] });
  });

  it('does not submit a document image without a server asset version', async () => {
    const { container, fetch, onImagesChange } = renderSelectedImage(image);
    await submitUpscale(container);
    expect(fetch.mock.calls.filter(([url]) => url === '/api/image-edit')).toHaveLength(0);
    expect(onImagesChange).not.toHaveBeenCalled();
  });
});
