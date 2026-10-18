import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import * as positionApi from '@/lib/floating-panel-position';

import {
  constrainFloatingPanelPosition,
  getCenteredFloatingPanelPosition,
} from '@/lib/floating-panel-position';

describe('floating panel position', () => {
  it('centers a panel inside the viewport safety margin', () => {
    expect(getCenteredFloatingPanelPosition({
      viewportWidth: 2048,
      viewportHeight: 935,
      panelWidth: 460,
      panelHeight: 795,
    })).toEqual({ x: 794, y: 70 });
  });

  it('keeps the real refine panel inside a 2048 by 935 viewport', () => {
    expect(constrainFloatingPanelPosition({
      x: 1500,
      y: 900,
      panelWidth: 460,
      panelHeight: 795,
      viewportWidth: 2048,
      viewportHeight: 935,
      margin: 16,
    })).toEqual({ x: 1500, y: 124 });
  });

  it.each([
    [{ x: -200, y: 100 }, { x: 16, y: 100 }],
    [{ x: 1800, y: 100 }, { x: 1572, y: 100 }],
    [{ x: 100, y: -300 }, { x: 100, y: 16 }],
    [{ x: 100, y: 900 }, { x: 100, y: 124 }],
  ])('clamps a dragged panel at every viewport edge', (position, expected) => {
    expect(constrainFloatingPanelPosition({
      ...position,
      panelWidth: 460,
      panelHeight: 795,
      viewportWidth: 2048,
      viewportHeight: 935,
    })).toEqual(expected);
  });

  it('pins an oversized panel to the safety margin on a narrow viewport', () => {
    expect(constrainFloatingPanelPosition({
      x: 400,
      y: 400,
      panelWidth: 460,
      panelHeight: 795,
      viewportWidth: 320,
      viewportHeight: 568,
    })).toEqual({ x: 16, y: 16 });
  });

  it('re-clamps a formerly valid position after the viewport shrinks', () => {
    expect(constrainFloatingPanelPosition({
      x: 794,
      y: 70,
      panelWidth: 460,
      panelHeight: 600,
      viewportWidth: 768,
      viewportHeight: 600,
    })).toEqual({ x: 292, y: 16 });
  });
});

describe('mobile video-display layout viewport', () => {
  function api(): { read: () => { width: number; height: number; left: number; top: number }; subscribe: (listener: () => void) => () => void } {
    const read = Reflect.get(positionApi, 'getFloatingPanelViewport');
    const subscribe = Reflect.get(positionApi, 'subscribeFloatingPanelViewport');
    expect(typeof read).toBe('function');
    expect(typeof subscribe).toBe('function');
    return { read, subscribe };
  }
  it('reads and subscribes safely during SSR', () => {
    vi.stubGlobal('window', undefined);
    try {
      const { read, subscribe } = api();
      expect(read()).toEqual({ width: 1056, height: 776, left: 0, top: 0 });
      const listener = vi.fn();
      subscribe(listener)();
      expect(listener).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('uses inner dimensions and dispatches window resize without visualViewport', () => {
    const target = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 780 });
    vi.stubGlobal('window', target);
    try {
      const { read, subscribe } = api();
      expect(read()).toEqual({ width: 390, height: 780, left: 0, top: 0 });
      const listener = vi.fn(); const stop = subscribe(listener);
      target.dispatchEvent(new Event('resize'));
      expect(listener).toHaveBeenCalledTimes(1);
      stop(); target.dispatchEvent(new Event('resize'));
      expect(listener).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('prefers visual dimensions and offsets and dispatches resize and scroll', () => {
    const visual = Object.assign(new EventTarget(), { width: 320, height: 220, offsetLeft: 12, offsetTop: 90 });
    const target = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 780, visualViewport: visual });
    vi.stubGlobal('window', target);
    try {
      const { read, subscribe } = api();
      expect(read()).toEqual({ width: 320, height: 220, left: 12, top: 90 });
      const listener = vi.fn(); const stop = subscribe(listener);
      visual.dispatchEvent(new Event('resize')); visual.dispatchEvent(new Event('scroll'));
      expect(listener).toHaveBeenCalledTimes(2); stop();
    } finally { vi.unstubAllGlobals(); }
  });
  it('unsubscribes all listeners from the original visual object after replacement', () => {
    const original = new EventTarget(); const replacement = new EventTarget();
    const target = Object.assign(new EventTarget(), { visualViewport: original });
    vi.stubGlobal('window', target);
    try {
      const { subscribe } = api(); const listener = vi.fn(); const stop = subscribe(listener);
      target.dispatchEvent(new Event('resize')); original.dispatchEvent(new Event('resize')); original.dispatchEvent(new Event('scroll'));
      expect(listener).toHaveBeenCalledTimes(3);
      target.visualViewport = replacement; stop();
      target.dispatchEvent(new Event('resize')); original.dispatchEvent(new Event('resize')); original.dispatchEvent(new Event('scroll'));
      replacement.dispatchEvent(new Event('resize')); replacement.dispatchEvent(new Event('scroll'));
      expect(listener).toHaveBeenCalledTimes(3);
    } finally { vi.unstubAllGlobals(); }
  });
});
