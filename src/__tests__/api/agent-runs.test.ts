import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as agentRuntime from '@/lib/agent-runtime/service';
import type { AgentRuntimeDependencies } from '@/lib/agent-runtime/service';
import { AgentEventConflictError } from '@/lib/agent-runtime/event-storage';
import type { AgentEvent, AgentRunRequest } from '@/lib/agent-runtime/types';
import type { CloudTask } from '@/lib/cloud-task-storage';
import type { User } from '@/lib/user-types';
import { requireSkillForSurface } from '@/lib/skill-runtime/catalog';
import { resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';
import { compileSkillPrompt } from '@/lib/skill-runtime/prompt-compiler';

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
  const eventPayload = type === 'run.created' && !('workspace' in payload)
    ? { ...payload, workspace: 'canvas' }
    : payload;
  return {
    eventId: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    type,
    timestamp: new Date(sequence).toISOString(),
    payload: eventPayload,
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
      kind: 'chat' as const,
      sourceType: 'chat' as const,
      protocol: 'chat-completions',
      executionMode: 'sync' as const,
      allowedRatios: [],
      allowedSizes: [],
      qualityOptions: [],
      maxOutputs: 1,
      supportsReferenceImages: false,
      supportsMask: false,
      outputKinds: ['text'],
      capabilitySources: {},
    })),
    authorizeContext: vi.fn<AgentRuntimeDependencies['authorizeContext']>(async ({ request: input }) => ({
      snapshot: input.context, mediaByVersionId: {}, selectedEntityVersionIds: {},
    })),
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
    transitionControl: vi.fn<NonNullable<AgentRuntimeDependencies['transitionControl']>>(async () => ({
      accepted: false,
      event: created,
      events: [created],
      leaseOwner: '',
    })),
    listEvents: vi.fn<AgentRuntimeDependencies['listEvents']>(async () => [created]),
    listRunEventStreams: vi.fn<AgentRuntimeDependencies['listRunEventStreams']>(async () => [[created]]),
    getTaskForUser: vi.fn<AgentRuntimeDependencies['getTaskForUser']>(async () => task),
    transitionTask: vi.fn<AgentRuntimeDependencies['transitionTask']>(async () => ({
      transitioned: true,
      task: { ...task, status: 'completed' as const },
    })),
    settleFailedTask: vi.fn<AgentRuntimeDependencies['settleFailedTask']>(async () => ({
      transitioned: true,
      refunded: true,
    })),
    abortTaskExecution: vi.fn<AgentRuntimeDependencies['abortTaskExecution']>(() => true),
    dispatchExecution: vi.fn<NonNullable<AgentRuntimeDependencies['dispatchExecution']>>(async () => ({
      started: true,
    })),
  } satisfies AgentRuntimeDependencies;
}

function canvasSkillRequest(
  overrides: Partial<AgentRunRequest> = {},
  bindingOverrides: Record<string, { providerId: string; modelId: string }> = {},
): AgentRunRequest {
  const definition = requireSkillForSurface('preset-ecommerce-listing', 'canvas');
  const inputValues = resolveSkillInputs(definition, {
    product: '耳机',
    features: '降噪，长续航',
  });
  return request({
    prompt: compileSkillPrompt(definition.systemPrompt, inputValues),
    allowedToolIds: ['generate_image'],
    skill: {
      skillId: definition.id,
      skillVersion: definition.version,
      inputValues,
      modelBindings: {
        orchestrator: { providerId: 'provider-exact', modelId: 'model-exact' },
        image: { providerId: 'provider-image', modelId: 'model-image' },
        ...bindingOverrides,
      },
    },
    ...overrides,
  });
}

function simpleChatSkillRequest(): AgentRunRequest {
  const definition = requireSkillForSurface('ppt-master', 'simple-chat');
  const inputValues = resolveSkillInputs(definition, {});
  return request({
    workspace: 'chat',
    workspaceId: 'chat-1',
    prompt: compileSkillPrompt(definition.systemPrompt, inputValues),
    allowedToolIds: [],
    skill: {
      skillId: definition.id,
      skillVersion: definition.version,
      inputValues,
      modelBindings: {
        orchestrator: { providerId: 'provider-exact', modelId: 'model-exact' },
      },
    },
  });
}

