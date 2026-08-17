import { createHash, randomUUID } from 'node:crypto';

export interface AgentDownstreamOperationInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  toolId: string;
  stepId?: string;
  requestDigest: string;
  leaseOwner?: string;
  now?: number;
  leaseDurationMs?: number;
}

export interface AgentDownstreamOperationIdentity extends Omit<AgentDownstreamOperationInput, 'stepId'> {
  stepId: string;
  operationKey: string;
  idempotencyKey: string;
  leaseOwner: string;
}

export interface AgentDownstreamOperation extends AgentDownstreamOperationIdentity {
  status: 'prepared' | 'submitted' | 'accepted' | 'submission_unknown' | 'completed';
  attempts: number;
  claimed?: boolean;
  response?: unknown;
  providerTaskId?: string;
  submissionError?: string;
}

export interface CompleteAgentDownstreamOperationInput extends AgentDownstreamOperationIdentity {
  response: unknown;
}

export interface AcceptAgentDownstreamOperationInput extends AgentDownstreamOperationIdentity {
  providerTaskId: string;
}

export interface MarkAgentDownstreamSubmissionUnknownInput extends AgentDownstreamOperationIdentity {
  reason: string;
}

export interface AgentDownstreamOperationDependencies {
  prepare(input: AgentDownstreamOperationIdentity): Promise<AgentDownstreamOperation>;
  markSubmitted(input: AgentDownstreamOperationIdentity): Promise<AgentDownstreamOperation>;
  markAccepted(input: AcceptAgentDownstreamOperationInput): Promise<AgentDownstreamOperation>;
  markSubmissionUnknown(input: MarkAgentDownstreamSubmissionUnknownInput): Promise<AgentDownstreamOperation>;
  complete(input: CompleteAgentDownstreamOperationInput): Promise<AgentDownstreamOperation>;
  release?(input: AgentDownstreamOperationIdentity): Promise<boolean>;
  read?(input: AgentDownstreamOperationIdentity): Promise<AgentDownstreamOperation | null>;
}

export interface AgentDownstreamExecutionContext {
  idempotencyKey: string;
  operationKey: string;
  recovery: boolean;
  beginSubmission(): Promise<void>;
  recordAccepted(providerTaskId: string): Promise<void>;
  executeOperation<T>(
    input: AgentDownstreamStepInput,
    execute: (context: AgentDownstreamExecutionContext) => Promise<T>,
    recovery?: AgentDownstreamRecovery<T>,
  ): Promise<T>;
}

export interface AgentDownstreamStepInput {
  stepId: string;
  toolId: string;
  requestDigest: string;
}

export interface AgentDownstreamRecovery<T> {
  reconcile(providerTaskId: string, context: AgentDownstreamExecutionContext): Promise<T>;
}

export class AgentDownstreamSubmissionUnknownError extends Error {
  readonly code = 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN';

  constructor(cause?: unknown) {
    super('Agent downstream submission state is unknown; manual reconciliation is required', {
      cause,
    });
    this.name = 'AgentDownstreamSubmissionUnknownError';
  }
}

export class AgentDownstreamProviderRejectedError extends Error {
  readonly code = 'AGENT_DOWNSTREAM_PROVIDER_REJECTED';

  constructor(readonly providerStatus?: number) {
    super('Agent downstream provider rejected the request');
    this.name = 'AgentDownstreamProviderRejectedError';
  }
}

interface AgentDownstreamKnownRejectionOutcome {
  __agentDownstreamOutcome: 'known_provider_rejection';
  code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED';
  providerStatus?: number;
}

function serializeKnownProviderRejection(
  error: AgentDownstreamProviderRejectedError,
): AgentDownstreamKnownRejectionOutcome {
  return {
    __agentDownstreamOutcome: 'known_provider_rejection',
    code: error.code,
    ...(error.providerStatus === undefined ? {} : { providerStatus: error.providerStatus }),
  };
}

function replayKnownProviderRejection(response: unknown): void {
  if (
    !response
    || typeof response !== 'object'
    || (response as Record<string, unknown>).__agentDownstreamOutcome !== 'known_provider_rejection'
    || (response as Record<string, unknown>).code !== 'AGENT_DOWNSTREAM_PROVIDER_REJECTED'
  ) return;
  const providerStatus = (response as Record<string, unknown>).providerStatus;
  throw new AgentDownstreamProviderRejectedError(
    typeof providerStatus === 'number' ? providerStatus : undefined,
  );
}

