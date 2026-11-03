// @vitest-environment jsdom
import { beforeEach as beforeBrowserApis, afterEach as afterBrowserApis } from 'vitest';
import { cleanup as cleanupBrowserApiReact } from '@testing-library/react';
import { installJsdomMediaQueries, runJsdomFixtureCleanup } from '../helpers/jsdom-browser-apis';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const workspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

async function assertInlineVideoPointerRouting(): Promise<void> {
  const previousWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const previousCapture = new Map<string, PropertyDescriptor | undefined>();
  const owners = new Map<number, Element>();
  const captureCalls: Array<{ action: 'set' | 'release'; id: number; owner: Element }> = [];
  const captureMethods = {
    setPointerCapture(this: Element, id: number): void {
      expect(this.matches('[data-canvas-interaction-surface]')).toBe(true);
      expect(Number.isInteger(id)).toBe(true);
      owners.set(id, this);
      captureCalls.push({ action: 'set', id, owner: this });
    },
    hasPointerCapture(this: Element, id: number): boolean { return owners.get(id) === this; },
    releasePointerCapture(this: Element, id: number): void {
      expect(owners.get(id)).toBe(this);
      owners.delete(id);
      captureCalls.push({ action: 'release', id, owner: this });
    },
  };
  const restoreMedia = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false });
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => { values.set(key, value); },
    removeItem: (key: string): void => { values.delete(key); },
    clear: (): void => { values.clear(); },
  });
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('fetch', async (): Promise<Response> => new Response('{}'));
  try {
    for (const [name, value] of Object.entries(captureMethods)) {
      previousCapture.set(name, Object.getOwnPropertyDescriptor(Element.prototype, name));
      Object.defineProperty(Element.prototype, name, { configurable: true, writable: true, value });
    }
    const { InfiniteCanvas } = await import('@/components/infinite-canvas');
    const settle = async (): Promise<void> => {
      await act(async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); });
    };
    const scenarios: ReadonlyArray<{
      width: number; pointerType: 'mouse' | 'pen' | 'touch'; delegatesToCanvas: boolean;
    }> = [
      { width: 1024, pointerType: 'mouse', delegatesToCanvas: false },
      { width: 1024, pointerType: 'pen', delegatesToCanvas: false },
      { width: 1024, pointerType: 'touch', delegatesToCanvas: true },
      { width: 390, pointerType: 'touch', delegatesToCanvas: true },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: scenario.width });
      fireEvent(window, new Event('resize'));
      const changed = vi.fn(), saved = vi.fn(), previewed = vi.fn();
      const images = [{ id: 'pointer-video', placementId: 'pointer-video', assetVersionId: 'pointer-version',
        url: '/api/serve-upload/exports/pointer-poster.png', videoThumbnailUrl: '/api/serve-upload/exports/pointer-poster.png',
        videoUrl: '/api/serve-upload/exports/pointer-clip.mp4', mediaType: 'video' as const,
        x: 40, y: 120, width: 256, height: 192, rotation: 0, zIndex: 1, createdAt: 1 }];
      const originalImages = JSON.stringify(images);
      const canvas: ReactElement = createElement(InfiniteCanvas, {
        images, onImagesChange: changed, onForceSave: saved, selectedImage: null,
        onSelectImage: (): void => {}, onPreviewImage: previewed,
        onGenerateVariation: (): void => {}, onExtractKeywords: (): void => {},
        onFusion: (): void => {}, onAddImages: (): void => {},
        projectId: 'pointer-contract-isolated',
        onRequestTaskPoll: async (): Promise<Response> => new Response('{}'),
      });
      const view = render(canvas);
      try {
        await settle();
        const surface = view.container.querySelector('[data-canvas-interaction-surface]');
        const overlay = view.container.querySelector('[data-canvas-image-id="pointer-video"] [class*="group/play"]');
        expect(surface).not.toBeNull();
        expect(overlay).not.toBeNull();
        if (!surface || !overlay) throw new Error('POINTER_VIDEO_PUBLIC_SURFACE_MISSING');
        const inlineVideo = (): HTMLVideoElement | null => view.container.querySelector('video:not([data-canvas-video-preview])');
        const id = 101 + index;
        const dispatch = (type: 'pointerdown' | 'pointerup' | 'pointercancel' | 'click'): void => {
          const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0,
            buttons: type === 'pointerdown' ? 1 : 0, clientX: 168, clientY: 216 });
          Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: scenario.pointerType },
            isPrimary: { value: true }, width: { value: 1 }, height: { value: 1 } });
          fireEvent(overlay, event);
        };
        const checkDown = (): void => {
          expect(inlineVideo()).toBeNull();
          expect(owners.has(id)).toBe(scenario.delegatesToCanvas);
          if (scenario.delegatesToCanvas) expect(owners.get(id)).toBe(surface);
          expect(captureCalls.every(call => call.id === id && call.owner === surface)).toBe(true);
          expect(changed).not.toHaveBeenCalled();
          expect(saved).not.toHaveBeenCalled();
          expect(previewed).not.toHaveBeenCalled();
        };
        expect(owners.size).toBe(0);
        captureCalls.length = 0;
        dispatch('pointerdown');
        await settle();
        checkDown();
        dispatch('pointercancel');
        await settle();
        expect(owners.size).toBe(0);
        expect(inlineVideo()).toBeNull();
        expect(changed).not.toHaveBeenCalled();
        expect(saved).not.toHaveBeenCalled();
        if (scenario.delegatesToCanvas) expect(captureCalls.some(call => call.action === 'release' && call.id === id)).toBe(true);
        else expect(captureCalls).toEqual([]);

        // A cancelled gesture must allow a fresh tap using the same pointer identity.
        captureCalls.length = 0;
        dispatch('pointerdown');
        await settle();
        checkDown();
        dispatch('pointerup');
        await settle();
        expect(owners.size).toBe(0);
        expect(inlineVideo()).toBeNull();
        if (scenario.delegatesToCanvas) expect(captureCalls.some(call => call.action === 'release' && call.id === id)).toBe(true);
        else expect(captureCalls).toEqual([]);
        dispatch('click');
        await settle();
        const playing = inlineVideo();
        expect(playing).not.toBeNull();
        expect(playing?.src).toBe(new URL('/api/serve-upload/exports/pointer-clip.mp4', window.location.href).href);
        expect(playing?.autoplay).toBe(true);
        expect(changed).not.toHaveBeenCalled();
        expect(saved).not.toHaveBeenCalled();
        expect(previewed).not.toHaveBeenCalled();
        expect(JSON.stringify(images)).toBe(originalImages);
      } finally {
        view.unmount();
        await settle();
      }
      expect(owners.size).toBe(0);
    }
  } finally {
    runJsdomFixtureCleanup([
      cleanup,
      ...[...previousCapture].map(([name, previous]): (() => void) => (): void => {
        if (previous) Object.defineProperty(Element.prototype, name, previous);
        else if (!Reflect.deleteProperty(Element.prototype, name)) throw new Error('POINTER_CAPTURE_FIXTURE_RESTORE_FAILED');
      }),
      (): void => {
        if (previousWidth) Object.defineProperty(window, 'innerWidth', previousWidth);
        else if (!Reflect.deleteProperty(window, 'innerWidth')) throw new Error('POINTER_WIDTH_FIXTURE_RESTORE_FAILED');
      },
      restoreMedia,
      (): void => { vi.restoreAllMocks(); },
      (): void => { vi.unstubAllGlobals(); },
    ]);
  }
}

