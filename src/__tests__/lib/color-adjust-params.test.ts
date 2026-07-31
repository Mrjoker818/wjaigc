import { describe, expect, it } from 'vitest';

import {
  colorAdjustPreviewFilter,
  normalizeColorAdjustParams,
} from '@/lib/image-tools/color-adjust-params';

describe('color adjustment parameters', () => {
  it('normalizes missing and invalid values to the neutral preset', () => {
    expect(normalizeColorAdjustParams(null)).toEqual({
      brightness: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      hue: 0,
      highlights: 0,
      shadows: 0,
    });
  });

  it('clamps hue to degrees and the remaining controls to percentages', () => {
    expect(normalizeColorAdjustParams({
      brightness: 200,
      contrast: -300,
      saturation: 150,
      temperature: -150,
      hue: 540,
      highlights: 101,
      shadows: -101,
    })).toEqual({
      brightness: 100,
      contrast: -100,
      saturation: 100,
      temperature: -100,
      hue: 180,
      highlights: 100,
      shadows: -100,
    });
  });

  it('uses the normalized hue directly in the approximate CSS preview', () => {
    const filter = colorAdjustPreviewFilter(normalizeColorAdjustParams({ hue: -180 }));
    expect(filter).toContain('hue-rotate(-180deg)');
    expect(filter).not.toContain('-324deg');
  });
});
