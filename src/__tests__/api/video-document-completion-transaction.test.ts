import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), complete: vi.fn(), refund: vi.fn(), durable: vi.fn(),
  access: vi.fn(), intent: vi.fn(), editor: vi.fn(), enabled: vi.fn(), sources: vi.fn(), placements: vi.fn(),
}));
vi.mock('@/lib/db-client', () => ({ getPool: () => ({ connect: async () => ({ query: state.query, release: state.release }) }) }));
vi.mock('@/lib/cloud-task-storage', () => ({ ensureCloudTaskTables: async () => undefined,
  completeCloudTask: state.complete, terminateCloudTaskAndRefund: state.refund, getCloudTaskById: state.durable }));
vi.mock('@/lib/collaboration/task-publication-access', () => ({
  readTaskPublicationAccess: state.access, readTaskPublicationIntent: state.intent,
}));
vi.mock('@/lib/collaboration/document-access', async original => ({
  ...await original<typeof import('@/lib/collaboration/document-access')>(),
  assertDocumentEditor: state.editor, assertDocumentProjectEnabled: state.enabled,
}));
vi.mock('@/lib/collaboration/task-publication', async original => ({
  ...await original<typeof import('@/lib/collaboration/task-publication')>(), readOrdinaryPublicationSourceSnapshot: state.sources,
}));
vi.mock('@/lib/collaboration/task-publication-intent', async original => ({
  ...await original<typeof import('@/lib/collaboration/task-publication-intent')>(), validateCanvasBatchSources: state.placements,
}));
import { completeDocumentVideoTask, VideoCompletionUnknownError } from '@/lib/video-document-admission';
import { DocumentAccessError } from '@/lib/collaboration/document-access';

const source = [{ versionId: 'version-a', fingerprint: 'a'.repeat(64), assetId: 'asset-a', assetCurrentVersionId: 'version-a' }];
const access = { taskId: 'video-a', actorId: 'editor', ownerId: 'owner', projectId: 'project', workspaceId: 'project', grantGeneration: '1' };
const intent = { version: 1, parentVersionIds: ['version-a'], projectionMode: 'derived',
  selectionSnapshot: [{ entityId: 'entity-a', placementId: 'placement-a', assetVersionId: 'version-a' }],
  placement: { action: 'attach', transform: { x: 10, y: 10, width: 20, height: 20, rotation: 0, zIndex: 1 }, strideX: 52 } };
const row = { id: 'video-a', user_id: 'editor', project_id: 'project', type: 'video', status: 'processing',
  lease_owner: 'worker-a', attempt_count: 2, deadline_valid: true,
  result: { submissionPayload: { videoCanvasAdmission: {
    singleAdmission: 'video', workspace: 'canvas', workspaceId: 'project',
    access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'project', grantGeneration: '1' },
    intent: { parentVersionIds: ['version-a'] }, ordinarySourceSnapshot: source,
  } } } };
const output = { videoUrl: '/api/serve-upload/video/video-a/result.mp4', model: 'model-a' };
beforeEach(() => {
  vi.resetAllMocks();
  state.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT id,') ? [structuredClone(row)] : [], rowCount: 1 }));
  state.complete.mockResolvedValue(true);
  state.refund.mockResolvedValue({ transitioned: true, refunded: true });
  state.access.mockResolvedValue(access);
  state.intent.mockResolvedValue(intent);
  state.editor.mockResolvedValue({ ownerId: 'owner' });
  state.enabled.mockResolvedValue(undefined);
  state.sources.mockResolvedValue(source);
  state.placements.mockResolvedValue(undefined);
});

describe('document video short completion transaction', () => {
  it('commits completion under the same task, grant and source locks', async () => {
    expect(await completeDocumentVideoTask('video-a', output, 'worker-a')).toBe(true);
    expect(state.complete).toHaveBeenCalledExactlyOnceWith('video-a', output, {
      leaseOwner: 'worker-a', client: expect.objectContaining({ query: state.query }),
    });
    expect(state.refund).not.toHaveBeenCalled();
    expect(state.query.mock.calls[0][0]).toBe('BEGIN');
    expect(state.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(state.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(state.release).toHaveBeenCalledWith(false);
  });
  it('uses the existing refund in the same transaction when the frozen grant is revoked', async () => {
    state.editor.mockRejectedValue(new DocumentAccessError());
    expect(await completeDocumentVideoTask('video-a', output, 'worker-a')).toBe(false);
    expect(state.complete).not.toHaveBeenCalled();
    expect(state.refund).toHaveBeenCalledExactlyOnceWith('video-a', 'failed', 'CANVAS_VIDEO_COMPLETION_FORBIDDEN', 'worker-a',
      { client: expect.objectContaining({ query: state.query }), requireActive: true });
    expect(state.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('reconciles a lost COMMIT reply without refunding a durably completed video', async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') throw new Error('Lost COMMIT reply');
      return { rows: sql.startsWith('SELECT id,') ? [structuredClone(row)] : [], rowCount: 1 };
    });
    state.durable.mockResolvedValue({ status: 'completed', result: output });
    expect(await completeDocumentVideoTask('video-a', output)).toBe(true);
    expect(state.refund).not.toHaveBeenCalled();
    expect(state.query.mock.calls.some(call => call[0] === 'ROLLBACK')).toBe(false);
    expect(state.release).toHaveBeenCalledWith(true);
  });
  it('leaves an unprovable COMMIT unknown, never refunds or rolls back after dispatch', async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') throw new Error('Lost COMMIT reply');
      return { rows: sql.startsWith('SELECT id,') ? [structuredClone(row)] : [], rowCount: 1 };
    });
    state.durable.mockRejectedValue(new Error('Database unavailable'));
    await expect(completeDocumentVideoTask('video-a', output)).rejects.toBeInstanceOf(VideoCompletionUnknownError);
    expect(state.refund).not.toHaveBeenCalled();
    expect(state.query.mock.calls.some(call => call[0] === 'ROLLBACK')).toBe(false);
    expect(state.release).toHaveBeenCalledWith(true);
  });
  it('rolls back an authorization read outage without treating it as a known denial', async () => {
    state.access.mockRejectedValue(new Error('Publication read unavailable'));
    await expect(completeDocumentVideoTask('video-a', output)).rejects.toThrow('Publication read unavailable');
    expect(state.complete).not.toHaveBeenCalled();
    expect(state.refund).not.toHaveBeenCalled();
    expect(state.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it.each([{ lease_owner: 'new-worker' }, { deadline_valid: false }])('does not settle a stale completion worker (%j)', async changed => {
    state.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT id,') ? [{ ...structuredClone(row), ...changed }] : [], rowCount: 1 }));
    expect(await completeDocumentVideoTask('video-a', output, { leaseOwner: 'worker-a', deadlineAt: 123 })).toBe(false);
    expect(state.editor).not.toHaveBeenCalled();
    expect(state.complete).not.toHaveBeenCalled();
    expect(state.refund).not.toHaveBeenCalled();
  });
});
