import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getPublicModelCatalogSnapshot: vi.fn(),
  resolveTaskModelCatalogResultFromSnapshot: vi.fn(),
  loadCreditPricingConfig: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: vi.fn(() => { throw new Error('legacy provider scan must not be used'); }),
  inferModelType: vi.fn(() => { throw new Error('legacy model inference must not be used'); }),
  getPublicModelCatalogSnapshot: mocks.getPublicModelCatalogSnapshot,
}));
vi.mock('@/lib/task-core/model-catalog', () => ({
  resolveTaskModelCatalogResultFromSnapshot: mocks.resolveTaskModelCatalogResultFromSnapshot,
  taskModelKey: (providerId: string, modelId: string) => `${providerId}::${modelId}`,
}));
vi.mock('@/lib/credit-pricing', () => ({
  loadCreditPricingConfig: mocks.loadCreditPricingConfig,
  saveCreditPricingConfig: vi.fn(),
  buildPricingKey: (providerId: string, model: string) => `${providerId}::${model}`,
}));
vi.mock('@/lib/credits', () => ({
  getChatModelCredits: () => 3,
  getImageModelCredits: () => 8,
  getVideoModelCreditsPerSecond: () => 2,
  getOtherOperationCredits: (operation: string) => operation === 'segment' ? 15 : 10,
}));

import { GET } from '@/app/api/admin/credits/pricing/route';

describe('admin credit pricing model classification', () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    const provider = {
      id: 'provider-general',
      displayName: 'General provider',
      modelType: 'general',
      selectedModels: ['custom-prose-model'],
      isEnabled: true,
    };
    const model = {
      id: 'custom-prose-model',
      name: 'Custom prose model',
      providerId: 'provider-general',
      type: 'general',
    };
    mocks.getPublicModelCatalogSnapshot.mockResolvedValue({
      configuredProviders: [provider],
      providers: [{ id: provider.id, name: provider.displayName }],
      models: [model],
    });
    mocks.resolveTaskModelCatalogResultFromSnapshot.mockReturnValue({
      taskModelCatalog: [],
      authorizedModelKeys: new Set(['provider-general::custom-prose-model']),
      effectiveModelTypes: new Map([['provider-general::custom-prose-model', 'chat']]),
      modelAuthorizationMigration: { resolved: [], required: [] },
    });
    mocks.loadCreditPricingConfig.mockResolvedValue({ modelCredits: {}, updatedAt: null });
  });

  it('keeps general providers in the LLM billing category', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/credits/pricing'));
    const body = await response.json() as {
      models: Array<{ modelType: string; billingCategory: string; unit: string }>;
    };

    expect(response.status).toBe(200);
    expect(mocks.resolveTaskModelCatalogResultFromSnapshot).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ id: 'admin-1' }),
      expect.any(Array),
    );
    expect(body.models[0]).toMatchObject({
      modelType: 'chat',
      billingCategory: 'llm',
      unit: 'per-call',
    });
  });

  it('uses the segment operation fallback for layer models', async () => {
    const provider = {
      id: 'pear-layer-provider',
      displayName: 'Pear Layer',
      modelType: 'layer',
      selectedModels: ['Image-Layered'],
      isEnabled: true,
    };
    const model = {
      id: 'Image-Layered',
      name: 'Image Layered',
      providerId: provider.id,
      type: 'layer',
    };
    mocks.getPublicModelCatalogSnapshot.mockResolvedValue({
      configuredProviders: [provider],
      providers: [{ id: provider.id, name: provider.displayName }],
      models: [model],
    });
    mocks.resolveTaskModelCatalogResultFromSnapshot.mockReturnValue({
      taskModelCatalog: [],
      authorizedModelKeys: new Set([`${provider.id}::${model.id}`]),
      effectiveModelTypes: new Map([[`${provider.id}::${model.id}`, 'layer']]),
      modelAuthorizationMigration: { resolved: [], required: [] },
    });

    const response = await GET(new NextRequest('http://localhost/api/admin/credits/pricing'));
    const body = await response.json() as {
      models: Array<{
        modelType: string;
        billingCategory: string;
        credits: number;
        unit: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.models[0]).toMatchObject({
      modelType: 'layer',
      billingCategory: 'edit',
      credits: 15,
      unit: 'per-call',
    });
  });
});
