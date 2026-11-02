import { describe, expect, it } from 'vitest';

import {
  adjustRequestForProfile,
  getModelSpecificPixelSize,
  PROFILE_APIMART,
  PROFILE_PEARAPI,
} from '@/lib/api-compatibility';
import {
  calculateActualPixels,
  findPearModelSpec,
  getProviderAspectRatios,
  getProviderPixelSizingOption,
  inferModelParamCapability,
  isPearProvider,
  toPearResolutionParam,
} from '@/lib/canvas-generation-group';

/**
 * PearAPI 官方规格对齐测试
 * 文档：https://pearapi.apifox.cn/api-525698885（生成图片）
 * - size：比例（16:9）| 像素（2048x2048）| auto；传比例时服务端自动换算
 * - resolution：0.5k / 1k / 2k / 4k（依模型而定）
 * - quality：low / medium / high / auto（仅 GPT 系列；gpt-image-2.5 额外 xhigh / max）
 * - 默认档：gpt-image-2→2K、gpt-image-2.5→1K、nano-banana-2/2.1→2K、nano-banana-pro→1K
 * - 固定档：nano-banana、Seedream 全系（固定 2K）、grok / wan2.7 / z-image / flux2-klein / boogu / firered
 */
const PEAR = 'prov_xxx PearAPI 图像';
const NON_PEAR = 'volc 火山方舟';

