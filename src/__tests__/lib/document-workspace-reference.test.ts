import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollaborativeProjectRead } from '@/lib/collaboration/document-project-bridge';

const mocks = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn(), connect: vi.fn(),
  clientQuery: vi.fn(), release: vi.fn(), transaction: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({ getPool: () => ({ query: mocks.query, connect: mocks.connect }) }));
vi.mock('@/lib/asset-core/storage', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/asset-core/storage')>(),
  createAssetStorageTransaction: mocks.transaction,
}));
vi.mock('@/lib/collaboration/document-project-bridge', () => ({
  readCollaborativeProject: mocks.read,
}));

import { resolveDocumentWorkspaceReference, resolvePersonalWorkspaceReference } from '@/lib/collaboration/document-workspace-reference';

const input = { projectId: 'shared', assetVersionId: 'version-1', placementId: 'placement-1' };
function canonical(): CollaborativeProjectRead {
  return {
    projectId: 'shared', ownerId: 'owner', sequence: 5, readOnly: true,
    projection: { placements: { 'placement-1': {
      assetVersionId: 'version-1', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1,
    } } },
    canvasImages: [{
      id: 'entity-1', assetId: 'asset-1', placementId: 'placement-1', assetVersionId: 'version-1',
      url: '/canonical.png', mediaAvailability: 'ready', x: 0, y: 0, width: 10, height: 10,
      originalWidth: 10, originalHeight: 10, rotation: 0, zIndex: 1, createdAt: 1,
    }],
    workspace: { id: 'shared', userId: 'owner', name: 'Shared', createdAt: 1, updatedAt: 1, canvasImages: [], settings: {} },
  };
}

