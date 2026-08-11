import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbGetUserData: vi.fn(),
  dbSetUserData: vi.fn(),
  execSql: vi.fn(),
  executeCanvasProjectSync: vi.fn(),
  readCanvasProjectRevision: vi.fn(),
  readAssetV3Projects: vi.fn(),
  persistResultImage: vi.fn(),
  CanvasProjectSyncConflictError: class CanvasProjectSyncConflictError extends Error {
    readonly currentRevision: number;
    constructor(currentRevision: number) {
      super('Canvas project snapshot is stale');
      this.currentRevision = currentRevision;
    }
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/db-storage', () => ({
  dbGetUserData: mocks.dbGetUserData,
  dbSetUserData: mocks.dbSetUserData,
}));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql }));
vi.mock('@/lib/asset-core/canvas-project-sync', () => ({
  CanvasProjectSyncConflictError: mocks.CanvasProjectSyncConflictError,
  executeCanvasProjectSync: mocks.executeCanvasProjectSync,
  readCanvasProjectRevision: mocks.readCanvasProjectRevision,
  readAssetV3Projects: mocks.readAssetV3Projects,
}));
vi.mock('@/lib/persist-result-image', () => ({ persistResultImage: mocks.persistResultImage }));

import { GET, POST } from '@/app/api/user-data/sync/route';

const projects = [{
  id: 'project-1',
  userId: 'user-1',
  name: 'Project',
  createdAt: 1,
  updatedAt: 1,
  settings: {},
  canvasImages: [],
}];

describe('user-data asset graph sync route', () => {
  const originalMode = process.env.WUJIE_ASSET_GRAPH_MODE;

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      const reset = (mock as { mockReset?: () => void }).mockReset;
      if (reset) reset.call(mock);
    });
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1' });
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.dbSetUserData.mockResolvedValue(true);
    mocks.readCanvasProjectRevision.mockResolvedValue(0);
    mocks.persistResultImage.mockImplementation(async (url: string) => url);
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.WUJIE_ASSET_GRAPH_MODE;
    else process.env.WUJIE_ASSET_GRAPH_MODE = originalMode;
  });

  it('returns failure and does not fall back to a legacy-only write when atomic shadow sync fails', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'shadow';
    mocks.executeCanvasProjectSync.mockRejectedValue(new Error('atomic graph failure'));

    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({ key: 'projects', value: projects, projectRevision: 0 }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: 'atomic graph failure' });
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('returns the current revision without project data when shadow CAS rejects a stale snapshot', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'shadow';
    mocks.executeCanvasProjectSync.mockRejectedValue(new mocks.CanvasProjectSyncConflictError(7));

    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({ key: 'projects', value: projects, projectRevision: 6 }),
      headers: { 'content-type': 'application/json' },
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      error: 'Canvas project snapshot is stale',
      currentRevision: 7,
    });
    expect(body).not.toHaveProperty('value');
    expect(body).not.toHaveProperty('projects');
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('treats a failed legacy database write as a failed request', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'legacy';
    mocks.dbSetUserData.mockResolvedValue(false);

    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({ key: 'projects', value: projects }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(500);
    expect(mocks.executeCanvasProjectSync).not.toHaveBeenCalled();
  });

  it('uses asset graph placements for production GET hydration only in asset-v3 mode', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'asset-v3';
    mocks.dbGetUserData.mockResolvedValue(projects);
    const projected = [{ ...projects[0], canvasImages: [{ id: 'graph-image', url: '' }] }];
    mocks.readAssetV3Projects.mockResolvedValue(projected);

    const response = await GET(new NextRequest('http://localhost/api/user-data/sync?key=projects'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.readAssetV3Projects).toHaveBeenCalledWith('user-1', projects);
    expect(body.value).toEqual(projected);
    expect(body.assetGraphMode).toBe('asset-v3');
  });

  it('injects the established data URL persistence boundary into atomic shadow sync', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'shadow';
    mocks.executeCanvasProjectSync.mockResolvedValue({ projects, mappings: {}, revision: 1 });

    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({ key: 'projects', value: projects, projectRevision: 0 }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    const input = mocks.executeCanvasProjectSync.mock.calls[0][0] as {
      expectedRevision?: number;
      persistMedia?: (value: { dataUrl: string }) => Promise<{ url: string }>;
    };
    expect(input.expectedRevision).toBe(0);
    expect(input.persistMedia).toBeTypeOf('function');
    mocks.persistResultImage.mockResolvedValue('/api/serve-upload/uploads/persisted.png');
    await expect(input.persistMedia!({ dataUrl: 'data:image/png;base64,AAAA' }))
      .resolves.toEqual({ url: '/api/serve-upload/uploads/persisted.png' });

    mocks.persistResultImage.mockClear();
    await expect(input.persistMedia!({ dataUrl: 'https://remote.test/image.png' }))
      .rejects.toThrow('LEGACY_MEDIA_PERSIST_FAILED');
    expect(mocks.persistResultImage).not.toHaveBeenCalled();
  });

  it('returns only canonical canvas media fields and graph IDs after data URL persistence', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'shadow';
    const canonicalProjects = [{
      ...projects[0],
      name: 'must-not-leak-project-name',
      settings: { secret: 'must-not-leak-settings' },
      canvasImages: [{
        id: 'encoded',
        url: '/api/serve-upload/uploads/canonical.png',
        sourceUrl: '/api/serve-upload/uploads/source.png',
        thumbnailUrl: '/api/serve-upload/uploads/thumb.png',
        mediaAvailability: 'ready',
        originalWidth: 1024,
        originalHeight: 768,
        assetId: 'asset-a',
        assetVersionId: 'version-a',
        placementId: 'placement-a',
        prompt: 'must-not-leak-prompt',
      }],
    }];
    mocks.executeCanvasProjectSync.mockResolvedValue({
      projects: canonicalProjects,
      revision: 1,
      mappings: {
        'project-1': {
          encoded: { assetId: 'asset-a', versionId: 'version-a', placementId: 'placement-a' },
        },
      },
    });

    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({ key: 'projects', value: projects, projectRevision: 0 }),
      headers: { 'content-type': 'application/json' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.projectRevision).toBe(1);
    expect(body.assetGraphUpdates).toEqual({
      'project-1': {
        encoded: {
          assetId: 'asset-a',
          versionId: 'version-a',
          placementId: 'placement-a',
          url: '/api/serve-upload/uploads/canonical.png',
          sourceUrl: '/api/serve-upload/uploads/source.png',
          thumbnailUrl: '/api/serve-upload/uploads/thumb.png',
          mediaAvailability: 'ready',
          mediaErrorCode: null,
          originalWidth: 1024,
          originalHeight: 768,
        },
      },
    });
    expect(body).not.toHaveProperty('value');
    expect(body).not.toHaveProperty('projects');
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
  });
});
