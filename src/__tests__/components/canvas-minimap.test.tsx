// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CANVAS_MINIMAP_PREFERENCE_KEY,
  CanvasMinimap,
  computeCanvasMinimapBounds,
  computeCanvasMinimapProjection,
  isCanvasMinimapAvailable,
  projectCanvasMinimapScene,
  readCanvasMinimapPreference,
  writeCanvasMinimapPreference,
} from '@/components/canvas/CanvasMinimap';

const viewport = {
  width: 1000,
  height: 600,
  zoom: 2,
  offsetX: -400,
  offsetY: -300,
};

const items300 = Array.from({ length: 300 }, (_, index) => ({
  id: `node-${index}`,
  x: (index % 20) * 180,
  y: Math.floor(index / 20) * 140,
  width: 160,
  height: 120,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CanvasMinimap geometry and preferences', () => {
  it('computes visible world bounds from the canvas viewport', () => {
    expect(computeCanvasMinimapBounds([], viewport)).toEqual({
      minX: 200,
      minY: 150,
      maxX: 700,
      maxY: 450,
    });
  });

  it('projects 300 rectangles and keeps the projected viewport finite', () => {
    const scene = projectCanvasMinimapScene(items300, viewport);

    expect(scene.items).toHaveLength(300);
    expect(Object.values(scene.viewport).every(Number.isFinite)).toBe(true);
  });

  it('filters invalid geometry while retaining negative and remote rectangles', () => {
    const scene = projectCanvasMinimapScene([
      { id: 'negative', x: -300, y: -200, width: 80, height: 40 },
      { id: 'remote', x: 100000, y: 100000, width: 80, height: 40 },
      { id: 'zero-area', x: 0, y: 0, width: 0, height: 20 },
      { id: 'non-finite', x: Number.NaN, y: 0, width: 20, height: 20 },
      { id: 'infinite', x: 0, y: Number.POSITIVE_INFINITY, width: 20, height: 20 },
    ], viewport);

    expect(scene.items.map(item => item.id)).toEqual(['negative', 'remote']);
  });

  it('preserves aspect ratio with the fixed bounds-to-projection API', () => {
    const projection = computeCanvasMinimapProjection({
      minX: 0,
      minY: 0,
      maxX: 400,
      maxY: 200,
    });

    expect(projection).toEqual({
      scale: expect.any(Number),
      offsetX: expect.any(Number),
      offsetY: expect.any(Number),
    });
    expect(projection.scale).toBeCloseTo(0.39);
    expect(projection.offsetX).toBeCloseTo(10);
    expect(projection.offsetY).toBeCloseTo(23);
  });

  it('keeps degenerate projection and scene coordinates finite', () => {
    const projection = computeCanvasMinimapProjection({
      minX: 20,
      minY: -10,
      maxX: 20,
      maxY: -10,
    }, 0, 0, 0);
    const scene = projectCanvasMinimapScene([
      { id: 'point-like', x: 20, y: -10, width: 1, height: 1 },
    ], {
      width: 0,
      height: 0,
      zoom: 0,
      offsetX: Number.NaN,
      offsetY: Number.POSITIVE_INFINITY,
    });

    expect(Object.values(projection).every(Number.isFinite)).toBe(true);
    expect(Object.values(scene.projection).every(Number.isFinite)).toBe(true);
    expect(Object.values(scene.viewport).every(Number.isFinite)).toBe(true);
    expect(scene.items.every(item => Object.values(item).filter(value => typeof value === 'number').every(Number.isFinite))).toBe(true);
  });

  it('allows only the exact desktop and usable-width boundaries', () => {
    expect(isCanvasMinimapAvailable(768, 208)).toBe(true);
    expect(isCanvasMinimapAvailable(767, 207)).toBe(false);
    expect(isCanvasMinimapAvailable(768, 209)).toBe(false);
  });

  it('uses the exact preference key and fails closed on invalid storage', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });

    expect(CANVAS_MINIMAP_PREFERENCE_KEY).toBe('wujie.canvas.minimap.open.v1');
    expect(readCanvasMinimapPreference()).toBe(false);
    writeCanvasMinimapPreference(true);
    expect(storage.get('wujie.canvas.minimap.open.v1')).toBe('true');
    expect(readCanvasMinimapPreference()).toBe(true);
    storage.set('wujie.canvas.minimap.open.v1', 'TRUE');
    expect(readCanvasMinimapPreference()).toBe(false);
    storage.set('wujie.canvas.minimap.open.v1', 'damaged');
    expect(readCanvasMinimapPreference()).toBe(false);

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage unavailable'); },
      setItem: () => { throw new Error('storage unavailable'); },
    });
    expect(readCanvasMinimapPreference()).toBe(false);
    expect(() => writeCanvasMinimapPreference(true)).not.toThrow();
  });
});

describe('CanvasMinimap interaction surface', () => {
  it('inverse-projects a real map click and isolates map interactions', () => {
    const onNavigate = vi.fn();
    const onParentClick = vi.fn();
    const onParentPointerDown = vi.fn();
    const onParentWheel = vi.fn();
    const items = [{ id: 'focus', x: 0, y: 0, width: 400, height: 200 }];
    const scene = projectCanvasMinimapScene(items, viewport);

    render(
      <div onClick={onParentClick} onPointerDown={onParentPointerDown} onWheel={onParentWheel}>
        <CanvasMinimap
          items={items}
          viewport={viewport}
          theme="dark"
          rightOffset={24}
          onNavigate={onNavigate}
          onClose={vi.fn()}
        />
      </div>,
    );

    const map = screen.getByTestId('canvas-minimap-map');
    vi.spyOn(map, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 50,
      width: 176,
      height: 124,
      top: 50,
      right: 276,
      bottom: 174,
      left: 100,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(map);
    fireEvent.wheel(map);
    fireEvent.click(map, { clientX: 178, clientY: 95 });

    expect(onParentPointerDown).not.toHaveBeenCalled();
    expect(onParentWheel).not.toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledTimes(1);
    const [point] = onNavigate.mock.calls[0] as [{ x: number; y: number }];
    expect(point.x).toBeCloseTo((78 - scene.projection.offsetX) / scene.projection.scale);
    expect(point.y).toBeCloseTo((45 - scene.projection.offsetY) / scene.projection.scale);
  });

  it('renders dark and mono output with no thumbnails or network work', () => {
    const onClose = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { container, rerender } = render(
      <CanvasMinimap
        items={[]}
        viewport={viewport}
        theme="dark"
        rightOffset={24}
        onNavigate={vi.fn()}
        onClose={onClose}
      />,
    );

    const darkRoot = container.querySelector('[data-canvas-minimap]');
    expect(darkRoot?.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByText('暂无画布内容')).toBeTruthy();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('[src]')).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭小地图' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <CanvasMinimap
        items={items300.slice(0, 1)}
        viewport={viewport}
        theme="mono"
        rightOffset={24}
        onNavigate={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(container.querySelector('[data-canvas-minimap]')?.getAttribute('data-theme')).toBe('mono');
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('[src]')).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('CanvasMinimap performance budget', () => {
  it('keeps p95 projection time for 300 rectangles within 8ms', () => {
    const samples = Array.from({ length: 100 }, () => {
      const startedAt = performance.now();
      projectCanvasMinimapScene(items300, viewport);
      return performance.now() - startedAt;
    }).sort((left, right) => left - right);

    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThanOrEqual(8);
  });
});
