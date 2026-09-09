import { calculateConfiguredCreditCost } from '@/lib/credits';
import type { CreditOperation } from '@/lib/credits';
import type { SkillDefinition, SkillModelBinding, SkillStepDefinition } from './types';
import {
  compileConditionalSkillSteps,
  skillStepModelRole,
  skillStepRuntime,
} from './step-compiler';

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
    case 'generate_image':
    case 'img2img': return 'image_generate';
    case 'edit_image': return 'image_edit';
    case 'analyze_image': return 'chat';
    case 'compliance_audit': return 'chat';
    case 'adjust_color': return 'image_edit';
    case 'agent_edit': return 'agent_edit';
    default:
      throw new SkillCostEstimateError(
        'SKILL_TOOL_COST_UNSUPPORTED',
        `Skill tool has no configured cost type: ${toolId}`,
      );
  }
}

export function skillExecutionSteps(
  skill: SkillDefinition,
  inputValues: Readonly<Record<string, unknown>> = {},
): SkillStepDefinition[] {
  const compiled = compileConditionalSkillSteps(skill, inputValues);
  const hasModelSteps = skill.steps.length === 0
    || skill.steps.some(step => skillStepRuntime(step) === 'model');
  if (!hasModelSteps || compiled.some(step => skillStepModelRole(step) === 'orchestrator')) {
    return compiled;
  }
  return [{
    id: 'orchestrator',
    label: '智能编排',
    toolId: 'chat',
    execution: 'sequential',
    promptTemplate: skill.systemPrompt,
    modelRole: 'orchestrator',
    qualityGateIds: [],
  }, ...compiled];
}

export function skillStepCreditOperation(step: SkillStepDefinition): CreditOperation {
  if (skillStepModelRole(step) === 'orchestrator') return 'chat';
  return toolCostType(step.toolId);
}

export async function skillStepCreditCost(
  step: SkillStepDefinition,
  bindings: FrozenBindings,
  dependencies: SkillCostEstimatorDependencies = defaultDependencies,
): Promise<number> {
  if (skillStepRuntime(step) === 'local') return 0;
  const modelRole = skillStepModelRole(step);
  const binding = modelRole ? bindings[modelRole] : undefined;
  if (!binding) {
    throw new SkillCostEstimateError(
      'SKILL_MODEL_BINDING_REQUIRED',
      `Missing model binding for role: ${modelRole}`,
    );
  }
  return dependencies.calculateCreditCost(
    skillStepCreditOperation(step),
    binding.modelId,
    { providerId: binding.providerId },
  );
}

export async function estimateSkillRunCost(
  skill: SkillDefinition,
  bindings: FrozenBindings,
  dependencies: SkillCostEstimatorDependencies = defaultDependencies,
  inputValues: Readonly<Record<string, unknown>> = {},
): Promise<SkillRunCostEstimate> {
  const definitions = skillExecutionSteps(skill, inputValues);
  const steps = await Promise.all(definitions.map(async step => {
    return {
      stepId: step.id,
      cost: await skillStepCreditCost(step, bindings, dependencies),
    };
  }));
  const total = steps.reduce((sum, step) => sum + step.cost, 0);
  return { minimum: total, maximum: total, steps };
}
