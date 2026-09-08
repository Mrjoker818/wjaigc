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
});
