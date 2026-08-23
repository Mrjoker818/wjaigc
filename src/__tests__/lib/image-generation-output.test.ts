import { describe, expect, it } from 'vitest';
import {
  UnsupportedTransparentBackgroundError,
  detectTransparentBackgroundIntent,
  resolveImageOutputPreference,
  withImageOutputPreference,
} from '@/lib/image-generation-output';

describe('image-generation-output', () => {
  it('forces PNG when GPT Image requests a transparent background', () => {
    expect(resolveImageOutputPreference('gpt-image-2', {
      background: 'transparent',
      outputFormat: 'jpeg',
    })).toEqual({
      background: 'transparent',
      outputFormat: 'png',
      supportsBackground: true,
    });

    expect(withImageOutputPreference(
      { prompt: 'isolated perfume bottle' },
      'gpt-image-2',
      { background: 'transparent', outputFormat: 'jpeg' },
    )).toEqual({
      prompt: 'isolated perfume bottle',
      background: 'transparent',
      output_format: 'png',
    });
  });

  it('keeps an automatic request byte-for-byte compatible', () => {
    const body = { prompt: 'mountain', quality: 'high' };
    expect(withImageOutputPreference(body, 'gpt-image-2', {
      background: 'auto',
      outputFormat: 'png',
    })).toEqual(body);
  });

  it('rejects an explicit transparent request for a model without background support', () => {
    expect(() => withImageOutputPreference(
      { prompt: 'mountain' },
      'dall-e-3',
      { background: 'transparent', outputFormat: 'png' },
    )).toThrow(UnsupportedTransparentBackgroundError);
  });

  it.each([
    '生成一张透明背景的产品图',
    '导出无背景 PNG',
    'remove the background and return a transparent PNG',
    'isolated logo on transparent background',
  ])('detects explicit transparent intent in %s', (prompt) => {
    expect(detectTransparentBackgroundIntent(prompt)).toBe('transparent');
  });

  it.each([
    '白色背景的产品摄影',
    'cinematic portrait in a studio',
    '生成一个山水海报',
  ])('does not invent transparent intent for %s', (prompt) => {
    expect(detectTransparentBackgroundIntent(prompt)).toBeUndefined();
  });
});
