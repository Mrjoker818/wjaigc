// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow, createWorkflowNode, type Workflow, type WorkflowNode } from '@/lib/workflow-engine';
import { CANVAS_ASSET_DRAG_MIME, serializeCanvasAssetDragPayload } from '@/lib/asset-core/workspace-transfer';
import { createWorkflowEditorState, reduceWorkflowEditorState } from '@/lib/workflow-renderer/commands';

// These are synthetic references and responses; no account or service is contacted.
const image = {
  id: 'image-a', name: '合成图片', description: '合成图片', url: '/synthetic.png',
  projectId: 'project-a', assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a',
};
const receipt = {
  assetId: image.assetId, assetVersionId: image.assetVersionId,
  placementId: image.placementId, url: image.url,
};
const other = { ...createWorkflowNode('input-text', 10, 10, '其他节点'), id: 'other' };
const workflow: Workflow = { ...createEmptyWorkflow('合成工作流'), id: 'workflow-a', nodes: [other] };
let unexpectedRequests: string[] = [];

beforeEach(() => {
  unexpectedRequests = [];
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('NETWORK_BLOCKED'); } });
  vi.stubGlobal('XMLHttpRequest', class { constructor() { throw new Error('NETWORK_BLOCKED'); } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(unexpectedRequests).toEqual([]);
});

function nodeById(value: Workflow, id: string): WorkflowNode | undefined {
  return value.nodes.find(node => node.id === id);
}

async function setupPendingInsertion() {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  let retryStatus: 200 | 503 | null = null;
  let latest = structuredClone(workflow);
  const posts: Array<{ url: string; actor: string | null; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if ((!init?.method || init.method === 'GET') && url === '/api/skills?surface=workflow') return Response.json({ skills: [] });
    if (init?.method === 'POST' && url === '/api/assets') {
      posts.push({ url, actor: new Headers(init.headers).get('x-wujie-expected-actor-id'), body: JSON.parse(String(init.body)) });
      if (retryStatus === 200) return Response.json(receipt);
      if (retryStatus === 503) return Response.json({ error: 'SYNTHETIC_FAILURE' }, { status: 503 });
      return pending;
    }
    unexpectedRequests.push(`${init?.method || 'GET'} ${url}`);
    throw new Error('NETWORK_BLOCKED');
  }));
  const view = (external: Workflow = workflow, actor = 'user-a', project = 'project-a') => (
    <NodeEditor workflow={external} userId={actor} projectId={project} rendererMode="legacy"
      canvasDocumentMode canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]}
      onWorkflowChange={value => { if (value) latest = structuredClone(value); }} />
  );
  const mounted = render(view());
  const surface = mounted.container.querySelector<HTMLElement>('.canvas-bg');
  expect(surface).toBeTruthy();
  const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 });
  Object.defineProperty(drop, 'dataTransfer', {
    value: { getData: (type: string) => type === CANVAS_ASSET_DRAG_MIME ? serializeCanvasAssetDragPayload(image) : '' },
  });
  fireEvent(surface!, drop);
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toEqual({ url: '/api/assets', actor: 'user-a',
    body: { projectId: 'project-a', assetVersionId: 'version-a', placementId: 'placement-a' } });
  const field = screen.getByLabelText('名称') as HTMLInputElement;
  act(() => { field.focus(); });
  fireEvent.change(field, { target: { value: '未失焦草稿' } });
  return {
    mounted, view, posts, field,
    snapshot: () => structuredClone(latest),
    node: () => latest.nodes.find(node => node.type === 'input-image'),
    other: () => nodeById(latest, 'other'),
    finish: async (response: Response) => { await act(async () => { release(response); await pending; }); },
    retryWith: (status: 200 | 503) => { retryStatus = status; },
  };
}

