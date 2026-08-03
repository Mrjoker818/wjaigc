import { describe, expect, it } from 'vitest';

import type { NormalizedQuad } from '@/lib/effect-reverse-engineering/types';
import { warpPerspectiveRgba } from '@/lib/effect-reverse-engineering/perspective';

const identityQuad: NormalizedQuad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('effect reverse engineering perspective correction', () => {
  it('keeps an identity quadrilateral byte-identical', () => {
    const source = Buffer.from([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ]);

    expect(warpPerspectiveRgba(source, 2, 2, identityQuad, 2, 2)).toEqual(source);
  });

  it('maps a normalized trapezoid into requested output dimensions', () => {
    const source = Buffer.alloc(4 * 4 * 4, 255);
    const trapezoid: NormalizedQuad = [
      { x: 0.2, y: 0 },
      { x: 0.8, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];

    expect(warpPerspectiveRgba(source, 4, 4, trapezoid, 8, 6)).toHaveLength(8 * 6 * 4);
  });

  it('rejects singular quadrilaterals and unsafe output sizes', () => {
    const source = Buffer.alloc(2 * 2 * 4, 255);
    const singular: NormalizedQuad = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.3 },
      { x: 0.6, y: 0.6 },
      { x: 1, y: 1 },
    ];

    expect(() => warpPerspectiveRgba(source, 2, 2, singular, 2, 2)).toThrow(/singular/i);
    expect(() => warpPerspectiveRgba(source, 2, 2, identityQuad, 20_000, 20_000)).toThrow(/pixel/i);
  });
});
