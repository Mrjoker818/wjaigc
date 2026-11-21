import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/user-types';
import type { ApiProvider } from '@/lib/universal-api-types';

const state = vi.hoisted(() => ({
  user: { id: 'owner', role: 'user', productType: 'video', chatModels: ['p::chat-2'] } as User,
  authenticated: true,
  providers: [] as ApiProvider[],
  jobs: [] as Array<() => Promise<void>>,
  getProviders: vi.fn(),
  findDefault: vi.fn(),
  authorizeProject: vi.fn(),
  createProject: vi.fn(),
  register: vi.fn(),
  progress: vi.fn(),
  llm: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/server', async original => ({
  ...await original<typeof import('next/server')>(),
  after: (job: () => Promise<void>) => { state.jobs.push(job); },
}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: async () => state.authenticated
  ? { userId: state.user.id, user: state.user }
  : NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForFeature: state.findDefault,
  getApiProviders: state.getProviders,
}));
vi.mock('@/lib/server-auth', () => ({ listManagedUsers: () => { throw new Error('D01_OFFLINE_USER_STORAGE_FORBIDDEN'); } }));
vi.mock('@/lib/collaboration/generation-project-access', () => ({
  authorizeGenerationProject: state.authorizeProject,
  GenerationProjectAccessError: class extends Error {
    readonly status = 403;
    constructor(readonly code: string) { super('项目无权访问'); }
  },
}));
vi.mock('@/lib/drama/store', () => ({ createDramaProject: state.createProject }));
vi.mock('@/lib/task-registry', () => ({ registerTask: state.register, updateTaskProgress: state.progress }));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: state.llm }));

const selection = { providerId: 'p', modelId: 'chat-2' };
const text = '小说原文。'.repeat(50);
const script = JSON.stringify({ title: '原文改编', cast: [], locations: [], props: [],
  episodes: [{ title: '第一集', script: '真实模型回复的正文', scenes: [{ heading: '第一场', summary: '人物收到信' }] }],
});
const provider = (id = 'p'): ApiProvider => ({ id, name: id, type: 'chat', isEnabled: true, baseUrl: `https://${id}.example/v1`, apiKey: 'test-key', selectedModels: ['chat-1', 'chat-2'], createdAt: 1, updatedAt: 1 });
const response = (content = script, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
async function post(body: Record<string, unknown> = {}, signal?: AbortSignal) {
  const { POST } = await import('@/app/api/drama/adapt/route');
  return POST(new NextRequest('http://localhost/api/drama/adapt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, planner: selection, ...body }), signal,
  }));
}
function expectNoJob() {
  expect(state.jobs).toHaveLength(0);
  expect(state.register).not.toHaveBeenCalled();
  expect(state.llm).not.toHaveBeenCalled();
  expect(state.createProject).not.toHaveBeenCalled();
  expect(state.findDefault).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.user = { id: 'owner', role: 'user', productType: 'video', chatModels: ['p::chat-2'] } as User;
  state.authenticated = true;
  state.providers = [provider(), provider('other')];
  state.jobs = [];
  state.getProviders.mockImplementation(async () => state.providers);
  state.findDefault.mockImplementation(async () => state.providers[0]);
  state.authorizeProject.mockResolvedValue({ kind: 'personal', projectId: 'project-1' });
  state.createProject.mockResolvedValue({ id: 'drama-saved' });
  state.llm.mockImplementation(async () => response());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('D01_OFFLINE_NETWORK_FORBIDDEN'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Keep the real catalog, classification and handler: only identity, config storage,
// scheduling/storage and the upstream transport are replaced by offline boundaries.
async function catalog() {
  const { getConfiguredModelsForProviders } = await import('@/lib/model-type-classification');
  const { resolveTaskModelCatalogResultFromSnapshot } = await import('@/lib/task-core/model-catalog');
  return resolveTaskModelCatalogResultFromSnapshot(getConfiguredModelsForProviders(state.providers), state.user, state.providers);
}

describe('D01 followup real catalog admission', () => {
  it('rejects an ambiguous bare assignment using the complete catalog even with an exact request key', async () => {
    state.user.chatModels = ['chat-2'];
    const visible = await catalog();
    expect([...visible.authorizedModelKeys]).toEqual([]);
    expect(visible.modelAuthorizationMigration.required).toEqual([
      { legacyModelId: 'chat-2', reason: 'ambiguous', candidates: ['p::chat-2', 'other::chat-2'] },
    ]);
    const result = await post({ planner: { providerId: 'other', modelId: 'chat-2' } });
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ code: 'DRAMA_PLANNER_SELECTION_FORBIDDEN' });
    expectNoJob();
  });

  it('rejects an exact assigned chat model when the authenticated user has chat permission disabled', async () => {
    state.user.apiPermissions = { chat: false } as User['apiPermissions'];
    expect([...(await catalog()).authorizedModelKeys]).toEqual([]);
    const result = await post({ user: { role: 'admin', apiPermissions: { chat: true } } });
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ code: 'DRAMA_PLANNER_SELECTION_FORBIDDEN' });
    expectNoJob();
  });

  it.each(['universal', 'general'] as const)('accepts the exact catalog-authorized nonfirst chat model in a %s provider', async type => {
    Object.assign(state.providers[0], { type, modelType: type, discoveredModels: [
      { id: 'chat-2', name: 'Selected writer', providerId: 'p', type: 'chat' },
    ] });
    const visible = await catalog();
    expect([...visible.authorizedModelKeys]).toEqual(['p::chat-2']);
    expect(visible.effectiveModelTypes.get('p::chat-2')).toBe('chat');
    const result = await post();
    expect(result.status).toBe(202);
    expect(state.jobs).toHaveLength(1);
    await state.jobs[0]();
    expect(state.llm).toHaveBeenCalledTimes(1);
    const [base, , init] = state.llm.mock.calls[0];
    expect(base).toBe('https://p.example/v1');
    expect(JSON.parse(init.body).model).toBe('chat-2');
    expect(state.createProject).toHaveBeenCalledWith('owner', null, expect.any(Object));
    expect(state.findDefault).not.toHaveBeenCalled();
  });
});

