import 'server-only';

import type { AgentDownstreamExecutionContext } from '@/lib/agent-runtime/downstream-operations';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import { agentRunRequestDigest } from '@/lib/agent-runtime/service';
import type { AgentEvent, AgentRunRequest, AgentWorkspace } from '@/lib/agent-runtime/types';
import { getCloudTaskForUser, type CloudTask } from '@/lib/cloud-task-storage';
import { listManagedUsers } from '@/lib/server-auth';
import type { User } from '@/lib/user-types';
import { requireSkillForSurface } from './catalog';
import { skillExecutionSteps } from './cost-estimator';
import { parseSkillRunRequest, executeSkillRun, SkillRunRequestError } from './service';
import { createProductionSkillStepRegistry } from './step-registry';
import { resolveSkillInputs } from './input-resolver';
import { parseCompiledSkillFanOut } from './compiled-fan-out';
import { assertCompiledSkillFanOutValues } from './step-compiler';
import { assertSourceVersionBindings } from './run-request';
import type { SkillDefinition, SkillInputField, SkillStepDefinition, SkillSurface } from './types';
import { listAgentRunEvents } from '@/lib/agent-runtime/service';

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SkillRunRequestError(`${name} is invalid`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SkillRunRequestError(`${name} is invalid`);
  }
  return value;
}

function surfaceFromWorkspace(workspace: AgentWorkspace): SkillSurface {
  return workspace === 'chat' ? 'simple-chat' : workspace;
}

function parseFrozenSteps(value: unknown): SkillStepDefinition[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result: SkillStepDefinition[] = [];
  for (const raw of value) {
    const step = record(raw, 'skillSnapshot.steps');
    if (
      typeof step.id !== 'string'
      || typeof step.label !== 'string'
      || typeof step.toolId !== 'string'
      || (step.execution !== 'sequential' && step.execution !== 'parallel')
      || typeof step.promptTemplate !== 'string'
      || (step.promptInstructionTemplate !== undefined
        && typeof step.promptInstructionTemplate !== 'string')
      || typeof step.modelRole !== 'string'
      || !Array.isArray(step.qualityGateIds)
      || !step.qualityGateIds.every(gate => typeof gate === 'string')
    ) return null;
    let compiledFanOut: SkillStepDefinition['compiledFanOut'];
    try {
      compiledFanOut = parseCompiledSkillFanOut(step);
    } catch {
      return null;
    }
    result.push({
      id: step.id,
      label: step.label,
      toolId: step.toolId,
      execution: step.execution,
      ...(typeof step.parallelGroup === 'string' ? { parallelGroup: step.parallelGroup } : {}),
      promptTemplate: step.promptTemplate,
      ...(typeof step.promptInstructionTemplate === 'string'
        ? { promptInstructionTemplate: step.promptInstructionTemplate }
        : {}),
      modelRole: step.modelRole as SkillStepDefinition['modelRole'],
      qualityGateIds: step.qualityGateIds as string[],
      ...(compiledFanOut ? { compiledFanOut } : {}),
    });
  }
  return result;
}

