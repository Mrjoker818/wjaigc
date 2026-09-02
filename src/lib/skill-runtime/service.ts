import {
  appendAgentRunEvent,
  cancelAgentRun,
  getAgentRunProjection,
  listAgentRunEvents,
  pauseAgentRun,
  resumeAgentRun,
} from '@/lib/agent-runtime/service';
import { appendAdoptedAgentEvent } from '@/lib/agent-runtime/event-storage';
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
import { skillExecutionSteps } from './cost-estimator';
import type {
  DurableSkillOutput,
  SkillModelBinding,
  SkillStepDefinition,
  SkillSurface,
} from './types';

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

export interface SkillRunStepHistory {
  id: string;
  label: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface SkillRunHistory {
  runId: string;
  skillId: string;
  skillVersion: number;
  status: AgentRunProjection['status'];
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
} | null {
  const created = events.find(event => event.type === 'run.created');
  const skill = created?.payload.skill;
  if (!skill || typeof skill !== 'object' || Array.isArray(skill)) return null;
  const candidate = skill as Record<string, unknown>;
  if (typeof candidate.skillId !== 'string' || !Number.isSafeInteger(candidate.skillVersion)) {
    return null;
  }
  return { skillId: candidate.skillId, skillVersion: Number(candidate.skillVersion) };
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

function readDurableSkillOutputs(value: unknown): DurableSkillOutput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(output => {
    if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
    const candidate = output as Record<string, unknown>;
    if (
      typeof candidate.stepId !== 'string'
      || (candidate.kind !== 'text' && candidate.kind !== 'html')
      || typeof candidate.content !== 'string'
      || !candidate.content
    ) return [];
    return [{
      stepId: candidate.stepId,
      kind: candidate.kind,
      content: candidate.content,
    }];
  });
}

function completedSkillOutputs(events: readonly AgentEvent[]): DurableSkillOutput[] {
  return events.flatMap(event => {
    if (event.type === 'tool.completed') {
      return readDurableSkillOutputs(event.payload.outputs);
    }
    if (event.type !== 'run.completed') return [];
    const result = event.payload.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
    return readDurableSkillOutputs((result as Record<string, unknown>).outputs);
  });
}

function frozenExecutionSteps(events: readonly AgentEvent[]): SkillStepDefinition[] | null {
  const snapshot = events.find(event => event.type === 'run.created')?.payload.skillSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const steps = (snapshot as Record<string, unknown>).steps;
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
      || typeof step.modelRole !== 'string'
      || !Array.isArray(step.qualityGateIds)
      || !step.qualityGateIds.every(value => typeof value === 'string')
    ) return null;
    parsed.push({
      id: step.id, label: step.label, toolId: step.toolId,
      execution: step.execution,
      ...(typeof step.parallelGroup === 'string' ? { parallelGroup: step.parallelGroup } : {}),
      promptTemplate: step.promptTemplate,
      modelRole: step.modelRole as SkillStepDefinition['modelRole'],
      qualityGateIds: step.qualityGateIds as string[],
    });
  }
  return parsed;
}

function executionStepsForRun(events: readonly AgentEvent[], invocation: {
  skillId: string;
  skillVersion: number;
}): SkillStepDefinition[] {
  const frozen = frozenExecutionSteps(events);
  if (frozen) return frozen;
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
  return {
    runId: task.id,
    ...invocation,
    status: projection.status,
    steps: steps.map(step => ({
      id: step.id,
      label: step.label,
      status: completed.has(step.id)
        ? 'completed'
        : failed.has(step.id)
          ? 'failed'
          : projection.status !== 'paused' && projection.currentStepId === step.id
            ? 'processing'
            : 'pending',
    })),
    qualityEvents: projection.qualityChecks.map(check => ({ ...check })),
    assetVersionIds: [...projection.assetVersionIds],
    outputs: mergeDurableSkillOutputs(steps, [
      ...completedSkillOutputs(events),
      ...readDurableSkillOutputs(projection.result?.outputs),
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
    async list(input: { actorUserId: string; limit?: number }): Promise<SkillRunHistory[]> {
      const limit = input.limit ?? 20;
      const tasks = await dependencies.listTasks({ userId: input.actorUserId, limit: 500 });
      const records: SkillRunHistory[] = [];
      for (const task of tasks) {
        if (task.type !== 'agent-run' || records.length >= limit) continue;
        try {
          records.push((await owned({ actorUserId: input.actorUserId, runId: task.id })).history);
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
      await dependencies.prepareResume?.({
        ...input,
        projectId: run.task.projectId || '',
        nextStepId,
      });
      return dependencies.resumeRun(input);
    },
    cancel(input: { actorUserId: string; runId: string }) {
      return dependencies.cancelRun(input);
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
        throw new SkillRunRequestError('stepId is invalid');
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
        startedStepIds: selectInitialSkillStepIds(scheduledSteps),
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
  const definition = input.definition
    || requireSkillForSurface(input.request.skillId, input.request.surface);
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
    pauseForRetry: ({ stepId, executionFence }) => pauseAgentRun({
      actorUserId: input.actor.id,
      runId: input.runId,
      nextStepId: stepId,
      pauseReason: 'execution-error',
      executionFence,
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

export async function failSkillRunExecution(input: {
  actorUserId: string;
  runId: string;
  error: unknown;
}) {
  const executionFence = input.error && typeof input.error === 'object'
    ? (input.error as { executionFence?: import('@/lib/agent-runtime/execution-fence').AgentExecutionFence }).executionFence
    : undefined;
  return appendAgentRunEvent({
    actorUserId: input.actorUserId,
    runId: input.runId,
    eventId: `skill:${input.runId}:kickoff-failed`,
    type: 'run.failed',
    payload: {
      ...(executionFence ? { generation: executionFence.generation } : {}),
      error: {
        code: 'SKILL_EXECUTION_KICKOFF_FAILED',
        message: 'Skill execution failed to start',
        retryable: true,
      },
    },
    executionFence,
  });
}

export function startSkillRunExecution(input: {
  actor: User;
  runId: string;
}): { started: true; completion: Promise<void> } {
  const completion = (async () => {
    const task = await getCloudTaskForUser(input.runId, input.actor.id);
    if (!task?.projectId) throw new SkillRunNotFoundError();
    const continuation = await (await import('./continuation')).loadPersistedSkillContinuation({
      actorUserId: input.actor.id,
      projectId: task.projectId,
      runId: input.runId,
      task,
    });
    const { executeAdoptedAgentTask } = await import('@/lib/agent-runtime/same-task-adapter');
    await executeAdoptedAgentTask({
      adoption: {
        runId: input.runId,
        reused: false,
        claimed: true,
        projection: await getAgentRunProjection({ actorUserId: input.actor.id, runId: input.runId }),
        tools: [],
        actorUserId: input.actor.id,
        projectId: task.projectId,
        workspace: continuation.workspace,
        toolId: continuation.toolId,
        requestDigest: continuation.requestDigest,
      },
      execute: continuation.execute,
    });
  })();
  return { started: true, completion };
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
