import { describe, expect, it } from 'vitest';
import {
  getProviderAspectRatios,
  getQualityLevelOptions,
  getResolutionTierOptions,
  getModelParamType,
} from '@/lib/canvas-generation-group';

const APIMART = {
  id: 'provider-apimart',
  baseUrl: 'https://api.apimart.ai/v1',
  requestStyle: 'images-generations',
} as unknown as Parameters<typeof getProviderAspectRatios>[1];

describe('apimart gpt-image-2.5 model capabilities (per apimart official docs)', () => {
  it('exposes the documented 15 aspect ratios', () => {
    expect(getProviderAspectRatios('gpt-image-2.5', APIMART)).toEqual([
      'auto',
      '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
      '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
    ]);
  });

  it('supports complete APImart GPT Image 2.5 quality levels and named models', () => {
    expect(getQualityLevelOptions('gpt-image-2.5-flare', APIMART)).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(getQualityLevelOptions('gpt-image-2.5-sunburst', APIMART)).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('supports PearAPI GPT Image 2.5 4K with the same APImart contract', () => {
    const expectedQualities = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
    const expectedRatios = [
      'auto',
      '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
      '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
    ];
    expect(getQualityLevelOptions('gpt-image-2.5-4k', APIMART)).toEqual(expectedQualities);
    expect(getResolutionTierOptions('gpt-image-2.5-4k', APIMART)).toEqual(['1K', '2K', '4K']);
    expect(getProviderAspectRatios('gpt-image-2.5-4k', APIMART)).toEqual(expectedRatios);
    // PearAPI 4K 型号必须与 APImart flare/sunburst 能力完全一致
    expect(getQualityLevelOptions('gpt-image-2.5-4k', APIMART)).toEqual(getQualityLevelOptions('gpt-image-2.5-flare', APIMART));
    expect(getProviderAspectRatios('gpt-image-2.5-4k', APIMART)).toEqual(getProviderAspectRatios('gpt-image-2.5-flare', APIMART));
  });
});

describe('apimart grok-imagine model capabilities (per apimart official docs)', () => {
  it('exposes the full 13-ratio list for grok-imagine-2.0-ext', () => {
    const ratios = getProviderAspectRatios('grok-imagine-2.0-ext', APIMART);
    expect(ratios).toEqual([
      '1:1',
      '16:9',
      '9:16',
      '4:3',
      '3:4',
      '3:2',
      '2:3',
      '2:1',
      '1:2',
      '19.5:9',
      '9:19.5',
      '20:9',
      '9:20',
    ]);
  });

  it('exposes the full 13-ratio list for grok-imagine-image-2.0', () => {
    const ratios = getProviderAspectRatios('grok-imagine-image-2.0', APIMART);
    expect(ratios).toContain('19.5:9');
    expect(ratios).toContain('20:9');
    expect(ratios).toContain('2:1');
    expect(ratios).toContain('1:2');
    expect(ratios).toHaveLength(13);
  });

  it('supports both resolution (1K/2K) and quality (low/medium) tiers', () => {
    expect(getResolutionTierOptions('grok-imagine-2.0-ext', APIMART)).toEqual(['1K', '2K']);
    expect(getQualityLevelOptions('grok-imagine-2.0-ext', APIMART)).toEqual(['low', 'medium']);
    expect(getModelParamType('grok-imagine-2.0-ext', APIMART)).toBe('both');
  });
});

describe('apimart qwen-image model capabilities (per apimart official docs)', () => {
  it('exposes common aspect ratios for qwen-image-3.0', () => {
    const ratios = getProviderAspectRatios('qwen-image-3.0', APIMART);
    expect(ratios).toContain('1:1');
    expect(ratios).toContain('16:9');
    expect(ratios).toContain('9:16');
    expect(ratios).toContain('4:3');
    expect(ratios.length).toBeGreaterThanOrEqual(8);
  });

  it('has no resolution/quality tiers (uses pixel size sizing)', () => {
    expect(getResolutionTierOptions('qwen-image-3.0', APIMART)).toEqual([]);
    expect(getQualityLevelOptions('qwen-image-3.0', APIMART)).toEqual([]);
    expect(getModelParamType('qwen-image-3.0-pro', APIMART)).toBe('none');
  });
});
