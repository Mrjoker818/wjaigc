import { describe, expect, it } from 'vitest';

import {
  clampNormalizedRegion,
  normalizeScreenPath,
  shouldCommitGesture,
} from '@/features/annotations/annotation-geometry';

describe('annotation geometry', () => {
  it('clamps a region so its right and bottom edges stay inside the source image', () => {
    expect(clampNormalizedRegion({ x: 0.9, y: 0.8, w: 0.4, h: 0.5 })).toEqual({
      x: 0.9,
      y: 0.8,
      w: 0.1,
      h: 0.2,
    });
  });

  it('uses a screen-pixel threshold instead of canvas zoom for gesture creation', () => {
    expect(shouldCommitGesture({ x: 10, y: 10 }, { x: 13, y: 14 }, 8)).toBe(false);
    expect(shouldCommitGesture({ x: 10, y: 10 }, { x: 19, y: 10 }, 8)).toBe(true);
  });

  it('interpolates fast brush movement and normalizes every point', () => {
    const points = normalizeScreenPath(
      [{ x: 100, y: 100 }, { x: 180, y: 100 }],
      { x: 100, y: 100, width: 100, height: 100 },
      10,
    );

    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 0.8, y: 0 });
    expect(points.every((point) =>
      point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1,
    )).toBe(true);
  });

  it('rejects non-finite brush path coordinates', () => {
    expect(() => normalizeScreenPath(
      [{ x: 100, y: 100 }, { x: Number.NaN, y: 120 }],
      { x: 100, y: 100, width: 100, height: 100 },
      10,
    )).toThrow();
  });

  it('rejects non-finite source image rectangles', () => {
    expect(() => normalizeScreenPath(
      [{ x: 100, y: 100 }, { x: 120, y: 120 }],
      {
        x: 100,
        y: 100,
        width: Number.POSITIVE_INFINITY,
        height: 100,
      },
      10,
    )).toThrow();
  });
});