describe('Agent runtime service', () => {
  it('parses a versioned Skill invocation into the durable run request', () => {
    const skill = {
      skillId: 'skill-poster',
      skillVersion: 3,
      inputValues: { headline: 'Launch' },
      modelBindings: {
        image: { providerId: 'provider-exact', modelId: 'model-exact' },
      },
    };

    expect(agentRuntime.parseAgentRunRequest(request({ skill }))).toMatchObject({ skill });
    expect(() => agentRuntime.parseAgentRunRequest(request({
      skill: { ...skill, skillVersion: 0 },
    }))).toThrowError('skill.skillVersion is invalid');
  });

  it('persists pause before aborting and does not settle credits', async () => {
    const dependencies = serviceDependencies();
    const paused = event(2, 'run.paused', { nextStepId: 'generate-2' });
    dependencies.transitionControl = vi.fn(async () => ({
      accepted: true,
      event: paused,
      events: [event(1, 'run.created'), paused],
      leaseOwner: '',
    }));
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    const result = await service.pauseRun({
      actorUserId: user.id,
      runId: 'run-1',
      nextStepId: 'generate-2',
    });

    expect(result.projection.status).toBe('paused');
    expect(dependencies.transitionControl).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run.paused',
      expectedRevision: 0,
    }));
    expect(dependencies.transitionControl.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.abortTaskExecution.mock.invocationCallOrder[0],
    );
    expect(dependencies.transitionTask).not.toHaveBeenCalled();
    expect(dependencies.settleFailedTask).not.toHaveBeenCalled();
  });

  it('passes an execution-error pause fence into the atomic control transition', async () => {
    const dependencies = serviceDependencies();
    const fence = { runId: 'run-1', leaseOwner: 'lease-old', generation: 7 };
    const paused = event(2, 'run.paused', {
      nextStepId: 'generate-2', pauseReason: 'execution-error',
    });
    dependencies.transitionControl = vi.fn(async input => {
      expect(input.executionFence).toEqual(fence);
      return {
        accepted: true, event: paused,
        events: [event(1, 'run.created'), paused], leaseOwner: '',
      };
    });
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await service.pauseRun({
      actorUserId: user.id, runId: 'run-1', nextStepId: 'generate-2',
      pauseReason: 'execution-error', executionFence: fence,
    });

    expect(dependencies.transitionControl).toHaveBeenCalledWith(expect.objectContaining({
      executionFence: fence,
      payload: { nextStepId: 'generate-2', pauseReason: 'execution-error' },
    }));
  });

  it('does not abort an initial execution when pause persistence fails', async () => {
    const dependencies = serviceDependencies();
    dependencies.transitionControl = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.pauseRun({
      actorUserId: user.id,
      runId: 'run-1',
      nextStepId: 'generate-2',
    })).rejects.toThrow('database unavailable');

    expect(dependencies.abortTaskExecution).not.toHaveBeenCalled();
  });

  it('resumes with a new durable lease and dispatches a fresh execution from the persisted next step', async () => {
    const dependencies = serviceDependencies();
    const paused = event(2, 'run.paused', { nextStepId: 'generate-2' });
    const resumed = event(3, 'run.resumed', {
      nextStepId: 'generate-2', generation: 2,
    });
    dependencies.listEvents.mockResolvedValue([event(1, 'run.created'), paused]);
    dependencies.transitionControl = vi.fn(async () => ({
      accepted: true,
      event: resumed,
      events: [event(1, 'run.created'), paused, resumed],
      leaseOwner: 'lease-new',
    }));
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    const result = await service.resumeRun({ actorUserId: user.id, runId: 'run-1' });

    expect(result).toMatchObject({
      accepted: true,
      leaseOwner: 'lease-new',
      projection: { status: 'queued', resumeFromStepId: 'generate-2' },
    });
    expect(dependencies.transitionControl).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run.resumed',
      payload: expect.objectContaining({ nextStepId: 'generate-2' }),
    }));
    expect(dependencies.dispatchExecution).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      nextStepId: 'generate-2',
      generation: 1,
      leaseOwner: 'lease-new',
      signal: expect.any(AbortSignal),
    }));
    expect(result.dispatch).toEqual({ started: true });
  });

  it('persists a visible retry event when the resumed background execution rejects', async () => {
    const dependencies = serviceDependencies();
    const paused = event(2, 'run.paused', { nextStepId: 'generate-2' });
    const resumed = event(3, 'run.resumed', {
      nextStepId: 'generate-2', generation: 1,
    });
    dependencies.listEvents.mockResolvedValue([event(1, 'run.created'), paused]);
    dependencies.transitionControl = vi.fn(async () => ({
      accepted: true, event: resumed,
      events: [event(1, 'run.created'), paused, resumed],
      leaseOwner: 'lease-new',
    }));
    dependencies.dispatchExecution.mockResolvedValue({
      started: true,
      completion: Promise.reject(new Error('background executor failed')),
    });
    const recordFailure = vi.fn(async () => undefined);
    const service = agentRuntime.createAgentRuntimeService({
      ...dependencies,
      recordDispatchCompletionFailure: recordFailure,
    });

    await service.resumeRun({ actorUserId: user.id, runId: 'run-1' });
    await vi.waitFor(() => expect(recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', nextStepId: 'generate-2', generation: 1 }),
      expect.objectContaining({ message: 'background executor failed' }),
    ));
  });

  it('does not append a second retry event when the dispatcher already persisted the failure', async () => {
    const dependencies = serviceDependencies();
    const paused = event(2, 'run.paused', { nextStepId: 'generate-2' });
    const resumed = event(3, 'run.resumed', {
      nextStepId: 'generate-2', generation: 1,
    });
    dependencies.listEvents.mockResolvedValue([event(1, 'run.created'), paused]);
    dependencies.transitionControl = vi.fn(async () => ({
      accepted: true, event: resumed,
      events: [event(1, 'run.created'), paused, resumed],
      leaseOwner: 'lease-new',
    }));
    const persistedFailure = Object.assign(new Error('background executor failed'), {
      dispatchFailurePersisted: true as const,
    });
    dependencies.dispatchExecution.mockResolvedValue({
      started: true,
      completion: Promise.reject(persistedFailure),
    });
    const recordFailure = vi.fn(async () => undefined);
    const service = agentRuntime.createAgentRuntimeService({
      ...dependencies,
      recordDispatchCompletionFailure: recordFailure,
    });

    await service.resumeRun({ actorUserId: user.id, runId: 'run-1' });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('retries the abort for an identical repeated pause after a commit-before-abort crash', async () => {
    const dependencies = serviceDependencies();
    const paused = event(2, 'run.paused', { nextStepId: 'generate-2' });
    dependencies.listEvents.mockResolvedValue([event(1, 'run.created'), paused]);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.pauseRun({
      actorUserId: user.id, runId: 'run-1', nextStepId: 'generate-2',
    })).resolves.toMatchObject({ accepted: true, event: paused, projection: { status: 'paused' } });
    expect(dependencies.transitionControl).not.toHaveBeenCalled();
    expect(dependencies.abortTaskExecution).toHaveBeenCalledWith('run-1', 'replaced');
  });

  it('rejects a repeated pause with a different next step', async () => {
    const dependencies = serviceDependencies();
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created'),
      event(2, 'run.paused', { nextStepId: 'generate-2' }),
    ]);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.pauseRun({
      actorUserId: user.id, runId: 'run-1', nextStepId: 'quality-3',
    })).rejects.toMatchObject({ code: 'AGENT_EVENT_CONFLICT', status: 409 });
    expect(dependencies.abortTaskExecution).not.toHaveBeenCalled();
  });

  it('retries resume against the persisted event without replacing its lease', async () => {
    const dependencies = serviceDependencies();
    const resumed = event(3, 'run.resumed', { nextStepId: 'generate-2', generation: 1 });
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created'),
      event(2, 'run.paused', { nextStepId: 'generate-2' }),
      resumed,
    ]);
    dependencies.transitionControl = vi.fn(async () => ({
      accepted: true,
      event: resumed,
      events: await dependencies.listEvents({
        actorUserId: user.id, projectId: 'project-1', runId: 'run-1',
      }),
      leaseOwner: 'lease-existing',
    }));
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.resumeRun({ actorUserId: user.id, runId: 'run-1' }))
      .resolves.toMatchObject({ accepted: true, leaseOwner: 'lease-existing' });
    expect(dependencies.transitionControl).toHaveBeenCalledWith(expect.objectContaining({
      eventId: resumed.eventId,
      payload: resumed.payload,
    }));
  });

  it('cancels a paused run through the single terminal refund settlement', async () => {
    const dependencies = serviceDependencies();
    const paused = event(2, 'run.paused', { nextStepId: 'generate-2' });
    const cancelled = event(3, 'run.cancelled');
    dependencies.appendEvent.mockResolvedValue(cancelled);
    dependencies.listEvents
      .mockResolvedValueOnce([event(1, 'run.created'), paused])
      .mockResolvedValueOnce([event(1, 'run.created'), paused, cancelled]);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.cancelRun({ actorUserId: user.id, runId: 'run-1' }))
      .resolves.toMatchObject({ accepted: true, projection: { status: 'cancelled' } });
    expect(dependencies.settleFailedTask).toHaveBeenCalledTimes(1);
    expect(dependencies.settleFailedTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'run-1', status: 'cancelled', expectedRevision: 0,
    }));
    expect(dependencies.abortTaskExecution).toHaveBeenCalledTimes(1);
  });


  it('does not expose a shadow-observed durable task as a cancellable Agent run', async () => {
    const dependencies = {
      ...serviceDependencies(),
      getTaskForUser: vi.fn(async () => ({
        id: 'run-1', userId: user.id, projectId: 'project-1', type: 'image',
        status: 'processing', progress: 10, creditStatus: 'charged', creditCost: 7,
        createdAt: 1, updatedAt: 2, revision: 1,
      } as CloudTask)),
      listEvents: vi.fn(async () => [
        event(1, 'run.created', { workspace: 'canvas', observed: true }),
      ]),
    } as unknown as AgentRuntimeDependencies;
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.cancelRun({
      actorUserId: user.id,
      runId: 'run-1',
    })).rejects.toMatchObject({ code: 'AGENT_RUN_NOT_FOUND', status: 404 });
    expect(dependencies.abortTaskExecution).not.toHaveBeenCalled();
    expect(dependencies.transitionTask).not.toHaveBeenCalled();
  });

  it('materializes an adopted run terminal event from the settled durable task on recovery', async () => {
    const events = [
      event(1, 'run.created', { workspace: 'canvas', adopted: true }),
      event(2, 'tool.started', { toolId: 'generate_image' }),
    ];
    const terminal = event(3, 'run.completed', { result: { taskId: 'run-1' } });
    const dependencies = {
      ...serviceDependencies(),
      getTaskForUser: vi.fn(async () => ({
        id: 'run-1', userId: user.id, projectId: 'project-1', type: 'image',
        status: 'completed', progress: 100, creditStatus: 'consumed', creditCost: 7,
        result: { imageUrl: '/done.png' }, createdAt: 1, updatedAt: 2, revision: 2,
      })),
      listEvents: vi.fn(async () => events),
      observeAdoptedTerminal: vi.fn(async () => {
        events.push(terminal);
        return [terminal];
      }),
    } as unknown as AgentRuntimeDependencies;
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.listEvents({
      actorUserId: user.id,
      runId: 'run-1',
      afterSequence: 2,
    })).resolves.toEqual([terminal]);
    expect(dependencies.observeAdoptedTerminal).toHaveBeenCalledWith({
      actorUserId: user.id,
      projectId: 'project-1',
      runId: 'run-1',
      workspace: 'canvas',
      toolId: 'generate_image',
    });
  });

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
      capabilitySources: {},
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

  it('does not infer vision authorization from reference-image input support', async () => {
    const dependencies = serviceDependencies();
    dependencies.resolveTaskModel.mockResolvedValue({
      providerId: 'provider-exact',
      modelId: 'reference-image-model',
      kind: 'image',
      sourceType: 'image',
      protocol: 'images',
      executionMode: 'async',
      allowedRatios: [],
      allowedSizes: [],
      qualityOptions: [],
      maxOutputs: 1,
      supportsReferenceImages: true,
      supportsMask: false,
      outputKinds: ['png'],
      capabilitySources: {},
    });
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.createRun({
      actor: user,
      request: request({ allowedToolIds: ['analyze_image'] }),
    })).rejects.toMatchObject({
      code: 'AGENT_TOOL_AUTHORIZATION_DENIED',
      denials: [{ toolId: 'analyze_image', code: 'MODEL_CAPABILITY_REQUIRED' }],
    });
    expect(dependencies.createBillableTask).not.toHaveBeenCalled();
  });

  it('authorizes image analysis only for an explicitly classified VLM', async () => {
    const dependencies = serviceDependencies();
    dependencies.resolveTaskModel.mockResolvedValue({
      providerId: 'provider-exact',
      modelId: 'vision-model',
      kind: 'chat',
      sourceType: 'vlm',
      protocol: 'chat-completions',
      executionMode: 'sync',
      allowedRatios: [],
      allowedSizes: [],
      qualityOptions: [],
      maxOutputs: 1,
      supportsReferenceImages: true,
      supportsMask: false,
      outputKinds: ['text'],
      capabilitySources: {},
    });
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.createRun({
      actor: user,
      request: request({ allowedToolIds: ['analyze_image'] }),
    })).resolves.toMatchObject({
      tools: [expect.objectContaining({ toolId: 'analyze_image' })],
    });
  });

  it('settles cancellation once through the existing failure settlement path', async () => {
    const dependencies = serviceDependencies();
    const cancelled = event(2, 'run.cancelled');
    dependencies.appendEvent.mockResolvedValue(cancelled);
    dependencies.listEvents
      .mockResolvedValueOnce([event(1, 'run.created')])
      .mockResolvedValueOnce([event(1, 'run.created'), cancelled]);
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
    dependencies.listEvents
      .mockResolvedValueOnce([event(1, 'run.created')])
      .mockResolvedValueOnce([event(1, 'run.created'), completed]);
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
      revision: 0,
      creditStatus: 'charged',
      result: { imageUrl: '/winner.png' },
    }));
    expect(dependencies.settleFailedTask).not.toHaveBeenCalled();
    expect(dependencies.transitionTask.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.appendEvent.mock.invocationCallOrder[0],
    );
  });

  it.each([
    {
      name: 'secret-bearing completion',
      type: 'run.completed' as const,
      payload: { result: { apiKey: 'never-persist-this' } },
    },
    {
      name: 'oversized failure',
      type: 'run.failed' as const,
      payload: {
        error: {
          code: 'MODEL_FAILED',
          message: 'x'.repeat(256 * 1024 + 1),
          retryable: true,
        },
      },
    },
    {
      name: 'unserializable completion',
      type: 'run.completed' as const,
      payload: { result: { value: BigInt(1) } },
    },
  ])('rejects $name before terminal settlement', async ({ type, payload }) => {
    const dependencies = serviceDependencies();
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created', { workspace: 'canvas' }),
    ]);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: 'invalid-terminal',
      type,
      payload,
    })).rejects.toBeInstanceOf(Error);

    expect(dependencies.transitionTask).not.toHaveBeenCalled();
    expect(dependencies.settleFailedTask).not.toHaveBeenCalled();
    expect(dependencies.appendEvent).not.toHaveBeenCalled();
  });

  it('uses the immutable run.created workspace for an exact terminal retry', async () => {
    const dependencies = serviceDependencies();
    const created = event(1, 'run.created', { workspace: 'canvas' });
    const completed = event(2, 'run.completed', {
      result: { imageUrl: '/winner.png', workspace: 'workflow' },
    });
    dependencies.getTaskForUser.mockResolvedValue({
      id: 'run-1',
      userId: user.id,
      projectId: 'project-1',
      type: 'agent-run',
      status: 'completed',
      progress: 100,
      result: completed.payload.result as Record<string, unknown>,
      creditStatus: 'charged',
      creditCost: 7,
      createdAt: 1,
      updatedAt: 2,
      revision: 3,
    });
    dependencies.listEvents.mockResolvedValue([created, completed]);
    dependencies.appendEvent.mockImplementation(async input => {
      expect(input.workspace).toBe('canvas');
      return completed;
    });
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: completed.eventId,
      type: completed.type,
      payload: completed.payload,
    })).resolves.toMatchObject({ accepted: true, event: completed });
  });

  it('does not persist or report a terminal event when authoritative settlement loses', async () => {
    const dependencies = serviceDependencies();
    const cancelledTask = {
      id: 'run-1',
      userId: user.id,
      projectId: 'project-1',
      type: 'agent-run',
      status: 'cancelled' as const,
      progress: 0,
      result: { workspace: 'canvas' },
      creditStatus: 'refunded' as const,
      creditCost: 7,
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
    };
    dependencies.transitionTask.mockResolvedValue({
      transitioned: false,
      task: cancelledTask,
    });
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: 'losing-completion',
      type: 'run.completed',
      payload: { result: { imageUrl: '/must-not-persist.png' } },
    })).rejects.toMatchObject({
      code: 'AGENT_RUN_TERMINAL_CONFLICT',
      status: 409,
    });
    expect(dependencies.appendEvent).not.toHaveBeenCalled();
  });

  it('binds a completion result to its event identity across an ambiguous append failure', async () => {
    const dependencies = serviceDependencies();
    const completionA = event(2, 'run.completed', {
      result: { imageUrl: '/result-a.png' },
    });
    const completionB = {
      ...completionA,
      payload: { result: { imageUrl: '/result-b.png' } },
    };
    let task: CloudTask & {
      status: 'processing' | 'completed';
      creditStatus: 'pending' | 'charged';
      revision: number;
    } = {
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
      revision: 1,
    };
    dependencies.getTaskForUser.mockImplementation(async () => task);
    dependencies.transitionTask.mockImplementation(async input => {
      if (task.status === 'processing') {
        task = {
          ...task,
          status: 'completed' as const,
          result: input.result || {},
          creditStatus: 'charged' as const,
          revision: task.revision + 1,
          terminalEventId: input.terminalIdentity?.eventId,
          terminalEventDigest: input.terminalIdentity?.requestDigest,
          terminalEventType: input.terminalIdentity?.eventType,
        };
        return { transitioned: true, task };
      }
      return { transitioned: false, task };
    });
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created', { workspace: 'canvas' }),
    ]);
    dependencies.appendEvent
      .mockRejectedValueOnce(new Error('terminal event response lost'))
      .mockResolvedValueOnce(completionB)
      .mockResolvedValueOnce(completionA);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: completionA.eventId,
      type: completionA.type,
      payload: completionA.payload,
    })).rejects.toThrow('terminal event response lost');
    await expect(service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: completionB.eventId,
      type: completionB.type,
      payload: completionB.payload,
    })).rejects.toMatchObject({
      code: 'AGENT_RUN_TERMINAL_CONFLICT',
      status: 409,
    });

    expect(task.result).toEqual({ imageUrl: '/result-a.png' });
    expect(dependencies.appendEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps an accepted nonterminal event accepted when a later event appears before reread', async () => {
    const dependencies = serviceDependencies();
    const progress = event(2, 'tool.progress', { progress: 25 });
    dependencies.appendEvent.mockResolvedValue(progress);
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created'),
      progress,
      event(3, 'tool.progress', { progress: 50 }),
    ]);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: progress.eventId,
      type: progress.type,
      payload: progress.payload,
    })).resolves.toMatchObject({
      accepted: true,
      event: progress,
      projection: { lastSequence: 3 },
    });
  });

  it('never resurrects a terminal task when initialization append failed and the key is retried', async () => {
    const dependencies = serviceDependencies();
    const failedTask = {
      id: 'run-1',
      userId: user.id,
      projectId: 'project-1',
      type: 'agent-run',
      status: 'failed' as const,
      progress: 0,
      result: { workspace: 'canvas' },
      error: 'Agent run initialization failed',
      creditStatus: 'refunded' as const,
      creditCost: 7,
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
    };
    dependencies.appendEvent.mockRejectedValueOnce(new Error('event storage unavailable'));
    dependencies.createBillableTask
      .mockResolvedValueOnce({
        task: { ...failedTask, status: 'processing', creditStatus: 'pending', revision: 0 },
        reused: false,
        charged: true,
      })
      .mockResolvedValueOnce({ task: failedTask, reused: true, charged: false });
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.createRun({ actor: user, request: request() })).rejects.toThrow(
      'event storage unavailable',
    );
    await expect(service.createRun({ actor: user, request: request() })).rejects.toMatchObject({
      code: 'AGENT_RUN_TERMINAL',
      status: 409,
    });
    expect(dependencies.appendEvent).toHaveBeenCalledTimes(1);
    expect(dependencies.settleFailedTask).toHaveBeenCalledTimes(1);
  });

  it('ignores late completion without changing task result or settlement', async () => {
    const dependencies = serviceDependencies();
    const completed = event(3, 'run.completed', {
      result: { imageUrl: '/late.png' },
    });
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created'),
      event(2, 'run.cancelled'),
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
    expect(dependencies.appendEvent).not.toHaveBeenCalled();
    expect(dependencies.transitionTask).not.toHaveBeenCalled();
    expect(dependencies.settleFailedTask).not.toHaveBeenCalled();
  });

  it('rejects a public Agent request that maps a canvas Skill onto chat before any admission side effect', async () => {
    const dependencies = serviceDependencies();
    const service = agentRuntime.createAgentRuntimeService(dependencies);
    const forged = agentRuntime.parseAgentRunRequest(
      canvasSkillRequest({ workspace: 'chat', workspaceId: 'chat-1' }),
    );

    await expect(service.createRun({ actor: user, request: forged })).rejects.toMatchObject({
      code: 'SKILL_SURFACE_FORBIDDEN',
      status: 403,
    });
    expect(dependencies.authorizeContext).not.toHaveBeenCalled();
    expect(dependencies.resolveTaskModel).not.toHaveBeenCalled();
    expect(dependencies.calculateCreditCost).not.toHaveBeenCalled();
    expect(dependencies.createBillableTask).not.toHaveBeenCalled();
  });

  it('admits a server-canonical canvas Skill request into the existing billing boundary', async () => {
    const dependencies = serviceDependencies();
    dependencies.resolveTaskModel.mockImplementation(async (providerId, modelId) => ({
      providerId,
      modelId,
      kind: providerId === 'provider-image' ? 'image' : 'chat',
      sourceType: providerId === 'provider-image' ? 'image' : 'chat',
      protocol: providerId === 'provider-image' ? 'images-generations' : 'chat-completions',
      executionMode: 'sync',
      allowedRatios: [],
      allowedSizes: [],
      qualityOptions: [],
      maxOutputs: 1,
      supportsReferenceImages: false,
      supportsMask: false,
      outputKinds: providerId === 'provider-image' ? ['image'] : ['text'],
      capabilitySources: {},
    }));
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.createRun({
      actor: user,
      request: agentRuntime.parseAgentRunRequest(canvasSkillRequest()),
    })).resolves.toMatchObject({ reused: false });
    expect(dependencies.calculateCreditCost).toHaveBeenCalledTimes(2);
    expect(dependencies.createBillableTask).toHaveBeenCalledTimes(1);
  });

  it('prices a public zero-step simple-chat Skill with one orchestrator base charge', async () => {
    const dependencies = serviceDependencies();
    dependencies.calculateCreditCost.mockResolvedValue(3);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await service.createRun({
      actor: user,
      request: agentRuntime.parseAgentRunRequest(simpleChatSkillRequest()),
    });

    expect(dependencies.calculateCreditCost).toHaveBeenCalledOnce();
    expect(dependencies.calculateCreditCost).toHaveBeenCalledWith(
      'chat',
      'model-exact',
      { providerId: 'provider-exact' },
    );
    expect(dependencies.createBillableTask).toHaveBeenCalledWith(expect.objectContaining({
      creditCost: 3,
    }));
  });

  it('rejects extra Skill model roles before resolving any model', async () => {
    const dependencies = serviceDependencies();
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.createRun({
      actor: user,
      request: canvasSkillRequest({}, {
        video: { providerId: 'provider-video', modelId: 'model-video' },
      }),
    })).rejects.toMatchObject({ code: 'SKILL_MODEL_BINDINGS_INVALID', status: 400 });
    expect(dependencies.resolveTaskModel).not.toHaveBeenCalled();
    expect(dependencies.calculateCreditCost).not.toHaveBeenCalled();
    expect(dependencies.createBillableTask).not.toHaveBeenCalled();
  });

  it('rejects a forged Skill prompt snapshot before resolving any model', async () => {
    const dependencies = serviceDependencies();
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.createRun({
      actor: user,
      request: canvasSkillRequest({ prompt: 'attacker supplied prompt' }),
    })).rejects.toMatchObject({ code: 'SKILL_PROMPT_MISMATCH', status: 400 });
    expect(dependencies.resolveTaskModel).not.toHaveBeenCalled();
    expect(dependencies.calculateCreditCost).not.toHaveBeenCalled();
    expect(dependencies.createBillableTask).not.toHaveBeenCalled();
  });

  it('enforces the 32000-byte UTF-8 prompt limit on direct service calls before authorization', async () => {
    const dependencies = serviceDependencies();
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.createRun({
      actor: user,
      request: request({ prompt: '界'.repeat(10_667) }),
    })).rejects.toMatchObject({ code: 'AGENT_RUN_REQUEST_INVALID', status: 400 });
    expect(dependencies.authorizeContext).not.toHaveBeenCalled();
    expect(dependencies.resolveTaskModel).not.toHaveBeenCalled();
    expect(dependencies.calculateCreditCost).not.toHaveBeenCalled();
    expect(dependencies.createBillableTask).not.toHaveBeenCalled();
  });

  it('does not persist an oversized raw prompt when its normalized value is within the limit', async () => {
    const rawDependencies = serviceDependencies();
    const normalizedDependencies = serviceDependencies();
    const rawRequest = request({ prompt: `${' '.repeat(40_001)}x` });

    await agentRuntime.createAgentRuntimeService(rawDependencies).createRun({
      actor: user,
      request: rawRequest,
    });
    await agentRuntime.createAgentRuntimeService(normalizedDependencies).createRun({
      actor: user,
      request: request({ prompt: 'x' }),
    });

    expect(rawDependencies.createBillableTask.mock.calls[0]?.[0].requestDigest).toBe(
      normalizedDependencies.createBillableTask.mock.calls[0]?.[0].requestDigest,
    );
    expect(rawDependencies.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run.created',
      payload: expect.objectContaining({ prompt: 'x' }),
    }));
    expect(JSON.stringify(rawDependencies.appendEvent.mock.calls[0]?.[0])).not.toContain(
      rawRequest.prompt,
    );
  });

  it('uses one normalized prompt for context authorization, digest, and run.created execution data', async () => {
    const rawDependencies = serviceDependencies();
    const normalizedDependencies = serviceDependencies();
    const normalizedPrompt = 'Create a poster';

    await agentRuntime.createAgentRuntimeService(rawDependencies).createRun({
      actor: user,
      request: request({ prompt: ` \r\n${normalizedPrompt}\t ` }),
    });
    await agentRuntime.createAgentRuntimeService(normalizedDependencies).createRun({
      actor: user,
      request: request({ prompt: normalizedPrompt }),
    });

    expect(rawDependencies.authorizeContext).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ prompt: normalizedPrompt }),
    }));
    expect(rawDependencies.createBillableTask.mock.calls[0]?.[0].requestDigest).toBe(
      normalizedDependencies.createBillableTask.mock.calls[0]?.[0].requestDigest,
    );
    expect(rawDependencies.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run.created',
      payload: expect.objectContaining({ prompt: normalizedPrompt }),
    }));
  });

  it('uses only a server billing quote and does not recalculate it inside the billing boundary', async () => {
    const dependencies = serviceDependencies();
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await service.createRun({
      actor: user,
      request: request(),
      billingQuote: { creditCost: 13, label: 'Skill quote' },
    });

    expect(dependencies.calculateCreditCost).not.toHaveBeenCalled();
    expect(dependencies.createBillableTask).toHaveBeenCalledWith(expect.objectContaining({
      creditCost: 13,
    }));
  });

  it('ignores a late failure while paused without refunding the pending charge', async () => {
    const dependencies = serviceDependencies();
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created'),
      event(2, 'run.paused', { nextStepId: 'generate-2' }),
    ]);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    const result = await service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: 'late-failure',
      type: 'run.failed',
      payload: {
        error: { code: 'ABORTED_OLD_WORK', message: 'late', retryable: true },
      },
    });

    expect(result).toMatchObject({ accepted: false, projection: { status: 'paused' } });
    expect(dependencies.appendEvent).not.toHaveBeenCalled();
    expect(dependencies.transitionTask).not.toHaveBeenCalled();
    expect(dependencies.settleFailedTask).not.toHaveBeenCalled();
  });

  it('still validates the canonical request when retrying the accepted terminal event ID', async () => {
    const dependencies = serviceDependencies();
    dependencies.listEvents.mockResolvedValue([
      event(1, 'run.created'),
      event(2, 'run.completed', { result: { imageUrl: '/winner.png' } }),
    ]);
    dependencies.appendEvent.mockRejectedValue(new AgentEventConflictError());
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: 'event-2',
      type: 'run.completed',
      payload: { result: { imageUrl: '/different.png' } },
    })).rejects.toBeInstanceOf(AgentEventConflictError);
  });

  it('rejects nonterminal work when the task is already terminal but its event needs recovery', async () => {
    const dependencies = serviceDependencies();
    dependencies.getTaskForUser.mockResolvedValue({
      id: 'run-1',
      userId: user.id,
      projectId: 'project-1',
      type: 'agent-run',
      status: 'cancelled',
      progress: 0,
      result: { workspace: 'canvas' },
      creditStatus: 'refunded',
      creditCost: 7,
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
    });
    dependencies.listEvents.mockResolvedValue([event(1, 'run.created')]);
    const service = agentRuntime.createAgentRuntimeService(dependencies);

    await expect(service.appendEvent({
      actorUserId: user.id,
      runId: 'run-1',
      eventId: 'late-progress',
      type: 'tool.progress',
      payload: { progress: 90 },
    })).rejects.toMatchObject({ code: 'AGENT_RUN_TERMINAL', status: 409 });
    expect(dependencies.appendEvent).not.toHaveBeenCalled();
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
        qualityChecks: [],
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

  it('returns safe 400 for malformed JSON without invoking run creation', async () => {
    const createRun = vi.spyOn(agentRuntime, 'createAgentRun');
    const { POST } = await import('@/app/api/agent-runs/route');
    const response = await POST(new NextRequest('http://localhost/api/agent-runs', {
      method: 'POST',
      body: '{"projectId":',
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'AGENT_RUN_REQUEST_INVALID',
        message: 'Agent run request is invalid',
      },
    });
    expect(createRun).not.toHaveBeenCalled();
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
        qualityChecks: [],
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
        qualityChecks: [],
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

  it.each([
    ['pause', { action: 'pause', nextStepId: 'generate-2' }],
    ['resume', { action: 'resume' }],
  ] as const)('routes the %s action through PATCH on the existing run resource', async (
    action,
    body,
  ) => {
    const control = action === 'pause'
      ? vi.spyOn(agentRuntime, 'pauseAgentRun')
      : vi.spyOn(agentRuntime, 'resumeAgentRun');
    control.mockResolvedValue({
      accepted: true,
      event: event(2, action === 'pause' ? 'run.paused' : 'run.resumed'),
      projection: {
        ...({
          runId: 'run-1', lastSequence: 2, plan: [], assetVersionIds: [],
          ignoredEventIds: [], missingSequences: [], qualityChecks: [],
        }),
        status: action === 'pause' ? 'paused' : 'queued',
      },
      leaseOwner: action === 'resume' ? 'lease-new' : '',
    });
    const { PATCH } = await import('@/app/api/agent-runs/[runId]/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/agent-runs/run-1', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(200);
    expect(control).toHaveBeenCalledWith({
      actorUserId: user.id,
      runId: 'run-1',
      ...(action === 'pause' ? { nextStepId: 'generate-2' } : {}),
    });
  });

  it('returns a safe 400 for malformed PATCH JSON without invoking controls', async () => {
    const pauseRun = vi.spyOn(agentRuntime, 'pauseAgentRun');
    const resumeRun = vi.spyOn(agentRuntime, 'resumeAgentRun');
    const { PATCH } = await import('@/app/api/agent-runs/[runId]/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/agent-runs/run-1', {
        method: 'PATCH', body: '{',
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(400);
    expect(pauseRun).not.toHaveBeenCalled();
    expect(resumeRun).not.toHaveBeenCalled();
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
