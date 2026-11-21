import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ApiKind } from '@/lib/universal-api-types';

interface ProviderFixture {
  id: string;
  selected: string[];
  kind?: ApiKind;
  discovered?: string[];
}
const state = vi.hoisted(() => ({
  providers: [] as ProviderFixture[],
  user: { id: 'offline-user', name: 'Offline user', role: 'user', status: 'active',
    imageModels: [] as string[], apiPermissions: { image: true, chat: true }, createdAt: 1, updatedAt: 1 },
  scope: 'document' as 'document' | 'unscoped',
  price: vi.fn(async () => 7),
  atomic: vi.fn(async (): Promise<never> => { throw new Error('STOP_AT_BILLING_BOUNDARY'); }),
  consume: vi.fn(async (): Promise<never> => { throw new Error('STOP_AT_BILLING_BOUNDARY'); }),
  refund: vi.fn(),
  network: vi.fn((): never => { throw new Error('NETWORK_FORBIDDEN'); }),
  pool: vi.fn((): never => { throw new Error('DATABASE_FORBIDDEN'); }),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-storage', () => ({
  dbGetApiProviders: async () => state.providers.map(provider => ({
    id: provider.id, name: provider.id, display_name: provider.id,
    type: provider.kind || 'image', model_type: provider.kind || 'image',
    base_url: 'https://supplier.invalid/v1', api_key: 'synthetic-only', is_enabled: true,
    selected_models: provider.selected,
    discovered_models: (provider.discovered || ['gpt-image-1']).map(id => ({ id, name: id, type: 'image' })),
    advanced_params: {}, request_style: 'auto', is_default: false, created_at: 1, updated_at: 1, sort_order: 0,
  })),
  dbUpsertApiProvider: (): never => { throw new Error('CONFIG_WRITE_FORBIDDEN'); },
  dbDeleteApiProvider: (): never => { throw new Error('CONFIG_WRITE_FORBIDDEN'); },
  ensureDeploymentProviderBootstrap: (): never => { throw new Error('BOOTSTRAP_FORBIDDEN'); },
}));
vi.mock('@/lib/db-client', () => ({ getPool: state.pool, isDatabaseConfigured: () => false }));
vi.mock('@/lib/deployment-database-mode', () => ({ isDeploymentDatabaseOnly: () => false }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => state.user, listManagedUsers: async () => [state.user] }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => ({ authenticated: true, userId: state.user.id, userRole: 'user', user: state.user, source: 'cookie' }),
  getRequestUser: async () => ({ user: state.user, source: 'cookie' }),
  getInternalRequestHeaders: (): never => { throw new Error('INTERNAL_REQUEST_FORBIDDEN'); },
}));
vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: async () => ({
  defaultImageModel: '', defaultChatModel: '', defaultVideoModel: '', quickCreateImageModel: '', quickCreateChatModel: '', quickCreateAutoModelRouting: false,
}) }));
vi.mock('@/lib/credits', () => ({
  calculateConfiguredCreditCost: state.price, consumeCredits: state.consume, refundCredits: state.refund,
  checkCredits: async () => ({ sufficient: true, balance: 100 }),
}));
vi.mock('@/lib/task-core/billing-service', () => ({ createBillableTask: state.atomic, settleFailedTask: vi.fn() }));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUserByIdempotencyKey: async () => null, getCloudTaskForUser: async () => null,
  chargeCloudTaskCredits: (): never => { throw new Error('UNEXPECTED_BILLING_PATH'); },
  updateCloudTask: vi.fn(), completeCloudTask: vi.fn(), terminateCloudTaskAndRefund: vi.fn(),
}));
vi.mock('@/lib/cloud-task-persistence', () => ({
  projectPersistedCompletedTask: vi.fn(), recordImageTaskSubmitted: vi.fn(), recordImageTaskTerminal: vi.fn(),
}));
vi.mock('@/lib/op-log', () => ({
  startTimer: () => ({ end: () => 0 }), logOperation: vi.fn(), logError: vi.fn(), sanitizeRequestData: (value: unknown) => value, OP_ACTIONS: {},
}));
vi.mock('@/lib/collaboration/generation-project-access', () => ({
  authorizeGenerationProject: async () => state.scope === 'document'
    ? { kind: 'document', actorUserId: state.user.id, ownerId: state.user.id, projectId: 'offline-project', grantGeneration: '0' }
    : { kind: 'unscoped', actorUserId: state.user.id },
  GenerationProjectAccessError: class extends Error {},
}));

// Configuration normalization, model classification, exact authorization and both handlers stay real.
import { GET } from '@/app/api/models/route';
import { POST } from '@/app/api/generate/route';

beforeEach(() => {
  vi.clearAllMocks();
  state.providers = [{ id: 'p', selected: [] }];
  state.user.imageModels = [];
  state.user.apiPermissions.image = true;
  state.scope = 'document';
  vi.stubGlobal('fetch', state.network);
  vi.stubEnv('WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER', 'false');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  expect(state.network).not.toHaveBeenCalled();
  expect(state.pool).not.toHaveBeenCalled();
  expect(state.refund).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function request(providerId = 'p', model = 'gpt-image-1') {
  const response = await POST(new NextRequest('http://offline.invalid/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId, model, prompt: 'synthetic blue cup', outputCount: 1, aspectRatio: '1:1',
      ...(state.scope === 'document' ? { projectId: 'offline-project' } : {}) }),
  }));
  return { status: response.status, body: await response.json() };
}
function expectNoBilling() {
  expect(state.price).not.toHaveBeenCalled();
  expect(state.atomic).not.toHaveBeenCalled();
  expect(state.consume).not.toHaveBeenCalled();
}
function expectAdmitted(providerId = 'p', model = 'gpt-image-1') {
  if (state.scope === 'document') {
    expect(state.price).toHaveBeenCalledTimes(1);
    expect(state.atomic).toHaveBeenCalledTimes(1);
    expect(state.atomic).toHaveBeenCalledWith(expect.objectContaining({
      creditCost: 7, task: expect.objectContaining({ providerId, model }),
    }));
    expect(state.consume).not.toHaveBeenCalled();
  } else {
    expect(state.atomic).not.toHaveBeenCalled();
    expect(state.consume).toHaveBeenCalledTimes(1);
    expect(state.consume).toHaveBeenCalledWith(state.user.id, 'image_generate', undefined, undefined, model,
      expect.objectContaining({ providerId }));
  }
}

