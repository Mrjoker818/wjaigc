import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  user: { id: 'y-user', name: 'Synthetic', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 },
  authenticated: true, denyProject: false, denyModel: false,
  provider: { id: 'y-b', name: 'Synthetic B', type: 'image', modelType: 'image', apiKey: 'offline-only-key',
    baseUrl: 'https://retry-provider.invalid', selectedModels: ['y-image'], isEnabled: true, createdAt: 1, updatedAt: 1 },
  tasks: new Map<string, Record<string, unknown>>(), submissions: [] as Record<string, unknown>[],
  charges: 0, reads: 0, network: vi.fn(),
}));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: (): void => {} }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => state.authenticated ? state.user : null }));
vi.mock('@/lib/desktop-cloud', async original => ({ ...await original<typeof import('@/lib/desktop-cloud')>(), getDesktopAuth: async () => null }));
vi.mock('@/lib/collaboration/generation-project-access', async original => {
  const actual = await original<typeof import('@/lib/collaboration/generation-project-access')>();
  return { ...actual, authorizeGenerationProject: async ({ actorUserId, projectId }: { actorUserId: string; projectId?: unknown }) => {
    if (state.denyProject) throw new actual.GenerationProjectAccessError('GENERATION_PROJECT_FORBIDDEN');
    return { kind: 'personal', actorUserId, ownerId: actorUserId, projectId };
  } };
});
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: async (id: string) => id === 'y-b' ? state.provider : null,
  findProviderForModel: async () => state.provider,
  findAllProvidersForType: async () => [{ provider: state.provider, models: ['y-image'] }],
  normalizeApiBaseUrl: (value: string): string => value,
}));
vi.mock('@/lib/task-core/model-catalog', async () => {
  const { ModelCapabilityError } = await import('@/lib/task-core/model-capability-contract');
  return { resolveTaskModelForUser: async (providerId: string, modelId: string) => {
    if (state.denyModel) throw new ModelCapabilityError('MODEL_NOT_AUTHORIZED', 'Synthetic model authorization denied', { providerId, modelId });
    return {
  providerId, modelId, kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'sync',
  allowedRatios: ['1:1'], allowedSizes: ['1024x1024'], qualityOptions: ['high'], maxOutputs: 1,
  supportsReferenceImages: false, supportsMask: false, supportedOperations: ['text-to-image'], outputKinds: ['png'], capabilitySources: {},
    };
  } };
});
vi.mock('@/lib/credits', async original => ({ ...await original<typeof import('@/lib/credits')>(),
  calculateConfiguredCreditCost: async () => 7, checkCredits: async () => ({ sufficient: true, balance: 100 }),
  consumeCredits: async () => { throw Error('Y_UNEXPECTED_DIRECT_CHARGE'); },
}));
vi.mock('@/lib/cloud-task-storage', async original => ({ ...await original<typeof import('@/lib/cloud-task-storage')>(),
  getCloudTaskForUser: async (id: string, userId: string) => { state.reads++; const task = state.tasks.get(id); return task?.userId === userId ? task : null; },
  getCloudTaskForUserByIdempotencyKey: async (userId: string, key: string) => [...state.tasks.values()].find(task => task.userId === userId && task.idempotencyKey === key) ?? null,
  chargeCloudTaskCredits: async () => { state.charges++; return { charged: true, creditCost: 7 }; },
  // Atomic storage is a boundary fake here; concurrent/ledger proof lives in the real PostgreSQL suite.
  createBillableCloudTask: async (input: { userId: string; idempotencyKey: string; requestDigest: string; creditCost: number; task: Record<string, unknown> }) => {
    const existing = [...state.tasks.values()].find(task => task.userId === input.userId && task.idempotencyKey === input.idempotencyKey);
    if (existing) return { task: existing, reused: true, charged: false };
    const task: Record<string, unknown> = { ...input.task, userId: input.userId, idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest,
      creditStatus: 'pending', creditCost: input.creditCost, revision: 0 };
    state.submissions.push({ ...task, taskId: task.id, submissionPayload: (task.result as Record<string, unknown>).submissionPayload });
    state.tasks.set(String(task.id), task); state.charges++;
    return { task, reused: false, charged: true };
  },
  terminateCloudTaskAndRefund: async () => { throw Error('Y_UNEXPECTED_OLD_REFUND'); },
  updateCloudTask: async () => { throw Error('Y_UNEXPECTED_OLD_TASK_WRITE'); },
}));
vi.mock('@/lib/cloud-task-persistence', () => ({
  recordImageTaskSubmitted: async (input: Record<string, unknown>) => {
    if ([...state.tasks.values()].some(task => task.userId === input.userId && task.idempotencyKey === input.idempotencyKey)) return false;
    state.submissions.push(structuredClone(input));
    state.tasks.set(String(input.taskId), { ...input, id: input.taskId, status: 'processing', creditStatus: 'charged', result: { submissionPayload: input.submissionPayload } });
    return true;
  },
  recordImageTaskTerminal: async () => { throw Error('Y_UNEXPECTED_TERMINAL_WRITE'); },
}));
vi.mock('@/lib/task-registry', () => ({ markTaskDurable: (): void => {}, registerTask: (): void => {}, updateTaskProgress: (): void => {}, isTaskCancelled: () => false, getTaskInfo: () => undefined }));
vi.mock('@/lib/task-core/durable-generation-kickoff', () => ({ kickoffDurableGenerationTasks: async () => undefined }));
vi.mock('@/lib/s3-storage', () => ({ persistRemoteImage: async () => { throw Error('Y_UNEXPECTED_ASSET_WRITE'); } }));
vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: async () => undefined }));
vi.mock('@/lib/op-log', () => ({ logOperation: (): void => {}, logError: (): void => {}, startTimer: () => ({ end: () => 0 }), OP_ACTIONS: { IMAGE_GENERATE: 'image_generate' }, sanitizeRequestData: (value: unknown): unknown => value }));

