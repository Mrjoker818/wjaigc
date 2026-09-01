import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CloudTask, CreateBillableCloudTaskInput, UpdateCloudTaskInput, TransitionCloudTaskStatusInput } from '@/lib/cloud-task-storage';

// Keep the route, registry, persistence service and terminal guard real. Only
// external I/O is isolated; these tests are not cloud billing verification.
const io = vi.hoisted(() => ({
  tasks: new Map<string, CloudTask>(),
  submit: vi.fn(),
  provider: vi.fn(), fallbackProvider: vi.fn(),
  charge: vi.fn(),
  refund: vi.fn(),
  append: vi.fn(),
  create: vi.fn(),
  poll: vi.fn(),
  atomic: vi.fn(), quote: vi.fn(), settle: vi.fn(), update: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: vi.fn(async () => ({ id: 'refine-contract-user', name: 'Test user' })),
}));
vi.mock('@/lib/credits', () => ({ consumeCredits: io.charge, refundCredits: io.refund, calculateConfiguredCreditCost: io.quote }));
vi.mock('@/lib/api-auth', () => ({
  getRequestUser: vi.fn(async () => ({ user: { id: 'refine-contract-user', role: 'user' }, source: 'cookie' })),
  getInternalRequestHeaders: vi.fn(async () => ({})),
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: io.provider,
  findProviderForModel: io.fallbackProvider,
  getApiProviders: vi.fn(async () => []),
  normalizeApiBaseUrl: (url: string) => url,
}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: io.submit, getInternalApiUrl: (url: string) => url }));
vi.mock('@/lib/identify-subject', () => ({ identifyImageSubject: vi.fn(async () => null) }));
vi.mock('@/lib/persist-result-image', () => ({ persistResultImage: vi.fn(async (url: string) => url) }));
vi.mock('@/lib/op-log', () => ({ logOperation: vi.fn(), logError: vi.fn(), OP_ACTIONS: {} }));
vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: io.append }));
vi.mock('@/lib/cloud-task-storage', () => ({
  createCloudTask: io.create,
  createBillableCloudTask: io.atomic,
  getCloudTaskById: vi.fn(async (id: string) => io.tasks.get(id) ?? null),
  getCloudTaskForUser: vi.fn(async (id: string, userId: string) => {
    const task = io.tasks.get(id);
    return task?.userId === userId ? task : null;
  }),
  transitionCloudTaskStatus: vi.fn(async (input: TransitionCloudTaskStatusInput) => {
    const task = io.tasks.get(input.taskId);
    if (!task || task.status !== 'processing' || input.to !== 'completed') {
      throw new Error('Unexpected storage transition in completion control');
    }
    const completed: CloudTask = {
      ...task, status: 'completed', progress: 100, result: input.result,
      creditStatus: input.creditStatus ?? task.creditStatus,
      revision: (task.revision ?? 0) + 1,
    };
    io.tasks.set(task.id, completed);
    return { transitioned: true, task: completed };
  }),
  claimCloudTaskLease: vi.fn(async () => ({ owner: 'test-recovery', expiresAt: Date.now() + 60000, attemptCount: 1 })),
  completeCloudTask: vi.fn(),
  deferCloudTaskRecovery: vi.fn(),
  refundCloudTaskCredits: vi.fn(),
  terminateCloudTaskAndRefund: io.settle,
  updateCloudTask: io.update,
}));
vi.mock('@/lib/api-compatibility', () => ({
  resolveCompatProfile: () => ({ id: 'apimart' }),
  resolveProfileForModel: () => ({ id: 'apimart' }),
  adjustRequestForProfile: (body: unknown) => ({ body, endpoint: '/images/generations' }),
  parseResponseForProfile: (body: unknown) => body,
  buildPollUrl: (base: string, id: string) => `${base}/tasks/${id}`,
  extractImageUrl: (body: { data?: { result?: { images?: Array<{ url: string }> } } }) => body.data?.result?.images?.[0]?.url,
  isEditsEndpointRejected: () => false,
  isChannelUnavailableError: () => false,
}));
vi.mock('@/lib/remove-bg-postprocess', () => ({ postProcessAIRemoveBG: vi.fn() }));
vi.mock('@/lib/fetch-image-buffer', () => ({ fetchImageBuffer: vi.fn() }));
vi.mock('@/lib/image-tools/masked-edit-composite', () => ({ compositeMaskedEdit: vi.fn() }));
vi.mock('@/lib/edit-task-store', () => ({ getEditTask: vi.fn(), cancelEditTask: vi.fn(), deleteEditTask: vi.fn(), setEditTask: vi.fn(), failEditTask: vi.fn() }));
vi.mock('@/lib/quality-enhance', () => ({ enhanceViaAI: vi.fn() }));
vi.mock('@/lib/layer-decomposition/service', () => ({ getLayerTaskStatus: vi.fn() }));
vi.mock('@/lib/asset-core/task-projector', () => ({ recordTaskLateResultAudit: vi.fn(), recordTaskProjectionPending: vi.fn() }));
vi.mock('@/lib/agent-runtime/workspace-results', () => ({ agentWorkspaceProjectionIdempotencyKey: vi.fn(), projectAgentResultToWorkspace: vi.fn() }));

