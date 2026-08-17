import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown>,
  tasks: new Map<string, Record<string, unknown>>(),
  taskByIdempotency: new Map<string, string>(),
  hiddenCloudTaskIds: new Set<string>(),
  registry: new Map<string, Record<string, unknown>>(),
  operations: new Map<string, Record<string, unknown>>(),
  events: [] as Array<Record<string, unknown>>,
  parentLeaseClaimed: false,
  parentLeaseCompleted: false,
  parentCharges: 0,
  parentRefunds: 0,
  parentTerminalCalls: 0,
  submitOnlyCalls: [] as Array<Record<string, unknown>>,
  internalSubmits: [] as Array<{ path: string; body: Record<string, unknown>; key: string }>,
  internalPolls: [] as Array<{ taskId: string; userId: string }>,
  externalSubmits: [] as Array<{ body: Record<string, unknown>; key: string }>,
  externalPolls: [] as string[],
  chatSubmits: [] as Array<{ key: string }>,
  acceptanceWriteAttempts: 0,
  pollResponses: [] as Array<Record<string, unknown>>,
  crashPollTaskId: '' as string,
  crashedPoll: false,
  transientPollDelivered: false,
  plan: 'multi-step' as 'multi-step' | 'submission-unknown' | 'remove-background' | 'async-image-edit'
    | 'async-image-edit-direct-retryable-poll' | 'async-image-edit-retryable-poll'
    | 'async-image-edit-recovery-rejection'
    | 'async-image-edit-acceptance-failure'
    | 'sync-image-edit-loss' | 'chat-post-send-loss' | 'video-tools' | 'video-recovery-rejection'
    | 'video-retryable-poll' | 'chat-provider-rejection' | 'sync-image-edit-rejection'
    | 'generate-image-rejection',
  childCounter: 0,
}));

const fixtures = vi.hoisted(() => ({
  user: {
    id: 'user-route', name: 'Route owner', role: 'user' as const, status: 'active' as const,
    productType: 'canvas', createdAt: 1, updatedAt: 1,
  },
  chatProvider: {
    id: 'provider-chat', name: 'Chat provider', type: 'chat', modelType: 'chat',
    apiKey: 'chat-key', baseUrl: 'https://chat.example', selectedModels: ['Chat::Exact'],
    isEnabled: true, createdAt: 1, updatedAt: 1,
  },
  imageProvider: {
    id: 'provider-image', name: 'Image provider', type: 'image', modelType: 'image',
    apiKey: 'image-key', baseUrl: 'https://image.example', selectedModels: ['Exact::Model'],
    isEnabled: true, createdAt: 1, updatedAt: 1,
  },
}));

vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (callback: () => unknown) => { state.afterCallbacks.push(callback); },
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: vi.fn().mockResolvedValue({
    authenticated: true, userId: fixtures.user.id, userRole: fixtures.user.role,
    source: 'internal', user: fixtures.user,
  }),
  getRequestUser: vi.fn().mockResolvedValue({ user: fixtures.user }),
  getInternalRequestHeaders: vi.fn().mockResolvedValue({
    'x-wujie-internal-user-id': fixtures.user.id,
    'x-wujie-internal-user-role': fixtures.user.role,
    'x-wujie-internal-secret': 'test-internal-secret',
  }),
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: vi.fn().mockResolvedValue(fixtures.user) }));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: vi.fn(async (id: string) => (
    id === fixtures.chatProvider.id
      ? fixtures.chatProvider
      : id === fixtures.imageProvider.id
        ? state.plan === 'async-image-edit'
            || state.plan === 'async-image-edit-direct-retryable-poll'
            || state.plan === 'async-image-edit-retryable-poll'
            || state.plan === 'async-image-edit-recovery-rejection'
            || state.plan === 'async-image-edit-acceptance-failure'
          ? { ...fixtures.imageProvider, compatProfile: 'apimart' }
          : fixtures.imageProvider
        : null
  )),
  findProviderForModel: vi.fn(async (model: string) => (
    model === 'Chat::Exact'
      ? fixtures.chatProvider
      : model === 'Exact::Model'
        ? state.plan === 'async-image-edit'
            || state.plan === 'async-image-edit-direct-retryable-poll'
            || state.plan === 'async-image-edit-retryable-poll'
            || state.plan === 'async-image-edit-recovery-rejection'
            || state.plan === 'async-image-edit-acceptance-failure'
          ? { ...fixtures.imageProvider, compatProfile: 'apimart' }
          : fixtures.imageProvider
        : null
  )),
  findProviderForFeature: vi.fn(async (feature: string) => (
    feature === 'chat' ? fixtures.chatProvider : fixtures.imageProvider
  )),
  findAllProvidersForType: vi.fn().mockResolvedValue([{
    provider: fixtures.imageProvider, models: ['Exact::Model'],
  }]),
  normalizeApiBaseUrl: (value: string) => value.replace(/\/+$/, ''),
  getApiProviders: vi.fn().mockResolvedValue([fixtures.chatProvider, fixtures.imageProvider]),
}));
vi.mock('@/lib/task-core/model-catalog', () => ({
  resolveTaskModel: vi.fn(async (providerId: string, modelId: string) => ({
    providerId,
    modelId,
    kind: providerId === fixtures.chatProvider.id ? 'chat' : 'image',
    sourceType: providerId === fixtures.chatProvider.id ? 'llm' : 'image',
    protocol: providerId === fixtures.chatProvider.id ? 'chat-completions' : 'images',
    executionMode: 'async',
    allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
    supportsReferenceImages: false, supportsMask: false, outputKinds: ['png'],
  })),
}));
vi.mock('@/lib/agent-runtime/context-adapters', () => ({
  authorizeAgentContext: vi.fn(async ({ request }: { request: Record<string, unknown> }) => request.context),
  resolveSelectedAgentMediaUrl: vi.fn().mockReturnValue('/source.png'),
}));
vi.mock('@/lib/agent-runtime/admission-gate', () => ({
  admitAuthorizedAgentExecution: vi.fn(async ({ admit }: { admit: (context: Record<string, unknown>) => unknown }) => ({
    value: await admit({ selectedEntityVersionUrls: { 'entity-1': '/source.png' } }),
  })),
}));
vi.mock('@/lib/agent-engine', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-engine')>();
  return {
  ...actual,
  getToolsForLLM: vi.fn().mockReturnValue([]),
  executeAgentLoop: vi.fn(async (
    context: Parameters<typeof actual.executeAgentLoop>[0],
    llmCall: Parameters<typeof actual.executeAgentLoop>[1],
  ) => {
    if (state.plan === 'chat-post-send-loss' || state.plan === 'chat-provider-rejection') {
      return actual.executeAgentLoop(context, llmCall);
    }
    if (state.plan === 'submission-unknown') {
      await llmCall([{ role: 'user', content: 'ambiguous' }], []);
      throw new Error('unreachable');
    }
    const steps = state.plan === 'remove-background'
      ? [{ round: 1, toolName: 'remove_background', params: {}, result: 'planned', success: true }]
      : state.plan === 'async-image-edit'
        || state.plan === 'async-image-edit-direct-retryable-poll'
        || state.plan === 'async-image-edit-retryable-poll'
        || state.plan === 'async-image-edit-recovery-rejection'
        || state.plan === 'async-image-edit-acceptance-failure'
        || state.plan === 'sync-image-edit-loss'
        || state.plan === 'sync-image-edit-rejection'
        ? [{ round: 1, toolName: 'image_edit', params: { prompt: 'Edit asynchronously' }, result: 'planned', success: true }]
        : state.plan === 'video-tools'
          || state.plan === 'video-recovery-rejection'
          || state.plan === 'video-retryable-poll'
          ? [
              { round: 1, toolName: 'generate_video', params: { prompt: 'Generate video' }, result: 'planned', success: true },
              ...(state.plan === 'video-tools'
                ? [{ round: 2, toolName: 'extend_video', params: { videoUrl: '/generated-video.mp4', duration: 5 }, result: 'planned', success: true }]
                : []),
            ]
          : (state.plan === 'generate-image-rejection' ? [0] : [0, 1]).map(index => ({
              round: index + 1,
              toolName: 'generate_image',
              params: { prompt: `Generated step ${index}`, size: '1:1' },
              result: 'planned',
              success: true,
            }));
    return {
      success: true,
      finalResponse: 'planned tools complete',
      steps,
    };
  }),
  };
});
vi.mock('@/lib/prompt-safety', () => ({
  checkPromptSafety: vi.fn().mockReturnValue({ level: 'safe' }),
  logSafetyWarning: vi.fn(),
}));
vi.mock('@/lib/credits', () => ({
  calculateConfiguredCreditCost: vi.fn().mockResolvedValue(7),
  checkCredits: vi.fn().mockResolvedValue({ sufficient: true, balance: 100 }),
  consumeCredits: vi.fn().mockResolvedValue({ success: true, cost: 7 }),
  refundCredits: vi.fn().mockResolvedValue(undefined),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));
vi.mock('@/lib/task-core/entry-migration', () => ({
  resolveTaskCoreMode: vi.fn().mockReturnValue('core-v2'),
  createTaskEntryAudit: vi.fn().mockReturnValue({ entry: 'agent', mode: 'core-v2' }),
  executeTaskEntryMigration: vi.fn(async (input: { coreV2: () => Promise<unknown> }) => input.coreV2()),
}));
vi.mock('@/lib/task-core/billing-service', () => ({
  createBillableTask: vi.fn(async (input: Record<string, unknown>) => {
    const existingId = state.taskByIdempotency.get(String(input.idempotencyKey));
    if (existingId) return { task: state.tasks.get(existingId), reused: true };
    const task: Record<string, unknown> = {
      ...(input.task as Record<string, unknown>), userId: input.userId, idempotencyKey: input.idempotencyKey,
      requestDigest: input.requestDigest, creditCost: input.creditCost,
      creditStatus: 'charged', revision: 0,
    };
    state.tasks.set(String(task.id), task);
    state.taskByIdempotency.set(String(input.idempotencyKey), String(task.id));
    state.parentCharges += 1;
    return { task, reused: false };
  }),
  settleFailedTask: vi.fn().mockResolvedValue({ transitioned: true, refunded: false }),
}));
vi.mock('@/lib/agent-task-persistence', () => ({
  recordAgentTaskSubmitted: vi.fn(),
  recordAgentTaskProgress: vi.fn(async (taskId: string, progress: number, label: string) => {
    const task = state.tasks.get(taskId);
    if (task) state.tasks.set(taskId, { ...task, progress, label, updatedAt: Date.now() });
  }),
  recordAgentTaskTerminal: vi.fn(async (taskId: string, terminal: Record<string, unknown>) => {
    const task = state.tasks.get(taskId);
    if (!task || ['completed', 'failed', 'cancelled', 'timeout'].includes(String(task.status))) return false;
    state.parentTerminalCalls += 1;
    if (terminal.status === 'failed') state.parentRefunds += 1;
    state.tasks.set(taskId, {
      ...task,
      status: terminal.status,
      progress: 100,
      error: terminal.error,
      result: terminal.status === 'completed'
        ? { imageUrl: terminal.imageUrl, steps: terminal.steps, finalResponse: terminal.finalResponse }
        : { taskError: { code: terminal.code, message: terminal.error, retryable: terminal.retryable } },
      creditStatus: terminal.status === 'failed' ? 'refunded' : 'charged',
    });
    return true;
  }),
}));

vi.mock('@/lib/cloud-task-persistence', () => ({
  recordImageTaskSubmitted: vi.fn(async (input: Record<string, unknown>) => {
    const existingId = typeof input.idempotencyKey === 'string'
      ? state.taskByIdempotency.get(input.idempotencyKey)
      : undefined;
    if (existingId) return false;
    const task = {
      id: input.taskId, userId: input.userId, projectId: input.projectId,
      type: input.type || 'generate-async', status: 'pending', providerId: input.providerId,
      model: input.model, progress: 0, label: input.label, creditStatus: 'not-applicable',
      creditCost: input.creditCost || 0, idempotencyKey: input.idempotencyKey,
      result: { submissionPayload: input.submissionPayload },
      createdAt: Date.now(), updatedAt: Date.now(), revision: 0,
    };
    state.tasks.set(String(task.id), task);
    if (typeof input.idempotencyKey === 'string') {
      state.taskByIdempotency.set(input.idempotencyKey, String(task.id));
    }
    state.childCounter += 1;
    if (state.childCounter === 2) state.crashPollTaskId = String(task.id);
    return true;
  }),
  recordImageTaskTerminal: vi.fn(),
  recordVideoTaskTerminal: vi.fn(),
  buildRecoveredTaskContext: (task: Record<string, unknown>) => ({
    taskId: task.id, remoteTaskId: task.remoteTaskId || task.id, providerId: task.providerId,
    model: task.model, type: task.type, progress: task.progress, label: task.label, userId: task.userId,
  }),
  projectPersistedCompletedTask: vi.fn(),
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: vi.fn(async (taskId: string, userId: string) => {
    if (state.hiddenCloudTaskIds.has(taskId)) return null;
    const task = state.tasks.get(taskId);
    return task?.userId === userId ? task : null;
  }),
  getCloudTaskForUserByIdempotencyKey: vi.fn(async (userId: string, key: string) => {
    const task = state.tasks.get(state.taskByIdempotency.get(key) || '');
    return task?.userId === userId ? task : null;
  }),
  chargeCloudTaskCredits: vi.fn(async (taskId: string, _userId: string, creditCost: number) => {
    const task = state.tasks.get(taskId)!;
    state.tasks.set(taskId, { ...task, status: 'processing', creditStatus: 'charged', creditCost });
    return { charged: true, creditCost };
  }),
  claimCloudTaskLease: vi.fn(async () => ({ claimed: true })),
  completeCloudTask: vi.fn(async (taskId: string, result: Record<string, unknown>) => {
    const task = state.tasks.get(taskId)!;
    state.tasks.set(taskId, { ...task, status: 'completed', progress: 100, result, updatedAt: Date.now() });
    const registryTask = state.registry.get(taskId);
    if (registryTask) state.registry.set(taskId, { ...registryTask, status: 'completed', progress: 100, result });
    return true;
  }),
  updateCloudTask: vi.fn(async (taskId: string, patch: Record<string, unknown>) => {
    const task = state.tasks.get(taskId);
    if (task) state.tasks.set(taskId, { ...task, ...patch, updatedAt: Date.now() });
    return true;
  }),
  terminateCloudTaskAndRefund: vi.fn().mockResolvedValue({ transitioned: true, refunded: false }),
  refundCloudTaskCredits: vi.fn().mockResolvedValue({ refunded: false }),
  deferCloudTaskRecovery: vi.fn(),
}));
vi.mock('@/lib/task-registry', () => ({
  registerTask: vi.fn((taskId: string, type: string, label: string, userId: string) => {
    const task = state.registry.get(taskId) || {
      taskId, type, label, userId, status: 'processing', progress: 0, createdAt: Date.now(), updatedAt: Date.now(),
    };
    state.registry.set(taskId, task);
    return task;
  }),
  updateTaskProgress: vi.fn((taskId: string, patch: Record<string, unknown>) => {
    const task = state.registry.get(taskId);
    if (task) state.registry.set(taskId, { ...task, ...patch, updatedAt: Date.now() });
  }),
  getTaskInfo: vi.fn((taskId: string) => state.registry.get(taskId)),
  isTaskCancelled: vi.fn().mockReturnValue(false),
  registerTaskAbortController: vi.fn(), unregisterTaskAbortController: vi.fn(),
  abortTaskExecution: vi.fn(), releaseQueueSlot: vi.fn(),
}));
vi.mock('@/lib/task-core/task-service', () => ({
  exposeDurableDirectTask: vi.fn(),
  publishGenerateTaskCandidates: vi.fn(async (input: { candidateTaskIds: readonly string[] }) => ({
    publishedTaskIds: [...input.candidateTaskIds], failures: [],
  })),
  publishDurableDirectTask: vi.fn(),
}));
vi.mock('@/lib/task-core/durable-generation-kickoff', () => ({
  kickoffDurableGenerationTasks: vi.fn().mockResolvedValue({ attempted: [], accepted: [], failed: [] }),
}));
vi.mock('@/lib/task-core/task-abort', () => ({
  getTaskRecoveryBackoff: vi.fn().mockReturnValue({ recoveryAllowed: true, retryAfterMs: 0 }),
  createTaskAbortScope: vi.fn().mockReturnValue({
    signal: new AbortController().signal,
    dispose: vi.fn(),
  }),
}));

vi.mock('@/lib/agent-runtime/event-storage', () => ({
  appendAdoptedAgentEvent: vi.fn(async (input: Record<string, unknown>) => {
    const existing = state.events.find(event => event.eventId === input.eventId);
    if (existing) return { event: existing, inserted: false };
    const event = { ...input, sequence: state.events.length + 1, timestamp: new Date().toISOString() };
    state.events.push(event);
    return { event, inserted: true };
  }),
  observeAdoptedAgentTaskTerminal: vi.fn().mockResolvedValue([]),
  listAgentEventsForActor: vi.fn(async ({ runId }: { runId: string }) => (
    state.events.filter(event => event.runId === runId)
  )),
  claimAdoptedAgentExecution: vi.fn(async () => {
    if (state.parentLeaseClaimed || state.parentLeaseCompleted) return { claimed: false, leaseOwner: '' };
    state.parentLeaseClaimed = true;
    return { claimed: true, leaseOwner: 'parent-route-lease' };
  }),
  completeAdoptedAgentExecution: vi.fn(async () => {
    state.parentLeaseClaimed = false;
    state.parentLeaseCompleted = true;
    return true;
  }),
  releaseAdoptedAgentExecution: vi.fn(async () => {
    state.parentLeaseClaimed = false;
    return true;
  }),
  prepareAgentDownstreamOperation: vi.fn(async (input: Record<string, unknown>) => {
    const operationKey = String(input.operationKey);
    const existing = state.operations.get(operationKey);
    if (existing?.status === 'completed' || existing?.status === 'submission_unknown') {
      return { ...existing, claimed: false };
    }
    const claimed = !existing || !existing.leaseOwner;
    const operation = {
      ...(existing || input),
      attempts: Number(existing?.attempts || 0) + (claimed ? 1 : 0),
      status: existing?.status || 'prepared',
      leaseOwner: claimed ? input.leaseOwner : existing.leaseOwner,
      claimed,
    };
    state.operations.set(operationKey, operation);
    return operation;
  }),
  markAgentDownstreamOperationSubmitted: vi.fn(async (input: Record<string, unknown>) => {
    const operationKey = String(input.operationKey);
    const operation = { ...state.operations.get(operationKey), ...input, status: 'submitted' };
    state.operations.set(operationKey, operation);
    return operation;
  }),
  markAgentDownstreamOperationAccepted: vi.fn(async (input: Record<string, unknown>) => {
    state.acceptanceWriteAttempts += 1;
    if (
      state.plan === 'async-image-edit-acceptance-failure'
      && input.stepId === 'image_edit:0'
    ) {
      throw new Error('simulated acceptance persistence failure');
    }
    const operationKey = String(input.operationKey);
    const operation = { ...state.operations.get(operationKey), ...input, status: 'accepted' };
    state.operations.set(operationKey, operation);
    return operation;
  }),
  markAgentDownstreamSubmissionUnknown: vi.fn(async (input: Record<string, unknown>) => {
    const operation = {
      ...state.operations.get(String(input.operationKey)), ...input, status: 'submission_unknown', leaseOwner: '',
    };
    state.operations.set(String(input.operationKey), operation);
    return operation;
  }),
  completeAgentDownstreamOperation: vi.fn(async (input: Record<string, unknown>) => {
    const operation = {
      ...state.operations.get(String(input.operationKey)), ...input,
      status: 'completed', response: input.response, leaseOwner: '',
    };
    state.operations.set(String(input.operationKey), operation);
    return operation;
  }),
  getAgentDownstreamOperation: vi.fn(async (input: Record<string, unknown>) => (
    state.operations.get(String(input.operationKey)) || null
  )),
  releaseAgentDownstreamOperation: vi.fn(async (input: Record<string, unknown>) => {
    const operationKey = String(input.operationKey);
    const operation = state.operations.get(operationKey);
    if (!operation || operation.leaseOwner !== input.leaseOwner) return false;
    state.operations.set(operationKey, { ...operation, leaseOwner: '' });
    return true;
  }),
}));

vi.mock('@/lib/model-defaults', () => ({ isModelAssignedToUser: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/s3-storage', () => ({ persistRemoteImage: vi.fn(async (url: string) => url) }));
vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: vi.fn() }));
vi.mock('@/lib/op-log', () => ({
  logOperation: vi.fn(), logError: vi.fn(), startTimer: vi.fn().mockReturnValue(() => 1),
  sanitizeRequestData: vi.fn((value: unknown) => value), OP_ACTIONS: new Proxy({}, { get: () => 'test' }),
}));

import { GET as agentGet, POST as agentPost } from '@/app/api/agent-edit/route';
import { POST as generatePost } from '@/app/api/generate/route';
import { POST as pollPost } from '@/app/api/poll-task/route';

async function drainRouteAfterCallbacks(): Promise<void> {
  while (state.afterCallbacks.length > 0) {
    const callback = state.afterCallbacks.shift()!;
    await callback();
  }
}

function agentRequest(idempotencyKey: string): Request {
  return new Request('http://localhost/api/agent-edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify({
      image: '/source.png', prompt: 'Run two generated steps',
      providerId: fixtures.chatProvider.id, model: 'Chat::Exact',
      imageProviderId: fixtures.imageProvider.id, imageModel: 'Exact::Model',
      projectId: 'project-route', selectedEntityId: 'entity-1', assetParentVersionIds: ['version-1'],
      maxRounds: 2,
    }),
  });
}

