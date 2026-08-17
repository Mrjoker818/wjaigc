import type { CloudTask } from '@/lib/cloud-task-storage';
import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import type { AuthorizeAgentContextInput } from './context-adapters';
import {
  AgentDownstreamSubmissionUnknownError,
  createAgentDownstreamOperationIdentity,
  executeDurableAgentDownstreamOperation,
  type AgentDownstreamExecutionContext,
  type AgentDownstreamOperationDependencies,
  type AgentDownstreamRecovery,
} from './downstream-operations';
import {
  AgentEventPayloadError,
  assertAgentEventPayloadSafe,
  reduceAgentEvents,
} from './event-reducer';
import {
  authorizeAgentTools,
  type AuthorizedAgentTool,
} from './tool-registry';
import type {
  AgentEvent,
  AgentEventType,
  AgentRunProjection,
  AgentRunRequest,
} from './types';

const TERMINAL_TASK_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'timeout',
]);

export class SameTaskAgentRunNotFoundError extends Error {
  readonly code = 'AGENT_RUN_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Agent run not found');
    this.name = 'SameTaskAgentRunNotFoundError';
  }
}

export class AgentModelRouteMismatchError extends Error {
  readonly code = 'MODEL_ROUTE_MISMATCH';
  readonly status = 409;

  constructor() {
    super('The admitted task provider and model do not match the requested route');
    this.name = 'AgentModelRouteMismatchError';
  }
}

export class SameTaskAgentRunTerminalError extends Error {
  readonly code = 'AGENT_RUN_TERMINAL';
  readonly status = 409;

  constructor(readonly taskStatus: string) {
    super('Agent run is already terminal');
    this.name = 'SameTaskAgentRunTerminalError';
  }
}

export class SameTaskAgentRunRequestError extends Error {
  readonly code = 'AGENT_RUN_INVALID';
  readonly status = 400;

  constructor() {
    super('Agent run request contains sensitive data');
    this.name = 'SameTaskAgentRunRequestError';
  }
}

export class SameTaskAgentToolError extends Error {
  readonly code = 'AGENT_TOOL_AUTHORIZATION_DENIED';
  readonly status = 403;

  constructor(readonly denials: ReturnType<typeof authorizeAgentTools>['denials']) {
    super('Requested Agent tools are not authorized');
    this.name = 'SameTaskAgentToolError';
  }
}

export interface AppendAdoptedAgentEventInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  eventId: string;
  workspace: AgentRunRequest['workspace'];
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export interface AppendAdoptedAgentEventResult {
  event: AgentEvent;
  inserted: boolean;
}

export interface SameTaskAgentAdapterDependencies {
  getTaskForUser(taskId: string, actorUserId: string): Promise<CloudTask | null>;
  resolveTaskModel(
    providerId: string,
    modelId: string,
    actorUserId: string,
  ): Promise<TaskModelDescriptor>;
  authorizeContext(input: AuthorizeAgentContextInput): Promise<unknown>;
  appendAdoptedEvent(
    input: AppendAdoptedAgentEventInput,
  ): Promise<AppendAdoptedAgentEventResult>;
  observeTerminal(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
    workspace: AgentRunRequest['workspace'];
    toolId: string;
  }): Promise<AgentEvent[]>;
  listEvents(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
  }): Promise<AgentEvent[]>;
  claimExecution(input: {
    actorUserId: string; projectId: string; runId: string; toolId: string;
  }): Promise<{ claimed: boolean; leaseOwner: string }>;
  completeExecution(input: {
    actorUserId: string; projectId: string; runId: string; toolId: string; leaseOwner: string;
  }): Promise<boolean>;
  releaseExecution(input: {
    actorUserId: string; projectId: string; runId: string; toolId: string; leaseOwner: string;
  }): Promise<boolean>;
  downstreamOperations?: AgentDownstreamOperationDependencies;
  terminalizeSubmissionUnknown?(input: {
    taskId: string;
    actorUserId: string;
    code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN';
    message: string;
  }): Promise<boolean>;
}