describe('document workspace reference authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ actor_status: 'active', owner_id: 'owner',
      status: 'active', owner_status: 'active', enabled: true, has_document: true }] });
    mocks.read.mockResolvedValue(canonical());
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
  });

  it('reads personal assets through the existing service while holding the enable revision fence', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => ({ rows: sql.includes('has_document')
      ? [{ actor_status: 'active', owner_id: 'editor', status: 'active', owner_status: 'active',
          enabled: false, has_document: false }] : [] }));
    const findVersion = vi.fn().mockResolvedValue({ id: 'version-1', assetId: 'asset-1', file: { url: '/private.png' } });
    mocks.transaction.mockReturnValue({ findProject: vi.fn().mockResolvedValue(true), findVersion,
      findAsset: vi.fn().mockResolvedValue({ kind: 'image' }),
      findPlacement: vi.fn().mockResolvedValue({ id: 'placement-1', entityId: 'entity-1', assetVersionId: 'version-1', status: 'active' }),
    });
    await expect(resolvePersonalWorkspaceReference('editor', input)).resolves.toMatchObject({ url: '/private.png' });
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock_shared(hashtext($1), hashtext($2))', ['editor', '__asset_graph_projects_revision']);
    expect(findVersion).toHaveBeenCalledWith('editor', 'shared', 'version-1');
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rejects concurrent enable before any personal graph lookup and rolls back/releases', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => ({ rows: sql.includes('has_document')
      ? [{ actor_status: 'active', owner_id: 'editor', status: 'active', owner_status: 'active',
          enabled: true, has_document: true }] : [] }));
    await expect(resolvePersonalWorkspaceReference('editor', input))
      .rejects.toMatchObject({ code: 'ASSET_REFERENCE_AUTHORITY_CHANGED', status: 409 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('binds only the opt-in workflow input through the same fenced client and returns its placement', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => ({ rows: sql.includes('has_document')
      ? [{ actor_status: 'active', owner_id: 'editor', status: 'active', owner_status: 'active', enabled: false, has_document: false }] : [] }));
    const workflowPlacement = { id: 'workflow-placement', entityId: 'node-1', assetVersionId: 'version-1', status: 'active' };
    const lockSlot = vi.fn();
    mocks.transaction.mockReturnValue({ findProject: vi.fn().mockResolvedValue(true),
      findVersion: vi.fn().mockResolvedValue({ id: 'version-1', assetId: 'asset-1', file: { url: '/private.png' } }),
      findAsset: vi.fn().mockResolvedValue({ kind: 'image' }),
      findPlacement: vi.fn().mockResolvedValue({ id: 'placement-1', entityId: 'entity-1', assetVersionId: 'version-1', status: 'active' }),
      lockWorkspacePlacementSlot: lockSlot, lockAsset: vi.fn().mockResolvedValue({ status: 'active' }),
      findActivePlacement: vi.fn().mockResolvedValue(workflowPlacement), lockPlacement: vi.fn().mockResolvedValue(workflowPlacement),
    });
    await expect(resolvePersonalWorkspaceReference('editor', input, { workspaceId: 'workflow-1', entityId: 'node-1' }))
      .resolves.toMatchObject({ url: '/private.png', placementId: 'workflow-placement', entityId: 'node-1' });
    expect(lockSlot).toHaveBeenCalledExactlyOnceWith('editor', 'shared', 'workflow', 'workflow-1', 'workflow-input', 'node-1');
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ query: mocks.clientQuery }));
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('does not opt into arbitrary or empty workflow binding identities', async () => {
    await expect(resolvePersonalWorkspaceReference('editor', input, { workspaceId: '', entityId: 'node' }))
      .rejects.toMatchObject({ code: 'ASSET_REQUEST_INVALID', status: 400 });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('reads the exact active canonical tuple as actor, including global read-only mode', async () => {
    const reference = await resolveDocumentWorkspaceReference('editor', input);
    expect(reference).toEqual({ assetId: 'asset-1', assetVersionId: 'version-1',
      placementId: 'placement-1', entityId: 'entity-1', kind: 'image', url: '/canonical.png' });
    expect(mocks.read).toHaveBeenCalledWith('editor', 'shared');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('has_document'), ['editor', 'shared']);
  });

  it('returns null for an explicitly personal owner project even with an empty tuple', async () => {
    mocks.query.mockResolvedValue({ rows: [{ actor_status: 'active', owner_id: 'editor',
      status: 'active', owner_status: 'active', enabled: false, has_document: false }] });
    await expect(resolveDocumentWorkspaceReference('editor', {
      projectId: 'personal', assetVersionId: '', placementId: '',
    })).resolves.toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('keeps absent graph rows personal but leaves actor-owned legacy validation to the personal service', async () => {
    mocks.query.mockResolvedValue({ rows: [{ actor_status: 'active', owner_id: null,
      status: null, owner_status: null, enabled: null, has_document: false }] });
    await expect(resolveDocumentWorkspaceReference('editor', {
      projectId: 'legacy', assetVersionId: '', placementId: '',
    })).resolves.toBeNull();
  });

  it.each([
    { assetVersionId: '', placementId: '' },
    { assetVersionId: 'version-1', placementId: undefined },
  ])('rejects a document URL-only or placement-less request without a private fallback: %j', async (tuple) => {
    await expect(resolveDocumentWorkspaceReference('editor', { projectId: 'shared', ...tuple }))
      .rejects.toMatchObject({ code: 'ASSET_REQUEST_INVALID', status: 400 });
  });

  it.each(['deleted', 'old-version', 'missing-image', 'pending', 'wrong-project', 'duplicate'])
    ('rejects canonical %s instead of returning a surviving private graph version', async (failure) => {
      const read = canonical();
      if (failure === 'deleted') read.projection.placements['placement-1'].deleted = true;
      if (failure === 'old-version') read.projection.placements['placement-1'].assetVersionId = 'new-version';
      if (failure === 'missing-image') read.canvasImages = [];
      if (failure === 'pending') read.canvasImages[0].mediaAvailability = 'pending-persist';
      if (failure === 'wrong-project') read.projectId = 'other';
      if (failure === 'duplicate') read.canvasImages.push({ ...read.canvasImages[0] });
      mocks.read.mockResolvedValue(read);
      await expect(resolveDocumentWorkspaceReference('editor', input))
        .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND', status: 404 });
    });

  it('uses the canonical video file rather than its poster', async () => {
    const read = canonical();
    Object.assign(read.canvasImages[0], { mediaType: 'video', videoUrl: '/canonical.mp4', url: '/poster.png' });
    mocks.read.mockResolvedValue(read);
    await expect(resolveDocumentWorkspaceReference('editor', input))
      .resolves.toMatchObject({ kind: 'video', url: '/canonical.mp4' });
  });

  it('does not turn revoked authorization into null', async () => {
    mocks.read.mockRejectedValue(Object.assign(new Error('revoked'), { code: 'DOCUMENT_FORBIDDEN' }));
    await expect(resolveDocumentWorkspaceReference('editor', input))
      .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN', status: 403 });
  });

  it('does not downgrade a closed document to personal', async () => {
    mocks.query.mockResolvedValue({ rows: [{ actor_status: 'active', owner_id: 'owner',
      status: 'active', owner_status: 'active', enabled: false, has_document: true }] });
    mocks.read.mockRejectedValue(Object.assign(new Error('closed'), { code: 'DOCUMENT_PROJECT_NOT_ENABLED' }));
    await expect(resolveDocumentWorkspaceReference('editor', input)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects foreign personal projects and database errors instead of authorizing owner reads', async () => {
    mocks.query.mockResolvedValue({ rows: [{ actor_status: 'active', owner_id: 'other',
      status: 'active', owner_status: 'active', enabled: false, has_document: false }] });
    await expect(resolveDocumentWorkspaceReference('editor', input)).rejects.toMatchObject({ status: 403 });
    mocks.query.mockRejectedValue(new Error('sensitive database detail'));
    await expect(resolveDocumentWorkspaceReference('editor', input))
      .rejects.toMatchObject({ code: 'ASSET_REFERENCE_UNAVAILABLE', status: 503 });
  });
});
