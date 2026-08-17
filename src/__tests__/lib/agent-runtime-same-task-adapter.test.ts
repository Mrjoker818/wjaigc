import { describe, expect, it, vi } from 'vitest';

import {
  createSameTaskAgentAdapter,
  type SameTaskAgentAdapterDependencies,
} from '@/lib/agent-runtime/same-task-adapter';
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
      outputKinds: ['png'],
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
});