export interface AdoptAndExecuteSameTaskInput<T> {
  actor: User;
  taskId: string;
  request: AgentRunRequest;
  toolId: string;
  execute: (context: AgentDownstreamExecutionContext) => Promise<T>;
  recovery?: AgentDownstreamRecovery<T>;
}

export type AdoptSameTaskInput = Omit<AdoptAndExecuteSameTaskInput<never>, 'execute' | 'recovery'>;

export interface SameTaskAgentAdoption {
  runId: string;
  reused: boolean;
  claimed: boolean;
  projection: AgentRunProjection;
  tools: AuthorizedAgentTool[];
  actorUserId: string;
  projectId: string;
  workspace: AgentRunRequest['workspace'];
  toolId: string;
  requestDigest: string;
}

export interface ExecuteSameTaskAdoptionInput<T> {
  adoption: SameTaskAgentAdoption;
  execute: (context: AgentDownstreamExecutionContext) => Promise<T>;
  recovery?: AgentDownstreamRecovery<T>;
}

export interface AdoptAndExecuteSameTaskResult<T> {
  runId: string;
  reused: boolean;
  executed: boolean;
  value?: T;
  projection: AgentRunProjection;
  tools: AuthorizedAgentTool[];
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
  if (model.supportsReferenceImages) capabilities.add('reference-images');
  if (model.sourceType === 'vlm') capabilities.add('vision');
  return [...capabilities];
}

function eventId(taskId: string, suffix: string): string {
  return `agent-adopt:${taskId}:${suffix}`;
}

