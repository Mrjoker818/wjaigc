import {
  appendAgentRunEvent,
  cancelAgentRun,
  getAgentRunProjection,
  listAgentRunEvents,
  pauseAgentRun,
  resumeAgentRun,
} from '@/lib/agent-runtime/service';
import { appendAdoptedAgentEvent } from '@/lib/agent-runtime/event-storage';
import {
  claimAdoptedAgentExecution,
  claimResumedAgentExecutionDispatch,
  failResumedAgentExecutionDispatch,
  getRecoverableAgentExecutionDispatch,
} from '@/lib/agent-runtime/event-storage';
import type { AgentDownstreamExecutionContext } from '@/lib/agent-runtime/downstream-operations';
import type { AgentDownstreamRecovery } from '@/lib/agent-runtime/downstream-operations';
import type { AgentEvent, AgentRunProjection } from '@/lib/agent-runtime/types';
import {
  getCloudTaskForUser,
  listCloudTasks,
  type CloudTask,
  type CloudTaskCreditStatus,
} from '@/lib/cloud-task-storage';
import type { User } from '@/lib/user-types';
import { requireSkillForSurface } from './catalog';
import {
  createSkillRun as createAuthorizedSkillRun,
  type SkillRunRequest,
} from './run-request';
import {
  createSkillExecutor,
  mergeDurableSkillOutputs,
  selectInitialSkillStepIds,
  selectSkillStepsForExecution,
  type ExecuteSkillStepInput,
} from './executor';
import { parseDurableSkillOutputs } from './structured-output';
import { skillExecutionSteps } from './cost-estimator';
import { parseCompiledSkillFanOut } from './compiled-fan-out';
import { assertCompiledSkillFanOutValues } from './step-compiler';
import type {
  DurableSkillOutput,
  SkillModelBinding,
  SkillStepDefinition,
  SkillSurface,
} from './types';
import { abortTaskExecution } from '@/lib/task-core/task-abort';
import { cancelSkillPrepaidChildren } from './prepaid-generation';

export class SkillRunRequestError extends Error {
  readonly code = 'SKILL_RUN_REQUEST_INVALID';
  readonly status = 400;

  constructor(message = 'Skill run request is invalid') {
    super(message);
    this.name = 'SkillRunRequestError';
  }
}

export class SkillRunNotFoundError extends Error {
  readonly code = 'SKILL_RUN_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Skill run not found');
    this.name = 'SkillRunNotFoundError';
  }
}

export class SkillStepNotFoundError extends Error {
  readonly code = 'SKILL_STEP_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Skill step not found');
    this.name = 'SkillStepNotFoundError';
  }
}

export class SkillStepAlreadyCompletedError extends Error {
  readonly code = 'SKILL_STEP_ALREADY_COMPLETED';
  readonly status = 409;

  constructor() {
    super('Skill step is already completed');
    this.name = 'SkillStepAlreadyCompletedError';
  }
}

export interface SkillRunStepHistory {
  id: string;
  label: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
}

export interface SkillRunHistory {
  runId: string;
  projectId?: string;
  surface?: SkillSurface;
  workspaceId?: string;
  sourceVersionIds: string[];
  skillId: string;
  skillVersion: number;
  inputValues: Record<string, unknown>;
  modelBindings: SkillRunRequest['modelBindings'];
  status: AgentRunProjection['status'];
  resumeFromStepId?: string;
  steps: SkillRunStepHistory[];
  qualityEvents: Array<{ stepId: string; gateId: string; passed: boolean }>;
  assetVersionIds: string[];
  outputs: DurableSkillOutput[];
  creditStatus: CloudTaskCreditStatus;
  creditCost: number;
  createdAt: number;
  updatedAt: number;
}

export interface SkillRetryResult {
  accepted: boolean;
  startedStepIds: string[];
  scheduledStepIds: string[];
}

