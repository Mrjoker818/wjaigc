import { describe, expect, it } from 'vitest';

import {
  beginAnnotationGesture,
  beginCanvasAnnotationGesture,
  buildAnnotationSourceVersionId,
  cancelGestureOrCloseMode,
  commitAnnotationGesture,
  commitResolvedSemanticAnnotation,
  commitTextAnnotation,
  createInitialAnnotationControllerState,
  moveTextAnnotation,
  removeAnnotation,
  selectAnnotationTool,
  updateAnnotationGesture,
  updateAnnotationInstruction,
} from '@/features/annotations/use-annotation-controller';
import type { AnnotationSource } from '@/features/annotations/use-annotation-controller';

const source: AnnotationSource = {
  projectId: 'project-1',
  imageId: 'image-1',
  versionId: 'version-1',
  imageRect: { x: 100, y: 100, width: 400, height: 300 },
};

describe('annotation controller state machine', () => {
  it('does not create an annotation when a tool is selected or only clicked', () => {
    let state = createInitialAnnotationControllerState();
    state = selectAnnotationTool(state, 'region');
    expect(state.annotations).toHaveLength(0);

    state = beginAnnotationGesture(state, source, { x: 120, y: 120 });
    expect(state.annotations).toHaveLength(0);

    state = commitAnnotationGesture(state, { x: 123, y: 124 }, 'ann-1', 1);
    expect(state.annotations).toHaveLength(0);
  });

  it('creates exactly one clamped region after a valid drag', () => {
    let state = selectAnnotationTool(createInitialAnnotationControllerState(), 'region');
    state = beginAnnotationGesture(state, source, { x: 420, y: 300 });
    state = updateAnnotationGesture(state, { x: 560, y: 460 });
    state = commitAnnotationGesture(state, { x: 560, y: 460 }, 'ann-1', 1);

    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0].geometry).toEqual({
      kind: 'region',
      region: { x: 0.8, y: 0.666667, w: 0.2, h: 0.333333 },
    });
  });

  it('interpolates a fast brush stroke and keeps it as visible vector geometry', () => {
    let state = selectAnnotationTool(createInitialAnnotationControllerState(), 'brush');
    state = beginAnnotationGesture(state, source, { x: 120, y: 120 });
    state = updateAnnotationGesture(state, { x: 300, y: 120 });
    state = commitAnnotationGesture(state, { x: 300, y: 120 }, 'ann-1', 1);

    expect(state.annotations).toHaveLength(1);
    const geometry = state.annotations[0].geometry;
    expect(geometry.kind).toBe('brush');
    if (geometry.kind === 'brush') {
      expect(geometry.points.length).toBeGreaterThan(2);
      expect(geometry.width).toBeGreaterThan(0);
    }
    expect(state.brushScreenWidths['ann-1']).toBe(12);
  });

  it('commits a meaningful brush loop even when the pointer ends near its start', () => {
    let state = selectAnnotationTool(createInitialAnnotationControllerState(), 'brush');
    state = beginAnnotationGesture(state, source, { x: 120, y: 120 });
    state = updateAnnotationGesture(state, { x: 260, y: 120 });
    state = updateAnnotationGesture(state, { x: 260, y: 260 });
    state = updateAnnotationGesture(state, { x: 122, y: 122 });
    state = commitAnnotationGesture(state, { x: 121, y: 121 }, 'ann-loop', 1);

    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0].geometry.kind).toBe('brush');
  });

  it('locks the first committed source and reports a mismatch without starting another draft', () => {
    const otherSource: AnnotationSource = {
      projectId: 'project-2',
      imageId: 'image-2',
      versionId: 'version-2',
      imageRect: { x: 600, y: 100, width: 400, height: 300 },
    };
    let state = selectAnnotationTool(createInitialAnnotationControllerState(), 'region');
    state = beginAnnotationGesture(state, source, { x: 120, y: 120 });
    state = updateAnnotationGesture(state, { x: 220, y: 220 });
    state = commitAnnotationGesture(state, { x: 220, y: 220 }, 'ann-1', 1);

    state = beginAnnotationGesture(state, otherSource, { x: 620, y: 120 });

    expect(state.gesture.kind).toBe('idle');
    expect(state.annotations).toHaveLength(1);
    expect(state.sourceMismatch).toEqual({
      code: 'source-mismatch',
      expected: {
        projectId: 'project-1',
        imageId: 'image-1',
        versionId: 'version-1',
      },
      received: {
        projectId: 'project-2',
        imageId: 'image-2',
        versionId: 'version-2',
      },
    });
  });

  it('locks the first draft source before any annotation is committed', () => {
    const otherSource: AnnotationSource = {
      ...source,
      imageId: 'image-2',
      versionId: 'version-2',
    };
    let state = selectAnnotationTool(createInitialAnnotationControllerState(), 'brush');
    state = beginAnnotationGesture(state, source, { x: 120, y: 120 });
    state = beginAnnotationGesture(state, otherSource, { x: 140, y: 140 });

    expect(state.gesture.kind).toBe('brush');
    expect(state.sourceMismatch?.code).toBe('source-mismatch');
    expect(state.sourceLock?.imageId).toBe('image-1');
  });

  it('starts a fresh canvas annotation session when the user switches images', () => {
    const otherSource: AnnotationSource = {
      ...source,
      imageId: 'image-2',
      versionId: 'version-2',
      imageRect: { x: 600, y: 100, width: 400, height: 300 },
    };
    let state = selectAnnotationTool(createInitialAnnotationControllerState(), 'region');
    state = beginAnnotationGesture(state, source, { x: 120, y: 120 });
    state = commitAnnotationGesture(state, { x: 220, y: 220 }, 'ann-1', 1);

    state = beginCanvasAnnotationGesture(state, otherSource, { x: 620, y: 120 });

    expect(state.annotations).toHaveLength(0);
    expect(state.gesture.kind).toBe('region');
    expect(state.sourceLock).toEqual({
      projectId: 'project-1',
      imageId: 'image-2',
      versionId: 'version-2',
    });
    expect(state.sourceMismatch).toBeNull();
  });

  it('carries the current prompt onto a committed arrow', () => {
    let state = selectAnnotationTool(createInitialAnnotationControllerState(), 'arrow');
    state = { ...state, prompt: 'Move the subject to the right' };
    state = beginAnnotationGesture(state, source, { x: 120, y: 120 });
    state = commitAnnotationGesture(state, { x: 260, y: 180 }, 'ann-arrow', 1);

    expect(state.annotations[0].instruction).toBe('Move the subject to the right');
  });

  it('commits a semantic annotation only after a resolved target is supplied', () => {
    let state = createInitialAnnotationControllerState();
    state = beginAnnotationGesture(state, source, { x: 220, y: 180 });

    expect(state.annotations).toHaveLength(0);

    state = commitResolvedSemanticAnnotation(
      state,
      {
        label: '人物外套',
        confidence: 0.91,
        region: { x: 0.2, y: 0.1, w: 0.3, h: 0.5 },
      },
      'semantic-1',
      2,
    );

    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0]).toMatchObject({
      id: 'semantic-1',
      type: 'semantic-object',
      label: '人物外套',
      confidence: 0.91,
      geometry: {
        kind: 'semantic-object',
        region: { x: 0.2, y: 0.1, w: 0.3, h: 0.5 },
      },
    });
    expect(state.gesture.kind).toBe('idle');
  });

  it('does not commit a semantic result after its gesture was cancelled', () => {
    const state = commitResolvedSemanticAnnotation(
      createInitialAnnotationControllerState(),
      {
        label: '人物外套',
        confidence: 0.91,
        region: { x: 0.2, y: 0.1, w: 0.3, h: 0.5 },
      },
      'semantic-1',
      2,
    );

    expect(state.annotations).toHaveLength(0);
  });

  it('clears an unfinished gesture when switching tools', () => {
    let state = selectAnnotationTool(createInitialAnnotationControllerState(), 'brush');
    state = beginAnnotationGesture(state, source, { x: 120, y: 120 });
    state = updateAnnotationGesture(state, { x: 180, y: 120 });

    state = selectAnnotationTool(state, 'arrow');
    state = commitAnnotationGesture(state, { x: 260, y: 120 }, 'ann-1', 1);

    expect(state.annotations).toHaveLength(0);
    expect(state.tool).toBe('arrow');
  });

  it('places text before its instruction is entered, then keeps it editable, movable, and deletable', () => {
    let state = selectAnnotationTool(createInitialAnnotationControllerState(), 'text');
    state = beginAnnotationGesture(state, source, { x: 200, y: 180 });
    state = commitTextAnnotation(state, '   ', 'ann-1', 1);

    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0].instruction).toBeUndefined();

    state = updateAnnotationInstruction(state, 'ann-1', 'Replace this copy', 2);
    expect(state.annotations[0].instruction).toBe('Replace this copy');

    state = moveTextAnnotation(
      state,
      'ann-1',
      { x: 420, y: 300 },
      source.imageRect,
      3,
    );
    expect(state.annotations[0].geometry).toEqual({
      kind: 'text',
      point: { x: 0.8, y: 0.666667 },
    });

    state = removeAnnotation(state, 'ann-1');
    expect(state.annotations).toHaveLength(0);
  });

  it('builds a compact stable source version without embedding image URLs', () => {
    const dataUrl = `data:image/png;base64,${'a'.repeat(10_000)}`;
    const first = buildAnnotationSourceVersionId('image-1', 1_725_000_000_000, dataUrl);
    const second = buildAnnotationSourceVersionId(
      'image-1',
      1_725_000_000_000,
      'https://cdn.example.com/replaced.png?token=secret',
    );

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(96);
    expect(first).not.toContain('data:');
    expect(first).not.toContain('http');
  });

  it('cancels a draft before closing annotation mode and preserves committed marks', () => {
    let state = selectAnnotationTool(createInitialAnnotationControllerState(), 'region');
    state = beginAnnotationGesture(state, source, { x: 120, y: 120 });

    state = cancelGestureOrCloseMode(state);
    expect(state.isOpen).toBe(true);
    expect(state.gesture.kind).toBe('idle');

    state = beginAnnotationGesture(state, source, { x: 120, y: 120 });
    state = commitAnnotationGesture(state, { x: 220, y: 220 }, 'ann-1', 1);
    state = cancelGestureOrCloseMode(state);

    expect(state.isOpen).toBe(false);
    expect(state.annotations).toHaveLength(1);
  });
});
