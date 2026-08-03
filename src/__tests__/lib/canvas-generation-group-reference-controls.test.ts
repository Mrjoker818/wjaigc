import { describe, expect, it } from 'vitest';
import {
  REFERENCE_CATEGORIES,
  buildGroupReferenceRequestControls,
} from '@/lib/canvas-generation-group';

describe('buildGroupReferenceRequestControls', () => {
  it('preserves each selected reference category strength instead of flattening to one image-wide maximum', () => {
    const controls = buildGroupReferenceRequestControls(
      'reference',
      [{ imageId: 'source-a' }],
      { 'source-a': ['style', 'subject'] },
      { 'source-a': { style: 85, subject: 20 } },
    );

    expect(controls.referenceCategories).toEqual({ '0': ['style', 'subject'] });
    expect(controls.referenceCategoryStrengths).toEqual({
      '0': { style: 85, subject: 20 },
    });
    expect(controls.referenceStrengths).toEqual([85]);
    expect(controls.generationStrength).toBeGreaterThan(0.15);
    expect(controls.generationStrength).toBeLessThan(0.8);
  });

  it('treats every fusion source as a full-content reference with strict preservation', () => {
    const controls = buildGroupReferenceRequestControls(
      'fusion',
      [{ imageId: 'source-a' }, { imageId: 'source-b' }],
      {},
      {},
    );

    expect(controls.referenceCategories).toEqual({
      '0': [...REFERENCE_CATEGORIES],
      '1': [...REFERENCE_CATEGORIES],
    });
    expect(controls.referenceCategoryStrengths).toEqual({
      '0': {
        style: 100,
        composition: 100,
        scene: 100,
        color: 100,
        subject: 100,
        detail: 100,
      },
      '1': {
        style: 100,
        composition: 100,
        scene: 100,
        color: 100,
        subject: 100,
        detail: 100,
      },
    });
    expect(controls.referenceStrengths).toEqual([100, 100]);
    expect(controls.generationStrength).toBe(0.05);
  });
});
