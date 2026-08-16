import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as agentRuntime from '@/lib/agent-runtime/service';
import type { AgentRuntimeDependencies } from '@/lib/agent-runtime/service';
import type { AgentEvent, AgentRunRequest } from '@/lib/agent-runtime/types';
import type { User } from '@/lib/user-types';

const authMocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => authMocks);

const user: User = {
  id: 'user-1',
  name: 'Agent user',
  role: 'user',
  status: 'active',
  productType: 'canvas,chat',
  createdAt: 1,
  updatedAt: 1,
};

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    projectId: 'project-1',
    workspace: 'canvas',
    workspaceId: 'canvas-1',
    mode: 'agent',
    providerId: 'provider-exact',
    modelId: 'model-exact',
    prompt: 'Create a poster',
    sourceVersionIds: [],
    allowedToolIds: ['generate_image'],
    idempotencyKey: 'agent-request-1',
    context: {
      selectedEntityIds: [],
      visibleVersionIds: [],
      locale: 'zh-CN',
    },
    ...overrides,
  };
}

function event(
  sequence: number,
  type: AgentEvent['type'],
  payload: Record<string, unknown> = {},
): AgentEvent {
  return {
    eventId: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    type,
    timestamp: new Date(sequence).toISOString(),
    payload,
  };
}

function serviceDependencies() {
  const created = event(1, 'run.created');
  const task = {
    id: 'run-1',
    userId: user.id,
    projectId: 'project-1',
    type: 'agent-run',
    status: 'processing' as const,
    progress: 0,
    result: { workspace: 'canvas' },
    creditStatus: 'pending' as const,
    creditCost: 7,
    createdAt: 1,
    updatedAt: 1,
    revision: 0,
  };
  return {
    randomUUID: vi.fn(() => 'run-1'),
    now: vi.fn(() => 1_700_000_000_000),
    resolveTaskModel: vi.fn<AgentRuntimeDependencies['resolveTaskModel']>(async () => ({
      providerId: 'provider-exact',
      modelId: 'model-exact',
      kind: 'image' as const,
      protocol: 'images',
      executionMode: 'async' as const,
      allowedRatios: [],
      allowedSizes: [],
      qualityOptions: [],
      maxOutputs: 1,
      supportsReferenceImages: false,
      supportsMask: false,
      outputKinds: ['png'],
    })),
    authorizeContext: vi.fn<AgentRuntimeDependencies['authorizeContext']>(async ({ request: input }) => input.context),
    calculateCreditCost: vi.fn<AgentRuntimeDependencies['calculateCreditCost']>(async () => 7),
    createBillableTask: vi.fn<AgentRuntimeDependencies['createBillableTask']>(async input => ({
      task: {
        ...input.task,
        userId: input.userId,
        creditStatus: 'pending' as const,
        creditCost: input.creditCost,
        idempotencyKey: input.idempotencyKey,
        revision: input.task.revision ?? 0,
      },
      reused: false,
      charged: true,
    })),
    appendEvent: vi.fn<AgentRuntimeDependencies['appendEvent']>(async () => created),
    listEvents: vi.fn<AgentRuntimeDependencies['listEvents']>(async () => [created]),
    listRunEventStreams: vi.fn<AgentRuntimeDependencies['listRunEventStreams']>(async () => [[created]]),
    getTaskForUser: vi.fn<AgentRuntimeDependencies['getTaskForUser']>(async () => task),
    transitionTask: vi.fn<AgentRuntimeDependencies['transitionTask']>(async () => ({
      transitioned: true,
      task,
    })),
    settleFailedTask: vi.fn<AgentRuntimeDependencies['settleFailedTask']>(async () => ({
      transitioned: true,
      refunded: true,
    })),
    abortTaskExecution: vi.fn<AgentRuntimeDependencies['abortTaskExecution']>(() => true),
  } satisfies AgentRuntimeDependencies;
}

