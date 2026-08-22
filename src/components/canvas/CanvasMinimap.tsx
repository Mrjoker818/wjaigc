'use client';

import { X } from 'lucide-react';
import { useCallback, useMemo } from 'react';

export const CANVAS_MINIMAP_PREFERENCE_KEY = 'wujie.canvas.minimap.open.v1';
export const CANVAS_MINIMAP_WIDTH = 176;
export const CANVAS_MINIMAP_HEIGHT = 124;
export const CANVAS_MINIMAP_PADDING = 10;

export interface CanvasMinimapItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasMinimapViewport {
  width: number;
  height: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface CanvasMinimapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CanvasMinimapProjection {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface CanvasMinimapRect {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasMinimapScene {
  items: CanvasMinimapRect[];
  viewport: CanvasMinimapRect;
  bounds: CanvasMinimapBounds;
  projection: CanvasMinimapProjection;
}

export interface CanvasMinimapProps {
  items: CanvasMinimapItem[];
  viewport: CanvasMinimapViewport;
  theme?: 'dark' | 'mono';
  rightOffset: number;
  onNavigate(point: { x: number; y: number }): void;
  onClose(): void;
}

const finiteOrZero = (value: number): number => (Number.isFinite(value) ? value : 0);

const safeZoom = (zoom: number): number => (
  Number.isFinite(zoom) && zoom >= 0.1 ? zoom : 0.1
);

const safeMultiply = (left: number, right: number): number => {
  const value = left * right;
  if (Number.isFinite(value)) {
    return value;
  }
  return left < 0 === right >= 0 ? -Number.MAX_VALUE : Number.MAX_VALUE;
};

const safeAdd = (left: number, right: number): number => {
  const value = left + right;
  if (Number.isFinite(value)) {
    return value;
  }
  return left < 0 || right < 0 ? -Number.MAX_VALUE : Number.MAX_VALUE;
};

const safeDivide = (left: number, right: number): number => {
  const value = left / right;
  if (Number.isFinite(value)) {
    return value;
  }
  return left < 0 === right >= 0 ? -Number.MAX_VALUE : Number.MAX_VALUE;
};

const isValidRect = (rect: CanvasMinimapRect): boolean => (
  Number.isFinite(rect.x)
  && Number.isFinite(rect.y)
  && Number.isFinite(rect.width)
  && Number.isFinite(rect.height)
  && rect.width > 0
  && rect.height > 0
);

const getWorldViewport = (viewport: CanvasMinimapViewport): CanvasMinimapRect => {
  const zoom = safeZoom(viewport.zoom);
  const width = Math.max(0, finiteOrZero(viewport.width));
  const height = Math.max(0, finiteOrZero(viewport.height));
  const minX = safeDivide(-finiteOrZero(viewport.offsetX), zoom);
  const minY = safeDivide(-finiteOrZero(viewport.offsetY), zoom);
  const worldWidth = safeDivide(width, zoom);
  const worldHeight = safeDivide(height, zoom);

  return {
    x: minX,
    y: minY,
    width: worldWidth,
    height: worldHeight,
  };
};

export const readCanvasMinimapPreference = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(CANVAS_MINIMAP_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const writeCanvasMinimapPreference = (open: boolean): void => {
  try {
    globalThis.localStorage?.setItem(CANVAS_MINIMAP_PREFERENCE_KEY, String(open));
  } catch {
    // Preference persistence is best effort and must not interrupt canvas work.
  }
};

export const isCanvasMinimapAvailable = (viewportWidth: number, occupiedRight: number): boolean => (
  Number.isFinite(viewportWidth)
  && Number.isFinite(occupiedRight)
  && viewportWidth >= 768
  && viewportWidth - Math.max(0, occupiedRight) >= 560
);

export function computeCanvasMinimapBounds(
  items: CanvasMinimapItem[],
  viewport: CanvasMinimapViewport,
): CanvasMinimapBounds {
  const worldViewport = getWorldViewport(viewport);
  let minX = worldViewport.x;
  let minY = worldViewport.y;
  let maxX = safeAdd(worldViewport.x, worldViewport.width);
  let maxY = safeAdd(worldViewport.y, worldViewport.height);

  for (const item of items) {
    if (!isValidRect(item)) {
      continue;
    }

    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, safeAdd(item.x, item.width));
    maxY = Math.max(maxY, safeAdd(item.y, item.height));
  }

  return { minX, minY, maxX, maxY };
}

export function computeCanvasMinimapProjection(
  bounds: CanvasMinimapBounds,
  width = CANVAS_MINIMAP_WIDTH,
  height = CANVAS_MINIMAP_HEIGHT,
  padding = CANVAS_MINIMAP_PADDING,
): CanvasMinimapProjection {
  const minX = finiteOrZero(bounds.minX);
  const minY = finiteOrZero(bounds.minY);
  const maxX = finiteOrZero(bounds.maxX);
  const maxY = finiteOrZero(bounds.maxY);
  const safeWidth = Math.max(1, finiteOrZero(width));
  const safeHeight = Math.max(1, finiteOrZero(height));
  const safePadding = Math.max(0, finiteOrZero(padding));
  const availableWidth = Math.max(1, safeWidth - safePadding * 2);
  const availableHeight = Math.max(1, safeHeight - safePadding * 2);
  const rangeWidth = Math.max(1, Math.abs(maxX - minX));
  const rangeHeight = Math.max(1, Math.abs(maxY - minY));
  const scale = Math.min(availableWidth / rangeWidth, availableHeight / rangeHeight);
  const offsetX = safePadding
    + (availableWidth - rangeWidth * scale) / 2
    - minX * scale;
  const offsetY = safePadding
    + (availableHeight - rangeHeight * scale) / 2
    - minY * scale;

  return {
    scale: Number.isFinite(scale) ? scale : 1,
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
  };
}

export function projectCanvasMinimapScene(
  items: CanvasMinimapItem[],
  viewport: CanvasMinimapViewport,
): CanvasMinimapScene {
  const bounds = computeCanvasMinimapBounds(items, viewport);
  const projection = computeCanvasMinimapProjection(bounds);
  const projectRect = (rect: CanvasMinimapRect): CanvasMinimapRect => ({
    ...(rect.id === undefined ? {} : { id: rect.id }),
    x: safeAdd(safeMultiply(rect.x, projection.scale), projection.offsetX),
    y: safeAdd(safeMultiply(rect.y, projection.scale), projection.offsetY),
    width: safeMultiply(rect.width, projection.scale),
    height: safeMultiply(rect.height, projection.scale),
  });

  return {
    items: items.filter(isValidRect).map((item) => projectRect(item)),
    viewport: projectRect(getWorldViewport(viewport)),
    bounds,
    projection,
  };
}

export function CanvasMinimap({
  items,
  viewport,
  theme = 'dark',
  rightOffset,
  onNavigate,
  onClose,
}: CanvasMinimapProps) {
  const scene = useMemo(() => projectCanvasMinimapScene(items, viewport), [items, viewport]);
  const handleMapClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const mapBounds = event.currentTarget.getBoundingClientRect();
    const miniX = event.clientX - mapBounds.left;
    const miniY = event.clientY - mapBounds.top;
    onNavigate({
      x: (miniX - scene.projection.offsetX) / scene.projection.scale,
      y: (miniY - scene.projection.offsetY) / scene.projection.scale,
    });
  }, [onNavigate, scene.projection]);
  const stopPropagation = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);
  const close = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClose();
  }, [onClose]);

  return (
    <div
      className="fixed z-40 overflow-hidden border shadow-lg"
      data-canvas-minimap
      data-popup
      data-testid="canvas-minimap"
      data-theme={theme}
      onPointerDown={stopPropagation}
      onWheel={stopPropagation}
      style={{
        width: 192,
        bottom: 76,
        right: Math.max(12, Number.isFinite(rightOffset) ? rightOffset : 12),
        borderRadius: 8,
      }}
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium">小地图</span>
        <button type="button" aria-label="关闭小地图" onClick={close}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div
        className="relative overflow-hidden"
        data-testid="canvas-minimap-map"
        onClick={handleMapClick}
        style={{ width: CANVAS_MINIMAP_WIDTH, height: CANVAS_MINIMAP_HEIGHT }}
      >
        {scene.items.map((item) => (
          <div
            key={item.id}
            data-canvas-minimap-item
            style={{
              position: 'absolute',
              left: item.x,
              top: item.y,
              width: item.width,
              height: item.height,
              pointerEvents: 'none',
            }}
          />
        ))}
        {scene.items.length === 0 && (
          <span className="absolute inset-0 flex items-center justify-center text-xs">
            暂无画布内容
          </span>
        )}
        <div
          data-testid="canvas-minimap-viewport"
          style={{
            position: 'absolute',
            left: scene.viewport.x,
            top: scene.viewport.y,
            width: scene.viewport.width,
            height: scene.viewport.height,
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}
