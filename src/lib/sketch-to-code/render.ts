import { createSketchHistory, type SketchDocument } from './drawing';

export type SketchRenderContext = Pick<CanvasRenderingContext2D,
  'save' | 'restore' | 'setTransform' | 'clearRect' | 'globalAlpha' | 'globalCompositeOperation'
  | 'filter' | 'shadowBlur' | 'shadowOffsetX' | 'shadowOffsetY' | 'lineCap' | 'lineJoin'
  | 'lineWidth' | 'setLineDash' | 'lineDashOffset' | 'strokeStyle' | 'fillStyle' | 'beginPath' | 'moveTo' | 'lineTo'
  | 'stroke' | 'arc' | 'fill' | 'fillRect'>;

export interface SketchExportCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): SketchRenderContext | null;
  toDataURL(type: 'image/png'): string;
}

export function paintSketch(context: SketchRenderContext, sketch: SketchDocument, whitePaper = false): void {
  // Validate allocation dimensions with the same limits used by the drawing controller.
  createSketchHistory(sketch.width, sketch.height);
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1; context.filter = 'none';
    context.shadowBlur = 0; context.shadowOffsetX = 0; context.shadowOffsetY = 0;
    context.clearRect(0, 0, sketch.width, sketch.height);
    context.lineCap = 'round'; context.lineJoin = 'round';
    context.setLineDash([]); context.lineDashOffset = 0;
    for (const stroke of sketch.strokes) {
      context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
      context.lineWidth = stroke.width; context.strokeStyle = stroke.color; context.fillStyle = stroke.color;
      context.beginPath();
      const first = stroke.points[0];
      if (stroke.points.length === 1) {
        context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.moveTo(first.x, first.y);
        for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
        context.stroke();
      }
    }
    if (whitePaper) {
      context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#ffffff';
      context.fillRect(0, 0, sketch.width, sketch.height);
    }
  } finally { context.restore(); }
}

function createBrowserCanvas(width: number, height: number): SketchExportCanvas {
  if (typeof document === 'undefined') throw new Error('SKETCH_EXPORT_BROWSER_REQUIRED');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

export function exportSketchPng(
  sketch: SketchDocument,
  createCanvas: (width: number, height: number) => SketchExportCanvas = createBrowserCanvas,
): string {
  createSketchHistory(sketch.width, sketch.height);
  const canvas = createCanvas(sketch.width, sketch.height);
  canvas.width = sketch.width; canvas.height = sketch.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('SKETCH_CONTEXT_UNAVAILABLE');
  paintSketch(context, sketch, true);
  return canvas.toDataURL('image/png');
}
