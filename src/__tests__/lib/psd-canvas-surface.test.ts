import { describe, expect, it, vi } from 'vitest';

import {
  drawPsdCanvasSurface,
  resolvePsdLayerBounds,
} from '@/lib/psd-canvas-surface';

describe('PSD canvas surface', () => {
  it('uses the checker pattern for the editable document area so hidden layers reveal transparency', () => {
    const checker = {} as CanvasPattern;
    const context: {
      fillStyle: string | CanvasPattern | CanvasGradient;
      shadowColor: string;
      shadowBlur: number;
      shadowOffsetX: number;
      shadowOffsetY: number;
      fillRect: ReturnType<typeof vi.fn>;
    } = {
      fillStyle: '',
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      fillRect: vi.fn(),
    };

    drawPsdCanvasSurface(context, 640, 480, checker);

    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 640, 480);
    expect(context.fillStyle).toBe(checker);
    expect(context.shadowColor).toBe('transparent');
  });

  it('uses the absolute layer offset once for drawing, selection and hit testing', () => {
    expect(resolvePsdLayerBounds({
      offsetX: 120,
      offsetY: 90,
      boundingBox: { x: 120, y: 90, width: 240, height: 180 },
    }, 240, 180)).toEqual({
      x: 120,
      y: 90,
      width: 240,
      height: 180,
    });
  });

  it('keeps the full drawn image hit area when a layer starts outside the document', () => {
    expect(resolvePsdLayerBounds({
      offsetX: -10,
      offsetY: -5,
      boundingBox: { x: 0, y: 0, width: 90, height: 75 },
    }, 100, 80)).toEqual({
      x: -10,
      y: -5,
      width: 100,
      height: 80,
    });
  });
});
