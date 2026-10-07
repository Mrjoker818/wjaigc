import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { AgentContextStorage, AuthorizeAgentContextInput } from '@/lib/agent-runtime/context-adapters';
vi.mock('server-only', () => ({}));
const videoSource = vi.hoisted(() => ({ url: '/clip.mp4' }));
vi.mock('@/lib/db-client', () => ({ getPool: () => ({ query: async (sql: string) => ({ rows:
  sql.includes('actor.status AS actor_status') ? [{ actor_status: 'active', owner_id: 'actor-a', status: 'active', owner_status: 'active', enabled: true, has_document: true }]
    : sql.includes('to_jsonb(v)') ? [{ id: 'video-version', version: { file_url: '/clip.mp4', mime_type: 'video/mp4' },
      asset: { id: 'video-asset', current_version_id: 'video-version' } }] : [], rowCount: 1 }) }) }));
vi.mock('@/lib/collaboration/document-project-bridge', () => ({ readCollaborativeProject: async () => ({
  projectId: 'project-a', ownerId: 'actor-a', readOnly: false, sequence: 1,
  projection: { placements: { 'video-placement': { assetVersionId: 'video-version', deleted: false } } },
  canvasImages: [{ id: 'video-entity', assetId: 'video-asset', assetVersionId: 'video-version', placementId: 'video-placement',
    mediaType: 'video', mediaAvailability: 'ready', url: '/thumbnail.jpg', videoUrl: videoSource.url }],
}) }));
vi.mock('@/lib/agent-runtime/context-adapters', async original => {
  const actual = await original<typeof import('@/lib/agent-runtime/context-adapters')>();
  const storage: AgentContextStorage = { transaction: async callback => callback({
    authorizeProject: async () => ({ kind: 'document', actorUserId: 'actor-a', ownerId: 'actor-a', projectId: 'project-a', grantGeneration: '0' }),
    findProject: async () => true,
    findVersion: async () => ({ id: 'video-version', assetId: 'video-asset', file: { url: '/clip.mp4', mimeType: 'video/mp4', availability: 'ready' } }),
    findAsset: async () => ({ id: 'video-asset', kind: 'video' }),
    findVersionPlacement: async () => ({ id: 'video-placement', assetVersionId: 'video-version' }),
  }) };
  return { ...actual, authorizeAgentContext: (input: AuthorizeAgentContextInput) => actual.authorizeAgentContext({ ...input, storage }) };
});
import { prepareCanvasTaskPublicationInTransaction, persistCanvasTaskPublicationInTransaction } from '@/lib/collaboration/task-publication';
import { prepareVideoCanvasPublication } from '@/lib/video-document-admission';

afterEach(() => { vi.unstubAllEnvs(); });
describe('actual canonical video publication admission', () => {
  it('admits a real video parent URL rather than the thumbnail through the document resolver', async () => {
    const publication = await prepareVideoCanvasPublication({ kind: 'document', actorUserId: 'actor-a', ownerId: 'actor-a',
      projectId: 'project-a', grantGeneration: '0' }, { assetWorkspace: 'canvas', assetWorkspaceId: 'project-a',
      videoUrl: '/clip.mp4', assetParentVersionIds: ['video-version'], assetSelectedEntityIds: ['video-entity'] },
    'http://localhost', 'video-extend');
    expect(publication?.singleAdmission).toBe('video-extend');
    expect(publication?.ordinarySourceSnapshot?.[0]?.versionId).toBe('video-version');
  });
  it('rejects a tampered thumbnail URL for the canonical video parent', async () => {
    await expect(prepareVideoCanvasPublication({ kind: 'document', actorUserId: 'actor-a', ownerId: 'actor-a',
      projectId: 'project-a', grantGeneration: '0' }, { assetWorkspace: 'canvas', assetWorkspaceId: 'project-a',
      videoUrl: '/thumbnail.jpg', assetParentVersionIds: ['video-version'], assetSelectedEntityIds: ['video-entity'] },
    'http://localhost', 'video-extend')).rejects.toMatchObject({ status: 403, code: 'CANVAS_VIDEO_SOURCE_MISMATCH' });
  });
  it.each([{ referenceImages: [7] }, { characterReferences: [{ url: '/foreign.png' }] }, { imageUrl: 7 }])(
    'rejects non-string provider inputs instead of dropping them from source authorization', async malformed => {
      await expect(prepareVideoCanvasPublication({ kind: 'document', actorUserId: 'actor-a', ownerId: 'actor-a',
        projectId: 'project-a', grantGeneration: '0' }, { ...malformed, assetWorkspace: 'canvas', assetWorkspaceId: 'project-a' },
      'http://localhost', 'video')).rejects.toMatchObject({ status: 400 });
    });
  it.each(['video', 'video-extend'])('freezes %s actor/project/intent through the existing transaction', async type => {
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT p.owner_id')) return { rows: [{ owner_id: 'actor-a' }], rowCount: 1 };
      if (sql.includes('SELECT enabled')) return { rows: [{ enabled: true }], rowCount: 1 };
      if (sql.includes('SELECT user_id,project_id,type,idempotency_key,request_digest')) return { rows: [{ user_id: 'actor-a', project_id: 'project-a', type, idempotency_key: 'video-key', request_digest: 'a'.repeat(64) }], rowCount: 1 };
      if (sql.includes('SELECT projection')) return { rows: [{ projection: { placements: {} } }], rowCount: 1 };
      if (sql.includes('wujie_workspace_placements') || sql.includes('SELECT v.id')) return { rows: [], rowCount: 0 };
      if (sql.includes('wujie_project_canvas_documents')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('INSERT INTO wujie_canvas_task_publications')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('SELECT 1 FROM wujie_canvas_task_publications')) return { rows: [{}], rowCount: 1 };
      throw new Error('Unexpected SQL boundary: ' + sql);
    });
    const client = { query } as unknown as PoolClient;
    const input = { actorUserId: 'actor-a', projectId: 'project-a',
      publication: { access: { kind: 'document', actorUserId: 'actor-a', ownerId: 'actor-a', projectId: 'project-a', grantGeneration: '0' },
        workspace: 'canvas', workspaceId: 'project-a', singleAdmission: type,
        intent: { parentVersionIds: [], projectionMode: 'derived', placement: { action: 'append', selectedEntityIds: [] } } },
      singleTaskIdentity: { type, idempotencyKey: 'video-key', requestDigest: 'a'.repeat(64) } };
    const prepared = await prepareCanvasTaskPublicationInTransaction(client,
      input as unknown as Parameters<typeof prepareCanvasTaskPublicationInTransaction>[1]);
    await persistCanvasTaskPublicationInTransaction(client, { taskId: 'video-task', publication: prepared });
    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO wujie_canvas_task_publications'));
    expect(insert).toBeDefined();
  });
});
