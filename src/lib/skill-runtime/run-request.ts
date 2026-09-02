import type { AgentRunCreateResult } from '@/lib/agent-runtime/service';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import { toAgentModelCapabilitySet } from '@/lib/agent-runtime/model-capability-set';
import { readAgentPrompt } from '@/lib/agent-runtime/request-validation';
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

export interface AuthorizedSkillAgentRun {
  skill: SkillDefinition;
  modelBindings: FrozenBindings;
  orchestratorModel: TaskModelDescriptor;
}

type CreateAgentRun = (input: {
  actor: User;
  request: AgentRunRequest;
  billingQuote?: AgentRunBillingQuote;
}) => Promise<AgentRunCreateResult>;

export interface CreateSkillRunDependencies extends SkillRunRequestDependencies, SkillCostEstimatorDependencies {
  authorizeContext: typeof authorizeAgentContext;
  createAgentRun: CreateAgentRun;
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
    readonly code:
      | 'SKILL_MODEL_BINDING_REQUIRED'
      | 'SKILL_MODEL_BINDINGS_INVALID'
      | 'SKILL_MODEL_CAPABILITY_REQUIRED',
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

export function requiredSkillModelRoles(skill: SkillDefinition): SkillModelRole[] {
  const roles = new Set<SkillModelRole>(['orchestrator']);
  for (const step of skill.steps) roles.add(step.modelRole);
  return [...roles];
}

function sameStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every(value => expected.includes(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function assertExactBindingRoles(requested: FrozenBindings, skill: SkillDefinition): void {
  const actual = Object.keys(requested);
  const expected = requiredSkillModelRoles(skill);
  if (!sameStringSet(actual, expected)) {
    const missing = expected.find(role => !actual.includes(role));
    if (missing) {
      throw new SkillModelBindingError(
        'SKILL_MODEL_BINDING_REQUIRED',
        400,
        `Missing model binding for role: ${missing}`,
      );
    }
    throw new SkillModelBindingError(
      'SKILL_MODEL_BINDINGS_INVALID',
      400,
      'Skill model bindings do not match the required roles',
    );
  }
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
  return (await authorizeBindingModels(requested, skill, dependencies)).frozen;
}

async function authorizeBindingModels(
  requested: FrozenBindings,
  skill: SkillDefinition,
  dependencies: SkillRunRequestDependencies,
): Promise<{
  frozen: FrozenBindings;
  models: Partial<Record<SkillModelRole, TaskModelDescriptor>>;
}> {
  assertExactBindingRoles(requested, skill);
  const roles = requiredSkillModelRoles(skill);

  const frozen: FrozenBindings = {};
  const models: Partial<Record<SkillModelRole, TaskModelDescriptor>> = {};
  for (const role of roles) {
    const binding = requested[role]!;
    const model = await dependencies.resolveTaskModel(
      binding.providerId,
      binding.modelId,
      dependencies.actorUserId,
    );
    assertRoleCapabilities(role, model);
    frozen[role] = { providerId: model.providerId, modelId: model.modelId };
    models[role] = model;
  }
  return { frozen, models };
}

export async function authorizeSkillAgentRunRequest(
  request: AgentRunRequest,
  dependencies: SkillRunRequestDependencies,
): Promise<AuthorizedSkillAgentRun> {
  const invocation = request.skill;
  if (!invocation) {
    throw new SkillModelBindingError(
      'SKILL_MODEL_BINDINGS_INVALID',
      400,
      'Skill invocation is required',
    );
  }
  const surface: SkillSurface = request.workspace === 'chat'
    ? 'simple-chat'
    : request.workspace;
  const skill = requireSkillForSurface(invocation.skillId, surface);
  if (skill.version !== invocation.skillVersion) throw new SkillRunVersionError();

  const resolved = resolveSkillInputs(skill, invocation.inputValues);
  if (!sameJson(resolved, invocation.inputValues)) {
    throw new SkillModelBindingError(
      'SKILL_MODEL_BINDINGS_INVALID',
      400,
      'Skill input snapshot is not canonical',
    );
  }
  const prompt = readAgentPrompt(compileSkillPrompt(skill.systemPrompt, resolved));
  if (request.prompt !== prompt) {
    throw Object.assign(new Error('Skill prompt does not match the server definition'), {
      code: 'SKILL_PROMPT_MISMATCH',
      status: 400,
    });
  }
  const toolIds = [...new Set(skill.steps.map(step => step.toolId))];
  if (!sameStringSet(request.allowedToolIds, toolIds)) {
    throw Object.assign(new Error('Skill tools do not match the server definition'), {
      code: 'SKILL_TOOLS_MISMATCH',
      status: 400,
    });
  }

  const { frozen, models } = await authorizeBindingModels(
    invocation.modelBindings,
    skill,
    dependencies,
  );
  if (!sameJson(frozen, invocation.modelBindings)) {
    throw new SkillModelBindingError(
      'SKILL_MODEL_BINDINGS_INVALID',
      400,
      'Skill model bindings are not server-authorized canonical bindings',
    );
  }
  const orchestrator = frozen.orchestrator!;
  if (
    request.providerId !== orchestrator.providerId
    || request.modelId !== orchestrator.modelId
  ) {
    throw new SkillModelBindingError(
      'SKILL_MODEL_BINDINGS_INVALID',
      400,
      'Agent model does not match the Skill orchestrator binding',
    );
  }
  return {
    skill,
    modelBindings: frozen,
    orchestratorModel: models.orchestrator!,
  };
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
    prompt: readAgentPrompt(compileSkillPrompt(skill.systemPrompt, resolved)),
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
  createAgentRun: async input => (await import('@/lib/agent-runtime/service')).createAgentRun(input),
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
