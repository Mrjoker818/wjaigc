import { AsyncLocalStorage } from 'node:async_hooks';

export interface AgentExecutionFence {
  runId: string;
  leaseOwner: string;
  generation: number;
}

const storage = new AsyncLocalStorage<AgentExecutionFence>();

export function withAgentExecutionFence<T>(
  fence: AgentExecutionFence,
  execute: () => Promise<T>,
): Promise<T> {
  return storage.run(fence, execute);
}

export function getAgentExecutionFence(): AgentExecutionFence | undefined {
  return storage.getStore();
}
