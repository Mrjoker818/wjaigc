import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollaborativeProjectRead } from '@/lib/collaboration/document-project-bridge';
import type { SimpleChatStoredSnapshot } from '@/lib/simple-chat-sync-server';

const mocks = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn(), snapshot: vi.fn(),
  findProject: vi.fn(), resolveVersionProject: vi.fn(), findPlacement: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({ getPool: () => ({ query: mocks.query }) }));
vi.mock('@/lib/collaboration/document-project-bridge', () => ({ readCollaborativeProject: mocks.read }));
vi.mock('@/lib/simple-chat-sync-server', () => ({ readSimpleChatSnapshot: mocks.snapshot }));
vi.mock('@/lib/asset-core/storage', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/asset-core/storage')>(),
  createPostgresAssetStorage: () => ({ read: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
    findProject: mocks.findProject, resolveVersionProject: mocks.resolveVersionProject, findPlacement: mocks.findPlacement,
  }) }),
}));

import { resolveSimpleChatWorkspaceHandoff } from '@/lib/simple-chat-workspace-handoff-server';

const input = { actorUserId: 'editor', targetProjectId: 'shared', chatProjectId: 'my-chat',
  chatTaskId: 'my-task', chatMessageId: 'my-message' };
const snapshot: SimpleChatStoredSnapshot = { schemaVersion: 1, revision: 1, projects: [{
  id: 'my-chat', name: 'Private chat', createdAt: 1, updatedAt: 1, agents: [], knowledgeItems: [], tasks: [{
    id: 'my-task', projectId: 'my-chat', name: 'My task', model: 'model', providerId: 'provider', createdAt: 1, updatedAt: 1,
    messages: [{ id: 'my-message', role: 'assistant', content: 'My private message', createdAt: 1,
      images: ['/old-snapshot.png'], imageRefs: [{ url: '/old-snapshot.png', assetVersionId: 'version', placementId: 'placement' }],
    }],
  }],
}] };

describe('actual document handoff dependency wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ actor_status: 'active', owner_id: 'owner', status: 'active',
      owner_status: 'active', enabled: true, has_document: true }] });
    mocks.read.mockResolvedValue({ projectId: 'shared', ownerId: 'owner', sequence: 1, readOnly: true,
      projection: { placements: { placement: { assetVersionId: 'version', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1 } } },
      canvasImages: [{ id: 'entity', assetId: 'asset', assetVersionId: 'version', placementId: 'placement',
        url: '/canonical.png', mediaAvailability: 'ready', x: 0, y: 0, width: 10, height: 10,
        originalWidth: 10, originalHeight: 10, rotation: 0, zIndex: 1, createdAt: 1 }],
      workspace: { id: 'shared', userId: 'owner', name: 'Shared', createdAt: 1, updatedAt: 1, canvasImages: [], settings: {} },
    } satisfies CollaborativeProjectRead);
    mocks.snapshot.mockResolvedValue(snapshot);
    mocks.resolveVersionProject.mockResolvedValue(null);
  });

  it('allows an authorized editor target and resolves shared media without reading the owner chat/private placements', async () => {
    const result = await resolveSimpleChatWorkspaceHandoff(input);
    expect(result.images[0].assetRef.url).toBe('/canonical.png');
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith('editor');
    expect(mocks.read.mock.calls).toEqual([['editor', 'shared'], ['editor', 'shared'], ['editor', 'shared']]);
    expect(mocks.resolveVersionProject).toHaveBeenCalledExactlyOnceWith('editor', 'version');
    expect(mocks.findProject).not.toHaveBeenCalled();
    expect(mocks.findPlacement).not.toHaveBeenCalled();
  });

  it('refuses target revocation before reading any chat snapshot', async () => {
    mocks.read.mockRejectedValue(Object.assign(new Error('revoked'), { code: 'DOCUMENT_FORBIDDEN' }));
    await expect(resolveSimpleChatWorkspaceHandoff(input)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it('rechecks target authorization after all snapshot/media awaits and preserves the actor scope', async () => {
    const allowed = await mocks.read();
    mocks.read.mockClear().mockResolvedValueOnce(allowed).mockResolvedValueOnce(allowed)
      .mockRejectedValueOnce(Object.assign(new Error('revoked after media'), { code: 'DOCUMENT_FORBIDDEN' }));
    await expect(resolveSimpleChatWorkspaceHandoff(input)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith('editor');
  });

  it('cannot substitute the owner snapshot when the actor chat source is absent', async () => {
    mocks.snapshot.mockResolvedValue({ schemaVersion: 1, revision: 1, projects: [] });
    await expect(resolveSimpleChatWorkspaceHandoff(input)).rejects.toMatchObject({ code: 'HANDOFF_SOURCE_NOT_FOUND', status: 404 });
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith('editor');
    expect(mocks.resolveVersionProject).not.toHaveBeenCalled();
  });
});
