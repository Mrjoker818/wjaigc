import { describe, expect, it } from 'vitest';

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
