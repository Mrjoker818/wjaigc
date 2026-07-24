import { describe, expect, it } from 'vitest';

import {
  UPSCALE_TARGET_PRESETS,
  calculateUpscaleTargetDimensions,
  validateUpscaleTargetDimensions,
} from '@/lib/upscale-target';

describe('upscale target dimensions', () => {
  it('keeps multiplier presets separate from resolution presets', () => {
    expect(UPSCALE_TARGET_PRESETS.map(preset => preset.id)).toEqual([
      '2x',
      '4x',
      '4k',
      '8k',
    ]);

    expect(calculateUpscaleTargetDimensions(1200, 800, '2x')).toMatchObject({
      width: 2400,
      height: 1600,
      scale: 2,
      engineScale: 2,
      mode: 'multiplier',
      canUpscale: true,
    });

    expect(calculateUpscaleTargetDimensions(1200, 800, '4x')).toMatchObject({
      width: 4800,
      height: 3200,
      scale: 4,
      engineScale: 4,
      mode: 'multiplier',
      canUpscale: true,
    });
  });

  it('maps landscape and portrait images to a 4096-pixel 4K long edge', () => {
    expect(calculateUpscaleTargetDimensions(1920, 1080, '4k')).toMatchObject({
      width: 4096,
      height: 2304,
      mode: 'resolution',
      targetLongEdge: 4096,
      canUpscale: true,
    });

    expect(calculateUpscaleTargetDimensions(1080, 1920, '4k')).toMatchObject({
      width: 2304,
      height: 4096,
      mode: 'resolution',
      targetLongEdge: 4096,
      canUpscale: true,
    });
  });

  it('rounds the derived short edge to a provider-friendly 8-pixel boundary', () => {
    const target = calculateUpscaleTargetDimensions(1000, 777, '4k');

    expect(target.width).toBe(4096);
    expect(target.height).toBe(3184);
    expect(target.height % 8).toBe(0);
  });

  it('maps 8K to an 8192-pixel long edge without submitting an unsupported 8x engine step', () => {
    expect(calculateUpscaleTargetDimensions(1024, 1024, '8k')).toMatchObject({
      width: 8192,
      height: 8192,
      scale: 8,
      engineScale: 4,
      mode: 'resolution',
      targetLongEdge: 8192,
      canUpscale: true,
    });
  });

  it('does not downscale an image that already satisfies the selected tier', () => {
    expect(calculateUpscaleTargetDimensions(5000, 3000, '4k')).toMatchObject({
      width: 5000,
      height: 3000,
      scale: 1,
      canUpscale: false,
    });
  });

  it('rejects invalid source dimensions', () => {
    expect(() => calculateUpscaleTargetDimensions(0, 1000, '4k')).toThrow(
      '原图尺寸无效',
    );
    expect(() => calculateUpscaleTargetDimensions(1000, Number.NaN, '4k')).toThrow(
      '原图尺寸无效',
    );
  });
});

describe('upscale target validation', () => {
  it('accepts valid bounded targets', () => {
    expect(validateUpscaleTargetDimensions(1920, 1080, 4096, 2304)).toBeNull();
    expect(validateUpscaleTargetDimensions(1024, 1024, 8192, 8192)).toBeNull();
  });

  it('rejects invalid, distorted, downscaled, and over-8K targets', () => {
    expect(validateUpscaleTargetDimensions(1000, 1000, 0, 4096)).toContain('正整数');
    expect(validateUpscaleTargetDimensions(1000, 1000, 4096.5, 4096)).toContain('正整数');
    expect(validateUpscaleTargetDimensions(1000, 1000, 9000, 9000)).toContain('8192');
    expect(validateUpscaleTargetDimensions(2000, 1000, 4096, 4096)).toContain('宽高比');
    expect(validateUpscaleTargetDimensions(5000, 3000, 4096, 2456)).toContain('不能小于原图');
  });
});
