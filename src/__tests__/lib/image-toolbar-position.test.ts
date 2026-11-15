import { describe, expect, it } from 'vitest';
import {
  getConstrainedFixedPanelPosition,
  getConstrainedImageToolbarPosition,
  getHoverToolbarShift,
} from '@/lib/image-toolbar-position';

describe('getHoverToolbarShift', () => {
  it('leaves a toolbar that already fits where it is', () => {
    expect(getHoverToolbarShift({ anchorCenterX: 500, toolbarWidth: 116, viewportWidth: 1024, occupiedRight: 44 })).toBe(0);
  });

  it('shifts left so the workspace rail never covers the last action', () => {
    // Right edge would be 990 + 58 = 1048; usable right edge is 1024 - 44 - 8 = 972.
    expect(getHoverToolbarShift({ anchorCenterX: 990, toolbarWidth: 116, viewportWidth: 1024, occupiedRight: 44 })).toBe(-76);
  });

  it('reserves the expanded panel width on desktop', () => {
    expect(getHoverToolbarShift({ anchorCenterX: 1400, toolbarWidth: 116, viewportWidth: 1920, occupiedRight: 480 })).toBe(-26);
  });

  it('shifts right when the image hangs off the left edge', () => {
    expect(getHoverToolbarShift({ anchorCenterX: 20, toolbarWidth: 116, viewportWidth: 1280 })).toBe(46);
  });
});

describe('getConstrainedImageToolbarPosition', () => {
  const viewport = { width: 1280, height: 800 };
  const toolbar = { width: 700, height: 44 };

  it('keeps a toolbar anchored to a left-edge image fully inside the viewport', () => {
    const position = getConstrainedImageToolbarPosition({
      image: { x: 0, y: 260, width: 320, height: 240 },
      zoom: 1,
      offset: { x: 0, y: 0 },
      toolbar,
      viewport,
    });

    expect(position.left).toBe(16);
    expect(position.transform).toBe('translate(0, -100%)');
  });

  it('keeps a toolbar anchored to a right-edge image fully inside the viewport', () => {
    const position = getConstrainedImageToolbarPosition({
      image: { x: 960, y: 260, width: 320, height: 240 },
      zoom: 1,
      offset: { x: 0, y: 0 },
      toolbar,
      viewport,
    });

    expect(position.left).toBe(1264);
    expect(position.transform).toBe('translate(-100%, -100%)');
  });

  it('keeps a centered image toolbar centered when there is sufficient space', () => {
    const position = getConstrainedImageToolbarPosition({
      image: { x: 400, y: 260, width: 320, height: 240 },
      zoom: 1,
      offset: { x: 0, y: 0 },
      toolbar,
      viewport,
    });

    expect(position.left).toBe(560);
    expect(position.transform).toBe('translate(-50%, -100%)');
  });

  it('flips the toolbar below a top-edge image instead of hiding it above the viewport', () => {
    const position = getConstrainedImageToolbarPosition({
      image: { x: 400, y: 0, width: 320, height: 240 },
      zoom: 1,
      offset: { x: 0, y: 0 },
      toolbar,
      viewport,
    });

    expect(position.top).toBe(248);
    expect(position.transform).toBe('translate(-50%, 0)');
  });

  it('does not reserve a side panel wider than a mobile viewport', () => {
    const position = getConstrainedImageToolbarPosition({
      image: { x: 200, y: 260, width: 100, height: 100 },
      zoom: 1,
      offset: { x: 0, y: 0 },
      toolbar: { width: 343, height: 44 },
      viewport: { width: 375, height: 812 },
      occupiedRight: 480,
    });

    expect(position.left).toBe(359);
    expect(position.transform).toBe('translate(-100%, -100%)');
  });
});

describe('getConstrainedFixedPanelPosition', () => {
  it('converts a centered toolbar anchor into safe fixed-panel coordinates on mobile', () => {
    const position = getConstrainedFixedPanelPosition({
      anchor: { left: 188, top: 260, transform: 'translate(-50%, -100%)' },
      panel: { width: 320, height: 640 },
      viewport: { width: 375, height: 812 },
    });

    expect(position).toEqual({ left: 28, top: 16 });
  });

  it('clamps a below-image panel upward when its preferred top would overflow', () => {
    const position = getConstrainedFixedPanelPosition({
      anchor: { left: 16, top: 700, transform: 'translate(0, 0)' },
      panel: { width: 320, height: 640 },
      viewport: { width: 375, height: 812 },
    });

    expect(position).toEqual({ left: 16, top: 156 });
  });
});
