import { createHash, randomUUID } from 'node:crypto';

import {
  getCloudTaskForUser,
  type CloudTask,
} from '@/lib/cloud-task-storage';
import { calculateConfiguredCreditCost } from '@/lib/credits';
import {
  createBillableTask,
  settleFailedTask,
} from '@/lib/task-core/billing-service';
import {
  resolveTaskModel,
  type TaskModelDescriptor,
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
import type {
  AgentContextSnapshot,
  AgentEvent,
  AgentEventType,
  AgentMode,
  AgentRunProjection,
  AgentRunRequest,
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

interface OwnedAgentRun {
  task: CloudTask;
  projectId: string;
  workspace: AgentWorkspace;
}

export interface AgentRuntimeDependencies {
  randomUUID: () => string;
  now: () => number;
  resolveTaskModel: typeof resolveTaskModel;
  authorizeContext: typeof authorizeAgentContext;
  calculateCreditCost: typeof calculateConfiguredCreditCost;
  createBillableTask: typeof createBillableTask;
  appendEvent: typeof appendAgentEvent;
  listEvents: typeof listAgentEventsForActor;
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
  listEvents: listAgentEventsForActor,
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

function modelCapabilities(model: TaskModelDescriptor): string[] {
  const capabilities = new Set<string>([model.kind]);
  if (model.kind === 'image') capabilities.add('image');
  if (model.kind === 'edit') {
    capabilities.add('image');
    capabilities.add('edit');
  }
  if (model.supportsMask) capabilities.add('edit');
  if (model.supportsReferenceImages) capabilities.add('vision');
  return [...capabilities];
}

function workspaceFromTask(task: CloudTask): AgentWorkspace | null {
  const workspace = task.result?.workspace;
  return WORKSPACES.has(workspace as AgentWorkspace)
    ? workspace as AgentWorkspace
    : null;
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
    const workspace = task ? workspaceFromTask(task) : null;
    if (!task || task.type !== 'agent-run' || !task.projectId || !workspace) {
      throw new AgentRunNotFoundError();
    }
    return { task, projectId: task.projectId, workspace };
  }

  async function listEvents(input: {
    actorUserId: string;
    runId: string;
    afterSequence?: number;
  }): Promise<AgentEvent[]> {
    const run = await ownedRun(input.actorUserId, input.runId);
    return dependencies.listEvents({
      actorUserId: input.actorUserId,
      projectId: run.projectId,
      runId: input.runId,
      afterSequence: input.afterSequence,
    });
  }

  async function appendEvent(input: AgentEventAppendRequest): Promise<AgentEventAppendResult> {
    const run = await ownedRun(input.actorUserId, input.runId);
    const appended = await dependencies.appendEvent({
      actorUserId: input.actorUserId,
      projectId: run.projectId,
      runId: input.runId,
      eventId: input.eventId,
      workspace: run.workspace,
      type: input.type,
      payload: input.payload,
    });
    const events = await dependencies.listEvents({
      actorUserId: input.actorUserId,
      projectId: run.projectId,
      runId: input.runId,
    });
    const projection = reduceAgentEvents(events);
    const accepted = projection.lastSequence === appended.sequence
      && !projection.ignoredEventIds.includes(appended.eventId);

    if (accepted && input.type === 'run.completed') {
      const result = input.payload.result;
      await dependencies.transitionTask({
        taskId: input.runId,
        from: [...LIVE_TASK_STATUSES],
        to: 'completed',
        revision: run.task.revision,
        creditStatus: 'charged',
        result: result && typeof result === 'object' && !Array.isArray(result)
          ? result as Record<string, unknown>
          : undefined,
      });
    } else if (
      accepted
      && (
        input.type === 'run.failed'
        || input.type === 'run.cancelled'
        || input.type === 'run.timeout'
      )
    ) {
      const error = terminalError(input.type, input.payload);
      await dependencies.settleFailedTask({
        taskId: input.runId,
        status: input.type === 'run.cancelled'
          ? 'cancelled'
          : input.type === 'run.timeout'
            ? 'timeout'
            : 'failed',
        error,
      });
    }
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
        modelCapabilities: modelCapabilities(model),
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
      let createdEvent: AgentEvent;
      try {
        createdEvent = await dependencies.appendEvent({
          actorUserId: input.actor.id,
          projectId: input.request.projectId,
          runId,
          eventId: `agent:${runId}:created`,
          workspace: input.request.workspace,
          type: 'run.created',
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
          },
        });
      } catch (error) {
        if (!created.reused) {
          await dependencies.settleFailedTask({
            taskId: runId,
            status: 'failed',
            error: {
              code: 'AGENT_EVENT_STORAGE_FAILED',
              message: 'Agent run initialization failed',
              retryable: true,
            },
          });
        }
        throw error;
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
    async cancelRun(input: {
      actorUserId: string;
      runId: string;
    }): Promise<AgentEventAppendResult> {
      await ownedRun(input.actorUserId, input.runId);
      dependencies.abortTaskExecution(input.runId, 'cancelled');
      return appendEvent({
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
      });
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

export function agentRuntimeHttpError(error: unknown): {
  status: number;
  body: { error: { code: string; message: string } };
} {
  if (
    error instanceof AgentRunRequestError
    || error instanceof AgentToolAuthorizationError
    || error instanceof AgentRunNotFoundError
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
