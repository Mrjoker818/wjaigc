// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanvasSharePublicDocument } from '@/lib/canvas-share/types';

const routeToken = 'A'.repeat(43);

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: routeToken }),
}));

import { metadata } from '@/app/shared/canvas/[token]/page';
import { SharedCanvasClient } from '@/app/shared/canvas/[token]/shared-canvas-client';
import {
  SharedCanvasViewer,
  resolveCanvasShareAssetPath,
} from '@/components/canvas-share/shared-canvas-viewer';

const itemRef = `csr_${'B'.repeat(43)}`;
const secondItemRef = `csr_${'C'.repeat(43)}`;

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
    ['root-relative URL', `/media/${itemRef}`],
    ['non-media path', `files/${itemRef}`],
    ['query suffix', `media/${itemRef}?source=private`],
  ])('rejects %s', (_name, candidate) => {
    expect(resolveCanvasShareAssetPath(base, candidate, 'media')).toBeNull();
  });
});

describe('shared canvas viewer', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', MouseEvent);
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
  });

  afterEach(() => {
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

  it('shows download actions only when the public policy includes controlled download paths', () => {
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

    const download = screen.getByRole('link', { name: '下载当前内容' });
    expect(download.getAttribute('href')).toBe(
      `/api/public/canvas-shares/${routeToken}/media/${itemRef}/download`,
    );
  });
});