import { POST as refine } from '@/app/api/refine-engine/route';
import { POST as poll } from '@/app/api/poll-task/route';
import { POST as cancel } from '@/app/api/cancel-task/route';
import { getTaskInfo, updateTaskProgress } from '@/lib/task-registry';

const provider = {
  id: 'apimart-contract', name: 'APImart contract fixture',
  baseUrl: 'https://provider.example', apiKey: 'fixture-key-not-real',
  isEnabled: true, modelType: 'image', selectedModels: ['gpt-image-2'],
};
const taskIds: string[] = [];
const input = {
  action: 'refine', imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
  model: 'gpt-image-2', providerId: provider.id, productName: 'Blue ceramic cup',
};

function request(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function submitRefine(): Promise<string> {
  const response = await refine(request('/api/refine-engine', input));
  const payload = await response.json();
  expect(response.status).toBe(200);
  expect(payload).toMatchObject({ success: true, providerId: provider.id, model: input.model });
  expect(typeof payload.taskId).toBe('string');
  taskIds.push(payload.taskId);
  return payload.taskId;
}

beforeEach(() => {
  vi.clearAllMocks();
  io.tasks.clear();
  io.provider.mockResolvedValue(provider);
  io.fallbackProvider.mockResolvedValue(provider);
  io.charge.mockResolvedValue({ success: true, cost: 12 });
  io.refund.mockResolvedValue({ success: true, balance: 1000 });
  io.quote.mockResolvedValue(12);
  io.atomic.mockImplementation(async (value: CreateBillableCloudTaskInput) => {
    const task = { ...value.task, userId: value.userId, creditCost: value.creditCost, creditStatus: 'pending', revision: 0 } as CloudTask;
    io.tasks.set(task.id, task);
    return { task, reused: false, charged: true };
  });
  io.update.mockImplementation(async (id: string, patch: UpdateCloudTaskInput) => {
    const task = io.tasks.get(id);
    if (!task || (patch.expectedStatuses && !patch.expectedStatuses.includes(task.status))) return false;
    io.tasks.set(id, { ...task, ...patch, result: patch.mergeResult ? { ...task.result, ...patch.result } : patch.result ?? task.result });
    return true;
  });
  io.settle.mockImplementation(async (id: string, status: 'failed' | 'cancelled' | 'timeout', error: string) => {
    const task = io.tasks.get(id);
    if (!task || task.status === 'completed') return { transitioned: false, refunded: false, creditCost: 0 };
    const transitioned = task.status === 'processing';
    const refunded = task.creditStatus === 'pending';
    io.tasks.set(id, { ...task, status: transitioned ? status : task.status, error, creditStatus: refunded ? 'refunded' : task.creditStatus });
    return { transitioned, refunded, status: io.tasks.get(id)?.status, creditCost: task.creditCost };
  });
  io.create.mockImplementation(async (task: CloudTask) => { io.tasks.set(task.id, task); return true; });
  io.submit.mockImplementation(async () => Response.json({ taskIds: ['remote-refine-contract'] }));
  io.poll.mockImplementation(async () => Response.json({ data: {
    status: 'completed', progress: 100,
    result: { images: [{ url: '/api/serve-upload/uploads/refined-fixture.png' }] },
  } }));
  vi.stubGlobal('fetch', io.poll);
});

afterEach(() => {
  for (const id of taskIds.splice(0)) updateTaskProgress(id, { status: 'failed', error: 'Test cleanup' });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('refine async submission to authoritative completion', () => {
  it.each([
    ['missing provider', null, input.model],
    ['model outside provider catalog', { ...provider, selectedModels: ['other-image-model'] }, input.model],
  ])('rejects an explicit provider/model mismatch before durable task creation: %s', async (_label, resolvedProvider, model) => {
    io.provider.mockResolvedValueOnce(resolvedProvider);

    const response = await refine(request('/api/refine-engine', { ...input, model }));
    const payload = await response.json();
    if (typeof payload.taskId === 'string') taskIds.push(payload.taskId);

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      success: false,
      code: 'MODEL_PROVIDER_MISMATCH',
      providerId: provider.id,
      model,
    });
    expect(io.fallbackProvider).not.toHaveBeenCalled();
    expect(io.atomic).not.toHaveBeenCalled();
    expect(io.submit).not.toHaveBeenCalled();
  });

  it('control: submits once and retains the selected provider and remote task', async () => {
    const taskId = await submitRefine();
    expect(io.submit).toHaveBeenCalledTimes(1);
    expect(io.atomic).toHaveBeenCalledTimes(1);
    expect(io.charge).not.toHaveBeenCalled();
    expect(getTaskInfo(taskId)).toMatchObject({ status: 'processing', result: {
      providerId: provider.id, usedModel: input.model, remoteTaskId: 'remote-refine-contract',
    } });
  });

  it('persists the charged task before acknowledging an async submission', async () => {
    const taskId = await submitRefine();
    expect(io.tasks.get(taskId)).toMatchObject({
      id: taskId, userId: 'refine-contract-user', type: 'refine-engine',
      providerId: provider.id, model: input.model, creditCost: 12,
    });
  });

  it('retains the charged cost in the registry for async failure accounting', async () => {
    const taskId = await submitRefine();
    expect(getTaskInfo(taskId)?.creditCost).toBe(12);
  });

  it('does not submit upstream when atomic task creation fails', async () => {
    io.atomic.mockRejectedValueOnce(new Error('Database unavailable'));
    const response = await refine(request('/api/refine-engine', input));
    expect(response.status).toBe(500);
    expect(io.submit).not.toHaveBeenCalled();
    expect(io.charge).not.toHaveBeenCalled();
    expect(io.refund).not.toHaveBeenCalled();
  });

  it('persists the remote task and never persists provider credentials', async () => {
    const taskId = await submitRefine();
    expect(io.tasks.get(taskId)).toMatchObject({ remoteTaskId: 'remote-refine-contract', status: 'processing' });
    expect(JSON.stringify(io.tasks.get(taskId))).not.toContain(provider.apiKey);
    expect(io.atomic.mock.invocationCallOrder[0]).toBeLessThan(io.submit.mock.invocationCallOrder[0]);
  });

  it('persists synchronous results before exposing completed images', async () => {
    io.submit.mockImplementationOnce(async () => Response.json({ directImageUrls: ['/api/serve-upload/uploads/sync-refine.png'] }));
    const response = await refine(request('/api/refine-engine', input));
    const payload = await response.json();
    taskIds.push(payload.taskId);
    expect(payload).toMatchObject({ success: true, directImageUrls: ['/api/serve-upload/uploads/sync-refine.png'] });
    expect(io.tasks.get(payload.taskId)).toMatchObject({ status: 'completed', creditStatus: 'charged', result: { imageUrl: '/api/serve-upload/uploads/sync-refine.png' } });
  });

  it('settles a synchronous provider failure against the task instead of a separate refund', async () => {
    io.submit.mockRejectedValueOnce(new Error('Provider connection failed'));
    const response = await refine(request('/api/refine-engine', input));
    const payload = await response.json();
    taskIds.push(payload.taskId);
    expect(payload).toMatchObject({ success: false, error: expect.stringContaining('Provider connection failed') });
    expect(io.tasks.get(payload.taskId)).toMatchObject({ status: 'failed', creditStatus: 'refunded' });
    expect(io.refund).not.toHaveBeenCalled();
  });

  it.each(['failed', 'cancelled'])('atomically settles provider %s without independent refunds', async status => {
    const taskId = await submitRefine();
    io.poll.mockImplementationOnce(async () => Response.json({ data: { status, error: 'Provider task rejected' } }));
    const response = await poll(request('/api/poll-task', { taskId }));
    expect(await response.json()).toMatchObject({ success: false, status });
    expect(io.tasks.get(taskId)).toMatchObject({ status, creditStatus: 'refunded' });
    expect(io.refund).not.toHaveBeenCalled();
  });

  it('cancel uses atomic settlement and rejects a late provider completion', async () => {
    const taskId = await submitRefine();
    expect(await (await cancel(request('/api/cancel-task', { taskId }))).json()).toMatchObject({ success: true });
    expect(io.tasks.get(taskId)).toMatchObject({ status: 'cancelled', creditStatus: 'refunded' });
    expect(await (await poll(request('/api/poll-task', { taskId }))).json()).toMatchObject({ success: false, status: 'cancelled' });
    expect(io.refund).not.toHaveBeenCalled();
  });

  it('repeated completed polls do not create, charge or submit again', async () => {
    const taskId = await submitRefine();
    for (let index = 0; index < 3; index++) {
      expect(await (await poll(request('/api/poll-task', { taskId }))).json()).toMatchObject({ success: true, status: 'completed' });
    }
    expect(io.atomic).toHaveBeenCalledTimes(1);
    expect(io.submit).toHaveBeenCalledTimes(1);
    expect(io.poll).toHaveBeenCalledTimes(1);
  });

  it('after losing process memory polls the persisted remote ID without submitting again', async () => {
    const taskId = await submitRefine();
    const store = (globalThis as unknown as { __wujie_task_store__: { registry: Map<string, unknown> } }).__wujie_task_store__;
    store.registry.delete(taskId);
    io.tasks.set(taskId, { ...io.tasks.get(taskId)!, updatedAt: Date.now() - 60000 });
    const response = await poll(request('/api/poll-task', { taskId }));
    expect(await response.json()).toMatchObject({ success: true, status: 'completed' });
    expect(String(io.poll.mock.calls[0]?.[0])).toContain('remote-refine-contract');
    expect(io.submit).toHaveBeenCalledTimes(1);
    expect(io.atomic).toHaveBeenCalledTimes(1);
  });

  it('after a restart without a remote ID waits then times out without resubmitting', async () => {
    const taskId = await submitRefine();
    const task = io.tasks.get(taskId)!;
    const store = (globalThis as unknown as { __wujie_task_store__: { registry: Map<string, unknown> } }).__wujie_task_store__;
    store.registry.delete(taskId);
    io.tasks.set(taskId, { ...task, remoteTaskId: '', result: {} });
    expect(await (await poll(request('/api/poll-task', { taskId }))).json()).toMatchObject({ status: 'processing', recoveryPending: true });
    io.tasks.set(taskId, { ...task, remoteTaskId: '', result: {}, createdAt: Date.now() - 13 * 60000 });
    expect(await (await poll(request('/api/poll-task', { taskId }))).json()).toMatchObject({ success: false, status: 'failed', terminalStatus: 'timeout' });
    expect(io.tasks.get(taskId)?.creditStatus).toBe('refunded');
    expect(io.poll).not.toHaveBeenCalled();
    expect(io.submit).toHaveBeenCalledTimes(1);
  });

  it('retries a remote linkage write without refunding or resubmitting accepted work', async () => {
    io.update.mockRejectedValueOnce(new Error('Temporary storage failure'));
    const response = await refine(request('/api/refine-engine', input));
    const payload = await response.json();
    taskIds.push(payload.taskId);
    // RefineEnginePanel exits on !data.success && data.error before tracking taskId.
    expect(response.ok).toBe(true);
    expect(payload.error).toBeUndefined();
    expect(payload).toMatchObject({ success: true, taskId: expect.any(String), status: 'processing', recoveryPending: true });
    expect(io.settle).not.toHaveBeenCalled();
    expect(await (await poll(request('/api/poll-task', { taskId: payload.taskId }))).json()).toMatchObject({ success: true, status: 'completed' });
    expect(io.tasks.get(payload.taskId)?.remoteTaskId).toBe('remote-refine-contract');
    expect(io.submit).toHaveBeenCalledTimes(1);
  });

  it('retries a failed settlement without polling the provider or losing the reason', async () => {
    io.submit.mockRejectedValueOnce(new Error('Provider connection failed'));
    io.settle.mockRejectedValueOnce(new Error('Temporary settlement failure'));
    const payload = await (await refine(request('/api/refine-engine', input))).json();
    taskIds.push(payload.taskId);
    expect(payload).toMatchObject({ success: true, status: 'processing', recoveryPending: true });
    expect(payload.error).toBeUndefined();
    expect(await (await poll(request('/api/poll-task', { taskId: payload.taskId }))).json()).toMatchObject({ success: false, status: 'failed' });
    expect(io.tasks.get(payload.taskId)?.creditStatus).toBe('refunded');
    expect(io.submit).toHaveBeenCalledTimes(1);
    expect(io.poll).not.toHaveBeenCalled();
  });

  it('never polls a fallback provider when the original provider is disabled', async () => {
    const taskId = await submitRefine();
    io.provider.mockResolvedValue({ ...provider, isEnabled: false });
    io.fallbackProvider.mockResolvedValue({ ...provider, id: 'other-provider', baseUrl: 'https://other.example' });
    const payload = await (await poll(request('/api/poll-task', { taskId, providerId: 'other-provider', apiBaseUrl: 'https://other.example', apiKey: 'other-key' }))).json();
    expect(payload).toMatchObject({ success: true, status: 'processing', recoveryPending: true });
    expect(io.poll).not.toHaveBeenCalled();
    expect(io.fallbackProvider).not.toHaveBeenCalled();
    expect(io.tasks.get(taskId)?.providerId).toBe(provider.id);
  });

  it('exposes all recovered synchronous images in the existing panel result format', async () => {
    const taskId = await submitRefine();
    const urls = ['/api/serve-upload/one.png', '/api/serve-upload/two.png'];
    updateTaskProgress(taskId, { result: { directImageUrls: urls } });
    const payload = await (await poll(request('/api/poll-task', { taskId }))).json();
    expect(payload).toMatchObject({ status: 'completed', result: { imageUrls: urls } });
  });

  it.each(['completed', 'timeout'] as const)('preserves the panel contract for persisted %s after a restart', async status => {
    const taskId = await submitRefine();
    const urls = ['/api/serve-upload/one.png', '/api/serve-upload/two.png'];
    io.tasks.set(taskId, { ...io.tasks.get(taskId)!, status,
      result: { imageUrl: urls[0], imageUrls: urls }, error: status === 'timeout' ? 'Submission timed out' : undefined });
    const store = (globalThis as unknown as { __wujie_task_store__: { registry: Map<string, unknown> } }).__wujie_task_store__;
    store.registry.delete(taskId);
    const payload = await (await poll(request('/api/poll-task', { taskId }))).json();
    expect(payload).toMatchObject(status === 'completed'
      ? { success: true, status: 'completed', result: { imageUrls: urls } }
      : { success: false, status: 'failed', terminalStatus: 'timeout' });
    expect(io.poll).not.toHaveBeenCalled();
    expect(io.tasks.get(taskId)?.status).toBe(status);
  });

  it('delivers a provider-completed image through the real poll terminal guard', async () => {
    const taskId = await submitRefine();
    const response = await poll(request('/api/poll-task', { taskId, providerId: provider.id, model: input.model }));
    const payload = await response.json();
    expect(io.poll).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, status: 'completed', imageUrl: '/api/serve-upload/uploads/refined-fixture.png' });
    expect(io.refund).not.toHaveBeenCalled();
  });

  it('control: the unchanged terminal guard delivers a task with a durable record', async () => {
    const taskId = await submitRefine();
    // Test-only seed isolates the missing submission record, not a production fix.
    io.tasks.set(taskId, {
      id: taskId, userId: 'refine-contract-user', type: 'refine-engine',
      status: 'processing', progress: 30, providerId: provider.id, model: input.model,
      remoteTaskId: 'remote-refine-contract', creditCost: 12, creditStatus: 'pending',
      createdAt: Date.now(), updatedAt: Date.now(), revision: 0,
    });
    updateTaskProgress(taskId, { creditCost: 12 });
    const response = await poll(request('/api/poll-task', { taskId, providerId: provider.id, model: input.model }));
    expect(await response.json()).toMatchObject({
      success: true, status: 'completed', imageUrl: '/api/serve-upload/uploads/refined-fixture.png',
    });
    expect(io.tasks.get(taskId)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 12 });
    expect(io.refund).not.toHaveBeenCalled();
  });

  it('control: a late provider result cannot overwrite a cancelled durable task', async () => {
    const taskId = await submitRefine();
    io.tasks.set(taskId, {
      id: taskId, userId: 'refine-contract-user', type: 'refine-engine',
      status: 'cancelled', progress: 30, providerId: provider.id, model: input.model,
      creditCost: 12, creditStatus: 'refunded', createdAt: Date.now(), updatedAt: Date.now(), revision: 1,
    });
    const response = await poll(request('/api/poll-task', { taskId, providerId: provider.id, model: input.model }));
    expect(await response.json()).toMatchObject({ success: false, status: 'cancelled' });
    expect(io.tasks.get(taskId)).toMatchObject({ status: 'cancelled', creditStatus: 'refunded' });
    expect(io.append).not.toHaveBeenCalled();
  });
});