describe('NodeEditor material receipt lifecycle', () => {
  it('keeps the current receipt after external hydration removes insertion history', async () => {
    const fixture = await setupPendingInsertion();
    const external = fixture.snapshot();
    external.nodes = external.nodes.map(node => node.id === 'other' ? { ...node, label: '外部同步' } : node);
    fixture.mounted.rerender(fixture.view(external));
    await waitFor(() => expect(fixture.other()?.label).toBe('外部同步'));
    await fixture.finish(Response.json(receipt));
    await waitFor(() => expect(fixture.node()?.config.assetTransferPending).toBe(false));
    expect(fixture.node()?.config.assetVersionId).toBe(image.assetVersionId);
    expect(fixture.posts).toHaveLength(1);
    expect(fixture.other()?.label).toBe('外部同步');
    expect(fixture.field.value).toBe('未失焦草稿');
  });

  it('keeps the receipt after 51 committed edits evict the insertion history', async () => {
    const fixture = await setupPendingInsertion();
    for (let index = 0; index < 51; index++) {
      act(() => { fixture.field.focus(); });
      fireEvent.change(fixture.field, { target: { value: `编辑-${index}` } });
      act(() => { fixture.field.blur(); });
    }
    await waitFor(() => expect(fixture.node()?.label).toBe('编辑-50'));
    await fixture.finish(Response.json(receipt));
    await waitFor(() => expect(fixture.node()?.config.assetTransferPending).toBe(false));
    expect(fixture.node()?.label).toBe('编辑-50');
    expect(fixture.node()?.config.assetVersionId).toBe(image.assetVersionId);
    expect(fixture.other()).toEqual(other);
    expect(fixture.posts).toHaveLength(1);
  }, 30_000);

  it('ignores a receipt when hydration changed the selected source', async () => {
    const fixture = await setupPendingInsertion();
    const external = fixture.snapshot();
    const node = external.nodes.find(item => item.type === 'input-image');
    expect(node).toBeTruthy();
    node!.config = { ...node!.config, sourceImageId: 'different', imageUrl: '/different.png',
      assetTransferExpectedSource: { id: 'different', url: '/different.png', projectId: 'project-a',
        assetVersionId: 'different-version', placementId: 'different-placement' } };
    fixture.mounted.rerender(fixture.view(external));
    await waitFor(() => expect(fixture.node()?.config.sourceImageId).toBe('different'));
    await fixture.finish(Response.json(receipt));
    expect(fixture.node()?.config).toMatchObject({ sourceImageId: 'different', imageUrl: '/different.png', assetTransferPending: true });
    expect(fixture.node()?.config.assetVersionId).toBeUndefined();
    expect(fixture.other()).toEqual(other);
    expect(fixture.posts).toHaveLength(1);
  });

  it('requires a manual retry when deletion invalidates the receipt and undo restores the node', async () => {
    const fixture = await setupPendingInsertion();
    act(() => { fixture.field.blur(); });
    fireEvent.keyDown(document, { key: 'Delete' });
    await waitFor(() => expect(fixture.node()).toBeUndefined());
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(fixture.node()?.config.assetTransferPending).toBe(true));
    await fixture.finish(Response.json(receipt));
    expect(fixture.posts).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toMatch(/接收.*中断/);
    fixture.retryWith(200);
    fireEvent.click(screen.getByRole('button', { name: '重试接收图片' }));
    await waitFor(() => expect(fixture.node()?.config.assetTransferPending).toBe(false));
    expect(fixture.posts).toHaveLength(2);
    expect(fixture.other()).toEqual(other);
  });
});

function setupLegacyPending(withExecution = false) {
  let latest: Workflow;
  let responseStatus: 200 | 503 = 503;
  const posts: Array<{ url: string; actor: string | null; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if ((!init?.method || init.method === 'GET') && url === '/api/skills?surface=workflow') return Response.json({ skills: [] });
    if (init?.method === 'POST' && url === '/api/assets') {
      posts.push({ url, actor: new Headers(init.headers).get('x-wujie-expected-actor-id'), body: JSON.parse(String(init.body)) });
      return responseStatus === 200 ? Response.json(receipt) : Response.json({ error: 'SYNTHETIC_FAILURE' }, { status: 503 });
    }
    unexpectedRequests.push(`${init?.method || 'GET'} ${url}`);
    throw new Error('NETWORK_BLOCKED');
  }));
  const legacy = createWorkflowNode('input-image', 100, 100, '旧节点');
  legacy.id = 'legacy-node';
  legacy.config = { ...legacy.config, source: 'canvas', sourceImageId: 'untrusted-old',
    imageUrl: '/untrusted-old.png', assetTransferPending: true };
  const persisted: Workflow = { ...workflow, nodes: [other, legacy] };
  localStorage.setItem('synthetic-workflow', JSON.stringify(persisted));
  const loaded = JSON.parse(localStorage.getItem('synthetic-workflow')!) as Workflow;
  latest = structuredClone(loaded);
  if (withExecution) {
    localStorage.setItem(`wujie_workflow_exec_state:v2:${JSON.stringify(['user-a', 'project-a', workflow.id])}`,
      JSON.stringify({ executionId: 'synthetic-execution', execStatus: 'paused', execResults: {}, nodeIds: ['other'],
        execLogs: [{ time: 1, nodeId: 'other', label: '其他节点', status: 'error', message: '合成失败' }] }));
  }
  render(<NodeEditor workflow={loaded} userId="user-a" projectId="project-a" rendererMode="legacy"
    canvasDocumentMode canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]}
    onWorkflowChange={value => { if (value) latest = structuredClone(value); }} />);
  return {
    posts, node: () => nodeById(latest, 'legacy-node'), other: () => nodeById(latest, 'other'),
    succeed: () => { responseStatus = 200; },
  };
}

