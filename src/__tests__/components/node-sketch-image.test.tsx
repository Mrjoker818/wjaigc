// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow, createWorkflowNode, type Workflow } from '@/lib/workflow-engine';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

const vision: TaskModelDescriptor = { providerId: 'v1', modelId: '共享/视觉', kind: 'chat', sourceType: 'chat', protocol: 'chat-completions', executionMode: 'sync',
  supportsVision: true, allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: ['text'], capabilitySources: {} };
const image: TaskModelDescriptor = { ...vision, providerId: 'i1', modelId: '共享/图像', kind: 'image', sourceType: 'image', protocol: 'openai-images',
  executionMode: 'async', supportsReferenceImages: true, maxReferenceImages: 1, supportedOperations: ['image-to-image'], outputKinds: ['image'],
  allowedRatios: ['1:1'], allowedSizes: ['1024x1024'], qualityOptions: ['high'] };
const catalog = [vision, { ...vision, providerId: 'v2' }, image, { ...image, providerId: 'i2' },
  { ...vision, providerId: 'no-vision', supportsVision: false }, { ...vision, providerId: 'async-vision', executionMode: 'async' as const },
  { ...image, providerId: 'no-reference', supportsReferenceImages: false }];
const reference = { kind: 'sketch-image-reference', taskId: 'image-task', projectId: 'project-a',
  visionProviderId: 'v1', visionModelId: '共享/视觉', imageProviderId: 'i1', imageModelId: '共享/图像',
  previewAssetId: 'input-asset', previewAssetVersionId: 'input-version', imageAssetId: 'image-asset', imageAssetVersionId: 'image-version' };
