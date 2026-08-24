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
    expect(source).toContain("pointerIntent === 'reference-group'");
    expect(source).toContain("pointerIntent === 'fusion-group'");
    expect(source).toContain('fusionMode: showRefFusion');
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

  it('isolates image and generation group controls from the root canvas pointer handler', () => {
    expect(source).toContain('data-toolbar="image-group"');
    expect(source).toContain('data-toolbar="generation-group"');
    expect(source).toContain("[data-floating-panel], [data-popup], [data-modal], [data-toolbar], [data-compare-dialog]");
  });

  it('keeps reference and fusion groups usable when the user has not typed a prompt yet', () => {
    expect(source).toContain("const effectivePrompt = toolbar.prompt.trim() || 'Generate a creative variation of the reference image(s).';");
    expect(source).toContain('disabled={group.resultPlaceholder.isProcessing || !group.toolbar.model || !group.toolbar.providerId');
    expect(source).toContain('taskModelCatalogIndex.has(taskModelKey(group.toolbar.providerId, group.toolbar.model))');
  });

  it('uses reference category controls as the grouped image-to-image fidelity input', () => {
    expect(source).toContain('buildGroupReferenceRequestControls(');
    expect(source).toContain('referenceCategoryStrengths');
    expect(source).toContain('REFERENCE_CATEGORIES.map(category => [category, 70])');
  });

  it('keeps reference metadata scoped to the generation request so parallel groups cannot overwrite each other', () => {
    expect(source).toContain('const referenceMeta: {');
    expect(source).not.toContain('groupRefMetaRef');
  });

  it('keeps reference descriptions index-aligned with their source images', () => {
    expect(source).toContain("referenceDescriptions: succeededIndices.map(index => referenceMeta.referenceDescriptions?.[index] || '')");
    expect(source).not.toContain("referenceDescriptions: succeededIndices.map(index => referenceMeta.referenceDescriptions?.[index] || '').filter(");
  });

  it('uses a canvas-transformed menu for group settings instead of native selects', () => {
    expect(source).toContain('function CanvasScaledMenuSelect');
    expect(source).toContain('<CanvasScaledMenuSelect');
    expect(source).toContain('openGroupConfigDropdown');
  });

  it('does not expose a separate vision-to-text action as the reference fidelity control', () => {
    expect(source).not.toContain("handleAnalyzeGroupReferences(group.id)");
    expect(source).not.toContain("'识别参考图'");
  });
});
