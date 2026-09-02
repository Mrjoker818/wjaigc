import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  claim: vi.fn(),
  fail: vi.fn(),
  load: vi.fn(),
  executeAdoption: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/agent-runtime/event-storage', () => ({
  appendAdoptedAgentEvent: mocks.append,
  claimResumedAgentExecutionDispatch: mocks.claim,
  failResumedAgentExecutionDispatch: mocks.fail,
}));
vi.mock('@/lib/agent-runtime/same-task-adapter', () => ({
  loadResumableAdoptedAgentTask: mocks.load,
  executeAdoptedAgentTask: mocks.executeAdoption,
}));

import { dispatchResumedAgentExecution } from '@/lib/agent-runtime/execution-dispatch';
import type { AgentDownstreamExecutionContext } from '@/lib/agent-runtime/downstream-operations';

describe('resumed Agent execution dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ claimed: true, dispatchLeaseOwner: 'dispatch-1' });
    mocks.append.mockResolvedValue({ inserted: true });
    mocks.fail.mockResolvedValue(true);
    mocks.load.mockResolvedValue({
      adoption: { runId: 'run-1', toolId: 'generate-2' },
      execute: async (context: AgentDownstreamExecutionContext) => mocks.execute(context),
    });
    mocks.execute.mockResolvedValue({ imageUrl: '/continued.png' });
    mocks.executeAdoption.mockImplementation(async input => {
      const value = await input.execute({ recovery: true });
      return { executed: true, value };
    });
  });

  it('claims one generation and directly starts the same-task executor from nextStepId', async () => {
    const controller = new AbortController();
    const started = await dispatchResumedAgentExecution({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      workspace: 'canvas', nextStepId: 'generate-2', generation: 3,
      leaseOwner: 'lease-3', signal: controller.signal,
    });
    await started.completion;

    expect(started.started).toBe(true);
    expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool.started',
      payload: expect.objectContaining({ stepId: 'generate-2', generation: 3 }),
      executionFence: {
        runId: 'run-1', leaseOwner: 'lease-3', generation: 3,
      },
    }));
    expect(mocks.executeAdoption).toHaveBeenCalledWith(expect.objectContaining({
      adoption: expect.objectContaining({ runId: 'run-1' }),
      resumeFromStepId: 'generate-2',
      expectedGeneration: 3,
      leaseOwner: 'lease-3',
      execute: expect.any(Function),
    }));
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      resumeFromStepId: 'generate-2',
      generation: 3,
      leaseOwner: 'lease-3',
      signal: controller.signal,
    }));
  });

  it('does not create another Promise or request for an already dispatched generation', async () => {
    mocks.claim.mockResolvedValue({ claimed: false, dispatchLeaseOwner: '' });

    await expect(dispatchResumedAgentExecution({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      workspace: 'canvas', nextStepId: 'generate-2', generation: 3,
      leaseOwner: 'lease-3', signal: new AbortController().signal,
    })).resolves.toEqual({ started: false });
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.executeAdoption).not.toHaveBeenCalled();
  });

  it('releases a failed dispatch claim and persists a retry-visible event', async () => {
    mocks.executeAdoption.mockRejectedValue(new Error('executor unavailable'));
    const started = await dispatchResumedAgentExecution({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      workspace: 'canvas', nextStepId: 'generate-2', generation: 3,
      leaseOwner: 'lease-3', signal: new AbortController().signal,
    });

    await expect(started.completion).rejects.toThrow('executor unavailable');
    await expect(started.completion).rejects.toMatchObject({
      dispatchFailurePersisted: true,
    });
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', generation: 3, dispatchLeaseOwner: 'dispatch-1',
      error: 'executor unavailable',
    }));
  });
});
