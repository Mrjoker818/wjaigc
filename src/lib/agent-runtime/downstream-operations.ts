import { createHash, randomUUID } from 'node:crypto';

export interface AgentDownstreamOperationInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  toolId: string;
  requestDigest: string;
  leaseOwner?: string;
  now?: number;
  leaseDurationMs?: number;
}

export interface AgentDownstreamOperationIdentity extends AgentDownstreamOperationInput {
  operationKey: string;
  idempotencyKey: string;
  leaseOwner: string;
}

export interface AgentDownstreamOperation extends AgentDownstreamOperationIdentity {
  status: 'prepared' | 'completed';
  attempts: number;
  claimed?: boolean;
  response?: unknown;
}

export interface CompleteAgentDownstreamOperationInput extends AgentDownstreamOperationIdentity {
  response: unknown;
}

export interface AgentDownstreamOperationDependencies {
  prepare(input: AgentDownstreamOperationIdentity): Promise<AgentDownstreamOperation>;
  complete(input: CompleteAgentDownstreamOperationInput): Promise<AgentDownstreamOperation>;
  release?(input: AgentDownstreamOperationIdentity): Promise<boolean>;
  read?(input: AgentDownstreamOperationIdentity): Promise<AgentDownstreamOperation | null>;
}

export interface AgentDownstreamExecutionContext {
  idempotencyKey: string;
  operationKey: string;
  recovery: boolean;
}

export function createAgentDownstreamOperationIdentity(
  input: AgentDownstreamOperationInput,
): AgentDownstreamOperationIdentity {
  const digest = createHash('sha256').update([
    input.actorUserId, input.projectId, input.runId, input.toolId, input.requestDigest,
  ].join('\0')).digest('hex');
  return {
    ...input,
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
    if (current?.status === 'completed') return current.response as T;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Agent downstream operation recovery timed out');
}

export async function executeDurableAgentDownstreamOperation<T>(
  input: AgentDownstreamOperationInput,
  execute: (context: AgentDownstreamExecutionContext) => Promise<T>,
  dependencies: AgentDownstreamOperationDependencies,
): Promise<T> {
  const identity = createAgentDownstreamOperationIdentity(input);
  const operation = await dependencies.prepare(identity);
  if (operation.status === 'completed') return operation.response as T;
  if (operation.claimed === false) return waitForCompleted<T>(identity, dependencies);
  try {
    const response = await execute({
      idempotencyKey: identity.idempotencyKey,
      operationKey: identity.operationKey,
      recovery: operation.attempts > 1,
    });
    await dependencies.complete({ ...identity, response });
    return response;
  } catch (error) {
    await dependencies.release?.(identity).catch(() => false);
    throw error;
  }
}
