import { describe, expect, it } from 'vitest';
import {
  fitCanvasContent,
  normalizeCanvasViewState,
  resolveCanvasUsableViewportSize,
  type CanvasViewRect,
} from '@/lib/canvas-view-state';

describe('canvas view state', () => {
  it('fits persisted content that is outside the origin viewport', () => {
    const image: CanvasViewRect = {
      x: 2104,
      y: 965.5,
      width: 553,
      height: 248.85,
    };

    const view = fitCanvasContent([image], { width: 1200, height: 800 });
    const screenLeft = view.offsetX + image.x * view.zoom;
    const screenTop = view.offsetY + image.y * view.zoom;
    const screenRight = screenLeft + image.width * view.zoom;
    const screenBottom = screenTop + image.height * view.zoom;

    expect(view.zoom).toBeGreaterThan(0);
    expect(view.zoom).toBeLessThanOrEqual(1);
    expect(screenLeft).toBeGreaterThanOrEqual(0);
    expect(screenTop).toBeGreaterThanOrEqual(0);
    expect(screenRight).toBeLessThanOrEqual(1200);
    expect(screenBottom).toBeLessThanOrEqual(800);
  });

  it('returns a neutral view for an empty canvas', () => {
    expect(fitCanvasContent([], { width: 1200, height: 800 })).toEqual({
      offsetX: 0,
      offsetY: 0,
      zoom: 1,
    });
  });

  it('excludes fixed workspace chrome from the usable canvas viewport', () => {
    expect(resolveCanvasUsableViewportSize(
      { width: 1280, height: 720 },
      { left: 24, right: 480, top: 16, bottom: 32 },
    )).toEqual({ width: 776, height: 672 });

    expect(resolveCanvasUsableViewportSize(
      { width: 320, height: 240 },
      { right: 480 },
    )).toEqual({ width: 1, height: 240 });
  });

  it('accepts only finite, bounded persisted view state', () => {
    expect(normalizeCanvasViewState({ offsetX: 24, offsetY: -12, zoom: 0.75 })).toEqual({
      offsetX: 24,
      offsetY: -12,
      zoom: 0.75,
    });
    expect(normalizeCanvasViewState({ offsetX: Number.NaN, offsetY: 0, zoom: 1 })).toBeNull();
    expect(normalizeCanvasViewState({ offsetX: 0, offsetY: Infinity, zoom: 1 })).toBeNull();
    expect(normalizeCanvasViewState({ offsetX: 0, offsetY: 0, zoom: 99 })).toBeNull();
  });
});
