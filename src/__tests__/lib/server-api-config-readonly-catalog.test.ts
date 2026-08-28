import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  dbGetApiProviders: vi.fn(),
  dbUpsertApiProvider: vi.fn(),
  dbDeleteApiProvider: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('fs/promises')>(),
  readFile: mocks.readFile,
}));
vi.mock('@/lib/db-storage', () => ({
  dbGetApiProviders: mocks.dbGetApiProviders,
  dbUpsertApiProvider: mocks.dbUpsertApiProvider,
  dbDeleteApiProvider: mocks.dbDeleteApiProvider,
}));

import { getPublicModelCatalogSnapshot } from '@/lib/server-api-config';

describe('public model catalog reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbGetApiProviders.mockResolvedValue([]);
    mocks.dbUpsertApiProvider.mockResolvedValue(true);
    mocks.readFile.mockResolvedValue(JSON.stringify({
      providers: [{
        id: 'file-provider',
        name: 'File Provider',
        displayName: 'File Provider',
        baseUrl: 'https://example.test/v1',
        apiKey: 'secret',
        isEnabled: true,
        type: 'image',
        modelType: 'image',
        requestStyle: 'images-generations',
        selectedModels: ['file-image'],
        discoveredModels: [{
          id: 'file-image',
          name: 'File Image',
          providerId: 'file-provider',
          type: 'image',
        }],
      }],
      updatedAt: 1,
    }));
  });

  it('does not migrate file fallback providers while serving a public catalog snapshot', async () => {
    const snapshot = await getPublicModelCatalogSnapshot();

    expect(snapshot.models).toEqual([
      expect.objectContaining({ id: 'file-image', providerId: 'file-provider' }),
    ]);
    expect(mocks.dbUpsertApiProvider).not.toHaveBeenCalled();
  });
});
