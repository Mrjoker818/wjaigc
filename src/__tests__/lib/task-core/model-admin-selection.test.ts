import { describe, expect, it, vi } from 'vitest';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: vi.fn(() => { throw new Error('CONFIG_IO_FORBIDDEN'); }) }));
vi.mock('@/lib/server-auth', () => ({ listManagedUsers: vi.fn(() => { throw new Error('USER_IO_FORBIDDEN'); }) }));

import { getConfiguredModelsForProvider } from '@/lib/model-type-classification';
import { resolveTaskModelFromProviders, resolveTaskModelCatalogResultFromSnapshot } from '@/lib/task-core/model-catalog';

const user: User = { id: 'offline-user', name: 'Offline user', role: 'user', status: 'active', imageModels: [], createdAt: 1, updatedAt: 1 };
const admin: User = { ...user, role: 'admin' };
function provider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return { id: 'p', name: 'Offline provider', type: 'image', modelType: 'image',
    baseUrl: 'https://supplier.invalid/v1', apiKey: 'synthetic-only', isEnabled: true,
    createdAt: 1, updatedAt: 1, selectedModels: [],
    discoveredModels: [{ id: 'gpt-image-1', name: 'Discovered image', providerId: 'p', type: 'image' }],
    ...overrides };
}

describe('administrator model selection at exact catalog admission', () => {
  it.each([user, admin])('keeps discovery metadata without authorizing discovered-only models for $role', actor => {
    const configured = provider();
    const discovered = getConfiguredModelsForProvider(configured);
    expect(discovered.map(model => model.id)).toEqual(['gpt-image-1']);
    expect(() => resolveTaskModelFromProviders([configured], 'p', 'gpt-image-1', actor))
      .toThrow(expect.objectContaining({ code: 'MODEL_NOT_CONFIGURED' }));
    const catalog = resolveTaskModelCatalogResultFromSnapshot(discovered, actor, [configured]);
    expect([...catalog.authorizedModelKeys]).toEqual([]);
    expect(catalog.taskModelCatalog).toEqual([]);
    expect(configured.selectedModels).toEqual([]);
    expect(configured.isEnabled).toBe(true);
    expect(configured.discoveredModels).toHaveLength(1);
  });

  it('rejects missing selectedModels as well as an empty admin selection', () => {
    const configured = provider({ selectedModels: undefined });
    expect(() => resolveTaskModelFromProviders([configured], 'p', 'gpt-image-1', user))
      .toThrow(expect.objectContaining({ code: 'MODEL_NOT_CONFIGURED' }));
  });

  it('admits a selected model without requiring discovery metadata', () => {
    const configured = provider({ selectedModels: ['gpt-image-1'], discoveredModels: [] });
    expect(resolveTaskModelFromProviders([configured], 'p', 'gpt-image-1', user))
      .toMatchObject({ providerId: 'p', modelId: 'gpt-image-1', kind: 'image' });
  });

  it('does not let discovery-only duplicates make an enabled legacy bare assignment ambiguous', () => {
    const configured = provider({ selectedModels: ['gpt-image-1'] });
    const discoveredOnly = provider({ id: 'q' });
    expect(resolveTaskModelFromProviders([configured, discoveredOnly], 'p', 'gpt-image-1',
      { ...user, imageModels: ['gpt-image-1'] })).toMatchObject({ providerId: 'p', modelId: 'gpt-image-1' });
  });

  it.each([{ selectedModels: [] }, { selectedModels: ['302'] }])('preserves the established 302 standard defaults for $selectedModels', ({ selectedModels }) => {
    const configured = provider({ type: 'upscaler', modelType: 'upscaler', baseUrl: 'https://api.302.ai', selectedModels,
      discoveredModels: [{ id: '302-esrgan', name: 'Discovery only', providerId: 'p', type: 'upscaler' }] });
    for (const model of ['302-super-upscale-v2', '302-upscale-v6']) {
      expect(resolveTaskModelFromProviders([configured], 'p', model, admin)).toMatchObject({ modelId: model, kind: 'upscale' });
    }
    expect(() => resolveTaskModelFromProviders([configured], 'p', '302-esrgan', admin))
      .toThrow(expect.objectContaining({ code: 'MODEL_NOT_CONFIGURED' }));
  });

  it('keeps 302 selected aliases and explicit custom selections authoritative', () => {
    const configured = provider({ type: 'upscaler', modelType: 'upscaler', baseUrl: 'https://api.302.ai',
      selectedModels: ['upscale-v6', 'custom-upscale'], discoveredModels: [] });
    expect(resolveTaskModelFromProviders([configured], 'p', 'upscale-v6', admin))
      .toMatchObject({ modelId: '302-upscale-v6', kind: 'upscale' });
    expect(resolveTaskModelFromProviders([configured], 'p', 'custom-upscale', admin))
      .toMatchObject({ modelId: 'custom-upscale', kind: 'upscale' });
    expect(() => resolveTaskModelFromProviders([configured], 'p', '302-super-upscale-v2', admin))
      .toThrow(expect.objectContaining({ code: 'MODEL_NOT_CONFIGURED' }));
  });

  it('does not extend the 302 default exception to image providers on the same host', () => {
    const configured = provider({ baseUrl: 'https://api.302.ai' });
    expect(() => resolveTaskModelFromProviders([configured], 'p', 'gpt-image-1', admin))
      .toThrow(expect.objectContaining({ code: 'MODEL_NOT_CONFIGURED' }));
  });

  it('does not extend the 302 default exception to another upscaler host', () => {
    const configured = provider({ type: 'upscaler', modelType: 'upscaler',
      discoveredModels: [{ id: '302-upscale-v6', name: 'Discovered upscale', providerId: 'p', type: 'upscaler' }] });
    expect(() => resolveTaskModelFromProviders([configured], 'p', '302-upscale-v6', admin))
      .toThrow(expect.objectContaining({ code: 'MODEL_NOT_CONFIGURED' }));
  });
});

