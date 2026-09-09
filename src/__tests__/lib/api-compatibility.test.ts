import { describe, expect, it } from 'vitest';

import {
  PROFILE_APIMART,
  PROFILE_4SAPI,
  PROFILE_OPENAI,
  PROFILE_PEARAPI,
  adjustRequestForProfile,
  buildPollUrl,
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

  it('maps APImart GPT Image 2.5 to documented pixel sizes by resolution tier', () => {
    expect(resolveProviderPixelSize('16:9', '1K', '2K', 'gpt-image-2.5', PROFILE_APIMART)).toBe('1820x1024');
    expect(resolveProviderPixelSize('16:9', '2K', '2K', 'gpt-image-2.5', PROFILE_APIMART)).toBe('3641x2048');
    expect(resolveProviderPixelSize('16:9', '4K', '4K', 'gpt-image-2.5', PROFILE_APIMART)).toBe('7282x4096');
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
      quality: '2',
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

  describe('PearAPI protocol per official docs', () => {
    const pearProvider = { baseUrl: 'https://api.pearapi.ai', id: 'pear', name: 'PearAPI' } as any;

    it('uses /v1/images/generations for text-to-image submission', () => {
      const profile = resolveProfileForModel('nano-banana-pro', pearProvider);
      expect(profile?.defaultEndpoint).toBe('/v1/images/generations');
    });

    it('uses /v1/images/edits for image edit submission', () => {
      const pearProvider = { baseUrl: 'https://api.pearapi.ai', id: 'pear', name: 'PearAPI' } as any;
      const prof = resolveProfileForModel('nano-banana-pro', pearProvider);
      const request = {
        model: 'nano-banana-pro',
        prompt: 'make him wear a suit',
        image: 'https://example.com/portrait.jpg',
      } as any;
      const { endpoint } = adjustRequestForProfile(request, prof, { isEditEndpoint: true, hasImage: true });

      expect(endpoint).toBe('/v1/images/edits');
    });

    it('builds poll URL with /v1 prefix without duplicating it', () => {
      const pollUrl = buildPollUrl('https://api.pearapi.ai', 'img_123', PROFILE_PEARAPI);
      expect(pollUrl).toBe('https://api.pearapi.ai/v1/images/tasks/img_123');
    });

    it('flattens reference images into image/images per official schema', () => {
      const pearProvider = { baseUrl: 'https://api.pearapi.ai', id: 'pear', name: 'PearAPI' } as any;
      const prof = resolveProfileForModel('wan2.7-image', pearProvider);
      const request = {
        model: 'wan2.7-image',
        prompt: 'orange cat in cyberpunk city',
        image: 'https://example.com/ref.png',
        image_urls: ['https://example.com/a.png', 'https://example.com/b.png'],
      } as any;
      const { body } = adjustRequestForProfile(request, prof, { isEditEndpoint: true, hasImage: true, hasReferenceImages: true });

      expect(body.image).toBe('https://example.com/ref.png');
      expect(body.images).toEqual(['https://example.com/ref.png', 'https://example.com/a.png', 'https://example.com/b.png']);
      expect(body).not.toHaveProperty('image_urls');
    });

    it('forces sync mode and url response_format for Pear generation', () => {
      const { body } = adjustRequestForProfile({
        model: 'nano-banana-2',
        prompt: 'A cinematic landscape',
        n: 2,
      } as any, PROFILE_PEARAPI);

      expect(body.task_type).toBe('sync');
      expect(body.response_format).toBe('url');
    });

    it('strips edit-only fields when normalizing the /v1 generation endpoint', () => {
      const { body } = adjustRequestForProfile({
        model: 'wan2.7-image',
        prompt: 'A poster',
        image: 'https://example.com/ref.png',
        strength: 0.7,
      } as any, PROFILE_PEARAPI);

      expect(body).not.toHaveProperty('strength');
    });
  });
});
