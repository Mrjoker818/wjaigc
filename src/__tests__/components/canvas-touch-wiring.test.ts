import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  applyCanvasTouchIntent,
  type CanvasTouchIntentDependencies,
} from '@/components/canvas/use-canvas-viewport';

function dependencies(): CanvasTouchIntentDependencies {
  return {
    getZoom: () => 1.5,
    beginPan: vi.fn(() => true),
    previewPan: vi.fn(),
    commitPan: vi.fn(),
    cancelPan: vi.fn(),
    zoomAtPoint: vi.fn(),
    translateBy: vi.fn(),
    cancelSelectionGesture: vi.fn(),
    cancelImageDrag: vi.fn(),
    openLongPressMenu: vi.fn(),
  };
}

describe('canvas touch intent wiring', () => {
  it('routes pan intents through the existing viewport controller', () => {
    const deps = dependencies();

    applyCanvasTouchIntent({ type: 'pan-start', pointerId: 7, point: { x: 20, y: 30 } }, deps);
    applyCanvasTouchIntent({ type: 'pan-move', pointerId: 7, point: { x: 28, y: 34 } }, deps);
    applyCanvasTouchIntent({ type: 'pan-end', pointerId: 7 }, deps);

    expect(deps.beginPan).toHaveBeenCalledWith({ pointerId: 7, clientX: 20, clientY: 30 });
    expect(deps.previewPan).toHaveBeenCalledWith({ pointerId: 7, clientX: 28, clientY: 34 });
    expect(deps.commitPan).toHaveBeenCalledWith({ pointerId: 7 });
  });

  it('applies pinch scale to the current zoom and translates by midpoint movement', () => {
    const deps = dependencies();

    applyCanvasTouchIntent({
      type: 'pinch',
      midpoint: { x: 160, y: 240 },
      scale: 1.2,
      midpointDelta: { x: 4, y: -3 },
    }, deps);

    expect(deps.zoomAtPoint).toHaveBeenCalledWith({ x: 160, y: 240 }, 1.8);
    expect(deps.translateBy).toHaveBeenCalledWith({ x: 4, y: -3 });
  });

  it('cancels selection, image drag, and viewport pan before a pinch takes over', () => {
    const deps = dependencies();

    applyCanvasTouchIntent({ type: 'cancel-default-interaction' }, deps);

    expect(deps.cancelSelectionGesture).toHaveBeenCalledOnce();
    expect(deps.cancelImageDrag).toHaveBeenCalledOnce();
    expect(deps.cancelPan).toHaveBeenCalledOnce();
  });

  it('opens the existing context menu after cancelling a pending direct manipulation', () => {
    const deps = dependencies();

    applyCanvasTouchIntent({
      type: 'long-press',
      pointerId: 4,
      point: { x: 90, y: 110 },
      target: 'image',
    }, deps);

    expect(deps.cancelSelectionGesture).toHaveBeenCalledOnce();
    expect(deps.cancelImageDrag).toHaveBeenCalledOnce();
    expect(deps.openLongPressMenu).toHaveBeenCalledWith({ x: 90, y: 110 }, 'image');
  });

  it('connects touch pointer events without replacing mouse and pen routing', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("createCanvasTouchGestureController({");
    expect(source).toContain("if (e.pointerType === 'touch') {");
    expect(source).toContain('touchGestureControllerRef.current.pointerDown(');
    expect(source).toContain('touchGestureControllerRef.current.pointerMove(');
    expect(source).toContain('touchGestureControllerRef.current.pointerUp(');
    expect(source).toContain('touchGestureControllerRef.current.pointerCancel(');
    expect(source).toContain("data-canvas-interaction-surface");
    expect(source).toContain('touchAction: \'none\'');
    expect(source).toContain('if (e.button === 1) {');
    expect(source).toContain("closest<HTMLElement>('[data-canvas-image-id]')");
  });
});
