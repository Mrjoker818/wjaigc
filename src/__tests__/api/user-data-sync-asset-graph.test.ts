import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES } from '@/lib/simple-chat-project-sync';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbGetUserData: vi.fn(),
  dbSetUserData: vi.fn(),
  execSql: vi.fn(),
  getPool: vi.fn(),
  executeCanvasProjectSync: vi.fn(),
  executeLegacyCanvasProjectSync: vi.fn(),
  readCanvasProjectRevision: vi.fn(),
  readCanvasShadowSnapshot: vi.fn(),
  readAssetV3Projects: vi.fn(),
  persistResultImage: vi.fn(),
  inspectCompletedImage: vi.fn(),
  readSimpleChatSnapshot: vi.fn(),
  compareAndSetSimpleChatSnapshot: vi.fn(),
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
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql, getPool: mocks.getPool }));
vi.mock('@/lib/asset-core/canvas-project-sync', () => ({
  CanvasProjectSyncConflictError: mocks.CanvasProjectSyncConflictError,
  executeCanvasProjectSync: mocks.executeCanvasProjectSync,
  executeLegacyCanvasProjectSync: mocks.executeLegacyCanvasProjectSync,
  readCanvasProjectRevision: mocks.readCanvasProjectRevision,
  readCanvasShadowSnapshot: mocks.readCanvasShadowSnapshot,
  readAssetV3Projects: mocks.readAssetV3Projects,
}));
vi.mock('@/lib/persist-result-image', () => ({ persistResultImage: mocks.persistResultImage }));
vi.mock('@/lib/asset-core/image-result-metadata', () => ({
  inspectCompletedImage: mocks.inspectCompletedImage,
}));
vi.mock('@/lib/simple-chat-sync-server', () => ({
  readSimpleChatSnapshot: mocks.readSimpleChatSnapshot,
  compareAndSetSimpleChatSnapshot: mocks.compareAndSetSimpleChatSnapshot,
  SimpleChatSyncConflictError: class SimpleChatSyncConflictError extends Error {},
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
  const originalCanvasKernelMode = process.env.WUJIE_CANVAS_KERNEL_MODE;
  const originalWorkflowRendererMode = process.env.WUJIE_WORKFLOW_RENDERER_MODE;

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      const reset = (mock as { mockReset?: () => void }).mockReset;
      if (reset) reset.call(mock);
    });
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1' });
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.dbSetUserData.mockResolvedValue(true);
    mocks.readCanvasProjectRevision.mockResolvedValue(0);
    mocks.readCanvasShadowSnapshot.mockImplementation(async (userId: string) => ({
      value: await mocks.dbGetUserData(userId, 'projects'),
      revision: 0,
      deletedCanvasPlacements: [],
    }));
    mocks.persistResultImage.mockImplementation(async (url: string) => url);
    mocks.inspectCompletedImage.mockResolvedValue({
      width: 2,
      height: 2,
      mimeType: 'image/png',
      byteSize: 72,
    });
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.WUJIE_ASSET_GRAPH_MODE;
    else process.env.WUJIE_ASSET_GRAPH_MODE = originalMode;
    if (originalCanvasKernelMode === undefined) delete process.env.WUJIE_CANVAS_KERNEL_MODE;
    else process.env.WUJIE_CANVAS_KERNEL_MODE = originalCanvasKernelMode;
    if (originalWorkflowRendererMode === undefined) delete process.env.WUJIE_WORKFLOW_RENDERER_MODE;
    else process.env.WUJIE_WORKFLOW_RENDERER_MODE = originalWorkflowRendererMode;
  });

  it('returns shadow projects, revision and deleted identities from one authoritative snapshot', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'shadow';
    const deleted = [{ projectId: 'project-1', entityId: 'old-skill', assetId: 'a', assetVersionId: 'v', placementId: 'p' }];
    mocks.readCanvasShadowSnapshot.mockResolvedValue({ value: projects, revision: 17, deletedCanvasPlacements: deleted });
    const response = await GET(new NextRequest('http://localhost/api/user-data/sync?key=projects'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ value: projects, projectRevision: 17, deletedCanvasPlacements: deleted });
    expect(mocks.readCanvasShadowSnapshot).toHaveBeenCalledWith('user-1');
    expect(mocks.dbGetUserData).not.toHaveBeenCalled();
    expect(mocks.readCanvasProjectRevision).not.toHaveBeenCalled();
  });

  it('fails closed when the shadow snapshot cannot be read', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'shadow';
    mocks.readCanvasShadowSnapshot.mockRejectedValue(new Error('snapshot unavailable'));
    const response = await GET(new NextRequest('http://localhost/api/user-data/sync?key=projects'));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false });
    expect(mocks.dbGetUserData).not.toHaveBeenCalled();
  });

  it('normalizes a legacy string snapshot before delivering shadow mode and filtering ownership', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'shadow';
    const deleted = [{ projectId: 'project-1', entityId: 'old', assetId: 'a', assetVersionId: 'v', placementId: 'p' }];
    mocks.readCanvasShadowSnapshot.mockResolvedValue({
      value: JSON.stringify([...projects, { ...projects[0], id: 'foreign', userId: 'other-user' }]),
      revision: 17, deletedCanvasPlacements: deleted,
    });
    const response = await GET(new NextRequest('http://localhost/api/user-data/sync?key=projects'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ value: projects, assetGraphMode: 'shadow',
      projectRevision: 17, deletedCanvasPlacements: deleted });
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
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

  it('uses revision CAS for legacy canvas writes without migrating the asset graph', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'legacy';
    mocks.executeLegacyCanvasProjectSync.mockResolvedValue({ projects, mappings: {}, revision: 1 });

    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({ key: 'projects', value: projects, projectRevision: 0 }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectRevision: 1 });
    expect(mocks.executeLegacyCanvasProjectSync).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      projects,
      expectedRevision: 0,
    }));
    expect(mocks.executeCanvasProjectSync).not.toHaveBeenCalled();
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
    expect(mocks.readSimpleChatSnapshot).not.toHaveBeenCalled();
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
  });

  it('returns the current revision when legacy CAS rejects a stale canvas snapshot', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'legacy';
    mocks.executeLegacyCanvasProjectSync.mockRejectedValue(new mocks.CanvasProjectSyncConflictError(4));

    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({ key: 'projects', value: projects, projectRevision: 3 }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Canvas project snapshot is stale',
      currentRevision: 4,
    });
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('treats a failed legacy non-project database write as a failed request', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'legacy';
    mocks.dbSetUserData.mockResolvedValue(false);

    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({ key: 'settings_profile', value: { density: 'compact' } }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Failed to write user data' });
    expect(mocks.executeCanvasProjectSync).not.toHaveBeenCalled();
    expect(mocks.executeLegacyCanvasProjectSync).not.toHaveBeenCalled();
  });

  it('keeps the legacy contract for a non-chat payload larger than 20 MiB', async () => {
    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({
        key: 'settings_large_payload',
        value: 'x'.repeat(SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES),
      }),
      headers: { 'content-type': 'application/json' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, key: 'settings_large_payload' });
    expect(body).not.toHaveProperty('code', 'CHAT_SYNC_PAYLOAD_TOO_LARGE');
    expect(mocks.dbSetUserData).toHaveBeenCalledWith(
      'user-1',
      'settings_large_payload',
      expect.stringMatching(/^x+$/),
    );
    expect(mocks.readSimpleChatSnapshot).not.toHaveBeenCalled();
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
  });

  it('ignores nested and string-embedded chat keys when routing a large legacy payload', async () => {
    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({
        metadata: { key: 'chat_simple_projects' },
        note: '{"key":"chat_simple_projects"}',
        key: 'settings_large_payload',
        value: 'x'.repeat(SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES),
      }),
      headers: { 'content-type': 'application/json' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, key: 'settings_large_payload' });
    expect(body).not.toHaveProperty('code', 'CHAT_SYNC_PAYLOAD_TOO_LARGE');
    expect(mocks.dbSetUserData).toHaveBeenCalledWith(
      'user-1',
      'settings_large_payload',
      expect.stringMatching(/^x+$/),
    );
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a duplicate chat-then-legacy key without applying the chat error contract', async () => {
    const body = `{"key":"chat_simple_projects","key":"settings_x","value":"${
      'x'.repeat(SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES)
    }"}`;
    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Duplicate key parameter' });
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
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

  it('returns the server canvas mode and ignores a client-supplied mode on POST', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'legacy';
    process.env.WUJIE_CANVAS_KERNEL_MODE = 'shadow';
    mocks.dbGetUserData.mockResolvedValue(projects);
    mocks.executeLegacyCanvasProjectSync.mockResolvedValue({ projects, mappings: {}, revision: 1 });

    const postResponse = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({
        key: 'projects',
        value: projects,
        projectRevision: 0,
        canvasKernelMode: 'canvas-v2',
      }),
      headers: { 'content-type': 'application/json' },
    }));
    const postBody = await postResponse.json();
    expect(postResponse.status).toBe(200);
    expect(postBody).not.toHaveProperty('canvasKernelMode');

    const getResponse = await GET(new NextRequest('http://localhost/api/user-data/sync?key=projects'));
    expect(await getResponse.json()).toMatchObject({
      success: true,
      canvasKernelMode: 'shadow',
    });
  });

  it.each([
    ['legacy', 'legacy'],
    ['shadow', 'shadow'],
    ['react-flow-v2', 'react-flow-v2'],
  ] as const)('clamps server workflow renderer mode %s to %s at the route', async (configured, delivered) => {
    process.env.WUJIE_WORKFLOW_RENDERER_MODE = configured;
    mocks.dbGetUserData.mockResolvedValue(projects);

    const response = await GET(new NextRequest('http://localhost/api/user-data/sync?key=projects'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workflowRendererMode: delivered });
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
      persistMedia?: (value: { dataUrl: string }) => Promise<{
        url: string;
        width?: number;
        height?: number;
        mimeType?: string;
        byteSize?: number;
      }>;
    };
    expect(input.expectedRevision).toBe(0);
    expect(input.persistMedia).toBeTypeOf('function');
    mocks.persistResultImage.mockResolvedValue('/api/serve-upload/uploads/persisted.png');
    await expect(input.persistMedia!({ dataUrl: 'data:image/png;base64,AAAA' }))
      .resolves.toEqual({
        url: '/api/serve-upload/uploads/persisted.png',
        width: 2,
        height: 2,
        mimeType: 'image/png',
        byteSize: 72,
      });
    expect(mocks.inspectCompletedImage).toHaveBeenCalledWith('/api/serve-upload/uploads/persisted.png');

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

  it('executes whole-project deletion reconciliation owner-scoped in the API transaction', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'shadow';
    const sqlEvents: string[] = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      void params;
      sqlEvents.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.includes('SELECT data_value')) {
        return { rows: [{ data_value: JSON.stringify(0) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    mocks.getPool.mockReturnValue({
      connect: vi.fn().mockResolvedValue({ query, release }),
    });
    const actual = await vi.importActual<typeof import('@/lib/asset-core/canvas-project-sync')>(
      '@/lib/asset-core/canvas-project-sync',
    );
    mocks.executeCanvasProjectSync.mockImplementationOnce(actual.executeCanvasProjectSync);

    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({ key: 'projects', value: [], projectRevision: 0 }),
      headers: { 'content-type': 'application/json' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.projectRevision).toBe(1);
    expect(body.assetGraphMappings).toEqual({});
    expect(query.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();

    const placementUpdate = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE wujie_workspace_placements'));
    const assetUpdate = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE wujie_assets'));
    const projectUpdate = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE wujie_projects'));
    expect(placementUpdate?.[1]).toEqual(['user-1', []]);
    expect(projectUpdate?.[1]).toEqual(['user-1', []]);
    expect(String(assetUpdate?.[0])).toContain('NOT EXISTS');
    expect(assetUpdate?.[1]).toEqual(['user-1', []]);
    expect(sqlEvents).toEqual(expect.arrayContaining([
      'UPDATE wujie_workspace_placements SET',
      'UPDATE wujie_assets asset',
      'UPDATE wujie_projects SET',
    ]));
    expect(query.mock.calls.some(([sql]) => /DELETE\s+FROM|wujie_asset_versions/i.test(String(sql)))).toBe(false);
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('rolls back the API transaction when whole-project asset reconciliation fails', async () => {
    process.env.WUJIE_ASSET_GRAPH_MODE = 'shadow';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT data_value')) {
        return { rows: [{ data_value: JSON.stringify(0) }], rowCount: 1 };
      }
      if (sql.includes('UPDATE wujie_assets')) throw new Error('asset reconciliation failed');
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    mocks.getPool.mockReturnValue({
      connect: vi.fn().mockResolvedValue({ query, release }),
    });
    const actual = await vi.importActual<typeof import('@/lib/asset-core/canvas-project-sync')>(
      '@/lib/asset-core/canvas-project-sync',
    );
    mocks.executeCanvasProjectSync.mockImplementationOnce(actual.executeCanvasProjectSync);

    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({ key: 'projects', value: [], projectRevision: 0 }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: 'asset reconciliation failed' });
    expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });
});
