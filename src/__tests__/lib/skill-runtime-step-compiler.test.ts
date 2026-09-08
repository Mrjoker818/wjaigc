import { describe, expect, it } from 'vitest';

import { skillExecutionSteps } from '@/lib/skill-runtime/cost-estimator';
import { LOVART_CONTENT_COMMERCE_SKILLS } from '@/lib/skill-runtime/content-commerce-presets';
import { resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';
import {
  assertCompiledSkillFanOutValues,
  compileConditionalSkillSteps,
  compiledSkillFanOutValue,
  SkillStepFanOutError,
} from '@/lib/skill-runtime/step-compiler';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

const conditionalSkill = {
  id: 'conditional-test', version: 1, name: 'Conditional', category: 'test',
  description: 'test', systemPrompt: 'test', allowedSurfaces: ['canvas'], inputs: [
    { key: 'seriesCount', label: 'Count', kind: 'select', required: true, options: ['2', '3'] },
  ],
  steps: [
    {
      id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential',
      promptTemplate: 'plan', modelRole: 'orchestrator', qualityGateIds: [],
    },
    {
      id: 'first', label: 'First', toolId: 'img2img', execution: 'parallel',
      parallelGroup: 'outputs', promptTemplate: 'first', modelRole: 'image', qualityGateIds: [],
    },
    {
      id: 'third', label: 'Third', toolId: 'img2img', execution: 'parallel',
      parallelGroup: 'outputs', promptTemplate: 'third', modelRole: 'image', qualityGateIds: [],
      when: { input: 'seriesCount', includes: ['3'] },
    },
  ],
  enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
} as SkillDefinition;

const imageAuditSkill = {
  id: 'image-audit-test', version: 1, name: 'Image audit', category: 'test',
  description: 'test', systemPrompt: 'test', allowedSurfaces: ['canvas'], inputs: [
    {
      key: 'sourceImages', label: 'Sources', kind: 'images', required: true,
      maximumItems: 20, bindToSourceVersions: true,
    },
  ],
  steps: [{
    id: 'audit-image', label: 'Audit image', toolId: 'audit', execution: 'parallel',
    parallelGroup: 'audit', promptTemplate: 'Audit one authorized source image.',
    modelRole: 'vision', qualityGateIds: [],
    fanOut: {
      inputKey: 'sourceImages', itemAlias: 'sourceImage', maximumItems: 20, concurrency: 3,
    },
  }],
  enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
} satisfies SkillDefinition;

const batchSkuSkill = LOVART_CONTENT_COMMERCE_SKILLS.find(
  skill => skill.id === 'preset-batch-sku-assets',
)!;
const skuInputs = {
  rows: [{
    sku: 'A-1', name: '黑色', sellingPoints: '降噪', variant: '', headline: '',
  }],
};
const previousSkuSnapshot = [
  {
    id: 'sku-plan', label: '检查批次规则', toolId: 'chat', execution: 'sequential',
    promptTemplate: '检查{{platform}}商品数据和{{assetType}}生产规则，不补造商品事实。',
    modelRole: 'orchestrator', qualityGateIds: ['text-output-present'],
  },
  {
    id: 'sku-creative:1a464ff708f1cf27', label: 'SKU 商品素材 1', toolId: 'img2img',
    execution: 'parallel', parallelGroup: 'preset-batch-sku-assets:outputs:chunk:0',
    promptTemplate: '基于来源图片为 SKU A-1（黑色）生成{{platform}}{{assetType}}，比例{{aspectRatio}}；卖点：降噪；规格：；标题：；保持{{brandTone}}，避免{{negativeConstraints}}。',
    promptInstructionTemplate: '基于来源图片为 SKU {{sku.sku}}（{{sku.name}}）生成{{platform}}{{assetType}}，比例{{aspectRatio}}；卖点：{{sku.sellingPoints}}；规格：{{sku.variant}}；标题：{{sku.headline}}；保持{{brandTone}}，避免{{negativeConstraints}}。',
    modelRole: 'image',
    qualityGateIds: ['output-present', 'image-dimensions-known', 'aspect-ratio-match'],
  },
];

describe('Skill execution step compiler', () => {
  it('fans out an images field in stable chunks without exposing AssetVersion IDs', () => {
    const inputValues = {
      sourceImages: ['asset_version_a', 'asset_version_b', 'asset_version_c'],
    };
    const steps = compileConditionalSkillSteps(imageAuditSkill, inputValues);

    expect(steps.map(step => step.compiledFanOut)).toEqual([
      { inputKey: 'sourceImages', itemIndex: 0, itemDigest: expect.any(String) },
      { inputKey: 'sourceImages', itemIndex: 1, itemDigest: expect.any(String) },
      { inputKey: 'sourceImages', itemIndex: 2, itemDigest: expect.any(String) },
    ]);
    expect(steps.map(step => step.parallelGroup)).toEqual([
      'audit:chunk:0', 'audit:chunk:0', 'audit:chunk:0',
    ]);
    expect(steps.map(step => step.id)).toEqual([
      expect.stringMatching(/^audit-image:[a-f0-9]{16}$/u),
      expect.stringMatching(/^audit-image:[a-f0-9]{16}$/u),
      expect.stringMatching(/^audit-image:[a-f0-9]{16}$/u),
    ]);
    expect(JSON.stringify(steps)).not.toContain('asset_version_');
    expect(compiledSkillFanOutValue(steps[1]!, inputValues)).toBe('asset_version_b');
  });

  it('rejects invalid image fan-out definitions and changed frozen inputs', () => {
    const inputValues = { sourceImages: ['asset_version_a'] };
    const [compiled] = compileConditionalSkillSteps(imageAuditSkill, inputValues);
    const withKeyField = {
      ...imageAuditSkill,
      steps: imageAuditSkill.steps.map(step => ({
        ...step, fanOut: { ...step.fanOut, keyField: 'id' },
      })),
    } satisfies SkillDefinition;

    expect(() => compileConditionalSkillSteps(withKeyField, inputValues))
      .toThrowError(expect.objectContaining({ code: 'SKILL_STEP_FAN_OUT_INVALID' }));
    expect(() => compileConditionalSkillSteps(imageAuditSkill, { sourceImages: [''] }))
      .toThrowError(expect.objectContaining({ code: 'SKILL_STEP_FAN_OUT_INVALID' }));
    expect(() => compiledSkillFanOutValue(compiled!, { sourceImages: ['asset_version_b'] }))
      .toThrowError(expect.objectContaining({ code: 'SKILL_STEP_FAN_OUT_INVALID' }));
  });

  it('binds a compiled image digest to the step id and frozen input field contract', () => {
    const inputValues = { sourceImages: ['asset_version_a'] };
    const [compiled] = compileConditionalSkillSteps(imageAuditSkill, inputValues);
    const forgedId = { ...compiled!, id: 'audit-image:ffffffffffffffff' };
    const unboundDefinition = {
      ...imageAuditSkill,
      inputs: imageAuditSkill.inputs.map(field => ({
        ...field, bindToSourceVersions: false,
      })),
      steps: [compiled!],
    } satisfies SkillDefinition;

    expect(() => compiledSkillFanOutValue(forgedId, inputValues))
      .toThrowError(expect.objectContaining({ code: 'SKILL_STEP_FAN_OUT_INVALID' }));
    expect(() => assertCompiledSkillFanOutValues(unboundDefinition, inputValues))
      .toThrowError(expect.objectContaining({ code: 'SKILL_STEP_FAN_OUT_INVALID' }));
  });

  it('rejects a compiled step id that collides with an ordinary step id', () => {
    const inputValues = { sourceImages: ['asset_version_a'] };
    const [compiled] = compileConditionalSkillSteps(imageAuditSkill, inputValues);
    const ordinary = { ...compiled! };
    delete ordinary.compiledFanOut;

    expect(() => assertCompiledSkillFanOutValues({
      inputs: imageAuditSkill.inputs,
      steps: [ordinary, compiled!],
    }, inputValues)).toThrowError(expect.objectContaining({
      code: 'SKILL_STEP_FAN_OUT_INVALID',
    }));
  });

  it('rejects duplicate image identities before they can collide as step ids', () => {
    expect(() => compileConditionalSkillSteps(imageAuditSkill, {
      sourceImages: ['asset_version_a', 'asset_version_a'],
    })).toThrowError(expect.objectContaining({
      code: 'SKILL_STEP_FAN_OUT_INVALID', stepId: 'audit-image',
    }));
  });

  it('requires image fan-out fields to bind valid AssetVersion ids', () => {
    const withoutBinding = {
      ...imageAuditSkill,
      inputs: imageAuditSkill.inputs.map(field => ({
        ...field, bindToSourceVersions: false,
      })),
    } satisfies SkillDefinition;

    expect(() => compileConditionalSkillSteps(withoutBinding, {
      sourceImages: ['asset_version_a'],
    })).toThrowError(expect.objectContaining({ code: 'SKILL_STEP_FAN_OUT_INVALID' }));
    expect(() => compileConditionalSkillSteps(imageAuditSkill, {
      sourceImages: ['not an asset id'],
    })).toThrowError(expect.objectContaining({ code: 'SKILL_STEP_FAN_OUT_INVALID' }));
  });

  it('keeps an optional resolved-undefined images fan-out as one base step', () => {
    const optional = {
      ...imageAuditSkill,
      inputs: imageAuditSkill.inputs.map(field => ({ ...field, required: false })),
    } satisfies SkillDefinition;
    const resolved = resolveSkillInputs(optional, {});

    expect(Object.hasOwn(resolved, 'sourceImages')).toBe(true);
    expect(resolved.sourceImages).toBeUndefined();
    expect(compileConditionalSkillSteps(optional, resolved)).toEqual([{
      id: 'audit-image', label: 'Audit image', toolId: 'audit', execution: 'parallel',
      parallelGroup: 'audit', promptTemplate: 'Audit one authorized source image.',
      modelRole: 'vision', qualityGateIds: [],
    }]);
  });

  it('allows 20 image inputs through resolution and rejects the 21st', () => {
    const twenty = Array.from({ length: 20 }, (_, index) => `asset_version_${index}`);

    expect(resolveSkillInputs(imageAuditSkill, { sourceImages: twenty }).sourceImages)
      .toHaveLength(20);
    expect(compileConditionalSkillSteps(
      imageAuditSkill,
      resolveSkillInputs(imageAuditSkill, { sourceImages: twenty }),
    )).toHaveLength(20);
    expect(() => resolveSkillInputs(imageAuditSkill, {
      sourceImages: [...twenty, 'asset_version_20'],
    })).toThrowError(expect.objectContaining({ code: 'SKILL_INPUT_LIMIT_EXCEEDED' }));
  });

  it('normalizes unhashable compiled values to SkillStepFanOutError', () => {
    const [compiled] = compileConditionalSkillSteps(imageAuditSkill, {
      sourceImages: ['asset_version_a'],
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => compiledSkillFanOutValue(compiled!, { sourceImages: [BigInt(1)] }))
      .toThrow(SkillStepFanOutError);
    expect(() => compiledSkillFanOutValue(compiled!, { sourceImages: [cyclic] }))
      .toThrow(SkillStepFanOutError);
  });

  it('keeps the existing sku dataset expansion unchanged', () => {
    expect(compileConditionalSkillSteps(batchSkuSkill, skuInputs))
      .toEqual(previousSkuSnapshot);
  });

  it('omits a conditional step when the resolved input does not match', () => {
    expect(skillExecutionSteps(conditionalSkill, { seriesCount: '2' }).map(step => step.id))
      .toEqual(['plan', 'first']);
  });

  it('keeps a conditional step when the resolved input matches', () => {
    expect(skillExecutionSteps(conditionalSkill, { seriesCount: '3' }).map(step => step.id))
      .toEqual(['plan', 'first', 'third']);
  });

  it('compiles the real Pinterest series count without changing its definition', () => {
    const pinterest = LOVART_CONTENT_COMMERCE_SKILLS.find(
      skill => skill.id === 'preset-pinterest-pins',
    )!;

    expect(skillExecutionSteps(pinterest, { seriesCount: '2' }).map(step => step.id))
      .toEqual(['pin-plan', 'pin-hero', 'pin-detail']);
    expect(skillExecutionSteps(pinterest, { seriesCount: '3' }).map(step => step.id))
      .toEqual(['pin-plan', 'pin-hero', 'pin-detail', 'pin-conversion']);
    expect(pinterest.steps.at(-1)?.when).toEqual({ input: 'seriesCount', includes: ['3'] });
  });

  it('freezes the advertised output ratio for thumbnail and Pinterest presets', () => {
    const thumbnails = LOVART_CONTENT_COMMERCE_SKILLS.find(
      skill => skill.id === 'preset-video-platform-thumbnails',
    )!;
    const pinterest = LOVART_CONTENT_COMMERCE_SKILLS.find(
      skill => skill.id === 'preset-pinterest-pins',
    )!;

    expect(resolveSkillInputs(thumbnails, {
      sourceImages: ['source-1'], videoTitle: 'Title', subject: 'Cake',
      audience: 'Bakers', hook: 'Learn quickly',
    }).aspectRatio).toBe('16:9');
    expect(resolveSkillInputs(pinterest, {
      sourceImages: ['source-1'], topic: 'Cake', audience: 'Bakers', goal: '收藏',
    }).aspectRatio).toBe('2:3');
  });

  it('rejects a condition that references an undeclared input', () => {
    const invalid = {
      ...conditionalSkill,
      steps: conditionalSkill.steps.map(step => step.id === 'third'
        ? { ...step, when: { input: 'missing', includes: ['3'] } }
        : step),
    } as SkillDefinition;

    expect(() => skillExecutionSteps(invalid, {})).toThrowError(expect.objectContaining({
      code: 'SKILL_STEP_CONDITION_INVALID',
      stepId: 'third',
    }));
  });
});