export function frozenDefinition(
  snapshotValue: unknown,
  surface: SkillSurface,
  skillId: string,
  skillVersion: number,
): SkillDefinition {
  const snapshot = record(snapshotValue, 'skillSnapshot');
  if (snapshot.id !== skillId || snapshot.version !== skillVersion) {
    throw new SkillRunRequestError('Frozen Skill identity is invalid');
  }
  const steps = parseFrozenSteps(snapshot.steps);
  if (Array.isArray(snapshot.steps) && snapshot.steps.length > 0 && !steps) {
    throw new SkillRunRequestError('Frozen Skill step is invalid');
  }
  if (snapshot.executionContextVersion !== undefined && snapshot.executionContextVersion !== 1) {
    throw new SkillRunRequestError('Frozen Skill context version is unsupported');
  }
  let inputs: SkillInputField[] = [];
  if (snapshot.executionContextVersion === 1) {
    if (!steps || typeof snapshot.systemPrompt !== 'string' || !Array.isArray(snapshot.inputs)) {
      throw new SkillRunRequestError('Frozen Skill context is invalid');
    }
    const keys = new Set<string>();
    inputs = snapshot.inputs.map(raw => {
      const field = record(raw, 'skillSnapshot.inputs');
      if (typeof field.key !== 'string' || !field.key || keys.has(field.key)
        || ['__proto__', 'prototype', 'constructor'].includes(field.key)
        || typeof field.label !== 'string' || typeof field.required !== 'boolean'
        || typeof field.kind !== 'string'
        || !['text', 'select', 'multi-select', 'number', 'boolean', 'image', 'images', 'brand-kit', 'dataset'].includes(field.kind)) {
        throw new SkillRunRequestError('Frozen Skill input is invalid');
      }
      keys.add(field.key);
      if (field.options !== undefined && (
        (field.kind !== 'select' && field.kind !== 'multi-select')
        || !Array.isArray(field.options)
        || field.options.length === 0
        || field.options.some(option => typeof option !== 'string')
      )) throw new SkillRunRequestError('Frozen Skill input is invalid');
      if (field.maximumItems !== undefined && (
        (field.kind !== 'images' && field.kind !== 'multi-select' && field.kind !== 'dataset')
        || !Number.isSafeInteger(field.maximumItems)
        || (field.maximumItems as number) < 1
      )) throw new SkillRunRequestError('Frozen Skill input is invalid');
      if (field.bindToSourceVersions !== undefined && typeof field.bindToSourceVersions !== 'boolean') {
        throw new SkillRunRequestError('Frozen Skill input is invalid');
      }
      if (field.datasetSchema !== undefined && (
        field.kind !== 'dataset' || field.datasetSchema !== 'sku-v1'
      )) throw new SkillRunRequestError('Frozen Skill input is invalid');
      const parsed: SkillInputField = {
        key: field.key,
        label: field.label,
        kind: field.kind as SkillInputField['kind'],
        required: field.required,
        ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
        ...(field.options !== undefined ? { options: [...field.options as string[]] } : {}),
        ...(field.maximumItems !== undefined ? { maximumItems: field.maximumItems as number } : {}),
        ...(field.bindToSourceVersions !== undefined
          ? { bindToSourceVersions: field.bindToSourceVersions as boolean }
          : {}),
        ...(field.datasetSchema !== undefined
          ? { datasetSchema: field.datasetSchema as 'sku-v1' }
          : {}),
      };
      if (parsed.defaultValue !== undefined) {
        try {
          resolveSkillInputs({
            id: skillId, version: skillVersion, name: 'frozen', category: 'runtime', description: '',
            systemPrompt: '', allowedSurfaces: [surface], inputs: [{ ...parsed, required: false }], steps: [],
            enabled: true, builtIn: true, createdAt: 0, updatedAt: 0, usageCount: 0,
          }, {});
        } catch {
          throw new SkillRunRequestError('Frozen Skill input is invalid');
        }
      }
      return parsed;
    });
  }
  if (steps) {
    return {
      id: skillId,
      version: skillVersion,
      name: text(snapshot.name, 'skillSnapshot.name'),
      category: 'runtime',
      description: '',
      ...(snapshot.executionContextVersion === 1 ? { executionContextVersion: 1 as const } : {}),
      systemPrompt: snapshot.executionContextVersion === 1 ? snapshot.systemPrompt as string : '',
      allowedSurfaces: [surface],
      inputs,
      steps,
      enabled: true,
      builtIn: true,
      createdAt: 0,
      updatedAt: 0,
      usageCount: 0,
    };
  }
  const current = requireSkillForSurface(skillId, surface);
  if (current.version !== skillVersion) {
    throw new SkillRunRequestError('Frozen Skill definition is unavailable');
  }
  return { ...current, steps: skillExecutionSteps(current) };
}

export interface PersistedSkillContinuation {
  actor: User;
  request: ReturnType<typeof parseSkillRunRequest>;
  definition: SkillDefinition;
  workspace: AgentWorkspace;
  requestDigest: string;
  toolId: string;
  execute(context: AgentDownstreamExecutionContext): Promise<void>;
}

