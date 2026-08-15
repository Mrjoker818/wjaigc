import { describe, expect, it } from 'vitest';

import { resolveBoxSelectionOverlayLayout } from '@/components/canvas/use-canvas-selection';

describe('canvas box selection overlay layout', () => {
  it('normalizes a reverse drag relative to the viewport', () => {
    expect(resolveBoxSelectionOverlayLayout(
      { x: 420, y: 310 },
      { x: 120, y: 90 },
      { left: 40, top: 30 },
    )).toEqual({
      x: 80,
      y: 60,
      width: 300,
      height: 220,
    });
  });
});
