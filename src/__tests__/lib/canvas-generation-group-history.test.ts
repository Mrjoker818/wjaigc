import { describe, expect, it } from 'vitest';
import {
  captureGenerationGroupSourcePositions,
  reconcileGenerationGroupPositions,
  type CanvasGenGroup,
} from '@/lib/canvas-generation-group';

function group(): CanvasGenGroup {
  return {
    id: 'group-1',
    type: 'reference',
    status: 'idle',
    refImages: [],
    sourceImageIds: ['a', 'b'],
    sourcePositions: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    resultPlaceholder: { x: 300, y: 80, width: 100, height: 100, aspectRatio: '1:1' },
    position: { x: 0, y: 0, sourceCenterX: 100, sourceCenterY: 50, resultX: 300, resultY: 80 },
    toolbar: { model: '', aspectRatio: '1:1', size: '1024x1024', resolution: '1K', quality: 'auto', outputCount: 1, n: 1, prompt: '' },
    sourceCategories: {},
    sourceStrengths: {},
    createdAt: 1,
  };
}

describe('generation group history reconciliation', () => {
  it('moves group chrome and result placeholder with an undone source-image move', () => {
    const reconciled = reconcileGenerationGroupPositions([group()], [
      { id: 'a', x: -40, y: -20, width: 100, height: 100 },
      { id: 'b', x: 60, y: -20, width: 100, height: 100 },
    ]);

    expect(reconciled[0].position).toMatchObject({
      x: -40,
      y: -20,
      sourceCenterX: 60,
      sourceCenterY: 30,
      resultX: 260,
      resultY: 60,
    });
    expect(reconciled[0].resultPlaceholder).toMatchObject({ x: 260, y: 60 });
  });

  it('does not move group chrome when only one source image moves', () => {
    const reconciled = reconcileGenerationGroupPositions([group()], [
      { id: 'a', x: 40, y: 0, width: 100, height: 100 },
      { id: 'b', x: 100, y: 0, width: 100, height: 100 },
    ]);

    expect(reconciled[0].position).toMatchObject({ x: 0, y: 0, resultX: 300, resultY: 80 });
    expect(reconciled[0].resultPlaceholder).toMatchObject({ x: 300, y: 80 });
    expect(reconciled[0].sourcePositions).toEqual({ a: { x: 40, y: 0 }, b: { x: 100, y: 0 } });
  });

  it('initializes missing source anchors without moving an existing group', () => {
    const existing = group();
    delete existing.sourcePositions;
    const reconciled = reconcileGenerationGroupPositions([existing], [
      { id: 'a', x: 40, y: 0, width: 100, height: 100 },
      { id: 'b', x: 100, y: 0, width: 100, height: 100 },
    ]);

    expect(reconciled[0].position).toMatchObject({ x: 0, y: 0, resultX: 300, resultY: 80 });
    expect(reconciled[0].sourcePositions).toEqual({ a: { x: 40, y: 0 }, b: { x: 100, y: 0 } });
  });

  it('moves a newly created group on its first whole-group drag', () => {
    const created = group();
    const initialSources = [
      { id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { id: 'b', x: 100, y: 0, width: 100, height: 100 },
    ];
    created.sourcePositions = captureGenerationGroupSourcePositions(created.sourceImageIds, initialSources);

    const reconciled = reconcileGenerationGroupPositions([created], initialSources.map((source) => ({
      ...source,
      x: source.x + 40,
      y: source.y + 20,
    })));

    expect(reconciled[0].position).toMatchObject({ x: 40, y: 20, resultX: 340, resultY: 100 });
    expect(reconciled[0].resultPlaceholder).toMatchObject({ x: 340, y: 100 });
  });
});
