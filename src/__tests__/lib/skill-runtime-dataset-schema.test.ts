import { describe, expect, it } from 'vitest';

import { LOVART_CONTENT_COMMERCE_SKILLS } from '@/lib/skill-runtime/content-commerce-presets';
import { resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';

const batchSku = LOVART_CONTENT_COMMERCE_SKILLS.find(
  skill => skill.id === 'preset-batch-sku-assets',
)!;

function input(rows: unknown[]): Record<string, unknown> {
  return { sourceImages: ['version-1'], rows };
}

describe('batch SKU dataset schema', () => {
  it('trims and preserves the supported SKU fields in row order', () => {
    const resolved = resolveSkillInputs(batchSku, input([
      { sku: ' A-1 ', name: ' 黑色耳机 ', sellingPoints: ' 主动降噪 ', variant: ' 黑色 ' },
      { sku: 'B-2', name: '白色耳机' },
    ]));

    expect(resolved.rows).toEqual([
      { sku: 'A-1', name: '黑色耳机', sellingPoints: '主动降噪', variant: '黑色' },
      { sku: 'B-2', name: '白色耳机' },
    ]);
  });

  it.each([
    [[{ sku: 'A-1', name: '耳机' }, { sku: 'A-1', name: '耳机二' }], 'SKILL_DATASET_DUPLICATE_SKU'],
    [[{ sku: 'A-1', name: '耳机', price: '99' }], 'SKILL_DATASET_UNKNOWN_FIELD'],
    [[{ sku: '=cmd', name: '耳机' }], 'SKILL_DATASET_FORMULA_VALUE'],
    [Array.from({ length: 21 }, (_, index) => ({ sku: `SKU-${index}`, name: '耳机' })), 'SKILL_INPUT_LIMIT_EXCEEDED'],
  ])('rejects an invalid SKU dataset %#', (rows, code) => {
    expect(() => resolveSkillInputs(batchSku, input(rows))).toThrowError(expect.objectContaining({
      code,
      field: 'rows',
    }));
  });
});
