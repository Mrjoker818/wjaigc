import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLegacyMobilePointerController, type LegacyMobilePointerInput, type LegacyMobilePointerOptions, type LegacyPointerCaptureOwner } from '@/lib/workflow-renderer/legacy-mobile-pointer';

class BrowserRect {
  constructor(private position: { left: number; top: number }) {}
  get left(): number { return this.position.left; }
  get top(): number { return this.position.top; }
}

function fixture(): {
  controller: ReturnType<typeof createLegacyMobilePointerController>;
  input: (id: number, x: number, y: number, target?: EventTarget) => LegacyMobilePointerInput;
  owner: LegacyPointerCaptureOwner;
  position: { left: number; top: number };
  callbacks: Pick<LegacyMobilePointerOptions, 'onViewportBegin' | 'onViewportPreview' | 'onViewportEnd' | 'onLongPress'>;
} {
  const target = new EventTarget(), captured = new Set<number>();
  const owner = Object.assign(new EventTarget(), {
    setPointerCapture: (id: number): void => { captured.add(id); },
    hasPointerCapture: (id: number): boolean => captured.has(id),
    releasePointerCapture: (id: number): void => { captured.delete(id); },
  });
  const position = { left: 10, top: 20 };
  const callbacks = { onViewportBegin: vi.fn(), onViewportPreview: vi.fn(), onViewportEnd: vi.fn(), onLongPress: vi.fn() };
  const controller = createLegacyMobilePointerController({
    getScope: () => 'project-one', getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    getCanvasRect: () => new BrowserRect(position), isExternalGestureBusy: () => false,
    isWithinOwner: () => true, onPortBegin: () => false, onPortMove: vi.fn(), onPortEnd: vi.fn(),
    onPortCancel: vi.fn(), resolvePortAt: () => null, ...callbacks, onBlankTap: vi.fn(),
  });
  const input = (id: number, x: number, y: number, eventTarget: EventTarget = target): LegacyMobilePointerInput => ({
    pointerId: id, pointerType: 'touch', isPrimary: id === 1, button: 0, clientX: x, clientY: y, target: eventTarget,
  });
  return { controller, input, owner, position, callbacks };
}

afterEach(() => vi.useRealTimers());

describe('legacy workflow gestures with browser-style rectangle getters', () => {
  it('leaves an unmoved image tap available to its click handler', () => {
    const f = fixture(), down = f.input(1, 50, 60);
    expect(f.controller.beginViewport(f.owner, down, 'image')).toBe(false);
    expect(f.controller.up(down)).toBe(false);
    expect(f.controller.suppressesMouse()).toBe(false);
    expect(f.callbacks.onViewportEnd).not.toHaveBeenCalled();
    f.controller.dispose();
  });

  it('cancels and suppresses the click if the actual canvas origin changes', () => {
    const f = fixture(), down = f.input(1, 50, 60);
    f.controller.beginViewport(f.owner, down, 'image');
    f.position.top += 1;
    expect(f.controller.move(down)).toBe(true);
    expect(f.controller.suppressesMouse()).toBe(true);
    expect(f.controller.busy()).toBe(false);
    f.controller.dispose();
  });

  it('pans a blank canvas and commits the final displacement', () => {
    const f = fixture(), down = f.input(1, 50, 60);
    expect(f.controller.beginViewport(f.owner, down, 'blank')).toBe(true);
    expect(f.controller.move(f.input(1, 60, 65, f.owner))).toBe(true);
    f.controller.up(f.input(1, 60, 65, f.owner));
    expect(f.callbacks.onViewportEnd).toHaveBeenCalledWith({ x: 10, y: 5, zoom: 1 }, true, true);
    expect(f.controller.suppressesMouse()).toBe(true);
    f.controller.dispose();
  });
  it('preserves two-finger zoom ownership and commits the changed viewport', () => {
    const f = fixture(), first = f.input(1, 50, 60), second = f.input(2, 70, 60);
    f.controller.beginViewport(f.owner, first, 'image');
    expect(f.controller.beginViewport(f.owner, second, 'image')).toBe(true);
    expect(f.controller.move(f.input(2, 90, 60, f.owner))).toBe(true);
    expect(f.callbacks.onViewportPreview).toHaveBeenCalled();
    f.controller.up(f.input(2, 90, 60, f.owner));
    f.controller.up(f.input(1, 50, 60, f.owner));
    expect(f.callbacks.onViewportEnd).toHaveBeenCalledWith(expect.objectContaining({ zoom: 2 }), true, true);
    expect(f.controller.suppressesMouse()).toBe(true);
    f.controller.dispose();
  });

  it('keeps image long press separate from a click', () => {
    vi.useFakeTimers();
    const f = fixture(), down = f.input(1, 50, 60);
    f.controller.beginViewport(f.owner, down, 'image');
    vi.advanceTimersByTime(500);
    expect(f.callbacks.onLongPress).toHaveBeenCalledWith({ x: 50, y: 60 }, 'image');
    expect(f.controller.suppressesMouse()).toBe(true);
    f.controller.dispose();
  });
});
