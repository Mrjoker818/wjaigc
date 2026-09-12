import { describe, expect, expectTypeOf, it } from 'vitest';

import type { SkillInputField } from '@/lib/skill-runtime/types';
import { assertSkillInputDefinitions } from '@/lib/skill-runtime/input-resolver';

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

  it('rejects malformed capability metadata without invoking accessors', () => {
    let getterCalls = 0;
    const capabilityOptions: Record<string, unknown> = { field: 'durationSeconds' };
    Object.defineProperty(capabilityOptions, 'modelRole', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'video';
      },
    });
    const field = {
      key: 'durationSeconds', label: '视频时长', kind: 'select', required: true,
      capabilityOptions,
    } as unknown as SkillInputField;

    expect(() => assertSkillInputDefinitions([field])).toThrow('SKILL_INPUT_INVALID_DEFINITION');
    expect(getterCalls).toBe(0);
  });

  it.each([
    { modelRole: 'image', field: 'durationSeconds' },
    { modelRole: 'video', field: 'quality' },
    { modelRole: 'video', field: 'durationSeconds', extra: true },
  ])('rejects unsupported capability metadata %#', capabilityOptions => {
    expect(() => assertSkillInputDefinitions([{
      key: 'durationSeconds', label: '视频时长', kind: 'select', required: true,
      capabilityOptions,
    } as unknown as SkillInputField])).toThrow('SKILL_INPUT_INVALID_DEFINITION');
  });
});
