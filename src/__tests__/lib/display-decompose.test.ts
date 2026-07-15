import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DISPLAY_DECOMPOSE_RATIO,
  DISPLAY_DECOMPOSE_SUPPORTED_RATIOS,
  buildDisplayDecomposePrompt,
  buildDisplayDecomposeRequestBody,
  normalizeDisplayDecomposeRatio,
} from '@/lib/display-decompose';

describe('display-decompose request contract', () => {
  it('accepts only supported display-board aspect ratios', () => {
    expect(DISPLAY_DECOMPOSE_SUPPORTED_RATIOS).toEqual([
      '1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16',
    ]);
    expect(normalizeDisplayDecomposeRatio('4:5')).toBe('4:5');
    expect(normalizeDisplayDecomposeRatio(' 16:9 ')).toBe('16:9');
    expect(normalizeDisplayDecomposeRatio('21:9')).toBe(DEFAULT_DISPLAY_DECOMPOSE_RATIO);
  });

  it('builds a one-image, high-fidelity generation request', () => {
    const request = buildDisplayDecomposeRequestBody({
      model: 'gemini-image-model',
      imageUrl: 'https://example.com/display.jpg',
      aspectRatio: '3:4',
      extraPrompt: '保留品牌主视觉',
    });

    expect(request).toMatchObject({
      model: 'gemini-image-model',
      n: 1,
      size: '3:4',
      image_urls: ['https://example.com/display.jpg'],
      strength: 0.72,
      input_fidelity: 'high',
      response_format: 'url',
    });
    expect(request.prompt).toContain('保留品牌主视觉');
    expect(buildDisplayDecomposePrompt()).not.toContain('undefined');
  });
});
