import { describe, expect, it } from 'vitest';
import { resolveCanvasBottomDockLayout } from '@/lib/canvas-bottom-dock-layout';

const baseline = {
  viewportHeight: 720,
  canvasBottom: 720,
  dockTop: 300,
  toolbarHeight: 56,
  minimapHeight: 178,
  minimapOpen: true,
  lastOpened: 'dock' as const,
};

describe('actual canvas bottom dock clearance', () => {
  it.each([
    { label: '1040x720 touch layers', viewportHeight: 720, dockTop: 300, expected: 448 },
    { label: '768x1024 touch layers', viewportHeight: 1024, dockTop: 604, expected: 448 },
    { label: '720px fine-pointer compact layers', viewportHeight: 720, dockTop: 504, expected: 244 },
  ])('clears $label without dismissing either panel', ({ viewportHeight, dockTop, expected }) => {
    expect(resolveCanvasBottomDockLayout({ ...baseline, viewportHeight, canvasBottom: viewportHeight, dockTop }))
      .toEqual({ toolbarBottom: expected, minimapBottom: expected, dismissPanel: null });
  });

  it.each([
    { lastOpened: 'dock' as const, dismissPanel: 'minimap' },
    { lastOpened: 'minimap' as const, dismissPanel: 'dock' },
  ])('keeps the newly opened $lastOpened reachable on a short touch viewport', ({ lastOpened, dismissPanel }) => {
    const result = resolveCanvasBottomDockLayout({
      ...baseline, viewportHeight: 390, canvasBottom: 390, dockTop: 140.4, lastOpened,
    });
    expect(result.dismissPanel).toBe(dismissPanel);
  });

  it('uses actual history height when its minimum exceeds 30dvh', () => {
    const result = resolveCanvasBottomDockLayout({
      ...baseline, viewportHeight: 320, canvasBottom: 320, dockTop: 140,
    });
    expect(result).toEqual({ toolbarBottom: 208, minimapBottom: 208, dismissPanel: 'minimap' });
  });

  it('separates the absolute toolbar origin from the fixed minimap origin', () => {
    expect(resolveCanvasBottomDockLayout({ ...baseline, canvasBottom: 620 }))
      .toEqual({ toolbarBottom: 348, minimapBottom: 448, dismissPanel: null });
  });

  it('keeps the normal toolbar and minimap positions after the dock closes', () => {
    expect(resolveCanvasBottomDockLayout({ ...baseline, dockTop: null }))
      .toEqual({ toolbarBottom: 20, minimapBottom: 76, dismissPanel: null });
  });

  it.each(['dock', 'minimap'] as const)('preserves an editing dock when %s was opened last', (lastOpened) => {
    const result = resolveCanvasBottomDockLayout({
      ...baseline, viewportHeight: 390, canvasBottom: 390, dockTop: 140.4,
      dockEditing: true, lastOpened,
    });
    expect(result.dismissPanel).toBe('minimap');
  });

  it('keeps both views open while a draft fits beside the minimap', () => {
    expect(resolveCanvasBottomDockLayout({ ...baseline, dockEditing: true, lastOpened: 'minimap' }).dismissPanel)
      .toBeNull();
  });
});
