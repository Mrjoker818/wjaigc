import { describe, expect, it } from 'vitest';

import {
  applyBoxSelectionVisualState,
  resolveBoxSelectionOverlayLayout,
} from '@/components/canvas/use-canvas-selection';

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

  it('updates the overlay and viewport cursor without publishing React state', () => {
    const overlay = { style: { display: '' } } as unknown as HTMLElement;
    const viewport = { style: { cursor: '' } } as unknown as HTMLElement;

    applyBoxSelectionVisualState(overlay, viewport, true);
    expect(overlay.style.display).toBe('block');
    expect(viewport.style.cursor).toBe('crosshair');

    applyBoxSelectionVisualState(overlay, viewport, false);
    expect(overlay.style.display).toBe('none');
    expect(viewport.style.cursor).toBe('');
  });
});
