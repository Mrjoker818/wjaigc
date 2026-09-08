import { createHash, randomUUID } from 'node:crypto';
import { safeSkillExecutionError } from '@/lib/skill-runtime/execution-error';

import {
  getCloudTaskForUser,
  type CloudTask,
  type CloudTaskFailureStatus,
} from '@/lib/cloud-task-storage';
import { calculateConfiguredCreditCost } from '@/lib/credits';
import {
  createBillableTask,
  settleFailedTask,
} from '@/lib/task-core/billing-service';
import {
  resolveTaskModel,
} from '@/lib/task-core/model-catalog';
import { abortTaskExecution, createTaskAbortScope } from '@/lib/task-core/task-abort';
import { transitionTask } from '@/lib/task-core/task-service';
import type { User } from '@/lib/user-types';
import { estimateSkillRunCost, skillExecutionSteps } from '@/lib/skill-runtime/cost-estimator';
import { parseCompiledSkillFanOut } from '@/lib/skill-runtime/compiled-fan-out';
import { assertCompiledSkillFanOutValues } from '@/lib/skill-runtime/step-compiler';
import { authorizeSkillAgentRunRequest } from '@/lib/skill-runtime/run-request';
import { authorizeAgentContext } from './context-adapters';
import { readAgentPrompt } from './request-validation';
import {
  AgentEventConflictError,
  AgentEventNotFoundError,
  appendAgentEvent,
  listAgentEventStreamsForActor,
  listAgentEventsForActor,
  observeAdoptedAgentTaskTerminal,
  transitionAgentRunControl,
  validateAgentEventAppendInput,
} from './event-storage';
import {
  AgentEventPayloadError,
  assertAgentEventPayloadSafe,
  reduceAgentEvents,
} from './event-reducer';
import {
  authorizeAgentTools,
  type AgentToolAuthorizationResult,
  type AuthorizedAgentTool,
} from './tool-registry';
import { toAgentModelCapabilitySet } from './model-capability-set';
import {
  dispatchResumedAgentExecution,
  recordResumedAgentExecutionCompletionFailure,
  type AgentExecutionDispatchStart,
} from './execution-dispatch';
import type {
  AgentContextSnapshot,
  AgentEvent,
  AgentEventType,
  AgentMode,
  AgentRunProjection,
  AgentRunBillingQuote,
  AgentRunRequest,
  AgentSkillInvocation,
  AgentWorkspace,
} from './types';
import type { AgentExecutionFence } from './execution-fence';

const WORKSPACES = new Set<AgentWorkspace>(['canvas', 'workflow', 'chat']);
const MODES = new Set<AgentMode>(['conversation', 'vision', 'agent']);
const LIVE_TASK_STATUSES = [
  'created',
  'queued',
  'submitting',
  'processing',
  'uploading',
] as const;
type AgentTerminalTaskStatus = 'completed' | CloudTaskFailureStatus;

const TERMINAL_TASK_STATUSES = new Set<string>([
  'completed',
  'failed',
  'cancelled',
  'timeout',
]);

export class AgentRunRequestError extends Error {
  readonly code = 'AGENT_RUN_REQUEST_INVALID';
  readonly status = 400;

  constructor(message = 'Agent run request is invalid') {
    super(message);
    this.name = 'AgentRunRequestError';
  }
}

export class AgentToolAuthorizationError extends Error {
  readonly code = 'AGENT_TOOL_AUTHORIZATION_DENIED';
  readonly status = 403;

  constructor(readonly denials: AgentToolAuthorizationResult['denials']) {
    super('Requested Agent tools are not authorized');
    this.name = 'AgentToolAuthorizationError';
  }
}

export class AgentRunNotFoundError extends Error {
  readonly code = 'AGENT_RUN_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Agent run not found');
    this.name = 'AgentRunNotFoundError';
  }
}

export class AgentRunTerminalError extends Error {
  readonly code = 'AGENT_RUN_TERMINAL';
  readonly status = 409;

  constructor(readonly taskStatus: string) {
    super('Agent run is already terminal');
    this.name = 'AgentRunTerminalError';
  }
}

export class AgentRunTerminalConflictError extends Error {
  readonly code = 'AGENT_RUN_TERMINAL_CONFLICT';
  readonly status = 409;

  constructor() {
    super('Agent run terminal state conflicts with the requested event');
    this.name = 'AgentRunTerminalConflictError';
  }
}

export interface AgentRunCreateResult {
  runId: string;
  reused: boolean;
  charged: boolean;
  event: AgentEvent;
  projection: AgentRunProjection;
  tools: AuthorizedAgentTool[];
}

export interface AgentEventAppendRequest {
  actorUserId: string;
  runId: string;
  eventId: string;
  type: AgentEventType;
  payload: Record<string, unknown>;
  executionFence?: import('./execution-fence').AgentExecutionFence;
}

export interface AgentEventAppendResult {
  accepted: boolean;
  event: AgentEvent;
  projection: AgentRunProjection;
}

export interface AgentRunControlResult extends AgentEventAppendResult {
  leaseOwner: string;
  dispatch?: { started: boolean };
}

export interface AgentRunExecutionDispatchInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  workspace: AgentWorkspace;
  nextStepId: string;
  generation: number;
  leaseOwner: string;
  signal: AbortSignal;
}

interface OwnedAgentRun {
  task: CloudTask;
  projectId: string;
  workspace: AgentWorkspace;
  events: AgentEvent[];
}

export interface AgentRuntimeDependencies {
  randomUUID: () => string;
  now: () => number;
  resolveTaskModel: typeof resolveTaskModel;
  authorizeContext: typeof authorizeAgentContext;
  calculateCreditCost: typeof calculateConfiguredCreditCost;
  createBillableTask: typeof createBillableTask;
  appendEvent: typeof appendAgentEvent;
  transitionControl?: typeof transitionAgentRunControl;
  listEvents: typeof listAgentEventsForActor;
  observeAdoptedTerminal?: typeof observeAdoptedAgentTaskTerminal;
  listRunEventStreams: typeof listAgentEventStreamsForActor;
  getTaskForUser: typeof getCloudTaskForUser;
  transitionTask: typeof transitionTask;
  settleFailedTask: typeof settleFailedTask;
  abortTaskExecution: typeof abortTaskExecution;
  dispatchExecution?: (input: AgentRunExecutionDispatchInput) => Promise<AgentExecutionDispatchStart>;
  recordDispatchCompletionFailure?: (
    input: AgentRunExecutionDispatchInput,
    error: unknown,
  ) => Promise<void>;
}

const defaultDependencies: AgentRuntimeDependencies = {
  randomUUID,
  now: Date.now,
  resolveTaskModel,
  authorizeContext: authorizeAgentContext,
  calculateCreditCost: calculateConfiguredCreditCost,
  createBillableTask,
  appendEvent: appendAgentEvent,
  transitionControl: transitionAgentRunControl,
  listEvents: listAgentEventsForActor,
  observeAdoptedTerminal: observeAdoptedAgentTaskTerminal,
  listRunEventStreams: listAgentEventStreamsForActor,
  getTaskForUser: getCloudTaskForUser,
  transitionTask,
  settleFailedTask,
  abortTaskExecution,
  dispatchExecution: dispatchResumedAgentExecution,
  recordDispatchCompletionFailure: recordResumedAgentExecutionCompletionFailure,
};

function readString(
  value: unknown,
  name: string,
  maxLength = 256,
): string {
  if (typeof value !== 'string') throw new AgentRunRequestError();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AgentRunRequestError(`${name} is invalid`);
  }
  return normalized;
}

function readStringArray(
  value: unknown,
  name: string,
  maxItems = 256,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AgentRunRequestError(`${name} is invalid`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = readString(item, name);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function readOptionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : readString(value, name);
}

function readContext(value: unknown): AgentContextSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentRunRequestError('context is invalid');
  }
  const context = value as Record<string, unknown>;
  if (context.locale !== 'zh-CN' && context.locale !== 'en-US') {
    throw new AgentRunRequestError('context.locale is invalid');
  }
  return {
    selectedEntityIds: readStringArray(
      context.selectedEntityIds,
      'context.selectedEntityIds',
    ),
    visibleVersionIds: readStringArray(
      context.visibleVersionIds,
      'context.visibleVersionIds',
    ),
    workflowNodeId: readOptionalString(
      context.workflowNodeId,
      'context.workflowNodeId',
    ),
    conversationId: readOptionalString(
      context.conversationId,
      'context.conversationId',
    ),
    locale: context.locale,
  };
}

function readSkill(value: unknown): AgentSkillInvocation | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentRunRequestError('skill is invalid');
  }
  const skill = value as Record<string, unknown>;
  if (!Number.isSafeInteger(skill.skillVersion) || Number(skill.skillVersion) < 1) {
    throw new AgentRunRequestError('skill.skillVersion is invalid');
  }
  if (!skill.inputValues || typeof skill.inputValues !== 'object' || Array.isArray(skill.inputValues)) {
    throw new AgentRunRequestError('skill.inputValues is invalid');
  }
  if (!skill.modelBindings || typeof skill.modelBindings !== 'object' || Array.isArray(skill.modelBindings)) {
    throw new AgentRunRequestError('skill.modelBindings is invalid');
  }
  const modelBindings: AgentSkillInvocation['modelBindings'] = {};
  for (const [bindingId, value] of Object.entries(skill.modelBindings)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentRunRequestError('skill.modelBindings is invalid');
    }
    const binding = value as Record<string, unknown>;
    modelBindings[readString(bindingId, 'skill binding ID')] = {
      providerId: readString(binding.providerId, 'skill binding providerId'),
      modelId: readString(binding.modelId, 'skill binding modelId'),
    };
  }
  return {
    skillId: readString(skill.skillId, 'skill.skillId'),
    skillVersion: Number(skill.skillVersion),
    inputValues: skill.inputValues as Record<string, unknown>,
    modelBindings,
  };
}

