import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  claim: vi.fn(),
  headers: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ getInternalRequestHeaders: mocks.headers }));
vi.mock('@/lib/agent-runtime/event-storage', () => ({
  appendAdoptedAgentEvent: mocks.append,
  claimResumedAgentExecutionDispatch: mocks.claim,
}));

import { dispatchResumedAgentExecution } from '@/lib/agent-runtime/execution-dispatch';

describe('resumed Agent execution dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue(true);
    mocks.append.mockResolvedValue({ inserted: true });
    mocks.headers.mockResolvedValue({ 'x-internal-request': 'true' });
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'processing' }) });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('claims one generation, projects queued to executing, and starts the existing recovery entry', async () => {
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
    }));
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/poll-task'),
      expect.objectContaining({
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ taskId: 'run-1' }),
      }));
  });

  it('does not create another Promise or request for an already dispatched generation', async () => {
    mocks.claim.mockResolvedValue(false);

    await expect(dispatchResumedAgentExecution({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      workspace: 'canvas', nextStepId: 'generate-2', generation: 3,
      leaseOwner: 'lease-3', signal: new AbortController().signal,
    })).resolves.toEqual({ started: false });
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