describe('D01 followup catalog boundary neighbors', () => {
  it('accepts a bare assignment only after the complete visible catalog resolves it to one exact provider', async () => {
    state.user.chatModels = ['chat-2'];
    state.providers[1].selectedModels = ['chat-1'];
    const visible = await catalog();
    expect([...visible.authorizedModelKeys]).toEqual(['p::chat-2']);
    expect(visible.modelAuthorizationMigration.resolved).toEqual([{ legacyModelId: 'chat-2', exactModelId: 'p::chat-2' }]);
    expect((await post()).status).toBe(202);
    expect(state.jobs).toHaveLength(1);
    expect(state.findDefault).not.toHaveBeenCalled();
  });

  it.each(['universal', 'general'] as const)('rejects a catalog-authorized non-chat model in a %s provider', async type => {
    Object.assign(state.providers[0], { type, modelType: type, discoveredModels: [
      { id: 'chat-2', name: 'Actually an image model', providerId: 'p', type: 'image' },
    ] });
    state.user.imageModels = ['p::chat-2'];
    const visible = await catalog();
    expect(visible.authorizedModelKeys.has('p::chat-2')).toBe(true);
    expect(visible.effectiveModelTypes.get('p::chat-2')).toBe('image');
    const result = await post();
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ code: 'DRAMA_PLANNER_SELECTION_FORBIDDEN' });
    expectNoJob();
  });
});

