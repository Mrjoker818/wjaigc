import type { CloudTask } from '@/lib/cloud-task-storage';
import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import type { AuthorizeAgentContextInput } from './context-adapters';
import {
  AgentDownstreamProviderRejectedError,
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
import { toAgentModelCapabilitySet } from './model-capability-set';
import type {
  AgentAdmittedExecution,
  AgentEvent,
  AgentEventType,
  AgentRunProjection,
  AgentRunRequest,
} from './types';
import { withAgentExecutionFence, type AgentExecutionFence } from './execution-fence';
import type {
  AgentEditExecutionContinuationV1,
  AgentEditExecutionDescriptorV1,
} from './agent-edit-execution-descriptor';
import { AgentModelRouteMismatchError } from './model-route-error';
import { createTaskAbortScope } from '@/lib/task-core/task-abort';

export { AgentModelRouteMismatchError } from './model-route-error';

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
  executionFence?: AgentExecutionFence;
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
    leaseOwner?: string;
    generation?: number;
  }): Promise<AgentEvent[]>;
  listEvents(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
  }): Promise<AgentEvent[]>;
  claimExecution(input: {
    actorUserId: string; projectId: string; runId: string; toolId: string;
    leaseOwner?: string; expectedGeneration?: number;
  }): Promise<{ claimed: boolean; leaseOwner: string; generation?: number }>;
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
  terminalizeProviderRejection?(input: {
    taskId: string;
    actorUserId: string;
    code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED';
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
  resumeExecution?: AgentAdmittedExecution;
  agentEditContinuation?: AgentEditExecutionContinuationV1;
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
  resumeFromStepId?: string;
  expectedGeneration?: number;
  leaseOwner?: string;
  signal?: AbortSignal;
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
    executionFence: AgentExecutionFence;
  }): AgentDownstreamExecutionContext {
    const identity = createAgentDownstreamOperationIdentity(input);
    return {
      idempotencyKey: identity.idempotencyKey,
      operationKey: identity.operationKey,
      recovery: false,
      executionFence: identity.executionFence,
      beginSubmission: async () => undefined,
      recordAccepted: async () => undefined,
      executeOperation: (step, execute) => execute(createPassthroughContext({
        actorUserId: input.actorUserId,
        projectId: input.projectId,
        runId: input.runId,
        toolId: step.toolId,
        stepId: step.stepId,
        requestDigest: step.requestDigest,
        executionFence: input.executionFence,
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
        modelCapabilities: [...toAgentModelCapabilitySet(model)],
        capabilityScope: 'downstream',
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
      const created = await dependencies.appendAdoptedEvent({
        ...eventBase,
        eventId: eventId(input.taskId, 'created'),
        type: 'run.created',
        payload: input.agentEditContinuation ? {
          adopted: true,
          workspace: input.request.workspace,
          rootToolId: 'agent_edit',
          continuation: input.agentEditContinuation,
          requestDigest: input.agentEditContinuation.descriptorDigest,
        } : {
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
          requestDigest: createHash('sha256').update(JSON.stringify(input.request)).digest('hex'),
          ...(input.resumeExecution ? { resumeExecution: input.resumeExecution } : {}),
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
      const events = await dependencies.listEvents({
        actorUserId: input.actor.id,
        projectId: input.request.projectId,
        runId: input.taskId,
      });
      return {
        runId: input.taskId,
        reused: !created.inserted,
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
    resumeFromStepId,
    expectedGeneration,
    leaseOwner,
    signal,
  }: ExecuteSameTaskAdoptionInput<T>): Promise<AdoptAndExecuteSameTaskResult<T>> {
      let value: T | undefined;
      let executed = false;

      const lease = await dependencies.claimExecution({
        actorUserId: adoption.actorUserId,
        projectId: adoption.projectId,
        runId: adoption.runId,
        toolId: adoption.toolId,
        leaseOwner,
        expectedGeneration,
      });
      const claimedGenerationIsValid = lease.generation !== undefined
        && Number.isSafeInteger(lease.generation)
        && lease.generation >= 0;
      if (lease.claimed && (
        !claimedGenerationIsValid
        || (expectedGeneration !== undefined && lease.generation !== expectedGeneration)
      )) {
        await dependencies.releaseExecution({
          actorUserId: adoption.actorUserId,
          projectId: adoption.projectId,
          runId: adoption.runId,
          toolId: adoption.toolId,
          leaseOwner: lease.leaseOwner,
        }).catch(() => false);
      }
      if (
        lease.claimed
        && claimedGenerationIsValid
        && (expectedGeneration === undefined || lease.generation === expectedGeneration)
      ) {
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
          const executionGeneration = lease.generation!;
          const executionFence = {
            runId: adoption.runId,
            leaseOwner: lease.leaseOwner,
            generation: executionGeneration,
          };
          const initialScope = signal ? undefined : createTaskAbortScope(adoption.runId);
          const executionSignal = signal ?? initialScope!.signal;
          try {
            try {
              if (expectedGeneration === undefined) {
                await dependencies.appendAdoptedEvent({
                  actorUserId: adoption.actorUserId,
                  projectId: adoption.projectId,
                  runId: adoption.runId,
                  workspace: adoption.workspace,
                  eventId: eventId(adoption.runId, `tool:${adoption.toolId}:started`),
                  type: 'tool.started',
                  payload: { toolId: adoption.toolId, generation: executionGeneration },
                  executionFence,
                });
              }
              if (dependencies.downstreamOperations) {
                const downstreamOperations = dependencies.downstreamOperations;
                value = await withAgentExecutionFence({
                  ...executionFence,
                }, () => executeDurableAgentDownstreamOperation({
                  actorUserId: adoption.actorUserId,
                  projectId: adoption.projectId,
                  runId: adoption.runId,
                  toolId: adoption.toolId,
                  requestDigest: adoption.requestDigest,
                  executionFence,
                }, context => execute({
                  ...context,
                  ...(resumeFromStepId ? { resumeFromStepId } : {}),
                  executionFence,
                  signal: executionSignal,
                }), downstreamOperations, recovery));
              } else {
                value = await withAgentExecutionFence(executionFence, () => execute({
                  ...createPassthroughContext({
                    actorUserId: adoption.actorUserId,
                    projectId: adoption.projectId,
                    runId: adoption.runId,
                    toolId: adoption.toolId,
                    requestDigest: adoption.requestDigest,
                    executionFence,
                  }),
                  ...(resumeFromStepId ? { resumeFromStepId } : {}),
                  executionFence,
                  signal: executionSignal,
                }));
              }
            } catch (error) {
              if (
                error instanceof AgentDownstreamProviderRejectedError
                && dependencies.terminalizeProviderRejection
              ) {
                await withAgentExecutionFence(executionFence, () => (
                  dependencies.terminalizeProviderRejection!({
                    taskId: adoption.runId,
                    actorUserId: adoption.actorUserId,
                    code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED',
                    message: error.message,
                  })
                ));
                await dependencies.completeExecution({
                  actorUserId: adoption.actorUserId,
                  projectId: adoption.projectId,
                  runId: adoption.runId,
                  toolId: adoption.toolId,
                  leaseOwner: lease.leaseOwner,
                });
                throw error;
              }
              if (
                error instanceof AgentDownstreamSubmissionUnknownError
                && dependencies.terminalizeSubmissionUnknown
              ) {
                await withAgentExecutionFence(executionFence, () => (
                  dependencies.terminalizeSubmissionUnknown!({
                    taskId: adoption.runId,
                    actorUserId: adoption.actorUserId,
                    code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN',
                    message: error.message,
                  })
                ));
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
              leaseOwner: lease.leaseOwner,
              generation: executionGeneration,
            });
            if (!terminalEvents.some(event => event.type.startsWith('run.'))) {
              await dependencies.appendAdoptedEvent({
                actorUserId: adoption.actorUserId,
                projectId: adoption.projectId,
                runId: adoption.runId,
                workspace: adoption.workspace,
                eventId: eventId(adoption.runId, `tool:${adoption.toolId}:completed`),
                type: 'tool.completed',
                payload: { toolId: adoption.toolId, generation: executionGeneration },
                executionFence,
              });
            }
            await dependencies.completeExecution({
              actorUserId: adoption.actorUserId,
              projectId: adoption.projectId,
              runId: adoption.runId,
              toolId: adoption.toolId,
              leaseOwner: lease.leaseOwner,
            });
          } finally {
            initialScope?.dispose();
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
    terminalizeProviderRejection: async input => {
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
      markLocalAccepted: eventStorage.markAgentLocalDownstreamOperationAccepted,
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

interface ResumableAgentTaskLoaderDependencies {
  getTaskForUser(taskId: string, actorUserId: string): Promise<CloudTask | null>;
  listEvents(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
  }): Promise<AgentEvent[]>;
  executeAdmittedToolCall(
    execution: AgentAdmittedExecution,
    signal?: AbortSignal,
  ): Promise<unknown>;
  loadAgentEditContinuation(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
    nextStepId: string;
  }): Promise<AgentEditExecutionDescriptorV1>;
  executeAgentEditContinuation(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
    nextStepId: string;
    descriptor: AgentEditExecutionDescriptorV1;
    generation: number;
    leaseOwner: string;
    signal: AbortSignal;
    operationContext: AgentDownstreamExecutionContext;
  }): Promise<unknown>;
  loadSkillContinuation(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
    nextStepId?: string;
    task?: CloudTask;
    events?: readonly AgentEvent[];
  }): Promise<{
    workspace: AgentRunRequest['workspace'];
    requestDigest: string;
    toolId: string;
    execute(context: AgentDownstreamExecutionContext): Promise<void>;
  }>;
}

export function createResumableAgentTaskLoader(
  dependencies: ResumableAgentTaskLoaderDependencies,
) {
  return async function loadResumableAgentTask(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
    nextStepId: string;
  }): Promise<{
    adoption: SameTaskAgentAdoption;
    execute: (context: AgentDownstreamExecutionContext) => Promise<void>;
  }> {
    const [task, events] = await Promise.all([
      dependencies.getTaskForUser(input.runId, input.actorUserId),
      dependencies.listEvents(input),
    ]);
    const created = events.find(event => event.type === 'run.created');
    if (!task || task.projectId !== input.projectId || !created) {
      throw new SameTaskAgentRunNotFoundError();
    }

    if (created.payload.skill) {
      const continuation = await dependencies.loadSkillContinuation({
        ...input,
        task,
        events,
      });
      return {
        adoption: {
          runId: input.runId,
          reused: true,
          claimed: true,
          projection: reduceAgentEvents(events),
          tools: [],
          actorUserId: input.actorUserId,
          projectId: input.projectId,
          workspace: continuation.workspace,
          toolId: continuation.toolId,
          requestDigest: continuation.requestDigest,
        },
        execute: continuation.execute,
      };
    }

    if (created.payload.adopted !== true) {
      throw new SameTaskAgentRunNotFoundError();
    }
    const resumeExecution = created.payload.resumeExecution as AgentAdmittedExecution | undefined;
    const isAgentEdit = created.payload.rootToolId === 'agent_edit';
    const agentEditDescriptor = isAgentEdit
      ? await dependencies.loadAgentEditContinuation(input)
      : undefined;
    if (!resumeExecution && !agentEditDescriptor) {
      throw new Error('Adopted Agent execution has no durable continuation');
    }
    const workspace = created.payload.workspace as AgentRunRequest['workspace'];
    const requestDigest = typeof created.payload.requestDigest === 'string'
      ? created.payload.requestDigest
      : createHash('sha256').update(JSON.stringify(created.payload)).digest('hex');
    return {
      adoption: {
        runId: input.runId,
        reused: true,
        claimed: true,
        projection: reduceAgentEvents(events),
        tools: [],
        actorUserId: input.actorUserId,
        projectId: input.projectId,
        workspace,
        toolId: input.nextStepId,
        requestDigest,
      },
      execute: async context => {
        context.resumeFromStepId = input.nextStepId;
        if (agentEditDescriptor) {
          const resumed = context as AgentDownstreamExecutionContext & {
            generation?: number;
            leaseOwner?: string;
            signal?: AbortSignal;
          };
          if (!Number.isSafeInteger(resumed.generation) || !resumed.leaseOwner || !resumed.signal) {
            throw new Error('Agent edit resume context is incomplete');
          }
          await dependencies.executeAgentEditContinuation({
            ...input,
            descriptor: agentEditDescriptor,
            generation: resumed.generation!,
            leaseOwner: resumed.leaseOwner,
            signal: resumed.signal,
            operationContext: context,
          });
        } else {
          await dependencies.executeAdmittedToolCall(resumeExecution!, context.signal);
        }
      },
    };
  };
}

export async function loadResumableAdoptedAgentTask(input: {
  actorUserId: string;
  projectId: string;
  runId: string;
  nextStepId: string;
}): Promise<{
  adoption: SameTaskAgentAdoption;
  execute: (context: AgentDownstreamExecutionContext) => Promise<void>;
}> {
  const [taskStorage, eventStorage, chatTools] = await Promise.all([
    import('@/lib/cloud-task-storage'),
    import('./event-storage'),
    import('@/lib/chat-tools'),
  ]);
  const agentEdit = await import('./agent-edit-continuation');
  const skillContinuation = await import('@/lib/skill-runtime/continuation');
  return createResumableAgentTaskLoader({
    getTaskForUser: taskStorage.getCloudTaskForUser,
    listEvents: eventStorage.listAgentEventsForActor,
    executeAdmittedToolCall: chatTools.executeAdmittedToolCall,
    loadAgentEditContinuation: agentEdit.loadAgentEditContinuation,
    executeAgentEditContinuation: agentEdit.executeAgentEditContinuation,
    loadSkillContinuation: skillContinuation.loadPersistedSkillContinuation,
  })(input);
}

export function adoptAndExecuteExistingAgentTask<T>(
  input: AdoptAndExecuteSameTaskInput<T>,
): Promise<AdoptAndExecuteSameTaskResult<T>> {
  return defaultSameTaskAgentAdapter().then(adapter => adapter.adoptAndExecute(input));
}

export async function executeExistingSkillAgentTask(input: {
  actor: User;
  taskId: string;
  request: import('@/lib/skill-runtime/run-request').SkillRunRequest;
  stepAdapters: Readonly<Record<string, import('@/lib/skill-runtime/service').SkillStepAdapter>>;
  stepRecoveries?: Readonly<Record<string, import('@/lib/skill-runtime/service').SkillStepRecoveryFactory>>;
  resumeFromStepId?: string;
  expectedGeneration?: number;
  leaseOwner?: string;
  signal?: AbortSignal;
}): Promise<AdoptAndExecuteSameTaskResult<import('@/lib/skill-runtime/executor').ExecuteSkillRunResult>> {
  const [taskStorage, eventStorage, runRequest, catalog, modelCatalog, skillService, agentService] = await Promise.all([
    import('@/lib/cloud-task-storage'),
    import('./event-storage'),
    import('@/lib/skill-runtime/run-request'),
    import('@/lib/skill-runtime/catalog'),
    import('@/lib/task-core/model-catalog'),
    import('@/lib/skill-runtime/service'),
    import('./service'),
  ]);
  const agentRequest = await runRequest.buildSkillAgentRunRequest(input.request, {
    actorUserId: input.actor.id,
    resolveTaskModel: modelCatalog.resolveTaskModel,
  });
  const [task, events] = await Promise.all([
    taskStorage.getCloudTaskForUser(input.taskId, input.actor.id),
    eventStorage.listAgentEventsForActor({
      actorUserId: input.actor.id,
      projectId: input.request.projectId,
      runId: input.taskId,
    }),
  ]);
  const created = events.find(event => event.type === 'run.created');
  const definition = catalog.requireSkillForSurface(input.request.skillId, input.request.surface);
  const toolId = definition.steps[0]?.toolId;
  if (
    !task
    || task.type !== 'agent-run'
    || task.projectId !== input.request.projectId
    || !created
    || !toolId
    || created.payload.requestDigest !== task.requestDigest
    || agentService.agentRunRequestDigest(agentRequest) !== task.requestDigest
  ) {
    throw new SameTaskAgentRunNotFoundError();
  }
  const adoption: SameTaskAgentAdoption = {
    runId: input.taskId,
    reused: true,
    claimed: true,
    projection: reduceAgentEvents(events),
    tools: [],
    actorUserId: input.actor.id,
    projectId: input.request.projectId,
    workspace: agentRequest.workspace,
    toolId,
    requestDigest: task.requestDigest || '',
  };
  return executeAdoptedAgentTask({
    adoption,
    execute: operationContext => skillService.executeSkillRun({
      actor: input.actor,
      request: input.request,
      runId: input.taskId,
      operationContext,
      stepAdapters: input.stepAdapters,
      stepRecoveries: input.stepRecoveries,
      resumeFromStepId: input.resumeFromStepId,
    }),
    resumeFromStepId: input.resumeFromStepId,
    expectedGeneration: input.expectedGeneration,
    leaseOwner: input.leaseOwner,
    signal: input.signal,
  });
}
import { createHash } from 'node:crypto';
