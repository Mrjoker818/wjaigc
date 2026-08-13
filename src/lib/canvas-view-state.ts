export interface CanvasViewState {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface CanvasViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasViewportSize {
  width: number;
  height: number;
}

export interface CanvasViewportInsets {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeInset(value: number | undefined): number {
  return isFiniteNumber(value) ? Math.max(0, value) : 0;
}

export function resolveCanvasUsableViewportSize(
  viewport: CanvasViewportSize,
  insets: CanvasViewportInsets = {},
): CanvasViewportSize {
  return {
    width: Math.max(1, viewport.width - normalizeInset(insets.left) - normalizeInset(insets.right)),
    height: Math.max(1, viewport.height - normalizeInset(insets.top) - normalizeInset(insets.bottom)),
  };
}

export function normalizeCanvasViewState(value: unknown): CanvasViewState | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<CanvasViewState>;
  if (
    !isFiniteNumber(candidate.offsetX)
    || !isFiniteNumber(candidate.offsetY)
    || !isFiniteNumber(candidate.zoom)
    || candidate.zoom < MIN_ZOOM
    || candidate.zoom > MAX_ZOOM
  ) {
    return null;
  }

  return {
    offsetX: candidate.offsetX,
    offsetY: candidate.offsetY,
    zoom: candidate.zoom,
  };
}

export function fitCanvasContent(
  rects: CanvasViewRect[],
  viewport: CanvasViewportSize,
  padding = 48,
): CanvasViewState {
  const usableRects = rects.filter((rect) => (
    isFiniteNumber(rect.x)
    && isFiniteNumber(rect.y)
    && isFiniteNumber(rect.width)
    && isFiniteNumber(rect.height)
    && rect.width > 0
    && rect.height > 0
  ));

  if (
    usableRects.length === 0
    || !isFiniteNumber(viewport.width)
    || !isFiniteNumber(viewport.height)
    || viewport.width <= 0
    || viewport.height <= 0
  ) {
    return { offsetX: 0, offsetY: 0, zoom: 1 };
  }

  const minX = Math.min(...usableRects.map((rect) => rect.x));
  const minY = Math.min(...usableRects.map((rect) => rect.y));
  const maxX = Math.max(...usableRects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...usableRects.map((rect) => rect.y + rect.height));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = Math.min(
    1,
    Math.max(
      MIN_ZOOM,
      Math.min(availableWidth / contentWidth, availableHeight / contentHeight),
    ),
  );

  return {
    offsetX: (viewport.width - contentWidth * zoom) / 2 - minX * zoom,
    offsetY: (viewport.height - contentHeight * zoom) / 2 - minY * zoom,
    zoom,
  };
}
