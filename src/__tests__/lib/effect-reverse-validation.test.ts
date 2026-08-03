import { describe, expect, it } from 'vitest';

import type {
  EffectReverseSessionInput,
  NormalizedPoint,
} from '@/lib/effect-reverse-engineering/types';
import {
  EffectReverseValidationError,
  validateEffectReverseSessionInput,
} from '@/lib/effect-reverse-engineering/validation';

const validPerspective: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] = [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 },
];

function createInput(overrides: Partial<EffectReverseSessionInput> = {}): EffectReverseSessionInput {
  return {
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    imageUrl: '/api/serve-upload/uploads/source.png',
    perspective: validPerspective,
    regions: [],
    instruction: '',
    ...overrides,
  };
}

describe('effect reverse engineering validation', () => {
  it('accepts one frozen managed source and normalized quadrilateral', () => {
    expect(() => validateEffectReverseSessionInput(createInput())).not.toThrow();
  });

  it.each([
    {
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      code: 'EFFECT_REVERSE_PERSPECTIVE_INVALID',
    },
    {
      points: [{ x: -0.01, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      code: 'EFFECT_REVERSE_POINT_INVALID',
    },
  ])('rejects invalid perspective geometry with $code', ({ points, code }) => {
    expect(() => validateEffectReverseSessionInput(createInput({
      perspective: points as EffectReverseSessionInput['perspective'],
    }))).toThrowError(expect.objectContaining({ code }));
  });

  it('rejects a region with more than 128 points', () => {
    expect(() => validateEffectReverseSessionInput(createInput({
      regions: [{
        id: 'region-1',
        kind: 'wall',
        label: 'Wall',
        visible: true,
        locked: false,
        inferred: false,
        points: Array.from({ length: 129 }, () => ({ x: 0.5, y: 0.5 })),
      }],
    }))).toThrow(/128/);
  });

  it('rejects data URLs and untrusted source paths', () => {
    expect(() => validateEffectReverseSessionInput(createInput({
      imageUrl: 'data:image/png;base64,AAAA',
    }))).toThrowError(expect.objectContaining({ code: 'EFFECT_REVERSE_SOURCE_INVALID' }));

    expect(() => validateEffectReverseSessionInput(createInput({
      imageUrl: '/private/arbitrary-file.png',
    }))).toThrowError(expect.objectContaining({ code: 'EFFECT_REVERSE_SOURCE_INVALID' }));
  });

  it('enforces region, text, and request-size limits', () => {
    const region = {
      id: 'region-1',
      kind: 'custom' as const,
      label: 'Region',
      visible: true,
      locked: false,
      inferred: false,
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    };

    expect(() => validateEffectReverseSessionInput(createInput({
      regions: Array.from({ length: 81 }, (_, index) => ({ ...region, id: `region-${index}` })),
    }))).toThrow(/80/);
    expect(() => validateEffectReverseSessionInput(createInput({
      regions: [{ ...region, label: 'x'.repeat(121) }],
    }))).toThrow(/120/);
    expect(() => validateEffectReverseSessionInput(createInput({
      instruction: 'x'.repeat(4_001),
    }))).toThrow(/4000/);
    expect(() => validateEffectReverseSessionInput(createInput({
      instruction: '界'.repeat(90_000),
    }))).toThrowError(EffectReverseValidationError);
  });
});