export function createSameTaskAgentAdapter(
  dependencies: SameTaskAgentAdapterDependencies,
) {
  function createPassthroughContext(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
    toolId: string;
    stepId?: string;
    requestDigest: string;
  }): AgentDownstreamExecutionContext {
    const identity = createAgentDownstreamOperationIdentity(input);
    return {
      idempotencyKey: identity.idempotencyKey,
      operationKey: identity.operationKey,
      recovery: false,
      beginSubmission: async () => undefined,
      recordAccepted: async () => undefined,
      executeOperation: (step, execute) => execute(createPassthroughContext({
        actorUserId: input.actorUserId,
        projectId: input.projectId,
        runId: input.runId,
        toolId: step.toolId,
        stepId: step.stepId,
        requestDigest: step.requestDigest,
      })),
    };
  }

  async function adopt(input: AdoptSameTaskInput): Promise<SameTaskAgentAdoption> {
      const admittedTask = await dependencies.getTaskForUser(
        input.taskId,
        input.actor.id,
      );
      if (
        !admittedTask
        || !admittedTask.projectId
        || admittedTask.projectId !== input.request.projectId
      ) {
        throw new SameTaskAgentRunNotFoundError();
      }
      if (
        admittedTask.providerId !== input.request.providerId
        || admittedTask.model !== input.request.modelId
      ) {
        throw new AgentModelRouteMismatchError();
      }
      if (TERMINAL_TASK_STATUSES.has(admittedTask.status)) {
        throw new SameTaskAgentRunTerminalError(admittedTask.status);
      }
      try {
        assertAgentEventPayloadSafe(input.request as unknown as Record<string, unknown>);
      } catch (error) {
        if (error instanceof AgentEventPayloadError) {
          throw new SameTaskAgentRunRequestError();
        }
        throw error;
      }

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
      if (
        authorization.denials.length > 0
        || !authorization.tools.some(tool => tool.toolId === input.toolId)
      ) {
        throw new SameTaskAgentToolError(authorization.denials);
      }

      const eventBase = {
        actorUserId: input.actor.id,
        projectId: input.request.projectId,
        runId: input.taskId,
        workspace: input.request.workspace,
      };
      await dependencies.appendAdoptedEvent({
        ...eventBase,
        eventId: eventId(input.taskId, 'created'),
        type: 'run.created',
        payload: {
          adopted: true,
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
      await dependencies.appendAdoptedEvent({
        ...eventBase,
        eventId: eventId(input.taskId, 'plan'),
        type: 'plan.updated',
        payload: {
          plan: [{
            id: input.toolId,
            label: input.toolId,
            status: 'pending',
          }],
        },
      });
      const started = await dependencies.appendAdoptedEvent({
        ...eventBase,
        eventId: eventId(input.taskId, `tool:${input.toolId}:started`),
        type: 'tool.started',
        payload: { toolId: input.toolId },
      });

      const events = await dependencies.listEvents({
        actorUserId: input.actor.id,
        projectId: input.request.projectId,
        runId: input.taskId,
      });
      return {
        runId: input.taskId,
        reused: !started.inserted,
        claimed: true,
        projection: reduceAgentEvents(events),
        tools: authorization.tools,
        actorUserId: input.actor.id,
        projectId: input.request.projectId,
        workspace: input.request.workspace,
        toolId: input.toolId,
        requestDigest: createHash('sha256').update(JSON.stringify(input.request)).digest('hex'),
      };
  }

  async function executeAdoption<T>({
    adoption,
    execute,
    recovery,
  }: ExecuteSameTaskAdoptionInput<T>): Promise<AdoptAndExecuteSameTaskResult<T>> {
      let value: T | undefined;
      let executed = false;

      const lease = await dependencies.claimExecution({
        actorUserId: adoption.actorUserId,
        projectId: adoption.projectId,
        runId: adoption.runId,
        toolId: adoption.toolId,
      });
      if (lease.claimed) {
        const admittedTask = await dependencies.getTaskForUser(
          adoption.runId,
          adoption.actorUserId,
        );
        if (
          admittedTask
          && admittedTask.projectId === adoption.projectId
          && !TERMINAL_TASK_STATUSES.has(admittedTask.status)
        ) {
          executed = true;
          try {
            if (dependencies.downstreamOperations) {
              value = await executeDurableAgentDownstreamOperation({
                actorUserId: adoption.actorUserId,
                projectId: adoption.projectId,
                runId: adoption.runId,
                toolId: adoption.toolId,
                requestDigest: adoption.requestDigest,
              }, execute, dependencies.downstreamOperations, recovery);
            } else {
              value = await execute(createPassthroughContext({
                actorUserId: adoption.actorUserId,
                projectId: adoption.projectId,
                runId: adoption.runId,
                toolId: adoption.toolId,
                requestDigest: adoption.requestDigest,
              }));
            }
            await dependencies.completeExecution({
              actorUserId: adoption.actorUserId,
              projectId: adoption.projectId,
              runId: adoption.runId,
              toolId: adoption.toolId,
              leaseOwner: lease.leaseOwner,
            });
          } catch (error) {
            if (
              error instanceof AgentDownstreamSubmissionUnknownError
              && dependencies.terminalizeSubmissionUnknown
            ) {
              await dependencies.terminalizeSubmissionUnknown({
                taskId: adoption.runId,
                actorUserId: adoption.actorUserId,
                code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN',
                message: error.message,
              });
              await dependencies.completeExecution({
                actorUserId: adoption.actorUserId,
                projectId: adoption.projectId,
                runId: adoption.runId,
                toolId: adoption.toolId,
                leaseOwner: lease.leaseOwner,
              });
              throw error;
            }
            await dependencies.releaseExecution({
              actorUserId: adoption.actorUserId,
              projectId: adoption.projectId,
              runId: adoption.runId,
              toolId: adoption.toolId,
              leaseOwner: lease.leaseOwner,
            }).catch(() => false);
            throw error;
          }
          const terminalEvents = await dependencies.observeTerminal({
            actorUserId: adoption.actorUserId,
            projectId: adoption.projectId,
            runId: adoption.runId,
            workspace: adoption.workspace,
            toolId: adoption.toolId,
          });
          if (!terminalEvents.some(event => event.type.startsWith('run.'))) {
            await dependencies.appendAdoptedEvent({
              actorUserId: adoption.actorUserId,
              projectId: adoption.projectId,
              runId: adoption.runId,
              workspace: adoption.workspace,
              eventId: eventId(adoption.runId, `tool:${adoption.toolId}:completed`),
              type: 'tool.completed',
              payload: { toolId: adoption.toolId },
            });
          }
        }
      }

      const events = await dependencies.listEvents({
        actorUserId: adoption.actorUserId,
        projectId: adoption.projectId,
        runId: adoption.runId,
      });
      return {
        runId: adoption.runId,
        reused: adoption.reused,
        executed,
        ...(executed ? { value } : {}),
        projection: reduceAgentEvents(events),
        tools: adoption.tools,
      };
  }

  return {
    adopt,
    executeAdoption,
    async adoptAndExecute<T>(
      input: AdoptAndExecuteSameTaskInput<T>,
    ): Promise<AdoptAndExecuteSameTaskResult<T>> {
      const adoption = await adopt(input);
      return executeAdoption({ adoption, execute: input.execute, recovery: input.recovery });
    },
  };
}

let defaultSameTaskAgentAdapterPromise: Promise<ReturnType<typeof createSameTaskAgentAdapter>> | null = null;

function defaultSameTaskAgentAdapter(): Promise<ReturnType<typeof createSameTaskAgentAdapter>> {
  defaultSameTaskAgentAdapterPromise ??= Promise.all([
    import('@/lib/cloud-task-storage'),
    import('@/lib/task-core/model-catalog'),
    import('./context-adapters'),
    import('./event-storage'),
    import('@/lib/agent-task-persistence'),
  ]).then(([taskStorage, modelCatalog, contextAdapters, eventStorage, taskPersistence]) => (
    createSameTaskAgentAdapter({
    getTaskForUser: taskStorage.getCloudTaskForUser,
    resolveTaskModel: modelCatalog.resolveTaskModel,
    authorizeContext: contextAdapters.authorizeAgentContext,
    appendAdoptedEvent: eventStorage.appendAdoptedAgentEvent,
    observeTerminal: eventStorage.observeAdoptedAgentTaskTerminal,
    listEvents: eventStorage.listAgentEventsForActor,
    claimExecution: eventStorage.claimAdoptedAgentExecution,
    completeExecution: eventStorage.completeAdoptedAgentExecution,
    releaseExecution: eventStorage.releaseAdoptedAgentExecution,
    terminalizeSubmissionUnknown: async input => {
      const current = await taskStorage.getCloudTaskForUser(input.taskId, input.actorUserId);
      if (!current || TERMINAL_TASK_STATUSES.has(current.status)) return false;
      await taskPersistence.recordAgentTaskTerminal(input.taskId, {
        status: 'failed',
        code: input.code,
        error: input.message,
        retryable: false,
      });
      return true;
    },
    downstreamOperations: {
      prepare: eventStorage.prepareAgentDownstreamOperation,
      markSubmitted: eventStorage.markAgentDownstreamOperationSubmitted,
      markAccepted: eventStorage.markAgentDownstreamOperationAccepted,
      markSubmissionUnknown: eventStorage.markAgentDownstreamSubmissionUnknown,
      complete: eventStorage.completeAgentDownstreamOperation,
      read: eventStorage.getAgentDownstreamOperation,
      release: eventStorage.releaseAgentDownstreamOperation,
    },
  })));
  return defaultSameTaskAgentAdapterPromise;
}

export function adoptExistingAgentTask(
  input: AdoptSameTaskInput,
): Promise<SameTaskAgentAdoption> {
  return defaultSameTaskAgentAdapter().then(adapter => adapter.adopt(input));
}

export function executeAdoptedAgentTask<T>(
  input: ExecuteSameTaskAdoptionInput<T>,
): Promise<AdoptAndExecuteSameTaskResult<T>> {
  return defaultSameTaskAgentAdapter().then(adapter => adapter.executeAdoption(input));
}

export function adoptAndExecuteExistingAgentTask<T>(
  input: AdoptAndExecuteSameTaskInput<T>,
): Promise<AdoptAndExecuteSameTaskResult<T>> {
  return defaultSameTaskAgentAdapter().then(adapter => adapter.adoptAndExecute(input));
}
import { createHash } from 'node:crypto';
