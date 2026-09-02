import { describe, expect, it, vi } from 'vitest';

import {
  createSameTaskAgentAdapter,
  type SameTaskAgentAdapterDependencies,
} from '@/lib/agent-runtime/same-task-adapter';
import type { AgentDownstreamOperation } from '@/lib/agent-runtime/downstream-operations';
import type { AgentEvent, AgentRunRequest } from '@/lib/agent-runtime/types';
import type { CloudTask } from '@/lib/cloud-task-storage';
import type { User } from '@/lib/user-types';

const actor: User = {
  id: 'user-1',
  name: 'Agent owner',
  role: 'user',
  status: 'active',
  productType: 'canvas',
  createdAt: 1,
  updatedAt: 1,
};

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    projectId: 'project-1',
    workspace: 'canvas',
    workspaceId: 'canvas-1',
    mode: 'agent',
    providerId: 'provider-image',
    modelId: 'model-image',
    prompt: 'Create an image',
    sourceVersionIds: [],
    allowedToolIds: ['generate_image'],
    idempotencyKey: 'existing-task-1',
    context: {
      selectedEntityIds: [],
      visibleVersionIds: [],
      locale: 'zh-CN',
    },
    ...overrides,
  };
}

function task(overrides: Partial<CloudTask> = {}): CloudTask {
  return {
    id: 'task-1',
    userId: actor.id,
    projectId: 'project-1',
    type: 'generate-async',
    status: 'processing',
    providerId: 'provider-image',
    model: 'model-image',
    progress: 0,
    creditStatus: 'pending',
    creditCost: 7,
    createdAt: 1,
    updatedAt: 1,
    revision: 0,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<SameTaskAgentAdapterDependencies> = {},
): SameTaskAgentAdapterDependencies {
  const events: AgentEvent[] = [];
  return {
    getTaskForUser: vi.fn().mockResolvedValue(task()),
    resolveTaskModel: vi.fn().mockResolvedValue({
      providerId: 'provider-image',
      modelId: 'model-image',
      kind: 'image',
      sourceType: 'image',
      protocol: 'images',
      executionMode: 'async',
      allowedRatios: [],
      allowedSizes: [],
      qualityOptions: [],
      maxOutputs: 1,
      supportsReferenceImages: false,
      supportsMask: false,
      supportedOperations: ['text-to-image'],
      outputKinds: ['png'],
      capabilitySources: {},
    }),
    authorizeContext: vi.fn().mockImplementation(async ({ request: runRequest }) => (
      runRequest.context
    )),
    appendAdoptedEvent: vi.fn().mockImplementation(async (input) => {
      const existing = events.find(event => event.eventId === input.eventId);
      if (existing) return { event: existing, inserted: false };
      const event: AgentEvent = {
        eventId: input.eventId,
        runId: input.runId,
        sequence: events.length + 1,
        type: input.type,
        timestamp: new Date(0).toISOString(),
        payload: input.payload,
      };
      events.push(event);
      return { event, inserted: true };
    }),
    observeTerminal: vi.fn().mockResolvedValue([]),
    listEvents: vi.fn().mockImplementation(async () => [...events]),
    claimExecution: vi.fn().mockResolvedValue({ claimed: true, leaseOwner: 'lease-1' }),
    completeExecution: vi.fn().mockResolvedValue(true),
    releaseExecution: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('same-task Agent adoption adapter', () => {
  it.each([
    ['another owner', null],
    ['another project', task({ projectId: 'project-other' })],
  ])('rejects %s before authorization or execution', async (_label, ownedTask) => {
    const deps = dependencies({
      getTaskForUser: vi.fn().mockResolvedValue(ownedTask),
    });
    const execute = vi.fn();

    await expect(createSameTaskAgentAdapter(deps).adoptAndExecute({
      actor,
      taskId: 'task-1',
      request: request(),
      toolId: 'generate_image',
      execute,
    })).rejects.toMatchObject({ code: 'AGENT_RUN_NOT_FOUND', status: 404 });

    expect(deps.authorizeContext).not.toHaveBeenCalled();
    expect(deps.appendAdoptedEvent).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['provider', task({ providerId: 'provider-other' })],
    ['model', task({ model: 'model-other' })],
  ])('rejects an exact %s mismatch before invoking the executor', async (_label, ownedTask) => {
    const deps = dependencies({
      getTaskForUser: vi.fn().mockResolvedValue(ownedTask),
    });
    const execute = vi.fn();

    await expect(createSameTaskAgentAdapter(deps).adoptAndExecute({
      actor,
      taskId: 'task-1',
      request: request(),
      toolId: 'generate_image',
      execute,
    })).rejects.toMatchObject({ code: 'MODEL_ROUTE_MISMATCH', status: 409 });

    expect(deps.resolveTaskModel).not.toHaveBeenCalled();
    expect(deps.authorizeContext).not.toHaveBeenCalled();
    expect(deps.appendAdoptedEvent).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects recursively nested client credentials before events or execution', async () => {
    const deps = dependencies();
    const execute = vi.fn();

    await expect(createSameTaskAgentAdapter(deps).adoptAndExecute({
      actor,
      taskId: 'task-1',
      request: request({
        context: {
          selectedEntityIds: [],
          visibleVersionIds: [],
          locale: 'zh-CN',
          metadata: { accessToken: 'never-persist-this' },
        } as AgentRunRequest['context'],
      }),
      toolId: 'generate_image',
      execute,
    })).rejects.toMatchObject({ code: 'AGENT_RUN_INVALID', status: 400 });

    expect(deps.authorizeContext).not.toHaveBeenCalled();
    expect(deps.appendAdoptedEvent).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('authorizes Task 1 context, model, and tools before execution', async () => {
    const deps = dependencies();
    const execute = vi.fn().mockResolvedValue('ok');

    const result = await createSameTaskAgentAdapter(deps).adoptAndExecute({
      actor,
      taskId: 'task-1',
      request: request(),
      toolId: 'generate_image',
      execute,
    });

    expect(deps.authorizeContext).toHaveBeenCalledWith({
      actorUserId: actor.id,
      request: request(),
    });
    expect(deps.resolveTaskModel).toHaveBeenCalledWith(
      'provider-image',
      'model-image',
      actor.id,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ runId: 'task-1', executed: true, value: 'ok' });
  });

  it('invokes one supplied executor under twenty concurrent duplicate requests', async () => {
    let claimed = false;
    const deps = dependencies({
      claimExecution: vi.fn().mockImplementation(async () => {
        if (claimed) return { claimed: false, leaseOwner: '' };
        claimed = true;
        return { claimed: true, leaseOwner: 'lease-1' };
      }),
    });
    let releaseExecution!: () => void;
    const executionGate = new Promise<void>(resolve => { releaseExecution = resolve; });
    const execute = vi.fn(async () => {
      await executionGate;
      return 'single-result';
    });
    const adapter = createSameTaskAgentAdapter(deps);

    const attempts = Array.from({ length: 20 }, () => adapter.adoptAndExecute({
      actor,
      taskId: 'task-1',
      request: request(),
      toolId: 'generate_image',
      execute,
    }));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    releaseExecution();
    const results = await Promise.all(attempts);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(results.filter(result => result.executed)).toHaveLength(1);
    expect(results.filter(result => result.reused)).toHaveLength(19);
    expect(results.find(result => result.executed)?.value).toBe('single-result');
  });

  it('releases a failed lease so a retry can resume execution', async () => {
    let attempts = 0;
    const deps = dependencies({
      claimExecution: vi.fn().mockImplementation(async () => ({
        claimed: true,
        leaseOwner: `lease-${++attempts}`,
      })),
    });
    const adapter = createSameTaskAgentAdapter(deps);
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('worker crashed'))
      .mockResolvedValueOnce('recovered');

    await expect(adapter.adoptAndExecute({
      actor, taskId: 'task-1', request: request(), toolId: 'generate_image', execute,
    })).rejects.toThrow('worker crashed');
    await expect(adapter.adoptAndExecute({
      actor, taskId: 'task-1', request: request(), toolId: 'generate_image', execute,
    })).resolves.toMatchObject({ executed: true, value: 'recovered' });

    expect(deps.releaseExecution).toHaveBeenCalledWith(expect.objectContaining({ leaseOwner: 'lease-1' }));
    expect(deps.completeExecution).toHaveBeenCalledWith(expect.objectContaining({ leaseOwner: 'lease-2' }));
  });

  it('reconciles an accepted production operation without a second submit', async () => {
    let operation: AgentDownstreamOperation | null = null;
    const downstreamOperations = {
      prepare: vi.fn(async input => {
        const current = operation ?? { ...input, status: 'prepared' as const, attempts: 0 };
        operation = { ...current, attempts: current.attempts + 1, claimed: true };
        return operation!;
      }),
      markSubmitted: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'submitted' };
        return operation!;
      }),
      markAccepted: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'accepted' };
        return operation!;
      }),
      markSubmissionUnknown: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'submission_unknown' };
        return operation!;
      }),
      complete: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'completed' };
        return operation!;
      }),
      release: vi.fn(async () => true),
      read: vi.fn(async () => operation),
    } satisfies NonNullable<SameTaskAgentAdapterDependencies['downstreamOperations']>;
    const deps = dependencies({ downstreamOperations });
    const adapter = createSameTaskAgentAdapter(deps);
    const adoption = await adapter.adopt({
      actor, taskId: 'task-1', request: request(), toolId: 'generate_image',
    });
    const submit = vi.fn(async () => ({ taskId: 'provider-task-1' }));

    await expect(adapter.executeAdoption({
      adoption,
      execute: async context => {
        await context.beginSubmission();
        const accepted = await submit();
        await context.recordAccepted(accepted.taskId);
        throw new Error('crash after acceptance');
      },
      recovery: {
        reconcile: vi.fn(async providerTaskId => ({ taskId: providerTaskId })),
      },
    })).rejects.toThrow('crash after acceptance');

    const recovered = await adapter.executeAdoption({
      adoption,
      execute: async () => submit(),
      recovery: {
        reconcile: vi.fn(async providerTaskId => ({ taskId: providerTaskId })),
      },
    });

    expect(recovered.value).toEqual({ taskId: 'provider-task-1' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(downstreamOperations.complete).toHaveBeenCalledTimes(1);
  });

  it('terminalizes submission_unknown once instead of releasing it for resurrection', async () => {
    let operation: AgentDownstreamOperation | null = null;
    const terminalizeSubmissionUnknown = vi.fn().mockResolvedValue(true);
    const downstreamOperations = {
      prepare: vi.fn(async input => {
        const current = operation ?? { ...input, status: 'prepared' as const, attempts: 0 };
        operation = { ...current, attempts: current.attempts + 1, claimed: true };
        return operation!;
      }),
      markSubmitted: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'submitted' };
        return operation!;
      }),
      markAccepted: vi.fn(),
      markSubmissionUnknown: vi.fn(async input => {
        operation = { ...operation!, ...input, status: 'submission_unknown' };
        return operation!;
      }),
      complete: vi.fn(),
      release: vi.fn(async () => true),
      read: vi.fn(async () => operation),
    } satisfies NonNullable<SameTaskAgentAdapterDependencies['downstreamOperations']>;
    const deps = dependencies({ downstreamOperations, terminalizeSubmissionUnknown });
    const adapter = createSameTaskAgentAdapter(deps);
    const adoption = await adapter.adopt({
      actor, taskId: 'task-1', request: request(), toolId: 'generate_image',
    });
    const submit = vi.fn(async () => {
      throw new Error('connection lost after submit');
    });

    await expect(adapter.executeAdoption({
      adoption,
      execute: async context => {
        await context.beginSubmission();
        return submit();
      },
    })).rejects.toMatchObject({ code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN' });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(terminalizeSubmissionUnknown).toHaveBeenCalledTimes(1);
    expect(terminalizeSubmissionUnknown).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN',
    }));
    expect(deps.completeExecution).toHaveBeenCalledTimes(1);
    expect(deps.releaseExecution).not.toHaveBeenCalled();
  });

  it('recovers two accepted provider steps independently without a third submit', async () => {
    const operations = new Map<string, AgentDownstreamOperation>();
    let parentClaimed = false;
    let parentCompleted = false;
    const downstreamOperations = {
      prepare: vi.fn(async input => {
        const existing = operations.get(input.operationKey);
        const current = existing ?? {
          ...input, status: 'prepared' as const, attempts: 0,
        };
        const claimed = !existing || !existing.leaseOwner;
        const next = {
          ...current,
          leaseOwner: claimed ? input.leaseOwner : current.leaseOwner,
          attempts: current.attempts + (claimed ? 1 : 0),
          claimed,
        } satisfies AgentDownstreamOperation;
        operations.set(input.operationKey, next);
        return next;
      }),
      markSubmitted: vi.fn(async input => {
        const next = { ...operations.get(input.operationKey)!, ...input, status: 'submitted' as const };
        operations.set(input.operationKey, next);
        return next;
      }),
      markAccepted: vi.fn(async input => {
        const next = { ...operations.get(input.operationKey)!, ...input, status: 'accepted' as const };
        operations.set(input.operationKey, next);
        return next;
      }),
      markSubmissionUnknown: vi.fn(async input => {
        const next = {
          ...operations.get(input.operationKey)!, ...input,
          status: 'submission_unknown' as const, leaseOwner: '',
        };
        operations.set(input.operationKey, next);
        return next;
      }),
      complete: vi.fn(async input => {
        const next = {
          ...operations.get(input.operationKey)!, ...input,
          status: 'completed' as const, response: input.response, leaseOwner: '',
        };
        operations.set(input.operationKey, next);
        return next;
      }),
      release: vi.fn(async input => {
        const current = operations.get(input.operationKey);
        if (!current || current.leaseOwner !== input.leaseOwner) return false;
        operations.set(input.operationKey, { ...current, leaseOwner: '' });
        return true;
      }),
      read: vi.fn(async input => operations.get(input.operationKey) ?? null),
    } satisfies NonNullable<SameTaskAgentAdapterDependencies['downstreamOperations']>;
    const deps = dependencies({
      downstreamOperations,
      claimExecution: vi.fn(async () => {
        if (parentClaimed || parentCompleted) return { claimed: false, leaseOwner: '' };
        parentClaimed = true;
        return { claimed: true, leaseOwner: 'parent-lease' };
      }),
      releaseExecution: vi.fn(async () => {
        parentClaimed = false;
        return true;
      }),
      completeExecution: vi.fn(async () => {
        parentClaimed = false;
        parentCompleted = true;
        return true;
      }),
    });
    const adapter = createSameTaskAgentAdapter(deps);
    const adoption = await adapter.adopt({
      actor, taskId: 'task-1', request: request(), toolId: 'generate_image',
    });
    const providerSubmit = vi.fn(async (stepId: string) => ({ providerTaskId: `${stepId}-accepted` }));
    const reconcile = vi.fn(async (providerTaskId: string) => ({
      imageUrl: `/${providerTaskId}.png`,
    }));
    let crashAfterSecondAcceptance = true;
    const execute = async (context: Parameters<Parameters<typeof adapter.executeAdoption>[0]['execute']>[0]) => {
      let imageUrl = '/original.png';
      for (let index = 0; index < 2; index++) {
        const stepId = `image-edit:${index}`;
        const result = await context.executeOperation({
          stepId,
          toolId: 'image_edit',
          requestDigest: `${index}`.repeat(64),
        }, async stepContext => {
          await stepContext.beginSubmission();
          const accepted = await providerSubmit(stepId);
          await stepContext.recordAccepted(accepted.providerTaskId);
          if (index === 1 && crashAfterSecondAcceptance) {
            crashAfterSecondAcceptance = false;
            throw new Error('crash after second acceptance');
          }
          return { imageUrl: `/${accepted.providerTaskId}.png` };
        }, { reconcile });
        imageUrl = result.imageUrl;
      }
      return imageUrl;
    };

    await expect(adapter.executeAdoption({ adoption, execute })).rejects.toThrow(
      'crash after second acceptance',
    );
    const recoveries = await Promise.all(Array.from({ length: 20 }, () => (
      adapter.executeAdoption({ adoption, execute })
    )));

    expect(providerSubmit).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(recoveries.filter(result => result.executed)).toHaveLength(1);
    const providerOperations = [...operations.values()].filter(operation => operation.stepId !== 'root');
    expect(providerOperations).toHaveLength(2);
    expect(providerOperations.map(operation => operation.providerTaskId).sort()).toEqual([
      'image-edit:0-accepted',
      'image-edit:1-accepted',
    ]);
    expect(providerOperations.every(operation => operation.status === 'completed')).toBe(true);
  });

  it('passes the claimed generation fence to a resumed execution and terminal observer', async () => {
    const deps = dependencies({
      claimExecution: vi.fn(async () => ({
        claimed: true, leaseOwner: 'lease-resume', generation: 4,
      })),
    });
    const adapter = createSameTaskAgentAdapter(deps);
    const adoption = await adapter.adopt({
      actor, taskId: 'task-1', request: request(), toolId: 'generate_image',
    });
    const execute = vi.fn(async () => ({ ok: true }));

    await adapter.executeAdoption({
      adoption,
      execute,
      resumeFromStepId: 'generate-2',
      expectedGeneration: 4,
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      resumeFromStepId: 'generate-2',
      executionFence: {
        runId: 'task-1', leaseOwner: 'lease-resume', generation: 4,
      },
    }));
    expect(deps.observeTerminal).toHaveBeenCalledWith(expect.objectContaining({
      leaseOwner: 'lease-resume', generation: 4,
    }));
  });
});