describe('PearAPI 供应商识别与模型规格', () => {
  it('identifies PearAPI providers from provider hint', () => {
    expect(isPearProvider(PEAR)).toBe(true);
    expect(isPearProvider('https://api.pearapi.ai/v1')).toBe(true);
    expect(isPearProvider(NON_PEAR)).toBe(false);
    expect(isPearProvider('')).toBe(false);
  });

  it('gpt-image-2: default 2K, quality without xhigh/max', () => {
    const cap = inferModelParamCapability('gpt-image-2', PEAR);
    expect(cap.type).toBe('both');
    expect(cap.defaultOption).toBe('2K');
    expect(cap.options).toEqual(expect.arrayContaining(['1K', '2K', '4K', 'auto', 'low', 'medium', 'high']));
    expect(cap.options).not.toContain('xhigh');
  });

  it('gpt-image-2.5: default 1K, quality includes xhigh/max', () => {
    const cap = inferModelParamCapability('gpt-image-2.5', PEAR);
    expect(cap.type).toBe('both');
    expect(cap.defaultOption).toBe('1K');
    expect(cap.options).toEqual(expect.arrayContaining(['1K', '2K', '4K', 'xhigh', 'max']));
  });

  it('official model-name suffix form (gpt-image-2-4k) wins as default tier', () => {
    const cap = inferModelParamCapability('gpt-image-2-4k', PEAR);
    expect(cap.defaultOption).toBe('4K');
  });

  it('gpt-image-2.5 channel variants (sunburst/flare) inherit the 2.5 spec', () => {
    for (const id of ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
      const cap = inferModelParamCapability(id, PEAR);
      expect(cap.type, id).toBe('both');
      expect(cap.defaultOption, id).toBe('1K');
      expect(cap.options, id).toEqual(expect.arrayContaining(['1K', '2K', '4K', 'xhigh', 'max']));
      expect(getProviderAspectRatios(id, PEAR), id).toHaveLength(13);
      const { body } = adjustRequestForProfile(
        { model: id, prompt: 'p', size: '3:4', resolution: '2K', quality: 'xhigh', negative_prompt: 'blur', seed: 1 } as unknown as Record<string, unknown>,
        PROFILE_PEARAPI,
      );
      expect(body.resolution, id).toBe('2k');
      expect(body.quality, id).toBe('xhigh');
      expect(body.negative_prompt, id).toBeUndefined();
      expect(body.seed, id).toBeUndefined();
      // 非 PearAPI 供应商行为不受影响
      const apimart = adjustRequestForProfile({ model: id, prompt: 'p', size: '16:9', resolution: '2K', quality: 'high' } as unknown as Record<string, unknown>, PROFILE_APIMART);
      expect(apimart.body.resolution, id).toBe('2K');
    }
  });

  it('nano-banana family tiers follow official docs', () => {
    const nb2 = inferModelParamCapability('nano-banana-2', PEAR);
    expect(nb2.type).toBe('resolution');
    expect(nb2.defaultOption).toBe('2K');
    expect(nb2.options).toEqual(expect.arrayContaining(['0.5K', '1K', '2K', '4K']));

    const lite = inferModelParamCapability('nano-banana-2-lite', PEAR);
    expect(lite.type).toBe('resolution');
    expect(lite.options).toEqual(['0.5K', '1K']);

    const v21 = inferModelParamCapability('nano-banana-2.1', PEAR);
    expect(v21.defaultOption).toBe('2K');
    expect(v21.options).toEqual(expect.arrayContaining(['1K', '2K', '4K']));

    const pro = inferModelParamCapability('nano-banana-pro', PEAR);
    expect(pro.defaultOption).toBe('1K');
    expect(pro.options).toEqual(expect.arrayContaining(['1K', '2K', '4K']));
  });

  it('fixed-tier models expose no tier controls', () => {
    const fixedModels = [
      'nano-banana',
      'doubao-seedream-4-0-250828',
      'doubao-seedream-4-5-251128',
      'doubao-seedream-5-0-260128',
      'doubao-seedream-5-0-pro-260628',
      'grok-imagine-image-2.0',
      'wan2.7-image',
      'z-image',
      'flux2-klein-9b',
      'boogu-image-0.1',
      'firered-image-edit1.1',
    ];
    for (const id of fixedModels) {
      expect(inferModelParamCapability(id, PEAR).type, id).toBe('none');
    }
  });

  it('non-PearAPI providers keep their own tier logic (change isolation)', () => {
    // 火山直连的 doubao-seedream-4-5 支持多档，不应被 PearAPI 固定档规则覆盖
    const cap = inferModelParamCapability('doubao-seedream-4-5', NON_PEAR);
    expect(cap.type).not.toBe('none');
  });

  it('official aspect-ratio groups per model family', () => {
    const gpt = getProviderAspectRatios('gpt-image-2', PEAR);
    expect(gpt).toHaveLength(13);
    expect(gpt).toEqual(expect.arrayContaining(['2:1', '1:2', '21:9', '9:21']));
    expect(gpt).not.toContain('3:1');

    const nb = getProviderAspectRatios('nano-banana-pro', PEAR);
    expect(nb).toHaveLength(14);
    expect(nb).toEqual(expect.arrayContaining(['1:4', '4:1', '1:8', '8:1']));

    const seedream = getProviderAspectRatios('doubao-seedream-5-0-260128', PEAR);
    expect(seedream).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']);

    const flux = getProviderAspectRatios('flux2-klein-9b', PEAR);
    expect(flux).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']);
  });

  it('unknown PearAPI model falls back without guessing tiers', () => {
    const cap = inferModelParamCapability('some-unknown-pear-model', PEAR);
    expect(cap.type).toBe('none');
    expect(findPearModelSpec('some-unknown-pear-model')).toBeUndefined();
  });

  it('toPearResolutionParam normalizes to the official lowercase enum', () => {
    expect(toPearResolutionParam('2K')).toBe('2k');
    expect(toPearResolutionParam('0.5K')).toBe('0.5k');
    expect(toPearResolutionParam('4K')).toBe('4k');
    expect(toPearResolutionParam('high')).toBeUndefined();
  });
});

describe('PearAPI pixel math follows the official resolution tiers', () => {
  it('long side equals the tier pixel count', () => {
    expect(calculateActualPixels('1:1', '1K', 'gpt-image-2', PEAR)).toBe('1024x1024');
    expect(calculateActualPixels('3:4', '2K', 'nano-banana-2', PEAR)).toBe('1536x2048');
    expect(calculateActualPixels('16:9', '4K', 'nano-banana-2', PEAR)).toBe('4096x2304');
    expect(calculateActualPixels('1:8', '1K', 'nano-banana-pro', PEAR)).toBe('128x1024');
    expect(calculateActualPixels('4:5', '0.5K', 'nano-banana-2', PEAR)).toBe('410x512');
  });

  it('fixed-tier models preview at the 2K default tier', () => {
    expect(calculateActualPixels('1:1', '', 'doubao-seedream-5-0-260128', PEAR)).toBe('2048x2048');
    expect(calculateActualPixels('16:9', '', 'z-image', PEAR)).toBe('2048x1152');
  });

  it('pixel tables follow official tiers (0.5K/4K included)', () => {
    expect(getModelSpecificPixelSize('1:1', '0.5K', 'nano-banana-2')).toBe('512x512');
    expect(getModelSpecificPixelSize('16:9', '4K', 'nano-banana-2')).toBe('4096x2304');
    expect(getModelSpecificPixelSize('1:8', '1K', 'nano-banana-pro')).toBe('128x1024');
    expect(getModelSpecificPixelSize('4:5', '2K', 'nano-banana-2.1')).toBe('1638x2048');
  });

  it('pixel sizing option uses resolution tiers for PearAPI', () => {
    expect(getProviderPixelSizingOption(PEAR, 'auto', '4K')).toBe('4K');
    expect(getProviderPixelSizingOption(NON_PEAR, 'high', '4K')).toBe('high');
  });
});

