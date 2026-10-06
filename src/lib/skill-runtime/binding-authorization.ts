import { toAgentModelCapabilitySet } from '@/lib/agent-runtime/model-capability-set';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { resolveTaskModel } from '@/lib/task-core/model-catalog';
import type { FrozenBindings } from './cost-estimator';
import { requiredSkillModelRoles, type SkillDefinition, type SkillModelBinding } from './types';

type SkillModelRole = SkillModelBinding['role'];

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

function assertExactBindingRoles(requested: FrozenBindings, skill: SkillDefinition): void {
  const actual = Object.keys(requested);
  const expected = requiredSkillModelRoles(skill);
  if (actual.length === expected.length && actual.every(role => expected.includes(role as SkillModelRole))) return;
  const missing = expected.find(role => !actual.includes(role));
  if (missing) {
    throw new SkillModelBindingError(
      'SKILL_MODEL_BINDING_REQUIRED', 400, `Missing model binding for role: ${missing}`,
    );
  }
  throw new SkillModelBindingError(
    'SKILL_MODEL_BINDINGS_INVALID', 400, 'Skill model bindings do not match the required roles',
  );
}

export async function authorizeBindingModels(
  requested: FrozenBindings,
  skill: SkillDefinition,
  dependencies: { actorUserId: string; resolveTaskModel: typeof resolveTaskModel },
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
      binding.providerId, binding.modelId, dependencies.actorUserId,
    );
    const capabilities = toAgentModelCapabilitySet(model);
    if (!roleCapabilities[role].every(capability => capabilities.has(capability))) {
      throw new SkillModelBindingError(
        'SKILL_MODEL_CAPABILITY_REQUIRED', 422, `Model does not satisfy the ${role} role`,
      );
    }
    frozen[role] = { providerId: model.providerId, modelId: model.modelId };
    models[role] = model;
  }
  return { frozen, models };
}

export async function authorizeAndFreezeBindings(
  requested: FrozenBindings,
  skill: SkillDefinition,
  dependencies: { actorUserId: string; resolveTaskModel: typeof resolveTaskModel },
): Promise<FrozenBindings> {
  return (await authorizeBindingModels(requested, skill, dependencies)).frozen;
}
