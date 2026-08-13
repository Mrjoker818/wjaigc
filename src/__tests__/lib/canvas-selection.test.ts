import { describe, expect, it } from 'vitest';

import {
  beginBoxSelection,
  cancelSelectionGesture,
  clearSelection,
  commitBoxSelection,
  createCanvasSelectionState,
  getBoxSelectionBounds,
  hasExceededDragThreshold,
  resolveBoxSelectionHitIds,
  resolveBlankCanvasGesture,
  resolveCanvasGesturePriority,
  resolveImagePointerIntent,
  resolveTopmostHit,
  selectHit,
  toggleHit,
  updateBoxSelection,
} from '@/lib/canvas-kernel/selection';

describe('canvas selection controller', () => {
  it('selects the topmost overlapping hit and preserves deterministic z order', () => {
    const topmost = resolveTopmostHit([
      { id: 'lower', zIndex: 2, order: 1 },
      { id: 'top', zIndex: 9, order: 0 },
      { id: 'latest', zIndex: 9, order: 4 },
    ]);

    expect(topmost).toBe('latest');
    expect(selectHit(createCanvasSelectionState(), topmost, 'replace')).toEqual({
      ids: ['latest'],
      primaryId: 'latest',
      gesture: null,
    });
  });

  it('supports Ctrl/Meta toggle and append selection without duplicates', () => {
    const selected = selectHit(createCanvasSelectionState(), 'top', 'replace');
    const appended = selectHit(selected, 'lower', 'append');
    const unchanged = selectHit(appended, 'lower', 'append');
    const toggledOff = toggleHit(unchanged, 'top');

    expect(appended.ids).toEqual(['top', 'lower']);
    expect(unchanged.ids).toEqual(['top', 'lower']);
    expect(toggledOff).toMatchObject({ ids: ['lower'], primaryId: 'lower' });
  });

  it('clears a replace selection on a blank hit', () => {
    const state = createCanvasSelectionState(['a', 'b'], 'b');

    expect(selectHit(state, null, 'replace')).toEqual({
      ids: [],
      primaryId: null,
      gesture: null,
    });
    expect(clearSelection(state)).toEqual({ ids: [], primaryId: null, gesture: null });
  });

  it('normalizes a reverse-direction box and commits hits in supplied z order', () => {
    const started = beginBoxSelection(
      createCanvasSelectionState(['existing'], 'existing'),
      { pointerId: 7, point: { x: 120, y: 90 }, additive: false },
    );
    const preview = updateBoxSelection(started, {
      pointerId: 7,
      point: { x: 20, y: 10 },
    });

    expect(getBoxSelectionBounds(preview)).toEqual({
      left: 20,
      top: 10,
      right: 120,
      bottom: 90,
      width: 100,
      height: 80,
    });
    expect(commitBoxSelection(preview, ['back', 'front'])).toEqual({
      ids: ['back', 'front'],
      primaryId: 'front',
      gesture: null,
    });
  });

  it('keeps the original committed selection when a pointer gesture is cancelled', () => {
    const started = beginBoxSelection(
      createCanvasSelectionState(['kept'], 'kept'),
      { pointerId: 3, point: { x: 0, y: 0 }, additive: true },
    );
    const preview = updateBoxSelection(started, {
      pointerId: 3,
      point: { x: 80, y: 50 },
    });

    expect(cancelSelectionGesture(preview, 3)).toEqual({
      ids: ['kept'],
      primaryId: 'kept',
      gesture: null,
    });
  });

  it('uses a stable drag threshold and ignores unrelated pointers', () => {
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(false);
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 14, y: 14 })).toBe(true);

    const started = beginBoxSelection(
      createCanvasSelectionState(),
      { pointerId: 4, point: { x: 0, y: 0 }, additive: false },
    );
    expect(updateBoxSelection(started, {
      pointerId: 5,
      point: { x: 100, y: 100 },
    })).toBe(started);
  });

  it('gives overlays and edit modes priority over ordinary canvas selection', () => {
    expect(resolveCanvasGesturePriority({ overlay: true, editMode: false, annotationMode: false })).toBe('blocked');
    expect(resolveCanvasGesturePriority({ overlay: false, editMode: true, annotationMode: false })).toBe('edit');
    expect(resolveCanvasGesturePriority({ overlay: false, editMode: false, annotationMode: true })).toBe('annotation');
    expect(resolveCanvasGesturePriority({ overlay: false, editMode: false, annotationMode: false })).toBe('selection');
  });

  it('reserves mouse and pen blank drags for box selection while preserving touch long-press pan', () => {
    expect(resolveBlankCanvasGesture('mouse')).toBe('box-select');
    expect(resolveBlankCanvasGesture('pen')).toBe('box-select');
    expect(resolveBlankCanvasGesture('touch')).toBe('long-press-pan');
  });

  it('preserves fusion mode while routing ordinary Ctrl/Meta clicks to selection toggle', () => {
    expect(resolveImagePointerIntent({ altKey: true, toggleKey: false, fusionMode: false }))
      .toBe('reference-group');
    expect(resolveImagePointerIntent({ altKey: false, toggleKey: true, fusionMode: true }))
      .toBe('fusion-group');
    expect(resolveImagePointerIntent({ altKey: false, toggleKey: true, fusionMode: false }))
      .toBe('toggle-selection');
    expect(resolveImagePointerIntent({ altKey: false, toggleKey: false, fusionMode: false }))
      .toBe('select');
  });

  it('reconciles stale spatial-index candidates against committed image geometry', () => {
    const images = [
      { id: 'left', x: 20, y: 20, width: 40, height: 40 },
      { id: 'right', x: 80, y: 20, width: 40, height: 40 },
      { id: 'outside', x: 180, y: 20, width: 40, height: 40 },
    ];

    expect(resolveBoxSelectionHitIds({
      images,
      bounds: { left: 10, top: 10, right: 130, bottom: 70 },
      indexedHitIds: ['right'],
    })).toEqual(['left', 'right']);
  });
});