export type SkillStepAdapter = (input: ExecuteSkillStepInput) => Promise<import('./types').SkillStepResult>;
export type SkillStepRecoveryFactory = (
  input: Omit<ExecuteSkillStepInput, 'operation'>,
) => AgentDownstreamRecovery<import('./types').SkillStepResult>;

export class SkillStepAdapterUnavailableError extends Error {
  readonly code = 'SKILL_STEP_ADAPTER_UNAVAILABLE';
  readonly status = 503;

  constructor(readonly toolId: string) {
    super(`No durable Skill step adapter is registered for: ${toolId}`);
    this.name = 'SkillStepAdapterUnavailableError';
  }
}

export interface SkillRuntimeServiceDependencies {
  createAuthorizedSkillRun: typeof createAuthorizedSkillRun;
  getTaskForUser: typeof getCloudTaskForUser;
  listTasks: typeof listCloudTasks;
  listEvents: typeof listAgentRunEvents;
  getProjection: typeof getAgentRunProjection;
  pauseRun: typeof pauseAgentRun;
  resumeRun: typeof resumeAgentRun;
  cancelRun: typeof cancelAgentRun;
  cancelPrepaidChildren?: typeof cancelSkillPrepaidChildren;
  abortTaskExecution?: typeof abortTaskExecution;
  prepareResume?(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
    nextStepId: string;
  }): Promise<unknown>;
}

const defaultDependencies: SkillRuntimeServiceDependencies = {
  createAuthorizedSkillRun,
  getTaskForUser: getCloudTaskForUser,
  listTasks: listCloudTasks,
  listEvents: listAgentRunEvents,
  getProjection: getAgentRunProjection,
  pauseRun: pauseAgentRun,
  resumeRun: resumeAgentRun,
  cancelRun: cancelAgentRun,
  cancelPrepaidChildren: cancelSkillPrepaidChildren,
  abortTaskExecution,
  prepareResume: input => import('./continuation').then(module => (
    module.loadPersistedSkillContinuation(input)
  )),
};

const surfaces = new Set<SkillSurface>(['canvas', 'workflow', 'simple-chat']);
const roles = new Set<SkillModelBinding['role']>([
  'orchestrator', 'image', 'video', 'vision', 'edit', 'three-d',
]);

