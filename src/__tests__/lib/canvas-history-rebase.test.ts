import { describe, expect, it } from 'vitest';
import {
  createCanvasDocumentSnapshot,
  rebaseCanvasSnapshotChanges,
  replayQueuedCanvasSnapshotChange,
} from '@/lib/canvas-kernel/commands';

describe('canvas history async rebase', () => {
  it('keeps system task progress that arrives while placement undo is pending', () => {
    const before = createCanvasDocumentSnapshot([{
      id: 'a', x: 40, y: 20, width: 100, height: 80,
      processing: { status: 'processing', progress: 10 },
    }]);
    const undoTarget = createCanvasDocumentSnapshot([{
      id: 'a', x: 0, y: 0, width: 100, height: 80,
      processing: { status: 'processing', progress: 10 },
    }]);
    const latest = createCanvasDocumentSnapshot([{
      id: 'a', x: 40, y: 20, width: 100, height: 80,
      processing: { status: 'processing', progress: 65 },
    }]);

    expect(rebaseCanvasSnapshotChanges(undoTarget, before, latest).byId.a).toMatchObject({
      x: 0,
      y: 0,
      processing: { status: 'processing', progress: 65 },
    });
  });

  it('keeps a user-undone node removed while accepting a concurrent add', () => {
    const before = createCanvasDocumentSnapshot([
      { id: 'a', x: 0, y: 0, width: 10, height: 10 },
    ]);
    const undoTarget = createCanvasDocumentSnapshot([]);
    const latest = createCanvasDocumentSnapshot([
      { id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', x: 20, y: 0, width: 10, height: 10 },
    ]);

    const rebased = rebaseCanvasSnapshotChanges(undoTarget, before, latest);
    expect(rebased.order).toEqual(['b']);
    expect(rebased.byId.a).toBeUndefined();
    expect(rebased.byId.b).toBeDefined();
  });

  it('accepts a concurrent removal without dropping a user-added node', () => {
    const before = createCanvasDocumentSnapshot([
      { id: 'a', x: 0, y: 0, width: 10, height: 10 },
    ]);
    const redoTarget = createCanvasDocumentSnapshot([
      { id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', x: 20, y: 0, width: 10, height: 10 },
    ]);
    const latest = createCanvasDocumentSnapshot([]);

    const rebased = rebaseCanvasSnapshotChanges(redoTarget, before, latest);
    expect(rebased.order).toEqual(['b']);
    expect(rebased.byId.a).toBeUndefined();
    expect(rebased.byId.b).toBeDefined();
  });

  it('accepts a concurrent reorder when the history target did not reorder nodes', () => {
    const before = createCanvasDocumentSnapshot([
      { id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', x: 20, y: 0, width: 10, height: 10 },
    ]);
    const target = createCanvasDocumentSnapshot([
      { id: 'a', x: 5, y: 0, width: 10, height: 10 },
      { id: 'b', x: 20, y: 0, width: 10, height: 10 },
    ]);
    const latest = { byId: { ...before.byId }, order: ['b', 'a'] };

    expect(rebaseCanvasSnapshotChanges(target, before, latest).order).toEqual(['b', 'a']);
  });

  it('replays a queued user move over the completed history transition', () => {
    const before = createCanvasDocumentSnapshot([
      { id: 'a', x: 10, y: 0, width: 10, height: 10 },
    ]);
    const after = createCanvasDocumentSnapshot([
      { id: 'a', x: 20, y: 0, width: 10, height: 10 },
    ]);
    const historyTarget = createCanvasDocumentSnapshot([
      { id: 'a', x: 0, y: 0, width: 10, height: 10 },
    ]);

    const replayed = replayQueuedCanvasSnapshotChange('project-a', historyTarget, {
      projectId: 'project-a',
      before,
      after,
    });

    expect(replayed?.byId.a.x).toBe(20);
  });

  it('discards a queued user change after switching projects', () => {
    const oldProject = createCanvasDocumentSnapshot([
      { id: 'old', x: 0, y: 0, width: 10, height: 10 },
    ]);
    const oldProjectAfter = createCanvasDocumentSnapshot([
      { id: 'old', x: 20, y: 0, width: 10, height: 10 },
    ]);
    const newProject = createCanvasDocumentSnapshot([
      { id: 'new', x: 0, y: 0, width: 10, height: 10 },
    ]);

    expect(replayQueuedCanvasSnapshotChange('project-b', newProject, {
      projectId: 'project-a',
      before: oldProject,
      after: oldProjectAfter,
    })).toBeNull();
  });

  it('replays queued resize and reorder while preserving concurrent task progress', () => {
    const before = createCanvasDocumentSnapshot([
      { id: 'a', x: 10, y: 0, width: 10, height: 10, processing: { progress: 10 } },
      { id: 'b', x: 30, y: 0, width: 10, height: 10 },
    ]);
    const after = {
      byId: {
        ...before.byId,
        a: { ...before.byId.a, width: 40, height: 30 },
      },
      order: ['b', 'a'],
    };
    const latest = createCanvasDocumentSnapshot([
      { id: 'a', x: 0, y: 0, width: 10, height: 10, processing: { progress: 80 } },
      { id: 'b', x: 30, y: 0, width: 10, height: 10 },
    ]);

    const replayed = replayQueuedCanvasSnapshotChange('project-a', latest, {
      projectId: 'project-a',
      before,
      after,
    });

    expect(replayed?.order).toEqual(['b', 'a']);
    expect(replayed?.byId.a).toMatchObject({
      x: 0,
      width: 40,
      height: 30,
      processing: { progress: 80 },
    });
  });
});
