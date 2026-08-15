import { describe, expect, it } from 'vitest';

import { resolveCanvasPanPreview } from '@/components/canvas/use-canvas-viewport';
import { beginPan, createCanvasViewportState } from '@/lib/canvas-kernel/viewport';

describe('canvas viewport controller hot path', () => {
  const pointerStart = { pointerId: 7, clientX: 100, clientY: 80 };
  const pointerMove = { pointerId: 7, clientX: 160, clientY: 120 };

  function startedPair() {
    const state = beginPan(createCanvasViewportState(), pointerStart);
    return { legacy: state, kernel: state };
  }

  it('leaves the inactive kernel state untouched in legacy mode', () => {
    const before = startedPair();
    const after = resolveCanvasPanPreview('legacy', before.legacy, before.kernel, pointerMove);

    expect(after.legacy.preview).toEqual({ x: 60, y: 40 });
    expect(after.kernel).toBe(before.kernel);
  });

  it('leaves the inactive legacy state untouched in canvas-v2 mode', () => {
    const before = startedPair();
    const after = resolveCanvasPanPreview('canvas-v2', before.legacy, before.kernel, pointerMove);

    expect(after.kernel.preview).toEqual({ x: 60, y: 40 });
    expect(after.legacy).toBe(before.legacy);
  });

  it('keeps both independent previews active in shadow mode', () => {
    const before = startedPair();
    const after = resolveCanvasPanPreview('shadow', before.legacy, before.kernel, pointerMove);

    expect(after.legacy).not.toBe(before.legacy);
    expect(after.kernel).not.toBe(before.kernel);
    expect(after.legacy.preview).toEqual(after.kernel.preview);
  });
});
