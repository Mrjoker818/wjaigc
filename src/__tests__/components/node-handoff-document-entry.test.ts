import { afterEach, describe, expect, it, vi } from 'vitest';
import { actualTransferCallback, contractDeferred } from '../helpers/canvas-chat-transfer-contract-fixture';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { SimpleChatWorkflowTransferRequest } from '@/lib/simple-chat-workspace-handoff-client';
import type { Workflow } from '@/lib/workflow-engine';
import { workflowFromProjectMetadata } from '@/lib/project-workflow';
import { createSimpleChatImportWorkflow } from '@/lib/simple-chat-workspace-handoff';

const reference: WorkspaceAssetReference = { url: '/canonical.png', kind: 'image', assetId: 'asset',
  assetVersionId: 'version', placementId: 'placement', entityId: 'image' };
const request: SimpleChatWorkflowTransferRequest = { sourceVersion: 'version', targetProject: 'shared',
  targetWorkspace: 'workflow', entityType: 'workflow-input', entityId: 'node', idempotencyKey: 'key',
  metadata: { imageIndex: 0, sourceTrace: { source: 'simple-chat', chatProjectId: 'chat', chatTaskId: 'task', messageId: 'message', createdAt: '2026-10-07T14:00:00Z' }, name: 'image' } };
afterEach(() => vi.unstubAllGlobals());
describe('actual document node handoff entry', () => {
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
