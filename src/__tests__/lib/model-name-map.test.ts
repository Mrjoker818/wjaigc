import { describe, expect, it } from 'vitest';

import {
  getModelDisplayName,
  getModelInfo,
  getModelProvider,
  getModelShortName,
} from '@/lib/model-name-map';

describe('model-name-map exact display fallbacks', () => {
  const donorCases = [
    ['nano-banana-2-lite', 'Nano Banana 2 Lite', 'NB2 Lite', 'PearAPI', 'image'],
    ['gpt-image-2-4k', 'GPT Image 2 4K', 'GPT Image 2 4K', 'OpenAI', 'image'],
    ['gpt-image-2-2k', 'GPT Image 2 2K', 'GPT Image 2 2K', 'OpenAI', 'image'],
    ['flux2-klein', 'FLUX 2 Klein', 'FLUX 2 Klein', 'Black Forest Labs', 'image'],
    ['grok-imagine-video-1.5', 'Grok Imagine Video 1.5', 'GIV 1.5', 'xAI', 'video'],
    ['grok-imagine-1.5-video-apimart', 'Grok Imagine Video 1.5', 'GIV 1.5', 'xAI', 'video'],
    ['grok-imagine-video', 'Grok Imagine Video', 'GIV', 'xAI', 'video'],
    ['grok-imagine-image', 'Grok Imagine Image', 'GII', 'xAI', 'image'],
    ['happyhorse-1.0', 'HappyHorse', 'HappyHorse', 'HappyHorse', 'video'],
    ['gemini-omni', 'Gemini Omni', 'Gemini Omni', 'Google', 'video'],
    ['seedvr2-upscaler', 'SeedVR2 Upscaler', 'SeedVR2 Upscaler', 'ByteDance', 'image'],
    ['seedvr-upscaler', 'SeedVR', 'SeedVR', 'ByteDance', 'image'],
    ['real-esrgan', 'Real-ESRGAN', 'Real-ESRGAN', 'AI', 'image'],
    ['seedance-2-5', 'Seedance 2.5', 'Seedance 2.5', 'ByteDance', 'video'],
    ['seedance-2.5', 'Seedance 2.5', 'Seedance 2.5', 'ByteDance', 'video'],
    ['seedance-1.5', 'Seedance 1.5 Pro', 'Seedance 1.5 Pro', 'ByteDance', 'video'],
    ['seedance-1.0', 'Seedance 1.0 Pro', 'Seedance 1.0 Pro', 'ByteDance', 'video'],
    ['doubao-seedream-4-5-251128', 'Seedream 4.5', 'Seedream 4.5', 'ByteDance', 'image'],
    ['doubao-seedream-4-0-250828', 'Seedream 4.0', 'Seedream 4.0', 'ByteDance', 'image'],
  ] as const;

  it.each(donorCases)(
    'uses the exact fallback for %s',
    (modelId, name, short, provider, type) => {
      expect(getModelDisplayName(modelId)).toBe(name);
      expect(getModelShortName(modelId)).toBe(short);
      expect(getModelProvider(modelId)).toBe(provider);
      expect(getModelInfo(modelId)).toEqual({ name, short, provider, type });
    },
  );

  it.each([
    ['doubao-seedance-2-3-fast-260901', 'Seedance 2.3 Fast'],
    ['doubao-seedance-2-0-fast-260128', 'Seedance 2.0 Fast'],
    ['kling-v3-omni-video-generation', '可灵 V3 Omni 视频'],
    ['kling-v3-omni', '可灵 V3 Omni 视频'],
    ['hunyuan3d-2.1', '混元3D'],
    ['hailuo-2.3', '海螺 Hailuo 2.3'],
  ])('prefers the longest matching rule for %s', (modelId, expected) => {
    expect(getModelDisplayName(modelId)).toBe(expected);
  });

  it('keeps generic fallbacks and unknown ids stable', () => {
    expect(getModelDisplayName('vendor-seedance-custom')).toBe('Seedance');
    expect(getModelDisplayName('vendor-model-without-a-map')).toBe('vendor-model-without-a-map');
  });
});
