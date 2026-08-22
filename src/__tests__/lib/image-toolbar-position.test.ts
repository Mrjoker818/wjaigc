import { describe, expect, it } from 'vitest';
import {
  getConstrainedFixedPanelPosition,
  getConstrainedImageToolbarPosition,
} from '@/lib/image-toolbar-position';

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
