import { createHash, randomUUID } from 'node:crypto';

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
import { abortTaskExecution } from '@/lib/task-core/task-abort';
import { transitionTask } from '@/lib/task-core/task-service';
import type { User } from '@/lib/user-types';
import { authorizeAgentContext } from './context-adapters';
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
import type {
  AgentContextSnapshot,
  AgentEvent,
  AgentEventType,
  AgentMode,
  AgentRunProjection,
  AgentRunRequest,
  AgentSkillInvocation,
  AgentWorkspace,
} from './types';

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
}

export interface AgentEventAppendResult {
  accepted: boolean;
  event: AgentEvent;
  projection: AgentRunProjection;
}

export interface AgentRunControlResult extends AgentEventAppendResult {
  leaseOwner: string;
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
    prompt: readString(input.prompt, 'prompt', 32_000),
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

function requestDigest(request: AgentRunRequest): string {
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
      const settlement = await dependencies.transitionTask({
        taskId: validated.runId,
        from: [...LIVE_TASK_STATUSES],
        to: 'completed',
        revision: run.task.revision ?? 0,
        creditStatus: 'charged',
        result: result && typeof result === 'object' && !Array.isArray(result)
          ? result as Record<string, unknown>
          : undefined,
        terminalIdentity,
      });
      if (
        !settlement.transitioned
        && (
          settlement.task.status !== 'completed'
          || settlement.task.terminalEventId !== terminalIdentity?.eventId
          || settlement.task.terminalEventDigest !== terminalIdentity?.requestDigest
          || settlement.task.terminalEventType !== terminalIdentity?.eventType
        )
      ) {
        throw new AgentRunTerminalConflictError();
      }
    } else if (requestedTerminalStatus) {
      const error = terminalError(validated.type, validated.payload);
      const settlement = await dependencies.settleFailedTask({
        taskId: validated.runId,
        status: requestedTerminalStatus,
        error,
        expectedRevision: run.task.revision ?? 0,
        terminalIdentity,
      });
      if (!settlement.transitioned) {
        const authoritative = await dependencies.getTaskForUser(
          validated.runId,
          validated.actorUserId,
        );
        if (
          authoritative?.status !== requestedTerminalStatus
          || authoritative.terminalEventId !== terminalIdentity?.eventId
          || authoritative.terminalEventDigest !== terminalIdentity?.requestDigest
          || authoritative.terminalEventType !== terminalIdentity?.eventType
        ) {
          throw new AgentRunTerminalConflictError();
        }
      }
    }

    const appended = await dependencies.appendEvent({
      actorUserId: validated.actorUserId,
      projectId: run.projectId,
      runId: validated.runId,
      eventId: validated.eventId,
      workspace: run.workspace,
      type: validated.type,
      payload: validated.payload,
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
    }): Promise<AgentRunCreateResult> {
      await dependencies.authorizeContext({
        actorUserId: input.actor.id,
        request: input.request,
      });
      const model = await dependencies.resolveTaskModel(
        input.request.providerId,
        input.request.modelId,
        input.actor.id,
      );
      const authorization = authorizeAgentTools({
        requestedToolIds: input.request.allowedToolIds,
        workspace: input.request.workspace,
        userProductTypes: userProductTypes(input.actor),
        modelCapabilities: [...toAgentModelCapabilitySet(model)],
        capabilityScope: 'orchestrator',
      });
      if (authorization.denials.length > 0) {
        throw new AgentToolAuthorizationError(authorization.denials);
      }

      const creditCost = await dependencies.calculateCreditCost(
        'agent_edit',
        input.request.modelId,
        { providerId: input.request.providerId },
      );
      const now = dependencies.now();
      const created = await dependencies.createBillableTask({
        userId: input.actor.id,
        idempotencyKey: input.request.idempotencyKey,
        requestDigest: requestDigest(input.request),
        creditCost,
        task: {
          id: dependencies.randomUUID(),
          projectId: input.request.projectId,
          type: 'agent-run',
          status: 'processing',
          providerId: input.request.providerId,
          model: input.request.modelId,
          progress: 0,
          label: 'Agent run',
          result: {
            workspace: input.request.workspace,
            workspaceId: input.request.workspaceId,
            mode: input.request.mode,
            context: input.request.context,
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
      let createdEvent: AgentEvent;
      const createdEventInput = {
        actorUserId: input.actor.id,
        projectId: input.request.projectId,
        runId,
        eventId: `agent:${runId}:created`,
        workspace: input.request.workspace,
        type: 'run.created' as const,
        payload: {
          workspace: input.request.workspace,
          workspaceId: input.request.workspaceId,
          mode: input.request.mode,
          providerId: input.request.providerId,
          modelId: input.request.modelId,
          prompt: input.request.prompt,
          sourceVersionIds: input.request.sourceVersionIds,
          allowedToolIds: authorization.tools.map(tool => tool.toolId),
          context: input.request.context,
          ...(input.request.skill ? { skill: input.request.skill } : {}),
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
        projectId: input.request.projectId,
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
    }): Promise<AgentRunControlResult> {
      const run = await ownedRun(input.actorUserId, input.runId);
      const projection = reduceAgentEvents(run.events);
      const existing = [...run.events].reverse().find(event => event.type === 'run.paused');
      if (projection.status === 'paused' && existing) {
        return { accepted: true, event: existing, projection, leaseOwner: '' };
      }
      if (TERMINAL_TASK_STATUSES.has(projection.status)) {
        throw new AgentRunTerminalError(projection.status);
      }
      const nextStepId = readString(input.nextStepId, 'nextStepId');
      const pauseCount = run.events.filter(event => event.type === 'run.paused').length + 1;
      const transitioned = await (dependencies.transitionControl || transitionAgentRunControl)({
        actorUserId: input.actorUserId,
        projectId: run.projectId,
        runId: input.runId,
        eventId: `agent:${input.runId}:paused:${pauseCount}`,
        workspace: run.workspace,
        type: 'run.paused',
        payload: { nextStepId },
        expectedRevision: run.task.revision ?? 0,
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
          return {
            accepted: true,
            event: retried.event,
            projection: reduceAgentEvents(retried.events),
            leaseOwner: retried.leaseOwner,
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
      return {
        accepted: transitioned.accepted,
        event: transitioned.event,
        projection: reduceAgentEvents(transitioned.events),
        leaseOwner: transitioned.leaseOwner,
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

export function pauseAgentRun(input: {
  actorUserId: string;
  runId: string;
  nextStepId: string;
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
