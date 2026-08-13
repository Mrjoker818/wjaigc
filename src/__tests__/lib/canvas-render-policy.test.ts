import { describe, expect, it } from 'vitest';

import {
  buildCanvasRenderProjection,
  getMountedCanvasRenderItems,
} from '@/lib/canvas-kernel/render-policy';

const image = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  x,
  y,
  width: 80,
  height: 80,
  ...extra,
});

describe('canvas render projection', () => {
  it('classifies visible, overscan and deferred nodes without changing z-order', () => {
    const images = [
      image('visible-a', 10, 10),
      image('overscan-a', 150, 10),
      image('deferred-a', 600, 10),
      image('visible-b', 20, 20),
    ];

    const projection = buildCanvasRenderProjection(images, {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
      overscanFactor: 1,
    }, new Set());

    expect(projection.map(item => item.id)).toEqual(images.map(item => item.id));
    expect(projection.filter(item => item.priority === 'visible')).toHaveLength(2);
    expect(projection.find(item => item.id === 'overscan-a')?.priority).toBe('overscan');
    expect(projection.find(item => item.id === 'deferred-a')?.priority).toBe('deferred');
    expect(getMountedCanvasRenderItems(projection).map(item => item.id)).toEqual([
      'visible-a',
      'overscan-a',
      'visible-b',
    ]);
  });

  it('keeps every interactive and task source mounted outside the viewport', () => {
    const keepAliveIds = new Set([
      'selected',
      'dragged',
      'resizing',
      'annotation-source',
      'tool-source',
      'recent-overscan',
    ]);
    const images = [...keepAliveIds].map((id, index) => image(id, 1_000 + index * 100, 1_000));
    images.push(image('processing', 2_000, 2_000, { isProcessingPlaceholder: true }));
    images.push(image('ordinary-offscreen', 3_000, 3_000));

    const projection = buildCanvasRenderProjection(images, {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
      overscanFactor: 0.5,
    }, keepAliveIds);
    const mountedIds = getMountedCanvasRenderItems(projection).map(item => item.id);

    for (const id of keepAliveIds) expect(mountedIds).toContain(id);
    expect(mountedIds).toContain('processing');
    expect(mountedIds).not.toContain('ordinary-offscreen');
    expect(projection.find(item => item.id === 'processing')?.priority).toBe('critical');
  });

  it('normalizes invalid rectangles without mounting unrelated deferred nodes', () => {
    const projection = buildCanvasRenderProjection([
      { id: 'negative-size', x: 50, y: 50, width: -40, height: -40 },
      { id: 'invalid', x: Number.NaN, y: 0, width: 20, height: 20 },
    ], {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
      overscanFactor: 0.5,
    }, new Set());

    expect(projection.find(item => item.id === 'negative-size')?.priority).toBe('visible');
    expect(projection.find(item => item.id === 'invalid')?.priority).toBe('deferred');
  });
});
