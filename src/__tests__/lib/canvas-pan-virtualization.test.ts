import { describe, expect, it } from 'vitest';
import {
  getCanvasViewportMarginFactor,
  PAN_VIEWPORT_SYNC_INTERVAL_MS,
  resolveCanvasCullingBounds,
  resolveCanvasCullingOffset,
  shouldSuspendCanvasVirtualization,
} from '@/lib/canvas-pan-virtualization';

describe('canvas pan virtualization', () => {
  it('keeps viewport culling enabled while the canvas is panning', () => {
    expect(shouldSuspendCanvasVirtualization(true, false)).toBe(false);
    expect(shouldSuspendCanvasVirtualization(false, true)).toBe(false);
  });

  it('uses the latest throttled pan offset for culling without committing every pointer event', () => {
    expect(resolveCanvasCullingOffset(
      { x: 100, y: 80 },
      { x: 480, y: 360 },
      true,
      false,
    )).toEqual({ x: 480, y: 360 });

    expect(resolveCanvasCullingOffset(
      { x: 100, y: 80 },
      { x: 480, y: 360 },
      false,
      false,
    )).toEqual({ x: 100, y: 80 });

    expect(PAN_VIEWPORT_SYNC_INTERVAL_MS).toBeLessThanOrEqual(100);
    expect(PAN_VIEWPORT_SYNC_INTERVAL_MS).toBeGreaterThanOrEqual(16);
  });

  it('uses a bounded larger overscan buffer during panning', () => {
    expect(getCanvasViewportMarginFactor(false, false)).toBe(0.5);
    expect(getCanvasViewportMarginFactor(true, false)).toBeGreaterThan(0.5);
    expect(getCanvasViewportMarginFactor(true, false)).toBeLessThanOrEqual(2);
  });

  it('keeps the entire pan corridor mounted while the transform moves ahead of React', () => {
    expect(resolveCanvasCullingBounds(
      { x: 0, y: 0 },
      { x: -1200, y: -600 },
      1,
      800,
      600,
      true,
      false,
    )).toEqual({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 });
  });
});
