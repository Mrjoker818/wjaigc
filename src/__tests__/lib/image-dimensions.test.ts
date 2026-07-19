import { describe, expect, it } from 'vitest';
import { getImageDimensionValidationError } from '@/lib/image-dimensions';

describe('image dimension validation', () => {
  it('rejects an image whose longest edge exceeds the configured limit', () => {
    expect(getImageDimensionValidationError({ width: 4097, height: 1024 }, 4096))
      .toBe('Image dimensions exceed the 4096px maximum edge');
  });

  it('accepts an image whose longest edge is within the configured limit', () => {
    expect(getImageDimensionValidationError({ width: 4096, height: 1024 }, 4096)).toBeNull();
  });
});
