import {
  createAgentRun,
  type AgentRunCreateResult,
} from '@/lib/agent-runtime/service';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import { toAgentModelCapabilitySet } from '@/lib/agent-runtime/model-capability-set';
import { calculateConfiguredCreditCost } from '@/lib/credits';
import type {
  AgentRunBillingQuote,
  AgentRunRequest,
} from '@/lib/agent-runtime/types';
import {
  resolveTaskModel,
  type TaskModelDescriptor,
} from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import { requireSkillForSurface } from './catalog';
import {
  estimateSkillRunCost,
  type FrozenBindings,
  type SkillCostEstimatorDependencies,
} from './cost-estimator';
import { resolveSkillInputs } from './input-resolver';
import { compileSkillPrompt } from './prompt-compiler';
import type {
  SkillDefinition,
  SkillModelBinding,
  SkillSurface,
} from './types';

type SkillModelRole = SkillModelBinding['role'];

export interface SkillRunRequest {
  skillId: string;
  skillVersion: number;
  surface: SkillSurface;
  projectId: string;
  workspaceId: string;
  inputValues: Record<string, unknown>;
  sourceVersionIds: string[];
  modelBindings: FrozenBindings;
  idempotencyKey: string;
}

export interface SkillRunRequestDependencies {
  actorUserId: string;
  resolveTaskModel: typeof resolveTaskModel;
}

export interface CreateSkillRunDependencies extends SkillRunRequestDependencies, SkillCostEstimatorDependencies {
  authorizeContext: typeof authorizeAgentContext;
  createAgentRun: typeof createAgentRun;
}

export class SkillRunVersionError extends Error {
  readonly code = 'SKILL_VERSION_CONFLICT';
  readonly status = 409;

  constructor() {
    super('Skill version does not match the current definition');
    this.name = 'SkillRunVersionError';
  }
}

export class SkillModelBindingError extends Error {
  constructor(
    readonly code: 'SKILL_MODEL_BINDING_REQUIRED' | 'SKILL_MODEL_CAPABILITY_REQUIRED',
    readonly status: 400 | 422,
    message: string,
  ) {
    super(message);
    this.name = 'SkillModelBindingError';
  }
}

const roleCapabilities: Record<SkillModelRole, readonly string[]> = {
  orchestrator: ['chat'],
  image: ['image'],
  video: ['video'],
  vision: ['vision'],
  edit: ['edit'],
  'three-d': ['3d'],
};

function requiredRoles(skill: SkillDefinition): SkillModelRole[] {
  const roles = new Set<SkillModelRole>(['orchestrator']);
  for (const step of skill.steps) roles.add(step.modelRole);
  return [...roles];
}

function assertRoleCapabilities(
  role: SkillModelRole,
  model: TaskModelDescriptor,
): void {
  const capabilities = toAgentModelCapabilitySet(model);
  if (!roleCapabilities[role].every(capability => capabilities.has(capability))) {
    throw new SkillModelBindingError(
      'SKILL_MODEL_CAPABILITY_REQUIRED',
      422,
      `Model does not satisfy the ${role} role`,
    );
  }
}

export async function authorizeAndFreezeBindings(
  requested: FrozenBindings,
  skill: SkillDefinition,
  dependencies: SkillRunRequestDependencies,
): Promise<FrozenBindings> {
  const roles = requiredRoles(skill);
  for (const role of roles) {
    if (!requested[role]) {
      throw new SkillModelBindingError(
        'SKILL_MODEL_BINDING_REQUIRED',
        400,
        `Missing model binding for role: ${role}`,
      );
    }
  }

  const frozen: FrozenBindings = {};
  for (const role of roles) {
    const binding = requested[role]!;
    const model = await dependencies.resolveTaskModel(
      binding.providerId,
      binding.modelId,
      dependencies.actorUserId,
    );
    assertRoleCapabilities(role, model);
    frozen[role] = { providerId: model.providerId, modelId: model.modelId };
  }
  return frozen;
}

export async function buildSkillAgentRunRequest(
  input: SkillRunRequest,
  dependencies: SkillRunRequestDependencies = {
    actorUserId: '',
    resolveTaskModel,
  },
): Promise<AgentRunRequest> {
  const skill = requireSkillForSurface(input.skillId, input.surface);
  if (skill.version !== input.skillVersion) throw new SkillRunVersionError();
  const resolved = resolveSkillInputs(skill, input.inputValues);
  const bindings = await authorizeAndFreezeBindings(
    input.modelBindings,
    skill,
    dependencies,
  );
  const orchestrator = bindings.orchestrator!;
  const sourceVersionIds = [...new Set(input.sourceVersionIds)];
  return {
    projectId: input.projectId,
    workspace: input.surface === 'simple-chat' ? 'chat' : input.surface,
    workspaceId: input.workspaceId,
    mode: 'agent',
    providerId: orchestrator.providerId,
    modelId: orchestrator.modelId,
    prompt: compileSkillPrompt(skill.systemPrompt, resolved),
    sourceVersionIds,
    allowedToolIds: [...new Set(skill.steps.map(step => step.toolId))],
    idempotencyKey: input.idempotencyKey,
    context: {
      selectedEntityIds: [],
      visibleVersionIds: sourceVersionIds,
      locale: 'zh-CN',
    },
    skill: {
      skillId: skill.id,
      skillVersion: skill.version,
      inputValues: resolved,
      modelBindings: bindings,
    },
  };
}

const defaultCreateDependencies: CreateSkillRunDependencies = {
  actorUserId: '',
  resolveTaskModel,
  calculateCreditCost: calculateConfiguredCreditCost,
  authorizeContext: authorizeAgentContext,
  createAgentRun,
};

export async function createSkillRun(
  input: { actor: User; request: SkillRunRequest },
  dependencies?: Omit<CreateSkillRunDependencies, 'actorUserId'> & { actorUserId?: string },
): Promise<AgentRunCreateResult> {
  const effective: CreateSkillRunDependencies = {
    ...defaultCreateDependencies,
    ...dependencies,
    actorUserId: input.actor.id,
  };
  const agentRequest = await buildSkillAgentRunRequest(input.request, effective);
  await effective.authorizeContext({
    actorUserId: input.actor.id,
    request: agentRequest,
  });
  const skill = requireSkillForSurface(input.request.skillId, input.request.surface);
  const estimate = await estimateSkillRunCost(
    skill,
    agentRequest.skill!.modelBindings,
    effective,
  );
  const billingQuote: AgentRunBillingQuote = {
    creditCost: estimate.maximum,
    label: skill.name,
  };
  return effective.createAgentRun({
    actor: input.actor,
    request: agentRequest,
    billingQuote,
  });
}
