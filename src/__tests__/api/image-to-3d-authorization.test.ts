import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configuredProvider, doubles, IMAGE, request, requestBody,
  resetOfflineRoute, SECOND_IMAGE,
} from '../fixtures/image-to-3d-offline';
import { POST } from '@/app/api/image-to-3d/route';

beforeEach(resetOfflineRoute);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function expectNoAdmissionOrDispatch() {
  expect(doubles.fetch).not.toHaveBeenCalled();
  expect(doubles.calculateConfiguredCreditCost).not.toHaveBeenCalled();
  expect(doubles.consumeCredits).not.toHaveBeenCalled();
  expect(doubles.createBillableTask).not.toHaveBeenCalled();
  expect(doubles.refundCredits).not.toHaveBeenCalled();
  expect(doubles.recordThreeDTaskSubmitted).not.toHaveBeenCalled();
}

describe('image-to-3d exact provider/model authorization before billing', () => {
  it.each(['legacy', 'shadow', 'core-v2'])('rejects an unselected model in %s admission', async (mode) => {
    vi.stubEnv('WUJIE_TASK_CORE_MODE', mode);
    doubles.providers = [configuredProvider({ name: 'Synthetic', displayName: 'Synthetic', providerPreset: 'generic' })];
    doubles.user!.imageModels = ['provider-a::unselected-3d'];
    const response = await POST(request(requestBody({ provider: { model: 'unselected-3d' } })));
    expectNoAdmissionOrDispatch();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it.each([
    { name: 'disabled provider', id: 'provider-a', enabled: false },
    { name: 'missing provider', id: 'missing-provider', enabled: true },
  ])('does not fall back for $name even when another provider offers the same model', async ({ id, enabled }) => {
    doubles.providers = [
      configuredProvider({ isEnabled: enabled }),
      configuredProvider({ id: 'provider-b', baseUrl: 'https://provider-b.invalid', apiKey: 'synthetic-key-b' }),
    ];
    const response = await POST(request(requestBody({ providerId: id, provider: { model: 'meshy-6' } })));
    expectNoAdmissionOrDispatch();
    expect(response.status).toBe(403);
    expect(doubles.findProviderForModel).not.toHaveBeenCalled();
  });

  it.each([undefined, [], ['meshy-6'], ['provider-b::meshy-6'], ['provider-a::meshy-5']])(
    'requires exact user assignment, got %j', async (assignment) => {
      doubles.user!.imageModels = assignment;
      doubles.providers.push(configuredProvider({ id: 'provider-b' }));
      const response = await POST(request(requestBody()));
      expectNoAdmissionOrDispatch();
      expect(response.status).toBe(403);
    },
  );

  it('does not use chat assignments as image/3D authorization', async () => {
    doubles.user!.imageModels = [];
    doubles.user!.chatModels = ['provider-a::meshy-6'];
    const response = await POST(request(requestBody()));
    expectNoAdmissionOrDispatch();
    expect(response.status).toBe(403);
  });

  it('requires the 3D feature permission even with an exact assignment', async () => {
    doubles.user!.apiPermissions = { threeD: false } as NonNullable<typeof doubles.user>['apiPermissions'];
    const response = await POST(request(requestBody()));
    expectNoAdmissionOrDispatch();
    expect(response.status).toBe(403);
  });

  it.each([
    { providerId: undefined, provider: { model: 'meshy-6' } },
    { provider: { id: 'provider-a' } },
    { provider: { model: 'meshy-6-preview' } },
    { provider: { model: 'MESHY-6' } },
    { provider: { model: ' meshy-6 ' } },
    { providerId: 'provider-a::meshy-6', provider: { model: 'meshy-5' } },
    { providerId: 'provider-a', provider: { id: 'provider-b', model: 'meshy-6' } },
    { providerId: 'admin-3d::meshy-6', provider: { model: 'meshy-6' } },
    { providerId: 123, provider: { model: 'meshy-6' } },
    { provider: { model: ['meshy-6'] } },
  ])('rejects incomplete, conflicting or non-exact selection %j', async (selection) => {
    const response = await POST(request(requestBody(selection)));
    expectNoAdmissionOrDispatch();
    expect(response.status).toBe(403);
  });

  it('rejects caller credentials and endpoint when the provider is not configured', async () => {
    doubles.providers = [];
    const response = await POST(request(requestBody({ provider: {
      id: 'provider-a', model: 'meshy-6', name: 'Meshy',
      baseUrl: 'https://caller.invalid', apiKey: 'synthetic-caller-key',
    } })));
    expectNoAdmissionOrDispatch();
    expect(response.status).toBe(403);
  });

  it.each([
    { selectedModels: [] }, { selectedModels: undefined }, { isEnabled: false },
    { apiKey: '' },
  ])('admin still requires enabled, configured exact model: %j', async (provider) => {
    doubles.user!.role = 'admin';
    doubles.user!.imageModels = [];
    doubles.providers = [configuredProvider(provider)];
    const response = await POST(request(requestBody()));
    expectNoAdmissionOrDispatch();
    expect(response.status).toBe(403);
  });

  it('admin bypasses only user assignment for an enabled exact model', async () => {
    doubles.user!.role = 'admin';
    doubles.user!.imageModels = [];
    const response = await POST(request(requestBody()));
    expect(response.status).toBe(200);
    expect(doubles.consumeCredits).toHaveBeenCalledOnce();
    expect(doubles.fetch).toHaveBeenCalledOnce();
  });

  it('dispatches the assigned second provider when both providers offer the same model', async () => {
    doubles.providers.push(configuredProvider({
      id: 'provider-b', baseUrl: 'https://provider-b.invalid', apiKey: 'synthetic-key-b',
    }));
    doubles.user!.imageModels = ['provider-b::meshy-6'];
    const response = await POST(request(requestBody({ providerId: 'provider-b', provider: { model: 'meshy-6' } })));
    expect(response.status).toBe(200);
    expect(doubles.fetch).toHaveBeenCalledWith('https://provider-b.invalid/image-to-3d', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-key-b' }),
    }));
    expect(doubles.recordThreeDTaskSubmitted).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-b', model: 'meshy-6',
    }));
  });

  it.each([
    { providerId: 'provider-a::meshy-6', provider: undefined },
    { providerId: 'admin-3d::provider-a::meshy-6', provider: undefined },
    { providerId: undefined, provider: { id: 'admin-3d::provider-a::meshy-6', model: 'meshy-6' } },
    { providerId: undefined, provider: { id: 'provider-a', model: 'meshy-6' } },
  ])('accepts existing exact selection encoding %j', async (selection) => {
    const response = await POST(request(requestBody(selection)));
    expect(response.status).toBe(200);
    expect(doubles.fetch).toHaveBeenCalledOnce();
    expect(doubles.recordThreeDTaskSubmitted).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'synthetic-user', providerId: 'provider-a', model: 'meshy-6',
    }));
  });

  it('uses only server credentials, endpoint, preset and parameters for the exact provider', async () => {
    doubles.providers[0].providerPreset = undefined;
    doubles.providers[0].name = 'Synthetic';
    doubles.providers[0].displayName = 'Synthetic';
    const response = await POST(request(requestBody({ provider: {
      model: 'meshy-6', baseUrl: 'https://caller.invalid', apiKey: 'synthetic-caller-key',
      providerPreset: 'tripo', advancedParams: { custom: 'untrusted' },
    } })));
    expect(response.status).toBe(200);
    expect(doubles.fetch).toHaveBeenCalledWith('https://provider-a.invalid/image-to-3d', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-key-a' }),
    }));
  });

  it('does not dispatch a different Meshy model from the authorized selection', async () => {
    doubles.providers[0].selectedModels = ['meshy-5'];
    doubles.user!.imageModels = ['provider-a::meshy-5'];
    const response = await POST(request(requestBody({ provider: { model: 'meshy-5' } })));
    expect(response.status).toBe(200);
    const body = JSON.parse(doubles.fetch.mock.calls[0][1].body);
    expect(body.ai_model).toBe('meshy-5');
  });
});

