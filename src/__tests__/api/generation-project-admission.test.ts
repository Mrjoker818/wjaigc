import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { link, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withIsolatedPostgres, type QueryFn } from '../../../tests/helpers/postgres-test-database';
import { getPool } from '@/lib/db-client';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  denyProject: false,
  events: [] as string[],
  provider: {
    id: 'provider-exact', name: 'Exact provider', displayName: 'Exact provider',
    type: 'image', modelType: 'image', apiKey: 'offline-key', baseUrl: 'https://provider.invalid',
    selectedModels: ['exact-image'], isEnabled: true, createdAt: 1, updatedAt: 1,
  },
  user: { id: 'actor', name: 'Actor', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 },
  session: vi.fn(), desktop: vi.fn(), providerLookup: vi.fn(), model: vi.fn(),
  task: vi.fn(), charge: vi.fn(), consume: vi.fn(), check: vi.fn(), cost: vi.fn(), billable: vi.fn(),
  register: vi.fn(), update: vi.fn(), network: vi.fn(), kickoff: vi.fn(), identify: vi.fn(),
  after: [] as Array<() => Promise<void>>,
  persisted: new Map<string, unknown>(),
}));
vi.mock('next/server', async original => ({
  ...await original<typeof import('next/server')>(),
  after: (callback: () => Promise<void>): void => { state.after.push(callback); },
}));
// Real unified auth; only credential stores are offline fixtures.
vi.mock('@/lib/server-auth', () => ({ getSessionUser: state.session }));
vi.mock('@/lib/identify-subject', async original => ({
  ...await original<typeof import('@/lib/identify-subject')>(), identifyImageSubject: state.identify,
}));
vi.mock('@/lib/desktop-cloud', async original => ({
  ...await original<typeof import('@/lib/desktop-cloud')>(), getDesktopAuth: state.desktop,
}));
vi.mock('@/lib/collaboration/generation-project-access', async original => {
  const actual = await original<typeof import('@/lib/collaboration/generation-project-access')>();
  return { ...actual, authorizeGenerationProject: async (input: Parameters<typeof actual.authorizeGenerationProject>[0]) => {
    state.events.push('authorize');
    expect(state.providerLookup).not.toHaveBeenCalled();
    expect(state.model).not.toHaveBeenCalled();
    expect(state.task).not.toHaveBeenCalled();
    expect(state.billable).not.toHaveBeenCalled();
    expect(state.charge).not.toHaveBeenCalled();
    expect(state.consume).not.toHaveBeenCalled();
    expect(state.network).not.toHaveBeenCalled();
    if (state.denyProject) throw new actual.GenerationProjectAccessError('GENERATION_PROJECT_FORBIDDEN');
    return actual.authorizeGenerationProject(input);
  } };
});
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: state.providerLookup, findProviderForModel: state.providerLookup,
  findAllProvidersForType: async () => [{ provider: state.provider, models: ['exact-image'] }],
  normalizeApiBaseUrl: (value: string): string => value.replace(/\/$/, ''),
}));
vi.mock('@/lib/task-core/model-catalog', () => ({ resolveTaskModelForUser: state.model }));
vi.mock('@/lib/credits', async original => ({
  ...await original<typeof import('@/lib/credits')>(),
  calculateConfiguredCreditCost: state.cost, checkCredits: state.check, consumeCredits: state.consume,
}));
vi.mock('@/lib/cloud-task-persistence', () => ({ recordImageTaskSubmitted: state.task, recordImageTaskTerminal: vi.fn() }));
vi.mock('@/lib/cloud-task-storage', async original => ({
  ...await original<typeof import('@/lib/cloud-task-storage')>(),
  createBillableCloudTask: state.billable,
  chargeCloudTaskCredits: state.charge, getCloudTaskForUser: async (id: string): Promise<unknown> => state.persisted.get(id) ?? null,
  getCloudTaskForUserByIdempotencyKey: vi.fn(), terminateCloudTaskAndRefund: vi.fn(), updateCloudTask: vi.fn(),
}));
vi.mock('@/lib/task-registry', () => ({
  markTaskDurable: vi.fn(),
  registerTask: state.register, updateTaskProgress: state.update,
  isTaskCancelled: () => false, getTaskInfo: vi.fn(),
}));
vi.mock('@/lib/task-core/durable-generation-kickoff', () => ({ kickoffDurableGenerationTasks: state.kickoff }));
vi.mock('@/lib/s3-storage', () => ({ persistRemoteImage: async (url: string) => url }));
vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: vi.fn() }));
vi.mock('@/lib/op-log', () => ({
  logOperation: vi.fn(), logError: vi.fn(), startTimer: () => ({ end: () => 0 }),
  OP_ACTIONS: { IMAGE_GENERATE: 'image_generate' }, sanitizeRequestData: (value: unknown) => value,
}));

