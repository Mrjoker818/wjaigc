import { describe, expect, it, vi } from 'vitest';

import type { AgentDownstreamExecutionContext } from '@/lib/agent-runtime/downstream-operations';
import { estimateSkillRunCost } from '@/lib/skill-runtime/cost-estimator';
import { createSkillExecutor, type ExecuteSkillStepInput } from '@/lib/skill-runtime/executor';
import { resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';
import { LOVART_MARKETING_SKILLS } from '@/lib/skill-runtime/marketing-presets';

function operationContext(operationKeys: string[]): AgentDownstreamExecutionContext {
  return {
    idempotencyKey: 'run-key', operationKey: 'run-operation', recovery: false,
    executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    signal: new AbortController().signal,
    beginSubmission: vi.fn(), recordAccepted: vi.fn(),
    executeOperation: vi.fn(async (step, execute) => {
      const operationKey = `operation:${step.stepId}`;
      operationKeys.push(operationKey);
      return execute({
        idempotencyKey: `provider:${step.stepId}`, operationKey, recovery: false,
        executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
        signal: new AbortController().signal,
        beginSubmission: vi.fn(), recordAccepted: vi.fn(), executeOperation: vi.fn(),
      });
    }),
  };
}

describe('Lovart marketing Skill execution', () => {
  it('uses one orchestrator followed by a parallel img2img output group', () => {
    for (const skill of LOVART_MARKETING_SKILLS) {
      expect(skill.steps[0]).toMatchObject({
        toolId: 'chat', execution: 'sequential', modelRole: 'orchestrator',
      });
      const outputs = skill.steps.slice(1);
      expect(outputs.every(step => (
        step.toolId === 'img2img'
        && step.execution === 'parallel'
        && step.parallelGroup === `${skill.id}:outputs`
        && step.modelRole === 'image'
        && step.qualityGateIds.includes('output-present')
      ))).toBe(true);
    }
  });

  it('freezes a quote for every actual marketing step', async () => {
    for (const skill of LOVART_MARKETING_SKILLS) {
      const quote = await estimateSkillRunCost(skill, {
        orchestrator: { providerId: 'chat-provider', modelId: 'chat-model' },
        image: { providerId: 'image-provider', modelId: 'image-model' },
      }, { calculateCreditCost: vi.fn(async operation => operation === 'chat' ? 1 : 3) });

      expect(quote.steps).toHaveLength(skill.steps.length);
      expect(quote.maximum).toBe(1 + (skill.steps.length - 1) * 3);
    }
  });

  it('aggregates parallel assets under independent operation keys and retries only the failed variant', async () => {
    const skill = LOVART_MARKETING_SKILLS[0];
    const inputValues = resolveSkillInputs(skill, {
      sourceImages: ['source-a', 'source-b'], campaignName: 'Launch', product: 'Headphones',
      audience: 'Commuters', sellingPoints: 'Quiet travel', objective: '购买', channel: '信息流',
    });
    const operationKeys: string[] = [];
    const executeStep = vi.fn(async ({ step }: ExecuteSkillStepInput) => {
      if (step.id === 'plan') return { assetVersionIds: [], media: [], text: 'plan' };
      return { assetVersionIds: [step.id === 'variant-a' ? 'asset-a' : 'asset-b'], media: [{}] };
    });
    const executor = createSkillExecutor({ executeStep, appendEvent: vi.fn(async () => true) });

    const run = await executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition: skill, inputValues, modelBindings: {}, operationContext: operationContext(operationKeys),
    });

    expect(new Set(operationKeys).size).toBe(operationKeys.length);
    expect(run.assetVersionIds).toEqual(['asset-a', 'asset-b']);

    executeStep.mockClear();
    await executor.execute({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      definition: skill, inputValues, modelBindings: {}, operationContext: operationContext([]),
      completedStepIds: ['plan', 'variant-a'], resumeFromStepId: 'variant-b',
      existingAssetVersionIds: ['asset-a'],
    });
    expect(executeStep.mock.calls.map(call => call[0].step.id)).toEqual(['variant-b']);
  });
});
