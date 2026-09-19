'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Eye, ImageOff } from 'lucide-react';

import type {
  CanvasSharePublicDocument,
  CanvasSharePublicItem,
  CanvasShareViewport,
} from '@/lib/canvas-share/types';
import { SharedCanvasToolbar } from './shared-canvas-toolbar';
import { SharedCanvasMedia, SharedMediaPreview } from './shared-media-preview';

const PUBLIC_METADATA_BASE_PATTERN = /^\/api\/public\/canvas-shares\/[A-Za-z0-9_-]{43,128}\/$/u;
const PUBLIC_MEDIA_PATH_PATTERN = /^media\/csr_[A-Za-z0-9_-]{43}$/u;
const PUBLIC_DOWNLOAD_PATH_PATTERN = /^media\/csr_[A-Za-z0-9_-]{43}\/download$/u;
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.2;
const FIT_PADDING = 48;

type PublicAssetPathKind = 'media' | 'download';

interface ResolvedSharedItem {
  item: CanvasSharePublicItem;
  mediaUrl: string | null;
  downloadUrl: string | null;
}

interface Point {
  x: number;
  y: number;
}

interface GestureState {
  centroid: Point;
  distance: number | null;
}

export interface SharedCanvasViewerProps {
  document: CanvasSharePublicDocument;
  metadataEndpointBase: string;
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function pointerId(event: ReactPointerEvent<HTMLElement>): number {
  return Number.isFinite(event.pointerId) ? event.pointerId : 1;
}

function gestureState(points: readonly Point[]): GestureState | null {
  if (points.length === 0) return null;
  const centroid = points.reduce((sum, point) => ({
    x: sum.x + point.x / points.length,
    y: sum.y + point.y / points.length,
  }), { x: 0, y: 0 });
  if (points.length < 2) return { centroid, distance: null };
  return {
    centroid,
    distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
  };
}

export function resolveCanvasShareAssetPath(
  metadataEndpointBase: string,
  candidate: string,
  kind: PublicAssetPathKind,
): string | null {
  if (!PUBLIC_METADATA_BASE_PATTERN.test(metadataEndpointBase)) return null;
  const pattern = kind === 'media' ? PUBLIC_MEDIA_PATH_PATTERN : PUBLIC_DOWNLOAD_PATH_PATTERN;
  if (!pattern.test(candidate)) return null;
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  try {
    const base = new URL(metadataEndpointBase, origin);
    const resolved = new URL(candidate, base);
    const expectedPath = `${base.pathname}${candidate}`;
    if (resolved.origin !== base.origin || resolved.pathname !== expectedPath) return null;
    if (resolved.search || resolved.hash) return null;
    return resolved.pathname;
  } catch {
    return null;
  }
}

function mediaLabel(item: CanvasSharePublicItem): string {
  return item.display.label ?? item.display.altText ?? '共享画布内容';
}

export function SharedCanvasViewer({
  document: shareDocument,
  metadataEndpointBase,
}: SharedCanvasViewerProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activePointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<GestureState | null>(null);
  const [viewport, setViewport] = useState<CanvasShareViewport>(() => ({
    offsetX: shareDocument.viewport.offsetX,
    offsetY: shareDocument.viewport.offsetY,
    zoom: clampScale(shareDocument.viewport.zoom),
  }));
  const [failedItems, setFailedItems] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedItemRef, setFocusedItemRef] = useState<string | null>(null);
  const [previewItemRef, setPreviewItemRef] = useState<string | null>(null);
  const [previewTrigger, setPreviewTrigger] = useState<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const resolvedItems = useMemo<ResolvedSharedItem[]>(() => shareDocument.items.map(item => {
    const mediaUrl = resolveCanvasShareAssetPath(metadataEndpointBase, item.mediaPath, 'media');
    const downloadUrl = shareDocument.allowDownload && item.downloadPath
      ? resolveCanvasShareAssetPath(metadataEndpointBase, item.downloadPath, 'download')
      : null;
    return { item, mediaUrl, downloadUrl };
  }), [shareDocument.allowDownload, shareDocument.items, metadataEndpointBase]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setReducedMotion(false);
      return undefined;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const update = (): void => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const markFailed = useCallback((ref: string): void => {
    setFailedItems(current => {
      if (current.has(ref)) return current;
      const next = new Set(current);
      next.add(ref);
      return next;
    });
    setPreviewItemRef(current => current === ref ? null : current);
  }, []);

  const fitCanvas = useCallback((): void => {
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (resolvedItems.length === 0 || rect.width <= 0 || rect.height <= 0) {
      setViewport({ offsetX: 0, offsetY: 0, zoom: 1 });
      return;
    }
    const bounds = resolvedItems.reduce((current, { item }, index) => {
      const right = item.transform.x + item.transform.width;
      const bottom = item.transform.y + item.transform.height;
      if (index === 0) {
        return {
          left: item.transform.x,
          top: item.transform.y,
          right,
          bottom,
        };
      }
      return {
        left: Math.min(current.left, item.transform.x),
        top: Math.min(current.top, item.transform.y),
        right: Math.max(current.right, right),
        bottom: Math.max(current.bottom, bottom),
      };
    }, { left: 0, top: 0, right: 0, bottom: 0 });
    const width = Math.max(1, bounds.right - bounds.left);
    const height = Math.max(1, bounds.bottom - bounds.top);
    const nextScale = clampScale(Math.min(
      Math.max(1, rect.width - FIT_PADDING * 2) / width,
      Math.max(1, rect.height - FIT_PADDING * 2) / height,
    ));
    setViewport({
      zoom: nextScale,
      offsetX: (rect.width - width * nextScale) / 2 - bounds.left * nextScale,
      offsetY: (rect.height - height * nextScale) / 2 - bounds.top * nextScale,
    });
  }, [resolvedItems]);

  const zoomAt = useCallback((factor: number, anchor?: Point): void => {
    const rect = viewportRef.current?.getBoundingClientRect();
    setViewport(current => {
      const nextScale = clampScale(current.zoom * factor);
      const point = anchor ?? {
        x: (rect?.width ?? 0) / 2,
        y: (rect?.height ?? 0) / 2,
      };
      const worldX = (point.x - current.offsetX) / current.zoom;
      const worldY = (point.y - current.offsetY) / current.zoom;
      return {
        zoom: nextScale,
        offsetX: point.x - worldX * nextScale,
        offsetY: point.y - worldY * nextScale,
      };
    });
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if ((event.target as Element).closest('[data-shared-media], [data-toolbar]')) return;
    const id = pointerId(event);
    activePointersRef.current.set(id, { x: event.clientX, y: event.clientY });
    gestureRef.current = gestureState([...activePointersRef.current.values()]);
    setIsPanning(true);
    event.currentTarget.setPointerCapture?.(id);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const id = pointerId(event);
    if (!activePointersRef.current.has(id)) return;
    activePointersRef.current.set(id, { x: event.clientX, y: event.clientY });
    const nextGesture = gestureState([...activePointersRef.current.values()]);
    const previousGesture = gestureRef.current;
    if (!nextGesture || !previousGesture) return;
    setViewport(current => {
      if (nextGesture.distance !== null && previousGesture.distance !== null && previousGesture.distance > 0) {
        const nextScale = clampScale(
          current.zoom * (nextGesture.distance / previousGesture.distance),
        );
        const worldX = (previousGesture.centroid.x - current.offsetX) / current.zoom;
        const worldY = (previousGesture.centroid.y - current.offsetY) / current.zoom;
        return {
          zoom: nextScale,
          offsetX: nextGesture.centroid.x - worldX * nextScale,
          offsetY: nextGesture.centroid.y - worldY * nextScale,
        };
      }
      return {
        ...current,
        offsetX: current.offsetX + nextGesture.centroid.x - previousGesture.centroid.x,
        offsetY: current.offsetY + nextGesture.centroid.y - previousGesture.centroid.y,
      };
    });
    gestureRef.current = nextGesture;
  }, []);

  const releasePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const id = pointerId(event);
    activePointersRef.current.delete(id);
    gestureRef.current = gestureState([...activePointersRef.current.values()]);
    setIsPanning(activePointersRef.current.size > 0);
    event.currentTarget.releasePointerCapture?.(id);
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }, [zoomAt]);

  const toggleFullscreen = useCallback((): void => {
    void (async (): Promise<void> => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen?.();
        else await rootRef.current?.requestFullscreen?.();
      } catch {
        // 浏览器拒绝全屏时保持当前只读视图。
      }
    })();
  }, []);

  const openPreview = useCallback((
    itemRefValue: string,
    trigger: HTMLElement,
  ): void => {
    setPreviewTrigger(trigger);
    setFocusedItemRef(itemRefValue);
    setPreviewItemRef(itemRefValue);
  }, []);

  const preview = resolvedItems.find(({ item }) => item.itemRef === previewItemRef);
  const selectedDownload = resolvedItems.find(({ item }) => item.itemRef === focusedItemRef)
    ?.downloadUrl ?? resolvedItems.find(candidate => candidate.downloadUrl)?.downloadUrl ?? undefined;

  return (
    <div
      ref={rootRef}
      data-shared-canvas-viewer
      className="flex h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground"
    >
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-panel-bg/95 px-3 py-2 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-gold" aria-hidden="true">
            <Eye className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-text-bright sm:text-base">{shareDocument.title}</h1>
            <p className="truncate text-xs text-muted-foreground">{shareDocument.revisionLabel} · 只读分享</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
          无界AI
        </span>
      </header>

      <div
        ref={viewportRef}
        role="region"
        aria-label="共享画布视口"
        tabIndex={0}
        data-reduced-motion={String(reducedMotion)}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-canvas-bg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onWheel={handleWheel}
        onDoubleClick={event => {
          if (event.shiftKey) fitCanvas();
          else zoomAt(ZOOM_STEP, { x: event.clientX, y: event.clientY });
        }}
        onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
          if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomAt(ZOOM_STEP);
          } else if (event.key === '-') {
            event.preventDefault();
            zoomAt(1 / ZOOM_STEP);
          } else if (event.key === '0') {
            event.preventDefault();
            fitCanvas();
          }
        }}
      >
        <div
          data-testid="shared-canvas-content"
          data-offset-x={viewport.offsetX}
          data-offset-y={viewport.offsetY}
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate3d(${viewport.offsetX}px, ${viewport.offsetY}px, 0) scale(${viewport.zoom})`,
            transition: reducedMotion || isPanning ? 'none' : 'transform 160ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {resolvedItems.map(({ item, mediaUrl }) => {
            const failed = failedItems.has(item.itemRef) || mediaUrl === null;
            const focused = focusedItemRef === item.itemRef;
            return (
              <div
                key={item.itemRef}
                data-testid={`shared-media-slot-${item.itemRef}`}
                className="absolute"
                style={{
                  left: item.transform.x,
                  top: item.transform.y,
                  width: item.transform.width,
                  height: item.transform.height,
                  transform: `rotate(${item.transform.rotation}deg)`,
                  transformOrigin: 'center center',
                  zIndex: item.transform.zIndex,
                }}
              >
                {failed ? (
                  <div
                    className="grid h-full w-full place-items-center rounded-lg border border-dashed border-border bg-muted p-4 text-center text-muted-foreground"
                    role="status"
                  >
                    <span className="flex flex-col items-center gap-2 text-sm">
                      <ImageOff className="h-6 w-6" aria-hidden="true" />
                      此内容暂不可用
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-shared-media
                    onClick={event => openPreview(item.itemRef, event.currentTarget)}
                    className={`h-full w-full cursor-pointer overflow-hidden rounded-lg border bg-black outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-bg motion-reduce:transition-none ${focused ? 'border-primary shadow-gold' : 'border-border'}`}
                    aria-label={`预览${mediaLabel(item)}`}
                    aria-pressed={focused}
                  >
                    <SharedCanvasMedia
                      item={item}
                      source={mediaUrl}
                      onError={() => markFailed(item.itemRef)}
                      className="pointer-events-none h-full w-full select-none object-contain"
                    />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {resolvedItems.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center px-5 text-center text-sm text-muted-foreground" role="status">
            此分享暂无可显示内容
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4">
          <SharedCanvasToolbar
            scale={viewport.zoom}
            isFullscreen={isFullscreen}
            downloadPath={selectedDownload}
            onFit={fitCanvas}
            onZoomOut={() => zoomAt(1 / ZOOM_STEP)}
            onZoomIn={() => zoomAt(ZOOM_STEP)}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      </div>

      {preview && preview.mediaUrl && !failedItems.has(preview.item.itemRef) ? (
        <SharedMediaPreview
          item={preview.item}
          source={preview.mediaUrl}
          downloadPath={preview.downloadUrl ?? undefined}
          returnFocusTo={previewTrigger}
          onClose={() => setPreviewItemRef(null)}
          onError={() => markFailed(preview.item.itemRef)}
        />
      ) : null}
    </div>
  );
}
