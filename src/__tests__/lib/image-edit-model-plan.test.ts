import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiKind, ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
const storage = vi.hoisted(() => ({ providers: vi.fn(), users: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: storage.providers,
  normalizeApiBaseUrl: (url: string): string => url.replace(/\/$/, '') }));
vi.mock('@/lib/server-auth', () => ({ listManagedUsers: storage.users }));
import { prepareImageEditModelPlan } from '@/lib/task-core/image-edit-model-plan';

const actor: User = { id: 'actor', name: 'actor', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 };
function provider(id: string, type: ApiKind = 'image', models = ['gpt-image-1']): ApiProvider {
  return { id, name: id, type, modelType: type, selectedModels: models, isEnabled: true,
    baseUrl: `https://${id}.invalid/v1`, apiKey: `offline-${id}`, createdAt: 1, updatedAt: 1 };
}
function plan(input: Partial<Parameters<typeof prepareImageEditModelPlan>[0]> = {}): ReturnType<typeof prepareImageEditModelPlan> {
  return prepareImageEditModelPlan({ action: 'mask', user: actor, source: 'cookie', ...input });
}
beforeEach((): void => {
  vi.clearAllMocks();
  storage.providers.mockResolvedValue([provider('a'), provider('b'), provider('up', 'upscaler', ['Real-ESRGAN']),
    provider('bg', 'removebg', ['remove-a', 'remove-b']), provider('chat', 'chat', ['gpt-4o'])]);
  storage.users.mockResolvedValue([actor]);
  vi.stubGlobal('fetch', vi.fn((): never => { throw new Error('No network allowed'); }));
});
afterEach((): void => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('image edit plan using real catalog authorization', (): void => {
  it.each(['erase', 'mask', 'inpaint', 'extend', 'outpaint', 'multi_angle', 'display_decompose'])
   ('%s includes general images and excludes dedicated and chat execution', async (action): Promise<void> => {
      const result = await plan({ action });
      expect(result.candidates.map(c => `${c.providerId}::${c.model}`)).toEqual(['a::gpt-image-1', 'b::gpt-image-1']);
      expect(result.visionCandidates.map(c => c.model)).toEqual(['gpt-4o']);
      expect(result.dedicatedRemoveBgCandidates).toEqual([]);
      expect(result.requestedModelId).toBe('gemini-2.5-flash-image-preview');
    });
  it.each(['removebg', 'remove_background'])('%s keeps each dedicated model exact', async (action): Promise<void> => {
    const result = await plan({ action });
    expect(result.dedicatedRemoveBgCandidates.map(c => c.model)).toEqual(['remove-a', 'remove-b']);
    expect(result.candidates.map(c => c.providerId)).toEqual(['a', 'b']);
  });
  it('upscale puts dedicated candidates first without losing general enhancement targets', async (): Promise<void> => {
    expect((await plan({ action: 'upscale' })).candidates.map(c => c.providerId)).toEqual(['up', 'a', 'b']);
  });
  it('freezes an authorized enhancement pair in the same provider snapshot as upscale', async (): Promise<void> => {
    storage.providers.mockResolvedValueOnce([provider('up', 'upscaler', ['Real-ESRGAN']), provider('enhance', 'image')]);
    const result = await plan({ action: 'upscale', upscaleModel: 'Real-ESRGAN', enableQualityEnhance: true });
    expect(result.enhancementCandidate).toMatchObject({ providerId: 'enhance', model: 'gpt-image-1', apiKey: 'offline-enhance' });
    expect(storage.providers).toHaveBeenCalledTimes(1);
  });
  it('rejects an explicitly requested but unauthorized enhancement pair', async (): Promise<void> => {
    await expect(plan({ action: 'upscale', upscaleModel: 'Real-ESRGAN',
      user: { ...actor, imageModels: ['up::Real-ESRGAN'] },
      enableQualityEnhance: true, enhanceModel: 'b::gpt-image-1' }))
      .rejects.toMatchObject({ status: 403, code: 'IMAGE_EDIT_MODEL_NOT_AUTHORIZED' });
  });
  it('exact selection only permits the selected pair', async (): Promise<void> => {
    const result = await plan({ model: 'b::gpt-image-1', providerId: 'b' });
    expect(result.explicit).toBe(true);
    expect(result.candidates.map(c => c.providerId)).toEqual(['b']);
  });
  it('rejects conflicting composite identity', async (): Promise<void> => {
    await expect(plan({ model: 'a::gpt-image-1', providerId: 'b' })).rejects.toMatchObject({ status: 400, code: 'IMAGE_EDIT_MODEL_PROVIDER_MISMATCH' });
  });
  it.each(['model', 'providerId', 'upscaleModel'] as const)('rejects non-string %s', async (field): Promise<void> => {
    for (const invalid of [{ model: 'gpt-image-1' }, 42, null, [], true]) {
      await expect(plan({ [field]: invalid })).rejects.toMatchObject({ status: 400, code: 'IMAGE_EDIT_INVALID_MODEL_SELECTION' });
    }
  });
  it.each(['missing', 'up', 'chat'])('rejects unavailable or action-incompatible explicit provider %s', async (providerId): Promise<void> => {
    await expect(plan({ providerId, model: 'gpt-image-1' })).rejects.toMatchObject({ status: 400, code: 'IMAGE_EDIT_MODEL_UNAVAILABLE' });
  });
  it('rejects unauthorized exact pair and excludes it from automatic fallback', async (): Promise<void> => {
    const user = { ...actor, imageModels: ['b::gpt-image-1'] };
    await expect(plan({ user, providerId: 'a', model: 'gpt-image-1' })).rejects.toMatchObject({ status: 403, code: 'IMAGE_EDIT_MODEL_NOT_AUTHORIZED' });
    expect((await plan({ user })).candidates.map(c => c.providerId)).toEqual(['b']);
  });
  it('retains real unique legacy assignment migration and rejects ambiguous bare assignment', async (): Promise<void> => {
    await expect(plan({ user: { ...actor, imageModels: ['gpt-image-1'] } })).rejects.toMatchObject({ code: 'IMAGE_EDIT_MODEL_NOT_AUTHORIZED' });
    storage.providers.mockResolvedValue([provider('a')]);
    expect((await plan({ user: { ...actor, imageModels: ['gpt-image-1'] } })).candidates.map(c => c.providerId)).toEqual(['a']);
  });
  it('uses per-model types for universal providers and separate vision authorization', async (): Promise<void> => {
    storage.providers.mockResolvedValue([provider('mixed', 'universal', ['gpt-image-1', 'gpt-4o', 'Real-ESRGAN', 'birefnet'])]);
    const result = await plan({ user: { ...actor, chatModels: ['other::gpt-4o'] } });
    expect(result.candidates.map(c => c.model)).toEqual(['gpt-image-1']);
    expect(result.visionCandidates).toEqual([]);
  });
  it('internal uses managed actor rather than claimed admin privileges', async (): Promise<void> => {
    storage.users.mockResolvedValue([{ ...actor, imageModels: ['b::gpt-image-1'] }]);
    await expect(plan({ source: 'internal', user: { ...actor, role: 'admin' }, providerId: 'a', model: 'gpt-image-1' }))
      .rejects.toMatchObject({ status: 403, code: 'IMAGE_EDIT_MODEL_NOT_AUTHORIZED' });
    expect(storage.users).toHaveBeenCalledTimes(1);
  });
  it.each([{ users: [] }, { users: [{ ...actor, status: 'disabled' }] }])('rejects missing/disabled internal user', async ({ users }): Promise<void> => {
    storage.users.mockResolvedValue(users);
    await expect(plan({ source: 'internal' })).rejects.toMatchObject({ status: 403 });
  });
  it('disabled admin is not authorized', async (): Promise<void> => {
    await expect(plan({ user: { ...actor, role: 'admin', status: 'disabled' } })).rejects.toMatchObject({ status: 403 });
  });
  it.each([{ isEnabled: false }, { apiKey: '' }, { baseUrl: '' }, { selectedModels: [] }])
    ('does not admit incomplete configuration %j or use env credentials', async (patch): Promise<void> => {
      storage.providers.mockResolvedValue([{ ...provider('a'), ...patch }]);
      vi.stubEnv('APIMART_API_KEY', 'forbidden-env-key');
      await expect(plan()).rejects.toMatchObject({ status: 400, code: 'IMAGE_EDIT_MODEL_UNAVAILABLE' });
    });
  it('fails closed with sanitized config/user storage errors', async (): Promise<void> => {
    storage.providers.mockRejectedValue(new Error('secret-credential'));
    await expect(plan()).rejects.toMatchObject({ status: 503, code: 'IMAGE_EDIT_MODEL_PLAN_UNAVAILABLE', message: 'IMAGE_EDIT_MODEL_PLAN_UNAVAILABLE' });
    storage.providers.mockResolvedValue([provider('a')]);
    storage.users.mockRejectedValue(new Error('secret-credential'));
    await expect(plan({ source: 'internal' })).rejects.toMatchObject({ status: 503 });
  });
  it('upscaleModel supersedes old UI general model and canonicalizes 302 alias', async (): Promise<void> => {
    storage.providers.mockResolvedValue([{ ...provider('302', 'upscaler', ['esrgan']), baseUrl: 'https://api.302.ai' }]);
    const result = await plan({ action: 'upscale', providerId: '302', model: 'legacy::gpt-image-1', upscaleModel: 'esrgan' });
    expect(result.requestedModelId).toBe('302-esrgan');
    expect(result.candidates.map(c => `${c.providerId}::${c.model}`)).toEqual(['302::302-esrgan']);
  });
  it('rejects unverified SeedVR2 before execution', async (): Promise<void> => {
    storage.providers.mockResolvedValue([provider('up', 'upscaler', ['SeedVR2-Upscaler'])]);
    await expect(plan({ action: 'upscale', providerId: 'up', upscaleModel: 'SeedVR2-Upscaler' })).rejects.toMatchObject({ status: 422 });
  });
  it('canonicalizes an automatic 302 upscale alias while retaining automatic provider selection', async (): Promise<void> => {
    storage.providers.mockResolvedValue([{ ...provider('302', 'upscaler', ['esrgan']), baseUrl: 'https://api.302.ai' }]);
    const result = await plan({ action: 'upscale', upscaleModel: 'esrgan' });
    expect(result.explicit).toBe(false);
    expect(result.requestedModelId).toBe('302-esrgan');
  });
  it('uses API permission gates even with an assigned exact image model', async (): Promise<void> => {
    await expect(plan({ user: { ...actor, imageModels: ['a::gpt-image-1'], apiPermissions: {
      image: false, chat: true, threeD: false, imageEdit: false, vectorize: false, vlm: true,
      layer: false, video: false, upscaler: false, removebg: false, audio: false,
    } } })).rejects.toMatchObject({ status: 403, code: 'IMAGE_EDIT_MODEL_NOT_AUTHORIZED' });
  });
  it('clones admitted credential and protocol snapshot and deduplicates exact pairs', async (): Promise<void> => {
    const original = { ...provider('a'), selectedModels: ['gpt-image-1', 'gpt-image-1'], advancedParams: { compatProfile: 'openai' } };
    storage.providers.mockResolvedValue([original]);
    const result = await plan();
    original.apiKey = 'changed';
    original.advancedParams.compatProfile = 'changed';
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ apiKey: 'offline-a', advancedParams: { compatProfile: 'openai' }, provider: { apiKey: 'offline-a' } });
  });
});
