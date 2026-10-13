import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { appendSketchStroke, createSketchHistory, type SketchDocument } from '@/lib/sketch-to-code/drawing';
import { paintSketch, exportSketchPng, type SketchRenderContext, type SketchExportCanvas } from '@/lib/sketch-to-code/render';

function crossedDrawing(): SketchDocument {
  let history = createSketchHistory(64, 64);
  history = appendSketchStroke(history, { id: 'red', tool: 'pen', color: '#ef4444', width: 10,
    points: [{ x: 10, y: 32 }, { x: 54, y: 32 }] });
  return appendSketchStroke(history, { id: 'erase', tool: 'eraser', color: '#111827', width: 10,
    points: [{ x: 32, y: 10 }, { x: 32, y: 54 }] }).present;
}

// Native Skia implements the same Canvas operations; its gradient/pattern type names differ from DOM's.
function canvasFactory(width: number, height: number): SketchExportCanvas {
  return createCanvas(width, height) as unknown as SketchExportCanvas;
}

describe('sketch PNG renderer with real CPU pixels', () => {
  it('draws the pen and erases only crossed ink on a transparent drawing surface', () => {
    const context = createCanvas(64, 64).getContext('2d');
    paintSketch(context as unknown as SketchRenderContext, crossedDrawing());
    expect([...context.getImageData(16, 32, 1, 1).data]).toEqual([239, 68, 68, 255]);
    expect(context.getImageData(32, 32, 1, 1).data[3]).toBe(0);
    expect(context.getImageData(1, 1, 1, 1).data[3]).toBe(0);
  });

  it('exports a decodable PNG with white paper behind erased and untouched pixels', async () => {
    const url = exportSketchPng(crossedDrawing(), canvasFactory);
    expect(url).toMatch(/^data:image\/png;base64,/);
    const image = await loadImage(url);
    expect([image.width, image.height]).toEqual([64, 64]);
    const context = createCanvas(64, 64).getContext('2d');
    context.drawImage(image, 0, 0);
    expect([...context.getImageData(16, 32, 1, 1).data]).toEqual([239, 68, 68, 255]);
    expect([...context.getImageData(32, 32, 1, 1).data]).toEqual([255, 255, 255, 255]);
    expect([...context.getImageData(1, 1, 1, 1).data]).toEqual([255, 255, 255, 255]);
  });

  it('draws a single click as a dot and clears pixels from a preceding render', () => {
    const context = createCanvas(64, 64).getContext('2d');
    const document = appendSketchStroke(createSketchHistory(64, 64), {
      id: 'dot', tool: 'pen', color: '#3b82f6', width: 10, points: [{ x: 32, y: 32 }],
    }).present;
    paintSketch(context as unknown as SketchRenderContext, document);
    expect([...context.getImageData(32, 32, 1, 1).data]).toEqual([59, 130, 246, 255]);
    paintSketch(context as unknown as SketchRenderContext, createSketchHistory(64, 64).present);
    expect(context.getImageData(32, 32, 1, 1).data[3]).toBe(0);
  });

  it('normalizes inherited drawing state and restores it afterward', () => {
    const context = createCanvas(64, 64).getContext('2d');
    context.globalCompositeOperation = 'xor'; context.globalAlpha = 0.1;
    context.translate(8, 8);
    paintSketch(context as unknown as SketchRenderContext, crossedDrawing());
    expect([...context.getImageData(16, 32, 1, 1).data]).toEqual([239, 68, 68, 255]);
    expect(context.globalCompositeOperation).toBe('xor');
    expect(context.globalAlpha).toBeCloseTo(0.1);
    expect(context.getTransform().e).toBe(8);
  });

  it('rejects export when no 2D context is available', () => {
    expect(() => exportSketchPng(createSketchHistory().present, () => ({
      width: 0, height: 0, getContext: () => null, toDataURL: () => 'data:image/png;base64,',
    }))).toThrow('SKETCH_CONTEXT_UNAVAILABLE');
  });

  it('removes inherited line dashes for pen and eraser while restoring the caller state', () => {
    const context = createCanvas(64, 64).getContext('2d');
    context.setLineDash([2, 40]); context.lineDashOffset = 5;
    paintSketch(context as unknown as SketchRenderContext, crossedDrawing());
    expect(Array.from({ length: 13 }, (_, i) => context.getImageData(14 + i, 32, 1, 1).data[3]))
      .toEqual(Array.from({ length: 13 }, () => 255));
    let dot = appendSketchStroke(createSketchHistory(64, 64), { id: 'dot', tool: 'pen',
      color: '#ef4444', width: 10, points: [{ x: 32, y: 32 }] });
    dot = appendSketchStroke(dot, { id: 'erase', tool: 'eraser', color: '#111827', width: 10,
      points: [{ x: 32, y: 10 }, { x: 32, y: 54 }] });
    paintSketch(context as unknown as SketchRenderContext, dot.present);
    expect(context.getImageData(32, 32, 1, 1).data[3]).toBe(0);
    expect(context.getLineDash()).toEqual([2, 40]);
    expect(context.lineDashOffset).toBe(5);
  });
});
