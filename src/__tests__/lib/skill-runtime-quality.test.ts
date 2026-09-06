import { describe, expect, it } from 'vitest';

import { runSkillQualityGates } from '@/lib/skill-runtime/quality-gates';
import type { SkillStepResult } from '@/lib/skill-runtime/types';

function result(overrides: Partial<SkillStepResult> = {}): SkillStepResult {
  return {
    assetVersionIds: [],
    media: [],
    ...overrides,
  };
}

describe('runSkillQualityGates', () => {
  it('确定性检查输出存在、透明通道和有效 HTML', () => {
    const actual = runSkillQualityGates(
      ['output-present', 'transparent-alpha', 'valid-html'],
      result({
        assetVersionIds: ['ver-1'],
        media: [{ hasTransparency: true }],
        html: '<main>ready</main>',
      }),
      {},
    );

    expect(actual).toEqual([
      { id: 'output-present', passed: true },
      { id: 'transparent-alpha', passed: true },
      { id: 'valid-html', passed: true },
    ]);
  });

  it('expected-count 从 context 读取期望数量', () => {
    expect(runSkillQualityGates(
      ['expected-count'],
      result({ assetVersionIds: ['ver-1', 'ver-2'] }),
      { expectedCount: 2 },
    )).toEqual([{ id: 'expected-count', passed: true }]);

    expect(runSkillQualityGates(
      ['expected-count'],
      result({ assetVersionIds: ['ver-1'] }),
      { expectedCount: 2 },
    )).toEqual([{ id: 'expected-count', passed: false }]);
  });

  it('要求图像包含有效尺寸元数据', () => {
    expect(runSkillQualityGates(
      ['image-dimensions-known'],
      result({ assetVersionIds: ['ver-1'], media: [{ width: 1200, height: 1200 }] }),
      {},
    )).toEqual([{ id: 'image-dimensions-known', passed: true }]);

    expect(runSkillQualityGates(
      ['image-dimensions-known'],
      result({ assetVersionIds: ['ver-1'], media: [{}] }),
      {},
    )).toEqual([{ id: 'image-dimensions-known', passed: false }]);
  });

  it('在 1% 容差内检查目标画幅比例', () => {
    expect(runSkillQualityGates(
      ['aspect-ratio-match'],
      result({ assetVersionIds: ['ver-1'], media: [{ width: 1000, height: 1005 }] }),
      { expectedAspectRatio: '1:1' },
    )).toEqual([{ id: 'aspect-ratio-match', passed: true }]);

    expect(runSkillQualityGates(
      ['aspect-ratio-match'],
      result({ assetVersionIds: ['ver-1'], media: [{ width: 1000, height: 1020 }] }),
      { expectedAspectRatio: '1:1' },
    )).toEqual([{ id: 'aspect-ratio-match', passed: false }]);

    expect(runSkillQualityGates(
      ['aspect-ratio-match'],
      result({ assetVersionIds: ['ver-1'], media: [{ width: 1600, height: 900 }] }),
      { expectedAspectRatio: 'invalid' },
    )).toEqual([{ id: 'aspect-ratio-match', passed: false }]);
  });

  it('缺失质量条件时明确失败', () => {
    expect(runSkillQualityGates(
      ['output-present', 'transparent-alpha', 'valid-html', 'expected-count'],
      result(),
      {},
    )).toEqual([
      { id: 'output-present', passed: false },
      { id: 'transparent-alpha', passed: false },
      { id: 'valid-html', passed: false },
      { id: 'expected-count', passed: false },
    ]);
  });

  it('未知门禁 ID 返回明确失败而非静默通过', () => {
    expect(runSkillQualityGates(
      ['unknown-gate'],
      result({ assetVersionIds: ['ver-1'] }),
      {},
    )).toEqual([{
      id: 'unknown-gate',
      passed: false,
      error: 'Unknown quality gate: unknown-gate',
    }]);
  });
});