export function parseAgentRunRequest(value: unknown): AgentRunRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentRunRequestError();
  }
  try {
    assertAgentEventPayloadSafe(value as Record<string, unknown>);
  } catch (error) {
    if (error instanceof AgentEventPayloadError) {
      throw new AgentRunRequestError('Agent run request contains sensitive data');
    }
    throw error;
  }
  const input = value as Record<string, unknown>;
  if (!WORKSPACES.has(input.workspace as AgentWorkspace)) {
    throw new AgentRunRequestError('workspace is invalid');
  }
  if (!MODES.has(input.mode as AgentMode)) {
    throw new AgentRunRequestError('mode is invalid');
  }
  return {
    projectId: readString(input.projectId, 'projectId'),
    workspace: input.workspace as AgentWorkspace,
    workspaceId: readString(input.workspaceId, 'workspaceId'),
    mode: input.mode as AgentMode,
    providerId: readString(input.providerId, 'providerId'),
    modelId: readString(input.modelId, 'modelId'),
    prompt: readAgentPrompt(input.prompt),
    sourceVersionIds: readStringArray(input.sourceVersionIds, 'sourceVersionIds'),
    allowedToolIds: readStringArray(input.allowedToolIds, 'allowedToolIds', 64),
    idempotencyKey: readString(input.idempotencyKey, 'idempotencyKey'),
    context: readContext(input.context),
    skill: readSkill(input.skill),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object).sort().map(key => [key, canonicalize(object[key])]),
    );
  }
  return value;
}

export function agentRunRequestDigest(request: AgentRunRequest): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(request)))
    .digest('hex');
}

