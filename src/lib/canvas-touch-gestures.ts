import type { CanvasPoint } from './canvas-kernel/types';

export const TOUCH_PAN_THRESHOLD_PX = 6;
export const TOUCH_LONG_PRESS_MS = 500;
export const TOUCH_LONG_PRESS_SLOP_PX = 10;

export interface CanvasTouchSample {
  pointerId: number;
  pointerType: string;
  point: CanvasPoint;
  target: 'blank' | 'image';
}

export type CanvasTouchIntent =
  | { type: 'pan-start' | 'pan-move'; pointerId: number; point: CanvasPoint }
  | { type: 'pan-end'; pointerId: number }
  | { type: 'pinch'; midpoint: CanvasPoint; scale: number; midpointDelta: CanvasPoint }
  | {
      type: 'long-press';
      pointerId: number;
      point: CanvasPoint;
      target: CanvasTouchSample['target'];
    }
  | { type: 'cancel-default-interaction' };

type TimerHandle = ReturnType<typeof setTimeout>;

export interface CanvasTouchGestureControllerOptions {
  onIntent?: (intent: CanvasTouchIntent) => void;
  scheduleLongPress?: (callback: () => void, delayMs: number) => TimerHandle;
  cancelLongPress?: (handle: TimerHandle) => void;
}

export interface CanvasTouchGestureController {
  pointerDown(sample: CanvasTouchSample): CanvasTouchIntent[];
  pointerMove(sample: CanvasTouchSample): CanvasTouchIntent[];
  pointerUp(sample: CanvasTouchSample): CanvasTouchIntent[];
  pointerCancel(sample: CanvasTouchSample): CanvasTouchIntent[];
  dispose(): void;
}

interface ActiveTouch {
  initial: CanvasPoint;
  current: CanvasPoint;
  target: CanvasTouchSample['target'];
}

type GestureMode = 'idle' | 'single' | 'panning' | 'pinching' | 'long-pressed' | 'blocked' | 'disposed';

