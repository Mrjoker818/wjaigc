// @vitest-environment jsdom
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

  it('keeps the inline video play control outside the canvas drag pointer capture', () => {
    const overlayStart = canvasSource.indexOf('group/play bg-black');
    const overlaySource = canvasSource.slice(overlayStart, overlayStart + 900);

    expect(overlayStart).toBeGreaterThan(-1);
    expect(overlaySource).toContain('onPointerDown={(e) => e.stopPropagation()}');
    expect(overlaySource).toContain('setPlayingVideoId(image.id)');
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
