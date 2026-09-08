import { describe, it, expect } from 'vitest';
import { getVideoModelInfo, resolveVideoCompatProfile } from '@/lib/video-api';

describe('apimart video model registry (new models)', () => {
  it('recognizes seedance-2.5 with accurate durations and ratios', () => {
    const info = getVideoModelInfo('seedance-2.5');
    expect(info).not.toBeNull();
    if (!info) return;
    expect(info.profile).toBe('apimart-video');
    expect(info.features.maxDuration).toBe(15);
    expect(info.features.durations).toContain(5);
    expect(info.features.durations).toContain(10);
    expect(info.features.ratios).toContain('16:9');
    expect(info.features.ratios).toContain('21:9');
    expect(info.features.firstLastFrame).toBe(true);
    expect(info.features.multiReference).toBe(true);
  });

  it('recognizes kling-3.0-turbo with standard durations', () => {
    const info = getVideoModelInfo('kling-3.0-turbo');
    expect(info).not.toBeNull();
    if (!info) return;
    expect(info.profile).toBe('apimart-video');
    expect(info.features.maxDuration).toBe(30);
    expect(info.features.durations).toContain(5);
    expect(info.features.ratios).toContain('16:9');
    expect(info.features.ratios).toContain('9:16');
    expect(info.features.firstLastFrame).toBe(true);
    expect(info.features.multiReference).toBe(true);
  });

  it('recognizes gemini-omni-flash-preview as a Google video model', () => {
    const info = getVideoModelInfo('gemini-omni-flash-preview');
    expect(info).not.toBeNull();
    if (!info) return;
    expect(info.profile).toBe('apimart-video');
    expect(info.features.maxDuration).toBe(8);
    expect(info.features.durations).toContain(8);
    expect(info.features.ratios).toContain('16:9');
  });

  it('routes apimart base url to apimart-video compat profile', () => {
    expect(resolveVideoCompatProfile('seedance-2.5', undefined, 'https://api.apib.ai/v1')).toBe('apimart-video');
    expect(resolveVideoCompatProfile('kling-3.0-turbo', undefined, 'https://api.apimart.ai')).toBe('apimart-video');
  });
});
