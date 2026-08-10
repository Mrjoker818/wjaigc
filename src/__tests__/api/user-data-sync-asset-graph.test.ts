import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbGetUserData: vi.fn(),
  dbSetUserData: vi.fn(),
  execSql: vi.fn(),
  executeCanvasProjectSync: vi.fn(),
  readAssetV3Projects: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/db-storage', () => ({
  dbGetUserData: mocks.dbGetUserData,
  dbSetUserData: mocks.dbSetUserData,
}));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql }));
vi.mock('@/lib/asset-core/canvas-project-sync', () => ({
  executeCanvasProjectSync: mocks.executeCanvasProjectSync,
  readAssetV3Projects: mocks.readAssetV3Projects,
}));

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
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1' });
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.dbSetUserData.mockResolvedValue(true);
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
      body: JSON.stringify({ key: 'projects', value: projects }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: 'atomic graph failure' });
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
  });
});
