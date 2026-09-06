import { describe, expect, it, vi } from 'vitest';

import {
  estimateSkillRunCost,
  skillExecutionSteps,
} from '@/lib/skill-runtime/cost-estimator';
import { LOVART_CONTENT_COMMERCE_SKILLS } from '@/lib/skill-runtime/content-commerce-presets';
import { resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';

const batchSku = LOVART_CONTENT_COMMERCE_SKILLS.find(
  skill => skill.id === 'preset-batch-sku-assets',
)!;

function resolvedRows(count: number): Record<string, unknown> {
  return resolveSkillInputs(batchSku, {
    sourceImages: ['version-1'],
    rows: Array.from({ length: count }, (_, index) => ({
      sku: `SKU-${index + 1}`,
      name: `商品 ${index + 1}`,
      sellingPoints: `卖点 ${index + 1}`,
      variant: `规格 ${index + 1}`,
      headline: `标题 ${index + 1}`,
    })),
  });
}

describe('batch SKU Skill compilation and pricing', () => {
  it('fans normalized rows out in order with stable identities and bounded parallel groups', () => {
    const threeRows = resolvedRows(3);
    const steps = skillExecutionSteps(batchSku, threeRows);

    expect(steps).toHaveLength(4);
    expect(steps[0]?.id).toBe('sku-plan');
    expect(steps.slice(1).map(step => step.id)).toEqual([
      expect.stringMatching(/^sku-creative:[a-f0-9]{16}$/),
      expect.stringMatching(/^sku-creative:[a-f0-9]{16}$/),
      expect.stringMatching(/^sku-creative:[a-f0-9]{16}$/),
    ]);
    expect(new Set(steps.slice(1).map(step => step.id))).toHaveProperty('size', 3);
    expect(new Set(steps.slice(1).map(step => step.parallelGroup))).toHaveProperty('size', 1);

    for (const [index, step] of steps.slice(1).entries()) {
      expect(step.promptTemplate).toContain(`SKU-${index + 1}`);
      expect(step.promptTemplate).toContain(`商品 ${index + 1}`);
      expect(step.promptTemplate).toContain(`卖点 ${index + 1}`);
      expect(step.promptTemplate).not.toContain('{{sku.');
      expect(step).not.toHaveProperty('fanOut');
    }

    const reordered = resolveSkillInputs(batchSku, {
      sourceImages: ['version-1'],
      rows: [
        { sku: 'SKU-3', name: '商品 3', sellingPoints: '卖点 3', variant: '规格 3', headline: '标题 3' },
        { sku: 'SKU-1', name: '商品 1', sellingPoints: '卖点 1', variant: '规格 1', headline: '标题 1' },
      ],
    });
    const reorderedSteps = skillExecutionSteps(batchSku, reordered).slice(1);
    expect(reorderedSteps[0]?.id).toBe(steps[3]?.id);
    expect(reorderedSteps[1]?.id).toBe(steps[1]?.id);

    const fourSteps = skillExecutionSteps(batchSku, resolvedRows(4));
    expect(fourSteps[1]?.parallelGroup).toBe(fourSteps[3]?.parallelGroup);
    expect(fourSteps[4]?.parallelGroup).not.toBe(fourSteps[3]?.parallelGroup);
  });

  it('quotes the exact orchestrator plus one image operation per normalized row', async () => {
    const calculateCreditCost = vi.fn(async operation => operation === 'chat' ? 2 : 7);
    const quote = await estimateSkillRunCost(batchSku, {
      orchestrator: { providerId: 'pear-chat', modelId: 'chat-model' },
      image: { providerId: 'pear-image', modelId: 'image-model' },
    }, { calculateCreditCost }, resolvedRows(3));

    expect(quote.steps).toHaveLength(4);
    expect(quote.minimum).toBe(23);
    expect(quote.maximum).toBe(23);
    expect(calculateCreditCost.mock.calls.map(call => call[0]))
      .toEqual(['chat', 'image_generate', 'image_generate', 'image_generate']);
  });

  it('keeps one and twenty row quotes aligned with the concrete execution plan', async () => {
    const calculateCreditCost = vi.fn(async () => 1);
    const bindings = {
      orchestrator: { providerId: 'pear-chat', modelId: 'chat-model' },
      image: { providerId: 'pear-image', modelId: 'image-model' },
    };

    await expect(estimateSkillRunCost(
      batchSku, bindings, { calculateCreditCost }, resolvedRows(1),
    )).resolves.toMatchObject({ minimum: 2, maximum: 2 });
    await expect(estimateSkillRunCost(
      batchSku, bindings, { calculateCreditCost }, resolvedRows(20),
    )).resolves.toMatchObject({ minimum: 21, maximum: 21 });
  });

  it.each([
    { fanOutPatch: { concurrency: 0 }, description: 'invalid concurrency' },
    { fanOutPatch: { maximumItems: 21 }, description: 'limit inconsistent with the dataset field' },
    { fanOutPatch: { keyField: 'missing' }, description: 'missing row key' },
    { fanOutPatch: { itemAlias: '[' }, description: 'invalid item alias' },
  ])('rejects $description before compiling a fan-out plan', ({ fanOutPatch }) => {
    const invalid = {
      ...batchSku,
      steps: batchSku.steps.map(step => step.id === 'sku-creative'
        ? { ...step, fanOut: { ...step.fanOut!, ...fanOutPatch } }
        : step),
    };
    expect(() => skillExecutionSteps(invalid, resolvedRows(3)))
      .toThrowError(expect.objectContaining({ code: 'SKILL_STEP_FAN_OUT_INVALID' }));
  });

  it('rejects a fan-out template that does not consume its item alias', () => {
    const invalid = {
      ...batchSku,
      steps: batchSku.steps.map(step => step.id === 'sku-creative'
        ? { ...step, promptTemplate: '没有任何行占位符' }
        : step),
    };
    expect(() => skillExecutionSteps(invalid, resolvedRows(3)))
      .toThrowError(expect.objectContaining({ code: 'SKILL_STEP_FAN_OUT_INVALID' }));
  });
});
