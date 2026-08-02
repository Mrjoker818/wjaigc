import { describe, expect, it } from 'vitest';

import { IncrementalHistoryManager } from '@/lib/canvas-incremental-history';

interface ImageNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

describe('incremental canvas history', () => {
  it('restores a deleted canvas node and removes it again on redo', () => {
    const history = new IncrementalHistoryManager<ImageNode>();
    const original: ImageNode[] = [{
      id: 'image-1',
      x: 120,
      y: 80,
      width: 320,
      height: 180,
    }];

    history.recordChange(original, []);

    expect(history.undo([])).toEqual(original);
    expect(history.redo(original)).toEqual([]);
  });
});
