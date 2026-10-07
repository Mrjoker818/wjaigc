import { afterEach, describe, expect, it, vi } from 'vitest';
import { actualNodeBeforeChatNavigation, actualTransferCallback, contractDeferred } from '../helpers/canvas-chat-transfer-contract-fixture';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { SimpleChatWorkflowTransferRequest } from '@/lib/simple-chat-workspace-handoff-client';
import { createSimpleChatWorkspaceHandoffProjectQueue } from '@/lib/simple-chat-workspace-handoff-client';
import type { Workflow } from '@/lib/workflow-engine';
import { workflowFromProjectMetadata } from '@/lib/project-workflow';
import { createSimpleChatImportWorkflow } from '@/lib/simple-chat-workspace-handoff';

const reference: WorkspaceAssetReference = { url: '/canonical.png', kind: 'image', assetId: 'asset',
  assetVersionId: 'version', placementId: 'placement', entityId: 'image' };
const request: SimpleChatWorkflowTransferRequest = { sourceVersion: 'version', targetProject: 'shared',
  targetWorkspace: 'workflow', entityType: 'workflow-input', entityId: 'node', idempotencyKey: 'key',
  metadata: { imageIndex: 0, sourceTrace: { source: 'simple-chat', chatProjectId: 'chat', chatTaskId: 'task', messageId: 'message', createdAt: '2026-10-07T14:00:00Z' }, name: 'image' } };
