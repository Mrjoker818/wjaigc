import {
  appendAdoptedAgentEvent,
  claimResumedAgentExecutionDispatch,
  failResumedAgentExecutionDispatch,
} from './event-storage';
import { executeAdoptedAgentTask, loadResumableAdoptedAgentTask } from './same-task-adapter';
import type { AgentRunExecutionDispatchInput } from './service';

export interface AgentExecutionDispatchStart {
  started: boolean;
  completion?: Promise<void>;
}

function markDispatchFailurePersisted(error: unknown): Error & {
  dispatchFailurePersisted: true;
} {
  const persistedError = error instanceof Error
    ? new Error(error.message, { cause: error })
    : new Error(String(error), { cause: error });
  return Object.assign(persistedError, { dispatchFailurePersisted: true as const });
}

export async function recordResumedAgentExecutionCompletionFailure(
  input: AgentRunExecutionDispatchInput,
): Promise<void> {
  await appendAdoptedAgentEvent({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    runId: input.runId,
    workspace: input.workspace,
    eventId: `agent:${input.runId}:resumed:${input.generation}:completion-failed`,
    type: 'step.retrying',
    payload: {
      stepId: input.nextStepId,
      generation: input.generation,
      error: {
        code: 'AGENT_RESUME_EXECUTION_FAILED',
        message: 'Resumed Agent execution failed after dispatch',
        retryable: true,
      },
    },
    executionFence: {
      runId: input.runId,
      leaseOwner: input.leaseOwner,
      generation: input.generation,
    },
  });
}

export async function recordResumedAgentExecutionDispatchFailure(
  input: AgentRunExecutionDispatchInput,
  dispatchLeaseOwner: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await failResumedAgentExecutionDispatch({
    ...input, dispatchLeaseOwner, error: message,
  });
}

export async function dispatchResumedAgentExecution(
  input: AgentRunExecutionDispatchInput,
): Promise<AgentExecutionDispatchStart> {
  const claim = await claimResumedAgentExecutionDispatch(input);
  if (!claim.claimed) return { started: false };

  try {
    const resumable = await loadResumableAdoptedAgentTask(input);
    await appendAdoptedAgentEvent({
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      runId: input.runId,
      workspace: input.workspace,
      eventId: `agent:${input.runId}:resumed:${input.generation}:tool:${input.nextStepId}:started`,
      type: 'tool.started',
      payload: { toolId: input.nextStepId, stepId: input.nextStepId, generation: input.generation },
      executionFence: {
        runId: input.runId,
        leaseOwner: input.leaseOwner,
        generation: input.generation,
      },
    });

    const completion = executeAdoptedAgentTask({
      adoption: resumable.adoption,
      execute: context => resumable.execute(Object.assign(context, {
        resumeFromStepId: input.nextStepId,
        generation: input.generation,
        leaseOwner: input.leaseOwner,
        signal: input.signal,
      })),
      resumeFromStepId: input.nextStepId,
      expectedGeneration: input.generation,
      leaseOwner: input.leaseOwner,
    }).then(() => undefined).catch(async error => {
      const persisted = await failResumedAgentExecutionDispatch({
        ...input,
        dispatchLeaseOwner: claim.dispatchLeaseOwner,
        error: error instanceof Error ? error.message : String(error),
      });
      throw persisted ? markDispatchFailurePersisted(error) : error;
    });
    return { started: true, completion };
  } catch (error) {
    await recordResumedAgentExecutionDispatchFailure(input, claim.dispatchLeaseOwner, error);
    throw error;
  }
}
