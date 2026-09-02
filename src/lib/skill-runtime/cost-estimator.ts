import { calculateConfiguredCreditCost } from '@/lib/credits';
import type { CreditOperation } from '@/lib/credits';
import type { SkillDefinition, SkillModelBinding, SkillStepDefinition } from './types';

export interface FrozenModelBinding {
  providerId: string;
  modelId: string;
}

export type FrozenBindings = Partial<Record<SkillModelBinding['role'], FrozenModelBinding>>;

export interface SkillRunCostEstimate {
  minimum: number;
  maximum: number;
  steps: Array<{ stepId: string; cost: number }>;
}

export interface SkillCostEstimatorDependencies {
  calculateCreditCost: typeof calculateConfiguredCreditCost;
}

export class SkillCostEstimateError extends Error {
  readonly status = 400;

  constructor(
    readonly code: 'SKILL_MODEL_BINDING_REQUIRED' | 'SKILL_TOOL_COST_UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'SkillCostEstimateError';
  }
}

const defaultDependencies: SkillCostEstimatorDependencies = {
  calculateCreditCost: calculateConfiguredCreditCost,
};

export function toolCostType(toolId: string): CreditOperation {
  switch (toolId) {
    case 'generate_image': return 'image_generate';
    case 'edit_image': return 'image_edit';
    case 'analyze_image': return 'chat';
    case 'adjust_color': return 'image_edit';
    case 'agent_edit': return 'agent_edit';
    default:
      throw new SkillCostEstimateError(
        'SKILL_TOOL_COST_UNSUPPORTED',
        `Skill tool has no configured cost type: ${toolId}`,
      );
  }
}

export function skillExecutionSteps(skill: SkillDefinition): SkillStepDefinition[] {
  if (skill.steps.some(step => step.modelRole === 'orchestrator')) {
    return skill.steps.map(step => ({ ...step }));
  }
  return [{
    id: 'orchestrator',
    label: '智能编排',
    toolId: 'chat',
    execution: 'sequential',
    promptTemplate: skill.systemPrompt,
    modelRole: 'orchestrator',
    qualityGateIds: [],
  }, ...skill.steps.map(step => ({ ...step }))];
}

export async function estimateSkillRunCost(
  skill: SkillDefinition,
  bindings: FrozenBindings,
  dependencies: SkillCostEstimatorDependencies = defaultDependencies,
): Promise<SkillRunCostEstimate> {
  const definitions = skillExecutionSteps(skill).map(step => ({
    stepId: step.id,
    toolId: step.toolId,
    modelRole: step.modelRole,
  }));
  const steps = await Promise.all(definitions.map(async step => {
    const binding = bindings[step.modelRole];
    if (!binding) {
      throw new SkillCostEstimateError(
        'SKILL_MODEL_BINDING_REQUIRED',
        `Missing model binding for role: ${step.modelRole}`,
      );
    }
    return {
      stepId: step.stepId,
      cost: await dependencies.calculateCreditCost(
        step.toolId === 'chat' ? 'chat' : toolCostType(step.toolId),
        binding.modelId,
        { providerId: binding.providerId },
      ),
    };
  }));
  const total = steps.reduce((sum, step) => sum + step.cost, 0);
  return { minimum: total, maximum: total, steps };
}