export async function loadPersistedSkillContinuation(input: {
  actorUserId: string;
  projectId: string;
  runId: string;
  nextStepId?: string;
  task?: CloudTask;
  events?: readonly AgentEvent[];
}): Promise<PersistedSkillContinuation> {
  const [task, events, users] = await Promise.all([
    input.task || getCloudTaskForUser(input.runId, input.actorUserId),
    input.events || listAgentRunEvents({ actorUserId: input.actorUserId, runId: input.runId }),
    listManagedUsers(),
  ]);
  const actor = users.find(user => user.id === input.actorUserId && user.status !== 'disabled');
  const created = events.find(event => event.type === 'run.created');
  if (!task || task.type !== 'agent-run' || task.projectId !== input.projectId || !actor || !created) {
    throw new SkillRunRequestError('Persisted Skill run is unavailable');
  }
  const workspace = text(created.payload.workspace, 'workspace') as AgentWorkspace;
  if (!['canvas', 'workflow', 'chat'].includes(workspace)) {
    throw new SkillRunRequestError('workspace is invalid');
  }
  const skill = record(created.payload.skill, 'skill');
  const skillId = text(skill.skillId, 'skillId');
  const skillVersion = Number(skill.skillVersion);
  const parsedRequest = parseSkillRunRequest({
    skillId,
    skillVersion,
    surface: surfaceFromWorkspace(workspace),
    projectId: input.projectId,
    workspaceId: text(created.payload.workspaceId, 'workspaceId'),
    inputValues: skill.inputValues,
    sourceVersionIds: created.payload.sourceVersionIds,
    modelBindings: skill.modelBindings,
    idempotencyKey: text(task.idempotencyKey, 'idempotencyKey'),
  });
  const definition = frozenDefinition(
    created.payload.skillSnapshot,
    parsedRequest.surface,
    parsedRequest.skillId,
    parsedRequest.skillVersion,
  );
  const inputValues = resolveSkillInputs(definition, parsedRequest.inputValues);
  assertCompiledSkillFanOutValues(definition, inputValues);
  const sourceVersionIds = assertSourceVersionBindings(
    definition,
    inputValues,
    parsedRequest.sourceVersionIds,
  );
  const request = { ...parsedRequest, inputValues, sourceVersionIds };
  const agentRequest: AgentRunRequest = {
    projectId: request.projectId,
    workspace,
    workspaceId: request.workspaceId,
    mode: 'agent',
    providerId: text(created.payload.providerId, 'providerId'),
    modelId: text(created.payload.modelId, 'modelId'),
    prompt: text(created.payload.prompt, 'prompt'),
    sourceVersionIds: request.sourceVersionIds,
    allowedToolIds: Array.isArray(created.payload.allowedToolIds)
      ? created.payload.allowedToolIds.filter((value): value is string => typeof value === 'string')
      : [],
    idempotencyKey: request.idempotencyKey,
    context: record(created.payload.context, 'context') as unknown as AgentRunRequest['context'],
    skill: {
      skillId: request.skillId,
      skillVersion: request.skillVersion,
      inputValues: request.inputValues,
      modelBindings: request.modelBindings,
    },
  };
  const requestDigest = agentRunRequestDigest(agentRequest);
  if (!task.requestDigest || task.requestDigest !== requestDigest || created.payload.requestDigest !== requestDigest) {
    throw new SkillRunRequestError('Persisted Skill request digest is invalid');
  }
  const authorizedContext = await authorizeAgentContext({
    actorUserId: actor.id,
    request: agentRequest,
  });
  const toolId = input.nextStepId || definition.steps[0]?.id;
  if (!toolId || !definition.steps.some(step => step.id === toolId)) {
    throw new SkillRunRequestError('Persisted Skill next step is invalid');
  }
  const registry = createProductionSkillStepRegistry({
    actor,
    request,
    mediaByVersionId: authorizedContext.mediaByVersionId,
  });
  return {
    actor,
    request,
    definition,
    workspace,
    requestDigest,
    toolId,
    async execute(context) {
      try {
        await executeSkillRun({
          actor,
          request,
          runId: input.runId,
          operationContext: context,
          stepAdapters: registry.stepAdapters,
          stepRecoveries: registry.stepRecoveries,
          resumeFromStepId: input.nextStepId,
          definition,
        });
      } catch (error) {
        if (error && typeof error === 'object' && context.executionFence) {
          Object.defineProperty(error, 'executionFence', {
            value: context.executionFence,
            enumerable: false,
            configurable: true,
          });
        }
        throw error;
      }
    },
  };
}
