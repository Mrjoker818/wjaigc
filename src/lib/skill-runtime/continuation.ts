import 'server-only';

import type { AgentDownstreamExecutionContext } from '@/lib/agent-runtime/downstream-operations';
import { agentRunRequestDigest } from '@/lib/agent-runtime/service';
import type { AgentEvent, AgentRunRequest, AgentWorkspace } from '@/lib/agent-runtime/types';
import { getCloudTaskForUser, type CloudTask } from '@/lib/cloud-task-storage';
import { listManagedUsers } from '@/lib/server-auth';
import type { User } from '@/lib/user-types';
import { requireSkillForSurface } from './catalog';
import { skillExecutionSteps } from './cost-estimator';
import { parseSkillRunRequest, executeSkillRun, SkillRunRequestError } from './service';
import { createProductionSkillStepRegistry } from './step-registry';
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
      || typeof step.modelRole !== 'string'
      || !Array.isArray(step.qualityGateIds)
      || !step.qualityGateIds.every(gate => typeof gate === 'string')
    ) return null;
    result.push({
      id: step.id,
      label: step.label,
      toolId: step.toolId,
      execution: step.execution,
      ...(typeof step.parallelGroup === 'string' ? { parallelGroup: step.parallelGroup } : {}),
      promptTemplate: step.promptTemplate,
      modelRole: step.modelRole as SkillStepDefinition['modelRole'],
      qualityGateIds: step.qualityGateIds as string[],
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
        || !['text', 'select', 'number', 'boolean', 'image', 'images', 'brand-kit', 'dataset'].includes(field.kind)) {
        throw new SkillRunRequestError('Frozen Skill input is invalid');
      }
      keys.add(field.key);
      return { key: field.key, label: field.label, kind: field.kind as SkillInputField['kind'], required: field.required };
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
  const request = parseSkillRunRequest({
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
    request.surface,
    request.skillId,
    request.skillVersion,
  );
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
  const toolId = input.nextStepId || definition.steps[0]?.id;
  if (!toolId || !definition.steps.some(step => step.id === toolId)) {
    throw new SkillRunRequestError('Persisted Skill next step is invalid');
  }
  const registry = createProductionSkillStepRegistry({ actor, request });
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
