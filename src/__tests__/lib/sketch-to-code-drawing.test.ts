import { describe, expect, it } from 'vitest';
import {
  SKETCH_COLORS, SKETCH_WIDTHS, createSketchHistory, appendSketchStroke,
  undoSketch, redoSketch, clearSketch, type SketchStroke, type SketchPoint,
} from '@/lib/sketch-to-code/drawing';

function stroke(id = 'stroke-1'): SketchStroke {
  return { id, tool: 'pen', color: '#111827', width: 2, points: [{ x: 10, y: 20 }] };
}

describe('sketch drawing history', () => {
  it('exposes the requested eight colors and three widths', () => {
    expect(SKETCH_COLORS).toEqual(['#111827', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6']);
    expect(SKETCH_WIDTHS).toEqual([2, 5, 10]);
    expect(createSketchHistory().present).toEqual({ width: 1024, height: 768, strokes: [] });
  });

  it('appends, undoes and redoes without mutating previous history', () => {
    const empty = createSketchHistory();
    const drawn = appendSketchStroke(empty, stroke());
    expect(empty.present.strokes).toEqual([]);
    expect(drawn.present.strokes).toEqual([stroke()]);
    const undone = undoSketch(drawn);
    expect(undone.present.strokes).toEqual([]);
    expect(redoSketch(undone).present).toEqual(drawn.present);
  });

  it('clears reversibly and avoids a history step for empty clear', () => {
    const empty = createSketchHistory();
    expect(clearSketch(empty)).toBe(empty);
    const drawn = appendSketchStroke(empty, stroke());
    const cleared = clearSketch(drawn);
    expect(cleared.present.strokes).toEqual([]);
    expect(undoSketch(cleared).present).toEqual(drawn.present);
    expect(redoSketch(undoSketch(cleared)).present.strokes).toEqual([]);
  });

  it('drops the redo branch when a new stroke follows undo', () => {
    const drawn = appendSketchStroke(createSketchHistory(), stroke());
    const branch = appendSketchStroke(undoSketch(drawn), stroke('replacement'));
    expect(branch.future).toEqual([]);
    expect(redoSketch(branch)).toBe(branch);
    expect(branch.present.strokes[0].id).toBe('replacement');
  });

  it('does not retain caller-owned point or stroke objects', () => {
    const input = { ...stroke(), points: [{ x: 10, y: 20 }] };
    const drawn = appendSketchStroke(createSketchHistory(), input);
    input.points[0].x = 99; input.points.push({ x: 30, y: 40 }); input.id = 'changed';
    expect(drawn.present.strokes).toEqual([stroke()]);
    expect(Object.isFrozen(drawn.present.strokes[0].points[0])).toBe(true);
  });

  it('retains only fifty reversible operations', () => {
    let history = createSketchHistory();
    for (let i = 0; i < 60; i += 1) history = appendSketchStroke(history, stroke('s' + i));
    expect(history.past).toHaveLength(50);
    for (let i = 0; i < 50; i += 1) history = undoSketch(history);
    expect(history.present.strokes).toHaveLength(10);
    expect(undoSketch(history)).toBe(history);
    expect(history.future).toHaveLength(50);
  });

  it('accepts eraser strokes and rejects duplicate ids', () => {
    const eraser: SketchStroke = { ...stroke(), tool: 'eraser' };
    const history = appendSketchStroke(createSketchHistory(), eraser);
    expect(history.present.strokes[0].tool).toBe('eraser');
    expect(() => appendSketchStroke(history, eraser)).toThrow();
  });

  it.each([0, -1, 2049, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid dimensions %s', value => {
    expect(() => createSketchHistory(value, 768)).toThrow();
    expect(() => createSketchHistory(1024, value)).toThrow();
  });

  it.each([{ x: -1, y: 0 }, { x: 1025, y: 0 }, { x: 0, y: 769 }, { x: Number.NaN, y: 0 }, { x: 0, y: Number.POSITIVE_INFINITY }])(
    'rejects invalid coordinates %j', point => {
      expect(() => appendSketchStroke(createSketchHistory(), { ...stroke(), points: [point] })).toThrow();
    },
  );

  it('rejects empty and oversized strokes, ids, widths and colors', () => {
    const history = createSketchHistory();
    expect(() => appendSketchStroke(history, { ...stroke(), points: [] })).toThrow();
    expect(() => appendSketchStroke(history, { ...stroke(), points: Array.from({ length: 2049 }, () => ({ x: 1, y: 1 })) })).toThrow();
    expect(() => appendSketchStroke(history, { ...stroke(), id: '' })).toThrow();
    expect(() => appendSketchStroke(history, { ...stroke(), id: 'x'.repeat(97) })).toThrow();
    expect(() => appendSketchStroke(history, { ...stroke(), width: 999 } as unknown as SketchStroke)).toThrow();
    expect(() => appendSketchStroke(history, { ...stroke(), color: 'url(x)' } as unknown as SketchStroke)).toThrow();
  });

  it('limits a document to two hundred strokes', () => {
    let history = createSketchHistory();
    for (let i = 0; i < 200; i += 1) history = appendSketchStroke(history, stroke('s' + i));
    expect(() => appendSketchStroke(history, stroke('overflow'))).toThrow();
    expect(history.present.strokes).toHaveLength(200);
  });

  it('rejects a missing first point in a sparse array', () => {
    expect(() => appendSketchStroke(createSketchHistory(), {
      ...stroke(), points: new Array<SketchPoint>(1),
    })).toThrow('SKETCH_POINT_INVALID');
  });

  it('rejects missing intermediate points rather than admitting a broken path', () => {
    const points = new Array<SketchPoint>(3);
    points[0] = { x: 10, y: 20 }; points[2] = { x: 30, y: 40 };
    expect(() => appendSketchStroke(createSketchHistory(), { ...stroke(), points })).toThrow('SKETCH_POINT_INVALID');
  });
});
