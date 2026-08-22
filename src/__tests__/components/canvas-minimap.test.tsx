// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  CanvasMinimap,
  computeCanvasMinimapBounds,
  computeCanvasMinimapProjection,
  projectCanvasMinimapScene,
  readCanvasMinimapPreference,
  writeCanvasMinimapPreference,
  isCanvasMinimapAvailable,
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

describe('CanvasMinimap geometry and preferences', () => {
  it('computes the visible world bounds from the canvas viewport', () => {
    expect(computeCanvasMinimapBounds([], viewport)).toEqual({
      minX: 200,
      minY: 150,
      maxX: 700,
      maxY: 450,
    });
  });

  it('projects a large scene and keeps the viewport projection finite', () => {
    const projected = projectCanvasMinimapScene(items300, viewport);

    expect(projected.items).toHaveLength(300);
    expect(Object.values(projected.viewport).every(Number.isFinite)).toBe(true);
  });

  it('handles empty, negative, remote, invalid, and degenerate geometry', () => {
    expect(computeCanvasMinimapBounds([], viewport)).toEqual({
      minX: 200,
      minY: 150,
      maxX: 700,
      maxY: 450,
    });

    const projected = projectCanvasMinimapScene([
      { id: 'negative', x: -300, y: -200, width: 80, height: 40 },
      { id: 'remote', x: 100000, y: 100000, width: 80, height: 40 },
      { id: 'zero-area', x: 0, y: 0, width: 0, height: 20 },
      { id: 'non-finite', x: Number.NaN, y: 0, width: 20, height: 20 },
      { id: 'infinite', x: 0, y: Number.POSITIVE_INFINITY, width: 20, height: 20 },
    ], viewport);

    expect(projected.items.map(item => item.id)).toEqual(['negative', 'remote']);
    expect(Object.values(projected.viewport).every(Number.isFinite)).toBe(true);
    expect(computeCanvasMinimapProjection([{ id: 'flat', x: 0, y: 0, width: 1, height: 1 }], {
      ...viewport,
      width: 0,
      height: 0,
    }).items).toHaveLength(1);
  });

  it('preserves aspect ratio and supports click inverse projection', () => {
    const projected = computeCanvasMinimapProjection([
      { id: 'wide', x: 0, y: 0, width: 400, height: 200 },
    ], viewport);

    expect(projected.scaleX).toBe(projected.scaleY);
    const canvasPoint = projected.toCanvasPoint({ x: projected.viewport.x, y: projected.viewport.y });
    expect(canvasPoint.x).toBeCloseTo(viewport.offsetX);
    expect(canvasPoint.y).toBeCloseTo(viewport.offsetY);
  });

  it('supports responsive availability thresholds', () => {
    expect(isCanvasMinimapAvailable(1200, 480)).toBe(true);
    expect(isCanvasMinimapAvailable(767, 20)).toBe(false);
    expect(isCanvasMinimapAvailable(1000, 480)).toBe(false);
  });

  it('restores only the exact true preference and fails closed on bad storage', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });

    expect(readCanvasMinimapPreference()).toBe(false);
    writeCanvasMinimapPreference(true);
    expect(storage.get('wujie_canvas_minimap')).toBe('true');
    expect(readCanvasMinimapPreference()).toBe(true);
    storage.set('wujie_canvas_minimap', 'TRUE');
    expect(readCanvasMinimapPreference()).toBe(false);
    storage.set('wujie_canvas_minimap', 'damaged');
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
  it('supports dark and monochrome themes, empty state, close, and event isolation', () => {
    const onClose = vi.fn();
    const onCanvasClick = vi.fn();
    const { rerender } = render(
      <CanvasMinimap
        items={[]}
        viewport={viewport}
        open
        theme="dark"
        onClose={onClose}
        onCanvasClick={onCanvasClick}
      />,
    );

    expect(screen.getByTestId('canvas-minimap')).toHaveAttribute('data-canvas-minimap');
    expect(screen.getByText('画布为空')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭小地图' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('canvas-minimap'));
    expect(onCanvasClick).not.toHaveBeenCalled();

    rerender(
      <CanvasMinimap
        items={items300.slice(0, 1)}
        viewport={viewport}
        open
        theme="mono"
        onClose={onClose}
        onCanvasClick={onCanvasClick}
      />,
    );
    expect(screen.getByTestId('canvas-minimap')).toHaveAttribute('data-theme', 'mono');
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
