import type { AgentDownstreamExecutionContext } from './downstream-operations';
import {
  AgentEditExecutionDescriptorError,
  parseAgentEditExecutionContinuation,
  type AgentEditExecutionDescriptorV1,
} from './agent-edit-execution-descriptor';
import type { AgentEvent } from './types';

export interface AgentEditContinuationIdentity {
  actorUserId: string;
  projectId: string;
  runId: string;
  nextStepId: string;
}

export interface LoadAgentEditContinuationDependencies {
  getDescriptor(taskId: string, actorUserId: string): Promise<unknown>;
  listEvents(input: AgentEditContinuationIdentity): Promise<AgentEvent[]>;
}

export interface ExecuteAgentEditContinuationInput extends AgentEditContinuationIdentity {
  descriptor: AgentEditExecutionDescriptorV1;
  generation: number;
  leaseOwner: string;
  signal: AbortSignal;
  operationContext?: AgentDownstreamExecutionContext;
}

export interface ExecuteAgentEditContinuationDependencies {
  executeDescriptor(input: ExecuteAgentEditContinuationInput): Promise<void>;
}

export async function loadAgentEditContinuation(
  input: AgentEditContinuationIdentity,
  dependencies?: LoadAgentEditContinuationDependencies,
): Promise<AgentEditExecutionDescriptorV1> {
  if (input.nextStepId !== 'agent_edit') {
    throw new AgentEditExecutionDescriptorError('Agent edit can resume only from agent_edit');
  }
  const deps = dependencies ?? await (async (): Promise<LoadAgentEditContinuationDependencies> => {
    const [storage, events] = await Promise.all([
      import('@/lib/cloud-task-storage'),
      import('./event-storage'),
    ]);
    return {
      getDescriptor: storage.getPrivateAgentExecutionDescriptor,
      listEvents: events.listAgentEventsForActor,
    };
  })();
  const [descriptor, events] = await Promise.all([
    deps.getDescriptor(input.runId, input.actorUserId),
    deps.listEvents(input),
  ]);
  const created = events.find(event => event.type === 'run.created');
  if (
    !created
    || created.payload.adopted !== true
    || created.payload.rootToolId !== 'agent_edit'
  ) {
    throw new AgentEditExecutionDescriptorError('Agent edit continuation event is missing');
  }
  return parseAgentEditExecutionContinuation({
    ...(created.payload.continuation as Record<string, unknown>),
    rootToolId: created.payload.rootToolId,
  }, descriptor);
}

export async function executeAgentEditContinuation(
  input: ExecuteAgentEditContinuationInput,
  dependencies?: ExecuteAgentEditContinuationDependencies,
): Promise<void> {
  if (input.nextStepId !== 'agent_edit') {
    throw new AgentEditExecutionDescriptorError('Agent edit can resume only from agent_edit');
  }
  const deps = dependencies ?? await import('./agent-edit-executor');
  await deps.executeDescriptor(input);
}