function userProductTypes(user: User): string[] {
  if (user.role === 'admin') return ['canvas', 'chat', 'simple-chat'];
  return (user.productType || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function taskStatusForTerminalEvent(type: AgentEventType): AgentTerminalTaskStatus | null {
  switch (type) {
    case 'run.completed': return 'completed';
    case 'run.failed': return 'failed';
    case 'run.cancelled': return 'cancelled';
    case 'run.timeout': return 'timeout';
    default: return null;
  }
}

function acceptedEventFromProjection(
  events: readonly AgentEvent[],
  event: AgentEvent,
  projection: AgentRunProjection,
): boolean {
  return events.some(candidate => (
    candidate.eventId === event.eventId
    && candidate.sequence === event.sequence
  )) && !projection.ignoredEventIds.includes(event.eventId);
}

function projectedTerminalEvent(
  events: readonly AgentEvent[],
  projection: AgentRunProjection,
): AgentEvent | null {
  if (!TERMINAL_TASK_STATUSES.has(projection.status)) return null;
  return events.find(event => event.sequence === projection.lastSequence) || null;
}

function terminalError(
  type: AgentEventType,
  payload: Record<string, unknown>,
): { code: string; message: string; retryable: boolean } {
  const error = payload.error;
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const candidate = error as Record<string, unknown>;
    if (
      typeof candidate.code === 'string'
      && typeof candidate.message === 'string'
      && typeof candidate.retryable === 'boolean'
    ) {
      return {
        code: candidate.code,
        message: candidate.message,
        retryable: candidate.retryable,
      };
    }
  }
  return {
    code: type === 'run.cancelled'
      ? 'AGENT_RUN_CANCELLED'
      : type === 'run.timeout'
        ? 'AGENT_RUN_TIMEOUT'
        : 'AGENT_RUN_FAILED',
    message: type === 'run.cancelled'
      ? 'Agent run cancelled'
      : type === 'run.timeout'
        ? 'Agent run timed out'
        : 'Agent run failed',
    retryable: type !== 'run.cancelled',
  };
}

export function createAgentRuntimeService(
  dependencies: AgentRuntimeDependencies = defaultDependencies,
) {
  async function ownedRun(actorUserId: string, runId: string): Promise<OwnedAgentRun> {
    const task = await dependencies.getTaskForUser(runId, actorUserId);
    if (!task || !task.projectId) {
      throw new AgentRunNotFoundError();
    }
    const events = await dependencies.listEvents({
      actorUserId,
      projectId: task.projectId,
      runId,
    });
    const created = events.find(event => event.type === 'run.created');
    if (!created || (task.type !== 'agent-run' && created.payload.adopted !== true)) {
      throw new AgentRunNotFoundError();
    }
    const createdWorkspace = created.payload.workspace;
    const workspace = WORKSPACES.has(createdWorkspace as AgentWorkspace)
      ? createdWorkspace as AgentWorkspace
      : null;
    if (!workspace) throw new AgentRunNotFoundError();
    return { task, projectId: task.projectId, workspace, events };
  }

  async function listEvents(input: {
    actorUserId: string;
    runId: string;
    afterSequence?: number;
  }): Promise<AgentEvent[]> {
    const run = await ownedRun(input.actorUserId, input.runId);
    let events = run.events;
    const projection = reduceAgentEvents(events);
    if (
      run.task.type !== 'agent-run'
      && TERMINAL_TASK_STATUSES.has(run.task.status)
      && !TERMINAL_TASK_STATUSES.has(projection.status)
      && dependencies.observeAdoptedTerminal
    ) {
      const started = [...events].reverse().find(event => event.type === 'tool.started');
      const toolId = typeof started?.payload.toolId === 'string'
        ? started.payload.toolId
        : 'adopted_task';
      await dependencies.observeAdoptedTerminal({
        actorUserId: input.actorUserId,
        projectId: run.projectId,
        runId: input.runId,
        workspace: run.workspace,
        toolId,
      });
      events = await dependencies.listEvents({
        actorUserId: input.actorUserId,
        projectId: run.projectId,
        runId: input.runId,
      });
    }
    return input.afterSequence === undefined
      ? events
      : events.filter(event => event.sequence > input.afterSequence!);
  }

  async function appendEvent(
    input: AgentEventAppendRequest,
    authorizedRun?: OwnedAgentRun,
  ): Promise<AgentEventAppendResult> {
    const run = authorizedRun || await ownedRun(input.actorUserId, input.runId);
    const validated = validateAgentEventAppendInput({
      actorUserId: input.actorUserId,
      projectId: run.projectId,
      runId: input.runId,
      eventId: input.eventId,
      workspace: run.workspace,
      type: input.type,
      payload: input.payload,
      executionFence: input.executionFence,
    });
    const beforeEvents = run.events;
    const beforeProjection = reduceAgentEvents(beforeEvents);
    const existingTerminal = projectedTerminalEvent(beforeEvents, beforeProjection);
    if (existingTerminal) {
      if (existingTerminal.eventId === validated.eventId) {
        const verified = await dependencies.appendEvent({
          actorUserId: validated.actorUserId,
          projectId: run.projectId,
          runId: validated.runId,
          eventId: validated.eventId,
          workspace: run.workspace,
          type: validated.type,
          payload: validated.payload,
          executionFence: validated.executionFence,
        });
        return {
          accepted: true,
          event: verified,
          projection: beforeProjection,
        };
      }
      return {
        accepted: false,
        event: existingTerminal,
        projection: beforeProjection,
      };
    }

    if (
      beforeProjection.status === 'paused'
      && validated.type !== 'run.cancelled'
      && validated.type !== 'run.resumed'
    ) {
      const pauseEvent = [...beforeEvents].reverse().find(event => (
        event.type === 'run.paused'
      ));
      if (!pauseEvent) throw new AgentRunTerminalConflictError();
      return {
        accepted: false,
        event: pauseEvent,
        projection: beforeProjection,
      };
    }

    const requestedTerminalStatus = taskStatusForTerminalEvent(validated.type);
    const terminalIdentity = requestedTerminalStatus
      ? {
          eventId: validated.eventId,
          requestDigest: validated.requestDigest,
          eventType: validated.type,
        }
      : undefined;
    if (TERMINAL_TASK_STATUSES.has(run.task.status)) {
      if (!requestedTerminalStatus) {
        throw new AgentRunTerminalError(run.task.status);
      }
      if (requestedTerminalStatus !== run.task.status) {
        throw new AgentRunTerminalConflictError();
      }
    }
    if (requestedTerminalStatus === 'completed') {
      const result = validated.payload.result;
      let settlementTask = run.task;
      let settled = false;
      for (let attempt = 0; attempt < 8 && !settled; attempt += 1) {
        const settlement = await dependencies.transitionTask({
          taskId: validated.runId,
          from: [...LIVE_TASK_STATUSES],
          to: 'completed',
          revision: settlementTask.revision ?? 0,
          creditStatus: 'charged',
          result: result && typeof result === 'object' && !Array.isArray(result)
            ? result as Record<string, unknown>
            : undefined,
          terminalIdentity,
        });
        if (settlement.transitioned) {
          settled = true;
          break;
        }
        const authoritative = await dependencies.getTaskForUser(
          validated.runId,
          validated.actorUserId,
        );
        if (
          authoritative?.status === 'completed'
          && authoritative.terminalEventId === terminalIdentity?.eventId
          && authoritative.terminalEventDigest === terminalIdentity?.requestDigest
          && authoritative.terminalEventType === terminalIdentity?.eventType
        ) {
          settled = true;
          break;
        }
        if (!authoritative || TERMINAL_TASK_STATUSES.has(authoritative.status)) {
          throw new AgentRunTerminalConflictError();
        }
        settlementTask = authoritative;
      }
      if (!settled) throw new AgentRunTerminalConflictError();
    } else if (requestedTerminalStatus) {
      const error = terminalError(validated.type, validated.payload);
      let settlementTask = run.task;
      let settlementEvents = beforeEvents;
      let settlementProjection = beforeProjection;
      let settled = false;
      for (let attempt = 0; attempt < 8 && !settled; attempt += 1) {
        const refundCreditCost = unfinishedSkillRefundCreditCost(
          settlementEvents,
          settlementProjection.ignoredEventIds,
        );
        const settlement = await dependencies.settleFailedTask({
          taskId: validated.runId,
          status: requestedTerminalStatus,
          error,
          expectedRevision: settlementTask.revision ?? 0,
          terminalIdentity,
          ...(refundCreditCost !== undefined ? { refundCreditCost } : {}),
          ...(validated.type === 'run.cancelled' ? { allowPausedAgentSettlement: true } : {}),
        });
        if (settlement.transitioned) {
          settled = true;
          break;
        }
        const authoritative = await dependencies.getTaskForUser(
          validated.runId,
          validated.actorUserId,
        );
        if (
          authoritative?.status === requestedTerminalStatus
          && authoritative.terminalEventId === terminalIdentity?.eventId
          && authoritative.terminalEventDigest === terminalIdentity?.requestDigest
          && authoritative.terminalEventType === terminalIdentity?.eventType
        ) {
          settled = true;
          break;
        }
        if (!authoritative || TERMINAL_TASK_STATUSES.has(authoritative.status)) {
          throw new AgentRunTerminalConflictError();
        }
        settlementTask = authoritative;
        settlementEvents = await dependencies.listEvents({
          actorUserId: validated.actorUserId,
          projectId: run.projectId,
          runId: validated.runId,
        });
        settlementProjection = reduceAgentEvents(settlementEvents);
      }
      if (!settled) throw new AgentRunTerminalConflictError();
    }

    const appended = await dependencies.appendEvent({
      actorUserId: validated.actorUserId,
      projectId: run.projectId,
      runId: validated.runId,
      eventId: validated.eventId,
      workspace: run.workspace,
      type: validated.type,
      payload: validated.payload,
      executionFence: validated.executionFence,
    });
    const events = await dependencies.listEvents({
      actorUserId: validated.actorUserId,
      projectId: run.projectId,
      runId: validated.runId,
    });
    const projection = reduceAgentEvents(events);
    const accepted = acceptedEventFromProjection(events, appended, projection);
    return { accepted, event: appended, projection };
  }

  async function dispatchResumedRun(input: {
    actorUserId: string;
    run: OwnedAgentRun;
    runId: string;
    nextStepId: string;
    generation: number;
    leaseOwner: string;
  }): Promise<{ started: boolean }> {
    if (!input.leaseOwner || !dependencies.dispatchExecution) return { started: false };
    const scope = createTaskAbortScope(input.runId);
    try {
      const dispatchInput: AgentRunExecutionDispatchInput = {
        actorUserId: input.actorUserId,
        projectId: input.run.projectId,
        runId: input.runId,
        workspace: input.run.workspace,
        nextStepId: input.nextStepId,
        generation: input.generation,
        leaseOwner: input.leaseOwner,
        signal: scope.signal,
      };
      const started = await dependencies.dispatchExecution(dispatchInput);
      if (started.completion) {
        void started.completion.catch(async error => {
          if (
            error
            && typeof error === 'object'
            && (error as { dispatchFailurePersisted?: unknown }).dispatchFailurePersisted === true
          ) return;
          if (!dependencies.recordDispatchCompletionFailure) throw error;
          await dependencies.recordDispatchCompletionFailure(dispatchInput, error);
        }).catch(error => {
          console.error('[agent-runtime] failed to persist resumed execution failure', error);
        }).finally(scope.dispose);
      } else {
        scope.dispose();
      }
      return { started: started.started };
    } catch (error) {
      scope.dispose();
      throw error;
    }
  }

  return {
    async listRuns(input: {
      actorUserId: string;
      limit?: number;
    }): Promise<AgentRunProjection[]> {
      const streams = await dependencies.listRunEventStreams(input);
      return streams.map(reduceAgentEvents);
    },
    async createRun(input: {
      actor: User;
      request: AgentRunRequest;
      billingQuote?: AgentRunBillingQuote;
    }): Promise<AgentRunCreateResult> {
      const request: AgentRunRequest = {
        ...input.request,
        prompt: readAgentPrompt(input.request.prompt),
      };
      const skillAdmission = request.skill
        ? await authorizeSkillAgentRunRequest(request, {
            actorUserId: input.actor.id,
            resolveTaskModel: dependencies.resolveTaskModel,
          })
        : null;
      await dependencies.authorizeContext({
        actorUserId: input.actor.id,
        request,
      });
      const model = skillAdmission?.orchestratorModel ?? await dependencies.resolveTaskModel(
        request.providerId, request.modelId, input.actor.id,
      );
      const authorization = authorizeAgentTools({
        requestedToolIds: request.allowedToolIds,
        workspace: request.workspace,
        userProductTypes: userProductTypes(input.actor),
        modelCapabilities: [...toAgentModelCapabilitySet(model)],
        capabilityScope: 'orchestrator',
      });
      if (authorization.denials.length > 0) {
        throw new AgentToolAuthorizationError(authorization.denials);
      }

      if (
        input.billingQuote
        && (
          !Number.isSafeInteger(input.billingQuote.creditCost)
          || input.billingQuote.creditCost < 0
          || typeof input.billingQuote.label !== 'string'
          || !input.billingQuote.label.trim()
        )
      ) {
        throw new AgentRunRequestError('billingQuote is invalid');
      }
      const skillEstimate = skillAdmission
          ? await estimateSkillRunCost(
            skillAdmission.skill,
            skillAdmission.modelBindings,
            { calculateCreditCost: dependencies.calculateCreditCost },
            request.skill!.inputValues,
          )
        : null;
      const frozenSkillSteps = skillAdmission
        ? skillExecutionSteps(skillAdmission.skill, request.skill!.inputValues)
        : [];
      if (skillAdmission) {
        assertCompiledSkillFanOutValues({
          inputs: skillAdmission.skill.inputs,
          steps: frozenSkillSteps,
        }, request.skill!.inputValues);
      }
      const creditCost = skillEstimate?.maximum
        ?? input.billingQuote?.creditCost
        ?? await dependencies.calculateCreditCost(
            'agent_edit',
            request.modelId,
            { providerId: request.providerId },
          );
      const now = dependencies.now();
      const created = await dependencies.createBillableTask({
        userId: input.actor.id,
        idempotencyKey: request.idempotencyKey,
        requestDigest: agentRunRequestDigest(request),
        creditCost,
        task: {
          id: dependencies.randomUUID(),
          projectId: request.projectId,
          type: 'agent-run',
          status: 'processing',
          providerId: request.providerId,
          model: request.modelId,
          progress: 0,
          label: 'Agent run',
          result: {
            workspace: request.workspace,
            workspaceId: request.workspaceId,
            mode: request.mode,
            context: request.context,
            allowedToolIds: authorization.tools.map(tool => tool.toolId),
          },
          createdAt: now,
          updatedAt: now,
        },
      });
      const runId = created.task.id;
      if (created.reused && TERMINAL_TASK_STATUSES.has(created.task.status)) {
        throw new AgentRunTerminalError(created.task.status);
      }
      if (created.reused && skillAdmission) {
        const persistedEvents = await dependencies.listEvents({
          actorUserId: input.actor.id, projectId: request.projectId, runId,
        });
        const persistedCreated = persistedEvents.find(event => event.type === 'run.created');
        if (persistedCreated) {
          if (persistedCreated.payload.requestDigest !== agentRunRequestDigest(request)) {
            throw new AgentEventConflictError();
          }
          return {
            runId, reused: true, charged: created.charged, event: persistedCreated,
            projection: reduceAgentEvents(persistedEvents), tools: authorization.tools,
          };
        }
      }
      let createdEvent: AgentEvent;
      const skillStepCosts = new Map(
        (skillEstimate?.steps || []).map(step => [step.stepId, step.cost]),
      );
      const createdEventInput = {
        actorUserId: input.actor.id,
        projectId: request.projectId,
        runId,
        eventId: `agent:${runId}:created`,
        workspace: request.workspace,
        type: 'run.created' as const,
        payload: {
          workspace: request.workspace,
          workspaceId: request.workspaceId,
          mode: request.mode,
          providerId: request.providerId,
          modelId: request.modelId,
          prompt: request.prompt,
          sourceVersionIds: request.sourceVersionIds,
          allowedToolIds: authorization.tools.map(tool => tool.toolId),
          context: request.context,
          requestDigest: agentRunRequestDigest(request),
          ...(skillAdmission ? {
            skillSnapshot: {
              executionContextVersion: 1,
              systemPrompt: skillAdmission.skill.systemPrompt,
              inputs: skillAdmission.skill.inputs.map(field => ({
                key: field.key, label: field.label, kind: field.kind, required: field.required,
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
                ...(field.options !== undefined ? { options: [...field.options] } : {}),
                ...(field.maximumItems !== undefined ? { maximumItems: field.maximumItems } : {}),
                ...(field.uniqueItems !== undefined ? { uniqueItems: field.uniqueItems } : {}),
                ...(field.maximumLength !== undefined ? { maximumLength: field.maximumLength } : {}),
                ...(field.dependentOptions !== undefined ? {
                  dependentOptions: {
                    inputKey: field.dependentOptions.inputKey,
                    values: structuredClone(field.dependentOptions.values),
                  },
                } : {}),
                ...(field.bindToSourceVersions !== undefined
                  ? { bindToSourceVersions: field.bindToSourceVersions }
                  : {}),
                ...(field.datasetSchema !== undefined
                  ? { datasetSchema: field.datasetSchema }
                  : {}),
              })),
              id: skillAdmission.skill.id,
              version: skillAdmission.skill.version,
              name: skillAdmission.skill.name,
              steps: frozenSkillSteps.map(step => {
                const compiledFanOut = parseCompiledSkillFanOut(step as unknown as Record<string, unknown>);
                return {
                  id: step.id,
                  label: step.label,
                  toolId: step.toolId,
                  execution: step.execution,
                  ...(step.parallelGroup ? { parallelGroup: step.parallelGroup } : {}),
                  promptTemplate: step.promptTemplate,
                  ...(step.promptInstructionTemplate
                    ? { promptInstructionTemplate: step.promptInstructionTemplate }
                    : {}),
                  ...(compiledFanOut ? {
                    compiledFanOut: {
                      inputKey: compiledFanOut.inputKey,
                      itemIndex: compiledFanOut.itemIndex,
                      itemDigest: compiledFanOut.itemDigest,
                    },
                  } : {}),
                  modelRole: step.modelRole,
                  qualityGateIds: [...step.qualityGateIds],
                  ...(skillStepCosts.has(step.id) ? { cost: skillStepCosts.get(step.id) } : {}),
                };
              }),
            },
          } : {}),
          ...(request.skill ? { skill: request.skill } : {}),
        },
      };
      try {
        createdEvent = await dependencies.appendEvent(createdEventInput);
      } catch (error) {
        if (!created.reused) {
          const settlement = await dependencies.settleFailedTask({
            taskId: runId,
            status: 'failed',
            expectedRevision: created.task.revision,
            error: {
              code: 'AGENT_EVENT_STORAGE_FAILED',
              message: 'Agent run initialization failed',
              retryable: true,
            },
          });
          if (settlement.transitioned) throw error;
        }
        createdEvent = await dependencies.appendEvent(createdEventInput);
      }
      const events = await dependencies.listEvents({
        actorUserId: input.actor.id,
        projectId: request.projectId,
        runId,
      });
      return {
        runId,
        reused: created.reused,
        charged: created.charged,
        event: createdEvent,
        projection: reduceAgentEvents(events),
        tools: authorization.tools,
      };
    },
    listEvents,
    async getRun(input: {
      actorUserId: string;
      runId: string;
    }): Promise<AgentRunProjection> {
      return reduceAgentEvents(await listEvents(input));
    },
    appendEvent,
    async pauseRun(input: {
      actorUserId: string;
      runId: string;
      nextStepId: string;
      pauseReason?: 'user' | 'execution-error';
      error?: unknown;
      executionFence?: AgentExecutionFence;
    }): Promise<AgentRunControlResult> {
      const run = await ownedRun(input.actorUserId, input.runId);
      const projection = reduceAgentEvents(run.events);
      const existing = [...run.events].reverse().find(event => event.type === 'run.paused');
      if (projection.status === 'paused' && existing) {
        const nextStepId = readString(input.nextStepId, 'nextStepId');
        if (existing.payload.nextStepId !== nextStepId) {
          throw new AgentEventConflictError();
        }
        dependencies.abortTaskExecution(input.runId, 'replaced');
        return { accepted: true, event: existing, projection, leaseOwner: '' };
      }
      if (TERMINAL_TASK_STATUSES.has(projection.status)) {
        throw new AgentRunTerminalError(projection.status);
      }
      const nextStepId = readString(input.nextStepId, 'nextStepId');
      const pauseReason = input.pauseReason || 'user';
      const pauseCount = run.events.filter(event => event.type === 'run.paused').length + 1;
      const transitioned = await (dependencies.transitionControl || transitionAgentRunControl)({
        actorUserId: input.actorUserId,
        projectId: run.projectId,
        runId: input.runId,
        eventId: `agent:${input.runId}:paused:${pauseCount}`,
        workspace: run.workspace,
        type: 'run.paused',
        payload: { nextStepId, pauseReason,
          ...(pauseReason === 'execution-error' && input.error !== undefined
            ? { error: safeSkillExecutionError(input.error) } : {}),
        },
        expectedRevision: run.task.revision ?? 0,
        executionFence: input.executionFence,
      });
      const nextProjection = reduceAgentEvents(transitioned.events);
      if (transitioned.accepted && nextProjection.status === 'paused') {
        dependencies.abortTaskExecution(input.runId, 'replaced');
      }
      return {
        accepted: transitioned.accepted,
        event: transitioned.event,
        projection: nextProjection,
        leaseOwner: '',
      };
    },
    async resumeRun(input: {
      actorUserId: string;
      runId: string;
    }): Promise<AgentRunControlResult> {
      const run = await ownedRun(input.actorUserId, input.runId);
      const projection = reduceAgentEvents(run.events);
      const existing = [...run.events].reverse().find(event => event.type === 'run.resumed');
      if (projection.status !== 'paused') {
        if (existing && !TERMINAL_TASK_STATUSES.has(projection.status)) {
          const retried = await (dependencies.transitionControl || transitionAgentRunControl)({
            actorUserId: input.actorUserId,
            projectId: run.projectId,
            runId: input.runId,
            eventId: existing.eventId,
            workspace: run.workspace,
            type: 'run.resumed',
            payload: existing.payload,
            expectedRevision: run.task.revision ?? 0,
          });
          const nextStepId = readString(existing.payload.nextStepId, 'nextStepId');
          const generation = Number(existing.payload.generation);
          if (!Number.isSafeInteger(generation) || generation < 1) {
            throw new AgentRunRequestError('Persisted resume generation is invalid');
          }
          const dispatch = await dispatchResumedRun({
            actorUserId: input.actorUserId,
            run,
            runId: input.runId,
            nextStepId,
            generation,
            leaseOwner: retried.leaseOwner,
          });
          return {
            accepted: true,
            event: retried.event,
            projection: reduceAgentEvents(retried.events),
            leaseOwner: retried.leaseOwner,
            dispatch,
          };
        }
        if (TERMINAL_TASK_STATUSES.has(projection.status)) {
          throw new AgentRunTerminalError(projection.status);
        }
        throw new AgentRunRequestError('Agent run is not paused');
      }
      const nextStepId = projection.resumeFromStepId;
      if (!nextStepId) throw new AgentRunRequestError('Paused run has no next step');
      const generation = run.events.filter(event => event.type === 'run.resumed').length + 1;
      const leaseOwner = dependencies.randomUUID();
      const transitioned = await (dependencies.transitionControl || transitionAgentRunControl)({
        actorUserId: input.actorUserId,
        projectId: run.projectId,
        runId: input.runId,
        eventId: `agent:${input.runId}:resumed:${generation}`,
        workspace: run.workspace,
        type: 'run.resumed',
        payload: { nextStepId, generation },
        expectedRevision: run.task.revision ?? 0,
        leaseOwner,
      });
      const dispatch = await dispatchResumedRun({
        actorUserId: input.actorUserId,
        run,
        runId: input.runId,
        nextStepId,
        generation,
        leaseOwner: transitioned.leaseOwner,
      });
      return {
        accepted: transitioned.accepted,
        event: transitioned.event,
        projection: reduceAgentEvents(transitioned.events),
        leaseOwner: transitioned.leaseOwner,
        dispatch,
      };
    },
    async cancelRun(input: {
      actorUserId: string;
      runId: string;
    }): Promise<AgentEventAppendResult> {
      const run = await ownedRun(input.actorUserId, input.runId);
      const result = await appendEvent({
        actorUserId: input.actorUserId,
        runId: input.runId,
        eventId: `agent:${input.runId}:cancelled`,
        type: 'run.cancelled',
        payload: {
          error: {
            code: 'AGENT_RUN_CANCELLED',
            message: 'Agent run cancelled',
            retryable: false,
          },
        },
      }, run);
      dependencies.abortTaskExecution(input.runId, 'cancelled');
      return result;
    },
  };
}

const runtimeService = createAgentRuntimeService();

export function createAgentRun(input: {
  actor: User;
  request: AgentRunRequest;
  billingQuote?: AgentRunBillingQuote;
}): Promise<AgentRunCreateResult> {
  return runtimeService.createRun(input);
}

export function listCurrentUserAgentRuns(input: {
  actorUserId: string;
  limit?: number;
}): Promise<AgentRunProjection[]> {
  return runtimeService.listRuns(input);
}

export function getAgentRunProjection(input: {
  actorUserId: string;
  runId: string;
}): Promise<AgentRunProjection> {
  return runtimeService.getRun(input);
}

export function listAgentRunEvents(input: {
  actorUserId: string;
  runId: string;
  afterSequence?: number;
}): Promise<AgentEvent[]> {
  return runtimeService.listEvents(input);
}

export function appendAgentRunEvent(
  input: AgentEventAppendRequest,
): Promise<AgentEventAppendResult> {
  return runtimeService.appendEvent(input);
}

export function cancelAgentRun(input: {
  actorUserId: string;
  runId: string;
}): Promise<AgentEventAppendResult> {
  return runtimeService.cancelRun(input);
}

function unfinishedSkillRefundCreditCost(
  events: readonly AgentEvent[],
  ignoredEventIds: readonly string[],
): number | undefined {
  const ignored = new Set(ignoredEventIds);
  const created = events.find(event => event.type === 'run.created' && !ignored.has(event.eventId));
  const snapshot = created?.payload.skillSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return undefined;
  const steps = (snapshot as Record<string, unknown>).steps;
  if (!Array.isArray(steps) || steps.length === 0) return undefined;

  const costs = new Map<string, number>();
  for (const value of steps) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const step = value as Record<string, unknown>;
    if (
      typeof step.id !== 'string'
      || !step.id
      || costs.has(step.id)
      || !Number.isSafeInteger(step.cost)
      || Number(step.cost) < 0
    ) return undefined;
    costs.set(step.id, Number(step.cost));
  }

  const completed = new Set(events.filter(event => (
    event.type === 'tool.completed'
    && !ignored.has(event.eventId)
    && typeof event.payload.stepId === 'string'
  )).map(event => event.payload.stepId as string));
  const refund = [...costs].reduce((total, [stepId, cost]) => (
    completed.has(stepId) ? total : total + cost
  ), 0);
  return Number.isSafeInteger(refund) ? refund : undefined;
}