const vendors = [
  { name: 'hunyuan3d', model: 'hunyuan3d-pro', paths: ['tencent/hunyuan3d/pro-job', 'tencent/hunyuan3d/pro-job', 'tencent/hunyuan3d/pro-job'] },
  { name: 'meshy', model: 'meshy-6', paths: ['image-to-3d', 'multi-image-to-3d', 'text-to-3d'] },
  { name: 'tripo', model: 'tripo-v2', paths: ['v2/openapi/image2model', 'v2/openapi/image2model', 'v2/openapi/image2model'] },
  { name: 'rodin', model: 'rodin-gen2', paths: ['api/generation/generate', 'api/generation/generate', 'api/generation/generate'] },
] as const;

describe.each(['legacy', 'core-v2'])('authorized three-mode/four-vendor paths (%s)', (admission) => {
  for (const vendor of vendors) {
    it.each(['single-image', 'multi-image', 'text-to-3d'])(`${vendor.name}: %s`, async (mode) => {
      vi.stubEnv('WUJIE_TASK_CORE_MODE', admission);
      doubles.providers = [configuredProvider({
        name: vendor.name, displayName: vendor.name, providerPreset: vendor.name,
        selectedModels: [vendor.model], selectedModel: vendor.model,
      })];
      doubles.user!.imageModels = [`provider-a::${vendor.model}`];
      const response = await POST(request(requestBody({
        mode, imageUrl: mode === 'text-to-3d' ? '' : IMAGE,
        images: mode === 'multi-image' ? [{ url: IMAGE, view: 'front' }, { url: SECOND_IMAGE, view: 'back' }] : undefined,
        prompt: mode === 'text-to-3d' ? 'A synthetic test object' : undefined,
        provider: { model: vendor.model },
      })));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, taskId: expect.any(String) });
      expect(doubles.fetch).toHaveBeenCalledOnce();
      const [endpoint, init] = doubles.fetch.mock.calls[0];
      const index = ['single-image', 'multi-image', 'text-to-3d'].indexOf(mode);
      expect(endpoint).toBe(`https://provider-a.invalid/${vendor.paths[index]}`);
      expect(init.headers.Authorization).toBe('Bearer synthetic-key-a');
      const payload = JSON.parse(init.body);
      if (mode === 'text-to-3d') expect(payload.Prompt || payload.prompt).toBe('A synthetic test object');
      if (mode === 'multi-image') {
        if (vendor.name === 'hunyuan3d') expect(payload.MultiViewImages).toEqual([{ ViewType: 'back', ViewImageBase64: SECOND_IMAGE.split(',')[1] }]);
        else expect(payload.image_urls || payload.images).toEqual([IMAGE, SECOND_IMAGE]);
      }
      if (vendor.name === 'meshy') expect(payload.ai_model).toBe('meshy-6');
      if (admission === 'core-v2') {
        expect(doubles.consumeCredits).not.toHaveBeenCalled();
        expect(doubles.createBillableTask).toHaveBeenCalledWith(expect.objectContaining({
          userId: 'synthetic-user', task: expect.objectContaining({ providerId: 'provider-a', model: vendor.model }),
        }));
      } else expect(doubles.consumeCredits).toHaveBeenCalledOnce();
    });
  }
});
