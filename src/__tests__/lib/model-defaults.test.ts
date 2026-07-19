import { describe, expect, it } from 'vitest';
import { selectInitialModel } from '@/lib/model-defaults';

describe('initial model selection', () => {
  const models = [
    { id: 'provider-a::model-a', isDefault: false },
    { id: 'provider-b::model-b', isDefault: true },
  ];

  it('uses the administrator default when the user has not selected a model', () => {
    expect(selectInitialModel('', models)).toBe('provider-b::model-b');
  });

  it('keeps an existing user selection', () => {
    expect(selectInitialModel('provider-a::model-a', models)).toBe('provider-a::model-a');
  });

  it('falls back to the first model only when no configured default is available', () => {
    expect(selectInitialModel('', [{ id: 'provider-a::model-a', isDefault: false }])).toBe('provider-a::model-a');
  });
});