function stringValue(value: unknown, name: string, maximum = 256): string {
  if (typeof value !== 'string') throw new SkillRunRequestError(`${name} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new SkillRunRequestError(`${name} is invalid`);
  }
  return normalized;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new SkillRunRequestError(`${name} is invalid`);
  }
  return [...new Set(value.map(item => stringValue(item, name)))];
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SkillRunRequestError(`${name} is invalid`);
  }
  return value as Record<string, unknown>;
}

function assertExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  name: string,
): void {
  if (Object.keys(value).some(field => !fields.includes(field))) {
    throw new SkillRunRequestError(`${name} is invalid`);
  }
}

export function parseSkillRunRequest(value: unknown): SkillRunRequest {
  const input = objectValue(value, 'request');
  if (!Number.isSafeInteger(input.skillVersion) || Number(input.skillVersion) < 1) {
    throw new SkillRunRequestError('skillVersion is invalid');
  }
  if (!surfaces.has(input.surface as SkillSurface)) {
    throw new SkillRunRequestError('surface is invalid');
  }
  const rawBindings = objectValue(input.modelBindings, 'modelBindings');
  const modelBindings: SkillRunRequest['modelBindings'] = {};
  for (const [role, raw] of Object.entries(rawBindings)) {
    if (!roles.has(role as SkillModelBinding['role'])) {
      throw new SkillRunRequestError('modelBindings is invalid');
    }
    const binding = objectValue(raw, 'modelBindings');
    assertExactFields(binding, ['providerId', 'modelId'], 'modelBindings');
    modelBindings[role as SkillModelBinding['role']] = {
      providerId: stringValue(binding.providerId, 'providerId'),
      modelId: stringValue(binding.modelId, 'modelId'),
    };
  }
  return {
    skillId: stringValue(input.skillId, 'skillId', 128),
    skillVersion: Number(input.skillVersion),
    surface: input.surface as SkillSurface,
    projectId: stringValue(input.projectId, 'projectId'),
    workspaceId: stringValue(input.workspaceId, 'workspaceId'),
    inputValues: objectValue(input.inputValues, 'inputValues'),
    sourceVersionIds: stringArray(input.sourceVersionIds, 'sourceVersionIds'),
    modelBindings,
    idempotencyKey: stringValue(input.idempotencyKey, 'idempotencyKey'),
  };
}

function skillInvocation(events: readonly AgentEvent[]): {
  skillId: string;
  skillVersion: number;
  inputValues: Record<string, unknown>;
  modelBindings: SkillRunRequest['modelBindings'];
} | null {
  const created = events.find(event => event.type === 'run.created');
  const skill = created?.payload.skill;
  if (!skill || typeof skill !== 'object' || Array.isArray(skill)) return null;
  const candidate = skill as Record<string, unknown>;
  if (typeof candidate.skillId !== 'string' || !Number.isSafeInteger(candidate.skillVersion)) {
    return null;
  }
  const inputValues = candidate.inputValues;
  const rawBindings = candidate.modelBindings;
  if (rawBindings !== undefined && (!rawBindings || typeof rawBindings !== 'object' || Array.isArray(rawBindings))) return null;
  const modelBindings: SkillRunRequest['modelBindings'] = {};
  for (const [role, raw] of Object.entries((rawBindings || {}) as Record<string, unknown>)) {
    if (!roles.has(role as SkillModelBinding['role']) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const binding = raw as Record<string, unknown>;
    if (Object.keys(binding).some(key => key !== 'providerId' && key !== 'modelId')
      || typeof binding.providerId !== 'string' || !binding.providerId
      || typeof binding.modelId !== 'string' || !binding.modelId) return null;
    modelBindings[role as SkillModelBinding['role']] = { providerId: binding.providerId, modelId: binding.modelId };
  }
  return {
    skillId: candidate.skillId,
    skillVersion: Number(candidate.skillVersion),
    inputValues: inputValues && typeof inputValues === 'object' && !Array.isArray(inputValues)
      ? inputValues as Record<string, unknown>
      : {},
    modelBindings,
  };
}

function completedStepIds(events: readonly AgentEvent[]): Set<string> {
  return new Set(events.filter(event => event.type === 'tool.completed')
    .map(event => event.payload.stepId)
    .filter((stepId): stepId is string => typeof stepId === 'string'));
}

function completedAssetVersionIds(events: readonly AgentEvent[]): string[] {
  return [...new Set(events.filter(event => event.type === 'asset.created')
    .map(event => event.payload.assetVersionId)
    .filter((versionId): versionId is string => typeof versionId === 'string' && Boolean(versionId)))];
}

function completedSkillOutputs(events: readonly AgentEvent[]): DurableSkillOutput[] {
  return events.flatMap(event => {
    if (event.type === 'tool.completed') {
      return parseDurableSkillOutputs(event.payload.outputs);
    }
    if (event.type !== 'run.completed') return [];
    const result = event.payload.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
    return parseDurableSkillOutputs((result as Record<string, unknown>).outputs);
  });
}

function frozenExecutionSteps(events: readonly AgentEvent[]): {
  inputs: readonly unknown[];
  steps: SkillStepDefinition[];
} | null {
  const snapshot = events.find(event => event.type === 'run.created')?.payload.skillSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const snapshotRecord = snapshot as Record<string, unknown>;
  const steps = snapshotRecord.steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const parsed: SkillStepDefinition[] = [];
  for (const raw of steps) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const step = raw as Record<string, unknown>;
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
      || !step.qualityGateIds.every(value => typeof value === 'string')
    ) return null;
    let compiledFanOut: SkillStepDefinition['compiledFanOut'];
    try {
      compiledFanOut = parseCompiledSkillFanOut(step);
    } catch {
      throw new SkillRunRequestError('Frozen Skill step is invalid');
    }
    parsed.push({
      id: step.id, label: step.label, toolId: step.toolId,
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
  return {
    inputs: Array.isArray(snapshotRecord.inputs) ? snapshotRecord.inputs : [],
    steps: parsed,
  };
}

function executionStepsForRun(events: readonly AgentEvent[], invocation: {
  skillId: string;
  skillVersion: number;
  inputValues: Record<string, unknown>;
}): SkillStepDefinition[] {
  const frozen = frozenExecutionSteps(events);
  if (frozen) {
    assertCompiledSkillFanOutValues(frozen, invocation.inputValues);
    return frozen.steps;
  }
  const workspace = events.find(event => event.type === 'run.created')?.payload.workspace;
  const surface = workspace === 'chat' ? 'simple-chat' : workspace as SkillSurface;
  const current = requireSkillForSurface(invocation.skillId, surface);
  if (current.version !== invocation.skillVersion) {
    throw new SkillRunRequestError('Frozen Skill definition is unavailable');
  }
  return skillExecutionSteps(current);
}

function frozenSteps(events: readonly AgentEvent[]): Array<{ id: string; label: string }> | null {
  const snapshot = events.find(event => event.type === 'run.created')?.payload.skillSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const steps = (snapshot as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) return null;
  const parsed: Array<{ id: string; label: string }> = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
    const candidate = step as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') return null;
    parsed.push({ id: candidate.id, label: candidate.label });
  }
  return parsed;
}

function history(task: CloudTask, events: readonly AgentEvent[], projection: AgentRunProjection): SkillRunHistory {
  const invocation = skillInvocation(events);
  if (!invocation) throw new SkillRunNotFoundError();
  const created = events.find(event => event.type === 'run.created')?.payload;
  const surface = created?.workspace === 'chat' ? 'simple-chat'
    : created?.workspace === 'canvas' || created?.workspace === 'workflow' ? created.workspace : undefined;
  const snapshotSteps = frozenSteps(events);
  const steps: readonly { id: string; label: string }[] = snapshotSteps || (() => {
    const workspace = events.find(event => event.type === 'run.created')?.payload.workspace;
    const surface = workspace === 'chat' ? 'simple-chat' : workspace as SkillSurface;
    return requireSkillForSurface(invocation.skillId, surface).steps;
  })();
  const completed = completedStepIds(events);
  const failed = new Set(projection.qualityChecks
    .filter(check => !check.passed)
    .map(check => check.stepId));
  const activePause = [...events].reverse().find(event => event.type === 'run.paused');
  if (
    projection.status === 'paused'
    && projection.resumeFromStepId
    && activePause?.payload.pauseReason === 'execution-error'
  ) {
    failed.add(projection.resumeFromStepId);
  }
  const terminalFailure = [...events].reverse().find(event => event.type === 'run.failed');
  if (typeof terminalFailure?.payload.stepId === 'string') {
    failed.add(terminalFailure.payload.stepId);
  }
  const terminalStepStatusByRunStatus: Partial<Record<
    AgentRunProjection['status'],
    SkillRunStepHistory['status']
  >> = {
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
    timeout: 'timeout',
  };
  const activeTerminalStatus = terminalStepStatusByRunStatus[projection.status];
  return {
    runId: task.id,
    projectId: task.projectId,
    surface,
    sourceVersionIds: Array.isArray(created?.sourceVersionIds)
      ? created.sourceVersionIds.filter((id): id is string => typeof id === 'string' && Boolean(id)) : [],
    ...(typeof created?.workspaceId === 'string' ? { workspaceId: created.workspaceId } : {}),
    ...invocation,
    status: projection.status,
    ...(projection.resumeFromStepId ? { resumeFromStepId: projection.resumeFromStepId } : {}),
    steps: steps.map(step => ({
      id: step.id,
      label: step.label,
      status: completed.has(step.id)
        ? 'completed'
        : failed.has(step.id)
          ? 'failed'
          : projection.currentStepId === step.id
            ? activeTerminalStatus || (projection.status === 'paused' ? 'pending' : 'processing')
            : 'pending',
    })),
    qualityEvents: projection.qualityChecks.map(check => ({ ...check })),
    assetVersionIds: [...projection.assetVersionIds],
    outputs: mergeDurableSkillOutputs(steps, [
      ...completedSkillOutputs(events),
      ...parseDurableSkillOutputs(projection.result?.outputs),
    ]),
    creditStatus: task.creditStatus,
    creditCost: task.creditCost || 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function createSkillRuntimeService(
  dependencies: SkillRuntimeServiceDependencies = defaultDependencies,
) {
  async function owned(input: { actorUserId: string; runId: string }): Promise<{
    task: CloudTask;
    events: AgentEvent[];
    projection: AgentRunProjection;
    history: SkillRunHistory;
  }> {
    const task = await dependencies.getTaskForUser(input.runId, input.actorUserId);
    if (!task) throw new SkillRunNotFoundError();
    const [events, projection] = await Promise.all([
      dependencies.listEvents(input),
      dependencies.getProjection(input),
    ]);
    return { task, events, projection, history: history(task, events, projection) };
  }

  return {
    create(input: { actor: User; request: SkillRunRequest }) {
      return dependencies.createAuthorizedSkillRun(input);
    },
    async list(input: {
      actorUserId: string; limit?: number; projectId?: string;
      surface?: SkillSurface; workspaceId?: string; skillId?: string;
    }): Promise<SkillRunHistory[]> {
      const limit = input.limit ?? 20;
      const tasks = await dependencies.listTasks({
        userId: input.actorUserId, projectId: input.projectId, limit,
        skillRun: { surface: input.surface, skillId: input.skillId, workspaceId: input.workspaceId },
      });
      const records: SkillRunHistory[] = [];
      for (const task of tasks) {
        if (task.type !== 'agent-run' || records.length >= limit) continue;
        if (input.projectId !== undefined && task.projectId !== input.projectId) continue;
        try {
          const record = (await owned({ actorUserId: input.actorUserId, runId: task.id })).history;
          if (input.surface !== undefined && record.surface !== input.surface) continue;
          if (input.workspaceId !== undefined && record.workspaceId !== input.workspaceId) continue;
          if (input.skillId !== undefined && record.skillId !== input.skillId) continue;
          records.push(record);
        } catch (error) {
          if (!(error instanceof SkillRunNotFoundError)) throw error;
        }
      }
      return records;
    },
    async get(input: { actorUserId: string; runId: string }): Promise<SkillRunHistory> {
      return (await owned(input)).history;
    },
    async pause(input: { actorUserId: string; runId: string }) {
      const run = await owned(input);
      const nextStepId = run.projection.currentStepId
        || run.history.steps.find(step => step.status !== 'completed')?.id;
      if (!nextStepId) throw new SkillRunRequestError('Skill run has no resumable step');
      return dependencies.pauseRun({ ...input, nextStepId, pauseReason: 'user' });
    },
    async resume(input: { actorUserId: string; runId: string }) {
      const run = await owned(input);
      const nextStepId = run.projection.resumeFromStepId;
      if (!nextStepId) throw new SkillRunRequestError('Skill run has no persisted resume step');
      const activePause = [...run.events].reverse().find(event => event.type === 'run.paused');
      if (activePause?.payload.pauseReason === 'execution-error') {
        throw new SkillRunRequestError(
          'Execution-error pauses must be retried from the failed step',
        );
      }
      await dependencies.prepareResume?.({
        ...input,
        projectId: run.task.projectId || '',
        nextStepId,
      });
      return dependencies.resumeRun(input);
    },
    async cancel(input: { actorUserId: string; runId: string }) {
      const result = await dependencies.cancelRun(input);
      const childTaskIds = await dependencies.cancelPrepaidChildren?.(input) || [];
      for (const taskId of childTaskIds) {
        dependencies.abortTaskExecution?.(taskId, 'cancelled');
      }
      return result;
    },
    async retry(input: {
      actorUserId: string;
      runId: string;
      stepId: string;
    }): Promise<SkillRetryResult> {
      const run = await owned(input);
      const invocation = skillInvocation(run.events);
      if (!invocation) throw new SkillRunNotFoundError();
      const executionSteps = executionStepsForRun(run.events, invocation);
      if (!executionSteps.some(step => step.id === input.stepId)) {
        throw new SkillStepNotFoundError();
      }
      if (completedStepIds(run.events).has(input.stepId)) {
        throw new SkillStepAlreadyCompletedError();
      }
      if (run.projection.status !== 'paused' || run.projection.resumeFromStepId !== input.stepId) {
        throw new SkillRunRequestError('Only the persisted paused step can be retried');
      }
      await dependencies.prepareResume?.({
        actorUserId: input.actorUserId,
        projectId: run.task.projectId || '',
        runId: input.runId,
        nextStepId: input.stepId,
      });
      const resumed = await dependencies.resumeRun({
        actorUserId: input.actorUserId,
        runId: input.runId,
      });
      const scheduledSteps = selectSkillStepsForExecution({
        steps: executionSteps,
        completedStepIds: [...completedStepIds(run.events)],
        resumeFromStepId: input.stepId,
      });
      return {
        accepted: resumed.accepted,
        startedStepIds: resumed.accepted && resumed.dispatch?.started === true
          ? selectInitialSkillStepIds(scheduledSteps)
          : [],
        scheduledStepIds: scheduledSteps.map(step => step.id),
      };
    },
  };
}

export async function executeSkillRun(input: {
  actor: User;
  request: SkillRunRequest;
  runId: string;
  operationContext: AgentDownstreamExecutionContext;
  stepAdapters: Readonly<Record<string, SkillStepAdapter>>;
  stepRecoveries?: Readonly<Record<string, SkillStepRecoveryFactory>>;
  resumeFromStepId?: string;
  definition?: import('./types').SkillDefinition;
}): Promise<import('./executor').ExecuteSkillRunResult> {
  const definition = input.definition || (() => {
    const current = requireSkillForSurface(input.request.skillId, input.request.surface);
    return {
      ...current,
      steps: skillExecutionSteps(current, input.request.inputValues),
    };
  })();
  const invocation = {
    inputValues: input.request.inputValues,
    modelBindings: input.request.modelBindings,
  };
  const workspace = input.request.surface === 'simple-chat' ? 'chat' : input.request.surface;
  const events = await listAgentRunEvents({ actorUserId: input.actor.id, runId: input.runId });
  const completed = completedStepIds(events);
  const fence = input.operationContext.executionFence;
  if (!fence || fence.runId !== input.runId) {
    throw new SkillRunRequestError('A database execution lease is required');
  }
  const appendExecutionEvent = async (event: Parameters<typeof appendAdoptedAgentEvent>[0]) => (
    appendAdoptedAgentEvent(event)
  );
  const executor = createSkillExecutor({
    executeStep: stepInput => {
      const adapter = input.stepAdapters[stepInput.step.toolId];
      if (!adapter) throw new SkillStepAdapterUnavailableError(stepInput.step.toolId);
      return adapter(stepInput);
    },
    recoverStep: stepInput => input.stepRecoveries?.[stepInput.step.toolId]?.(stepInput),
    appendEvent: event => appendExecutionEvent({
      ...event,
      eventId: `${event.eventId}:generation:${fence.generation}`,
      projectId: input.request.projectId,
      workspace,
      payload: { ...event.payload, generation: fence.generation },
      executionFence: fence,
    }),
    completeRun: ({ result, executionFence }) => appendAgentRunEvent({
      actorUserId: input.actor.id,
      runId: input.runId,
      eventId: `skill:${input.runId}:generation:${executionFence.generation}:completed`,
      type: 'run.completed',
      payload: {
        generation: executionFence.generation,
        result: {
          assetVersionIds: result.assetVersionIds,
          outputs: result.outputs,
        },
      },
      executionFence,
    }),
    failRun: ({ error, executionFence }) => appendAgentRunEvent({
      actorUserId: input.actor.id,
      runId: input.runId,
      eventId: `skill:${input.runId}:generation:${executionFence.generation}:quality-failed`,
      type: 'run.failed',
      payload: {
        generation: executionFence.generation,
        stepId: error.stepId,
        error: { code: error.code, message: error.message, retryable: false },
      },
      executionFence,
    }),
    pauseForRetry: ({ stepId, executionFence, error }) => pauseAgentRun({
      actorUserId: input.actor.id,
      runId: input.runId,
      nextStepId: stepId,
      pauseReason: 'execution-error',
      error,
      executionFence,
    }),
    qualityContext: () => ({
      ...(typeof invocation.inputValues.aspectRatio === 'string'
        ? { expectedAspectRatio: invocation.inputValues.aspectRatio }
        : {}),
    }),
  });
  return executor.execute({
    actorUserId: input.actor.id,
    projectId: input.request.projectId,
    runId: input.runId,
    workspace,
    definition,
    inputValues: invocation.inputValues,
    modelBindings: invocation.modelBindings,
    operationContext: input.operationContext,
    completedStepIds: [...completed],
    resumeFromStepId: input.resumeFromStepId,
    existingAssetVersionIds: completedAssetVersionIds(events),
    existingOutputs: completedSkillOutputs(events),
  });
}

export interface SkillRunExecutionDispatchResult {
  started: boolean;
  completion?: Promise<void>;
}

export interface SkillRunExecutionDispatchDependencies {
  getTaskForUser: typeof getCloudTaskForUser;
  getRecoverableDispatch: typeof getRecoverableAgentExecutionDispatch;
  loadContinuation: typeof import('./continuation').loadPersistedSkillContinuation;
  claimExecution: typeof claimAdoptedAgentExecution;
  claimDispatch: typeof claimResumedAgentExecutionDispatch;
  getProjection: typeof getAgentRunProjection;
  executeAdopted: typeof import('@/lib/agent-runtime/same-task-adapter').executeAdoptedAgentTask;
  failDispatch: typeof failResumedAgentExecutionDispatch;
}

const defaultSkillRunExecutionDispatchDependencies: SkillRunExecutionDispatchDependencies = {
  getTaskForUser: getCloudTaskForUser,
  getRecoverableDispatch: getRecoverableAgentExecutionDispatch,
  loadContinuation: input => import('./continuation').then(module => (
    module.loadPersistedSkillContinuation(input)
  )),
  claimExecution: claimAdoptedAgentExecution,
  claimDispatch: claimResumedAgentExecutionDispatch,
  getProjection: getAgentRunProjection,
  executeAdopted: input => import('@/lib/agent-runtime/same-task-adapter').then(module => (
    module.executeAdoptedAgentTask(input)
  )),
  failDispatch: failResumedAgentExecutionDispatch,
};

export async function dispatchSkillRunExecution(input: {
  actorUserId: string;
  runId: string;
  recoveryOnly?: boolean;
}, dependencies: SkillRunExecutionDispatchDependencies = defaultSkillRunExecutionDispatchDependencies): Promise<SkillRunExecutionDispatchResult> {
  const task = await dependencies.getTaskForUser(input.runId, input.actorUserId);
  if (!task?.projectId || task.type !== 'agent-run') throw new SkillRunNotFoundError();
  if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) {
    return { started: false };
  }

  const recovery = input.recoveryOnly
    ? await dependencies.getRecoverableDispatch({
      actorUserId: input.actorUserId,
      projectId: task.projectId,
      runId: input.runId,
    })
    : null;

  const continuation = await dependencies.loadContinuation({
    actorUserId: input.actorUserId,
    projectId: task.projectId,
    runId: input.runId,
    ...(recovery?.nextStepId ? { nextStepId: recovery.nextStepId } : {}),
    task,
  });
  const execution = await dependencies.claimExecution({
    actorUserId: input.actorUserId,
    projectId: task.projectId,
    runId: input.runId,
    toolId: continuation.toolId,
    ...(recovery?.leaseOwner ? { leaseOwner: recovery.leaseOwner } : {}),
    ...(recovery ? { expectedGeneration: recovery.generation } : {}),
  });
  if (!execution.claimed || execution.generation === undefined) return { started: false };

  const dispatch = await dependencies.claimDispatch({
    actorUserId: input.actorUserId,
    projectId: task.projectId,
    runId: input.runId,
    leaseOwner: execution.leaseOwner,
    generation: execution.generation,
  });
  if (!dispatch.claimed) return { started: false };

  const persistDispatchFailure = async (error: unknown): Promise<void> => {
    try {
      await dependencies.failDispatch({
        actorUserId: input.actorUserId,
        projectId: task.projectId!,
        runId: input.runId,
        leaseOwner: execution.leaseOwner,
        generation: execution.generation!,
        dispatchLeaseOwner: dispatch.dispatchLeaseOwner,
        workspace: continuation.workspace,
        nextStepId: recovery?.nextStepId || continuation.toolId,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch (persistenceError) {
      console.error('[skill-runtime] failed to persist dispatch_error', {
        runId: input.runId,
        code: persistenceError instanceof Error ? persistenceError.name : 'UNKNOWN',
      });
    }
  };

  let executionPromise: ReturnType<SkillRunExecutionDispatchDependencies['executeAdopted']>;
  try {
    const projection = await dependencies.getProjection({
      actorUserId: input.actorUserId,
      runId: input.runId,
    });
    executionPromise = dependencies.executeAdopted({
      adoption: {
        runId: input.runId,
        reused: input.recoveryOnly === true,
        claimed: true,
        projection,
        tools: [],
        actorUserId: input.actorUserId,
        projectId: task.projectId,
        workspace: continuation.workspace,
        toolId: continuation.toolId,
        requestDigest: continuation.requestDigest,
      },
      execute: continuation.execute,
      ...(recovery?.nextStepId ? { resumeFromStepId: recovery.nextStepId } : {}),
      expectedGeneration: execution.generation,
      leaseOwner: execution.leaseOwner,
    });
  } catch (error) {
    await persistDispatchFailure(error);
    return { started: false };
  }

  const completion = executionPromise.then(() => undefined).catch(persistDispatchFailure);
  return { started: true, completion };
}

export async function recoverLiveSkillRunExecution(input: {
  actorUserId: string;
  runId: string;
  recoveryOnly?: true;
}): Promise<SkillRunExecutionDispatchResult> {
  try {
    return await dispatchSkillRunExecution({ ...input, recoveryOnly: true });
  } catch (error) {
    console.error('[skill-runtime] bounded recovery skipped', {
      runId: input.runId,
      code: error instanceof Error ? error.name : 'UNKNOWN',
    });
    return { started: false };
  }
}

const runtimeService = createSkillRuntimeService();

export const createSkillRun = runtimeService.create;
export const listSkillRuns = runtimeService.list;
export const getSkillRun = runtimeService.get;
export const pauseSkillRun = runtimeService.pause;
export const resumeSkillRun = runtimeService.resume;
export const cancelSkillRun = runtimeService.cancel;
export const retrySkillStep = runtimeService.retry;

export function skillRuntimeHttpError(error: unknown): {
  status: number;
  body: { error: { code: string; message: string } };
} {
  if (
    error
    && typeof error === 'object'
    && typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { status?: unknown }).status === 'number'
  ) {
    const known = error as { code: string; status: number; message: string };
    return { status: known.status, body: { error: { code: known.code, message: known.message } } };
  }
  return {
    status: 500,
    body: { error: { code: 'SKILL_RUN_ERROR', message: 'Skill run request failed' } },
  };
}
