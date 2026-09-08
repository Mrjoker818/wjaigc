// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SkillInputFields } from '@/components/skill-runtime/SkillInputFields';
import type { SkillInputField } from '@/lib/skill-runtime/types';

const fields: readonly SkillInputField[] = [
  { key: 'platform', label: '平台', kind: 'select', required: true, options: ['Amazon', '淘宝/天猫'] },
  {
    key: 'region', label: '地区', kind: 'select', required: true,
    dependentOptions: {
      inputKey: 'platform',
      values: { Amazon: ['US', 'EU', 'JP'], '淘宝/天猫': ['CN'] },
    },
  },
  { key: 'claims', label: '待审核声明', kind: 'text', required: false, maximumLength: 4_000 },
];

describe('SkillInputFields dependent constraints', () => {
  it('renders dependent options and the declared maximum length', () => {
    render(<SkillInputFields fields={fields} values={{ platform: 'Amazon', region: 'US' }} onChange={vi.fn()} />);
    expect(Array.from((screen.getByLabelText('地区') as HTMLSelectElement).options)
      .map(option => option.value)).toEqual(['US', 'EU', 'JP']);
    expect(screen.getByLabelText('待审核声明').getAttribute('maxlength')).toBe('4000');
  });

  it('clears a region that becomes invalid when the platform changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SkillInputFields fields={fields} values={{ platform: 'Amazon', region: 'US' }} onChange={onChange} />,
    );
    onChange.mockClear();
    rerender(
      <SkillInputFields fields={fields} values={{ platform: '淘宝/天猫', region: 'US' }} onChange={onChange} />,
    );
    expect(onChange).toHaveBeenCalledWith('region', undefined);
  });

  it('keeps a restored region valid when its platform comes from defaultValue', () => {
    const onChange = vi.fn();
    const fieldsWithDefault: readonly SkillInputField[] = [
      { ...fields[0], defaultValue: 'Amazon' },
      fields[1],
    ];

    render(<SkillInputFields fields={fieldsWithDefault} values={{ region: 'US' }} onChange={onChange} />);

    expect(Array.from((screen.getByLabelText('地区') as HTMLSelectElement).options)
      .map(option => option.value)).toEqual(['US', 'EU', 'JP']);
    expect(onChange).not.toHaveBeenCalledWith('region', undefined);
  });

  it('does not invoke dependentOptions accessors while rendering invalid metadata', () => {
    let getterCalls = 0;
    const unsafe: Record<string, unknown> = {
      key: 'region', label: '地区', kind: 'select', required: true,
    };
    Object.defineProperty(unsafe, 'dependentOptions', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('UI getter must not run');
      },
    });

    expect(() => render(
      <SkillInputFields
        fields={[unsafe as unknown as SkillInputField]}
        values={{ region: 'US' }}
        onChange={vi.fn()}
      />,
    )).not.toThrow();
    expect(getterCalls).toBe(0);
  });
});
