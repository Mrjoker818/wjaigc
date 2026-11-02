import { describe, expect, it } from 'vitest';
import {
  getProviderAspectRatios,
  getQualityLevelOptions,
  getResolutionTierOptions,
  getModelParamType,
  getDefaultParamValue,
} from '@/lib/canvas-generation-group';
import { adjustRequestForProfile, PROFILE_PEARAPI, PROFILE_APIMART } from '@/lib/api-compatibility';

// 后端 route.ts 的 providerHint（含 id + displayName + baseUrl）
const PEAR_BACKEND = 'api_1780630178347_rjqlmam PearAPI 图像 https://api.pearapi.ai';
// 前端 generation-panel.tsx 的 selectedProviderHint（仅 id + providerName，无 baseUrl）
const PEAR_FRONTEND = 'api_1780630178347_rjqlmam PearAPI 图像';
const APIMART_HINT = 'api_1778430731224_533e09a APImart imgae https://api.apib.ai';

describe('pear grok-imagine-image-2-2k capability', () => {
  it('backend hint → none (no resolution/quality surfaced)', () => {
    expect(getModelParamType('grok-imagine-image-2-2k', PEAR_BACKEND)).toBe('none');
    expect(getResolutionTierOptions('grok-imagine-image-2-2k', PEAR_BACKEND)).toEqual([]);
    expect(getQualityLevelOptions('grok-imagine-image-2-2k', PEAR_BACKEND)).toEqual([]);
    expect(getDefaultParamValue('grok-imagine-image-2-2k', PEAR_BACKEND)).toBe('');
  });
  it('frontend hint (no baseUrl) → none', () => {
    expect(getModelParamType('grok-imagine-image-2-2k', PEAR_FRONTEND)).toBe('none');
    expect(getModelParamType('grok-imagine-image-2-2k', PEAR_BACKEND)).toBe('none');
  });
  it('apimart hint → both (1K/2K)', () => {
    expect(getModelParamType('grok-imagine-image-2-2k', APIMART_HINT)).toBe('both');
    expect(getResolutionTierOptions('grok-imagine-image-2-2k', APIMART_HINT)).toEqual(['1K', '2K']);
  });
  it('surfaces the documented 13 aspect ratios', () => {
    // PearAPI 官方文档（api-525698885）：GPT / Grok / Boogu 系列统一 13 比例
    // （含 5:4、4:5、21:9、9:21；不含 xAI 专有的 19.5:9 / 20:9，这些在 PearAPI 网关不支持）
    const ratios = getProviderAspectRatios('grok-imagine-image-2-2k', PEAR_FRONTEND) as string[];
    expect(ratios).toEqual(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '2:1', '1:2', '21:9', '9:21']);
  });
});

describe('pear grok request body whitelist', () => {
  it('strips resolution/quality/derived pixel hints', () => {
    const raw = {
      model: 'grok-imagine-image-2-2k',
      prompt: 'a red apple',
      n: 1,
      size: '16:9',
      quality: 'medium',
      resolution: '2K',
      width: 2048,
      height: 1152,
      size_px: '2048x1152',
    };
    const out = adjustRequestForProfile(raw, PROFILE_PEARAPI);
    expect(out.body.model).toBe('grok-imagine-image-2-2k');
    expect(out.body.prompt).toBe('a red apple');
    expect(out.body.n).toBe(1);
    expect(out.body.size).toBe('16:9');
    expect(out.body.response_format).toBe('url');
    expect(out.body.task_type).toBe('sync');
    expect(out.body.resolution).toBeUndefined();
    expect(out.body.quality).toBeUndefined();
    expect(out.body.width).toBeUndefined();
    expect(out.body.height).toBeUndefined();
    expect(out.body.size_px).toBeUndefined();
    expect(out.endpoint).toBe('/v1/images/generations');
  });
  it('apimart grok still emits resolution/quality', () => {
    const raw = {
      model: 'grok-imagine-2.0-ext',
      prompt: 'a red apple',
      n: 1,
      size: '16:9',
      quality: 'medium',
      resolution: '2K',
    };
    const out = adjustRequestForProfile(raw, PROFILE_APIMART);
    expect(out.body.resolution).toBe('2K');
    expect(out.body.quality).toBe('medium');
  });
});
