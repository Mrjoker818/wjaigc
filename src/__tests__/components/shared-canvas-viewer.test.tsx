// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanvasSharePublicDocument } from '@/lib/canvas-share/types';

const routeToken = 'A'.repeat(43);
const nextRouteToken = 'N'.repeat(43);
let activeRouteToken = routeToken;

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: activeRouteToken }),
}));

import { metadata } from '@/app/shared/canvas/[token]/page';
import { SharedCanvasClient } from '@/app/shared/canvas/[token]/shared-canvas-client';
import {
  SharedCanvasViewer,
  resolveCanvasShareAssetPath,
} from '@/components/canvas-share/shared-canvas-viewer';

const itemRef = `csr_${'B'.repeat(43)}`;
const secondItemRef = `csr_${'C'.repeat(43)}`;
const nextItemRef = `csr_${'D'.repeat(43)}`;

const publicDocument: CanvasSharePublicDocument = {
  title: '客户审阅画布',
  revisionLabel: '修订 7',
  createdAt: '2026-09-19T00:00:00.000Z',
  allowDownload: false,
  viewport: { offsetX: 12, offsetY: 34, zoom: 1.25 },
  items: [{
    itemRef,
    entityType: 'canvas-image',
    assetKind: 'image',
    transform: { x: 10, y: 20, width: 640, height: 480, rotation: 0, zIndex: 2 },
    display: { label: '主视觉', altText: '蓝色产品海报' },
    mimeType: 'image/png',
    width: 640,
    height: 480,
    mediaPath: `media/${itemRef}`,
  }],
};

const nextPublicDocument: CanvasSharePublicDocument = {
  ...publicDocument,
  title: '新链接审阅画布',
  revisionLabel: '修订 8',
  items: [{
    ...publicDocument.items[0],
    itemRef: nextItemRef,
    mediaPath: `media/${nextItemRef}`,
  }],
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(
  body: unknown,
  init: { status?: number; requestId?: string } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init.requestId ? { 'X-Request-Id': init.requestId } : {}),
    },
  });
}

function renderViewer(document: CanvasSharePublicDocument = publicDocument) {
  return render(
    <SharedCanvasViewer
      document={document}
      metadataEndpointBase={`/api/public/canvas-shares/${routeToken}/`}
    />,
  );
}

describe('shared canvas public page metadata', () => {
  it('keeps the anonymous viewer out of search indexes', () => {
    expect(metadata.robots).toEqual(expect.objectContaining({
      index: false,
      follow: false,
      noarchive: true,
    }));
  });
});

