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
  onNavigate: (point: { x: number; y: number }) => void;
  onClose: () => void;
}

const minimapThemeStyles = {
  dark: {
    panelBackground: 'rgba(20, 20, 20, 0.96)',
    panelBorder: 'rgba(212, 175, 55, 0.42)',
    panelText: '#f7e7a9',
    mapBackground: '#0b0b0b',
    itemBackground: 'rgba(212, 175, 55, 0.28)',
    itemBorder: 'rgba(212, 175, 55, 0.68)',
    viewportBackground: 'rgba(212, 175, 55, 0.12)',
    viewportBorder: '#d4af37',
  },
  mono: {
    panelBackground: 'rgba(255, 255, 255, 0.98)',
    panelBorder: '#d1d5db',
    panelText: '#111827',
    mapBackground: '#f3f4f6',
    itemBackground: 'rgba(17, 24, 39, 0.18)',
    itemBorder: 'rgba(17, 24, 39, 0.45)',
    viewportBackground: 'rgba(17, 24, 39, 0.08)',
    viewportBorder: '#111827',
  },
} as const;

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

const safeMidpoint = (left: number, right: number): number => left / 2 + right / 2;

const computeAxisScale = (min: number, max: number, available: number): number => {
  const span = Math.abs(max - min);
  if (Number.isFinite(span)) {
    return available / Math.max(1, span);
  }

  const halfSpan = Math.abs(max / 2 - min / 2);
  return (available / 2) / Math.max(1, halfSpan);
};

const computeCenterScaleLimit = (center: number): number => {
  const magnitude = Math.abs(center);
  return magnitude > 1 ? Number.MAX_VALUE / magnitude : Number.MAX_VALUE;
};

const projectFromCenter = (value: number, center: number, mapCenter: number, scale: number): number => {
  const difference = value - center;
  const scaledDifference = Number.isFinite(difference)
    ? safeMultiply(difference, scale)
    : safeMultiply(safeMultiply(value / 2 - center / 2, scale), 2);
  return safeAdd(mapCenter, scaledDifference);
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
  const centerX = safeMidpoint(minX, maxX);
  const centerY = safeMidpoint(minY, maxY);
  const mapCenterX = safePadding + availableWidth / 2;
  const mapCenterY = safePadding + availableHeight / 2;
  const scale = Math.min(
    computeAxisScale(minX, maxX, availableWidth),
    computeAxisScale(minY, maxY, availableHeight),
    computeCenterScaleLimit(centerX),
    computeCenterScaleLimit(centerY),
  );
  const offsetX = safeAdd(mapCenterX, -safeMultiply(centerX, scale));
  const offsetY = safeAdd(mapCenterY, -safeMultiply(centerY, scale));

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
  const centerX = safeMidpoint(bounds.minX, bounds.maxX);
  const centerY = safeMidpoint(bounds.minY, bounds.maxY);
  const mapCenterX = CANVAS_MINIMAP_PADDING
    + (CANVAS_MINIMAP_WIDTH - CANVAS_MINIMAP_PADDING * 2) / 2;
  const mapCenterY = CANVAS_MINIMAP_PADDING
    + (CANVAS_MINIMAP_HEIGHT - CANVAS_MINIMAP_PADDING * 2) / 2;
  const projectRect = (rect: CanvasMinimapRect): CanvasMinimapRect => {
    const x = projectFromCenter(rect.x, centerX, mapCenterX, projection.scale);
    const y = projectFromCenter(rect.y, centerY, mapCenterY, projection.scale);
    const right = projectFromCenter(
      safeAdd(rect.x, rect.width),
      centerX,
      mapCenterX,
      projection.scale,
    );
    const bottom = projectFromCenter(
      safeAdd(rect.y, rect.height),
      centerY,
      mapCenterY,
      projection.scale,
    );

    return {
      ...(rect.id === undefined ? {} : { id: rect.id }),
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
    };
  };

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
}: CanvasMinimapProps): React.JSX.Element {
  const scene = useMemo(() => projectCanvasMinimapScene(items, viewport), [items, viewport]);
  const themeStyles = minimapThemeStyles[theme];
  const handleMapClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const mapBounds = event.currentTarget.getBoundingClientRect();
    const miniX = event.clientX - mapBounds.left;
    const miniY = event.clientY - mapBounds.top;
    onNavigate({
      x: safeDivide(
        safeAdd(miniX, -scene.projection.offsetX),
        scene.projection.scale,
      ),
      y: safeDivide(
        safeAdd(miniY, -scene.projection.offsetY),
        scene.projection.scale,
      ),
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
        bottom: 'var(--canvas-minimap-bottom, 76px)',
        right: Math.max(12, Number.isFinite(rightOffset) ? rightOffset : 12),
        borderRadius: 8,
        backgroundColor: themeStyles.panelBackground,
        border: `1px solid ${themeStyles.panelBorder}`,
        color: themeStyles.panelText,
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
        style={{
          width: CANVAS_MINIMAP_WIDTH,
          height: CANVAS_MINIMAP_HEIGHT,
          backgroundColor: themeStyles.mapBackground,
        }}
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
              backgroundColor: themeStyles.itemBackground,
              border: `1px solid ${themeStyles.itemBorder}`,
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
            backgroundColor: themeStyles.viewportBackground,
            border: `1px solid ${themeStyles.viewportBorder}`,
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}
