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
