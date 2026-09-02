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
});