describe('video terminal state contract', () => {
  it('keeps failed video placeholders instead of deleting them from the canvas', () => {
    const handlerStart = workspaceSource.indexOf('const handleVideoGenerate = useCallback');
    const handlerEnd = workspaceSource.indexOf('const handleAnalyzeImage', handlerStart);
    const handlerSource = workspaceSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('const markVideoPlaceholderFailed');
    expect((handlerSource.match(/markVideoPlaceholderFailed\(/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(handlerSource).not.toContain('setImages(prev => prev.filter(img => img.id !== phId))');
  });

  it('stores a retry payload when it creates a video processing placeholder', () => {
    const handlerStart = workspaceSource.indexOf('const handleVideoGenerate = useCallback');
    const handlerEnd = workspaceSource.indexOf('const handleAnalyzeImage', handlerStart);
    const handlerSource = workspaceSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('retryPayload: createVideoRetryPayload(params)');
  });

  it('renders terminal failures with retry and remove actions instead of progress controls', () => {
    expect(canvasSource).toContain('isTerminalProcessingFailure(image.processing)');
    expect(canvasSource).toContain('onRetryProcessing?.(image)');
    expect(canvasSource).toContain('重新生成');
    expect(canvasSource).toContain('移除');
  });

  it('uses the completed-video media normalizer and never treats the video URL as a poster', () => {
    const handlerStart = workspaceSource.indexOf('const handleVideoGenerate = useCallback');
    const handlerEnd = workspaceSource.indexOf('const handleAnalyzeImage', handlerStart);
    const handlerSource = workspaceSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('buildCompletedVideoCanvasMedia');
    expect(handlerSource).not.toContain('const rawThumbnailUrl = pollData.thumbnailUrl || pollData.url');
  });

  it('normalizes resumed completed videos with their provider thumbnail', () => {
    const resumedStart = workspaceSource.indexOf('const pending = images.filter');
    const resumedSource = workspaceSource.slice(resumedStart, resumedStart + 8_000);

    expect(resumedSource).toContain('data.videoThumbnailUrl');
    expect(resumedSource).toContain('buildCompletedVideoCanvasMedia');
  });

  it('renders video posters and keeps posterless completed videos visibly playable', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); },
      clear: (): void => { values.clear(); },
    });
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    vi.stubGlobal('fetch', async (): Promise<Response> => new Response('{}'));
    try {
      const { InfiniteCanvas } = await import('@/components/infinite-canvas');
      const videoUrl = '/api/serve-upload/exports/terminal-clip.mp4';
      const posterUrl = '/api/serve-upload/exports/terminal-poster.png';
      const canvas = (withPoster: boolean): ReactElement => createElement(InfiniteCanvas, {
        images: [{ id: 'terminal-video', placementId: 'terminal-video', assetVersionId: 'terminal-version',
          url: withPoster ? posterUrl : '', videoThumbnailUrl: withPoster ? posterUrl : undefined,
          videoUrl, mediaType: 'video', x: 0, y: 0, width: 256, height: 192,
          rotation: 0, zIndex: 1, createdAt: 1 }],
        onImagesChange: (): void => {}, selectedImage: null, onSelectImage: (): void => {},
        onPreviewImage: (): void => {}, onGenerateVariation: (): void => {},
        onExtractKeywords: (): void => {}, onFusion: (): void => {}, onAddImages: (): void => {},
        projectId: 'terminal-video-project', onRequestTaskPoll: async (): Promise<Response> => new Response('{}'),
      });
      const settle = async (): Promise<void> => {
        await act(async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); });
      };
      const view = render(canvas(true));
      await settle();
      const poster = view.container.querySelector<HTMLImageElement>('img[data-canvas-media-node="terminal-video"]');
      expect(poster).not.toBeNull();
      expect(poster?.src).toBe(new URL(posterUrl, window.location.href).href);
      expect(view.container.querySelector('[data-canvas-video-preview]')).toBeNull();

      view.rerender(canvas(false));
      await settle();
      const preview = view.container.querySelector<HTMLVideoElement>('video[data-canvas-video-preview]');
      expect(preview).not.toBeNull();
      expect(preview?.src).toBe(new URL(videoUrl, window.location.href).href);
      expect(preview?.getAttribute('preload')).toBe('metadata');
      expect(Array.from(view.container.querySelectorAll('img')).map(image => image.src))
        .not.toContain(new URL(videoUrl, window.location.href).href);

      fireEvent.click(view.getByText('VIDEO'));
      await settle();
      const playing = view.container.querySelector<HTMLVideoElement>('video:not([data-canvas-video-preview])');
      expect(playing).not.toBeNull();
      expect(playing?.src).toBe(new URL(videoUrl, window.location.href).href);
      expect(playing?.autoplay).toBe(true);
    } finally {
      cleanup();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('keeps the inline video play control outside the canvas drag pointer capture', async (): Promise<void> => {
    await assertInlineVideoPointerRouting();
  });

  it('passes the unselected canvas item directly into the hover-toolbar download flow', () => {
    const hoverToolbarStart = canvasSource.indexOf('data-toolbar="image-hover-toolbar"');
    const hoverToolbarSource = canvasSource.slice(hoverToolbarStart, hoverToolbarStart + 3_000);

    expect(hoverToolbarStart).toBeGreaterThan(-1);
    expect(hoverToolbarSource).toContain(
      'selectImage(image.id); handleOpenDownload(image); hideHoverToolbar();',
    );
    expect(canvasSource).toContain(
      'const handleOpenDownload = useCallback((targetImage?: CanvasImage) => {',
    );
    expect(canvasSource).toContain('const img = targetImage ?? getActiveImageData();');
  });

  it('clears a failed optional poster so rendering falls through to the video preview', () => {
    expect(canvasSource).toContain("action === 'fallback-video'");
    expect(canvasSource).toContain('clearFailedCanvasVideoPoster(candidate)');
  });
});

// Fixture APIs only; original assertions, timeouts and business inputs stay unchanged.
let restoreBrowserApis: (() => void) | undefined;
beforeBrowserApis((): void => {
  restoreBrowserApis = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false });
});
afterBrowserApis((): void => {
  runJsdomFixtureCleanup([
    cleanupBrowserApiReact,
    (): void => { const restore = restoreBrowserApis; restoreBrowserApis = undefined; restore?.(); },
  ]);
});
