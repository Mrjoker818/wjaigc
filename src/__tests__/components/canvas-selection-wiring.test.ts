import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const hookPath = resolve(process.cwd(), 'src/components/canvas/use-canvas-selection.ts');

describe('canvas selection gesture wiring', () => {
  it('routes committed selection through the canvas selection adapter', () => {
    expect(canvasSource).toContain("import { useCanvasSelection } from '@/components/canvas/use-canvas-selection';");
    expect(canvasSource).toContain('useCanvasSelection({');
    expect(canvasSource).toContain('selectSelectionHit');
    expect(canvasSource).toContain('commitSelectionBox');
  });

  it('captures ordinary image pointers and releases them from one cleanup path', () => {
    expect(canvasSource).toContain('beginImageSelectionGesture({');
    expect(canvasSource).toContain('e.currentTarget.setPointerCapture(e.pointerId);');
    expect(canvasSource).toContain('finishCanvasPointerGesture(e.pointerId');
  });

  it('uses the rendered image target as the pointer-down hit source', () => {
    expect(canvasSource).toContain("closest<HTMLElement>('[data-canvas-image-id]')");
    expect(canvasSource).toContain('const hitId = renderedHitElement?.dataset.canvasImageId || null;');
  });

  it('blocks overlays before selection and keeps annotation/edit gestures authoritative', () => {
    expect(canvasSource).toContain('if (isEventFromOverlay(e.nativeEvent)) return;');
    expect(canvasSource).toContain('resolveCanvasGesturePriority({');
    expect(canvasSource).toContain("gesturePriority === 'annotation'");
    expect(canvasSource).toContain("gesturePriority === 'edit'");
  });

  it('cancels box and image drag previews without publishing business state', () => {
    expect(canvasSource).toContain('cancelSelectionGesture(e.pointerId);');
    expect(canvasSource).toContain('cancelImageDragPreview();');
  });

  it('keeps box preview in refs and publishes only its committed selection', () => {
    const hookSource = readFileSync(hookPath, 'utf8');
    expect(hookSource).toContain('boxPreviewRef');
    expect(hookSource).toContain('requestAnimationFrame');
    expect(hookSource).toContain('boxOverlayRef.current');
    expect(hookSource).not.toContain('setBoxPreview(');
    expect(hookSource).toContain('commitBoxSelection');
    expect(hookSource).toContain('onSelectionCommit');
    expect(canvasSource).toContain('data-canvas-box-selection');
  });

  it('does not collapse a committed multi-selection when the primary image prop syncs', () => {
    expect(canvasSource).toContain("!getSelectionState().ids.includes(selectedImage.id)");
  });

  it('suppresses the synthetic click emitted after an active box gesture', () => {
    expect(canvasSource).toContain('suppressSelectionClickRef.current = true;');
    expect(canvasSource).toContain('if (suppressSelectionClickRef.current)');
  });

  it('does not let long-press panning steal an active box selection', () => {
    expect(canvasSource).toContain('if (getBoxSelectionPreview()?.active)');
    expect(canvasSource).toContain('if (movedDistance > 6) {\n        clearBlankCanvasLongPress(e.pointerId);');
    expect(canvasSource).toContain("if (resolveBlankCanvasGesture(e.pointerType) === 'long-press-pan') {");
    expect(canvasSource).toContain(
      'updateSelectionBox({\n        pointerId: e.pointerId,\n        point: { x: e.clientX, y: e.clientY },\n      });\n      if (getBoxSelectionPreview()?.active) clearBlankCanvasLongPress(e.pointerId);',
    );
  });

  it('routes Ctrl/Meta to fusion only in fusion mode and otherwise toggles selection', () => {
    expect(canvasSource).toContain('resolveImagePointerIntent({');
    expect(canvasSource).toContain('fusionMode: showRefFusion');
    expect(canvasSource).toContain("pointerIntent === 'fusion-group'");
    expect(canvasSource).toContain("pointerIntent === 'toggle-selection' ? 'toggle'");
  });

  it('rolls back ordinary, generation and hex group previews on pointer cancel', () => {
    expect(canvasSource).toContain('const cancelGroupDragPreviews = useCallback(() => {');
    expect(canvasSource).toContain('groupDragReadyRef.current = false;');
    expect(canvasSource).toContain('genGroupDragReadyRef.current = false;');
    expect(canvasSource).toContain('hexCubeDragReadyRef.current = false;');
    expect(canvasSource).toContain('cancelGroupDragPreviews();');
  });

  it('reads the controller ref instead of rendered preview state during pointer move', () => {
    expect(canvasSource).toContain('if (getBoxSelectionPreview()) {\n      updateSelectionBox({');
  });
});