describe('shared canvas client', () => {
  beforeEach(() => {
    activeRouteToken = routeToken;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows a loading skeleton before rendering a valid public document and only performs one metadata GET', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchPromise = new Promise<Response>(resolve => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => fetchPromise);
    vi.stubGlobal('fetch', fetchMock);
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    render(<SharedCanvasClient />);

    expect(screen.getByText('正在加载分享…')).toBeTruthy();
    expect(screen.queryByText(publicDocument.title)).toBeNull();

    resolveFetch(jsonResponse(publicDocument));
    expect(await screen.findByText(publicDocument.title)).toBeTruthy();
    expect(screen.getByText(/修订 7/u)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/canvas-shares/${routeToken}`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it.each(['随机链接', '已撤销', '已过期', '功能关闭'])(
    'normalizes %s to the same invalid state',
    async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        code: 'CANVAS_SHARE_NOT_FOUND',
        message: '画布分享不存在或已失效',
        requestId: 'req_0123456789abcdef',
      }, { status: 404 })));

      render(<SharedCanvasClient />);

      expect(await screen.findByText('分享不存在或已失效')).toBeTruthy();
      expect(document.body.textContent).not.toContain(routeToken);
    },
  );

  it('shows a safe network error and only accepts a bounded server request identifier', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      message: `private failure ${routeToken}`,
      requestId: routeToken,
    }, { status: 503, requestId: 'req_0123456789abcdef' })));

    render(<SharedCanvasClient />);

    expect(await screen.findByText('暂时无法加载分享，请稍后重试')).toBeTruthy();
    expect(screen.getByText('请求标识：req_0123456789abcdef')).toBeTruthy();
    expect(document.body.textContent).not.toContain(routeToken);
    expect(document.body.textContent).not.toContain('private failure');
  });

  it('masks a ready document on the first token-switch commit and never combines it with the new endpoint', async () => {
    const nextResponse = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const endpoint = String(input);
      if (endpoint.endsWith(routeToken)) return Promise.resolve(jsonResponse(publicDocument));
      if (endpoint.endsWith(nextRouteToken)) return nextResponse.promise;
      throw new Error(`unexpected endpoint: ${endpoint}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const commits: Array<{ text: string; mediaSource: string | null }> = [];
    let mountedContainer: HTMLElement | null = null;
    const captureCommit = (): void => {
      commits.push({
        text: mountedContainer?.textContent ?? '',
        mediaSource: mountedContainer?.querySelector('img')?.getAttribute('src') ?? null,
      });
    };
    const view = render(
      <Profiler id="shared-client" onRender={captureCommit}>
        <SharedCanvasClient />
      </Profiler>,
    );
    mountedContainer = view.container;
    expect(await screen.findByText(publicDocument.title)).toBeTruthy();
    commits.length = 0;

    activeRouteToken = nextRouteToken;
    view.rerender(
      <Profiler id="shared-client" onRender={captureCommit}>
        <SharedCanvasClient />
      </Profiler>,
    );

    expect(commits[0]?.text).toContain('正在加载分享…');
    expect(commits[0]?.text).not.toContain(publicDocument.title);
    expect(commits.every(commit => commit.mediaSource === null)).toBe(true);
    expect(view.container.innerHTML).not.toContain(itemRef);

    nextResponse.resolve(jsonResponse(nextPublicDocument));
    expect(await screen.findByText(nextPublicDocument.title)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['late success', (request: ReturnType<typeof deferred<Response>>) => request.resolve(jsonResponse(publicDocument))],
    ['late error', (request: ReturnType<typeof deferred<Response>>) => request.reject(new Error('late old failure'))],
  ])('ignores a %s from the previous token while the new request is pending', async (_name, settleOld) => {
    const oldRequest = deferred<Response>();
    const nextRequest = deferred<Response>();
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return signals.length === 1 ? oldRequest.promise : nextRequest.promise;
    }));
    const view = render(<SharedCanvasClient />);

    activeRouteToken = nextRouteToken;
    view.rerender(<SharedCanvasClient />);
    expect(screen.getByText('正在加载分享…')).toBeTruthy();
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      settleOld(oldRequest);
      await Promise.resolve();
    });
    expect(screen.getByText('正在加载分享…')).toBeTruthy();
    expect(screen.queryByText(publicDocument.title)).toBeNull();
    expect(screen.queryByText('暂时无法加载分享，请稍后重试')).toBeNull();

    nextRequest.resolve(jsonResponse(nextPublicDocument));
    expect(await screen.findByText(nextPublicDocument.title)).toBeTruthy();
  });

  it('keeps AbortError silent without exposing an error or stale document', async () => {
    const request = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => request.promise));
    render(<SharedCanvasClient />);

    await act(async () => {
      request.reject(new DOMException('aborted', 'AbortError'));
      await Promise.resolve();
    });

    expect(screen.getByText('正在加载分享…')).toBeTruthy();
    expect(screen.queryByText('暂时无法加载分享，请稍后重试')).toBeNull();
    expect(document.body.textContent).not.toContain(routeToken);
  });
});

describe('shared canvas controlled public paths', () => {
  const base = `/api/public/canvas-shares/${routeToken}/`;

  it('resolves tokenless media and download paths against the trailing-slash metadata base', () => {
    expect(resolveCanvasShareAssetPath(base, `media/${itemRef}`, 'media')).toBe(
      `${base}media/${itemRef}`,
    );
    expect(resolveCanvasShareAssetPath(
      base,
      `media/${itemRef}/download`,
      'download',
    )).toBe(`${base}media/${itemRef}/download`);
  });

  it.each([
    ['absolute URL', `https://attacker.example/media/${itemRef}`],
    ['scheme-relative URL', `//attacker.example/media/${itemRef}`],
    ['parent traversal', `media/../${itemRef}`],
    ['encoded dot traversal', `media/%2e%2e/${itemRef}`],
    ['double-encoded dot traversal', `media/%252e%252e/${itemRef}`],
    ['encoded slash', `media%2f${itemRef}`],
    ['double-encoded slash', `media%252f${itemRef}`],
    ['backslash', `media\\${itemRef}`],
    ['root-relative URL', `/media/${itemRef}`],
    ['non-media path', `files/${itemRef}`],
    ['query suffix', `media/${itemRef}?source=private`],
    ['hash suffix', `media/${itemRef}#private`],
  ])('rejects %s', (_name, candidate) => {
    expect(resolveCanvasShareAssetPath(base, candidate, 'media')).toBeNull();
  });

  it('rejects a base without its trailing slash and media/download type mismatches', () => {
    expect(resolveCanvasShareAssetPath(base.slice(0, -1), `media/${itemRef}`, 'media')).toBeNull();
    expect(resolveCanvasShareAssetPath(base, `media/${itemRef}/download`, 'media')).toBeNull();
    expect(resolveCanvasShareAssetPath(base, `media/${itemRef}`, 'download')).toBeNull();
  });
});

