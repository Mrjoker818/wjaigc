import { describe, expect, it } from 'vitest';
import {
  createCanvasDocumentSnapshot,
  executeCanvasCommand,
  isCanvasTaskProjectionChange,
  type CanvasCommandNode,
} from '@/lib/canvas-kernel/commands';

const node = (id: string, x: number, y: number, extras: Partial<CanvasCommandNode> = {}): CanvasCommandNode => ({
  id,
  x,
  y,
  width: 100,
  height: 80,
  ...extras,
});

describe('canvas commands', () => {
  it('moves multiple nodes immutably and returns an exact inverse', () => {
    const original = createCanvasDocumentSnapshot([node('a', 10, 20), node('b', 100, 120)]);
    const moved = executeCanvasCommand(original, {
      type: 'move',
      ids: ['a', 'b'],
      delta: { x: 40, y: 30 },
    });

    expect(moved.next).not.toBe(original);
    expect(moved.next.byId.a).toMatchObject({ x: 50, y: 50 });
    expect(moved.next.byId.b).toMatchObject({ x: 140, y: 150 });
    expect(original.byId.a).toMatchObject({ x: 10, y: 20 });
    expect(executeCanvasCommand(moved.next, moved.inverse).next).toEqual(original);
    expect(moved.affectedIds).toEqual(['a', 'b']);
    expect(moved.persistence).toBe('schedule');
  });

  it('supports add, delete, duplicate and their inverse commands', () => {
    const original = createCanvasDocumentSnapshot([node('a', 0, 0), node('b', 120, 0)]);
    const added = executeCanvasCommand(original, { type: 'add', nodes: [node('c', 240, 0)] });
    expect(added.next.order).toEqual(['a', 'b', 'c']);
    expect(executeCanvasCommand(added.next, added.inverse).next).toEqual(original);

    const deleted = executeCanvasCommand(original, { type: 'delete', ids: ['a'] });
    expect(deleted.next.order).toEqual(['b']);
    expect(executeCanvasCommand(deleted.next, deleted.inverse).next).toEqual(original);

    const duplicated = executeCanvasCommand(original, {
      type: 'duplicate',
      nodes: [node('a-copy', 24, 24, { sourceId: 'a' })],
    });
    expect(duplicated.next.order).toEqual(['a', 'b', 'a-copy']);
    expect(executeCanvasCommand(duplicated.next, duplicated.inverse).next).toEqual(original);
  });

  it('restores the exact layer order when deleted IDs arrive out of order', () => {
    const original = createCanvasDocumentSnapshot([
      node('a', 0, 0),
      node('b', 100, 0),
      node('c', 200, 0),
      node('d', 300, 0),
      node('e', 400, 0),
    ]);

    const deleted = executeCanvasCommand(original, { type: 'delete', ids: ['d', 'b'] });
    expect(executeCanvasCommand(deleted.next, deleted.inverse).next).toEqual(original);
  });

  it('supports resize, reorder and per-node group restoration', () => {
    const original = createCanvasDocumentSnapshot([
      node('a', 0, 0, { groupId: 'old-a', zIndex: 1 }),
      node('b', 120, 0, { groupId: 'old-b', zIndex: 2 }),
    ]);
    const resized = executeCanvasCommand(original, {
      type: 'resize',
      id: 'a',
      bounds: { x: 5, y: 6, width: 240, height: 180 },
    });
    expect(resized.next.byId.a).toMatchObject({ x: 5, y: 6, width: 240, height: 180 });
    expect(executeCanvasCommand(resized.next, resized.inverse).next).toEqual(original);

    const reordered = executeCanvasCommand(original, { type: 'reorder', order: ['b', 'a'] });
    expect(reordered.next.order).toEqual(['b', 'a']);
    expect(reordered.next.byId.b.zIndex).toBe(0);
    expect(executeCanvasCommand(reordered.next, reordered.inverse).next).toEqual(original);

    const grouped = executeCanvasCommand(original, {
      type: 'assign-group',
      ids: ['a', 'b'],
      groupId: 'new-group',
    });
    expect(grouped.next.byId.a.groupId).toBe('new-group');
    expect(grouped.next.byId.b.groupId).toBe('new-group');
    expect(executeCanvasCommand(grouped.next, grouped.inverse).next).toEqual(original);
  });

  it('projects task results without recording transient progress', () => {
    const original = createCanvasDocumentSnapshot([
      node('slot', 0, 0, { processing: { status: 'processing', progress: 40 } }),
    ]);
    const progress = executeCanvasCommand(original, {
      type: 'task-result',
      id: 'slot',
      patch: { processing: { status: 'processing', progress: 60 } },
      terminal: false,
    });
    expect(progress.history).toBe('skip');
    expect(progress.persistence).toBe('skip');

    const completed = executeCanvasCommand(progress.next, {
      type: 'task-result',
      id: 'slot',
      patch: { url: '/result.png', processing: undefined },
      terminal: true,
    });
    expect(completed.history).toBe('record');
    expect(completed.persistence).toBe('immediate');
    expect(executeCanvasCommand(completed.next, completed.inverse).next).toEqual(progress.next);
  });

  it('rejects duplicate IDs, missing nodes and invalid reorder sets', () => {
    const original = createCanvasDocumentSnapshot([node('a', 0, 0), node('b', 100, 0)]);
    expect(() => executeCanvasCommand(original, { type: 'add', nodes: [node('a', 1, 1)] })).toThrow(/already exists/i);
    expect(() => executeCanvasCommand(original, { type: 'move', ids: ['missing'], delta: { x: 1, y: 1 } })).toThrow(/missing/i);
    expect(() => executeCanvasCommand(original, { type: 'reorder', order: ['a'] })).toThrow(/same node ids/i);
  });

  it('skips task progress but records geometry changes on processing nodes', () => {
    const before = [{
      id: 'task-a', x: 0, y: 0, width: 100, height: 100,
      isProcessingPlaceholder: true,
      processing: { status: 'processing', progress: 10 },
    }];

    expect(isCanvasTaskProjectionChange(before, [{
      ...before[0],
      processing: { status: 'processing', progress: 40 },
    }])).toBe(true);
    expect(isCanvasTaskProjectionChange(before, [{
      ...before[0],
      x: 30,
    }])).toBe(false);
  });
});
