import { describe, expect, it, vi } from 'vitest';

import * as psdCanvasSurface from '@/lib/psd-canvas-surface';

const {
  drawPsdCanvasSurface,
  resolvePsdLayerBounds,
} = psdCanvasSurface;

type PointerTarget = {
  id: string;
  visible: boolean;
  locked: boolean;
  bounds: { x: number; y: number; width: number; height: number };
};

const resolvePsdLayerPointerTarget = (
  psdCanvasSurface as typeof psdCanvasSurface & {
    resolvePsdLayerPointerTarget?: (
      targets: PointerTarget[],
      selectedLayerId: string | null,
      x: number,
      y: number,
    ) => PointerTarget | null;
  }
).resolvePsdLayerPointerTarget ?? (() => null);

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

  it('targets the unlocked visible sidebar selection before an overlapping top layer', () => {
    const targets: PointerTarget[] = [
      {
        id: 'selected-bottom',
        visible: true,
        locked: false,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
      {
        id: 'top-layer',
        visible: true,
        locked: false,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
    ];

    expect(resolvePsdLayerPointerTarget(targets, 'selected-bottom', 50, 50)?.id).toBe('selected-bottom');
  });

  it('falls back to the topmost eligible layer when the selection cannot receive the pointer', () => {
    const targets: PointerTarget[] = [
      {
        id: 'selected-bottom',
        visible: true,
        locked: true,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
      {
        id: 'top-layer',
        visible: true,
        locked: false,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
    ];

    expect(resolvePsdLayerPointerTarget(targets, 'selected-bottom', 50, 50)?.id).toBe('top-layer');
  });
});
