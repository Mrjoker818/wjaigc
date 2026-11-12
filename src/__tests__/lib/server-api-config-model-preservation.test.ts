import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { mergeDiscoveryModels } from '@/lib/server-api-config';
import type { ModelInfo } from '@/lib/universal-api-types';

function model(id: string, displayName?: string): ModelInfo {
  return {
    id,
    name: displayName || id,
    providerId: 'apimart',
    type: 'image',
    ...(displayName ? { displayName } : {}),
  } as ModelInfo;
}

describe('mergeDiscoveryModels', () => {
  it('keeps the stored model list when a refresh returns no models', () => {
    const stored = [model('gpt-image-2.5-flare'), model('grok-imagine-2.0-ext')];

    const merged = mergeDiscoveryModels(stored, [], 'apimart', true);

    expect(merged.map(item => item.id)).toEqual(['gpt-image-2.5-flare', 'grok-imagine-2.0-ext']);
    expect(merged).toEqual(stored);
  });

  it('clears the list when the provider base URL changed and discovery returned nothing', () => {
    const stored = [model('gpt-image-2.5-flare')];

    const merged = mergeDiscoveryModels(stored, [], 'apimart', false);

    expect(merged).toEqual([]);
  });

  it('treats a missing stored list as empty instead of throwing', () => {
    expect(mergeDiscoveryModels(undefined, [], 'apimart', true)).toEqual([]);
  });

  it('adopts fresh discovery results and keeps user-renamed models', () => {
    const stored = [model('gpt-image-2.5-flare', '我的图像模型')];

    const merged = mergeDiscoveryModels(
      stored,
      [model('gpt-image-2.5-flare'), model('seedream-4.0')],
      'apimart',
      true,
    );

    expect(merged.map(item => item.id)).toEqual(['gpt-image-2.5-flare', 'seedream-4.0']);
    expect(merged[0].displayName).toBe('我的图像模型');
    expect(merged[1].providerId).toBe('apimart');
  });
});
