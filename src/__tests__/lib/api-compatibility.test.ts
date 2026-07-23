import { describe, expect, it } from 'vitest';

import {
  PROFILE_APIMART,
  PROFILE_4SAPI,
  PROFILE_OPENAI,
  adjustRequestForProfile,
  resolveProviderPixelSize,
  resolveProfileForModel,
} from '@/lib/api-compatibility';
import {
  getProviderAspectRatios,
  getProviderPixelSizingOption,
  getModelParamType,
  normalizeImageGenerationSelection,
  shouldPreserveProviderAutoSize,
  getQualityLevelOptions,
  getResolutionTierOptions,
} from '@/lib/canvas-generation-group';

describe('provider request contracts', () => {
  it('selects the dedicated 4SAPI profile instead of the generic OpenAI profile', () => {
    const profile = resolveProfileForModel('gpt-image-2', {
      baseUrl: 'https://4sapi.com/v1',
    });

    expect(profile.id).toBe('4sapi');
  });

  it('routes FHL Gemini image models through chat completions instead of its images endpoint', () => {
    const profile = resolveProfileForModel('gemini-2.5-flash-image', {
      baseUrl: 'https://www.fhl.mom',
    });

    expect(profile.id).toBe('gemini-image');
    expect(profile.defaultEndpoint).toBe('/chat/completions');
  });

  it('uses the selected 4S resolution tier instead of quality when calculating pixels', () => {
    expect(resolveProviderPixelSize('16:9', 'high', '2K', 'gpt-image-2', PROFILE_4SAPI))
      .toBe('2048x1152');
  });

  it('hides the undocumented auto aspect ratio for 4SAPI while preserving it for APImart', () => {
    expect(getProviderAspectRatios('gpt-image-2', '4SAPI')).not.toContain('auto');
    expect(getProviderAspectRatios('gpt-image-2', 'APImart')).toContain('auto');
  });

  it('uses the documented 302 GPT Image contract instead of generic GPT Image defaults', () => {
    expect(getProviderAspectRatios('gpt-image-1.5', '302.ai')).toEqual(['auto', '1:1', '3:2', '2:3']);
    expect(getModelParamType('gpt-image-1.5', '302.ai')).toBe('quality');
    expect(getResolutionTierOptions('gpt-image-1.5', '302.ai')).toEqual([]);
    expect(getQualityLevelOptions('gpt-image-1.5', '302.ai')).toEqual(['auto', 'low', 'medium', 'high']);
  });

  it('normalizes stale selections to the active provider model capability', () => {
    expect(normalizeImageGenerationSelection('gpt-image-1.5', '302.ai', {
      aspectRatio: '16:9',
      quality: '1K',
      resolution: '4K',
    })).toEqual({
      aspectRatio: 'auto',
      quality: 'auto',
      resolution: '',
    });
  });

  it('only preserves the automatic size token for providers that document it', () => {
    expect(shouldPreserveProviderAutoSize('gpt-image-1.5', '302.ai')).toBe(true);
    expect(shouldPreserveProviderAutoSize('gpt-image-1.5', '4sapi')).toBe(false);
  });

  it('uses the visible 4S resolution control for pixel size previews', () => {
    expect(getProviderPixelSizingOption('4sapi', 'high', '2K')).toBe('2K');
    expect(getProviderPixelSizingOption('apimart', 'high', '2K')).toBe('high');
  });

  it('keeps 4SAPI size authoritative by removing conflicting quality and resolution tiers', () => {
    const { body } = adjustRequestForProfile({
      model: 'gpt-image-2',
      prompt: 'A cinematic landscape',
      size: '16:9',
      resolution: '2K',
      quality: 'high',
    }, PROFILE_4SAPI);

    expect(body).toMatchObject({ size: '2048x1152' });
    expect(body).not.toHaveProperty('resolution');
    expect(body).not.toHaveProperty('quality');
  });

  it('omits size auto for a 4SAPI/OpenAI request and keeps no invented resolution field', () => {
    const { body } = adjustRequestForProfile({
      model: 'gpt-image-2',
      prompt: 'A product photograph',
      size: 'auto',
      resolution: '2K',
    }, PROFILE_4SAPI);

    expect(body).not.toHaveProperty('size');
    expect(body).not.toHaveProperty('resolution');
  });

  it('routes APIB/APIMart Midjourney models through the dedicated asynchronous profile', () => {
    const midjourneyProfile = resolveProfileForModel('midjourney-v6', {
      baseUrl: 'https://api.apib.ai/v1',
    });
    const genericProfile = resolveProfileForModel('gpt-image-2', {
      baseUrl: 'https://api.apib.ai/v1',
    });

    expect(midjourneyProfile.id).toBe('apimart-midjourney');
    expect(midjourneyProfile.defaultEndpoint).toBe('/midjourney/generations');
    expect(genericProfile.id).toBe('apimart');
  });

  it('builds the Midjourney request from its documented whitelist and merges references', () => {
    const profile = resolveProfileForModel('mj-v7', {
      baseUrl: 'https://apimart.ai/v1',
    });
    const { body, endpoint } = adjustRequestForProfile({
      model: 'mj-v7',
      prompt: 'A cinematic tea house in the rain',
      size: '16:9',
      image: 'https://example.com/first.png',
      image_urls: ['https://example.com/first.png', 'https://example.com/second.png'],
      seed: 42,
      stylize: 250,
      chaos: 20,
      quality: 2,
      no: 'text, watermark',
      tile: true,
      weird: 15,
      version: '7',
      n: 4,
      resolution: '2K',
      width: 2048,
      height: 1152,
      size_px: '2048x1152',
      mask: 'data:image/png;base64,ignored',
      strength: 0.7,
    }, profile, { hasImage: true });

    expect(endpoint).toBe('/midjourney/generations');
    expect(body).toEqual({
      prompt: 'A cinematic tea house in the rain',
      size: '16:9',
      image_urls: ['https://example.com/first.png', 'https://example.com/second.png'],
      seed: 42,
      stylize: 250,
      chaos: 20,
      quality: 2,
      no: 'text, watermark',
      tile: true,
      weird: 15,
      version: '7',
    });
  });

  it('keeps APImart ratio and resolution fields without adding undocumented pixel hints', () => {
    const { body } = adjustRequestForProfile({
      model: 'gpt-image-2',
      prompt: 'A poster',
      size: '16:9',
      resolution: '2K',
      quality: 'high',
    }, PROFILE_APIMART);

    expect(body).toMatchObject({ size: '16:9', resolution: '2K', quality: 'high' });
    expect(body).not.toHaveProperty('width');
    expect(body).not.toHaveProperty('height');
    expect(body).not.toHaveProperty('size_px');
  });

  it('removes APImart pixel hints that were calculated before compatibility adjustment', () => {
    const { body } = adjustRequestForProfile({
      model: 'gpt-image-2',
      prompt: 'A poster',
      size: '16:9',
      resolution: '2K',
      width: 2048,
      height: 1152,
      size_px: '2048x1152',
    }, PROFILE_APIMART);

    expect(body).not.toHaveProperty('width');
    expect(body).not.toHaveProperty('height');
    expect(body).not.toHaveProperty('size_px');
  });

  it('does not leak internal pixel hints to OpenAI-compatible image APIs', () => {
    const { body } = adjustRequestForProfile({
      model: 'gpt-image-2',
      prompt: 'A product photograph',
      n: 1,
      size: '1024x1024',
      width: 1024,
      height: 1024,
      size_px: '1024x1024',
    }, PROFILE_OPENAI);

    expect(body).toMatchObject({ model: 'gpt-image-2', n: 1, size: '1024x1024' });
    expect(body).not.toHaveProperty('width');
    expect(body).not.toHaveProperty('height');
    expect(body).not.toHaveProperty('size_px');
  });
});