describe('Agent runtime service', () => {
  it('lists only the authenticated actor Agent projections from persisted event streams', async () => {
    const firstRun = [event(1, 'run.created')];
    const secondRun = [
      { ...event(1, 'run.created'), eventId: 'run-2-created', runId: 'run-2' },
      { ...event(2, 'run.completed'), eventId: 'run-2-completed', runId: 'run-2' },
    ];
    const dependencies = {
      ...serviceDependencies(),
      listRunEventStreams: vi.fn(async () => [secondRun, firstRun]),
    } as unknown as AgentRuntimeDependencies;
    const service = agentRuntime.createAgentRuntimeService(dependencies) as ReturnType<
      typeof agentRuntime.createAgentRuntimeService
    > & {
      listRuns?: (input: { actorUserId: string; limit?: number }) => Promise<unknown[]>;
    };

    expect(service.listRuns).toBeTypeOf('function');
    if (!service.listRuns) return;

    const projections = await service.listRuns({ actorUserId: user.id, limit: 25 });

    expect(dependencies.listRunEventStreams).toHaveBeenCalledWith({
      actorUserId: user.id,
      limit: 25,
    });
    expect(projections).toEqual([
      expect.objectContaining({ runId: 'run-2', status: 'completed' }),
      expect.objectContaining({ runId: 'run-1', status: 'created' }),
    ]);
  });

  it('rejects client credential material before model resolution or persistence', () => {
    expect(() => agentRuntime.parseAgentRunRequest({
      ...request(),
      apiKey: 'never-accepted',
    })).toThrow('Agent run request contains sensitive data');
  });

  it('rejects recursively nested client credential fields before parsing context', () => {
    expect(() => agentRuntime.parseAgentRunRequest({
      ...request(),
      context: {
        ...request().context,
        metadata: { accessToken: 'never-accepted' },
      },
    })).toThrow('Agent run request contains sensitive data');
  });

  it('authorizes the explicit provider and model and creates one billable durable run', async () => {
    const dependencies = serviceDependencies();
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    const result = await service.createRun({ actor: user, request: request() });

    expect(dependencies.resolveTaskModel).toHaveBeenCalledTimes(1);
    expect(dependencies.resolveTaskModel).toHaveBeenCalledWith(
      'provider-exact',
      'model-exact',
      user.id,
    );
    expect(dependencies.createBillableTask).toHaveBeenCalledTimes(1);
    expect(dependencies.createBillableTask).toHaveBeenCalledWith(expect.objectContaining({
      userId: user.id,
      idempotencyKey: 'agent-request-1',
      creditCost: 7,
      task: expect.objectContaining({
        id: 'run-1',
        projectId: 'project-1',
        providerId: 'provider-exact',
        model: 'model-exact',
        type: 'agent-run',
      }),
    }));
    expect(result).toMatchObject({
      reused: false,
      charged: true,
      projection: { runId: 'run-1', status: 'created', lastSequence: 1 },
    });
  });

  it('fails closed when requested tools are not authorized by the exact model', async () => {
    const dependencies = serviceDependencies();
    dependencies.resolveTaskModel.mockResolvedValue({
      providerId: 'provider-exact',
      modelId: 'model-exact',
      kind: 'chat',
      protocol: 'chat-completions',
      executionMode: 'sync',
      allowedRatios: [],
      allowedSizes: [],
      qualityOptions: [],
      maxOutputs: 1,
      supportsReferenceImages: false,
      supportsMask: false,
      outputKinds: ['text'],
    });
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.createRun({ actor: user, request: request() })).rejects.toMatchObject({
      code: 'AGENT_TOOL_AUTHORIZATION_DENIED',
      status: 403,
    });
    expect(dependencies.createBillableTask).not.toHaveBeenCalled();
  });

  it('does not try another provider or bill when the explicit model is rejected', async () => {
    const dependencies = serviceDependencies();
    dependencies.resolveTaskModel.mockRejectedValue(
      new Error('Explicit provider/model is not authorized'),
    );
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.createRun({ actor: user, request: request() })).rejects.toThrow(
      'Explicit provider/model is not authorized',
    );
    expect(dependencies.resolveTaskModel).toHaveBeenCalledTimes(1);
    expect(dependencies.resolveTaskModel).toHaveBeenCalledWith(
      'provider-exact',
      'model-exact',
      user.id,
    );
    expect(dependencies.createBillableTask).not.toHaveBeenCalled();
  });

  it('settles cancellation once through the existing failure settlement path', async () => {
    const dependencies = serviceDependencies();
    const cancelled = event(2, 'run.cancelled');
    dependencies.appendEvent.mockResolvedValue(cancelled);
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created'),
      cancelled,
    ]);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    const result = await service.cancelRun({ actorUserId: user.id, runId: 'run-1' });

    expect(dependencies.abortTaskExecution).toHaveBeenCalledWith('run-1', 'cancelled');
    expect(dependencies.settleFailedTask).toHaveBeenCalledTimes(1);
    expect(dependencies.settleFailedTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'run-1',
      status: 'cancelled',
    }));
    expect(dependencies.transitionTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({ accepted: true, projection: { status: 'cancelled' } });
  });

  it('finalizes the existing pending charge when completion wins', async () => {
    const dependencies = serviceDependencies();
    const completed = event(2, 'run.completed', {
      result: { imageUrl: '/winner.png' },
    });
    dependencies.appendEvent.mockResolvedValue(completed);
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created'),
      completed,
    ]);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    const result = await service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: completed.eventId,
      type: completed.type,
      payload: completed.payload,
    });

    expect(result).toMatchObject({ accepted: true, projection: { status: 'completed' } });
    expect(dependencies.transitionTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'run-1',
      to: 'completed',
      creditStatus: 'charged',
      result: { imageUrl: '/winner.png' },
    }));
    expect(dependencies.settleFailedTask).not.toHaveBeenCalled();
  });

  it('ignores late completion without changing task result or settlement', async () => {
    const dependencies = serviceDependencies();
    const completed = event(3, 'run.completed', {
      result: { imageUrl: '/late.png' },
    });
    dependencies.appendEvent.mockResolvedValue(completed);
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created'),
      event(2, 'run.cancelled'),
      completed,
    ]);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    const result = await service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: completed.eventId,
      type: completed.type,
      payload: completed.payload,
    });

    expect(result).toMatchObject({ accepted: false, projection: { status: 'cancelled' } });
    expect(dependencies.transitionTask).not.toHaveBeenCalled();
    expect(dependencies.settleFailedTask).not.toHaveBeenCalled();
  });

  it('returns one generic not-found error for an unowned run', async () => {
    const dependencies = serviceDependencies();
    dependencies.getTaskForUser.mockResolvedValue(null);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.listEvents({
      actorUserId: 'other-user',
      runId: 'run-1',
      afterSequence: 0,
    })).rejects.toMatchObject({
      code: 'AGENT_RUN_NOT_FOUND',
      status: 404,
      message: 'Agent run not found',
    });
  });
});

