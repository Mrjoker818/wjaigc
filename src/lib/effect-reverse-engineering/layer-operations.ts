import type { EffectReverseRegion } from './types';

export function updateRegion(regions: EffectReverseRegion[], id: string, patch: Partial<EffectReverseRegion>): EffectReverseRegion[] {
  return regions.map((region) => region.id === id ? { ...region, ...patch } : region);
}

export function removeRegion(regions: EffectReverseRegion[], id: string): EffectReverseRegion[] {
  return regions.filter((region) => region.id !== id);
}

export function moveRegion(regions: EffectReverseRegion[], index: number, direction: -1 | 1): EffectReverseRegion[] {
  const target = index + direction;
  if (index < 0 || index >= regions.length || target < 0 || target >= regions.length) return regions;
  const next = [...regions];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function addManualRegion(regions: EffectReverseRegion[], id: string, label: string): EffectReverseRegion[] {
  return [...regions, {
    id,
    kind: 'custom',
    label,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ],
    visible: true,
    locked: false,
    inferred: false,
  }];
}