describe('NodeEditor legacy pending input without identity', () => {
  it('blocks execution and requires an explicit new selection before a synthetic request', async () => {
    const fixture = setupLegacyPending();
    expect(fixture.posts).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' }));
    await screen.findByText('图片资产正在同步，请完成后再运行工作流');
    expect(screen.getByRole('alert').textContent).toMatch(/无法确认.*重新选择/);
    fireEvent.click(screen.getByRole('button', { name: '重新选择图片' }));
    expect(fixture.posts).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '合成图片' }));
    await waitFor(() => expect(fixture.posts).toHaveLength(1));
    expect(fixture.posts[0]).toEqual({ url: '/api/assets', actor: 'user-a',
      body: { projectId: 'project-a', assetVersionId: 'version-a', placementId: 'placement-a' } });
    await waitFor(() => expect(fixture.node()?.config.assetTransferError).toBe('TRANSFER_INTERRUPTED'));
    expect(fixture.node()?.config.assetTransferPending).toBe(true);
    fixture.succeed();
    fireEvent.click(screen.getByRole('button', { name: '重试接收图片' }));
    await waitFor(() => expect(fixture.node()?.config.assetTransferPending).toBe(false));
    expect(fixture.node()?.config.assetVersionId).toBe(image.assetVersionId);
    expect(fixture.other()).toEqual(other);
  });

  it('blocks retrying another node while the old image is unresolved', async () => {
    const fixture = setupLegacyPending(true);
    fireEvent.click(screen.getByRole('button', { name: '切换执行日志面板' }));
    const retry = await screen.findByRole('button', { name: '重试此节点' });
    await act(async () => { fireEvent.click(retry); await Promise.resolve(); });
    expect(fixture.posts).toHaveLength(0);
    expect(screen.getByText(/有图片尚未接收，当前无法重试节点/)).toBeTruthy();
  });
});

describe('material insertion history', () => {
  it('keeps a changed expected source as a whole across undo and redo', () => {
    const node = createWorkflowNode('input-image', 1, 2);
    node.config = { ...node.config, assetTransferPending: true, assetTransferError: 'ACTOR_SCOPE_CHANGED',
      assetTransferExpectedActorId: 'user-a', assetTransferExpectedProjectId: 'project-a',
      assetTransferExpectedSource: { id: 'first', url: '/first', assetVersionId: 'version-1', placementId: 'placement-1' } };
    const initial = createEmptyWorkflow('合成工作流');
    let state = createWorkflowEditorState(initial);
    state = reduceWorkflowEditorState(state, { kind: 'user.update', workflow: { ...initial, nodes: [node] }, transactionId: 'insert' });
    const updated = { ...node, config: { ...node.config,
      assetTransferExpectedSource: { id: 'second', url: '/second', assetVersionId: 'version-2', placementId: 'placement-2' } } };
    state = reduceWorkflowEditorState(state, { kind: 'insertion.settle', nodeId: node.id, transactionId: 'insert', before: node, after: updated });
    expect(state.workflow.nodes[0].config.assetTransferExpectedSource).toEqual(updated.config.assetTransferExpectedSource);
    expect(state.workflow.nodes[0].config.assetTransferExpectedActorId).toBe('user-a');
    state = reduceWorkflowEditorState(state, { kind: 'history.undo' });
    expect(state.workflow.nodes).toHaveLength(0);
    state = reduceWorkflowEditorState(state, { kind: 'history.redo' });
    expect(state.workflow.nodes[0].config.assetTransferExpectedSource).toEqual(updated.config.assetTransferExpectedSource);
  });
});
