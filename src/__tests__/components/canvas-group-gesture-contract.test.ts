import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('canvas group gesture contract', () => {
  it('creates reference and fusion groups from the pointer-down modifier gesture before image dragging starts', () => {
    expect(source).toContain('addReferenceImageToGenGroupRef');
    expect(source).toContain('addFusionImageToGenGroupRef');
    expect(source).toContain('modifierImage && (e.altKey || e.ctrlKey || e.metaKey)');
    expect(source).toContain('addReferenceImageToGenGroupRef.current(modifierImage);');
    expect(source).toContain('addFusionImageToGenGroupRef.current(modifierImage);');
  });

  it('restores blank-canvas long-press panning without stealing a moved box-selection gesture', () => {
    expect(source).toContain('canvasLongPressTimerRef');
    expect(source).toContain('startBlankCanvasLongPress');
    expect(source).toContain('clearBlankCanvasLongPress');
    expect(source).toContain('setIsPanning(true);');
  });

  it('uses captured pointer events for ordinary and generation group title dragging', () => {
    expect(source).toContain('data-canvas-group-drag-handle');
    expect(source).toContain('onPointerDown={(e) => {');
    expect(source).toContain('e.currentTarget.setPointerCapture(e.pointerId);');
  });

  it('keeps reference and fusion groups usable when the user has not typed a prompt yet', () => {
    expect(source).toContain("const effectivePrompt = toolbar.prompt.trim() || 'Generate a creative variation of the reference image(s).';");
    expect(source).toContain('disabled={group.resultPlaceholder.isProcessing || !group.toolbar.model}');
  });

  it('offers an explicit reference-analysis action and persists its descriptions for grouped generation', () => {
    expect(source).toContain('const handleAnalyzeGroupReferences = useCallback');
    expect(source).toContain('referenceDescriptions: Record<string, string>');
    expect(source).toContain('onClick={() => handleAnalyzeGroupReferences(group.id)}');
  });

  it('keeps reference metadata scoped to the generation request so parallel groups cannot overwrite each other', () => {
    expect(source).toContain('const referenceMeta: {');
    expect(source).not.toContain('groupRefMetaRef');
  });
});
