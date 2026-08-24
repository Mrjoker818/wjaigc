import { describe, expect, it } from 'vitest';

import {
  applyDescriptorApprovedImageFields,
  buildDescriptorImageRequestFields,
  normalizeRequestedPixelSize,
} from '@/lib/task-core/descriptor-image-request-fields';

describe('descriptor-bound image request fields', () => {
  it('treats a blank legacy size field as omitted before capability admission', () => {
    expect(normalizeRequestedPixelSize('')).toBeUndefined();
    expect(normalizeRequestedPixelSize('   ')).toBeUndefined();
    expect(normalizeRequestedPixelSize('1024x1024')).toBe('1024x1024');
  });

  it('keeps descriptor-approved explicit pixel size, quality, and resolution after legacy filtering', () => {
    const requested = buildDescriptorImageRequestFields({
      aspectRatio: '16:9',
      requestedPixelSize: '4096x2304',
      quality: 'ultra',
      resolution: '4K',
    });
    const legacyFiltered = {
      model: 'image-model',
      size: '1024x1024',
      quality: 'standard',
      resolution: '1K',
    };

    expect(applyDescriptorApprovedImageFields(legacyFiltered, requested)).toMatchObject({
      size: '4096x2304',
      quality: 'ultra',
      resolution: '4K',
    });
  });

  it('does not synthesize quality or resolution when the user did not request them', () => {
    const requested = buildDescriptorImageRequestFields({ aspectRatio: '1:1' });

    expect(requested).toEqual({ size: '1:1' });
    expect(applyDescriptorApprovedImageFields({
      model: 'image-model', size: '1:1', quality: 'standard', resolution: '2K',
    }, requested)).toEqual({ model: 'image-model', size: '1:1' });
  });

  it('uses protocol aspect-ratio mapping only when that protocol requires it', () => {
    const requested = buildDescriptorImageRequestFields({
      aspectRatio: '16:9',
      requestedPixelSize: '4096x2304',
      sizeFormat: 'aspect-ratio',
    });

    expect(requested).toEqual({ size: '16:9', sizePx: '4096x2304' });
  });
});