afterEach(() => vi.unstubAllGlobals());
function navigationFixture(nodeWorkflowRef: { current: Workflow | null }, saveNodeWorkflowForProject: (workflow: Workflow) => Promise<void>, flush: () => Promise<void>): {
  before: (reference: WorkspaceAssetReference) => Promise<void>; actor: { current: { id: string } }; refreshMedia: ReturnType<typeof vi.fn>;
  authority: { current: { projectId: string; authority: string; isWritable: () => boolean; isSessionActive: () => boolean; refreshMedia: ReturnType<typeof vi.fn> } };
  bindings: Record<string, unknown>;
} {
  const actor = { current: { id: 'editor' } };
  const refreshMedia = vi.fn().mockResolvedValue([reference]);
  const bindings = { nodeWorkflowRef, saveNodeWorkflowForProject, canvasPersistenceScheduler: { flush },
    currentProjectRef: { current: { id: 'shared' } }, currentUserRef: actor,
    collaborativeCanvasRef: { current: { projectId: 'shared', authority: 'document', isWritable: (): boolean => true,
      isSessionActive: (): boolean => true, refreshMedia } },
    historyTransitionEpochRef: { current: 1 },
  };
  const before = actualNodeBeforeChatNavigation({ ...bindings,
    prepareWorkflowChatNavigation: (input: WorkspaceAssetReference): Promise<void> => (
      actualTransferCallback<(input: WorkspaceAssetReference) => Promise<void>>('prepareWorkflowChatNavigation', bindings)(input)
    ),
  });
  return { before, actor, refreshMedia, authority: bindings.collaborativeCanvasRef, bindings };
}
describe('actual document node handoff entry', () => {
  it('saves the current actor workflow before chat navigation without a legacy canvas flush', async () => {
    const workflow = createSimpleChatImportWorkflow('shared', 2);
    const saveNodeWorkflowForProject = vi.fn().mockResolvedValue(undefined);
    const flush = vi.fn().mockRejectedValue(new Error('Document authority refuses legacy snapshots'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(reference)));
    const { before } = navigationFixture({ current: workflow }, saveNodeWorkflowForProject, flush);
    await before(reference);
    expect(saveNodeWorkflowForProject).toHaveBeenCalledExactlyOnceWith(workflow, expect.any(Function));
    expect(flush).not.toHaveBeenCalled();
  });
  it('refuses chat navigation if the current workflow is missing or its guarded save fails', async () => {
    const nodeWorkflowRef: { current: Workflow | null } = { current: null };
    const saveNodeWorkflowForProject = vi.fn().mockRejectedValue(new Error('HANDOFF_SCOPE_CHANGED'));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json(reference))));
    const { before } = navigationFixture(nodeWorkflowRef, saveNodeWorkflowForProject, vi.fn().mockResolvedValue(undefined));
    await expect(before(reference)).rejects.toThrow('当前工作流不存在');
    expect(saveNodeWorkflowForProject).not.toHaveBeenCalled();
    nodeWorkflowRef.current = createSimpleChatImportWorkflow('shared', 2);
    await expect(before(reference)).rejects.toThrow('HANDOFF_SCOPE_CHANGED');
  });
  it('does not save or navigate for an unconfirmed document output tuple', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const fixture = navigationFixture({ current: createSimpleChatImportWorkflow('shared', 2) }, save, vi.fn().mockResolvedValue(undefined));
    fixture.refreshMedia.mockResolvedValue([{ ...reference, placementId: 'different-placement' }]);
    await expect(fixture.before(reference)).rejects.toThrow('工作流输出尚未在协作文档中确认');
    expect(save).not.toHaveBeenCalled();
  });
  it('does not save or navigate after the actor changes during the canonical read', async () => {
    const pending = contractDeferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => pending.promise));
    const save = vi.fn().mockResolvedValue(undefined);
    const fixture = navigationFixture({ current: createSimpleChatImportWorkflow('shared', 2) }, save, vi.fn().mockResolvedValue(undefined));
    const operation = fixture.before(reference);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    fixture.actor.current = { id: 'different-actor' };
    pending.release(Response.json(reference));
    await expect(operation).rejects.toThrow('HANDOFF_SCOPE_CHANGED');
    expect(save).not.toHaveBeenCalled();
  });
  it.each([
    { ...reference, assetVersionId: 'other-version' },
    { ...reference, placementId: 'other-placement' },
    { ...reference, url: '/unconfirmed.png' },
  ])('rejects a canonical read that changes the document tuple (%j)', async returned => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(returned)));
    const save = vi.fn().mockResolvedValue(undefined);
    const fixture = navigationFixture({ current: createSimpleChatImportWorkflow('shared', 2) }, save, vi.fn());
    await expect(fixture.before(reference)).rejects.toThrow('工作流输出尚未在协作文档中确认');
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects a denied canonical read without saving the workflow', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'DOCUMENT_FORBIDDEN' }, { status: 403 })));
    const save = vi.fn().mockResolvedValue(undefined);
    const fixture = navigationFixture({ current: createSimpleChatImportWorkflow('shared', 2) }, save, vi.fn());
    await expect(fixture.before(reference)).rejects.toThrow('工作流输出尚未在协作文档中确认');
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects permission revocation while refreshing document media', async () => {
    const pending = contractDeferred<WorkspaceAssetReference[]>();
    const save = vi.fn().mockResolvedValue(undefined);
    const fixture = navigationFixture({ current: createSimpleChatImportWorkflow('shared', 2) }, save, vi.fn());
    fixture.refreshMedia.mockReturnValue(pending.promise);
    const operation = fixture.before(reference);
    fixture.authority.current.isWritable = (): boolean => false;
    pending.release([reference]);
    await expect(operation).rejects.toThrow('HANDOFF_SCOPE_CHANGED');
    expect(save).not.toHaveBeenCalled();
  });
  it('refreshes incomplete document media before requiring a writable projection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(reference)));
    const save = vi.fn().mockResolvedValue(undefined);
    const fixture = navigationFixture({ current: createSimpleChatImportWorkflow('shared', 2) }, save, vi.fn());
    fixture.authority.current.isWritable = (): boolean => false;
    fixture.refreshMedia.mockImplementation(async (): Promise<WorkspaceAssetReference[]> => {
      fixture.authority.current.isWritable = (): boolean => true;
      return [reference];
    });
    await fixture.before(reference);
    expect(fixture.refreshMedia).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
  });
  it('does not override an explicitly inactive session with a writable projection', async () => {
    const save = vi.fn();
    const fixture = navigationFixture({ current: createSimpleChatImportWorkflow('shared', 2) }, save, vi.fn());
    fixture.authority.current.isSessionActive = (): boolean => false;
    await expect(fixture.before(reference)).rejects.toThrow('HANDOFF_SCOPE_CHANGED');
    expect(fixture.refreshMedia).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('rechecks captured document scope inside the real workflow save queue before writing', async () => {
    const queue = createSimpleChatWorkspaceHandoffProjectQueue();
    const blocked = contractDeferred<void>();
    const first = queue.enqueue('shared', () => blocked.promise);
    const fetcher = vi.fn(async (url: string | URL | Request): Promise<Response> => (
      Response.json(url === '/api/assets' ? reference : { success: true })
    ));
    vi.stubGlobal('fetch', fetcher);
    const fixture = navigationFixture({ current: createSimpleChatImportWorkflow('shared', 2) }, vi.fn(), vi.fn());
    fixture.bindings.handoffProjectQueueRef = { current: queue };
    fixture.bindings.persistNodeWorkflow = actualTransferCallback('persistNodeWorkflow', fixture.bindings);
    const queuedSave = vi.fn(actualTransferCallback<(workflow: Workflow, beforePersist?: () => void) => Promise<void>>(
      'saveNodeWorkflowForProject', Object.fromEntries(Object.entries(fixture.bindings)
        .filter(([key]) => key !== 'saveNodeWorkflowForProject'))));
    fixture.bindings.saveNodeWorkflowForProject = queuedSave;
    const operation = fixture.before(reference);
    const rejected = expect(operation).rejects.toThrow('HANDOFF_SCOPE_CHANGED');
    await vi.waitFor(() => expect(queuedSave).toHaveBeenCalledOnce());
    fixture.authority.current.isWritable = (): boolean => false;
    blocked.release();
    await first;
    await rejected;
    expect(fetcher.mock.calls.some(([url]) => url === '/api/workflow/save')).toBe(false);
  });
  it('reads the same shared placement rather than copying into personal assets', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(reference));
    vi.stubGlobal('fetch', fetcher);
    const transfer = actualTransferCallback<(request: SimpleChatWorkflowTransferRequest, scope: unknown) => Promise<WorkspaceAssetReference>>('transferSimpleChatImageToWorkflow', {});
    const result = await transfer(request, { documentReference: reference, expectedActorUserId: 'editor', isCurrent: () => true });
    expect(result).toEqual(reference);
    expect(fetcher).toHaveBeenCalledWith('/api/assets', expect.objectContaining({
      credentials: 'include', cache: 'no-store',
      headers: expect.objectContaining({ 'x-wujie-expected-actor-id': 'editor' }),
      body: JSON.stringify({ projectId: 'shared', assetVersionId: 'version', placementId: 'placement' }),
    }));
  });
  it('rejects a changed actor after the reference response without consuming it', async () => {
    const deferred = contractDeferred<Response>(); let current = true;
    vi.stubGlobal('fetch', vi.fn(() => deferred.promise));
    const transfer = actualTransferCallback<(request: SimpleChatWorkflowTransferRequest, scope: unknown) => Promise<WorkspaceAssetReference>>('transferSimpleChatImageToWorkflow', {});
    const pending = transfer(request, { documentReference: reference, expectedActorUserId: 'editor', isCurrent: () => current });
    current = false; deferred.release(Response.json(reference));
    await expect(pending).rejects.toThrow('HANDOFF_SCOPE_CHANGED');
  });
  it('persists only the actor workflow and never the shared project in personal project storage', async () => {
    const manager = { getProject: vi.fn(), updateProjectInMemory: vi.fn(), flushProjectsToServerWithConflictRecovery: vi.fn() };
    const flush = vi.fn(); const setProject = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true })); vi.stubGlobal('fetch', fetcher);
    const persist = actualTransferCallback<(workflow: Workflow, project?: string) => Promise<void>>('persistNodeWorkflow', {
      currentProjectRef: { current: { id: 'shared' } }, currentUserRef: { current: { id: 'editor' } },
      collaborativeCanvasRef: { current: { projectId: 'shared', authority: 'document' } },
      canvasPersistenceScheduler: { flush }, UserManagerCore: { getInstance: () => manager },
      mergeWorkflowIntoProjectMetadata: vi.fn(), setCurrentProject: setProject,
    });
    const workflow = { id: 'workflow', updatedAt: 1 } as Workflow;
    await persist(workflow, 'shared');
    expect(fetcher).toHaveBeenCalledWith('/api/workflow/save', expect.objectContaining({
      body: JSON.stringify({ userId: 'editor', workflow: { ...workflow, projectId: 'shared' } }),
      headers: expect.objectContaining({ 'x-wujie-expected-actor-id': 'editor' }),
    }));
    expect(flush).not.toHaveBeenCalled(); expect(manager.updateProjectInMemory).not.toHaveBeenCalled(); expect(setProject).not.toHaveBeenCalled();
  });
  it('restores only the actor workflow explicitly bound to this shared project', async () => {
    const own = { ...createSimpleChatImportWorkflow('shared', 2), projectId: 'shared' };
    const other = { ...createSimpleChatImportWorkflow('other', 9), projectId: 'other' };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ workflows: [other, own] })); vi.stubGlobal('fetch', fetcher);
    const load = actualTransferCallback<(project: string, actor: string, signal: AbortSignal, current: () => boolean) => Promise<Workflow | null>>('loadDocumentNodeWorkflow', { workflowFromProjectMetadata });
    expect(await load('shared', 'editor', new AbortController().signal, () => true)).toEqual(own);
    expect(fetcher).toHaveBeenCalledWith('/api/workflow/save?userId=editor', expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
  });
  it('preserves a confirmed owner project workflow when the actor has no separate workflow record', async () => {
    const workflow = createSimpleChatImportWorkflow('shared', 2);
    workflow.name = '协作项目保留的节点工作流';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ workflows: [] })));
    const load = actualTransferCallback<(project: string, actor: string, signal: AbortSignal, current: () => boolean, ownedProject: unknown) => Promise<Workflow | null>>('loadDocumentNodeWorkflow', { workflowFromProjectMetadata });
    expect(await load('shared', 'owner', new AbortController().signal, () => true,
      { id: 'shared', userId: 'owner', metadata: { workflow } })).toEqual(workflow);
  });
  it('does not recover owner metadata for an editor or a different project', async () => {
    const workflow = createSimpleChatImportWorkflow('shared', 2);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json({ workflows: [] }))));
    const load = actualTransferCallback<(project: string, actor: string, signal: AbortSignal, current: () => boolean, ownedProject: unknown) => Promise<Workflow | null>>('loadDocumentNodeWorkflow', { workflowFromProjectMetadata });
    expect(await load('shared', 'editor', new AbortController().signal, () => true,
      { id: 'shared', userId: 'owner', metadata: { workflow } })).toBeNull();
    expect(await load('shared', 'owner', new AbortController().signal, () => true,
      { id: 'other', userId: 'owner', metadata: { workflow } })).toBeNull();
  });
  it('prefers the actor standalone workflow over historical owner metadata', async () => {
    const historical = createSimpleChatImportWorkflow('shared', 2);
    const standalone = { ...createSimpleChatImportWorkflow('shared', 9), projectId: 'shared' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ workflows: [standalone] })));
    const load = actualTransferCallback<(project: string, actor: string, signal: AbortSignal, current: () => boolean, ownedProject: unknown) => Promise<Workflow | null>>('loadDocumentNodeWorkflow', { workflowFromProjectMetadata });
    expect(await load('shared', 'owner', new AbortController().signal, () => true,
      { id: 'shared', userId: 'owner', metadata: { workflow: historical } })).toEqual(standalone);
  });
  it('does not use owner metadata after a failed authenticated read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'forbidden' }, { status: 403 })));
    const load = actualTransferCallback<(project: string, actor: string, signal: AbortSignal, current: () => boolean, ownedProject: unknown) => Promise<Workflow | null>>('loadDocumentNodeWorkflow', { workflowFromProjectMetadata });
    await expect(load('shared', 'owner', new AbortController().signal, () => true,
      { id: 'shared', userId: 'owner', metadata: { workflow: createSimpleChatImportWorkflow('shared', 2) } })).rejects.toThrow('工作流加载失败');
  });
  it('does not treat a malformed successful workflow response as an empty actor list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
    const load = actualTransferCallback<(project: string, actor: string, signal: AbortSignal, current: () => boolean, ownedProject: unknown) => Promise<Workflow | null>>('loadDocumentNodeWorkflow', { workflowFromProjectMetadata });
    await expect(load('shared', 'owner', new AbortController().signal, () => true,
      { id: 'shared', userId: 'owner', metadata: { workflow: createSimpleChatImportWorkflow('shared', 2) } })).rejects.toThrow('工作流加载失败');
  });
  it('rejects a late owner metadata recovery after the actor or project changes', async () => {
    const deferred = contractDeferred<Response>(); let current = true;
    vi.stubGlobal('fetch', vi.fn(() => deferred.promise));
    const load = actualTransferCallback<(project: string, actor: string, signal: AbortSignal, current: () => boolean, ownedProject: unknown) => Promise<Workflow | null>>('loadDocumentNodeWorkflow', { workflowFromProjectMetadata });
    const pending = load('shared', 'owner', new AbortController().signal, () => current,
      { id: 'shared', userId: 'owner', metadata: { workflow: createSimpleChatImportWorkflow('shared', 2) } });
    current = false; deferred.release(Response.json({ workflows: [] }));
    await expect(pending).rejects.toThrow('HANDOFF_SCOPE_CHANGED');
  });
  it('imports an actor personal image through the existing document receipt and directory boundary', async () => {
    const published = { ...reference, assetVersionId: 'published-version', placementId: 'published-placement' };
    const result = { projectId: 'shared', documentSequence: 8, items: [{ assetReference: published }] };
    const importDocumentMediaBatch = vi.fn().mockResolvedValue(result);
    const refreshMedia = vi.fn().mockResolvedValue([{ ...published, id: 'image' }]);
    const assertDocumentMediaBatchProjection = vi.fn();
    const receive = actualTransferCallback<(request: SimpleChatWorkflowTransferRequest, ref: WorkspaceAssetReference, scope: unknown) => Promise<WorkspaceAssetReference>>('importSimpleChatImageToDocumentWorkflow', { importDocumentMediaBatch, assertDocumentMediaBatchProjection });
    const signal = new AbortController().signal;
    expect(await receive(request, reference, { expectedActorUserId: 'editor', signal, isCurrent: () => true, refreshMedia })).toEqual(published);
    expect(importDocumentMediaBatch).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'shared', idempotencyKey: 'key' }), 'editor', signal, expect.any(Function));
    expect(refreshMedia).toHaveBeenCalledWith({ projectId: 'shared', documentSequence: 8, requireDirectorySequence: true });
    expect(assertDocumentMediaBatchProjection).toHaveBeenCalledWith(result, [{ ...published, id: 'image' }]);
  });
});
