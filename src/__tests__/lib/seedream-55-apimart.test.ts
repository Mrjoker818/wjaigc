import { describe, expect, it } from 'vitest';
import {
  findApimartModelSpec,
  getProviderAspectRatios,
  getResolutionTierOptions,
} from '@/lib/canvas-generation-group';
import { adjustRequestForProfile, PROFILE_APIMART } from '@/lib/api-compatibility';

// 后端/前端拼接的 providerHint（含 id + 名称 + baseUrl）
const APIMART_HINT = 'api_1778430731224_533e09a APImart image https://api.apib.ai';

// 官方文档：https://docs.apib.ai/cn/api-reference/images/seedream-5-5/generation
describe('APIMart seedream-5-5 capability', () => {
  it('exposes only the documented 2K / 1K tiers (no 3K / 4K)', () => {
    const tiers = getResolutionTierOptions('seedream-5-5', APIMART_HINT);
    expect(tiers).toEqual(['2K', '1K']);
    expect(tiers).not.toContain('4K');
    expect(tiers).not.toContain('3K');
  });

  it('surfaces the 10 documented aspect ratios including 2:1 and 1:2', () => {
    const ratios = getProviderAspectRatios('seedream-5-5', APIMART_HINT);
    expect(ratios).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '2:1', '1:2']);
  });

  it('keeps n at 1 because the model never returns multiple images', () => {
    expect(findApimartModelSpec('seedream-5-5')?.maxImages).toBe(1);
  });
});

describe('APIMart seedream-5-5 request body', () => {
  it('drops resolution 4K that the model rejects', () => {
    const { body } = adjustRequestForProfile(
      { model: 'seedream-5-5', prompt: 'a cat', resolution: '4K', size: '2K' },
      PROFILE_APIMART,
    );
    expect(body.resolution).toBeUndefined();
    expect(body.size).toBe('2K');
  });

  it('keeps the documented 2K resolution in uppercase', () => {
    const { body } = adjustRequestForProfile(
      { model: 'seedream-5-5', prompt: 'a cat', resolution: '2K' },
      PROFILE_APIMART,
    );
    expect(body.resolution).toBe('2K');
  });

  it('clamps n to 1', () => {
    const { body } = adjustRequestForProfile(
      { model: 'seedream-5-5', prompt: 'a cat', n: 4 },
      PROFILE_APIMART,
    );
    expect(body.n).toBe(1);
  });
});