import { POST } from '@/app/api/generate/route';

const frozen = { projectId: 'y-project', prompt: '原任务的蓝色杯子', model: 'y-image', providerId: 'y-b',
  aspectRatio: '1:1', size: '1024x1024', quality: 'high', referenceImages: [], outputCount: 4, n: 4 };
function oldTask(extra: Record<string, unknown> = {}, payload: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'y-old-task', userId: 'y-user', projectId: 'y-project', type: 'generate-async', status: 'failed',
    providerId: 'y-b', model: 'y-image', creditStatus: 'refunded', idempotencyKey: 'old-attempt:0',
    progress: 0, createdAt: 1, updatedAt: 2, error: '原始供应商错误',
    result: { submissionPayload: { ...frozen, ...payload, workerMode: 'recovery', batchId: 'old-batch', slotId: 'old-slot', slotIndex: 0, requestDigest: 'old-digest' } }, ...extra };
}
function retry(extra: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ retryTaskId: 'y-old-task', projectId: 'y-project', submitOnly: true, outputCount: 1, n: 1, ...extra }) });
}
beforeEach(() => {
  vi.clearAllMocks(); state.authenticated = true; state.denyProject = false; state.denyModel = false;
  state.tasks.clear(); state.tasks.set('y-old-task', oldTask()); state.submissions = []; state.charges = 0; state.reads = 0;
  state.network.mockImplementation(() => { throw Error('Y_EXTERNAL_NETWORK_FORBIDDEN'); });
  vi.stubGlobal('fetch', state.network);
  vi.stubEnv('WUJIE_ENABLE_IN_PROCESS_ASYNC_WORKER', 'false');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function noAdmission(): void {
  expect(state.submissions).toEqual([]); expect(state.charges).toBe(0); expect(state.network).not.toHaveBeenCalled();
}
describe('standalone retry y api', () => {
  it.each(['failed', 'timeout'])('replays %s from server-owned identity with exactly one new output', async status => {
    state.tasks.set('y-old-task', oldTask({ status }));
    const before = structuredClone(state.tasks.get('y-old-task'));
    const response = await POST(retry()), result = await response.json();
    expect(response.status, 'standalone retry y api accepts a safe terminal retry').toBe(200);
    expect(result.success).toBe(true); expect(result.taskId).not.toBe('y-old-task');
    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0].submissionPayload).toMatchObject({ projectId: 'y-project', prompt: '原任务的蓝色杯子', providerId: 'y-b', model: 'y-image',
      aspectRatio: '1:1', size: '1024x1024', quality: 'high', referenceImages: [], outputCount: 1, n: 1 });
    expect(state.submissions[0].submissionPayload).not.toHaveProperty('retryTaskId');
    expect(state.submissions[0].submissionPayload).not.toHaveProperty('_skipCredits');
    expect(state.charges).toBe(1); expect(state.tasks.get('y-old-task')).toEqual(before); expect(state.network).not.toHaveBeenCalled();
  });
  it('reuses the same new admission after a lost receipt instead of charging twice', async () => {
    const a = await POST(retry()), b = await POST(retry());
    expect(a.status, 'standalone retry y api first retry admission').toBe(200); expect(b.status).toBe(200);
    const first = await a.json(), second = await b.json();
    expect(second.taskId).toBe(first.taskId); expect(state.submissions).toHaveLength(1); expect(state.charges).toBe(1);
    expect(state.tasks.get('y-old-task')?.status).toBe('failed'); expect(state.network).not.toHaveBeenCalled();
  });
  const denied: Array<{ name: string; status: number; task?: Record<string, unknown>; payload?: Record<string, unknown>; client?: Record<string, unknown>; missing?: boolean; denyProject?: boolean; denyModel?: boolean }> = [
    { name: 'missing original', status: 404, missing: true },
    { name: 'another account original', status: 404, task: { userId: 'other-user' } },
    { name: 'project mismatch', status: 409, task: { projectId: 'other-project' } },
    { name: 'completed original', status: 409, task: { status: 'completed' } },
    { name: 'active original', status: 409, task: { status: 'processing' } },
    { name: 'cancelled original', status: 409, task: { status: 'cancelled' } },
    { name: 'missing frozen request', status: 409, task: { result: {} } },
    { name: 'provider identity mismatch', status: 409, payload: { providerId: 'y-a' } },
    { name: 'uncertain submission', status: 409, task: { result: { submissionPayload: frozen, requiresReconciliation: true } } },
    { name: 'explicit nonretryable error', status: 409, task: { result: { submissionPayload: frozen, taskError: { retryable: false } } } },
    { name: 'internal prepaid original', status: 409, payload: { skillPrepaidExecution: { operationId: 'private-operation' } } },
    { name: 'client supplier override', status: 400, client: { providerId: 'y-a' } },
    { name: 'client prompt override', status: 400, client: { prompt: '当前表单不能覆盖原请求' } },
    { name: 'revoked project', status: 403, denyProject: true },
    { name: 'revoked model', status: 403, denyModel: true },
  ];
  it.each(denied)('rejects $name before admission or provider effects', async row => {
    if (row.missing) state.tasks.clear(); else state.tasks.set('y-old-task', oldTask(row.task, row.payload));
    state.denyProject = Boolean(row.denyProject); state.denyModel = Boolean(row.denyModel);
    const response = await POST(retry(row.client));
    expect(response.status, 'standalone retry y api fails closed: ' + row.name).toBe(row.status);
    expect((await response.json()).success).toBe(false); noAdmission();
  });
  it('requires authentication before looking up the original task', async () => {
    state.authenticated = false; const response = await POST(retry());
    expect(response.status).toBe(401); expect(state.reads).toBe(0); noAdmission();
  });
});


describe('standalone retry z partial historical payload', () => {
  it.each([
    { name: 'missing original ratio', payload: { aspectRatio: undefined } },
    { name: 'missing original references', payload: { referenceImages: undefined } },
    { name: 'malformed original ratio', payload: { aspectRatio: [] } },
    { name: 'malformed original references', payload: { referenceImages: null } },
    { name: 'malformed original size', payload: { size: {} } },
    { name: 'malformed original quality', payload: { quality: {} } },
    { name: 'malformed original resolution', payload: { resolution: [] } },
    { name: 'internal Agent routing', payload: { agentStrictRouting: true } },
  ])('rejects $name before any new admission', async row => {
    state.tasks.set('y-old-task', oldTask({}, row.payload));
    const response = await POST(retry());
    expect(response.status, 'standalone retry z partial payload must not become a charged default').toBe(409);
    expect(await response.json()).toMatchObject({ success: false });
    noAdmission();
  });
});
