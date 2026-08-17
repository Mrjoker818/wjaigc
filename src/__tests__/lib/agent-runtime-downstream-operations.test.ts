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

  it('reconciles an accepted provider task without invoking submit twice', async () => {
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
      markSubmitted: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'submitted' };
        return operation as AgentDownstreamOperation;
      }),
      markAccepted: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'accepted' };
        return operation as AgentDownstreamOperation;
      }),
      markSubmissionUnknown: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'submission_unknown' };
        return operation as AgentDownstreamOperation;
      }),
      release: vi.fn(async () => true),
    };
    const input = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'image_edit', requestDigest: 'a'.repeat(64),
    };
    const provider = vi.fn(async (stableKey: string) => {
      const taskId = providerTasks.get(stableKey) || 'provider-task-1';
      providerTasks.set(stableKey, taskId);
      return { taskId };
    });

    await expect(executeDurableAgentDownstreamOperation(
      input,
      async context => {
        await context.beginSubmission();
        const accepted = await provider(context.idempotencyKey);
        await context.recordAccepted(accepted.taskId);
        throw new Error('crash after provider accepted');
      },
      dependencies,
    )).rejects.toThrow('crash after provider accepted');
    await expect(executeDurableAgentDownstreamOperation(
      input,
      async () => { throw new Error('submit must not run during recovery'); },
      dependencies,
      { reconcile: async providerTaskId => ({ taskId: providerTaskId }) },
    )).resolves.toEqual({ taskId: 'provider-task-1' });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(providerTasks).toHaveLength(1);
    expect(dependencies.complete).toHaveBeenCalledTimes(1);
  });

  it('fails closed as submission_unknown when submitted acceptance cannot be reconciled', async () => {
    let operation: AgentDownstreamOperation | null = null;
    const dependencies: AgentDownstreamOperationDependencies = {
      prepare: vi.fn(async input => {
        operation ??= { ...input, status: 'prepared', attempts: 1 };
        return { ...operation, claimed: true } as AgentDownstreamOperation;
      }),
      markSubmitted: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'submitted' };
        return operation as AgentDownstreamOperation;
      }),
      markAccepted: vi.fn(),
      markSubmissionUnknown: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'submission_unknown' };
        return operation as AgentDownstreamOperation;
      }),
      complete: vi.fn(),
      release: vi.fn(async () => true),
    };
    const submit = vi.fn(async () => { throw new Error('connection lost after submit'); });
    const input = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-unknown',
      toolId: 'image_edit', requestDigest: 'c'.repeat(64),
    };

    await expect(executeDurableAgentDownstreamOperation(input, async context => {
      await context.beginSubmission();
      return submit();
    }, dependencies)).rejects.toThrow('connection lost after submit');
    await expect(executeDurableAgentDownstreamOperation(
      input, async () => submit(), dependencies,
    )).rejects.toMatchObject({ code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN' });

    expect(submit).toHaveBeenCalledTimes(1);
    expect((operation as unknown as AgentDownstreamOperation).status).toBe('submission_unknown');
    expect(dependencies.complete).not.toHaveBeenCalled();
  });
});
