import { describe, expect, it } from 'vitest';

import {
  encodeSelectedModelsForStorage,
  resolveSelectedModelsStorageKind,
} from '@/lib/api-provider-selected-models-storage';

describe('API provider selected-model storage compatibility', () => {
  it('encodes selected models for historical JSONB provider tables', () => {
    const kind = resolveSelectedModelsStorageKind([
      { column_name: 'selected_models', data_type: 'jsonb', udt_name: 'jsonb' },
    ]);

    expect(kind).toBe('jsonb');
    expect(encodeSelectedModelsForStorage(['gpt-image-2'], kind)).toBe('["gpt-image-2"]');
  });

  it('keeps native arrays for current TEXT[] provider tables', () => {
    const kind = resolveSelectedModelsStorageKind([
      { column_name: 'selected_models', data_type: 'ARRAY', udt_name: '_text' },
    ]);

    expect(kind).toBe('text-array');
    expect(encodeSelectedModelsForStorage(['gpt-image-2'], kind)).toEqual(['gpt-image-2']);
  });
});
