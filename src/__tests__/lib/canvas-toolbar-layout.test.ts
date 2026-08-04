import { describe, expect, it } from 'vitest';
import { getBottomToolbarDrawerPlacement } from '@/lib/canvas-toolbar-layout';

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
});
