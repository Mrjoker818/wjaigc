import { describe, expect, it } from 'vitest';

import {
  PROFILE_APIMART,
  PROFILE_4SAPI,
  adjustRequestForProfile,
  resolveProviderPixelSize,
  resolveProfileForModel,
} from '@/lib/api-compatibility';
import {
  getProviderAspectRatios,
  getProviderPixelSizingOption,
} from '@/lib/canvas-generation-group';

describe('provider request contracts', () => {
  it('selects the dedicated 4SAPI profile instead of the generic OpenAI profile', () => {
    const profile = resolveProfileForModel('gpt-image-2', {
      baseUrl: 'https://4sapi.com/v1',
    });

    expect(profile.id).toBe('4sapi');
  });

  it('uses the selected 4S resolution tier instead of quality when calculating pixels', () => {
    expect(resolveProviderPixelSize('16:9', 'high', '2K', 'gpt-image-2', PROFILE_4SAPI))
      .toBe('2048x1152');
  });

  it('hides the undocumented auto aspect ratio for 4SAPI while preserving it for APImart', () => {
    expect(getProviderAspectRatios('gpt-image-2', '4SAPI')).not.toContain('auto');
    expect(getProviderAspectRatios('gpt-image-2', 'APImart')).toContain('auto');
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
});
