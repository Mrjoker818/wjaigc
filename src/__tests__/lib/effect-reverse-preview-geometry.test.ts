import { describe, expect, it } from 'vitest';
import { clientPointToImagePoint, getContainedImageRect } from '@/lib/effect-reverse-engineering/preview-geometry';

describe('effect reverse preview geometry', () => {
  it('centers a contained landscape image inside a square preview', () => {
    expect(getContainedImageRect({ width: 800, height: 800 }, { width: 1600, height: 900 })).toEqual({ left: 0, top: 175, width: 800, height: 450 });
  });
  it('maps pointer coordinates to the rendered image instead of the full preview', () => {
    expect(clientPointToImagePoint({ x: 410, y: 410 }, { left: 10, top: 10, width: 800, height: 800 }, { width: 1600, height: 900 }, 1, { x: 0, y: 0 })).toEqual({ x: 0.5, y: 0.5 });
    expect(clientPointToImagePoint({ x: 410, y: 80 }, { left: 10, top: 10, width: 800, height: 800 }, { width: 1600, height: 900 }, 1, { x: 0, y: 0 })).toBeNull();
  });
  it('accounts for preview zoom and pan', () => {
    expect(clientPointToImagePoint({ x: 510, y: 510 }, { left: 10, top: 10, width: 800, height: 800 }, { width: 800, height: 800 }, 2, { x: 100, y: 100 })).toEqual({ x: 0.25, y: 0.25 });
  });
});