function distance(left: CanvasPoint, right: CanvasPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function midpoint(left: CanvasPoint, right: CanvasPoint): CanvasPoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

export function createCanvasTouchGestureController(
  options: CanvasTouchGestureControllerOptions = {},
): CanvasTouchGestureController {
  const active = new Map<number, ActiveTouch>();
  const scheduleLongPress = options.scheduleLongPress ?? setTimeout;
  const cancelLongPress = options.cancelLongPress ?? clearTimeout;
  let mode: GestureMode = 'idle';
  let longPressTimer: TimerHandle | null = null;
  let primaryPointerId: number | null = null;
  let previousPinchDistance = 0;
  let previousPinchMidpoint: CanvasPoint | null = null;

  const clearLongPress = (): void => {
    if (longPressTimer === null) return;
    cancelLongPress(longPressTimer);
    longPressTimer = null;
  };

  const reset = (nextMode: GestureMode = 'idle'): void => {
    clearLongPress();
    active.clear();
    primaryPointerId = null;
    previousPinchDistance = 0;
    previousPinchMidpoint = null;
    mode = nextMode;
  };

  const startLongPressTimer = (sample: CanvasTouchSample): void => {
    clearLongPress();
    longPressTimer = scheduleLongPress(() => {
      longPressTimer = null;
      const pointer = active.get(sample.pointerId);
      if (mode !== 'single' || !pointer) return;
      if (distance(pointer.initial, pointer.current) >= TOUCH_LONG_PRESS_SLOP_PX) return;
      mode = 'long-pressed';
      options.onIntent?.({
        type: 'long-press',
        pointerId: sample.pointerId,
        point: pointer.initial,
        target: pointer.target,
      });
    }, TOUCH_LONG_PRESS_MS);
  };

  const pointerDown = (sample: CanvasTouchSample): CanvasTouchIntent[] => {
    if (sample.pointerType !== 'touch' || mode === 'disposed') return [];

    if (mode === 'blocked') {
      active.set(sample.pointerId, {
        initial: sample.point,
        current: sample.point,
        target: sample.target,
      });
      return [];
    }

    active.set(sample.pointerId, {
      initial: sample.point,
      current: sample.point,
      target: sample.target,
    });

    if (active.size === 1) {
      mode = 'single';
      primaryPointerId = sample.pointerId;
      startLongPressTimer(sample);
      return [];
    }

    if (active.size === 2) {
      clearLongPress();
      const points = [...active.values()].map(pointer => pointer.current);
      previousPinchDistance = distance(points[0], points[1]);
      previousPinchMidpoint = midpoint(points[0], points[1]);
      const intents: CanvasTouchIntent[] = [];
      if (mode === 'panning' && primaryPointerId !== null) {
        intents.push({ type: 'pan-end', pointerId: primaryPointerId });
      }
      mode = 'pinching';
      intents.push({ type: 'cancel-default-interaction' });
      return intents;
    }

    return [];
  };

  const pointerMove = (sample: CanvasTouchSample): CanvasTouchIntent[] => {
    if (sample.pointerType !== 'touch' || mode === 'disposed') return [];
    const pointer = active.get(sample.pointerId);
    if (!pointer) return [];
    pointer.current = sample.point;

    if (mode === 'blocked' || mode === 'long-pressed') return [];

    if (mode === 'single') {
      const moved = distance(pointer.initial, pointer.current);
      if (moved >= TOUCH_LONG_PRESS_SLOP_PX) clearLongPress();
      if (pointer.target !== 'blank' || moved < TOUCH_PAN_THRESHOLD_PX) return [];
      clearLongPress();
      mode = 'panning';
      return [
        { type: 'pan-start', pointerId: sample.pointerId, point: pointer.initial },
        { type: 'pan-move', pointerId: sample.pointerId, point: pointer.current },
      ];
    }

    if (mode === 'panning') {
      return [{ type: 'pan-move', pointerId: sample.pointerId, point: pointer.current }];
    }

    if (mode === 'pinching' && active.size === 2) {
      const points = [...active.values()].map(item => item.current);
      const nextDistance = distance(points[0], points[1]);
      const nextMidpoint = midpoint(points[0], points[1]);
      const baselineDistance = Math.max(previousPinchDistance, Number.EPSILON);
      const baselineMidpoint = previousPinchMidpoint ?? nextMidpoint;
      const intent: CanvasTouchIntent = {
        type: 'pinch',
        midpoint: nextMidpoint,
        scale: nextDistance / baselineDistance,
        midpointDelta: {
          x: nextMidpoint.x - baselineMidpoint.x,
          y: nextMidpoint.y - baselineMidpoint.y,
        },
      };
      previousPinchDistance = nextDistance;
      previousPinchMidpoint = nextMidpoint;
      return [intent];
    }

    return [];
  };

  const pointerUp = (sample: CanvasTouchSample): CanvasTouchIntent[] => {
    if (sample.pointerType !== 'touch' || mode === 'disposed') return [];
    if (!active.has(sample.pointerId)) return [];
    const wasPanning = mode === 'panning' && sample.pointerId === primaryPointerId;
    const wasPinching = mode === 'pinching';
    active.delete(sample.pointerId);
    clearLongPress();

    if (wasPinching) {
      mode = active.size === 0 ? 'idle' : 'blocked';
      return [];
    }
    if (mode === 'blocked') {
      if (active.size === 0) reset();
      return [];
    }
    if (active.size === 0) reset();
    return wasPanning ? [{ type: 'pan-end', pointerId: sample.pointerId }] : [];
  };

  const pointerCancel = (sample: CanvasTouchSample): CanvasTouchIntent[] => {
    if (sample.pointerType !== 'touch' || mode === 'disposed' || !active.has(sample.pointerId)) return [];
    const intents: CanvasTouchIntent[] = [];
    if (mode === 'panning' && primaryPointerId !== null) {
      intents.push({ type: 'pan-end', pointerId: primaryPointerId });
    }
    intents.push({ type: 'cancel-default-interaction' });
    reset();
    return intents;
  };

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    dispose: () => reset('disposed'),
  };
}
