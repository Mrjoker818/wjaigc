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

  it('commits a multi-update gesture as one undo and redo step', () => {
    const history = new IncrementalHistoryManager<ImageNode>();
    const original = [nodeAt(0)];
    const preview = [nodeAt(20)];
    const completed = [nodeAt(60)];

    history.beginTransaction('drag:7');
    history.recordChange(original, preview);
    history.recordChange(preview, completed);
    history.commitTransaction('drag:7');

    expect(history.undo(completed)).toEqual(original);
    expect(history.undo(original)).toEqual(original);
    expect(history.redo(original)).toEqual(completed);
  });

  it('rolls back an interrupted gesture without creating an undo step', () => {
    const history = new IncrementalHistoryManager<ImageNode>();
    const original = [nodeAt(0)];
    const preview = [nodeAt(45)];

    history.beginTransaction('drag:9');
    history.recordChange(original, preview);

    const rolledBack = history.rollbackTransaction('drag:9', preview);
    expect(rolledBack).toEqual(original);
    expect(history.undo(rolledBack)).toEqual(original);
  });

  it('retains only the latest 50 discrete history steps', () => {
    const history = new IncrementalHistoryManager<ImageNode>(50);
    let current = [nodeAt(0)];

    for (let index = 1; index <= 60; index += 1) {
      const next = [nodeAt(index)];
      history.recordChange(current, next);
      current = next;
    }

    for (let index = 0; index < 50; index += 1) {
      current = history.undo(current);
    }

    expect(current).toEqual([nodeAt(10)]);
    expect(history.undo(current)).toEqual(current);
  });

  it('restores deleted nodes at their original layer positions', () => {
    const history = new IncrementalHistoryManager<ImageNode>();
    const original = [nodeWithId('a', 0), nodeWithId('b', 10), nodeWithId('c', 20)];
    const afterDelete = [original[0], original[2]];

    history.recordChange(original, afterDelete);

    expect(history.undo(afterDelete)).toEqual(original);
  });
});

function nodeAt(x: number): ImageNode {
  return {
    id: 'image-1',
    x,
    y: x,
    width: 320,
    height: 180,
  };
}

function nodeWithId(id: string, x: number): ImageNode {
  return { ...nodeAt(x), id };
}
