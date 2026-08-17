import { describe, expect, it, vi } from 'vitest';

import {
  createAgentDownstreamOperationIdentity,
  executeDurableAgentDownstreamOperation,
  type AgentDownstreamOperation,
  type AgentDownstreamOperationDependencies,
} from '@/lib/agent-runtime/downstream-operations';

describe('durable Agent downstream operations', () => {
  it('derives one stable provider idempotency key from actor/run/tool/request digest', () => {
    const input = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'image_edit', requestDigest: 'a'.repeat(64),
    };
    const first = createAgentDownstreamOperationIdentity(input);
    const retry = createAgentDownstreamOperationIdentity(input);
    expect(retry).toMatchObject({
      operationKey: first.operationKey,
      idempotencyKey: first.idempotencyKey,
    });
    expect(retry.leaseOwner).not.toBe(first.leaseOwner);
    const changed = createAgentDownstreamOperationIdentity({ ...input, requestDigest: 'b'.repeat(64) });
    expect(changed.operationKey).not.toBe(first.operationKey);
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('reuses the same key after a crash immediately after provider acceptance', async () => {
    let operation: AgentDownstreamOperation | null = null;
    const providerTasks = new Map<string, string>();
    const dependencies: AgentDownstreamOperationDependencies = {
      prepare: vi.fn(async (input): Promise<AgentDownstreamOperation> => {
        const current = operation ?? {
          ...input,
          status: 'prepared',
          attempts: 0,
        } satisfies AgentDownstreamOperation;
        operation = { ...current, attempts: current.attempts + 1 };
        return operation!;
      }),
      complete: vi.fn(async input => {
        operation = { ...operation!, status: 'completed', response: input.response };
        return operation;
      }),
    };
    const input = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'image_edit', requestDigest: 'a'.repeat(64),
    };
    const provider = vi.fn(async (stableKey: string, crash: boolean) => {
      const taskId = providerTasks.get(stableKey) || 'provider-task-1';
      providerTasks.set(stableKey, taskId);
      if (crash) throw new Error('crash after provider accepted');
      return { taskId };
    });

    await expect(executeDurableAgentDownstreamOperation(
      input,
      context => provider(context.idempotencyKey, true),
      dependencies,
    )).rejects.toThrow('crash after provider accepted');
    await expect(executeDurableAgentDownstreamOperation(
      input,
      context => provider(context.idempotencyKey, false),
      dependencies,
    )).resolves.toEqual({ taskId: 'provider-task-1' });

    expect(new Set(provider.mock.calls.map(call => call[0]))).toHaveLength(1);
    expect(providerTasks).toHaveLength(1);
    expect(dependencies.complete).toHaveBeenCalledTimes(1);
  });
});
