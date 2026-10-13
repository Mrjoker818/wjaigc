// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
const reference = { kind: 'document-reference', taskId: 'sketch_task', projectId: 'project-a', providerId: 'p1', modelId: 'm1', previewAssetId: 'png-asset', htmlAssetId: 'html-asset', previewAssetVersionId: 'png-version', htmlAssetVersionId: 'html-version' };
const descriptor: TaskModelDescriptor = { providerId: 'p1', modelId: 'm1', kind: 'chat', sourceType: 'chat', protocol: 'chat-completions', executionMode: 'sync', supportsVision: true,
  allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: ['text'], capabilitySources: {} };
let requests: { url: string; body?: Record<string, unknown> }[]; let rejectRead: boolean; let insertions: unknown[];
function workflow() { const n = createWorkflowNode('ai-sketch-to-code', 0, 0); n.id = 'sketch-node'; n.label = '草图节点甲'; n.config = { model: 'p1::m1', providerId: 'p1', instruction: '布局' }; return { ...createEmptyWorkflow('草图'), id: 'wf-a', nodes: [n] }; }
const completed = { success: true, type: 'sketch-to-code', ...reference, kind: undefined, status: 'completed', progress: 100, reserveCredits: 14, actualCredits: 14,
  analysis: { summary: '中文页面摘要', layout: '容器与控件', controls: ['按钮', '输入框'], text: ['标题', '中文'] }, html: 'RAW_POLL_HTML' };