export function createAgentDownstreamOperationIdentity(
  input: AgentDownstreamOperationInput,
): AgentDownstreamOperationIdentity {
  const stepId = input.stepId || 'root';
  const identityParts = [input.actorUserId, input.projectId, input.runId, input.toolId];
  if (stepId !== 'root') identityParts.push(stepId);
  identityParts.push(input.requestDigest);
  const digest = createHash('sha256').update(identityParts.join('\0')).digest('hex');
  return {
    ...input,
    stepId,
    operationKey: `agent-op:${digest}`,
    idempotencyKey: `agent-provider:${digest}`,
    leaseOwner: input.leaseOwner || randomUUID(),
  };
}

async function waitForCompleted<T>(
  identity: AgentDownstreamOperationIdentity,
  dependencies: AgentDownstreamOperationDependencies,
): Promise<T> {
  if (!dependencies.read) throw new Error('Agent downstream operation is already claimed');
  for (let attempt = 0; attempt < 200; attempt++) {
    const current = await dependencies.read(identity);
    if (current?.status === 'completed') {
      replayKnownProviderRejection(current.response);
      return current.response as T;
    }
    if (current?.status === 'submission_unknown') throw new AgentDownstreamSubmissionUnknownError();
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Agent downstream operation recovery timed out');
}

export async function executeDurableAgentDownstreamOperation<T>(
  input: AgentDownstreamOperationInput,
  execute: (context: AgentDownstreamExecutionContext) => Promise<T>,
  dependencies: AgentDownstreamOperationDependencies,
  recovery?: AgentDownstreamRecovery<T>,
): Promise<T> {
  const identity = createAgentDownstreamOperationIdentity(input);
  const operation = await dependencies.prepare(identity);
  if (operation.status === 'completed') {
    replayKnownProviderRejection(operation.response);
    return operation.response as T;
  }
  if (operation.status === 'submission_unknown') throw new AgentDownstreamSubmissionUnknownError();
  if (operation.claimed === false) return waitForCompleted<T>(identity, dependencies);
  let submissionStarted = operation.status === 'submitted' || operation.status === 'accepted';
  let acceptanceRecorded = operation.status === 'accepted';
  const context: AgentDownstreamExecutionContext = {
    idempotencyKey: identity.idempotencyKey,
    operationKey: identity.operationKey,
    recovery: operation.attempts > 1,
    async beginSubmission() {
      if (submissionStarted) return;
      await dependencies.markSubmitted(identity);
      submissionStarted = true;
    },
    async recordAccepted(providerTaskId: string) {
      if (!submissionStarted || acceptanceRecorded) {
        throw new Error('Agent downstream operation was not submitted');
      }
      await dependencies.markAccepted({ ...identity, providerTaskId });
      acceptanceRecorded = true;
    },
    executeOperation(step, childExecute, childRecovery) {
      return executeDurableAgentDownstreamOperation({
        actorUserId: identity.actorUserId,
        projectId: identity.projectId,
        runId: identity.runId,
        toolId: step.toolId,
        stepId: step.stepId,
        requestDigest: step.requestDigest,
      }, childExecute, dependencies, childRecovery);
    },
  };

  if (operation.status === 'submitted') {
    await dependencies.markSubmissionUnknown({
      ...identity,
      reason: 'Recovery found a submitted operation without a reconcilable provider task ID',
    });
    throw new AgentDownstreamSubmissionUnknownError();
  }
  if (operation.status === 'accepted') {
    if (!operation.providerTaskId || !recovery) {
      await dependencies.markSubmissionUnknown({
        ...identity,
        reason: 'Accepted provider task cannot be reconciled by this adapter',
      });
      throw new AgentDownstreamSubmissionUnknownError();
    }
    try {
      const response = await recovery.reconcile(operation.providerTaskId, context);
      await dependencies.complete({ ...identity, response });
      return response;
    } catch (error) {
      if (error instanceof AgentDownstreamProviderRejectedError) {
        await dependencies.complete({
          ...identity,
          response: serializeKnownProviderRejection(error),
        });
        throw error;
      }
      await dependencies.release?.(identity).catch(() => false);
      throw error;
    }
  }
  try {
    const response = await execute(context);
    await dependencies.complete({ ...identity, response });
    return response;
  } catch (error) {
    if (error instanceof AgentDownstreamProviderRejectedError) {
      await dependencies.complete({
        ...identity,
        response: serializeKnownProviderRejection(error),
      });
    } else if (submissionStarted && !acceptanceRecorded) {
      await dependencies.markSubmissionUnknown({
        ...identity,
        reason: error instanceof Error ? error.message : 'Provider submission outcome is unknown',
      }).catch(() => undefined);
      throw new AgentDownstreamSubmissionUnknownError(error);
    } else {
      await dependencies.release?.(identity).catch(() => false);
    }
    throw error;
  }
}
