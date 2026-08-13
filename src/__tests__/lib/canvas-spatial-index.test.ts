import { describe, expect, it } from 'vitest';

import { CanvasSpatialIndex } from '@/lib/canvas-spatial-index';

const image = (id: string, x: number, y: number) => ({
  id,
  x,
  y,
  width: 40,
  height: 40,
});

describe('CanvasSpatialIndex incremental updates', () => {
  it('rebuilds once for hydration and applies one hundred changes incrementally', () => {
    const index = new CanvasSpatialIndex();
    const initial = Array.from({ length: 100 }, (_, itemIndex) => (
      image(`image-${itemIndex}`, itemIndex * 50, 0)
    ));

    index.rebuild(initial);
    index.applyChanges(initial.map(item => ({
      type: 'upsert' as const,
      image: { ...item, y: 100 },
    })));

    expect(index.rebuildCount).toBe(1);
    expect(index.incrementalUpdateCount).toBe(100);
    expect(index.searchInBounds(0, 90, 5_000, 150)).toHaveLength(100);
    expect(index.searchInBounds(0, 0, 5_000, 50)).toHaveLength(0);
  });

  it('adds, updates and removes a mixed batch without rebuilding', () => {
    const index = new CanvasSpatialIndex();
    index.rebuild([image('keep', 0, 0), image('remove', 100, 100)]);

    index.applyChanges([
      { type: 'upsert', image: image('keep', 200, 200) },
      { type: 'upsert', image: image('added', 300, 300) },
      { type: 'remove', id: 'remove' },
    ]);

    expect(index.rebuildCount).toBe(1);
    expect(index.incrementalUpdateCount).toBe(3);
    expect(index.size).toBe(2);
    expect(index.searchInBounds(190, 190, 250, 250)).toEqual(['keep']);
    expect(index.searchInBounds(90, 90, 150, 150)).toEqual([]);
  });

  it('ignores invalid geometry instead of poisoning the tree', () => {
    const index = new CanvasSpatialIndex();
    index.rebuild([image('valid', 0, 0)]);

    index.applyChanges([
      { type: 'upsert', image: { ...image('invalid', 0, 0), width: Number.NaN } },
    ]);

    expect(index.size).toBe(1);
    expect(index.incrementalUpdateCount).toBe(1);
  });
});