describe('generate administrator selected-model boundary', () => {
  it.each([
    { name: 'empty admin selection / inherited user / ordinary canvas', selected: [], assigned: [], scope: 'document', status: 400, code: 'MODEL_NOT_CONFIGURED', admitted: false },
    { name: 'empty admin selection / exact user assignment / ordinary canvas', selected: [], assigned: ['p::gpt-image-1'], scope: 'document', status: 400, code: 'MODEL_NOT_CONFIGURED', admitted: false },
    { name: 'nonempty admin selection excludes requested model', selected: ['dall-e-3'], assigned: [], scope: 'document', status: 400, code: 'MODEL_PROVIDER_MISMATCH', admitted: false },
    { name: 'selected model / inherited user is legitimate control', selected: ['gpt-image-1'], assigned: [], scope: 'document', status: 503, code: 'ORDINARY_ADMISSION_UNAVAILABLE', admitted: true },
    { name: 'nonempty user assignment excludes provider key', selected: [], assigned: ['other::gpt-image-1'], scope: 'document', status: 400, code: 'MODEL_NOT_CONFIGURED', admitted: false },
    { name: 'empty admin selection / inherited user / unscoped direct', selected: [], assigned: [], scope: 'unscoped', status: 400, code: 'MODEL_NOT_CONFIGURED', admitted: false },
  ] as const)('six-case evidence: $name', async row => {
    state.providers[0].selected = [...row.selected];
    state.user.imageModels = [...row.assigned];
    state.scope = row.scope;
    const catalog = await (await GET(new NextRequest('http://offline.invalid/api/models?type=image'))).json();
    const reply = await request();
    expect(reply).toMatchObject({ status: row.status, body: { code: row.code } });
    expect(catalog.models.some((item: { providerId: string; id: string }) => item.providerId === 'p' && item.id === 'gpt-image-1')).toBe(row.admitted);
    if (row.admitted) expectAdmitted();
    else expectNoBilling();
  });

  describe.each(['document', 'unscoped'] as const)('%s branch neighbors', scope => {
    beforeEach(() => { state.scope = scope; });

    it('admits the explicitly selected model with inherited user assignment', async () => {
      state.providers[0].selected = ['gpt-image-1'];
      const reply = await request();
      expect(reply.status).toBe(scope === 'document' ? 503 : 500); // Billing sentinel, not a supplier response.
      expectAdmitted();
    });

    it('never borrows a same-named selected model from another provider', async () => {
      state.providers.push({ id: 'q', selected: ['gpt-image-1'] });
      expect(await request()).toMatchObject({ status: 400, body: { code: 'MODEL_NOT_CONFIGURED' } });
      expectNoBilling();
      state.user.imageModels = ['q::gpt-image-1'];
      await request('q');
      expectAdmitted('q');
    });

    it.each(['universal', 'general'] as const)('admits an explicitly selected image in a %s provider', async kind => {
      state.providers[0] = { id: 'p', kind, selected: ['gpt-image-1'] };
      await request();
      expectAdmitted();
    });

    it('denies a new request after admin selection is revoked while discovery and user key remain', async () => {
      state.providers[0].selected = ['gpt-image-1'];
      state.user.imageModels = ['p::gpt-image-1'];
      await request();
      expectAdmitted();
      vi.clearAllMocks();
      state.providers[0].selected = [];
      expect(await request()).toMatchObject({ status: 400, body: { code: 'MODEL_NOT_CONFIGURED' } });
      expectNoBilling();
    });

    it('denies a selected model when the user has another exact provider key', async () => {
      state.providers[0].selected = ['gpt-image-1'];
      state.user.imageModels = ['q::gpt-image-1'];
      expect((await request()).status).toBe(403);
      expectNoBilling();
    });

    it('preserves image permission revocation even for an exact selected assignment', async () => {
      state.providers[0].selected = ['gpt-image-1'];
      state.user.imageModels = ['p::gpt-image-1'];
      state.user.apiPermissions.image = false;
      expect((await request()).status).toBe(403);
      expectNoBilling();
    });

    it('retains a unique legacy bare assignment but refuses ambiguous selected providers', async () => {
      state.providers[0].selected = ['gpt-image-1'];
      state.user.imageModels = ['gpt-image-1'];
      await request();
      expectAdmitted();
      vi.clearAllMocks();
      state.providers.push({ id: 'q', selected: ['gpt-image-1'] });
      expect((await request()).status).toBe(403);
      expectNoBilling();
    });

    it('retains the existing image model alias normalization against selected IDs', async () => {
      state.providers[0] = { id: 'p', selected: ['gpt-image-2'], discovered: ['gpt-image-2'] };
      await request('p', 'gpt-image-2-4k');
      expectAdmitted('p', 'gpt-image-2');
    });
  });
});