describe('PearAPI request body follows the official contract', () => {
  it('lowercases resolution and strips quality for non-GPT models', () => {
    const { body } = adjustRequestForProfile(
      {
        model: 'nano-banana-2',
        prompt: 'test',
        n: 1,
        size: '3:4',
        resolution: '2K',
        quality: 'high',
        negative_prompt: 'blur',
        seed: 42,
        width: 1536,
        height: 2048,
        size_px: '1536x2048',
      },
      PROFILE_PEARAPI,
      { hasReferenceImages: false },
    );
    expect(body.size).toBe('3:4');
    expect(body.resolution).toBe('2k');
    expect(body.quality).toBeUndefined();
    expect(body.negative_prompt).toBeUndefined();
    expect(body.seed).toBeUndefined();
    expect(body.width).toBeUndefined();
    expect(body.height).toBeUndefined();
    expect(body.size_px).toBeUndefined();
  });

  it('keeps quality for GPT series (including xhigh/max)', () => {
    const { body } = adjustRequestForProfile(
      { model: 'gpt-image-2.5', prompt: 'test', n: 1, size: '1:1', resolution: '4K', quality: 'xhigh' },
      PROFILE_PEARAPI,
      { hasReferenceImages: false },
    );
    expect(body.quality).toBe('xhigh');
    expect(body.resolution).toBe('4k');
  });

  it('migrates tier-like quality to resolution for non-GPT models (canvas legacy convention)', () => {
    // 画布生成组历史约定：resolution 型模型的档位存放在 quality 字段
    const { body } = adjustRequestForProfile(
      { model: 'nano-banana-2', prompt: 'test', n: 1, size: '16:9', quality: '4K' },
      PROFILE_PEARAPI,
      { hasReferenceImages: false },
    );
    expect(body.resolution).toBe('4k');
    expect(body.quality).toBeUndefined();
  });

  it('strips resolution for fixed-tier models (official: omit to use channel default)', () => {    const models = ['nano-banana', 'grok-imagine-image-2.0', 'doubao-seedream-5-0-pro-260628', 'wan2.7-image'];
    for (const model of models) {
      const { body } = adjustRequestForProfile(
        { model, prompt: 'test', n: 1, size: '16:9', resolution: '2K' },
        PROFILE_PEARAPI,
        { hasReferenceImages: false },
      );
      expect(body.resolution, model).toBeUndefined();
    }
    // nano-banana-2 有档位，应保留 resolution
    const { body: nb2 } = adjustRequestForProfile(
      { model: 'nano-banana-2', prompt: 'test', n: 1, size: '16:9', resolution: '2K' },
      PROFILE_PEARAPI,
      { hasReferenceImages: false },
    );
    expect(nb2.resolution).toBe('2k');
  });

  it('drops invalid resolution values instead of forwarding them', () => {
    const { body } = adjustRequestForProfile(
      { model: 'nano-banana-2', prompt: 'test', n: 1, size: '1:1', resolution: 'ultra' },
      PROFILE_PEARAPI,
      { hasReferenceImages: false },
    );
    expect(body.resolution).toBeUndefined();
  });

  it('keeps official sync fields (task_type/response_format) and n', () => {
    const { body } = adjustRequestForProfile(
      { model: 'gpt-image-2', prompt: 'test', image_count: 2, size: '1:1' },
      PROFILE_PEARAPI,
      { hasReferenceImages: false },
    );
    expect(body.task_type).toBe('sync');
    expect(body.response_format).toBe('url');
    expect(body.n).toBe(2);
    expect(body.image_count).toBeUndefined();
  });
});
