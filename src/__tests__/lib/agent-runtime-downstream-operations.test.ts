import { describe, expect, it, vi } from 'vitest';

import {
  createAgentDownstreamOperationIdentity,
  executeDurableAgentDownstreamOperation,
  type AgentDownstreamOperation,
  type AgentDownstreamOperationDependencies,
} from '@/lib/agent-runtime/downstream-operations';

describe('durable Agent downstream operations', () => {
  const executionFence = {
    runId: 'run-1',
    leaseOwner: 'agent-lease-3',
    generation: 3,
  };

  it('rejects an unfenced operation before any downstream state can be prepared', () => {
    expect(() => createAgentDownstreamOperationIdentity({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'image_edit', requestDigest: 'a'.repeat(64),
    })).toThrow('Agent execution fence is required');
  });

  it('derives one stable provider idempotency key from actor/run/tool/request digest', () => {
    const input = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'image_edit', requestDigest: 'a'.repeat(64), executionFence,
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

  it('includes the exact tool-call step identity in the durable provider key', () => {
    const input = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'image_edit', requestDigest: 'a'.repeat(64), executionFence,
    };

    const first = createAgentDownstreamOperationIdentity({ ...input, stepId: 'image-edit:0' });
    const second = createAgentDownstreamOperationIdentity({ ...input, stepId: 'image-edit:1' });

    expect(first.stepId).toBe('image-edit:0');
    expect(second.stepId).toBe('image-edit:1');
    expect(second.operationKey).not.toBe(first.operationKey);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('preserves the pre-step root identity for already-durable operations', () => {
    const identity = createAgentDownstreamOperationIdentity({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'image_edit', requestDigest: 'a'.repeat(64), executionFence,
    });

    expect(identity.stepId).toBe('root');
    expect(identity.operationKey).toBe(
      'agent-op:56088e6320f8e1f235dee3a6b9ab0e63c7b5837285e32bc5c45319ad9d0e4cf8',
    );
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
      toolId: 'image_edit', requestDigest: 'a'.repeat(64), executionFence,
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
      executionFence: { ...executionFence, runId: 'run-unknown' },
    };

    await expect(executeDurableAgentDownstreamOperation(input, async context => {
      await context.beginSubmission();
      return submit();
    }, dependencies)).rejects.toMatchObject({
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN',
      cause: expect.objectContaining({ message: 'connection lost after submit' }),
    });
    await expect(executeDurableAgentDownstreamOperation(
      input, async () => submit(), dependencies,
    )).rejects.toMatchObject({ code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN' });

    expect(submit).toHaveBeenCalledTimes(1);
    expect((operation as unknown as AgentDownstreamOperation).status).toBe('submission_unknown');
    expect(dependencies.complete).not.toHaveBeenCalled();
  });

  it('propagates the same execution fence into nested downstream operations', async () => {
    const seen: unknown[] = [];
    const dependencies: AgentDownstreamOperationDependencies = {
      prepare: vi.fn(async input => {
        seen.push(input.executionFence);
        return { ...input, status: 'prepared', attempts: 1, claimed: true };
      }),
      markSubmitted: vi.fn(async input => ({ ...input, status: 'submitted', attempts: 1 })),
      markAccepted: vi.fn(async input => ({ ...input, status: 'accepted', attempts: 1 })),
      markSubmissionUnknown: vi.fn(async input => ({ ...input, status: 'submission_unknown', attempts: 1 })),
      complete: vi.fn(async input => ({
        ...input, status: 'completed', attempts: 1, response: input.response,
      })),
    };

    await executeDurableAgentDownstreamOperation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'agent_edit', requestDigest: 'd'.repeat(64), executionFence,
    }, context => context.executeOperation({
      stepId: 'image-edit:1', toolId: 'image_edit', requestDigest: 'e'.repeat(64),
    }, async () => ({ imageUrl: '/result.png' })), dependencies);

    expect(seen).toEqual([executionFence, executionFence]);
  });
});
