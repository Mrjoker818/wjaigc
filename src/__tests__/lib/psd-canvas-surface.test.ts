import { describe, expect, it, vi } from 'vitest';

import { drawPsdCanvasSurface } from '@/lib/psd-canvas-surface';

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
});
