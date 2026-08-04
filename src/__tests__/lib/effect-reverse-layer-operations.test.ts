import { describe, expect, it } from 'vitest';
import {
  addManualRegion,
  moveRegion,
  removeRegion,
  updateRegion,
} from '@/lib/effect-reverse-engineering/layer-operations';
import type { EffectReverseRegion } from '@/lib/effect-reverse-engineering/types';

const regions: EffectReverseRegion[] = [
  { id: 'a', kind: 'wall', label: '墙面', points: [], visible: true, locked: false, inferred: false },
  { id: 'b', kind: 'floor', label: '地面', points: [], visible: true, locked: false, inferred: false },
];

describe('effect reverse engineering layer operations', () => {
  it('updates visibility and lock state without mutating the input', () => {
    const hidden = updateRegion(regions, 'a', { visible: false, locked: true });
    expect(hidden[0]).toMatchObject({ visible: false, locked: true });
    expect(regions[0]).toMatchObject({ visible: true, locked: false });
  });

  it('renames, removes, and reorders deterministic layer ids', () => {
    expect(updateRegion(regions, 'a', { label: '主墙' })[0].label).toBe('主墙');
    expect(removeRegion(regions, 'a').map((region) => region.id)).toEqual(['b']);
    expect(moveRegion(regions, 0, 1).map((region) => region.id)).toEqual(['b', 'a']);
    expect(moveRegion(regions, 0, -1)).toEqual(regions);
  });

  it('adds a manual region with a stable caller-provided id and no inferred claim', () => {
    const next = addManualRegion(regions, 'region-3', '结构区域 3');
    expect(next.at(-1)).toMatchObject({
      id: 'region-3',
      label: '结构区域 3',
      visible: true,
      locked: false,
      inferred: false,
    });
    expect(next.at(-1)?.points).toHaveLength(4);
  });
});
