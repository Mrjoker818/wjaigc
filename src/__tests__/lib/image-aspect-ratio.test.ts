import { describe, expect, it } from 'vitest';
import { closestSupportedImageAspectRatio } from '@/lib/image-aspect-ratio';

describe('closestSupportedImageAspectRatio', () => {
  it('keeps square canvas images on the supported square ratio', () => {
    expect(closestSupportedImageAspectRatio(1254, 1254)).toBe('1:1');
  });

  it('maps a wide canvas image to the closest supported landscape ratio', () => {
    expect(closestSupportedImageAspectRatio(1920, 1080)).toBe('16:9');
  });

  it('maps a portrait canvas image to the closest supported portrait ratio', () => {
    expect(closestSupportedImageAspectRatio(768, 1024)).toBe('3:4');
  });
});
