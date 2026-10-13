export const SKETCH_COLORS = Object.freeze([
  '#111827', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6',
] as const);
export const SKETCH_WIDTHS = Object.freeze([2, 5, 10] as const);

export interface SketchPoint { readonly x: number; readonly y: number }
export interface SketchStroke {
  readonly id: string;
  readonly tool: 'pen' | 'eraser';
  readonly color: typeof SKETCH_COLORS[number];
  readonly width: typeof SKETCH_WIDTHS[number];
  readonly points: readonly SketchPoint[];
}
export interface SketchDocument {
  readonly width: number;
  readonly height: number;
  readonly strokes: readonly SketchStroke[];
}
export interface SketchHistory {
  readonly past: readonly SketchDocument[];
  readonly present: SketchDocument;
  readonly future: readonly SketchDocument[];
}

const HISTORY_LIMIT = 50;
const STROKE_LIMIT = 200;
const POINT_LIMIT = 2048;

function assertDimensions(width: number, height: number): void {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 2048)) {
    throw new Error('SKETCH_DIMENSIONS_INVALID');
  }
}

function freezeStroke(stroke: SketchStroke, width: number, height: number): SketchStroke {
  if (typeof stroke.id !== 'string' || !stroke.id.trim() || stroke.id.length > 96
    || !['pen', 'eraser'].includes(stroke.tool)
    || !SKETCH_COLORS.includes(stroke.color) || !SKETCH_WIDTHS.includes(stroke.width)
    || !Array.isArray(stroke.points) || stroke.points.length === 0 || stroke.points.length > POINT_LIMIT) {
    throw new Error('SKETCH_STROKE_INVALID');
  }
  const points = Array.from({ length: stroke.points.length }, (_, index): SketchPoint => {
    const point = stroke.points[index];
    if (!Object.hasOwn(stroke.points, index) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.y < 0 || point.x > width || point.y > height) {
      throw new Error('SKETCH_POINT_INVALID');
    }
    return Object.freeze({ x: point.x, y: point.y });
  });
  return Object.freeze({ id: stroke.id, tool: stroke.tool, color: stroke.color,
    width: stroke.width, points: Object.freeze(points) });
}

function freezeDocument(width: number, height: number, strokes: readonly SketchStroke[]): SketchDocument {
  return Object.freeze({ width, height, strokes: Object.freeze([...strokes]) });
}

function freezeHistory(
  past: readonly SketchDocument[], present: SketchDocument, future: readonly SketchDocument[],
): SketchHistory {
  return Object.freeze({ past: Object.freeze([...past].slice(-HISTORY_LIMIT)), present,
    future: Object.freeze([...future].slice(0, HISTORY_LIMIT)) });
}

export function createSketchHistory(width = 1024, height = 768): SketchHistory {
  assertDimensions(width, height);
  return freezeHistory([], freezeDocument(width, height, []), []);
}

export function appendSketchStroke(history: SketchHistory, stroke: SketchStroke): SketchHistory {
  const document = history.present;
  assertDimensions(document.width, document.height);
  if (document.strokes.length >= STROKE_LIMIT) throw new Error('SKETCH_STROKE_LIMIT');
  if (document.strokes.some(existing => existing.id === stroke.id)) throw new Error('SKETCH_STROKE_ID_DUPLICATE');
  const nextStroke = freezeStroke(stroke, document.width, document.height);
  return freezeHistory([...history.past, document],
    freezeDocument(document.width, document.height, [...document.strokes, nextStroke]), []);
}

export function undoSketch(history: SketchHistory): SketchHistory {
  if (history.past.length === 0) return history;
  return freezeHistory(history.past.slice(0, -1), history.past[history.past.length - 1],
    [history.present, ...history.future]);
}

export function redoSketch(history: SketchHistory): SketchHistory {
  if (history.future.length === 0) return history;
  return freezeHistory([...history.past, history.present], history.future[0], history.future.slice(1));
}

export function clearSketch(history: SketchHistory): SketchHistory {
  if (history.present.strokes.length === 0) return history;
  return freezeHistory([...history.past, history.present],
    freezeDocument(history.present.width, history.present.height, []), []);
}
