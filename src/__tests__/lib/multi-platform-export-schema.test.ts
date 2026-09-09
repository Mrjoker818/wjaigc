import { describe, expect, it } from 'vitest';

import { parseMultiPlatformExportInput } from '@/lib/multi-platform-export/schema';

const validInput = {
  sourceAssetVersionIds: ['version-a'],
  targetPresetIds: ['instagram-post-v1'],
  fit: 'cover',
  background: '#ffffffff',
  namingTemplate: '{project}-{asset}-{platform}-{size}-{index}',
};

describe('multi-platform export input schema', () => {
  it('normalizes a valid bounded input without changing source order', () => {
    expect(parseMultiPlatformExportInput({
      ...validInput,
      sourceAssetVersionIds: [' version-b ', 'version-a'],
      fit: 'contain',
      background: '#AABBCCDD',
      namingTemplate: ' {asset}-{index} ',
    })).toEqual({
      sourceAssetVersionIds: ['version-b', 'version-a'],
      targetPresetIds: ['instagram-post-v1'],
      fit: 'contain',
      background: '#aabbccdd',
      namingTemplate: '{asset}-{index}',
    });
  });

  it.each([
    [{ ...validInput, sourceAssetVersionIds: [] }, 'EXPORT_SOURCE_COUNT_INVALID'],
    [{ ...validInput, sourceAssetVersionIds: Array.from({ length: 21 }, (_, i) => `version-${i}`) }, 'EXPORT_SOURCE_COUNT_INVALID'],
    [{ ...validInput, targetPresetIds: [] }, 'EXPORT_TARGET_COUNT_INVALID'],
    [{ ...validInput, targetPresetIds: Array.from({ length: 21 }, (_, i) => `preset-${i}-v1`) }, 'EXPORT_TARGET_COUNT_INVALID'],
    [{ ...validInput, fit: 'stretch' }, 'EXPORT_FIT_INVALID'],
    [{ ...validInput, background: '#ffffff' }, 'EXPORT_BACKGROUND_INVALID'],
    [{ ...validInput, namingTemplate: '' }, 'EXPORT_NAMING_TEMPLATE_INVALID'],
    [{ ...validInput, namingTemplate: 'x'.repeat(161) }, 'EXPORT_NAMING_TEMPLATE_INVALID'],
    [{ ...validInput, namingTemplate: '{unknown}' }, 'EXPORT_NAMING_TEMPLATE_INVALID'],
    [{ ...validInput, extra: true }, 'EXPORT_INPUT_UNKNOWN_FIELD'],
  ] as const)('rejects invalid input with %s', (value, code) => {
    expect(() => parseMultiPlatformExportInput(value)).toThrow(code);
  });

  it('rejects duplicate and malformed source or target identifiers', () => {
    expect(() => parseMultiPlatformExportInput({
      ...validInput,
      sourceAssetVersionIds: ['version-a', ' version-a '],
    })).toThrow('EXPORT_SOURCE_ID_DUPLICATE');
    expect(() => parseMultiPlatformExportInput({
      ...validInput,
      sourceAssetVersionIds: ['../version-a'],
    })).toThrow('EXPORT_SOURCE_ID_INVALID');
    expect(() => parseMultiPlatformExportInput({
      ...validInput,
      targetPresetIds: ['instagram-post-v1', 'instagram-post-v1'],
    })).toThrow('EXPORT_TARGET_ID_DUPLICATE');
    expect(() => parseMultiPlatformExportInput({
      ...validInput,
      targetPresetIds: ['instagram-post'],
    })).toThrow('EXPORT_TARGET_ID_INVALID');
    expect(() => parseMultiPlatformExportInput({
      ...validInput,
      targetPresetIds: ['instagram-post-v2147483648'],
    })).toThrow('EXPORT_TARGET_ID_INVALID');
    expect(parseMultiPlatformExportInput({
      ...validInput,
      targetPresetIds: ['instagram-post-v2147483647'],
    }).targetPresetIds).toEqual(['instagram-post-v2147483647']);
  });

  it('rejects an oversized serialized request before field parsing', () => {
    expect(() => parseMultiPlatformExportInput({
      ...validInput,
      padding: 'x'.repeat(20_000),
    })).toThrow('EXPORT_INPUT_SERIALIZED_LIMIT_EXCEEDED');
  });
});
