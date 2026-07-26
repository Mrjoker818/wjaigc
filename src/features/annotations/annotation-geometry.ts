import type {
  AnnotationRegion,
  NormalizedPoint,
} from './annotation-types';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRect extends ScreenPoint {
  width: number;
  height: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export function isNormalizedRegion(region: AnnotationRegion): boolean {
  return (
    Number.isFinite(region.x)
    && Number.isFinite(region.y)
    && Number.isFinite(region.w)
    && Number.isFinite(region.h)
    && region.x >= 0
    && region.y >= 0
    && region.w > 0
    && region.h > 0
    && region.x + region.w <= 1
    && region.y + region.h <= 1
  );
}

export function clampNormalizedRegion(region: AnnotationRegion): AnnotationRegion {
  const x = clamp01(Number.isFinite(region.x) ? region.x : 0);
  const y = clamp01(Number.isFinite(region.y) ? region.y : 0);
  const w = Math.max(0, Math.min(
    Number.isFinite(region.w) ? region.w : 0,
    1 - x,
  ));
  const h = Math.max(0, Math.min(
    Number.isFinite(region.h) ? region.h : 0,
    1 - y,
  ));

  return {
    x: round(x),
    y: round(y),
    w: round(w),
    h: round(h),
  };
}

export function shouldCommitGesture(
  start: ScreenPoint,
  end: ScreenPoint,
  minimumDistance = 8,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) >= minimumDistance;
}

export function normalizeScreenPoint(
  point: ScreenPoint,
  imageRect: ScreenRect,
): NormalizedPoint {
  if (
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || !Number.isFinite(imageRect.x)
    || !Number.isFinite(imageRect.y)
    || !Number.isFinite(imageRect.width)
    || !Number.isFinite(imageRect.height)
    || imageRect.width <= 0
    || imageRect.height <= 0
  ) {
    throw new Error('图片显示区域尺寸无效');
  }

  return {
    x: round(clamp01((point.x - imageRect.x) / imageRect.width)),
    y: round(clamp01((point.y - imageRect.y) / imageRect.height)),
  };
}

export function normalizeScreenPath(
  points: ScreenPoint[],
  imageRect: ScreenRect,
  interpolationSpacing = 4,
): NormalizedPoint[] {
  if (points.length === 0) return [];
  if (!Number.isFinite(interpolationSpacing) || interpolationSpacing <= 0) {
    throw new Error('画笔插值间距必须大于 0');
  }

  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('Brush path coordinates must be finite');
  }

  const interpolated: ScreenPoint[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    const segments = Math.max(1, Math.ceil(distance / interpolationSpacing));

    for (let segment = 1; segment <= segments; segment += 1) {
      const progress = segment / segments;
      interpolated.push({
        x: previous.x + (current.x - previous.x) * progress,
        y: previous.y + (current.y - previous.y) * progress,
      });
    }
  }

  return interpolated
    .map((point) => normalizeScreenPoint(point, imageRect))
    .filter((point, index, allPoints) => {
      if (index === 0) return true;
      const previous = allPoints[index - 1];
      return point.x !== previous.x || point.y !== previous.y;
    });
}

export function normalizedRegionFromScreenPoints(
  start: ScreenPoint,
  end: ScreenPoint,
  imageRect: ScreenRect,
): AnnotationRegion {
  const first = normalizeScreenPoint(start, imageRect);
  const second = normalizeScreenPoint(end, imageRect);
  return clampNormalizedRegion({
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    w: Math.abs(second.x - first.x),
    h: Math.abs(second.y - first.y),
  });
}