async function dispatchFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    if (url.pathname === '/api/generate') {
      const body = await request.clone().json() as Record<string, unknown>;
      if (body.submitOnly === true) state.submitOnlyCalls.push(body);
      const response = await generatePost(request as never);
      await drainRouteAfterCallbacks();
      return response;
    }
    if (url.pathname === '/source.png') {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    if (url.pathname === '/api/image-edit' || url.pathname === '/api/video/generate' || url.pathname === '/api/video/extend') {
      const body = await request.clone().json() as Record<string, unknown>;
      state.internalSubmits.push({
        path: url.pathname,
        body,
        key: request.headers.get('idempotency-key') || '',
      });
      const providerTaskId = url.pathname === '/api/image-edit'
        ? 'remove-background-provider-task'
        : url.pathname === '/api/video/generate'
          ? 'generate-video-provider-task'
          : 'extend-video-provider-task';
      const result = url.pathname === '/api/image-edit'
        ? { imageUrl: '/removed-background.png' }
        : { videoUrl: url.pathname === '/api/video/generate' ? '/generated-video.mp4' : '/extended-video.mp4' };
      state.tasks.set(providerTaskId, {
        id: providerTaskId,
        userId: fixtures.user.id,
        type: url.pathname.includes('video') ? 'video' : 'generate-async',
        status: state.plan === 'video-recovery-rejection' ? 'failed' : 'completed',
        progress: 100,
        result,
        ...(state.plan === 'video-recovery-rejection'
          ? { error: 'controlled video provider rejection' }
          : {}),
      });
      if (url.pathname === '/api/image-edit' || state.plan === 'video-recovery-rejection') {
        state.crashPollTaskId = providerTaskId;
      }
      return Response.json({ success: true, taskId: providerTaskId });
    }
    if (url.pathname === '/api/poll-task') {
      const pollBody = await request.clone().json() as { taskId?: string };
      const taskId = pollBody.taskId || '';
      state.internalPolls.push({
        taskId,
        userId: request.headers.get('x-wujie-internal-user-id') || '',
      });
      if (
        !state.transientPollDelivered
        && (state.plan === 'async-image-edit-retryable-poll' || state.plan === 'video-retryable-poll')
      ) {
        state.transientPollDelivered = true;
        const transient = {
          success: false,
          status: 'error',
          error: 'controlled transient provider poll failure',
          retryable: true,
        };
        state.pollResponses.push(transient);
        return Response.json(transient);
      }
      if (taskId === state.crashPollTaskId && !state.crashedPoll) {
        state.crashedPoll = true;
        throw new Error('simulated crash after second acceptance');
      }
      const response = await pollPost(request as never);
      await drainRouteAfterCallbacks();
      state.pollResponses.push(await response.clone().json() as Record<string, unknown>);
      return response;
    }
  }
  if (url.hostname === 'chat.example') {
    state.chatSubmits.push({ key: request.headers.get('idempotency-key') || '' });
    if (state.plan === 'chat-provider-rejection') {
      return Response.json({ error: { message: 'controlled chat rejection' } }, { status: 429 });
    }
    throw new Error('connection lost after chat provider submit');
  }
  if (url.hostname === 'image.example') {
    if (request.method === 'GET') {
      state.externalPolls.push(`${url.pathname}${url.search}`);
      if (state.plan === 'async-image-edit-direct-retryable-poll') {
        if (!state.transientPollDelivered) {
          state.transientPollDelivered = true;
          return Response.json({
            status: 'error',
            error: { message: 'controlled transient direct provider poll failure' },
            retryable: true,
          });
        }
        return Response.json({ status: 'completed', data: [{ url: '/async-edited.png' }] });
      }
      if (!state.crashedPoll) {
        state.crashedPoll = true;
        throw new Error('simulated direct image edit poll timeout after acceptance');
      }
      if (state.plan === 'async-image-edit-recovery-rejection') {
        return Response.json({
          status: 'error',
          error: {
            code: 'IMAGE_EDIT_REJECTED',
            message: 'controlled accepted image edit rejection',
          },
        });
      }
      return Response.json({ status: 'completed', data: [{ url: '/async-edited.png' }] });
    }
    if (state.plan === 'sync-image-edit-loss' || state.plan === 'sync-image-edit-rejection') {
      const formData = init?.body instanceof FormData ? init.body : null;
      state.externalSubmits.push({
        body: { model: String(formData?.get('model') || '') },
        key: new Headers(init?.headers ?? request.headers).get('idempotency-key') || '',
      });
      if (state.plan === 'sync-image-edit-rejection') {
        return Response.json({ error: { message: 'controlled image edit rejection' } }, { status: 422 });
      }
      throw new Error('connection lost after synchronous image edit submit');
    }
    const body = JSON.parse(String(init?.body ?? await request.text())) as Record<string, unknown>;
    state.externalSubmits.push({
      body,
      key: new Headers(init?.headers ?? request.headers).get('idempotency-key') || '',
    });
    if (state.plan === 'generate-image-rejection') {
      return Response.json({ error: { message: 'controlled image generation rejection' } }, { status: 429 });
    }
    const providerResponse = state.plan === 'async-image-edit'
      || state.plan === 'async-image-edit-direct-retryable-poll'
      || state.plan === 'async-image-edit-retryable-poll'
      || state.plan === 'async-image-edit-recovery-rejection'
      || state.plan === 'async-image-edit-acceptance-failure'
      ? { task_id: 'async-edit-provider-task', status: 'processing' }
      : { data: [{ url: `/generated-${state.externalSubmits.length}.png` }] };
    if (state.plan === 'async-image-edit-retryable-poll') {
      state.tasks.set('async-edit-provider-task', {
        id: 'async-edit-provider-task',
        userId: fixtures.user.id,
        type: 'generate-async',
        status: 'completed',
        progress: 100,
        result: { imageUrl: '/async-edited.png' },
      });
    }
    return new Response(JSON.stringify(providerResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`Unexpected fetch ${request.method} ${request.url}`);
}

async function startAgent(idempotencyKey: string): Promise<string> {
  const response = await agentPost(agentRequest(idempotencyKey) as never);
  expect(response.status).toBe(200);
  const body = await response.json() as { taskId: string };
  const worker = state.afterCallbacks.shift();
  expect(worker).toBeTypeOf('function');
  await worker!();
  return body.taskId;
}

describe('Agent route default-adapter production recovery', () => {
  beforeEach(() => {
    state.afterCallbacks.length = 0;
    state.tasks.clear(); state.taskByIdempotency.clear(); state.hiddenCloudTaskIds.clear(); state.registry.clear();
    state.operations.clear(); state.events.length = 0;
    state.parentLeaseClaimed = false; state.parentLeaseCompleted = false;
    state.parentCharges = 0; state.parentRefunds = 0; state.parentTerminalCalls = 0;
    state.submitOnlyCalls.length = 0; state.internalSubmits.length = 0; state.internalPolls.length = 0;
    state.externalSubmits.length = 0; state.externalPolls.length = 0; state.chatSubmits.length = 0;
    state.pollResponses.length = 0; state.acceptanceWriteAttempts = 0;
    state.crashPollTaskId = ''; state.crashedPoll = false; state.transientPollDelivered = false;
    state.plan = 'multi-step'; state.childCounter = 0;
    process.env.WUJIE_TASK_CORE_MODE = 'core-v2';
    process.env.WUJIE_AGENT_RUNTIME_MODE = 'agent-v2';
    vi.stubGlobal('fetch', vi.fn(dispatchFetch));
    const nativeSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (delay === 2000 || delay === 5000) {
        queueMicrotask(() => callback(...args));
        return { unref: () => undefined } as unknown as ReturnType<typeof setTimeout>;
      }
      return nativeSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout);
  });

  it('cancels a persisted processing task after a route restart through durable settlement', async () => {
    state.tasks.set('persisted-agent-task', {
      id: 'persisted-agent-task',
      userId: fixtures.user.id,
      projectId: 'project-route',
      type: 'agent-edit',
      status: 'processing',
      progress: 40,
      label: 'Persisted work',
      creditCost: 7,
      creditStatus: 'charged',
    });

    const response = await agentGet(new Request(
      'http://localhost/api/agent-edit?taskId=persisted-agent-task&action=cancel',
    ) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, status: 'cancelled' });
    expect(state.tasks.get('persisted-agent-task')).toMatchObject({ status: 'cancelled' });
    expect(state.parentTerminalCalls).toBe(1);
  });

  it.each(['queued', 'pending', 'processing'])('durably cancels a persisted %s task for its owner', async status => {
    const taskId = `persisted-${status}-task`;
    state.tasks.set(taskId, {
      id: taskId,
      userId: fixtures.user.id,
      projectId: 'project-route',
      type: 'agent-edit',
      status,
      progress: 5,
      creditCost: 7,
      creditStatus: 'pending',
    });

    const response = await agentGet(new Request(
      `http://localhost/api/agent-edit?taskId=${taskId}&action=cancel`,
    ) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true, status: 'cancelled', durableTerminal: true,
    });
    expect(state.tasks.get(taskId)).toMatchObject({ status: 'cancelled' });
  });

  it('cancels a local-only legacy task with an explicit non-durable confirmation', async () => {
    const response = await agentPost(agentRequest('local-only-cancel') as never);
    const { taskId } = await response.json() as { taskId: string };
    state.hiddenCloudTaskIds.add(taskId);

    const cancelled = await agentGet(new Request(
      `http://localhost/api/agent-edit?taskId=${taskId}&action=cancel`,
    ) as never);

    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({
      success: true, status: 'cancelled', confirmedLocal: true, durableTerminal: false,
    });
  });

  it('retains both accepted submitOnly children and reconciles them without resubmit', async () => {
    const taskId = await startAgent('route-multi-step');
    await vi.waitFor(() => {
      const accepted = [...state.operations.values()].filter(operation => operation.status === 'accepted');
      expect(accepted).toHaveLength(1);
      expect(state.parentLeaseClaimed).toBe(false);
    });
    expect(
      state.pollResponses.some(response => response.status === 'completed'),
      JSON.stringify(state.pollResponses.slice(-5)),
    ).toBe(true);

    const recoveryResponses = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-multi-step') as never)
    )));
    expect(recoveryResponses.every(response => response.status === 200)).toBe(true);
    const recoveryWorkers = state.afterCallbacks.splice(0);
    await Promise.all(recoveryWorkers.map(worker => worker()));
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('completed'));

    const childOperations = [...state.operations.values()].filter(operation => (
      String(operation.stepId).startsWith('generate_image:')
    ));
    expect(childOperations).toHaveLength(2);
    expect(childOperations.every(operation => operation.status === 'completed')).toBe(true);
    expect(childOperations.map(operation => operation.providerTaskId).filter(Boolean)).toHaveLength(2);
    expect(new Set(childOperations.map(operation => operation.providerTaskId)).size).toBe(2);
    expect(state.submitOnlyCalls).toHaveLength(2);
    expect(state.externalSubmits).toHaveLength(2);
    expect(state.externalSubmits.map(submit => submit.body.model)).toEqual(['Exact::Model', 'Exact::Model']);
    expect(new Set(state.externalSubmits.map(submit => submit.key)).size).toBe(2);
    expect(state.externalSubmits.every(submit => submit.key === submit.body.idempotency_key)).toBe(true);
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(1);

    const late = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-multi-step') as never)
    )));
    expect(late.every(response => response.status === 200)).toBe(true);
    expect(state.submitOnlyCalls).toHaveLength(2);
    expect(state.externalSubmits).toHaveLength(2);
    expect(state.parentCharges).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('uses default submission_unknown settlement and refunds the parent once', async () => {
    state.plan = 'submission-unknown';
    const taskId = await startAgent('route-submission-unknown');
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('failed'));

    const parent = state.tasks.get(taskId)!;
    expect((parent.result as Record<string, unknown>).taskError).toMatchObject({
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN', retryable: false,
    });
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
    expect([...state.operations.values()].filter(operation => (
      operation.status === 'submission_unknown'
    ))).toHaveLength(1);

    const late = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-submission-unknown') as never)
    )));
    expect(late.every(response => response.status === 409)).toBe(true);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('persists remove_background acceptance and recovers by exact authenticated poll without resubmit', async () => {
    state.plan = 'remove-background';
    const taskId = await startAgent('route-remove-background');

    await vi.waitFor(() => {
      const operation = [...state.operations.values()].find(candidate => candidate.stepId === 'remove_background:0');
      expect(operation).toMatchObject({ status: 'accepted', providerTaskId: 'remove-background-provider-task' });
      expect(state.parentLeaseClaimed).toBe(false);
    });
    expect(state.tasks.get(taskId)?.status).not.toBe('completed');

    const recoveryResponses = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-remove-background') as never)
    )));
    expect(recoveryResponses.every(response => response.status === 200)).toBe(true);
    await Promise.all(state.afterCallbacks.splice(0).map(worker => worker()));
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('completed'));

    expect(state.internalSubmits.filter(submit => submit.path === '/api/image-edit')).toHaveLength(1);
    expect(state.internalPolls.filter(poll => poll.taskId === 'remove-background-provider-task')).toEqual([
      { taskId: 'remove-background-provider-task', userId: fixtures.user.id },
      { taskId: 'remove-background-provider-task', userId: fixtures.user.id },
    ]);
    expect(state.pollResponses.some(response => response.imageUrl === '/removed-background.png')).toBe(true);
    expect([...state.operations.values()].find(operation => operation.stepId === 'remove_background:0')?.status).toBe('completed');
    expect((state.tasks.get(taskId)?.result as Record<string, unknown>).imageUrl).toBe('/removed-background.png');
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(1);

    const late = await Promise.all(Array.from({ length: 8 }, () => agentPost(agentRequest('route-remove-background') as never)));
    expect(late.every(response => response.status === 200)).toBe(true);
    expect(state.internalSubmits.filter(submit => submit.path === '/api/image-edit')).toHaveLength(1);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('keeps direct async image_edit accepted after poll failure and reconciles without resubmit', async () => {
    state.plan = 'async-image-edit';
    const taskId = await startAgent('route-async-image-edit');

    await vi.waitFor(() => {
      const operation = [...state.operations.values()].find(candidate => candidate.stepId === 'image_edit:0');
      expect(operation).toMatchObject({ status: 'accepted', providerTaskId: 'async-edit-provider-task' });
      expect(state.parentLeaseClaimed).toBe(false);
    });
    expect(state.tasks.get(taskId)?.status).not.toBe('completed');

    const recoveryResponses = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-async-image-edit') as never)
    )));
    expect(recoveryResponses.every(response => response.status === 200)).toBe(true);
    await Promise.all(state.afterCallbacks.splice(0).map(worker => worker()));
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('completed'));

    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalSubmits[0].body.model).toBe('Exact::Model');
    expect(state.externalPolls.every(path => path.startsWith('/tasks/async-edit-provider-task'))).toBe(true);
    expect(state.externalPolls.length).toBeGreaterThanOrEqual(2);
    expect((state.tasks.get(taskId)?.result as Record<string, unknown>).imageUrl).toBe('/async-edited.png');
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(1);

    const late = await Promise.all(Array.from({ length: 8 }, () => agentPost(agentRequest('route-async-image-edit') as never)));
    expect(late.every(response => response.status === 200)).toBe(true);
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('durably terminalizes an accepted direct async image_edit rejection during concurrent recovery', async () => {
    state.plan = 'async-image-edit-recovery-rejection';
    const taskId = await startAgent('route-async-image-edit-recovery-rejection');

    await vi.waitFor(() => {
      expect([...state.operations.values()].find(operation => operation.stepId === 'image_edit:0')).toMatchObject({
        status: 'accepted', providerTaskId: 'async-edit-provider-task',
      });
      expect(state.parentLeaseClaimed).toBe(false);
    });
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalPolls).toHaveLength(1);
    expect(state.tasks.get(taskId)?.status).not.toBe('completed');

    const recoveries = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-async-image-edit-recovery-rejection') as never)
    )));
    expect(recoveries.every(response => response.status === 200)).toBe(true);
    await Promise.all(state.afterCallbacks.splice(0).map(worker => worker()));
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('failed'));

    expect([...state.operations.values()].find(operation => operation.stepId === 'image_edit:0')).toMatchObject({
      status: 'completed',
      response: expect.objectContaining({
        __agentDownstreamOutcome: 'known_provider_rejection',
        code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED',
        message: 'controlled accepted image edit rejection',
        providerCode: 'IMAGE_EDIT_REJECTED',
      }),
    });
    expect((state.tasks.get(taskId)?.result as Record<string, unknown>).taskError).toMatchObject({
      code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED',
      message: 'controlled accepted image edit rejection',
      retryable: false,
    });
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalPolls).toEqual([
      '/tasks/async-edit-provider-task?language=zh',
      '/tasks/async-edit-provider-task?language=zh',
    ]);
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);

    const late = await Promise.all(Array.from({ length: 8 }, async () => {
      const response = await agentPost(agentRequest('route-async-image-edit-recovery-rejection') as never);
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    }));
    expect(late.every(replay => replay.status === 409)).toBe(true);
    expect(new Set(late.map(replay => JSON.stringify(replay.body))).size).toBe(1);
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalPolls).toHaveLength(2);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('retains accepted image_edit after a retryable poll error and completes by exact later poll', async () => {
    state.plan = 'async-image-edit-retryable-poll';
    const taskId = await startAgent('route-async-image-edit-retryable-poll');

    await vi.waitFor(() => {
      expect([...state.operations.values()].find(operation => operation.stepId === 'image_edit:0')).toMatchObject({
        status: 'accepted', providerTaskId: 'async-edit-provider-task',
      });
      expect(state.parentLeaseClaimed).toBe(false);
    });
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalPolls).toEqual(['/tasks/async-edit-provider-task?language=zh']);
    expect(state.internalPolls).toHaveLength(0);

    const transientResponse = await agentPost(agentRequest('route-async-image-edit-retryable-poll') as never);
    expect(transientResponse.status).toBe(200);
    await Promise.all(state.afterCallbacks.splice(0).map(worker => worker()));
    await vi.waitFor(() => expect(state.parentLeaseClaimed).toBe(false));

    expect([...state.operations.values()].find(operation => operation.stepId === 'image_edit:0')).toMatchObject({
      status: 'accepted', providerTaskId: 'async-edit-provider-task',
    });
    expect(state.tasks.get(taskId)?.status).toBe('processing');
    expect(state.internalPolls).toEqual([
      { taskId: 'async-edit-provider-task', userId: fixtures.user.id },
    ]);
    expect(state.pollResponses).toContainEqual(expect.objectContaining({
      status: 'error', retryable: true,
    }));
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(0);

    const recoveries = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-async-image-edit-retryable-poll') as never)
    )));
    expect(recoveries.every(response => response.status === 200)).toBe(true);
    await Promise.all(state.afterCallbacks.splice(0).map(worker => worker()));
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('completed'));

    expect([...state.operations.values()].find(operation => operation.stepId === 'image_edit:0')).toMatchObject({
      status: 'completed', providerTaskId: 'async-edit-provider-task',
    });
    expect((state.tasks.get(taskId)?.result as Record<string, unknown>).imageUrl).toBe('/async-edited.png');
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalPolls).toHaveLength(1);
    expect(state.internalPolls).toHaveLength(2);
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(1);

    await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-async-image-edit-retryable-poll') as never)
    )));
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.internalPolls).toHaveLength(2);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('retains accepted image_edit when the initial direct provider poll is retryable', async () => {
    state.plan = 'async-image-edit-direct-retryable-poll';
    const taskId = await startAgent('route-async-image-edit-direct-retryable-poll');

    await vi.waitFor(() => {
      expect([...state.operations.values()].find(operation => operation.stepId === 'image_edit:0')).toMatchObject({
        status: 'accepted', providerTaskId: 'async-edit-provider-task',
      });
      expect(state.parentLeaseClaimed).toBe(false);
    });
    expect(state.tasks.get(taskId)?.status).toBe('processing');
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalPolls).toEqual(['/tasks/async-edit-provider-task?language=zh']);
    expect(state.internalPolls).toHaveLength(0);
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(0);

    const recoveries = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-async-image-edit-direct-retryable-poll') as never)
    )));
    expect(recoveries.every(response => response.status === 200)).toBe(true);
    await Promise.all(state.afterCallbacks.splice(0).map(worker => worker()));
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('completed'));

    expect([...state.operations.values()].find(operation => operation.stepId === 'image_edit:0')).toMatchObject({
      status: 'completed', providerTaskId: 'async-edit-provider-task',
    });
    expect((state.tasks.get(taskId)?.result as Record<string, unknown>).imageUrl).toBe('/async-edited.png');
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalPolls).toEqual([
      '/tasks/async-edit-provider-task?language=zh',
      '/tasks/async-edit-provider-task?language=zh',
    ]);
    expect(state.internalPolls).toHaveLength(0);
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(1);

    await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-async-image-edit-direct-retryable-poll') as never)
    )));
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalPolls).toHaveLength(2);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('behaviorally persists and polls both video task-returning branches once', async () => {
    state.plan = 'video-tools';
    const taskId = await startAgent('route-video-tools');
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('completed'));

    const operations = [...state.operations.values()].filter(operation => (
      operation.stepId === 'generate_video:0' || operation.stepId === 'extend_video:1'
    ));
    expect(operations).toHaveLength(2);
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'completed', providerTaskId: 'generate-video-provider-task' }),
      expect.objectContaining({ status: 'completed', providerTaskId: 'extend-video-provider-task' }),
    ]));
    expect(state.internalSubmits.filter(submit => submit.path === '/api/video/generate')).toHaveLength(1);
    expect(state.internalSubmits.filter(submit => submit.path === '/api/video/extend')).toHaveLength(1);
    expect(state.pollResponses.filter(response => response.status === 'completed')).toHaveLength(2);
    expect(state.parentCharges).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);

    await Promise.all(Array.from({ length: 8 }, () => agentPost(agentRequest('route-video-tools') as never)));
    expect(state.internalSubmits).toHaveLength(2);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('durably terminalizes an accepted video provider rejection without another submit or poll', async () => {
    state.plan = 'video-recovery-rejection';
    const taskId = await startAgent('route-video-recovery-rejection');

    await vi.waitFor(() => {
      expect([...state.operations.values()].find(operation => operation.stepId === 'generate_video:0')).toMatchObject({
        status: 'accepted', providerTaskId: 'generate-video-provider-task',
      });
      expect(state.parentLeaseClaimed).toBe(false);
    });
    expect(state.internalSubmits.filter(submit => submit.path === '/api/video/generate')).toHaveLength(1);
    expect(state.internalPolls).toHaveLength(1);

    await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-video-recovery-rejection') as never)
    )));
    await Promise.all(state.afterCallbacks.splice(0).map(worker => worker()));
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('failed'));

    expect([...state.operations.values()].find(operation => operation.stepId === 'generate_video:0')).toMatchObject({
      status: 'completed',
      response: expect.objectContaining({
        __agentDownstreamOutcome: 'known_provider_rejection',
        code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED',
        message: 'controlled video provider rejection',
      }),
    });
    expect(state.internalSubmits.filter(submit => submit.path === '/api/video/generate')).toHaveLength(1);
    expect(state.internalPolls).toHaveLength(2);
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);

    await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-video-recovery-rejection') as never)
    )));
    expect(state.internalSubmits.filter(submit => submit.path === '/api/video/generate')).toHaveLength(1);
    expect(state.internalPolls).toHaveLength(2);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('retains accepted video after a retryable poll error and completes by exact later poll', async () => {
    state.plan = 'video-retryable-poll';
    const taskId = await startAgent('route-video-retryable-poll');

    await vi.waitFor(() => {
      expect([...state.operations.values()].find(operation => operation.stepId === 'generate_video:0')).toMatchObject({
        status: 'accepted', providerTaskId: 'generate-video-provider-task',
      });
      expect(state.parentLeaseClaimed).toBe(false);
    });
    expect(state.tasks.get(taskId)?.status).toBe('processing');
    expect(state.internalSubmits.filter(submit => submit.path === '/api/video/generate')).toHaveLength(1);
    expect(state.internalPolls).toEqual([
      { taskId: 'generate-video-provider-task', userId: fixtures.user.id },
    ]);
    expect(state.pollResponses).toContainEqual(expect.objectContaining({
      status: 'error', retryable: true,
    }));
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(0);

    const recoveries = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-video-retryable-poll') as never)
    )));
    expect(recoveries.every(response => response.status === 200)).toBe(true);
    await Promise.all(state.afterCallbacks.splice(0).map(worker => worker()));
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('completed'));

    expect([...state.operations.values()].find(operation => operation.stepId === 'generate_video:0')).toMatchObject({
      status: 'completed', providerTaskId: 'generate-video-provider-task',
    });
    expect(state.internalSubmits.filter(submit => submit.path === '/api/video/generate')).toHaveLength(1);
    expect(state.internalPolls).toHaveLength(2);
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(1);

    await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-video-retryable-poll') as never)
    )));
    expect(state.internalSubmits.filter(submit => submit.path === '/api/video/generate')).toHaveLength(1);
    expect(state.internalPolls).toHaveLength(2);
    expect(state.parentRefunds).toBe(0);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('fails closed when acceptance persistence fails after an async image task ID is returned', async () => {
    state.plan = 'async-image-edit-acceptance-failure';
    const taskId = await startAgent('route-async-image-edit-acceptance-failure');
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('failed'));

    const parent = state.tasks.get(taskId)!;
    expect((parent.result as Record<string, unknown>).taskError).toMatchObject({
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN', retryable: false,
    });
    expect([...state.operations.values()].find(operation => operation.stepId === 'image_edit:0')).toMatchObject({
      status: 'submission_unknown',
    });
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalSubmits[0]).toMatchObject({ body: { model: 'Exact::Model' } });
    expect(state.acceptanceWriteAttempts).toBe(1);
    expect(state.externalPolls).toHaveLength(0);
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);

    const late = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-async-image-edit-acceptance-failure') as never)
    )));
    expect(late.every(response => response.status === 409)).toBe(true);
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.acceptanceWriteAttempts).toBe(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
    expect((state.tasks.get(taskId)?.result as Record<string, unknown>).taskError).toMatchObject({
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN', retryable: false,
    });
  });

  it('fails closed after synchronous image_edit loses the connection after send', async () => {
    state.plan = 'sync-image-edit-loss';
    const taskId = await startAgent('route-sync-image-edit-loss');
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('failed'));

    expect((state.tasks.get(taskId)?.result as Record<string, unknown>).taskError).toMatchObject({
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN', retryable: false,
    });
    expect([...state.operations.values()].find(operation => operation.stepId === 'image_edit:0')).toMatchObject({
      status: 'submission_unknown',
    });
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalSubmits[0]).toMatchObject({ body: { model: 'Exact::Model' } });
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);

    const late = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-sync-image-edit-loss') as never)
    )));
    expect(late.every(response => response.status === 409)).toBe(true);
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('fails closed when the real Agent loop sees chat connection loss after send', async () => {
    state.plan = 'chat-post-send-loss';
    const taskId = await startAgent('route-chat-post-send-loss');
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('failed'));

    expect((state.tasks.get(taskId)?.result as Record<string, unknown>).taskError).toMatchObject({
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN', retryable: false,
    });
    expect([...state.operations.values()].find(operation => operation.stepId === 'llm:0')).toMatchObject({
      status: 'submission_unknown',
    });
    expect(state.chatSubmits).toHaveLength(1);
    expect(state.chatSubmits[0].key).not.toBe('');
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);

    const late = await Promise.all(Array.from({ length: 8 }, () => (
      agentPost(agentRequest('route-chat-post-send-loss') as never)
    )));
    expect(late.every(response => response.status === 409)).toBe(true);
    expect(state.chatSubmits).toHaveLength(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('durably terminalizes an explicit chat provider rejection without resubmit', async () => {
    state.plan = 'chat-provider-rejection';
    const taskId = await startAgent('route-chat-provider-rejection');
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('failed'));

    const parent = state.tasks.get(taskId)!;
    expect((parent.result as Record<string, unknown>).taskError).toMatchObject({
      code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED', retryable: false,
    });
    expect(parent.status).not.toBe('completed');
    expect([...state.operations.values()].find(operation => operation.stepId === 'llm:0')).toMatchObject({
      status: 'completed',
      response: expect.objectContaining({
        __agentDownstreamOutcome: 'known_provider_rejection',
        code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED',
      }),
    });
    expect(state.chatSubmits).toHaveLength(1);
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);

    const late = await Promise.all(Array.from({ length: 8 }, async () => {
      const response = await agentPost(agentRequest('route-chat-provider-rejection') as never);
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    }));
    expect(late.every(replay => replay.status === 409)).toBe(true);
    expect(new Set(late.map(replay => JSON.stringify(replay.body))).size).toBe(1);
    expect(late[0].body).toMatchObject({
      success: false, code: 'AGENT_TASK_TERMINAL', taskId, status: 'failed', replayed: true,
    });
    expect(state.chatSubmits).toHaveLength(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('durably terminalizes an explicit direct image_edit rejection without resubmit', async () => {
    state.plan = 'sync-image-edit-rejection';
    const taskId = await startAgent('route-sync-image-edit-rejection');
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('failed'));

    const parent = state.tasks.get(taskId)!;
    expect((parent.result as Record<string, unknown>).taskError).toMatchObject({
      code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED', retryable: false,
    });
    expect(parent.status).not.toBe('completed');
    expect([...state.operations.values()].find(operation => operation.stepId === 'image_edit:0')).toMatchObject({
      status: 'completed',
      response: expect.objectContaining({
        __agentDownstreamOutcome: 'known_provider_rejection',
        code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED',
      }),
    });
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalSubmits[0]).toMatchObject({ body: { model: 'Exact::Model' } });
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);

    const late = await Promise.all(Array.from({ length: 8 }, async () => {
      const response = await agentPost(agentRequest('route-sync-image-edit-rejection') as never);
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    }));
    expect(late.every(replay => replay.status === 409)).toBe(true);
    expect(new Set(late.map(replay => JSON.stringify(replay.body))).size).toBe(1);
    expect(late[0].body).toMatchObject({
      success: false, code: 'AGENT_TASK_TERMINAL', taskId, status: 'failed', replayed: true,
    });
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
  });

  it('durably terminalizes an explicit generate_image rejection without resubmit', async () => {
    state.plan = 'generate-image-rejection';
    const taskId = await startAgent('route-generate-image-rejection');
    await vi.waitFor(() => expect(state.tasks.get(taskId)?.status).toBe('failed'));

    const parent = state.tasks.get(taskId)!;
    expect((parent.result as Record<string, unknown>).taskError).toMatchObject({
      code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED', retryable: false,
    });
    expect(parent.status).not.toBe('completed');
    expect([...state.operations.values()].find(operation => operation.stepId === 'generate_image:0')).toMatchObject({
      status: 'completed',
      response: expect.objectContaining({
        __agentDownstreamOutcome: 'known_provider_rejection',
        code: 'AGENT_DOWNSTREAM_PROVIDER_REJECTED',
      }),
    });
    expect(state.submitOnlyCalls).toHaveLength(1);
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.externalSubmits[0]).toMatchObject({ body: { model: 'Exact::Model' } });
    expect(state.parentCharges).toBe(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);

    const late = await Promise.all(Array.from({ length: 8 }, async () => {
      const response = await agentPost(agentRequest('route-generate-image-rejection') as never);
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    }));
    expect(late.every(replay => replay.status === 409)).toBe(true);
    expect(new Set(late.map(replay => JSON.stringify(replay.body))).size).toBe(1);
    expect(late[0].body).toMatchObject({
      success: false, code: 'AGENT_TASK_TERMINAL', taskId, status: 'failed', replayed: true,
    });
    expect(state.submitOnlyCalls).toHaveLength(1);
    expect(state.externalSubmits).toHaveLength(1);
    expect(state.parentRefunds).toBe(1);
    expect(state.parentTerminalCalls).toBe(1);
  });
});
