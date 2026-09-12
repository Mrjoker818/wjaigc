import { describe, expect, expectTypeOf, it } from 'vitest';

import type { SkillInputField } from '@/lib/skill-runtime/types';

describe('skill capability input metadata', () => {
  it('binds dynamic video selects to one explicit capability field', () => {
    const field = {
      key: 'durationSeconds',
      label: '视频时长',
      kind: 'select',
      required: true,
      capabilityOptions: { modelRole: 'video', field: 'durationSeconds' },
    } satisfies SkillInputField;

    expect(field.capabilityOptions).toEqual({
      modelRole: 'video',
      field: 'durationSeconds',
    });
    expectTypeOf(field.capabilityOptions.field).toMatchTypeOf<
      'durationSeconds' | 'aspectRatio' | 'resolution'
    >();
  });
});
