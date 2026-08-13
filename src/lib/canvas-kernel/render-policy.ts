export type CanvasRenderPriority = 'critical' | 'visible' | 'overscan' | 'deferred';

export interface CanvasRenderImage {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isProcessingPlaceholder?: boolean;
}

export interface CanvasRenderViewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  overscanFactor?: number;
}

export interface CanvasRenderItem<T extends CanvasRenderImage = CanvasRenderImage> {
  id: string;
  image: T;
  priority: CanvasRenderPriority;
  shouldMount: boolean;
}

interface NormalizedRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function normalizeRect(
  x: number,
  y: number,
  width: number,
  height: number,
): NormalizedRect | null {
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    minX: Math.min(x, x + width),
    minY: Math.min(y, y + height),
    maxX: Math.max(x, x + width),
    maxY: Math.max(y, y + height),
  };
}

function normalizeViewport(viewport: CanvasRenderViewport): NormalizedRect | null {
  const width = viewport.maxX - viewport.minX;
  const height = viewport.maxY - viewport.minY;
  return normalizeRect(viewport.minX, viewport.minY, width, height);
}

function intersects(first: NormalizedRect, second: NormalizedRect): boolean {
  return (
    first.maxX >= second.minX
    && first.minX <= second.maxX
    && first.maxY >= second.minY
    && first.minY <= second.maxY
  );
}

function expandRect(rect: NormalizedRect, factor: number): NormalizedRect {
  const safeFactor = Number.isFinite(factor) ? Math.min(4, Math.max(0, factor)) : 0.5;
  const marginX = (rect.maxX - rect.minX) * safeFactor;
  const marginY = (rect.maxY - rect.minY) * safeFactor;
  return {
    minX: rect.minX - marginX,
    minY: rect.minY - marginY,
    maxX: rect.maxX + marginX,
    maxY: rect.maxY + marginY,
  };
}

export function buildCanvasRenderProjection<T extends CanvasRenderImage>(
  images: readonly T[],
  viewport: CanvasRenderViewport,
  keepAliveIds: ReadonlySet<string>,
): CanvasRenderItem<T>[] {
  const visibleRect = normalizeViewport(viewport);
  const overscanRect = visibleRect
    ? expandRect(visibleRect, viewport.overscanFactor ?? 0.5)
    : null;

  return images.map((image) => {
    const imageRect = normalizeRect(image.x, image.y, image.width, image.height);
    let priority: CanvasRenderPriority = 'deferred';

    if (keepAliveIds.has(image.id) || image.isProcessingPlaceholder) {
      priority = 'critical';
    } else if (imageRect && visibleRect && intersects(imageRect, visibleRect)) {
      priority = 'visible';
    } else if (imageRect && overscanRect && intersects(imageRect, overscanRect)) {
      priority = 'overscan';
    }

    return {
      id: image.id,
      image,
      priority,
      shouldMount: priority !== 'deferred',
    };
  });
}

export function getMountedCanvasRenderItems<T extends CanvasRenderImage>(
  projection: readonly CanvasRenderItem<T>[],
): CanvasRenderItem<T>[] {
  return projection.filter(item => item.shouldMount);
}
