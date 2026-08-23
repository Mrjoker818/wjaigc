import { describe, expect, it } from 'vitest';
import {
  UnsupportedTransparentBackgroundError,
  detectTransparentBackgroundIntent,
  getTransparentOutputWarning,
  normalizeImageOutputRequestBody,
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

  it('normalizes legacy camelCase request fields to the HTTP contract', () => {
    expect(normalizeImageOutputRequestBody({
      prompt: 'isolated icon',
      background: 'transparent',
      outputFormat: 'webp',
    }, 'gpt-image-2')).toEqual({
      prompt: 'isolated icon',
      background: 'transparent',
      output_format: 'png',
    });
  });

  it('infers transparent PNG when a legacy entry only provides explicit prompt intent', () => {
    expect(normalizeImageOutputRequestBody({
      prompt: '生成一个无背景的产品图标',
    }, 'gpt-image-2')).toEqual({
      prompt: '生成一个无背景的产品图标',
      background: 'transparent',
      output_format: 'png',
    });
  });

  it('does not override an explicit opaque mode from prompt wording', () => {
    expect(normalizeImageOutputRequestBody({
      prompt: '透明背景图标，但本次请输出白底',
      background: 'opaque',
    }, 'gpt-image-2')).toEqual({
      prompt: '透明背景图标，但本次请输出白底',
      background: 'opaque',
      output_format: 'png',
    });
  });

  it('removes automatic output aliases to preserve the legacy provider payload', () => {
    expect(normalizeImageOutputRequestBody({
      prompt: 'mountain',
      background: 'auto',
      output_format: 'png',
    }, 'gpt-image-2')).toEqual({ prompt: 'mountain' });
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

  it('returns a user warning only for a requested but non-transparent result', () => {
    expect(getTransparentOutputWarning({
      alphaVerification: { requested: true, status: 'opaque' },
    })).toContain('未返回真实透明背景');
    expect(getTransparentOutputWarning({
      alphaVerification: { requested: true, status: 'verified' },
    })).toBeUndefined();
  });
});
