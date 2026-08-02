import { describe, expect, it } from 'vitest';

import { reconcileCompletedGenerationSlot } from '@/lib/canvas-generation-reconciliation';

interface TestCanvasItem {
  id: string;
  x: number;
  y: number;
  placeholder?: boolean;
}

describe('reconcileCompletedGenerationSlot', () => {
  it('replaces an uncompleted placeholder while preserving its canvas position', () => {
    const result = reconcileCompletedGenerationSlot<TestCanvasItem>(
      [{ id: 'placeholder-1', x: 120, y: 240, placeholder: true }],
      {
        placeholderId: 'placeholder-1',
        result: { id: 'result-1', x: 0, y: 0 },
      },
    );

    expect(result).toEqual([{ id: 'result-1', x: 120, y: 240 }]);
  });

  it('does not append a duplicate when per-task polling already replaced the slot', () => {
    const existing = { id: 'result-1', x: 120, y: 240 };
    const result = reconcileCompletedGenerationSlot<TestCanvasItem>(
      [existing],
      {
        placeholderId: 'placeholder-1',
        result: { id: 'result-1', x: 0, y: 0 },
      },
    );

    expect(result).toEqual([existing]);
  });

  it('uses the original slot position if a restored canvas no longer contains the placeholder', () => {
    const result = reconcileCompletedGenerationSlot<TestCanvasItem>(
      [{ id: 'existing', x: 10, y: 20 }],
      {
        placeholderId: 'placeholder-1',
        result: { id: 'result-1', x: 0, y: 0 },
        fallbackPosition: { x: 360, y: 480 },
      },
    );

    expect(result).toEqual([
      { id: 'existing', x: 10, y: 20 },
      { id: 'result-1', x: 360, y: 480 },
    ]);
  });
});
