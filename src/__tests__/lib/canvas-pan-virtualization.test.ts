import { describe, expect, it, vi } from 'vitest';
import {
  beginCanvasSpacePan,
  getCanvasViewportMarginFactor,
  PAN_VIEWPORT_SYNC_DISTANCE_PX,
  PAN_VIEWPORT_SYNC_INTERVAL_MS,
  resolveCanvasCullingBounds,
  resolveCanvasCullingOffset,
  resolveCanvasRenderOffset,
  resetCanvasSpacePan,
  setCanvasSpacePanActive,
  shouldSuspendCanvasVirtualization,
  shouldSyncCanvasPanViewport,
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

  it('recomputes React culling only after both the time and distance boundaries are crossed', () => {
    const lastSynced = { x: 100, y: 80 };

    expect(shouldSyncCanvasPanViewport(
      lastSynced,
      { x: 100 + PAN_VIEWPORT_SYNC_DISTANCE_PX - 1, y: 80 },
      PAN_VIEWPORT_SYNC_INTERVAL_MS,
    )).toBe(false);
    expect(shouldSyncCanvasPanViewport(
      lastSynced,
      { x: 100 + PAN_VIEWPORT_SYNC_DISTANCE_PX, y: 80 },
      PAN_VIEWPORT_SYNC_INTERVAL_MS - 1,
    )).toBe(false);
    expect(shouldSyncCanvasPanViewport(
      lastSynced,
      { x: 100 + PAN_VIEWPORT_SYNC_DISTANCE_PX, y: 80 },
      PAN_VIEWPORT_SYNC_INTERVAL_MS,
    )).toBe(true);
  });

  it('keeps a standard 120 by 72 pixel pan entirely on the compositor path', () => {
    expect(shouldSyncCanvasPanViewport(
      { x: 0, y: 0 },
      { x: 120, y: 72 },
      PAN_VIEWPORT_SYNC_INTERVAL_MS * 4,
    )).toBe(false);
  });

  it('updates the temporary Space-pan cursor without publishing React state', () => {
    const element = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };

    setCanvasSpacePanActive(element, true);
    expect(element.setAttribute).toHaveBeenCalledWith('data-space-pan', 'true');
    expect(element.removeAttribute).not.toHaveBeenCalled();

    setCanvasSpacePanActive(element, false);
    expect(element.removeAttribute).toHaveBeenCalledWith('data-space-pan');
  });

  it('prevents repeated Space defaults without republishing the active cursor', () => {
    const state = { current: false };
    const element = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const first = { code: 'Space', repeat: false, preventDefault: vi.fn() };
    const repeated = { code: 'Space', repeat: true, preventDefault: vi.fn() };

    expect(beginCanvasSpacePan(first, false, state, element)).toBe(true);
    expect(state.current).toBe(true);
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(element.setAttribute).toHaveBeenCalledOnce();

    expect(beginCanvasSpacePan(repeated, false, state, element)).toBe(true);
    expect(repeated.preventDefault).toHaveBeenCalledOnce();
    expect(element.setAttribute).toHaveBeenCalledOnce();
  });

  it('resets Space-pan state on lost focus and safely accepts a missing element', () => {
    const state = { current: true };
    const element = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };

    resetCanvasSpacePan(state, element);
    expect(state.current).toBe(false);
    expect(element.removeAttribute).toHaveBeenCalledWith('data-space-pan');

    state.current = true;
    resetCanvasSpacePan(state, null);
    expect(state.current).toBe(false);
  });

  it('keeps the render transform aligned with the sampled pan offset during an active pan', () => {
    expect(resolveCanvasRenderOffset(
      { x: 100, y: 80 },
      { x: 480, y: 360 },
      true,
      false,
    )).toEqual({ x: 480, y: 360 });

    expect(resolveCanvasRenderOffset(
      { x: 100, y: 80 },
      { x: 480, y: 360 },
      false,
      false,
    )).toEqual({ x: 100, y: 80 });
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

  it('does not treat the fixed right workspace panel as interactive canvas width', () => {
    expect(resolveCanvasCullingBounds(
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      1,
      1280,
      720,
      false,
      false,
      480,
    )).toEqual({ minX: 0, minY: 0, maxX: 800, maxY: 720 });
  });
});
