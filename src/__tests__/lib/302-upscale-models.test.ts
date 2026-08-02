import { describe, expect, it } from 'vitest';

import {
  THREE_O_TWO_UPSCALE_MODELS,
  get302UpscaleModelsForProvider,
  is302AiUpscaleBaseUrl,
  resolve302UpscaleModelSelection,
  resolve302UpscaleModelId,
} from '@/lib/302-upscale-models';

describe('302.AI upscale model catalog', () => {
  it('exposes exactly the four documented 302.AI upscale models', () => {
    expect(THREE_O_TWO_UPSCALE_MODELS.map(model => model.id)).toEqual([
      '302-super-upscale-v2',
      '302-upscale-v6',
      '302-image-upscale',
      '302-esrgan',
    ]);
    expect(THREE_O_TWO_UPSCALE_MODELS.every(model => model.category === '302')).toBe(true);
  });

  it('only resolves the documented model ids and legacy exact aliases', () => {
    expect(resolve302UpscaleModelId('302-super-upscale-v2')).toBe('302-super-upscale-v2');
    expect(resolve302UpscaleModelId('super-upscale-v2')).toBe('302-super-upscale-v2');
    expect(resolve302UpscaleModelId('302-upscale-v6')).toBe('302-upscale-v6');
    expect(resolve302UpscaleModelId('upscale-v6')).toBe('302-upscale-v6');
    expect(resolve302UpscaleModelId('upscale-v5')).toBeNull();
    expect(resolve302UpscaleModelId('my-upscale-model')).toBeNull();
  });

  it('adds the catalog only for a 302.AI upscaler provider', () => {
    expect(is302AiUpscaleBaseUrl('https://api.302.ai')).toBe(true);
    expect(is302AiUpscaleBaseUrl('https://api.302ai.cn')).toBe(true);
    expect(is302AiUpscaleBaseUrl('https://evil302ai.cn')).toBe(false);
    expect(get302UpscaleModelsForProvider('https://api.302.ai', 'upscaler')).toHaveLength(4);
    expect(get302UpscaleModelsForProvider('https://api.302ai.cn', 'upscaler')).toHaveLength(4);
    expect(get302UpscaleModelsForProvider('https://api.302.ai', 'image')).toEqual([]);
    expect(get302UpscaleModelsForProvider('https://api.example.com', 'upscaler')).toEqual([]);
  });

  it('expands the legacy unified 302 entry into only the two verified toolbar models', () => {
    expect(resolve302UpscaleModelSelection('https://api.302ai.cn', ['302'])).toEqual([
      '302-super-upscale-v2',
      '302-upscale-v6',
    ]);
  });

  it('preserves an explicit native 302 upscale model selection', () => {
    expect(resolve302UpscaleModelSelection('https://api.302ai.cn', ['302-upscale-v6'])).toEqual([
      '302-upscale-v6',
    ]);
    expect(resolve302UpscaleModelSelection('https://api.example.com', ['302'])).toBeNull();
  });
});
