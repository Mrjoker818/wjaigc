export interface CanvasViewportOffset {
  x: number;
  y: number;
}

export interface CanvasCullingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Keep culling responsive without asking React to render on every pointer event.
export const PAN_VIEWPORT_SYNC_INTERVAL_MS = 80;

export function shouldSuspendCanvasVirtualization(_isPanning: boolean, _isMiddlePanning: boolean): boolean {
  return false;
}

export function resolveCanvasCullingOffset(
  committedOffset: CanvasViewportOffset,
  panViewportOffset: CanvasViewportOffset,
  isPanning: boolean,
  isMiddlePanning: boolean,
): CanvasViewportOffset {
  return isPanning || isMiddlePanning ? panViewportOffset : committedOffset;
}

/** Use the same offset for React renders and direct rAF transform previews. */
export function resolveCanvasRenderOffset(
  committedOffset: CanvasViewportOffset,
  panViewportOffset: CanvasViewportOffset,
  isPanning: boolean,
  isMiddlePanning: boolean,
): CanvasViewportOffset {
  return resolveCanvasCullingOffset(committedOffset, panViewportOffset, isPanning, isMiddlePanning);
}

/** Keep the path between the committed and sampled viewports mounted during panning. */
export function resolveCanvasCullingBounds(
  committedOffset: CanvasViewportOffset,
  panViewportOffset: CanvasViewportOffset,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  isPanning: boolean,
  isMiddlePanning: boolean,
  occupiedRight = 0,
): CanvasCullingBounds {
  const activeOffset = resolveCanvasCullingOffset(
    committedOffset,
    panViewportOffset,
    isPanning,
    isMiddlePanning,
  );
  const committedX = -committedOffset.x / zoom;
  const committedY = -committedOffset.y / zoom;
  const activeX = -activeOffset.x / zoom;
  const activeY = -activeOffset.y / zoom;
  const usableViewportWidth = Math.max(1, viewportWidth - Math.max(0, occupiedRight));
  const normalizeZero = (value: number): number => Object.is(value, -0) ? 0 : value;

  return {
    minX: normalizeZero(Math.min(committedX, activeX)),
    minY: normalizeZero(Math.min(committedY, activeY)),
    maxX: Math.max(committedX + usableViewportWidth / zoom, activeX + usableViewportWidth / zoom),
    maxY: Math.max(committedY + viewportHeight / zoom, activeY + viewportHeight / zoom),
  };
}

export function getCanvasViewportMarginFactor(isPanning: boolean, isMiddlePanning: boolean): number {
  return isPanning || isMiddlePanning ? 1.25 : 0.5;
}
