import { describe, expect, it } from 'vitest';
import { createCanvasDocumentSnapshot, executeCanvasCommand } from '@/lib/canvas-kernel/commands';
import {
  CanvasHistoryController,
  isCanvasHistoryTransitionCurrent,
} from '@/lib/canvas-kernel/history';

const original = createCanvasDocumentSnapshot([{ id: 'a', x: 0, y: 0, width: 100, height: 100 }]);

describe('canvas history controller', () => {
  it('commits every pointer transaction as exactly one undo step', () => {
    const history = new CanvasHistoryController(original, 50);
    history.begin('drag:7');
    history.record(executeCanvasCommand(history.current(), { type: 'move', ids: ['a'], delta: { x: 10, y: 5 } }));
    history.record(executeCanvasCommand(history.current(), { type: 'move', ids: ['a'], delta: { x: 20, y: 15 } }));
    history.commit('drag:7');

    expect(history.getCounts()).toEqual({ undo: 1, redo: 0 });
    expect(history.undo().byId.a).toMatchObject({ x: 0, y: 0 });
    expect(history.redo().byId.a).toMatchObject({ x: 30, y: 20 });
  });

  it('rolls back pointer cancellation without creating history', () => {
    const history = new CanvasHistoryController(original);
    history.begin('resize:9');
    history.record(executeCanvasCommand(history.current(), {
      type: 'resize',
      id: 'a',
      bounds: { x: 0, y: 0, width: 300, height: 300 },
    }));

    expect(history.rollback('resize:9')).toEqual(original);
    expect(history.getCounts()).toEqual({ undo: 0, redo: 0 });
  });

  it('retains exactly 50 committed steps and redoes all retained steps', () => {
    const history = new CanvasHistoryController(original, 50);
    for (let index = 1; index <= 60; index += 1) {
      history.record(executeCanvasCommand(history.current(), {
        type: 'move',
        ids: ['a'],
        delta: { x: 1, y: 1 },
      }));
    }
    expect(history.getCounts()).toEqual({ undo: 50, redo: 0 });
    for (let index = 0; index < 50; index += 1) history.undo();
    expect(history.current().byId.a).toMatchObject({ x: 10, y: 10 });
    for (let index = 0; index < 50; index += 1) history.redo();
    expect(history.current().byId.a).toMatchObject({ x: 60, y: 60 });
  });

  it('skips hydration and progress while project reset clears both stacks', () => {
    const history = new CanvasHistoryController(original);
    history.record(executeCanvasCommand(history.current(), {
      type: 'task-result',
      id: 'a',
      patch: { processing: { status: 'processing', progress: 50 } },
      terminal: false,
    }));
    expect(history.getCounts()).toEqual({ undo: 0, redo: 0 });

    history.record(executeCanvasCommand(history.current(), { type: 'move', ids: ['a'], delta: { x: 5, y: 5 } }));
    history.reset(createCanvasDocumentSnapshot([{ id: 'other', x: 9, y: 9, width: 20, height: 20 }]));
    expect(history.getCounts()).toEqual({ undo: 0, redo: 0 });
    expect(history.current().order).toEqual(['other']);
  });

  it('does not include skipped task progress in an active user transaction', () => {
    const history = new CanvasHistoryController(original);
    history.begin('drag:3');
    history.record(executeCanvasCommand(history.current(), {
      type: 'task-result',
      id: 'a',
      patch: { processing: { status: 'processing', progress: 40 } },
      terminal: false,
    }));
    history.record(executeCanvasCommand(history.current(), {
      type: 'move',
      ids: ['a'],
      delta: { x: 20, y: 10 },
    }));
    history.commit('drag:3');

    expect(history.undo().byId.a).toMatchObject({
      x: 0,
      y: 0,
      processing: { status: 'processing', progress: 40 },
    });
  });

  it('rejects nested, mismatched and missing transactions', () => {
    const history = new CanvasHistoryController(original);
    history.begin('drag:1');
    expect(() => history.begin('drag:2')).toThrow(/already active/i);
    expect(() => history.commit('drag:2')).toThrow(/does not match/i);
    history.rollback('drag:1');
    expect(() => history.commit('drag:1')).toThrow(/no active/i);
  });

  it('restores the redo stack when a new gesture is cancelled', () => {
    const history = new CanvasHistoryController(original);
    history.record(executeCanvasCommand(history.current(), {
      type: 'move', ids: ['a'], delta: { x: 10, y: 0 },
    }));
    history.undo();
    expect(history.getCounts()).toEqual({ undo: 0, redo: 1 });

    history.begin('drag:4');
    history.record(executeCanvasCommand(history.current(), {
      type: 'move', ids: ['a'], delta: { x: 30, y: 0 },
    }));
    history.rollback('drag:4');

    expect(history.getCounts()).toEqual({ undo: 0, redo: 1 });
    expect(history.redo().byId.a.x).toBe(10);
  });

  it('invalidates an in-flight project history transition after project switch', () => {
    const transition = { projectId: 'project-a', epoch: 7 };

    expect(isCanvasHistoryTransitionCurrent(transition, 'project-a', 7)).toBe(true);
    expect(isCanvasHistoryTransitionCurrent(transition, 'project-b', 7)).toBe(false);
    expect(isCanvasHistoryTransitionCurrent(transition, 'project-a', 8)).toBe(false);
  });
});
