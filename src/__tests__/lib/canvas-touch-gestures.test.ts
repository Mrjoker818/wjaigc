import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCanvasTouchGestureController,
  type CanvasTouchSample,
} from '@/lib/canvas-touch-gestures';

function touch(
  pointerId: number,
  x: number,
  y: number,
  target: CanvasTouchSample['target'] = 'blank',
): CanvasTouchSample {
  return { pointerId, pointerType: 'touch', point: { x, y }, target };
}

function pointer(pointerType: 'mouse' | 'pen'): CanvasTouchSample {
  return { pointerId: 99, pointerType, point: { x: 12, y: 24 }, target: 'blank' };
}

describe('canvas touch gesture controller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts blank-canvas pan only after the six-pixel threshold', () => {
    const controller = createCanvasTouchGestureController();

    expect(controller.pointerDown(touch(1, 10, 10))).toEqual([]);
    expect(controller.pointerMove(touch(1, 15, 10))).toEqual([]);
    expect(controller.pointerMove(touch(1, 16, 10))).toEqual([
      { type: 'pan-start', pointerId: 1, point: { x: 10, y: 10 } },
      { type: 'pan-move', pointerId: 1, point: { x: 16, y: 10 } },
    ]);
    expect(controller.pointerMove(touch(1, 19, 13))).toEqual([
      { type: 'pan-move', pointerId: 1, point: { x: 19, y: 13 } },
    ]);
    expect(controller.pointerUp(touch(1, 19, 13))).toEqual([
      { type: 'pan-end', pointerId: 1 },
    ]);
  });

  it('emits one long press after 500ms while movement remains below ten pixels', () => {
    vi.useFakeTimers();
    const onIntent = vi.fn();
    const controller = createCanvasTouchGestureController({ onIntent });

    controller.pointerDown(touch(3, 40, 50, 'image'));
    controller.pointerMove(touch(3, 45, 54, 'image'));
    vi.advanceTimersByTime(499);
    expect(onIntent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith({
      type: 'long-press',
      pointerId: 3,
      point: { x: 40, y: 50 },
      target: 'image',
    });
    expect(controller.pointerUp(touch(3, 45, 54, 'image'))).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it('cancels long press when movement reaches ten pixels', () => {
    vi.useFakeTimers();
    const onIntent = vi.fn();
    const controller = createCanvasTouchGestureController({ onIntent });

    controller.pointerDown(touch(4, 0, 0, 'image'));
    expect(controller.pointerMove(touch(4, 10, 0, 'image'))).toEqual([]);
    vi.advanceTimersByTime(600);

    expect(onIntent).not.toHaveBeenCalled();
  });

  it('switches to pinch on the second pointer and reports anchored geometry', () => {
    const controller = createCanvasTouchGestureController();

    controller.pointerDown(touch(1, 0, 0));
    expect(controller.pointerDown(touch(2, 10, 0))).toEqual([
      { type: 'cancel-default-interaction' },
    ]);
    expect(controller.pointerMove(touch(2, 20, 10))).toEqual([
      {
        type: 'pinch',
        midpoint: { x: 10, y: 5 },
        scale: Math.sqrt(500) / 10,
        midpointDelta: { x: 5, y: 5 },
      },
    ]);
  });

  it('blocks the remaining finger after pinch until every pointer is released', () => {
    const controller = createCanvasTouchGestureController();

    controller.pointerDown(touch(1, 0, 0));
    controller.pointerDown(touch(2, 10, 0));
    expect(controller.pointerUp(touch(2, 10, 0))).toEqual([]);
    expect(controller.pointerMove(touch(1, 30, 0))).toEqual([]);
    expect(controller.pointerUp(touch(1, 30, 0))).toEqual([]);

    controller.pointerDown(touch(3, 0, 0));
    expect(controller.pointerMove(touch(3, 7, 0))).toEqual([
      { type: 'pan-start', pointerId: 3, point: { x: 0, y: 0 } },
      { type: 'pan-move', pointerId: 3, point: { x: 7, y: 0 } },
    ]);
  });

  it('does not take over image movement before a long press or second pointer', () => {
    const controller = createCanvasTouchGestureController();

    controller.pointerDown(touch(8, 10, 10, 'image'));
    expect(controller.pointerMove(touch(8, 40, 10, 'image'))).toEqual([]);
    expect(controller.pointerUp(touch(8, 40, 10, 'image'))).toEqual([]);
  });

  it('ignores mouse and pen samples', () => {
    const controller = createCanvasTouchGestureController();

    for (const sample of [pointer('mouse'), pointer('pen')]) {
      expect(controller.pointerDown(sample)).toEqual([]);
      expect(controller.pointerMove(sample)).toEqual([]);
      expect(controller.pointerUp(sample)).toEqual([]);
      expect(controller.pointerCancel(sample)).toEqual([]);
    }
  });

  it('cancels active pan and clears timers on pointer cancel and dispose', () => {
    vi.useFakeTimers();
    const onIntent = vi.fn();
    const controller = createCanvasTouchGestureController({ onIntent });

    controller.pointerDown(touch(1, 0, 0));
    controller.pointerMove(touch(1, 7, 0));
    expect(controller.pointerCancel(touch(1, 7, 0))).toEqual([
      { type: 'pan-end', pointerId: 1 },
      { type: 'cancel-default-interaction' },
    ]);

    controller.pointerDown(touch(2, 20, 20, 'image'));
    controller.dispose();
    vi.advanceTimersByTime(600);
    expect(onIntent).not.toHaveBeenCalled();
    expect(controller.pointerMove(touch(2, 30, 30, 'image'))).toEqual([]);
  });
});
