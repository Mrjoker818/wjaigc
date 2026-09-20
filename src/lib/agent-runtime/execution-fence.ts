import { AsyncLocalStorage } from 'node:async_hooks';

export interface AgentExecutionFence {
  runId: string;
  leaseOwner: string;
  generation: number;
}

const storage = new AsyncLocalStorage<AgentExecutionFence>();

const AGENT_RUN_ID_HEADER = 'x-wujie-agent-run-id';
const AGENT_LEASE_OWNER_HEADER = 'x-wujie-agent-lease-owner';
const AGENT_GENERATION_HEADER = 'x-wujie-agent-generation';

export function withAgentExecutionFence<T>(
  fence: AgentExecutionFence,
  execute: () => Promise<T>,
): Promise<T> {
  return storage.run(fence, execute);
}

export function getAgentExecutionFence(): AgentExecutionFence | undefined {
  return storage.getStore();
}

export function getAgentExecutionFenceHeaders(
  fence: AgentExecutionFence | undefined = getAgentExecutionFence(),
): Record<string, string> {
  if (!fence) return {};
  return {
    [AGENT_RUN_ID_HEADER]: fence.runId,
    [AGENT_LEASE_OWNER_HEADER]: fence.leaseOwner,
    [AGENT_GENERATION_HEADER]: String(fence.generation),
  };
}

export function parseAgentExecutionFenceHeaders(
  headers: Pick<Headers, 'get'>,
): AgentExecutionFence | undefined {
  const runId = headers.get(AGENT_RUN_ID_HEADER)?.trim() || '';
  const leaseOwner = headers.get(AGENT_LEASE_OWNER_HEADER)?.trim() || '';
  const rawGeneration = headers.get(AGENT_GENERATION_HEADER)?.trim() || '';
  const generation = Number(rawGeneration);
  if (
    !runId
    || runId.length > 256
    || !leaseOwner
    || leaseOwner.length > 256
    || !/^\d+$/.test(rawGeneration)
    || !Number.isSafeInteger(generation)
    || generation < 0
  ) {
    return undefined;
  }
  return { runId, leaseOwner, generation };
}