import { POST as generate } from '@/app/api/generate/route';
import { POST as universal } from '@/app/api/universal-generate/route';

function request(projectId?: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ prompt: 'A blue cup', model: 'exact-image', providerId: 'provider-exact',
      submitOnly: true, outputCount: 1, projectId, ...extra }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.denyProject = false;
  state.events = [];
  state.after = [];
  state.session.mockResolvedValue(state.user);
  state.desktop.mockResolvedValue(null);
  state.providerLookup.mockImplementation(async () => { state.events.push('provider'); return state.provider; });
  state.model.mockImplementation(async (providerId: string, modelId: string) => ({
    providerId, modelId, kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'sync',
    allowedRatios: ['1:1'], allowedSizes: [], qualityOptions: ['high'], maxOutputs: 1,
    supportsReferenceImages: false, supportsMask: false, supportedOperations: ['text-to-image'],
    outputKinds: ['png'], capabilitySources: {},
  }));
  state.task.mockImplementation(async () => { state.events.push('task'); return true; });
  // This front-door suite replaces downstream persistence. The atomic canvas path
  // replaced recordImageTaskSubmitted + chargeCloudTaskCredits in Task8Cb3f.
  state.persisted.clear();
  state.billable.mockImplementation(async (input: import('@/lib/cloud-task-storage').CreateBillableCloudTaskInput) => {
    const task = { ...input.task, userId: input.userId, idempotencyKey: input.idempotencyKey,
      requestDigest: input.requestDigest, creditCost: input.creditCost, creditStatus: 'charged', revision: 0 };
    state.persisted.set(task.id, task);
    return { task, reused: false, charged: true };
  });
  state.charge.mockResolvedValue({ charged: true, creditCost: 7 });
  state.cost.mockResolvedValue(7);
  state.check.mockResolvedValue({ sufficient: true, balance: 100 });
  state.consume.mockResolvedValue({ success: true, cost: 7 });
  state.identify.mockResolvedValue({ en: 'an approved reference image', zh: '已核准参考图' });
  state.network.mockImplementation(async (url: string) => {
    expect(new URL(url).hostname).toBe('provider.invalid');
    state.events.push('network');
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', state.network);
  vi.stubEnv('INTERNAL_API_SECRET', 'offline-internal-secret-at-least-32-characters');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function seed(query: QueryFn): Promise<void> {
  for (const migration of [
    '20260809_wj_core_users.sql', '20260810_wj_stable_s2_assets.sql', '20260924_project_presence.sql',
    '20260925_yjs_canvas_editors.sql', '20260925_yjs_canvas_documents.sql', '20260926_yjs_canvas_authority_fence.sql',
  ]) await query(await readFile(`migrations/${migration}`, 'utf8'));
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('actor','Actor','test','active','user',1,1),('owner','Owner','test','active','user',1,1),
      ('admin','Admin','test','active','admin',1,1),('presence','Presence','test','active','user',1,1)`);
  await query(`INSERT INTO wujie_projects (id,owner_id,name,status)
    VALUES ('personal','actor','Personal','active'),('foreign-project','owner','Foreign','active'),
      ('shared','owner','Shared','active'),('trashed','actor','Trashed','trashed')`);
  await query(`INSERT INTO wujie_user_data (user_id,data_key,data_value,updated_at)
    VALUES ('actor','projects','[{"id":"legacy","userId":"actor"},{"id":"trashed","userId":"actor"},{"id":"foreign-project","userId":"actor"}]',1)`);
  await query(`INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ('shared','owner',true)`);
  await query(`INSERT INTO wujie_project_canvas_documents (project_id,owner_id) VALUES ('shared','owner')`);
  await query(`INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id) VALUES ('shared','owner','actor')`);
  await query(`INSERT INTO wujie_project_presence_members (project_id,owner_id,member_user_id) VALUES ('shared','owner','presence')`);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}

function clearEffects(): void {
  vi.clearAllMocks();
  state.events = [];
  state.after = [];
}

function expectNoEffects(): void {
  for (const effect of [state.providerLookup, state.model, state.task, state.billable, state.register, state.update,
    state.charge, state.consume, state.cost, state.check, state.network, state.kickoff]) expect(effect).not.toHaveBeenCalled();
  expect(state.after).toEqual([]);
}

describe('real generation POST admission before effects', () => {
  it.each([
    '/api/serve-upload/../private.png',
    '/api/serve-upload/%2e%2e/private.png',
    'http://localhost:5000/api/serve-upload/../private.png',
  ])('rejects unsafe ordinary reference %s before charging or contacting a provider', async reference => {
    state.model.mockImplementation(async (providerId: string, modelId: string) => ({
      providerId, modelId, kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'sync',
      allowedRatios: ['1:1'], allowedSizes: [], qualityOptions: ['high'], maxOutputs: 1,
      supportsReferenceImages: true, supportsMask: false,
      supportedOperations: ['text-to-image', 'image-to-image'], outputKinds: ['png'], capabilitySources: {},
    }));
    const response = await generate(request(undefined, {
      submitOnly: false,
      referenceImages: [reference],
    }));

    expect(state.consume).not.toHaveBeenCalled();
    expect(state.charge).not.toHaveBeenCalled();
    expect(state.billable).not.toHaveBeenCalled();
    expect(state.network).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: 'GENERATION_REFERENCE_INVALID' });
  });

  it('does not let localhost prefetch turn a hard-linked upload into a billable data URL', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-generate-hardlink-'));
    try {
      const dataRoot = path.join(root, 'data');
      await mkdir(path.join(dataRoot, 'uploads'), { recursive: true });
      const privateFile = path.join(dataRoot, 'private.png');
      await writeFile(privateFile, Buffer.from('private-reference'));
      await link(privateFile, path.join(dataRoot, 'uploads', 'linked.png'));
      const dataRootModule = await import('@/lib/server-data-root');
      vi.spyOn(dataRootModule, 'getServerDataRoot').mockReturnValue(dataRoot);
      state.model.mockImplementation(async (providerId: string, modelId: string) => ({
        providerId, modelId, kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'sync',
        allowedRatios: ['1:1'], allowedSizes: [], qualityOptions: ['high'], maxOutputs: 1,
        supportsReferenceImages: true, supportsMask: false,
        supportedOperations: ['text-to-image', 'image-to-image'], outputKinds: ['png'], capabilitySources: {},
      }));
      state.network.mockImplementation(async (url: string): Promise<Response> => {
        if (url.startsWith('http://localhost:5000/api/serve-upload/')) {
          return new Response(Buffer.from('private-reference'), { headers: { 'content-type': 'image/png' } });
        }
        return Response.json({ data: [{ url: 'https://offline.invalid/result.png' }] });
      });

      const response = await generate(request(undefined, { submitOnly: false,
        referenceImages: ['/api/serve-upload/linked.png'], referenceDescriptions: ['linked image'] }));

      expect(state.consume).not.toHaveBeenCalled();
      expect(state.network).not.toHaveBeenCalled();
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ success: false, code: 'GENERATION_REFERENCE_INVALID' });
    } finally {
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== path.resolve(tmpdir())
        || !path.basename(resolved).startsWith('wujie-generate-hardlink-')) {
        throw new Error('Refusing to remove an unexpected fixture directory');
      }
      await rm(resolved, { recursive: true, force: true });
    }
  });

  it('uses admitted reference bytes for vision and submission after an upload is replaced', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-generate-reference-snapshot-'));
    try {
      const dataRoot = path.join(root, 'data');
      const upload = path.join(dataRoot, 'uploads', 'source.png');
      const privateFile = path.join(dataRoot, 'private.png');
      await mkdir(path.dirname(upload), { recursive: true });
      await writeFile(upload, Buffer.from('approved-reference'));
      await writeFile(privateFile, Buffer.from('private-reference'));
      const dataRootModule = await import('@/lib/server-data-root');
      vi.spyOn(dataRootModule, 'getServerDataRoot').mockReturnValue(dataRoot);
      state.model.mockImplementation(async (providerId: string, modelId: string) => ({
        providerId, modelId, kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'sync',
        allowedRatios: ['1:1'], allowedSizes: [], qualityOptions: ['high'], maxOutputs: 1,
        supportsReferenceImages: true, supportsMask: false,
        supportedOperations: ['text-to-image', 'image-to-image'], outputKinds: ['png'], capabilitySources: {},
      }));
      state.consume.mockImplementationOnce(async () => {
        await rename(upload, path.join(dataRoot, 'approved-original.png'));
        await link(privateFile, upload);
        return { success: true, cost: 7 };
      });

      const response = await generate(request(undefined, { submitOnly: false,
        _skipCloudTaskPersistence: true,
        referenceImages: ['/api/serve-upload/source.png'] }, {
        'x-internal-request': 'true', 'x-internal-user-id': 'actor',
        'x-wujie-internal-secret': 'offline-internal-secret-at-least-32-characters',
        'x-wujie-agent-strict-routing': 'true', 'idempotency-key': 'reference-snapshot',
      }));

      expect(response.status).toBe(200);
      expect((await response.json()).success).toBe(true);
      expect(state.consume).toHaveBeenCalledTimes(1);
      expect(state.identify).toHaveBeenCalledWith(
        `data:image/png;base64,${Buffer.from('approved-reference').toString('base64')}`, 8000);
      expect(state.network).toHaveBeenCalledTimes(1);
      const [url, init] = state.network.mock.calls[0] as [string, RequestInit];
      const sentBody = await new Request(url, init).text();
      expect(sentBody).toContain(Buffer.from('approved-reference').toString('base64'));
      expect(sentBody).not.toContain(Buffer.from('private-reference').toString('base64'));
    } finally {
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== path.resolve(tmpdir())
        || !path.basename(resolved).startsWith('wujie-generate-reference-snapshot-')) {
        throw new Error('Refusing to remove an unexpected fixture directory');
      }
      await rm(resolved, { recursive: true, force: true });
    }
  });

  it.each(['development', 'production'])('freezes a missing local upload recovered over HTTP before charging in %s', async nodeEnv => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-generate-http-reference-'));
    try {
      vi.stubEnv('NODE_ENV', nodeEnv);
      const dataRoot = path.join(root, 'data');
      const upload = path.join(dataRoot, 'uploads', 'source.png');
      await mkdir(path.dirname(upload), { recursive: true });
      const privateFile = path.join(dataRoot, 'private.png');
      await writeFile(privateFile, Buffer.from('private-reference'));
      const dataRootModule = await import('@/lib/server-data-root');
      vi.spyOn(dataRootModule, 'getServerDataRoot').mockReturnValue(dataRoot);
      state.model.mockImplementation(async (providerId: string, modelId: string) => ({
        providerId, modelId, kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'sync',
        allowedRatios: ['1:1'], allowedSizes: [], qualityOptions: ['high'], maxOutputs: 1,
        supportsReferenceImages: true, supportsMask: false,
        supportedOperations: ['text-to-image', 'image-to-image'], outputKinds: ['png'], capabilitySources: {},
      }));
      state.network.mockImplementation(async (url: string): Promise<Response> => {
        if (url === 'http://localhost:5000/api/serve-upload/source.png?version=1') {
          return new Response(PNG, { headers: { 'content-type': 'image/png' } });
        }
        expect(new URL(url).hostname).toBe('provider.invalid');
        return Response.json({ data: [{ b64_json: 'ZmFrZQ==' }] });
      });
      state.consume.mockImplementationOnce(async () => {
        await link(privateFile, upload);
        return { success: true, cost: 7 };
      });

      const response = await generate(request(undefined, { submitOnly: false,
        _skipCloudTaskPersistence: true,
        referenceImages: ['/api/serve-upload/source.png?version=1'], referenceDescriptions: ['approved image'] }, {
        'x-internal-request': 'true', 'x-internal-user-id': 'actor',
        'x-wujie-internal-secret': 'offline-internal-secret-at-least-32-characters',
        'x-wujie-agent-strict-routing': 'true', 'idempotency-key': 'http-reference-snapshot',
      }));

      expect(response.status).toBe(200);
      expect((await response.json()).success).toBe(true);
      expect(state.consume).toHaveBeenCalledTimes(1);
      expect(state.network).toHaveBeenCalledTimes(2);
      const [providerUrl, init] = state.network.mock.calls[1] as [string, RequestInit];
      const sentBody = await new Request(providerUrl, init).text();
      expect(sentBody).toContain(PNG.toString('base64'));
      expect(sentBody).not.toContain(Buffer.from('private-reference').toString('base64'));
    } finally {
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== path.resolve(tmpdir())
        || !path.basename(resolved).startsWith('wujie-generate-http-reference-')) {
        throw new Error('Refusing to remove an unexpected fixture directory');
      }
      await rm(resolved, { recursive: true, force: true });
    }
  });

  it('rejects an unavailable managed reference before charging', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-generate-http-missing-'));
    try {
      const dataRootModule = await import('@/lib/server-data-root');
      vi.spyOn(dataRootModule, 'getServerDataRoot').mockReturnValue(path.join(root, 'data'));
      state.model.mockImplementation(async (providerId: string, modelId: string) => ({
        providerId, modelId, kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'sync',
        allowedRatios: ['1:1'], allowedSizes: [], qualityOptions: ['high'], maxOutputs: 1,
        supportsReferenceImages: true, supportsMask: false,
        supportedOperations: ['text-to-image', 'image-to-image'], outputKinds: ['png'], capabilitySources: {},
      }));
      state.network.mockImplementation(async (url: string): Promise<Response> => {
        expect(url).toBe('http://localhost:5000/api/serve-upload/missing.png');
        return Response.json({ error: 'File not found' }, { status: 404 });
      });

      const response = await generate(request(undefined, { submitOnly: false,
        referenceImages: ['/api/serve-upload/missing.png'], referenceDescriptions: ['missing image'] }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ success: false, code: 'GENERATION_REFERENCE_INVALID' });
      expect(state.consume).not.toHaveBeenCalled();
      expect(state.network).toHaveBeenCalledTimes(1);
    } finally {
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== path.resolve(tmpdir())
        || !path.basename(resolved).startsWith('wujie-generate-http-missing-')) {
        throw new Error('Refusing to remove an unexpected fixture directory');
      }
      await rm(resolved, { recursive: true, force: true });
    }
  });

  it('rejects an oversized recovered reference before charging', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-generate-http-oversize-'));
    try {
      const dataRootModule = await import('@/lib/server-data-root');
      vi.spyOn(dataRootModule, 'getServerDataRoot').mockReturnValue(path.join(root, 'data'));
      state.model.mockImplementation(async (providerId: string, modelId: string) => ({
        providerId, modelId, kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'sync',
        allowedRatios: ['1:1'], allowedSizes: [], qualityOptions: ['high'], maxOutputs: 1,
        supportsReferenceImages: true, supportsMask: false,
        supportedOperations: ['text-to-image', 'image-to-image'], outputKinds: ['png'], capabilitySources: {},
      }));
      state.network.mockImplementation(async (url: string): Promise<Response> => {
        expect(url).toBe('http://localhost:5000/api/serve-upload/oversize.png');
        return new Response(new Uint8Array(20 * 1024 * 1024 + 1), {
          headers: { 'content-type': 'image/png' },
        });
      });

      const response = await generate(request(undefined, { submitOnly: false,
        referenceImages: ['/api/serve-upload/oversize.png'], referenceDescriptions: ['large image'] }));

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ success: false, code: 'GENERATION_REFERENCE_TOO_LARGE' });
      expect(state.consume).not.toHaveBeenCalled();
      expect(state.network).toHaveBeenCalledTimes(1);
    } finally {
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== path.resolve(tmpdir())
        || !path.basename(resolved).startsWith('wujie-generate-http-oversize-')) {
        throw new Error('Refusing to remove an unexpected fixture directory');
      }
      await rm(resolved, { recursive: true, force: true });
    }
  });

  for (const [name, post] of [['generate', generate], ['universal', universal]] as const) {
    it(`${name} rejects a foreign project before providers, credits or tasks`, async () => {
      state.denyProject = true;
      const response = await post(request('foreign-project'));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ success: false, code: 'GENERATION_PROJECT_FORBIDDEN', error: '无权在此项目中生成图片' });
      expect(state.providerLookup).not.toHaveBeenCalled();
      expect(state.task).not.toHaveBeenCalled();
      expect(state.charge).not.toHaveBeenCalled();
      expect(state.consume).not.toHaveBeenCalled();
      expect(state.network).not.toHaveBeenCalled();
    });
    it(`${name} rejects anonymous requests before parsing or provider access`, async () => {
      state.session.mockResolvedValue(null);
      const response = await post(request('foreign-project', { userId: 'actor', ownerId: 'actor' }));
      expect(response.status).toBe(401);
      expect(state.events).toEqual([]);
      expect(state.network).not.toHaveBeenCalled();
    });

    it(`${name} authenticates before even parsing invalid JSON`, async () => {
      state.session.mockResolvedValue(null);
      const response = await post(new NextRequest('http://localhost/api/generate', { method: 'POST', body: '{' }));
      expect(response.status).toBe(401);
      expect(state.events).toEqual([]);
      expectNoEffects();
    });

    it.each(['cookie', 'desktop-token', 'internal'] as const)(`${name} uses %s actor identity despite body forgery`, async source => {
      await withIsolatedPostgres(`route-${name}-${source}`, async ({ query }) => {
        await seed(query);
        const headers: Record<string, string> = {};
        if (source !== 'cookie') state.session.mockResolvedValue(null);
        if (source === 'desktop-token') {
          headers.authorization = 'Bearer offline-desktop-token';
          state.desktop.mockResolvedValue({ user: state.user });
        }
        if (source === 'internal') Object.assign(headers, {
          'x-internal-request': 'true', 'x-internal-user-id': 'actor', 'x-internal-user-role': 'user',
          'x-wujie-internal-secret': 'offline-internal-secret-at-least-32-characters',
        });
        for (const projectId of [undefined, null, '', 'personal', 'legacy', 'shared']) {
          clearEffects();
          const response = await post(request(projectId, {
            userId: 'owner', ownerId: 'owner', projectAccess: { kind: 'document', actorUserId: 'owner', grantGeneration: '0' },
          }, headers));
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ success: true });
          expect(state.events[0]).toBe('authorize');
          expect(getPool().idleCount).toBe(getPool().totalCount);
          if (name === 'generate') {
            if (projectId === 'shared') {
              expect(state.billable).toHaveBeenCalledTimes(1);
              expect(state.billable).toHaveBeenCalledWith(expect.objectContaining({ userId: 'actor', creditCost: 7,
                canvasPublication: expect.objectContaining({ access: expect.objectContaining({ actorUserId: 'actor', ownerId: 'owner' }) }),
                task: expect.objectContaining({ userId: 'actor', providerId: 'provider-exact', model: 'exact-image', type: 'generate-async' }) }));
              expect(state.billable.mock.calls[0][0].task.result.submissionPayload).not.toHaveProperty('projectAccess');
              expectNoBilling();
              expect(state.register).not.toHaveBeenCalled();
            } else {
            expect(state.task).toHaveBeenCalledWith(expect.objectContaining({ userId: 'actor', providerId: 'provider-exact', model: 'exact-image' }));
            expect(state.charge).toHaveBeenCalledWith(expect.any(String), 'actor', 7, expect.any(String));
            expect(state.register).toHaveBeenCalledWith(expect.any(String), 'generate-async', expect.any(String), 'actor');
            expect(state.task.mock.calls[0][0].submissionPayload).not.toHaveProperty('projectAccess');
            expect(state.billable).not.toHaveBeenCalled();
            }
          } else {
            if (projectId === 'shared') {
              expect(state.billable).toHaveBeenCalledTimes(1);
              expect(state.billable).toHaveBeenCalledWith(expect.objectContaining({ userId: 'actor', creditCost: 7,
                canvasPublication: expect.objectContaining({ singleAdmission: 'universal-generate', access: expect.objectContaining({ actorUserId: 'actor', ownerId: 'owner' }) }),
                task: expect.objectContaining({ type: 'universal-generate', providerId: 'provider-exact', model: 'exact-image' }) }));
              expect(state.after).toHaveLength(1);
              expect(state.network).not.toHaveBeenCalled();
              expectNoBilling();
            } else {
            expect(state.network).toHaveBeenCalledTimes(1);
            const [url, init] = state.network.mock.calls[0] as [string, RequestInit];
            expect(url).toBe('https://provider.invalid/images/generations');
            expect(new Headers(init.headers).get('authorization')).toBe('Bearer offline-key');
            expect(JSON.parse(String(init.body))).toMatchObject({ model: 'exact-image', prompt: 'A blue cup', n: 1 });
            expectNoBilling();
            expect(state.billable).not.toHaveBeenCalled();
            }
          }
        }
        clearEffects();
        const response = await post(request('foreign-project', { userId: 'owner', ownerId: 'owner' }, headers));
        expect(response.status).toBe(403);
        expectNoEffects();
      });
    });

    it(`${name} maps invalid IDs and unavailable PG before any downstream call`, async () => {
      vi.stubEnv('DATABASE_URL', '');
      vi.stubEnv('PGDATABASE_URL', '');
      for (const projectId of [1, false, {}, [], ' personal', 'personal ', 'a\nb', 'x'.repeat(257)]) {
        clearEffects();
        const response = await post(request(projectId));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ success: false, code: 'GENERATION_PROJECT_INVALID', error: '项目参数无效' });
        expectNoEffects();
      }
      clearEffects();
      const unavailable = await post(request('personal'));
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ success: false, code: 'GENERATION_PROJECT_UNAVAILABLE', error: '项目权限服务暂不可用，请稍后重试' });
      expectNoEffects();
      clearEffects();
      expect((await post(request())).status).toBe(200);
    });

    it(`${name} enforces real PG revocation, status, authority and global switch without fallback`, async () => {
      await withIsolatedPostgres(`route-${name}-permissions`, async ({ query }) => {
        await seed(query);
        const deny = async (projectId: string): Promise<void> => {
          clearEffects();
          const response = await post(request(projectId, { ownerId: 'owner', userId: 'owner', projectAccess: { kind: 'personal' } }));
          expect(response.status).toBe(403);
          expect(await response.json()).toEqual({ success: false, code: 'GENERATION_PROJECT_FORBIDDEN', error: '无权在此项目中生成图片' });
          expectNoEffects();
        };
        for (const projectId of ['foreign-project', 'unknown', 'trashed']) await deny(projectId);
        for (const id of ['presence', 'admin']) {
          state.session.mockResolvedValue({ ...state.user, id, role: id === 'admin' ? 'admin' : 'user' });
          await deny('shared');
        }
        state.session.mockResolvedValue(state.user);
        const { revokeDocumentEditor, grantDocumentEditor } = await import('@/lib/collaboration/document-access');
        clearEffects();
        expect((await post(request('shared'))).status).toBe(200);
        await revokeDocumentEditor('owner','shared','actor');
        await deny('shared');
        await grantDocumentEditor('owner','shared','actor');
        clearEffects();
        expect((await post(request('shared'))).status).toBe(200);
        for (const id of ['actor','owner']) {
          await query('UPDATE wujie_users SET status=\'disabled\' WHERE id=$1', [id]);
          await deny('shared');
          await query('UPDATE wujie_users SET status=\'active\' WHERE id=$1', [id]);
        }
        await query("UPDATE wujie_projects SET status='trashed' WHERE id='shared'");
        await deny('shared');
        await query("UPDATE wujie_projects SET status='active' WHERE id='shared'");
        vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
        await deny('shared');
        vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
        await query("UPDATE wujie_project_document_settings SET enabled=false WHERE project_id='shared'");
        await deny('shared');
        state.session.mockResolvedValue({ ...state.user, id: 'owner' });
        await deny('shared');
        await query("DELETE FROM wujie_project_document_settings WHERE project_id='shared'");
        await deny('shared');
        await query("INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ('shared','owner',true)");
        await query("DELETE FROM wujie_project_canvas_documents WHERE project_id='shared'");
        await deny('shared');
      });
    });

    it(`${name} redacts actual PG query failures and never contacts providers`, async () => {
      await withIsolatedPostgres(`route-${name}-sql`, async ({ query }) => {
        await seed(query);
        await query('ALTER TABLE wujie_projects RENAME TO private_secret_projects');
        const response = await post(request('personal'));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ success: false, code: 'GENERATION_PROJECT_UNAVAILABLE', error: '项目权限服务暂不可用，请稍后重试' });
        expectNoEffects();
        expect(getPool().idleCount).toBe(getPool().totalCount);
      });
    });

    it(`${name} preserves offline provider rejection after valid editor admission`, async () => {
      await withIsolatedPostgres(`route-${name}-provider-error`, async ({ query }) => {
        await seed(query);
        state.network.mockImplementation(async (url: string) => {
          expect(new URL(url).hostname).toBe('provider.invalid');
          return new Response(JSON.stringify({
          error: { code: 'invalid_quality', message: 'Invalid quality parameter' },
          }), { status: 400, headers: { 'content-type': 'application/json' } });
        });
        const response = await post(request('shared', { submitOnly: false, _skipCloudTaskPersistence: true, ...(name === 'universal' ? { assetScope: 'chat' } : {}) }, {
          'x-internal-request': 'true', 'x-internal-user-id': 'actor',
          'x-wujie-internal-secret': 'offline-internal-secret-at-least-32-characters',
          'x-wujie-agent-strict-routing': 'true', 'idempotency-key': 'offline-provider-error',
        }));
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
        if (name === 'generate') {
          expect(body).toMatchObject({ providerStatus: 400, providerCode: 'invalid_quality', retryable: false });
          expect(body.error).toContain('所选模型不支持当前图片质量参数');
          expect(state.network).toHaveBeenCalledTimes(1);
        } else {
          expect(body.error).toBe('Invalid quality parameter');
          expect(state.network.mock.calls.map(call => call[0])).toEqual([
            'https://provider.invalid/images/generations', 'https://provider.invalid/v1/images/generations',
          ]);
        }
        expect(state.events[0]).toBe('authorize');
      });
    });
  }

  it('releases the permission transaction before a pending provider, allowing immediate revocation', async () => {
    await withIsolatedPostgres('route-provider-unlocked', async ({ query }) => {
      await seed(query);
      state.network.mockImplementationOnce(async () => {
        expect(getPool().idleCount).toBe(getPool().totalCount);
        await query("SET lock_timeout='300ms'");
        await query("UPDATE wujie_project_document_editors SET status='revoked', grant_generation=2 WHERE project_id='shared'");
        const activity = await query(`SELECT state FROM pg_stat_activity WHERE datname=current_database()
          AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`);
        expect(activity.rows).toEqual([]);
        return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      });
      expect((await universal(request('shared', { assetScope: 'chat' }))).status).toBe(200);
      expect(state.network).toHaveBeenCalledTimes(1);
      clearEffects();
      expect((await universal(request('shared', { assetScope: 'chat' }))).status).toBe(403);
      expectNoEffects();
    });
  });

  it('keeps direct generation credit actor and exact offline provider request after real editor admission', async () => {
    await withIsolatedPostgres('route-direct-credit', async ({ query }) => {
      await seed(query);
      const response = await generate(request('shared', {
        submitOnly: false, _skipCloudTaskPersistence: true, userId: 'owner', ownerId: 'owner',
      }, {
        'x-internal-request': 'true', 'x-internal-user-id': 'actor',
        'x-wujie-internal-secret': 'offline-internal-secret-at-least-32-characters',
        'x-wujie-agent-strict-routing': 'true',
        'idempotency-key': 'offline-direct-credit',
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true });
      expect(state.consume).toHaveBeenCalledWith('actor', 'image_generate', undefined, undefined, 'exact-image', expect.objectContaining({ providerId: 'provider-exact' }));
      expect(state.network).toHaveBeenCalledTimes(1);
      const [url, init] = state.network.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://provider.invalid/images/generations');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer offline-key');
      expect(JSON.parse(String(init.body))).toMatchObject({ model: 'exact-image', prompt: 'A blue cup' });
      expect(state.register).toHaveBeenCalledWith(expect.any(String), 'generate', '生成图片', 'actor');
    });
  });
});

function expectNoBilling(): void {
  expect(state.charge).not.toHaveBeenCalled();
  expect(state.consume).not.toHaveBeenCalled();
  expect(state.task).not.toHaveBeenCalled();
}