describe('shared canvas viewer', () => {
  beforeEach(() => {
    class TestPointerEvent extends MouseEvent {
      readonly pointerId: number;

      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
    delete (document as Partial<Document>).exitFullscreen;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts from the server viewport and keeps pan, zoom, fit, and fullscreen local', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const { container } = renderViewer();
    const viewport = screen.getByRole('region', { name: '共享画布视口' });
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      value: () => ({
        x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800,
        width: 1000, height: 800, toJSON: () => ({}),
      }),
    });
    const viewerRoot = container.querySelector('[data-shared-canvas-viewer]') as HTMLElement;
    Object.defineProperty(viewerRoot, 'requestFullscreen', { value: requestFullscreen });

    const content = screen.getByTestId('shared-canvas-content');
    expect(content.getAttribute('data-offset-x')).toBe('12');
    expect(content.getAttribute('data-offset-y')).toBe('34');
    expect(screen.getByText('125%')).toBeTruthy();
    expect(viewport.getAttribute('data-reduced-motion')).toBe('true');

    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 140, clientY: 130 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 140, clientY: 130 });
    expect(content.getAttribute('data-offset-x')).toBe('52');
    expect(content.getAttribute('data-offset-y')).toBe('64');

    fireEvent.click(screen.getByRole('button', { name: '放大画布' }));
    expect(screen.getByText('150%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '适应画面' }));
    expect(screen.queryByText('150%')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '进入全屏' }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /编辑|删除|生成|保存/ })).toBeNull();
  });

  it('supports keyboard zoom without exposing an editing toolbar', () => {
    renderViewer();
    const viewport = screen.getByRole('region', { name: '共享画布视口' });

    fireEvent.keyDown(viewport, { key: '+' });
    expect(screen.getByText('150%')).toBeTruthy();
    fireEvent.keyDown(viewport, { key: '-' });
    expect(screen.getByText('125%')).toBeTruthy();
    expect(document.querySelector('[data-toolbar="shared-canvas"]')).toBeTruthy();
    expect(document.querySelector('[data-toolbar="image-actions"]')).toBeNull();
  });

  it('does not let canvas pointer capture intercept toolbar controls', () => {
    renderViewer();
    const viewport = screen.getByRole('region', { name: '共享画布视口' });
    const setPointerCapture = vi.fn();
    Object.defineProperty(viewport, 'setPointerCapture', { value: setPointerCapture });
    const zoomIn = screen.getByRole('button', { name: '放大画布' });

    fireEvent.pointerDown(zoomIn, { pointerId: 7, clientX: 20, clientY: 20 });

    expect(setPointerCapture).not.toHaveBeenCalled();
    fireEvent.click(zoomIn);
    expect(screen.getByText('150%')).toBeTruthy();
  });

  it('uses viewport-local anchors for offset double-click zoom', () => {
    renderViewer();
    const viewport = screen.getByRole('region', { name: '共享画布视口' });
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      value: () => ({
        x: 200, y: 100, left: 200, top: 100, right: 1200, bottom: 900,
        width: 1000, height: 800, toJSON: () => ({}),
      }),
    });

    fireEvent.doubleClick(viewport, { clientX: 700, clientY: 500 });

    const content = screen.getByTestId('shared-canvas-content');
    expect(Number(content.getAttribute('data-scale'))).toBeCloseTo(1.5, 8);
    expect(Number(content.getAttribute('data-offset-x'))).toBeCloseTo(-85.6, 8);
    expect(Number(content.getAttribute('data-offset-y'))).toBeCloseTo(-39.2, 8);
  });

  it('uses the viewport-local pinch midpoint when the viewport is offset', () => {
    renderViewer();
    const viewport = screen.getByRole('region', { name: '共享画布视口' });
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      value: () => ({
        x: 200, y: 100, left: 200, top: 100, right: 1200, bottom: 900,
        width: 1000, height: 800, toJSON: () => ({}),
      }),
    });

    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 300, clientY: 200 });
    fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 500, clientY: 200 });
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 600, clientY: 200 });

    const content = screen.getByTestId('shared-canvas-content');
    expect(Number(content.getAttribute('data-scale'))).toBeCloseTo(1.875, 8);
    expect(Number(content.getAttribute('data-offset-x'))).toBeCloseTo(-32, 8);
    expect(Number(content.getAttribute('data-offset-y'))).toBeCloseTo(1, 8);
  });

  it('fits the complete rotated AABB inside viewport padding', () => {
    renderViewer({
      ...publicDocument,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      items: [{
        ...publicDocument.items[0],
        transform: { x: -100, y: -50, width: 200, height: 100, rotation: 45, zIndex: 1 },
      }],
    });
    const viewport = screen.getByRole('region', { name: '共享画布视口' });
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      value: () => ({
        x: 40, y: 80, left: 40, top: 80, right: 840, bottom: 680,
        width: 800, height: 600, toJSON: () => ({}),
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: '适应画面' }));

    const content = screen.getByTestId('shared-canvas-content');
    const scaleAttribute = content.getAttribute('data-scale');
    expect(scaleAttribute).not.toBeNull();
    const scale = Number(scaleAttribute);
    const offsetX = Number(content.getAttribute('data-offset-x'));
    const offsetY = Number(content.getAttribute('data-offset-y'));
    const extent = (Math.abs(Math.cos(Math.PI / 4)) * 100)
      + (Math.abs(Math.sin(Math.PI / 4)) * 50);
    expect(offsetX - extent * scale).toBeGreaterThanOrEqual(48 - 0.001);
    expect(offsetX + extent * scale).toBeLessThanOrEqual(800 - 48 + 0.001);
    expect(offsetY - extent * scale).toBeGreaterThanOrEqual(48 - 0.001);
    expect(offsetY + extent * scale).toBeLessThanOrEqual(600 - 48 + 0.001);
  });

  it('keeps fit values finite for normalized rotations and zero or negative dimensions', () => {
    renderViewer({
      ...publicDocument,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      items: [{
        ...publicDocument.items[0],
        transform: { x: -25, y: 10, width: -200, height: 0, rotation: 405, zIndex: 1 },
      }],
    });
    const viewport = screen.getByRole('region', { name: '共享画布视口' });
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      value: () => ({
        x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 480,
        width: 640, height: 480, toJSON: () => ({}),
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: '适应画面' }));

    const content = screen.getByTestId('shared-canvas-content');
    expect(content.getAttribute('data-scale')).not.toBeNull();
    expect(Number.isFinite(Number(content.getAttribute('data-scale')))).toBe(true);
    expect(Number.isFinite(Number(content.getAttribute('data-offset-x')))).toBe(true);
    expect(Number.isFinite(Number(content.getAttribute('data-offset-y')))).toBe(true);
  });

  it('does not route toolbar double-click or wheel events into canvas zoom', () => {
    renderViewer();
    const zoomIn = screen.getByRole('button', { name: '放大画布' });

    fireEvent.click(zoomIn);
    fireEvent.click(zoomIn);
    fireEvent.doubleClick(zoomIn, { clientX: 50, clientY: 50 });
    expect(screen.getByLabelText('当前比例').textContent).toBe('180%');

    fireEvent.wheel(zoomIn, { deltaY: -100, clientX: 50, clientY: 50 });
    expect(screen.getByLabelText('当前比例').textContent).toBe('180%');
  });

  it('does not route media double-click or wheel events into canvas zoom', () => {
    renderViewer();
    const media = screen.getByRole('button', { name: '预览主视觉' });

    fireEvent.wheel(media, { deltaY: -100, clientX: 50, clientY: 50 });
    fireEvent.doubleClick(media, { clientX: 50, clientY: 50 });

    expect(screen.getByLabelText('当前比例').textContent).toBe('125%');
  });

  it('hides fullscreen when the browser does not support the complete API', () => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
    delete (document as Partial<Document>).exitFullscreen;

    renderViewer();

    expect(screen.queryByRole('button', { name: '进入全屏' })).toBeNull();
  });

  it('announces a localized fullscreen rejection instead of failing silently', async () => {
    const requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'));
    const { container } = renderViewer();
    const viewerRoot = container.querySelector('[data-shared-canvas-viewer]') as HTMLElement;
    Object.defineProperty(viewerRoot, 'requestFullscreen', { value: requestFullscreen });

    fireEvent.click(screen.getByRole('button', { name: '进入全屏' }));

    expect(await screen.findByText('无法进入全屏，请使用浏览器菜单重试。')).toBeTruthy();
    expect(screen.getByText('无法进入全屏，请使用浏览器菜单重试。').getAttribute('aria-live')).toBe('polite');
  });

  it('keeps a failed media transform slot while other media continues rendering', () => {
    renderViewer({
      ...publicDocument,
      items: [
        publicDocument.items[0],
        {
          ...publicDocument.items[0],
          itemRef: secondItemRef,
          transform: { x: 700, y: 20, width: 320, height: 240, rotation: 3, zIndex: 3 },
          display: { label: '辅助视觉', altText: '辅助海报' },
          mediaPath: `media/${secondItemRef}`,
        },
      ],
    });

    const firstSlot = screen.getByTestId(`shared-media-slot-${itemRef}`);
    expect(firstSlot.getAttribute('style')).toContain('width: 640px');
    fireEvent.error(screen.getByAltText('蓝色产品海报'));

    expect(screen.getByText('此内容暂不可用')).toBeTruthy();
    expect(screen.getByAltText('辅助海报')).toBeTruthy();
    expect(screen.getByTestId(`shared-media-slot-${itemRef}`)).toBe(firstSlot);
  });

  it('opens an accessible image preview, closes it with Escape, and restores focus', async () => {
    renderViewer();
    const trigger = screen.getByRole('button', { name: '预览主视觉' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: '媒体预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭预览' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab from the last preview control to the first and Shift+Tab back to the last', async () => {
    renderViewer({
      ...publicDocument,
      allowDownload: true,
      items: [{
        ...publicDocument.items[0],
        downloadPath: `media/${itemRef}/download`,
      }],
    });
    const trigger = screen.getByRole('button', { name: '预览主视觉' });
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: '关闭预览' });
    const download = screen.getByRole('link', { name: '下载预览内容' });

    expect(download.getAttribute('download')).toBe('');
    expect(screen.queryByRole('button', { name: '关闭媒体预览背景' })).toBeNull();
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    await waitFor(() => expect(document.activeElement).toBe(download));

    download.focus();
    fireEvent.keyDown(download, { key: 'Tab', shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(close));
  });

  it('prevents a media long-press context menu without exposing editor actions', () => {
    renderViewer();
    const media = screen.getByRole('button', { name: '预览主视觉' });
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    expect(media.dispatchEvent(contextMenu)).toBe(false);
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.querySelector('[data-toolbar="image-actions"]')).toBeNull();
  });

  it('closes an open preview on browser back without leaving the shared page', async () => {
    renderViewer();
    fireEvent.click(screen.getByRole('button', { name: '预览主视觉' }));
    expect(screen.getByRole('dialog', { name: '媒体预览' })).toBeTruthy();

    fireEvent.popState(window);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull());
    expect(screen.getByText(publicDocument.title)).toBeTruthy();
  });

  it('removes the preview history entry after preview media fails before opening another preview', async () => {
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    renderViewer({
      ...publicDocument,
      items: [
        publicDocument.items[0],
        {
          ...publicDocument.items[0],
          itemRef: secondItemRef,
          transform: { x: 700, y: 20, width: 320, height: 240, rotation: 0, zIndex: 3 },
          display: { label: '辅助视觉', altText: '辅助海报' },
          mediaPath: `media/${secondItemRef}`,
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: '预览主视觉' }));
    const firstDialog = screen.getByRole('dialog', { name: '媒体预览' });
    fireEvent.error(firstDialog.querySelector('img')!);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull());
    expect(back).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '预览辅助视觉' }));
    expect(screen.getByRole('dialog', { name: '媒体预览' })).toBeTruthy();
    expect(pushState).toHaveBeenCalledTimes(2);
  });

  it('renders video inline, muted, without audible autoplay', () => {
    renderViewer({
      ...publicDocument,
      items: [{
        ...publicDocument.items[0],
        entityType: 'canvas-video',
        assetKind: 'video',
        mimeType: 'video/mp4',
        display: { label: '动态提案', altText: '动态提案视频' },
      }],
    });

    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.playsInline).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.autoplay).toBe(false);
  });

  it('shows the global download only after an explicit media selection', async () => {
    const { rerender } = renderViewer();
    expect(screen.queryByRole('link', { name: '下载当前内容' })).toBeNull();

    const downloadable = {
      ...publicDocument,
      allowDownload: true,
      items: [{
        ...publicDocument.items[0],
        downloadPath: `media/${itemRef}/download`,
      }],
    };
    rerender(
      <SharedCanvasViewer
        document={downloadable}
        metadataEndpointBase={`/api/public/canvas-shares/${routeToken}/`}
      />,
    );

    expect(screen.queryByRole('link', { name: '下载当前内容' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '预览主视觉' }));
    expect(screen.getByRole('link', { name: '下载预览内容' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull();
    });
    const download = screen.getByRole('link', { name: '下载当前内容' });
    expect(download.getAttribute('href')).toBe(
      `/api/public/canvas-shares/${routeToken}/media/${itemRef}/download`,
    );
    expect(download.getAttribute('download')).toBe('');
  });
});