export function pauseAgentRun(input: {
  actorUserId: string;
  runId: string;
  nextStepId: string;
  pauseReason?: 'user' | 'execution-error';
  error?: unknown;
  executionFence?: AgentExecutionFence;
}): Promise<AgentRunControlResult> {
  return runtimeService.pauseRun(input);
}

export function resumeAgentRun(input: {
  actorUserId: string;
  runId: string;
}): Promise<AgentRunControlResult> {
  return runtimeService.resumeRun(input);
}

export function agentRuntimeHttpError(error: unknown): {
  status: number;
  body: { error: { code: string; message: string } };
} {
  if (
    error instanceof AgentRunRequestError
    || error instanceof AgentToolAuthorizationError
    || error instanceof AgentRunNotFoundError
    || error instanceof AgentRunTerminalError
    || error instanceof AgentRunTerminalConflictError
    || error instanceof AgentEventConflictError
    || error instanceof AgentEventNotFoundError
    || (
      error
      && typeof error === 'object'
      && typeof (error as { status?: unknown }).status === 'number'
      && typeof (error as { code?: unknown }).code === 'string'
    )
  ) {
    const known = error as { status: number; code: string; message: string };
    return {
      status: known.status,
      body: { error: { code: known.code, message: known.message } },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'AGENT_RUNTIME_ERROR',
        message: 'Agent runtime request failed',
      },
    },
  };
}
