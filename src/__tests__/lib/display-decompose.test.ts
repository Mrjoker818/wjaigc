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
      sourceHash: 'source-sha-256',
      background: 'light-gray',
      aspectRatio: '3:4',
      extraPrompt: '保留品牌主视觉',
    });

    expect(request).toMatchObject({
      model: 'gemini-image-model',
      n: 1,
      size: '3:4',
      image_urls: ['https://example.com/display.jpg'],
      strength: 0.45,
      input_fidelity: 'high',
      response_format: 'url',
      source_hash: 'source-sha-256',
    });
    expect(request.prompt).toContain('浅灰色极简背景');
    expect(request.prompt).toContain('保留品牌主视觉');
    expect(buildDisplayDecomposePrompt()).not.toContain('undefined');
  });

  it('builds a real transparent-alpha variant without checkerboard instructions', () => {
    const request = buildDisplayDecomposeRequestBody({
      model: 'gemini-image-model',
      imageUrl: '/api/serve-upload/frozen-source.png',
      sourceHash: 'frozen-source-hash',
      background: 'transparent',
    });

    expect(request.image_urls).toEqual(['/api/serve-upload/frozen-source.png']);
    expect(request.source_hash).toBe('frozen-source-hash');
    expect(request.prompt).toContain('真实透明 alpha=0');
    expect(request.prompt).not.toContain('棋盘格');
    expect(request.prompt).not.toContain('浅灰色极简展示背景');
  });
});
