import { describe, expect, it } from 'vitest';
import {
  beginPan,
  cancelPan,
  canvasToScreen,
  commitPan,
  createCanvasViewportState,
  fitContent,
  previewPan,
  screenToCanvas,
  zoomAtPoint,
} from '@/lib/canvas-kernel/viewport';

describe('canvas kernel viewport', () => {
  const initial = createCanvasViewportState({ offsetX: 0, offsetY: 0, zoom: 1 });

  it('previews and commits a pointer-owned pan', () => {
    const started = beginPan(initial, { pointerId: 7, clientX: 100, clientY: 80 });
    const preview = previewPan(started, { pointerId: 7, clientX: 460, clientY: 300 });

    expect(preview.preview).toEqual({ x: 360, y: 220 });
    expect(commitPan(preview, { pointerId: 7 }).committed).toEqual(preview.preview);
  });

  it('ignores a different pointer and restores the committed view on cancel', () => {
    const started = beginPan(initial, { pointerId: 7, clientX: 100, clientY: 80 });
    expect(previewPan(started, { pointerId: 8, clientX: 460, clientY: 300 })).toBe(started);
    expect(commitPan(started, { pointerId: 8 })).toBe(started);

    const preview = previewPan(started, { pointerId: 7, clientX: -900, clientY: -720 });
    expect(preview.preview).toEqual({ x: -1000, y: -800 });
    expect(cancelPan(preview, { pointerId: 7 })).toMatchObject({
      committed: { x: 0, y: 0 },
      preview: { x: 0, y: 0 },
      interaction: { kind: 'idle' },
    });
  });

  it('keeps the canvas coordinate beneath the zoom anchor stable', () => {
    const before = screenToCanvas(initial, { x: 400, y: 300 });
    const zoomed = zoomAtPoint(initial, { x: 400, y: 300 }, 1.5);

    expect(screenToCanvas(zoomed, { x: 400, y: 300 })).toEqual(before);
    expect(canvasToScreen(zoomed, before)).toEqual({ x: 400, y: 300 });
  });

  it('clamps zoom and preserves finite negative coordinates', () => {
    const translated = createCanvasViewportState({ offsetX: -2400, offsetY: -1300, zoom: 1 });
    expect(zoomAtPoint(translated, { x: -120, y: -80 }, 0.001).zoom).toBe(0.1);
    expect(zoomAtPoint(translated, { x: -120, y: -80 }, 50).zoom).toBe(5);

    const canvasPoint = screenToCanvas(translated, { x: -320, y: -180 });
    expect(canvasToScreen(translated, canvasPoint)).toEqual({ x: -320, y: -180 });
  });

  it('fits the same content deterministically after a viewport resize', () => {
    const content = [{ x: 2100, y: 900, width: 600, height: 300 }];
    const compact = fitContent(initial, content, { width: 800, height: 600 });
    const wide = fitContent(compact, content, { width: 1600, height: 900 });

    expect(compact.zoom).toBeLessThanOrEqual(wide.zoom);
    for (const state of [compact, wide]) {
      const topLeft = canvasToScreen(state, { x: 2100, y: 900 });
      const bottomRight = canvasToScreen(state, { x: 2700, y: 1200 });
      expect(topLeft.x).toBeGreaterThanOrEqual(0);
      expect(topLeft.y).toBeGreaterThanOrEqual(0);
      expect(bottomRight.x).toBeLessThanOrEqual(state === compact ? 800 : 1600);
      expect(bottomRight.y).toBeLessThanOrEqual(state === compact ? 600 : 900);
    }
  });
});
