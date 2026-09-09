import { describe, expect, it, vi } from 'vitest';

import {
  estimateSkillRunCost,
  skillExecutionSteps,
  skillStepCreditCost,
  toolCostType,
} from '@/lib/skill-runtime/cost-estimator';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

const canvasSkill: SkillDefinition = {
  id: 'cost-test', version: 1, name: 'Cost test', category: 'image',
  description: 'test', systemPrompt: 'test', allowedSurfaces: ['canvas'], inputs: [],
  steps: [
    {
      id: 'orchestrator', label: 'Plan', toolId: 'generate_image', execution: 'sequential',
      promptTemplate: 'plan', modelRole: 'orchestrator', qualityGateIds: [],
    },
    {
      id: 'image', label: 'Generate', toolId: 'generate_image', execution: 'sequential',
      promptTemplate: 'generate', modelRole: 'image', qualityGateIds: [],
    },
  ],
  enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
};

describe('Skill runtime cost estimator', () => {
  it('keeps a pure local Skill free and does not synthesize an orchestrator', async () => {
    const calculateCreditCost = vi.fn(async () => 9);
    const localSkill: SkillDefinition = {
      ...canvasSkill,
      id: 'local-cost-test',
      steps: [{
        id: 'export', label: '批量导出', toolId: 'multi_platform_export',
        runtime: 'local', execution: 'sequential', promptTemplate: '',
        qualityGateIds: ['output-present'],
      }],
    };

    expect(skillExecutionSteps(localSkill)).toEqual(localSkill.steps);
    await expect(estimateSkillRunCost(localSkill, {}, { calculateCreditCost }))
      .resolves.toEqual({ minimum: 0, maximum: 0, steps: [{ stepId: 'export', cost: 0 }] });
    await expect(skillStepCreditCost(localSkill.steps[0], {}, { calculateCreditCost }))
      .resolves.toBe(0);
    expect(calculateCreditCost).not.toHaveBeenCalled();
  });

  it('prices each compliance audit image as one frozen vision chat call', async () => {
    expect(toolCostType('compliance_audit')).toBe('chat');
    const calculateCreditCost = vi.fn(async () => 3);
    const complianceSkill: SkillDefinition = {
      ...canvasSkill,
      steps: [{
        id: 'orchestrator', label: 'Plan', toolId: 'chat', execution: 'sequential',
        promptTemplate: 'plan', modelRole: 'orchestrator', qualityGateIds: [],
      }, {
        id: 'audit:a', label: 'Audit 1', toolId: 'compliance_audit', execution: 'parallel',
        parallelGroup: 'audit', promptTemplate: 'audit', modelRole: 'vision', qualityGateIds: [],
      }, {
        id: 'audit:b', label: 'Audit 2', toolId: 'compliance_audit', execution: 'parallel',
        parallelGroup: 'audit', promptTemplate: 'audit', modelRole: 'vision', qualityGateIds: [],
      }],
    };

    const estimate = await estimateSkillRunCost(complianceSkill, {
      orchestrator: { providerId: 'chat-provider', modelId: 'chat-model' },
      vision: { providerId: 'vision-provider', modelId: 'vision-model' },
    }, { calculateCreditCost });

    expect(estimate).toMatchObject({ minimum: 9, maximum: 9 });
    expect(calculateCreditCost).toHaveBeenNthCalledWith(
      2, 'chat', 'vision-model', { providerId: 'vision-provider' },
    );
    expect(calculateCreditCost).toHaveBeenNthCalledWith(
      3, 'chat', 'vision-model', { providerId: 'vision-provider' },
    );
  });

  it('prices an orchestrator-role generate_image step as chat and a real image step as image_generate', async () => {
    const calculateCreditCost = vi.fn(async () => 2);
    const bindings = {
      orchestrator: { providerId: 'chat-provider', modelId: 'chat-model' },
      image: { providerId: 'image-provider', modelId: 'image-model' },
    };

    await estimateSkillRunCost(canvasSkill, bindings, { calculateCreditCost });

    expect(calculateCreditCost).toHaveBeenNthCalledWith(
      1, 'chat', bindings.orchestrator.modelId,
      { providerId: bindings.orchestrator.providerId },
    );
    expect(calculateCreditCost).toHaveBeenNthCalledWith(
      2, 'image_generate', bindings.image.modelId,
      { providerId: bindings.image.providerId },
    );
  });

  it('prices only the steps enabled by resolved input values', async () => {
    const calculateCreditCost = vi.fn(async () => 2);
    const conditional = {
      ...canvasSkill,
      inputs: [
        { key: 'count', label: 'Count', kind: 'select', required: true, options: ['2', '3'] },
      ],
      steps: [
        ...canvasSkill.steps,
        {
          id: 'optional-image', label: 'Optional', toolId: 'img2img',
          execution: 'sequential', promptTemplate: 'optional', modelRole: 'image',
          qualityGateIds: [], when: { input: 'count', includes: ['3'] },
        },
      ],
    } as SkillDefinition;
    const bindings = {
      orchestrator: { providerId: 'chat-provider', modelId: 'chat-model' },
      image: { providerId: 'image-provider', modelId: 'image-model' },
    };

    const estimate = await estimateSkillRunCost(
      conditional,
      bindings,
      { calculateCreditCost },
      { count: '2' },
    );

    expect(estimate.steps.map(step => step.stepId)).toEqual(['orchestrator', 'image']);
    expect(estimate.maximum).toBe(4);
  });
});
