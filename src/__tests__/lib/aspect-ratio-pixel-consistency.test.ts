import { describe, expect, it } from 'vitest';

import {
  adjustRequestForProfile,
  convertAspectRatioToSize,
  getModelSpecificPixelSize,
  PROFILE_APIMART,
  PROFILE_PEARAPI,
} from '@/lib/api-compatibility';

/** 声明比例的精确宽高比（w/h） */
const RATIO_VALUE: Record<string, number> = {
  '1:1': 1,
  '3:2': 1.5,
  '2:3': 2 / 3,
  '4:3': 4 / 3,
  '3:4': 0.75,
  '5:4': 1.25,
  '4:5': 0.8,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '2:1': 2,
  '1:2': 0.5,
  '3:1': 3,
  '1:3': 1 / 3,
  '21:9': 21 / 9,
  '9:21': 9 / 21,
};

/**
 * 核心不变量：任何由比例换算出的像素尺寸，其 w/h 必须与声明比例一致
 * （相对误差 < 2%，覆盖取整抖动）。
 * 背景：生产事故 — 遗留表把 3:4 映射到 1024x1536（2:3 的像素），
 * adjustRequestForProfile 用重算的 width/height 覆盖提交参数，
 * 供应商优先像素导致出图比例从 3:4 漂移为 2:3。
 */
function assertRatioConsistent(pixelSize: string, ratio: string): void {
  expect(pixelSize).toMatch(/^\d+x\d+$/);
  const [w, h] = pixelSize.split('x').map(Number);
  expect(w).toBeGreaterThan(0);
  expect(h).toBeGreaterThan(0);
  const actual = w / h;
  const expected = RATIO_VALUE[ratio];
  // 3% 容差：覆盖 64 像素对齐取整（如动态计算 9:21 → 896x2048，偏差 ~2.1%）
  expect(Math.abs(actual - expected) / expected).toBeLessThan(0.03);
}

describe('aspect-ratio → pixel-size consistency', () => {
  it('legacy mapping keeps 4:3 and 3:4 pixels consistent with their ratios', () => {
    expect(convertAspectRatioToSize('4:3', '1K')).toBe('1365x1024');
    expect(convertAspectRatioToSize('3:4', '1K')).toBe('1024x1365');
    // 3:2 / 2:3 的正确映射不受影响
    expect(convertAspectRatioToSize('3:2', '1K')).toBe('1536x1024');
    expect(convertAspectRatioToSize('2:3', '1K')).toBe('1024x1536');
  });

  it('every known ratio resolves to pixels matching its declared ratio (generic fallback table)', () => {
    for (const ratio of Object.keys(RATIO_VALUE)) {
      const pixelSize = convertAspectRatioToSize(ratio, '1K');
      assertRatioConsistent(pixelSize, ratio);
    }
  });

  it('resolves every known ratio to ratio-consistent pixels across resolution tiers for GPT Image 2.5 sub-models', () => {
    for (const model of ['gpt-image-2.5', 'gpt-image-2.5-2k', 'gpt-image-2.5-4k']) {
      for (const tier of ['1K', '2K', '4K']) {
        for (const ratio of Object.keys(RATIO_VALUE)) {
          const pixelSize = convertAspectRatioToSize(ratio, tier, model);
          assertRatioConsistent(pixelSize, ratio);
        }
      }
    }
  });

  it('maps gpt-image-2.5-2k 3:4@2K to the full base table instead of the legacy fallback', () => {
    expect(getModelSpecificPixelSize('3:4', '2K', 'gpt-image-2.5-2k')).toBe('2048x2731');
    expect(convertAspectRatioToSize('3:4', '2K', 'gpt-image-2.5-2k')).toBe('2048x2731');
    expect(convertAspectRatioToSize('4:3', '4K', 'gpt-image-2.5-2k')).toBe('5461x4096');
  });

  it('preserves previously correct sub-model lookups (no regression)', () => {
    expect(convertAspectRatioToSize('4:5', '4K', 'gpt-image-2.5-4k')).toBe('4096x5120');
    expect(convertAspectRatioToSize('16:9', '2K', 'gpt-image-2.5-4k')).toBe('3641x2048');
    expect(convertAspectRatioToSize('21:9', '1K', 'gpt-image-2.5-sunburst')).toBe('2389x1024');
  });
});

describe('adjustRequestForProfile keeps size ratio and pixel hints consistent', () => {
  // 复现生产故障：PearAPI + gpt-image-2.5-2k + 3:4@2K
  // 修复前：width/height 被重算为 1024x1536（2:3），与 size '3:4' 自相矛盾
  it('pearapi gpt-image-2.5-2k 3:4@2K derives ratio-consistent pixel hints', () => {
    const { body } = adjustRequestForProfile(
      { model: 'gpt-image-2.5-2k', prompt: 'test', n: 1, size: '3:4', resolution: '2K', quality: 'auto' },
      PROFILE_PEARAPI,
      { hasReferenceImages: true },
    );
    expect(body.size).toBe('3:4');
    expect(body.width).toBe(2048);
    expect(body.height).toBe(2731);
    expect(body.size_px).toBe('2048x2731');
    assertRatioConsistent(`${body.width}x${body.height}`, '3:4');
  });

  it('apimart keeps aspect size only and strips derived pixel hints per its contract', () => {
    const { body } = adjustRequestForProfile(
      { model: 'gpt-image-2.5-2k', prompt: 'test', n: 1, size: '4:3', resolution: '4K', quality: 'auto' },
      PROFILE_APIMART,
      { hasReferenceImages: true },
    );
    // APImart 契约：仅发送宽高比 size，不携带 width/height/size_px（与生产日志一致）
    expect(body.size).toBe('4:3');
    expect(body.width).toBeUndefined();
    expect(body.height).toBeUndefined();
    expect(body.size_px).toBeUndefined();
  });

  it('nano-banana-2-4k 1:1@4K promotes the pixel hint from the 1K intermediate to 4K', () => {
    const { body } = adjustRequestForProfile(
      { model: 'nano-banana-2-4k', prompt: 'test', n: 1, size: '1:1', resolution: '4K', quality: 'auto' },
      PROFILE_PEARAPI,
      { hasReferenceImages: true },
    );
    expect(body.size).toBe('1:1');
    expect(body.width).toBe(4096);
    expect(body.height).toBe(4096);
  });

  it('ratio-consistency invariant holds for all ratios on aspect-ratio profiles at every tier', () => {
    for (const profile of [PROFILE_PEARAPI, PROFILE_APIMART]) {
      for (const tier of ['1K', '2K', '4K']) {
        for (const ratio of Object.keys(RATIO_VALUE)) {
          const { body } = adjustRequestForProfile(
            { model: 'gpt-image-2.5-2k', prompt: 'test', n: 1, size: ratio, resolution: tier, quality: 'auto' },
            profile,
            { hasReferenceImages: true },
          );
          if (typeof body.width === 'number' && typeof body.height === 'number') {
            assertRatioConsistent(`${body.width}x${body.height}`, ratio);
          }
        }
      }
    }
  });
});