describe('Agent run API routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authMocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: user.id,
      userRole: 'user',
      user,
      source: 'cookie',
    });
  });

  it('creates a run for the authenticated actor and never accepts a body userId', async () => {
    const createRun = vi.spyOn(agentRuntime, 'createAgentRun').mockResolvedValue({
      runId: 'run-1',
      reused: false,
      charged: true,
      event: event(1, 'run.created'),
      projection: {
        runId: 'run-1',
        status: 'created',
        lastSequence: 1,
        plan: [],
        assetVersionIds: [],
        ignoredEventIds: [],
        missingSequences: [],
      },
      tools: [],
    });
    const { POST } = await import('@/app/api/agent-runs/route');
    const response = await POST(new NextRequest('http://localhost/api/agent-runs', {
      method: 'POST',
      body: JSON.stringify({ ...request(), userId: 'attacker-user' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      actor: user,
      request: expect.objectContaining({ providerId: 'provider-exact', modelId: 'model-exact' }),
    }));
    expect(JSON.stringify(createRun.mock.calls[0])).not.toContain('attacker-user');
  });

  it('lists only current-user Agent runs with a bounded limit', async () => {
    const runtimeModule = agentRuntime as typeof agentRuntime & {
      listCurrentUserAgentRuns?: (input: {
        actorUserId: string;
        limit?: number;
      }) => Promise<unknown[]>;
    };
    expect(runtimeModule.listCurrentUserAgentRuns).toBeTypeOf('function');
    if (!runtimeModule.listCurrentUserAgentRuns) return;
    const listRuns = vi.spyOn(runtimeModule, 'listCurrentUserAgentRuns').mockResolvedValue([
      {
        runId: 'run-1',
        status: 'created',
        lastSequence: 1,
        plan: [],
        assetVersionIds: [],
        ignoredEventIds: [],
        missingSequences: [],
      },
    ]);
    const route = await import('@/app/api/agent-runs/route');
    expect(route.GET).toBeTypeOf('function');
    if (!route.GET) return;

    const response = await route.GET(
      new NextRequest('http://localhost/api/agent-runs?limit=25'),
    );

    expect(response.status).toBe(200);
    expect(listRuns).toHaveBeenCalledWith({ actorUserId: user.id, limit: 25 });
    await expect(response.json()).resolves.toEqual({
      runs: [expect.objectContaining({ runId: 'run-1', status: 'created' })],
    });
  });

  it('lists events after the requested cursor for the authenticated actor', async () => {
    const listEvents = vi.spyOn(agentRuntime, 'listAgentRunEvents').mockResolvedValue([
      event(5, 'tool.progress'),
    ]);
    const { GET } = await import('@/app/api/agent-runs/[runId]/events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/agent-runs/run-1/events?after=4'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(200);
    expect(listEvents).toHaveBeenCalledWith({
      actorUserId: user.id,
      runId: 'run-1',
      afterSequence: 4,
    });
  });

  it('keeps event appends server-side and exposes only incremental GET', async () => {
    const route = await import('@/app/api/agent-runs/[runId]/events/route');

    expect('POST' in route).toBe(false);
  });

  it('rejects an invalid event cursor as a client request error', async () => {
    const listEvents = vi.spyOn(agentRuntime, 'listAgentRunEvents');
    const { GET } = await import('@/app/api/agent-runs/[runId]/events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/agent-runs/run-1/events?after=not-a-number'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(400);
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('reuses the service cancellation path for DELETE', async () => {
    const cancelRun = vi.spyOn(agentRuntime, 'cancelAgentRun').mockResolvedValue({
      accepted: true,
      event: event(2, 'run.cancelled'),
      projection: {
        runId: 'run-1',
        status: 'cancelled',
        lastSequence: 2,
        plan: [],
        assetVersionIds: [],
        ignoredEventIds: [],
        missingSequences: [],
      },
    });
    const { DELETE } = await import('@/app/api/agent-runs/[runId]/route');
    const response = await DELETE(
      new NextRequest('http://localhost/api/agent-runs/run-1', { method: 'DELETE' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(200);
    expect(cancelRun).toHaveBeenCalledWith({ actorUserId: user.id, runId: 'run-1' });
  });

  it('returns the same generic 404 for an unowned events request', async () => {
    vi.spyOn(agentRuntime, 'listAgentRunEvents').mockRejectedValue(
      new agentRuntime.AgentRunNotFoundError(),
    );
    const { GET } = await import('@/app/api/agent-runs/[runId]/events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/agent-runs/hidden-run/events'),
      { params: Promise.resolve({ runId: 'hidden-run' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'AGENT_RUN_NOT_FOUND', message: 'Agent run not found' },
    });
  });

  it('returns the authentication response without invoking the service', async () => {
    const authenticationResponse = NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    );
    authMocks.requireApiAuthOrReject.mockResolvedValue(authenticationResponse);
    const createRun = vi.spyOn(agentRuntime, 'createAgentRun');
    const { POST } = await import('@/app/api/agent-runs/route');
    const response = await POST(new NextRequest('http://localhost/api/agent-runs', {
      method: 'POST',
      body: JSON.stringify(request()),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(401);
    expect(createRun).not.toHaveBeenCalled();
  });
});
