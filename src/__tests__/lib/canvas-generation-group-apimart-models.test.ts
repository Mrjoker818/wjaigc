import { describe, expect, it } from 'vitest';
import {
  getProviderAspectRatios,
  getQualityLevelOptions,
  getResolutionTierOptions,
  getModelParamType,
  inferModelParamCapability,
  normalizeImageGenerationSelection,
} from '@/lib/canvas-generation-group';
import { PROFILE_APIMART, PROFILE_PEARAPI, adjustRequestForProfile } from '@/lib/api-compatibility';

const APIMART = {
  id: 'provider-apimart',
  baseUrl: 'https://api.apimart.ai/v1',
  requestStyle: 'images-generations',
} as unknown as Parameters<typeof getProviderAspectRatios>[1];

describe('apimart official image contracts (docs.apimart.ai)', () => {
  it('keeps the channel gpt-image-2 contract to resolution only and 15 ratios', () => {
    const capability = inferModelParamCapability('gpt-image-2', 'APIMart');
    expect(capability.type).toBe('resolution');
    expect(capability.defaultOption).toBe('1K');
    expect(getResolutionTierOptions('gpt-image-2', APIMART)).toEqual(['1K', '2K', '4K']);
    expect(getQualityLevelOptions('gpt-image-2', APIMART)).toEqual([]);
    expect(getProviderAspectRatios('gpt-image-2', APIMART)).toEqual([
      'auto',
      '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
      '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
    ]);
  });

  it('exposes quality only on the official gpt-image-2 channel', () => {
    expect(inferModelParamCapability('gpt-image-2-official', 'APIMart')).toMatchObject({
      type: 'both',
      defaultOption: '1K',
    });
    expect(getQualityLevelOptions('gpt-image-2-official', APIMART)).toEqual(['auto', 'low', 'medium', 'high']);
  });

  it('uses the documented three ratios and quality-only controls for gpt-image-1.5-official', () => {
    expect(inferModelParamCapability('gpt-image-1.5-official', 'APIMart')).toMatchObject({
      type: 'quality',
      defaultOption: 'auto',
    });
    expect(getProviderAspectRatios('gpt-image-1.5-official', APIMART)).toEqual(['1:1', '3:2', '2:3']);
    expect(getResolutionTierOptions('gpt-image-1.5-official', APIMART)).toEqual([]);
  });

  it('keeps gpt-4o-image to its three documented ratios without quality or resolution controls', () => {
    expect(inferModelParamCapability('gpt-4o-image', 'APIMart')).toMatchObject({ type: 'none' });
    expect(getProviderAspectRatios('gpt-4o-image', APIMART)).toEqual(['1:1', '2:3', '3:2']);
  });

  it('uses uppercase tiers and the documented seven ratios for wan2.7 models', () => {
    expect(inferModelParamCapability('wan2.7-image-pro', 'APIMart')).toMatchObject({
      type: 'resolution',
      defaultOption: '2K',
    });
    expect(getResolutionTierOptions('wan2.7-image-pro', APIMART)).toEqual(['2K', '1K', '4K']);
    expect(getResolutionTierOptions('wan2.7-image', APIMART)).toEqual(['2K', '1K']);
    expect(getProviderAspectRatios('wan2.7-image-pro', APIMART)).toEqual([
      '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3',
    ]);
  });

  it('normalizes APIMart request fields without changing other providers', () => {
    const channel = adjustRequestForProfile({
      model: 'gpt-image-2',
      prompt: 'A poster',
      size: '16:9',
      resolution: '2K',
      quality: 'high',
      n: 4,
    }, PROFILE_APIMART).body;
    expect(channel).toMatchObject({ resolution: '2k', n: 1 });
    expect(channel).not.toHaveProperty('quality');

    const official = adjustRequestForProfile({
      model: 'gpt-image-2-official',
      prompt: 'A poster',
      size: '16:9',
      resolution: '4K',
      quality: 'high',
      n: 4,
    }, PROFILE_APIMART).body;
    expect(official).toMatchObject({ resolution: '4k', quality: 'high', n: 4 });

    const wan = adjustRequestForProfile({
      model: 'wan2.7-image-pro',
      prompt: 'A landscape',
      size: '16:9',
      resolution: '2K',
      quality: 'high',
    }, PROFILE_APIMART).body;
    expect(wan).toMatchObject({ resolution: '2K' });
    expect(wan).not.toHaveProperty('quality');

    const pear = adjustRequestForProfile({
      model: 'gpt-image-2',
      prompt: 'A poster',
      size: '16:9',
      resolution: '2K',
      quality: 'high',
    }, PROFILE_PEARAPI).body;
    expect(pear).toMatchObject({ resolution: '2k', quality: 'high' });
  });

  it('keeps a selected APIMart resolution when the panel stores it in the quality field', () => {
    expect(normalizeImageGenerationSelection('gpt-image-2', 'APIMart', {
      aspectRatio: '16:9',
      quality: 'high',
      resolution: '2K',
    })).toMatchObject({
      resolution: '2K',
      quality: 'high',
    });
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