beforeEach(() => {
  requests = []; rejectRead = false; insertions = []; localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:safe-preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url); const body = init?.body ? JSON.parse(String(init.body)) : undefined; requests.push({ url: path, body });
    if (path === '/api/poll-task') return Response.json(rejectRead ? { error: 'READ_REVOKED' } : completed, { status: rejectRead ? 403 : 200 });
    if (path.includes('/document?')) return new Response('<!doctype html><html><body>COMPILED_SAFE_BYTES</body></html>', { headers: { 'content-type': 'text/html' } });
    if (path === '/api/assets/transfer') {
      return Response.json({ url: '/api/serve-upload/original.png', assetId: 'png-asset', assetVersionId: 'png-version', entityId: body.entityId, placementId: 'placement-a', placementStatus: 'active', reused: false, sourceTrace: body.metadata.sourceTrace });
    }
    if (path.startsWith('/api/assets?')) {
      const transfer = requests.find(r => r.url === '/api/assets/transfer')?.body;
      return Response.json({ url: '/api/serve-upload/original.png', kind: 'image', assetId: 'png-asset', assetVersionId: 'png-version', ...(path.includes('placementId=') ? { placementId: 'placement-a', entityId: transfer?.entityId, sourceTrace: (transfer?.metadata as { sourceTrace: unknown })?.sourceTrace } : {}) });
    }
    if (path === '/api/workflow/execute') return Response.json({ executionId: 'exec-a', status: 'paused', results: { 'sketch-node': { status: 'success', output: { documentReference: reference } } } });
    return Response.json({ skills: [], workflows: [] });
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(options: { document?: boolean; readyResult?: boolean; loading?: boolean; error?: string; catalog?: TaskModelDescriptor[]; phase?: string; failed?: boolean } = {}) {
  const wf = workflow();
  if (options.readyResult) localStorage.setItem(`wujie_workflow_exec_state:v2:${JSON.stringify(['u1','project-a','wf-a'])}`, JSON.stringify({ executionId: 'exec-a', execStatus: 'paused', execResults: { 'sketch-node': { status: 'success', output: { documentReference: reference, html: 'RAW_LOCAL_HTML' } } }, execLogs: [] }));
  if (options.phase) localStorage.setItem(`wujie_workflow_exec_state:v2:${JSON.stringify(['u1','project-a','wf-a'])}`, JSON.stringify({ executionId: 'exec-a', execStatus: 'paused', execResults: { 'sketch-node': { status: options.failed ? 'failed' : 'running', error: options.failed ? '原服务失败' : undefined, output: { phase: options.phase, progress: 40, ...(options.readyResult ? { documentReference: reference } : {}) } } }, execLogs: [] }));
  const catalog = options.catalog || [descriptor, { ...descriptor, providerId: 'p2' }, { ...descriptor, providerId: 'nonvision', supportsVision: false }, { ...descriptor, providerId: 'async', executionMode: 'async' as const }];
  const result = render(<NodeEditor workflow={wf} userId="u1" projectId="project-a" canvasDocumentMode={options.document} taskModelCatalog={catalog}
    taskModelOptions={catalog.map(m => ({ id: m.modelId, name: m.modelId, type: 'chat', provider: m.providerId, providerId: m.providerId, providerName: m.providerId }))}
    catalogStatus={{ loading: !!options.loading, error: options.error || null }} onAddImages={items => { insertions.push(items); }} />);
  const card = document.querySelector('[data-workflow-node-id="sketch-node"]') || screen.getByText('草图节点甲'); fireEvent.mouseDown(card, { button: 0 }); fireEvent.click(card);
  return result;
}
describe('Task5 original node editor sketch integration', () => {
  it('submits a ready canvas PNG without its editor-only transfer markers and preserves its canonical asset binding', async () => {
    const wf = workflow();
    const input = createWorkflowNode('input-image', 100, 100); input.id = 'canvas-png';
    input.config = { color: '#3b82f6', source: 'canvas', imageUrl: '/api/serve-upload/original.png', projectId: 'project-a',
      assetId: 'png-asset', assetVersionId: 'png-version', placementId: 'placement-a',
      sourceImageId: 'canvas-image', sourceVersionId: 'canvas-ui-version', assetTransferPending: false };
    wf.nodes.push(input);
    wf.connections.push({ id: 'upstream-png', fromNodeId: input.id, fromPortId: 'out-image', toNodeId: 'sketch-node', toPortId: 'in-image', type: 'image' });
    const before = JSON.stringify(wf);
    render(<NodeEditor workflow={wf} userId="u1" projectId="project-a" taskModelCatalog={[descriptor]} />);
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' }));
    await waitFor(() => expect(requests.some(r => r.url === '/api/workflow/execute')).toBe(true));
    const nodes = requests.find(r => r.url === '/api/workflow/execute')!.body!.nodes as typeof wf.nodes;
    expect(nodes.find(n => n.id === input.id)?.config).toEqual({ color: '#3b82f6', source: 'canvas',
      imageUrl: '/api/serve-upload/original.png', projectId: 'project-a', assetId: 'png-asset', assetVersionId: 'png-version', placementId: 'placement-a' });
    expect(JSON.stringify(wf)).toBe(before);
    expect(requests.some(r => r.url === '/api/sketch-to-code')).toBe(false);
  });
  it('does not silently remove unknown or credential-shaped input config fields from the strict server contract', async () => {
    const wf = workflow(); const input = createWorkflowNode('input-image', 100, 100); input.id = 'untrusted-input';
    input.config = { imageUrl: '/api/serve-upload/original.png', apiKey: 'NON_SECRET_TEST_SENTINEL', unknownField: 'must-still-be-rejected' };
    wf.nodes.push(input);
    wf.connections.push({ id: 'untrusted-png', fromNodeId: input.id, fromPortId: 'out-image', toNodeId: 'sketch-node', toPortId: 'in-image', type: 'image' });
    render(<NodeEditor workflow={wf} userId="u1" projectId="project-a" taskModelCatalog={[descriptor]} />);
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' }));
    await waitFor(() => expect(requests.some(r => r.url === '/api/workflow/execute')).toBe(true));
    const nodes = requests.find(r => r.url === '/api/workflow/execute')!.body!.nodes as typeof wf.nodes;
    expect(nodes.find(n => n.id === input.id)?.config).toEqual(input.config);
  });
  it('blocks workflow submission while a canvas image transfer is pending instead of discarding the pending guard', async () => {
    const wf = workflow(); const input = createWorkflowNode('input-image', 100, 100); input.id = 'pending-input';
    input.config = { imageUrl: '/api/serve-upload/original.png', sourceImageId: 'canvas-image', sourceVersionId: 'canvas-ui-version', assetTransferPending: true };
    wf.nodes.push(input);
    wf.connections.push({ id: 'pending-png', fromNodeId: input.id, fromPortId: 'out-image', toNodeId: 'sketch-node', toPortId: 'in-image', type: 'image' });
    render(<NodeEditor workflow={wf} userId="u1" projectId="project-a" taskModelCatalog={[descriptor]} />);
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' }));
    await waitFor(() => expect(screen.getByText('图片资产正在同步，请完成后再运行工作流')).toBeTruthy());
    expect(requests.filter(r => r.url === '/api/workflow/execute')).toEqual([]);
    expect(input.config.assetTransferPending).toBe(true);
  });
  it('shows exact eligible vision-chat provider pairs in the original property panel', async () => {
    mount(); const select = await screen.findByRole('combobox', { name: '草图视觉模型' }) as HTMLSelectElement;
    expect(Array.from(select.options).filter(o => o.value).map(o => o.value)).toEqual(['p1::m1', 'p2::m1']);
    expect(screen.getByText('草图说明')).toBeTruthy();
  });
  it.each([{ loading: true }, { error: '目录读取失败' }])('blocks execution with unavailable model catalog %s', async options => {
    mount(options); const button = screen.getByRole('button', { name: '执行工作流' }); expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button); await act(async () => {}); expect(requests.filter(r => r.url === '/api/workflow/execute')).toEqual([]);
  });
  it('fresh authorizes every preview/download, uses empty sandbox, and clears prior bytes when authorization fails', async () => {
    mount({ readyResult: true }); fireEvent.click(await screen.findByRole('button', { name: '预览安全代码' }));
    await screen.findByTitle('草图安全代码预览'); expect(screen.getByTitle('草图安全代码预览').getAttribute('sandbox')).toBe('');
    expect(requests.filter(r => r.url.includes('/document?'))).toHaveLength(1); expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '下载安全HTML' })); await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1));
    expect(requests.filter(r => r.url.includes('/document?'))).toHaveLength(2); expect(requests.filter(r => r.url === '/api/poll-task')).toHaveLength(2);
    rejectRead = true; fireEvent.click(screen.getByRole('button', { name: '预览安全代码' })); await waitFor(() => expect(screen.queryByTitle('草图安全代码预览')).toBeNull());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:safe-preview'); expect(requests.filter(r => r.url.includes('/document?'))).toHaveLength(2);
  });
  it('pre-disables document placement with zero transfer/private writes while retaining authorized preview', async () => {
    mount({ readyResult: true, document: true }); const add = await screen.findByRole('button', { name: '添加原草图PNG到画布' }); expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/协作文档暂不能放置新草图版本/)).toBeTruthy(); fireEvent.click(add);
    fireEvent.click(screen.getByRole('button', { name: '预览安全代码' })); await screen.findByTitle('草图安全代码预览');
    expect(requests.some(r => r.url === '/api/assets/transfer' || r.url.includes('batch') || r.url.includes('project-data'))).toBe(false); expect(insertions).toEqual([]);
  });
  it('uses the original placement receipt and readback before the original parent canvas insertion', async () => {
    mount({ readyResult: true }); fireEvent.click(await screen.findByRole('button', { name: '添加原草图PNG到画布' }));
    await waitFor(() => expect(insertions).toHaveLength(1)); expect(requests.filter(r => r.url === '/api/assets/transfer')).toHaveLength(1);
    expect(insertions[0]).toMatchObject([{ outputNodeId: 'sketch-node', assetReference: { placementId: 'placement-a', assetVersionId: 'png-version', sourceTrace: { taskId: 'sketch_task', htmlAssetVersionId: 'html-version' } } }]);
    fireEvent.click(screen.getByRole('button', { name: '添加原草图PNG到画布' })); await act(async () => {}); expect(insertions).toHaveLength(1);
  });
  it('restores only a safe document binding and removes legacy raw HTML from its scoped execution cache', async () => {
    mount({ readyResult: true });
    await waitFor(() => expect(localStorage.getItem(`wujie_workflow_exec_state:v2:${JSON.stringify(['u1','project-a','wf-a'])}`)).not.toContain('RAW_LOCAL_HTML'));
    expect(requests.filter(r => r.url === '/api/sketch-to-code')).toEqual([]);
  });
  it('stops a late authorized document body after switching project without constructing old-scope preview bytes', async () => {
    let release: (response: Response) => void = () => undefined;
    const original = globalThis.fetch; const pending = new Promise<Response>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn((url, init) => String(url).includes('/document?') ? pending : original(url, init)));
    const result = mount({ readyResult: true }); fireEvent.click(await screen.findByRole('button', { name: '预览安全代码' }));
    await waitFor(() => expect(requests.filter(r => r.url === '/api/poll-task')).toHaveLength(1));
    result.rerender(<NodeEditor workflow={workflow()} userId="u1" projectId="project-b" taskModelCatalog={[descriptor]} />);
    await act(async () => { release(new Response('<html>LATE_OLD_SCOPE</html>', { headers: { 'content-type': 'text/html' } })); });
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(screen.queryByTitle('草图安全代码预览')).toBeNull();
  });
  it.each([{ phase: 'analysis', text: '正在分析草图' }, { phase: 'reconstruction', text: '正在重建页面' }])('shows actual $phase progress in the original property panel', async ({ phase, text }) => {
    mount({ phase }); expect(await screen.findByText(`${text} · 40%`)).toBeTruthy();
  });
  it('terminal failure outranks an old analysis phase and never enables document actions', async () => {
    mount({ phase: 'analysis', failed: true }); expect((await screen.findAllByText('原服务失败')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/正在分析草图|草图处理中/)).toBeNull(); expect((screen.getByRole('button', { name: '预览安全代码' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('terminal failure also disables residual document references without fresh reads or placement', async () => {
    mount({ phase: 'reconstruction', failed: true, readyResult: true });
    for (const name of ['预览安全代码', '下载安全HTML', '添加原草图PNG到画布']) {
      const button = await screen.findByRole('button', { name }); expect((button as HTMLButtonElement).disabled).toBe(true); fireEvent.click(button);
    }
    expect(screen.queryByText(/正在重建页面|草图处理中/)).toBeNull(); await act(async () => {});
    expect(requests.some(r => r.url === '/api/poll-task' || r.url.includes('/document?') || r.url === '/api/assets/transfer')).toBe(false);
  });
  it('exact provider selection is applied to the original workflow submission without a client-side sketch start', async () => {
    mount(); fireEvent.change(await screen.findByRole('combobox', { name: '草图视觉模型' }), { target: { value: 'p2::m1' } });
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' })); await waitFor(() => expect(requests.some(r => r.url === '/api/workflow/execute')).toBe(true));
    const submitted = requests.find(r => r.url === '/api/workflow/execute')!.body!;
    expect(submitted.nodes).toMatchObject([{ config: { providerId: 'p2', model: 'p2::m1' } }]); expect(requests.some(r => r.url === '/api/sketch-to-code')).toBe(false);
  });
  it.each(['htmlAssetVersionId', 'previewAssetVersionId', 'providerId', 'projectId'] as const)('rejects fresh changed %s before document GET or placement', async field => {
    const original = globalThis.fetch; vi.stubGlobal('fetch', vi.fn((url, init) => String(url) === '/api/poll-task' ? Promise.resolve(Response.json({ ...completed, [field]: 'changed' })) : original(url, init)));
    mount({ readyResult: true }); fireEvent.click(await screen.findByRole('button', { name: '预览安全代码' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy()); expect(requests.some(r => r.url.includes('/document?') || r.url === '/api/assets/transfer')).toBe(false);
  });
});
