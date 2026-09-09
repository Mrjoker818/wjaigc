import { describe, expect, it, vi } from 'vitest';
import {
  getBottomToolbarDrawerPlacement,
  getCanvasToolHostPlacementClassName,
  trackToolbarTransitionFrames,
} from '@/lib/canvas-toolbar-layout';

describe('bottom toolbar drawer placement', () => {
  it('opens toward the upper-left when the right workspace panel occupies space', () => {
    const placement = getBottomToolbarDrawerPlacement({
      viewport: { width: 1440, height: 900 },
      trigger: { left: 1120, top: 820, width: 180, height: 48 },
      drawer: { width: 420, height: 520 },
      occupiedRight: 480,
    });

    expect(placement.left).toBeLessThanOrEqual(940);
    expect(placement.top).toBeLessThan(820);
    expect(placement.left + placement.width).toBeLessThanOrEqual(1440);
    expect(placement.top + placement.height).toBeLessThanOrEqual(900);
  });

  it('clamps the drawer inside a narrow viewport', () => {
    const placement = getBottomToolbarDrawerPlacement({
      viewport: { width: 360, height: 640 },
      trigger: { left: 12, top: 580, width: 120, height: 44 },
      drawer: { width: 420, height: 520 },
      occupiedRight: 0,
    });

    expect(placement.left).toBeGreaterThanOrEqual(8);
    expect(placement.top).toBeGreaterThanOrEqual(8);
    expect(placement.width).toBeLessThanOrEqual(344);
    expect(placement.left + placement.width).toBeLessThanOrEqual(352);
    expect(placement.top + placement.height).toBeLessThanOrEqual(632);
  });

  it('centers the drawer horizontally over the toolbar trigger and docks above it', () => {
    const placement = getBottomToolbarDrawerPlacement({
      viewport: { width: 1440, height: 900 },
      trigger: { left: 630, top: 820, width: 180, height: 48 },
      drawer: { width: 640, height: 520 },
    });

    expect(placement.left).toBe(400);
    expect(placement.top).toBe(292);
    expect(placement.bottom).toBe(88);
    expect(placement.side).toBe('above-center');
  });

  it('keeps a usable drawer width on narrow viewports when the right panel reservation is large', () => {
    const placement = getBottomToolbarDrawerPlacement({
      viewport: { width: 390, height: 844 },
      trigger: { left: 8, top: 760, width: 180, height: 44 },
      drawer: { width: 420, height: 506 },
      occupiedRight: 480,
      minWidth: 360,
    });

    expect(placement.width).toBeGreaterThanOrEqual(360);
    expect(placement.left).toBeGreaterThanOrEqual(8);
    expect(placement.left + placement.width).toBeLessThanOrEqual(382);
    expect(placement.top + placement.height).toBeLessThanOrEqual(836);
  });

  it('remeasures every animation frame while the toolbar position is transitioning and cleans up', () => {
    const toolbar = new EventTarget();
    const measuredTops: number[] = [];
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    let top = 820;
    const cancelFrame = vi.fn((id: number) => { frames.delete(id); });
    const stop = trackToolbarTransitionFrames(toolbar, () => measuredTops.push(top), {
      requestFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; },
      cancelFrame,
    });

    const transitionEvent = (type: string, propertyName: string): Event => {
      const event = new Event(type);
      Object.defineProperty(event, 'propertyName', { value: propertyName });
      return event;
    };
    toolbar.dispatchEvent(transitionEvent('transitionrun', 'bottom'));
    expect(measuredTops).toEqual([820]);
    top = 620;
    const [frameId, frame] = [...frames.entries()][0];
    frames.delete(frameId);
    frame(16);
    expect(measuredTops).toEqual([820, 620]);
    toolbar.dispatchEvent(transitionEvent('transitionend', 'opacity'));
    expect(frames.size).toBe(1);
    toolbar.dispatchEvent(transitionEvent('transitionend', 'bottom'));
    expect(measuredTops.at(-1)).toBe(620);
    expect(cancelFrame).toHaveBeenCalled();

    stop();
    toolbar.dispatchEvent(transitionEvent('transitionrun', 'bottom'));
    expect(measuredTops.at(-1)).toBe(620);
  });
});

describe('canvas tool host placement', () => {
  it('keeps floating tools in the overlay layer without centering bottom drawers', () => {
    expect(getCanvasToolHostPlacementClassName('floating')).toContain('fixed');
    expect(getCanvasToolHostPlacementClassName('bottom-drawer')).toContain('contents');
    expect(getCanvasToolHostPlacementClassName('canvas-overlay')).toContain('absolute');
    expect(getCanvasToolHostPlacementClassName('none')).toContain('contents');
  });
});
