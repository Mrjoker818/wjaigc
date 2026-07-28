import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getApiProviders: vi.fn(),
  inferModelType: vi.fn(),
  loadCreditPricingConfig: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: mocks.getApiProviders,
  inferModelType: mocks.inferModelType,
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
}));

import { GET } from '@/app/api/admin/credits/pricing/route';

describe('admin credit pricing model classification', () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.getApiProviders.mockResolvedValue([{
      id: 'provider-general',
      displayName: 'General provider',
      modelType: 'general',
      selectedModels: ['custom-prose-model'],
      isEnabled: true,
    }]);
    mocks.inferModelType.mockImplementation((_model: string, fallback: string) => fallback);
    mocks.loadCreditPricingConfig.mockResolvedValue({ modelCredits: {}, updatedAt: null });
  });

  it('keeps general providers in the LLM billing category', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/credits/pricing'));
    const body = await response.json() as {
      models: Array<{ modelType: string; billingCategory: string; unit: string }>;
    };

    expect(response.status).toBe(200);
    expect(mocks.inferModelType).toHaveBeenCalledWith('custom-prose-model', 'chat');
    expect(body.models[0]).toMatchObject({
      modelType: 'chat',
      billingCategory: 'llm',
      unit: 'per-call',
    });
  });
});