describe('POST /api/drama/adapt exact planner admission', () => {
  it('rejects a model not assigned to the authenticated user, ignoring a forged body user', async () => {
    state.user.chatModels = ['other::chat-1'];
    const result = await post({ user: { role: 'admin', chatModels: ['p::chat-2'] } });
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ code: 'DRAMA_PLANNER_SELECTION_FORBIDDEN' });
    expectNoJob();
  });

  it('rejects a model revoked after it was shown in the catalog', async () => {
    state.user.chatModels = ['p::chat-1'];
    const result = await post();
    expect(result.status).toBe(403);
    expectNoJob();
  });

  it('rejects the same model on an unassigned provider without switching back', async () => {
    const result = await post({ planner: { providerId: 'other', modelId: 'chat-2' } });
    expect(result.status).toBe(403);
    expect(state.getProviders).toHaveBeenCalledExactlyOnceWith();
    expectNoJob();
  });

  it.each([undefined, null, [], {}, { providerId: 'p' }, { modelId: 'chat-2' },
    { providerId: '', modelId: 'chat-2' }, { providerId: 'p', modelId: 2 }])('rejects incomplete selection %j before provider lookup', async planner => {
    const result = await post({ planner });
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ code: 'DRAMA_PLANNER_INVALID_SELECTION' });
    expect(state.getProviders).not.toHaveBeenCalled();
    expectNoJob();
  });

  it.each([
    { providerId: 'missing', modelId: 'chat-2' }, { providerId: 'p', modelId: 'chat-2-alias' },
    { providerId: 'p ', modelId: 'chat-2' }, { providerId: 'p', modelId: ' chat-2' },
  ])('rejects unavailable or nonexact selection %j', async planner => {
    expect((await post({ planner })).status).toBe(403);
    expectNoJob();
  });

  it.each([{ isEnabled: false }, { type: 'image' }, { selectedModels: ['chat-1'] }])('rejects a disabled, wrong-type or deselected model: %j', async patch => {
    Object.assign(state.providers[0], patch);
    expect((await post()).status).toBe(403);
    expectNoJob();
  });

  it('uses the exact authorized nonfirst model and freezes config for all chunks after the response', async () => {
    const stop = new AbortController();
    const result = await post({ text: '小说原文。'.repeat(2400), projectId: 'project-1' }, stop.signal);
    expect(result.status).toBe(202);
    const receipt = await result.json();
    expect(receipt.parts).toBeGreaterThan(1);
    expect(receipt.creditCost).toBe(0);
    expect(state.getProviders).toHaveBeenCalledExactlyOnceWith();
    expect(state.findDefault).not.toHaveBeenCalled();
    expect(state.authorizeProject).toHaveBeenCalledExactlyOnceWith({ actorUserId: 'owner', projectId: 'project-1' });
    expect(state.register).toHaveBeenCalledWith(receipt.taskId, 'drama-adapt', expect.any(String), 'owner');
    Object.assign(state.providers[0], { baseUrl: 'https://changed.example', apiKey: 'changed', selectedModels: ['chat-1'] });
    stop.abort();
    await state.jobs[0]();
    expect(state.llm).toHaveBeenCalledTimes(receipt.parts);
    for (const [base, path, init] of state.llm.mock.calls) {
      expect(base).toBe('https://p.example/v1');
      expect(path).toBe('/chat/completions');
      expect(JSON.parse(init.body).model).toBe('chat-2');
      expect(init.headers.Authorization).toBe('Bearer test-key');
      expect(init.signal.aborted).toBe(false);
    }
    expect(state.createProject).toHaveBeenCalledWith('owner', 'project-1', expect.objectContaining({ title: '原文改编' }));
    expect(state.progress).toHaveBeenLastCalledWith(receipt.taskId, expect.objectContaining({ status: 'completed', result: expect.objectContaining({ dramaId: 'drama-saved' }) }));
  });

  it('keeps authentication, video permission and project authorization ahead of scheduling', async () => {
    state.authenticated = false;
    expect((await post()).status).toBe(401);
    state.authenticated = true; state.user.productType = 'chat';
    expect((await post()).status).toBe(403);
    state.user.productType = 'video';
    const { GenerationProjectAccessError } = await import('@/lib/collaboration/generation-project-access');
    state.authorizeProject.mockRejectedValue(new GenerationProjectAccessError('GENERATION_PROJECT_FORBIDDEN'));
    expect((await post({ projectId: 'foreign-project' })).status).toBe(403);
    expectNoJob();
  });

  it('keeps one running adaptation per user and releases it after completion', async () => {
    expect((await post()).status).toBe(202);
    expect((await post()).status).toBe(409);
    expect(state.jobs).toHaveLength(1);
    await state.jobs[0]();
    expect((await post()).status).toBe(202);
  });

  it('does not fall back when the exact provider has no usable credentials', async () => {
    state.providers[0].apiKey = '';
    expect((await post()).status).toBe(503);
    expectNoJob();
  });

  it.each(['upstream-error', 'invalid-json'])('fails an unsuccessful first planner call instead of saving a fake success: %s', async failure => {
    state.llm.mockImplementation(async () => response('not a script', failure === 'upstream-error' ? 503 : 200));
    const result = await post();
    const { taskId } = await result.json();
    await state.jobs[0]();
    expect(state.createProject).not.toHaveBeenCalled();
    expect(state.progress).toHaveBeenLastCalledWith(taskId, expect.objectContaining({ status: 'failed' }));
    expect(state.findDefault).not.toHaveBeenCalled();
    expect((await post()).status).toBe(202);
  });
});
