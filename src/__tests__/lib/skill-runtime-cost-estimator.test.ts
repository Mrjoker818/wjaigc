import { describe, expect, it, vi } from 'vitest';

import { estimateSkillRunCost } from '@/lib/skill-runtime/cost-estimator';
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