const cacheKey = `wujie_workflow_exec_state:v2:${JSON.stringify(['u1', 'project-a', 'wf-a'])}`;
let requests: { url: string; body?: Record<string, unknown> }[];
function workflow(config: Record<string, unknown> = {}): Workflow {
  const node = createWorkflowNode('ai-sketch-to-image', 0, 0); node.id = 'image-node'; node.label = '独立草图生图';
  node.config = { instruction: '输入关键词', aspectRatio: '4:3', ...config };
  return { ...createEmptyWorkflow('草图图像'), id: 'wf-a', nodes: [node] };
}
const bound = { visionModel: 'v1::共享/视觉', visionProviderId: 'v1', imageModel: 'i1::共享/图像', imageProviderId: 'i1' };
function mount(wf = workflow(), options: { loading?: boolean; error?: string; catalog?: TaskModelDescriptor[]; userId?: string; projectId?: string } = {}): ReturnType<typeof render> {
  const models = options.catalog || catalog;
  const view = render(<NodeEditor workflow={wf} userId={options.userId ?? 'u1'} projectId={options.projectId ?? 'project-a'} taskModelCatalog={models}
    taskModelOptions={models.map(model => ({ id: model.modelId, name: model.modelId, type: model.kind === 'chat' ? 'chat' as const : 'image' as const, providerId: model.providerId, providerName: model.providerId }))}
    catalogStatus={{ loading: !!options.loading, error: options.error || null }} />);
  const card = document.querySelector('[data-workflow-node-id="image-node"]') || screen.getByText('独立草图生图');
  fireEvent.mouseDown(card, { button: 0 }); fireEvent.click(card); return view;
}
beforeEach(() => {
  requests = []; localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(url); requests.push({ url: path, ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
    if (path === '/api/workflow/execute') return Response.json({ executionId: 'execution-a', status: 'paused', results: {} });
    return Response.json({ skills: [], workflows: [] });
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('node editor Task9 image-only wiring', () => {
  it('has two role-filtered exact provider menus, neither default-selected and no start on mount', async () => {
    mount();
    const llm = await screen.findByRole('combobox', { name: '草图生图视觉模型' }) as HTMLSelectElement;
    const generator = screen.getByRole('combobox', { name: '草图生图图像模型' }) as HTMLSelectElement;
    expect(Array.from(llm.options).filter(option => option.value).map(option => option.value)).toEqual(['v1::共享/视觉', 'v2::共享/视觉']);
    expect(Array.from(generator.options).filter(option => option.value).map(option => option.value)).toEqual(['i1::共享/图像', 'i2::共享/图像']);
    expect(llm.value).toBe(''); expect(generator.value).toBe('');
    expect((screen.getByRole('button', { name: '执行工作流' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {}); expect(requests.some(item => /execute|sketch-to-image|cancel/.test(item.url))).toBe(false);
  });
  it('changing either role writes only that role and preserves instruction, input, size, quality and the common binding', async () => {
    const wf = workflow({ ...bound, model: 'old-model', providerId: 'old-provider', imageDataUrl: 'ORIGINAL_INPUT', size: 'user-size', quality: 'user-quality' });
    const before = JSON.stringify(wf); mount(wf);
    fireEvent.change(await screen.findByRole('combobox', { name: '草图生图视觉模型' }), { target: { value: 'v2::共享/视觉' } });
    expect((screen.getByRole('combobox', { name: '草图生图图像模型' }) as HTMLSelectElement).value).toBe('i1::共享/图像');
    fireEvent.change(screen.getByRole('combobox', { name: '草图生图图像模型' }), { target: { value: 'i2::共享/图像' } });
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' }));
    await waitFor(() => expect(requests.some(item => item.url === '/api/workflow/execute')).toBe(true));
    const submitted = requests.find(item => item.url === '/api/workflow/execute')!.body!.nodes as Workflow['nodes'];
    expect(submitted[0].config).toEqual({ instruction: '输入关键词', aspectRatio: '4:3', visionModel: 'v2::共享/视觉', visionProviderId: 'v2',
      imageModel: 'i2::共享/图像', imageProviderId: 'i2', model: 'old-model', providerId: 'old-provider', imageDataUrl: 'ORIGINAL_INPUT', size: 'user-size', quality: 'user-quality' });
    expect(JSON.stringify(wf)).toBe(before); expect(requests.some(item => item.url === '/api/sketch-to-image')).toBe(false);
  });
  it.each([{ loading: true }, { error: '目录不可用' }, { catalog: [vision, { ...image, supportsReferenceImages: false }] },
    { catalog: [{ ...vision, supportsVision: false }, image] }, { userId: '' }, { projectId: '' }])('blocks loading, insufficient capabilities or unknown authority %s', async options => {
    mount(workflow(bound), options); const run = screen.getByRole('button', { name: '执行工作流' }) as HTMLButtonElement;
    expect(run.disabled).toBe(true); fireEvent.click(run); await act(async () => {});
    expect(requests.filter(item => item.url === '/api/workflow/execute')).toEqual([]);
  });
  it.each([{ visionProviderId: 'v2' }, { imageProviderId: 'i2' }, { imageProviderId: '' }, { visionProviderId: '' },
    { imageModel: 'no-reference::共享/图像', imageProviderId: 'no-reference' }])('does not infer or normalize invalid role binding %s', async override => {
    mount(workflow({ ...bound, ...override })); expect((screen.getByRole('button', { name: '执行工作流' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {}); expect(requests.some(item => item.url === '/api/workflow/execute')).toBe(false);
  });
  it('includes nested image nodes in the catalog admission block', async () => {
    const wf = workflow(), nested = createWorkflowNode('subgraph', 0, 0);
    nested.id = 'image-node'; nested.label = '独立草图生图'; nested.config = { subgraph: { ...createEmptyWorkflow('子图'), nodes: wf.nodes } }; wf.nodes = [nested];
    mount(wf); expect((screen.getByRole('button', { name: '执行工作流' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('teaches both empty roles with no silent fallback', async () => {
    mount(workflow(), { catalog: [] });
    expect(await screen.findByText(/暂无可用的同步视觉聊天模型/)).toBeTruthy();
    expect(screen.getByText(/暂无支持参考图的图像模型/)).toBeTruthy();
  });
  it('restores only the safe image reference and fee/state projection, without HTML, raw source PNG or managed/external URLs', async () => {
    localStorage.setItem(cacheKey, JSON.stringify({ executionId: 'execution-a', execStatus: 'paused', execLogs: [], execResults: {
      'image-node': { status: 'success', output: { sketchImageReference: reference, imageUrl: 'data:image/png;base64,QUJD',
        generatedUrl: 'https://external.invalid/result.png', html: 'PRIVATE_HTML', privateInput: 'PRIVATE_INPUT',
        taskId: 'image-task', projectId: 'project-a', status: 'completed', phase: 'generation', progress: 100,
        reserveCredits: 13, actualCredits: 20, refunded: true, needsReconcile: false } } } }));
    mount(workflow(bound)); await screen.findByRole('button', { name: '预览生成图' });
    const cached = JSON.parse(localStorage.getItem(cacheKey)!) as { execResults: Record<string, { output: Record<string, unknown> }> };
    expect(cached.execResults['image-node'].output).toEqual({ sketchImageReference: reference, taskId: 'image-task', projectId: 'project-a', status: 'completed',
      phase: 'generation', progress: 100, reserveCredits: 13, actualCredits: 20, refunded: true, needsReconcile: false });
    expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByTitle('草图安全代码预览')).toBeNull();
    expect(screen.queryByRole('button', { name: '预览安全代码' })).toBeNull();
    await act(async () => {}); expect(requests.some(item => item.url === '/api/poll-task' || item.url === '/api/sketch-to-image')).toBe(false);
  });
});
