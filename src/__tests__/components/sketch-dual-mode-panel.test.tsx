// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import sharp from 'sharp';
import { SketchPlacement, type SketchInsert } from '@/lib/sketch-to-code/placement-client';
import type { SketchWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { SketchToCodePanel } from '@/components/sketch-to-code-panel';
import { createSketchPanelSession, SketchClient, type SketchScope, type SketchTask } from '@/lib/sketch-to-code/client';
import { appendSketchStroke } from '@/lib/sketch-to-code/drawing';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { createSketchImagePanelSession, SketchImageClient, type SketchImageTask } from '@/lib/sketch-to-code/image-client';

const binding = (provider: string): string => JSON.stringify([provider, 'same-model']);
let png: string;
const generated: Record<string, Buffer> = {};
const vision = (providerId = 'vision-a', extra: Partial<TaskModelDescriptor> = {}): TaskModelDescriptor => ({
  providerId, modelId: 'same-model', kind: 'chat', sourceType: 'chat', protocol: 'chat-completions', executionMode: 'sync', supportsVision: true,
  allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: [], capabilitySources: {}, ...extra,
});
const image = (providerId = 'image-a', extra: Partial<TaskModelDescriptor> = {}): TaskModelDescriptor => ({
  ...vision(providerId), kind: 'image', sourceType: 'image', supportsReferenceImages: true, maxReferenceImages: 1,
  supportedOperations: ['image-to-image'], outputKinds: ['image'], allowedRatios: ['4:3', '1:1'], allowedSizes: ['1024'], qualityOptions: ['standard'], ...extra,
});

const pricing = { version: 1 as const, vision: { providerId: 'vision-a', modelId: 'same-model', calls: 1 as const, mode: 'flat' as const, reserveCredits: 10 }, image: { providerId: 'image-a', modelId: 'same-model', calls: 1 as const, credits: 20 }, totalReserveCredits: 30 };
const imageTask = (extra: Partial<SketchImageTask> = {}): SketchImageTask => ({ taskId: 'image-task', projectId: 'project', visionProviderId: 'vision-a', visionModelId: 'same-model', imageProviderId: 'image-a', imageModelId: 'same-model', status: 'failed', progress: 60, reserveCredits: 30, pricing, ...extra });
const completed = (extra: Partial<SketchImageTask> = {}): SketchImageTask => imageTask({ status: 'completed', progress: 100, actualCredits: 12,
  previewAssetId: 'input-asset', previewAssetVersionId: 'input-version', imageAssetId: 'output-asset', imageAssetVersionId: 'output-version',
  previewUrl: '/api/serve-upload/input.png', imageUrl: '/api/serve-upload/output.png',
  analysis: { summary: '蓝色房子', composition: '草图居中', prompt: '水彩房子', negativePrompt: '模糊' }, ...extra });
const json = (task: SketchImageTask, status = 200): Response => new Response(JSON.stringify({ success: true, type: 'sketch-to-image', ...task }), { status, headers: { 'content-type': 'application/json' } });
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve };
}
function fixture() {
  const scope: SketchScope = { actorId: 'actor', projectId: 'project', key: 'scope', authority: 'legacy', assertCurrent: vi.fn() };
  const session = createSketchPanelSession(scope);
  const codeFetch = vi.fn<typeof fetch>(); session.client = new SketchClient(scope, codeFetch);
  session.history = appendSketchStroke(session.history, { id: 'dot', tool: 'pen', color: '#111827', width: 5, points: [{ x: 10, y: 20 }] });
  const noIO = vi.fn<typeof fetch>();
  const imageSession = createSketchImagePanelSession(scope); imageSession.client = new SketchImageClient(scope, noIO);
  return { scope, session, imageSession, noIO, codeFetch };
}
function ready(): ReturnType<typeof fixture> {
  const f = fixture(); f.imageSession.visionSelection = binding('vision-a'); f.imageSession.imageSelection = binding('image-a'); f.imageSession.instruction = '原关键词'; return f;
}
function show(f: ReturnType<typeof fixture>, extra: Partial<React.ComponentProps<typeof SketchToCodePanel>> = {}): ReturnType<typeof render> {
  return render(<SketchToCodePanel session={f.session} imageSession={f.imageSession} models={[vision(), vision('vision-b'), image(), image('image-b')]} {...extra} />);
}
async function restore(f: ReturnType<typeof fixture>, task: SketchImageTask): Promise<void> {
  f.noIO.mockResolvedValueOnce(json(task)); await f.imageSession.client.poll(task.taskId); f.noIO.mockClear();
}
async function blobBytes(blob: Blob): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer)); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob); });
}

beforeAll(async (): Promise<void> => {
  const pixels = { create: { width: 8, height: 6, channels: 4 as const, background: { r: 17, g: 60, b: 220, alpha: 1 } } };
  generated['image/png'] = await sharp(pixels).png().toBuffer(); generated['image/jpeg'] = await sharp(pixels).jpeg().toBuffer(); generated['image/webp'] = await sharp(pixels).webp().toBuffer();
  png = `data:image/png;base64,${generated['image/png'].toString('base64')}`;
});

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn() }) as unknown as CanvasRenderingContext2D);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:dual-preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => png);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('dual-mode drawer projection', () => {
  it('keeps an image admission mounted through minimize and receives its result without a duplicate submission', async () => {
    const f = ready(), late = deferred<Response>(); f.noIO.mockImplementationOnce(() => late.promise).mockResolvedValueOnce(json(completed()));
    show(f); const stop = vi.spyOn(f.imageSession.client, 'stop');
    fireEvent.click(screen.getByRole('button', { name: '生成图像' }));
    expect(f.noIO).toHaveBeenCalledTimes(1);
    const stoppedAtSubmission = stop.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '最小化草图窗口' }));
    expect(stop).toHaveBeenCalledTimes(stoppedAtSubmission);
    await act(async () => { late.resolve(json(completed())); });
    expect(f.imageSession.client.task?.status).toBe('completed');
    expect(screen.queryByRole('button', { name: '打开图像预览' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '恢复草图窗口' }));
    expect(screen.getByRole('button', { name: '打开图像预览' })).toBeDefined();
    expect(screen.getByLabelText('创作关键词')).toHaveProperty('value', '原关键词');
    expect(screen.getByLabelText('视觉分析模型')).toHaveProperty('value', binding('vision-a'));
    expect(screen.getByLabelText('图像生成模型')).toHaveProperty('value', binding('image-a'));
    expect(f.noIO.mock.calls.map(call => String(call[0]))).toEqual(['/api/sketch-to-image', '/api/poll-task']);
    expect(stop).toHaveBeenCalledTimes(stoppedAtSubmission); expect(f.session.history.present.strokes).toHaveLength(1);
  });
  it('uses exact admin catalog names in all sketch model menus without changing their identity or adding unauthorized models', () => {
    const f = fixture();
    const options = [
      { id: 'same-model', providerId: 'vision-a', providerName: '视觉供应商甲', type: 'chat' as const, name: '上游视觉名称', displayName: '管理员视觉名称' },
      { id: 'same-model', providerId: 'vision-b', providerName: '视觉供应商乙', type: 'chat' as const, name: '视觉模型乙' },
      { id: 'same-model', providerId: 'image-a', providerName: '图像供应商甲', type: 'image' as const, name: '上游图像名称', displayName: '管理员图像名称' },
      { id: 'same-model', providerId: 'image-b', providerName: '图像供应商乙', type: 'image' as const, name: '图像模型乙' },
      { id: 'hidden-model', providerId: 'not-authorized', providerName: '不应出现', type: 'image' as const, name: '未授权模型' },
    ];
    show(f, { modelOptions: options });
    const visionSelect = screen.getByLabelText('视觉分析模型') as HTMLSelectElement;
    const imageSelect = screen.getByLabelText('图像生成模型') as HTMLSelectElement;
    expect(Array.from(visionSelect.options, option => [option.text, option.value]).slice(1)).toEqual([
      ['视觉供应商甲 / 管理员视觉名称', binding('vision-a')], ['视觉供应商乙 / 视觉模型乙', binding('vision-b')],
    ]);
    expect(Array.from(imageSelect.options, option => [option.text, option.value]).slice(1)).toEqual([
      ['图像供应商甲 / 管理员图像名称', binding('image-a')], ['图像供应商乙 / 图像模型乙', binding('image-b')],
    ]);
    fireEvent.change(visionSelect, { target: { value: binding('vision-b') } });
    fireEvent.change(imageSelect, { target: { value: binding('image-b') } });
    expect(f.imageSession.visionSelection).toBe(binding('vision-b')); expect(f.imageSession.imageSelection).toBe(binding('image-b'));
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    expect(screen.getByRole('button', { name: '草图转代码' }).querySelector('[data-selection-mark]')).not.toBeNull();
    expect(screen.getByRole('button', { name: '草图生图' }).querySelector('[data-selection-mark]')).toBeNull();
    const codeSelect = screen.getByLabelText('视觉模型') as HTMLSelectElement;
    expect(Array.from(codeSelect.options, option => option.text).slice(1)).toEqual(['视觉供应商甲 / 管理员视觉名称', '视觉供应商乙 / 视觉模型乙']);
    expect(f.codeFetch).not.toHaveBeenCalled(); expect(f.noIO).not.toHaveBeenCalled();
  });
  it('only a supplied image session enables image-first keywords; legacy callers still start in code', () => {
    const f = fixture(); const view = render(<SketchToCodePanel session={f.session} imageSession={f.imageSession} />);
    expect(screen.getByRole('button', { name: '草图生图' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('创作关键词')).toBeDefined();
    expect(screen.queryByRole('textbox', { name: '页面说明' })).toBeNull();
    view.unmount(); render(<SketchToCodePanel session={f.session} />);
    expect(screen.getByLabelText('页面说明')).toBeDefined();
    expect(screen.queryByRole('button', { name: '草图生图' })).toBeNull();
  });

  it('existing initialTrace overrides image default and restores only the original authorized HTML document', async () => {
    const f = ready(); f.session.instruction = '原页面说明'; f.session.selection = binding('vision-b');
    await restore(f, completed());
    const history = f.session.history;
    f.codeFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, type: 'sketch-to-code',
      taskId: 'old-code-task', projectId: 'project', providerId: 'vision-b', modelId: 'same-model', status: 'completed', progress: 100,
      reserveCredits: 20, actualCredits: 12, previewAssetId: 'old-input', previewAssetVersionId: 'old-input-version',
      htmlAssetId: 'old-html', htmlAssetVersionId: 'old-html-version', analysis: '原HTML布局' })))
      .mockResolvedValueOnce(new Response('<p>原文档</p>', { headers: { 'content-type': 'text/html' } }));
    show(f, { initialTrace: { source: 'sketch-to-code', taskId: 'old-code-task', projectId: 'project',
      previewAssetVersionId: 'old-input-version', htmlAssetVersionId: 'old-html-version', createdAt: '2026-10-13T00:00:00.000Z' } });
    expect(screen.getByRole('button', { name: '草图转代码' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('textbox', { name: '创作关键词' })).toBeNull();
    await screen.findByText('原HTML布局');
    expect(f.codeFetch).toHaveBeenCalledTimes(1);
    expect(f.codeFetch.mock.calls[0][0]).toBe('/api/poll-task');
    expect(JSON.parse(String(f.codeFetch.mock.calls[0][1]?.body))).toEqual({ taskId: 'old-code-task', projectId: 'project' });
    fireEvent.click(screen.getByRole('button', { name: '打开代码预览' }));
    const frame = await screen.findByTitle('安全静态代码预览'); expect(frame.getAttribute('sandbox')).toBe('');
    expect(f.codeFetch.mock.calls[1][0]).toBe('/api/sketch-to-code/old-code-task/document?projectId=project');
    expect(f.codeFetch.mock.calls[1][1]?.method).toBe('GET');
    const bytes = await blobBytes(vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob);
    expect(bytes.toString('utf8')).toBe('<p>原文档</p>');
    expect((screen.getByLabelText('页面说明') as HTMLTextAreaElement).value).toBe('原页面说明');
    expect((screen.getByLabelText('视觉模型') as HTMLSelectElement).value).toBe(binding('vision-b'));
    fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    expect((screen.getByLabelText('创作关键词') as HTMLTextAreaElement).value).toBe('原关键词');
    expect((screen.getByLabelText('视觉分析模型') as HTMLSelectElement).value).toBe(binding('vision-a'));
    expect((screen.getByLabelText('图像生成模型') as HTMLSelectElement).value).toBe(binding('image-a'));
    expect(f.imageSession.client.task?.taskId).toBe('image-task'); expect(f.session.client.task?.taskId).toBe('old-code-task');
    expect(f.session.history).toBe(history); expect(f.session.history.present.strokes).toHaveLength(1);
    expect(f.noIO).not.toHaveBeenCalled(); expect(f.codeFetch).toHaveBeenCalledTimes(2);
  });

  it('foreign initialTrace stays in code and denies restore instead of silently falling back to image', () => {
    const f = ready(); show(f, { initialTrace: { source: 'sketch-to-code', taskId: 'old-code-task', projectId: 'other-project',
      previewAssetVersionId: 'old-input-version', htmlAssetVersionId: 'old-html-version', createdAt: '2026-10-13T00:00:00.000Z' } });
    expect(screen.getByRole('button', { name: '草图转代码' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('alert').textContent).toMatch(/来源提示不属于当前项目/);
    expect(screen.queryByRole('textbox', { name: '创作关键词' })).toBeNull();
    expect(screen.queryByTitle('安全静态代码预览')).toBeNull();
    expect(f.codeFetch).not.toHaveBeenCalled(); expect(f.noIO).not.toHaveBeenCalled();
    expect(f.session.history.present.strokes).toHaveLength(1);
  });

  it('offers explicit role-separated exact bindings, filters non-reference generators and never selects defaults', () => {
    const f = fixture(); render(<SketchToCodePanel session={f.session} imageSession={f.imageSession}
      models={[vision(), vision('vision-b'), vision('no-vision', { supportsVision: false }), vision('async', { executionMode: 'async' }), image(), image('image-b'), image('text-only', { supportsReferenceImages: false }), image('no-output', { outputKinds: [] }), image('no-operation', { supportedOperations: ['text-to-image'] })]} />);
    const llm = screen.getByLabelText('视觉分析模型') as HTMLSelectElement;
    const generator = screen.getByLabelText('图像生成模型') as HTMLSelectElement;
    expect(Array.from(llm.options, option => option.value)).toEqual(['', binding('vision-a'), binding('vision-b')]);
    expect(Array.from(generator.options, option => option.value)).toEqual(['', binding('image-a'), binding('image-b')]);
    expect(llm.value).toBe(''); expect(generator.value).toBe('');
    expect((screen.getByRole('button', { name: '生成图像' }) as HTMLButtonElement).disabled).toBe(true);
    expect(f.noIO).not.toHaveBeenCalled();
  });

  it('switches display without clearing shared strokes or either instruction and exact model selection', () => {
    const f = fixture(); f.session.instruction = 'code-layout'; f.session.selection = binding('vision-b');
    const stopCode = vi.spyOn(f.session.client, 'stop');
    render(<SketchToCodePanel session={f.session} imageSession={f.imageSession} models={[vision(), vision('vision-b'), image(), image('image-b')]} />);
    fireEvent.change(screen.getByLabelText('创作关键词'), { target: { value: 'image-keywords' } });
    fireEvent.change(screen.getByLabelText('视觉分析模型'), { target: { value: binding('vision-a') } });
    fireEvent.change(screen.getByLabelText('图像生成模型'), { target: { value: binding('image-b') } });
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    expect((screen.getByLabelText('页面说明') as HTMLTextAreaElement).value).toBe('code-layout');
    expect((screen.getByLabelText('视觉模型') as HTMLSelectElement).value).toBe(binding('vision-b'));
    fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    expect((screen.getByLabelText('创作关键词') as HTMLTextAreaElement).value).toBe('image-keywords');
    expect((screen.getByLabelText('图像生成模型') as HTMLSelectElement).value).toBe(binding('image-b'));
    expect(f.session.history.present.strokes).toHaveLength(1);
    expect(f.noIO).not.toHaveBeenCalled(); expect(stopCode).toHaveBeenCalled();
  });

  it('projects each retained task and real net fee independently without pretending partial refunds are full', async () => {
    const f = fixture(); f.session.client.task = { taskId: 'code-task', projectId: 'project', providerId: 'vision-a', modelId: 'same-model', status: 'failed', progress: 40, reserveCredits: 20 };
    await restore(f, completed());
    render(<SketchToCodePanel session={f.session} imageSession={f.imageSession} />);
    expect(screen.getByText('任务：image-task')).toBeDefined(); expect(screen.getByText('预留额度：30；实际净费：12')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    expect(screen.getByText('任务：code-task')).toBeDefined(); expect(screen.getByText('预留额度：20；实际净费：尚未确认')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    expect(screen.getByText('任务：image-task')).toBeDefined(); expect(screen.queryByText(/服务端确认已退还预留额度/)).toBeNull();
    expect(f.noIO).not.toHaveBeenCalled();
  });

  it.each(['button', 'escape'])('true close (%s) stops both clients even when the parent does not immediately unmount', method => {
    const f = fixture(); const stopCode = vi.spyOn(f.session.client, 'stop'); const close = vi.fn();
    const stopImage = vi.spyOn(f.imageSession.client, 'stop');
    render(<SketchToCodePanel session={f.session} imageSession={f.imageSession} onClose={close} />);
    if (method === 'button') fireEvent.click(screen.getByRole('button', { name: '关闭草图创作' }));
    else fireEvent.keyDown(screen.getByRole('region', { name: '草图创作' }), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1); expect(stopCode).toHaveBeenCalled(); expect(stopImage).toHaveBeenCalled();
    expect(f.noIO).not.toHaveBeenCalled();
  });
});

describe('image panel real-client boundaries (synthetic bytes, no network)', () => {
  it('posts original PNG and two exact bindings/parameters, then unknown reconciliation replays the frozen intent after edits', async () => {
    const f = ready(); f.noIO.mockRejectedValueOnce(new Error('lost ACK')).mockResolvedValueOnce(json(imageTask({ status: 'processing', phase: 'analysis', progress: 10 }), 202));
    show(f);
    fireEvent.change(screen.getByLabelText('图像尺寸'), { target: { value: '1024' } });
    fireEvent.change(screen.getByLabelText('图像质量'), { target: { value: 'standard' } });
    fireEvent.change(screen.getByLabelText('画面比例'), { target: { value: '1:1' } });
    fireEvent.click(screen.getByRole('button', { name: '生成图像' }));
    await screen.findByText(/受理结果未知/);
    expect(f.noIO).toHaveBeenCalledTimes(1);
    const posted = JSON.parse(String(f.noIO.mock.calls[0][1]?.body));
    expect(posted).toEqual({ projectId: 'project', imageDataUrl: png, instruction: '原关键词', visionProviderId: 'vision-a', visionModelId: 'same-model', imageProviderId: 'image-a', imageModelId: 'same-model', idempotencyKey: expect.any(String), aspectRatio: '1:1', size: '1024', quality: 'standard' });
    expect(Object.isFrozen(f.imageSession.client.input)).toBe(true);
    fireEvent.change(screen.getByLabelText('创作关键词'), { target: { value: '后续编辑' } });
    fireEvent.change(screen.getByLabelText('视觉分析模型'), { target: { value: binding('vision-b') } });
    fireEvent.change(screen.getByLabelText('图像生成模型'), { target: { value: binding('image-b') } });
    fireEvent.change(screen.getByLabelText('画面比例'), { target: { value: '4:3' } });
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' })); fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    expect(f.noIO).toHaveBeenCalledTimes(1); expect(f.codeFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '核对原提交（相同标识）' }));
    await screen.findByText('分析中 · 10%');
    expect(f.noIO).toHaveBeenCalledTimes(2); expect(f.noIO.mock.calls[1][1]?.body).toBe(f.noIO.mock.calls[0][1]?.body);
    expect((screen.getByLabelText('创作关键词') as HTMLTextAreaElement).value).toBe('后续编辑');
    expect(f.session.history.present.strokes).toHaveLength(1); expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(1);
  });

  it('known reconcile task only polls, and does not automatically retry dispatch or expose unsafe completion', async () => {
    const f = ready(); await restore(f, imageTask({ status: 'processing', phase: 'generation', needsReconcile: true }));
    f.noIO.mockResolvedValueOnce(json(imageTask({ status: 'processing', phase: 'generation', progress: 80 })));
    show(f); expect(screen.getByText('任务待核对 · 60%')).toBeDefined(); expect(f.noIO).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '打开图像预览' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '核对任务状态' })); await screen.findByText('生图中 · 80%');
    expect(f.noIO.mock.calls.map(call => String(call[0]))).toEqual(['/api/poll-task']);
    expect(JSON.parse(String(f.noIO.mock.calls[0][1]?.body))).toEqual({ taskId: 'image-task', projectId: 'project' });
  });

  it.each(['needsReconcile', 'dispatchPending', 'recoveryPending'] as const)('completed %s cannot enable preview/download/placement', async flag => {
    const f = ready(); await restore(f, completed({ [flag]: true })); show(f);
    for (const name of ['打开图像预览', '下载生成图像', '添加生成图到画布']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByText('任务待核对 · 100%')).toBeDefined(); expect(f.noIO).not.toHaveBeenCalled();
  });

  it.each([0, 12, 42])('displays actual net fee %i, not a reserve cap or invented full refund', async actualCredits => {
    const f = ready(); await restore(f, completed({ actualCredits })); show(f);
    expect(screen.getByText(`预留额度：30；实际净费：${actualCredits}`)).toBeDefined();
    expect(screen.getByText(/返差额不等于全额退款/)).toBeDefined(); expect(screen.queryByText(/服务端确认已退还预留额度/)).toBeNull();
  });

  it('rejection preserves keywords, selections and drawing without claiming processing or refund', async () => {
    const f = ready(); f.noIO.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: 'MODEL_DENIED' }), { status: 403, headers: { 'content-type': 'application/json' } }));
    show(f); fireEvent.click(screen.getByRole('button', { name: '生成图像' })); await screen.findByText(/生图受理未确认/);
    expect(f.imageSession.client.task).toBeUndefined(); expect(f.imageSession.client.admissionUnknown).toBe(false);
    expect(f.imageSession.instruction).toBe('原关键词'); expect(f.imageSession.imageSelection).toBe(binding('image-a'));
    expect(f.session.history.present.strokes).toHaveLength(1); expect(screen.queryByText(/受理结果未知|服务端确认已退还预留额度/)).toBeNull();
    expect(f.noIO).toHaveBeenCalledTimes(1);
  });

  it('unknown cancellation preserves original processing status, fee and error across a mode switch; 409 only polls', async () => {
    const f = ready(); await restore(f, imageTask({ status: 'processing', phase: 'generation' }));
    f.noIO.mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })).mockResolvedValueOnce(new Response('{}', { status: 409, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(json(imageTask({ status: 'processing', phase: 'generation' })));
    show(f); fireEvent.click(screen.getByRole('button', { name: '取消任务（等待确认）' })); await screen.findByText(/取消结果未确认/);
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' })); fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    expect(screen.getByText(/取消结果未确认/)).toBeDefined(); expect(f.imageSession.client.task?.status).toBe('processing');
    expect(screen.queryByText(/已取消（服务端确认）|服务端确认已退还预留额度/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取消任务（等待确认）' })); await waitFor(() => expect(f.noIO).toHaveBeenCalledTimes(3));
    expect(f.noIO.mock.calls.map(call => String(call[0]))).toEqual(['/api/cancel-task', '/api/cancel-task', '/api/poll-task']);
    expect(f.imageSession.client.task?.status).toBe('processing'); expect(f.session.history.present.strokes).toHaveLength(1);
  });

  it.each([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']])('previews/downloads fresh managed %s bytes with .%s, never input PNG or external result URL', async (mime, extension) => {
    const f = ready(); await restore(f, completed());
    f.noIO.mockImplementation(async url => String(url) === '/api/poll-task' ? json(completed()) : new Response(new Uint8Array(generated[mime]), { headers: { 'content-type': mime } }));
    const filenames: string[] = []; vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement): void { filenames.push(this.download); });
    show(f); fireEvent.click(screen.getByRole('button', { name: '打开图像预览' }));
    const preview = await screen.findByAltText('受权生成图像预览'); expect(preview.getAttribute('src')).toBe('blob:dual-preview');
    expect(screen.queryByTitle('安全静态代码预览')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下载生成图像' })); await waitFor(() => expect(filenames).toEqual([`sketch-image.${extension}`]));
    expect(f.noIO.mock.calls.map(call => String(call[0]))).toEqual(['/api/poll-task', '/api/serve-upload/output.png', '/api/poll-task', '/api/serve-upload/output.png']);
    const bytes = vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob;
    expect(bytes.type).toBe(mime); expect(await blobBytes(bytes)).toEqual(generated[mime]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:dual-preview'); expect(f.session.history.present.strokes).toHaveLength(1);
  });

  it.each(['close', 'escape', 'permission', 'mode', 'unmount'])('rejects late binary result after %s; no new Blob/download or server cancel', async reason => {
    const f = ready(); await restore(f, completed()); const late = deferred<Response>();
    f.noIO.mockResolvedValueOnce(json(completed())).mockImplementationOnce(() => late.promise);
    const stopCode = vi.spyOn(f.session.client, 'stop'), stopImage = vi.spyOn(f.imageSession.client, 'stop');
    const view = show(f); fireEvent.click(screen.getByRole('button', { name: '下载生成图像' }));
    await waitFor(() => expect(f.noIO).toHaveBeenCalledTimes(2));
    if (reason === 'close') fireEvent.click(screen.getByRole('button', { name: '关闭草图创作' }));
    if (reason === 'escape') fireEvent.keyDown(screen.getByRole('region', { name: '草图创作' }), { key: 'Escape' });
    if (reason === 'mode') fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    if (reason === 'unmount') view.unmount();
    if (reason === 'permission') { vi.mocked(f.scope.assertCurrent).mockImplementation(() => { throw new Error('revoked'); }); view.rerender(<SketchToCodePanel session={f.session} imageSession={f.imageSession} />); }
    await act(async () => { late.resolve(new Response(new Uint8Array(generated['image/png']), { headers: { 'content-type': 'image/png' } })); await Promise.resolve(); });
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(stopImage).toHaveBeenCalled(); if (reason !== 'mode') expect(stopCode).toHaveBeenCalled();
    expect(f.noIO.mock.calls.map(call => String(call[0]))).toEqual(['/api/poll-task', '/api/serve-upload/output.png']);
    expect(f.session.history.present.strokes).toHaveLength(1);
  });

  it('revokes each mode Blob on true close and keeps the old code empty sandbox/HTML download in dual mode', async () => {
    const f = ready(); await restore(f, completed());
    f.session.client.task = { taskId: 'code-task', projectId: 'project', providerId: 'vision-a', modelId: 'same-model', status: 'completed', progress: 100, reserveCredits: 20, actualCredits: 12, previewAssetId: 'code-input', previewAssetVersionId: 'code-v1', htmlAssetId: 'html-asset', htmlAssetVersionId: 'html-version', analysis: '旧安全HTML' };
    f.noIO.mockImplementation(async url => String(url) === '/api/poll-task' ? json(completed()) : new Response(new Uint8Array(generated['image/png']), { headers: { 'content-type': 'image/png' } }));
    f.codeFetch.mockImplementation(async () => new Response('<p>safe static page</p>', { headers: { 'content-type': 'text/html' } }));
    let index = 0; vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:mode-${++index}`);
    show(f); fireEvent.click(screen.getByRole('button', { name: '打开图像预览' })); await screen.findByAltText('受权生成图像预览');
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' })); fireEvent.click(screen.getByRole('button', { name: '打开代码预览' }));
    const frame = await screen.findByTitle('安全静态代码预览'); expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('src')).toBe('blob:mode-2');
    expect(f.codeFetch.mock.calls[0][0]).toBe('/api/sketch-to-code/code-task/document?projectId=project');
    const names: string[] = []; vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement): void { names.push(this.download); });
    fireEvent.click(screen.getByRole('button', { name: '下载HTML' })); await waitFor(() => expect(names).toEqual(['sketch-code.html']));
    const html = vi.mocked(URL.createObjectURL).mock.calls[2][0] as Blob;
    expect((await blobBytes(html)).toString('utf8')).toBe('<p>safe static page</p>');
    fireEvent.click(screen.getByRole('button', { name: '草图生图' })); expect(screen.getByAltText('受权生成图像预览').getAttribute('src')).toBe('blob:mode-1');
    fireEvent.click(screen.getByRole('button', { name: '关闭草图创作' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mode-1'); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mode-2'); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mode-3');
  });

  it.each([{ loading: true, error: null }, { loading: false, error: 'offline' }])('catalog unavailable prevents image admission without discarding input: %j', catalogStatus => {
    const f = ready(); show(f, { catalogStatus });
    expect((screen.getByRole('button', { name: '生成图像' }) as HTMLButtonElement).disabled).toBe(true); expect(f.noIO).not.toHaveBeenCalled();
    expect(f.imageSession.instruction).toBe('原关键词');
  });

  it('retained incompatible parameters and overlong keywords require correction rather than silent defaults', () => {
    const f = ready(); f.imageSession.aspectRatio = '16:9'; f.imageSession.instruction = '字'.repeat(4097); show(f);
    expect((screen.getByLabelText('创作关键词') as HTMLTextAreaElement).value).toHaveLength(4097);
    expect(screen.getByLabelText('创作关键词').getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: '生成图像' }) as HTMLButtonElement).disabled).toBe(true); expect(f.imageSession.aspectRatio).toBe('16:9');
    fireEvent.change(screen.getByLabelText('创作关键词'), { target: { value: '已缩短' } });
    expect((screen.getByRole('button', { name: '生成图像' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('画面比例'), { target: { value: '4:3' } });
    expect((screen.getByRole('button', { name: '生成图像' }) as HTMLButtonElement).disabled).toBe(false); expect(f.noIO).not.toHaveBeenCalled();
  });

  it('a foreign image session is disabled and stopped, not paired with the shared drawing project', () => {
    const f = ready(); f.imageSession.client = new SketchImageClient({ ...f.scope, projectId: 'other', key: 'other' }, f.noIO);
    const codeStop = vi.spyOn(f.session.client, 'stop'), imageStop = vi.spyOn(f.imageSession.client, 'stop'); show(f);
    expect((screen.getByRole('button', { name: '生成图像' }) as HTMLButtonElement).disabled).toBe(true);
    expect(codeStop).toHaveBeenCalled(); expect(imageStop).toHaveBeenCalled(); expect(f.noIO).not.toHaveBeenCalled();
  });

  it('replacing project sessions clears old result projection and Blob while retaining only the new project input', async () => {
    const f = ready(); await restore(f, completed());
    f.noIO.mockImplementation(async url => String(url) === '/api/poll-task' ? json(completed()) : new Response(new Uint8Array(generated['image/png']), { headers: { 'content-type': 'image/png' } }));
    const view = show(f); fireEvent.click(screen.getByRole('button', { name: '打开图像预览' })); await screen.findByAltText('受权生成图像预览');
    const otherScope: SketchScope = { actorId: 'actor', projectId: 'other-project', key: 'other-key', authority: 'legacy', assertCurrent: (): void => {} };
    const otherCode = createSketchPanelSession(otherScope), otherImage = createSketchImagePanelSession(otherScope);
    view.rerender(<SketchToCodePanel session={otherCode} imageSession={otherImage} models={[vision(), image()]} />);
    expect(screen.queryByRole('button', { name: '打开图像预览' })).toBeNull(); expect(screen.queryByAltText('受权生成图像预览')).toBeNull();
    expect(screen.queryByText('任务：image-task')).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:dual-preview');
    expect(otherCode.history.present.strokes).toHaveLength(0); expect(f.session.history.present.strokes).toHaveLength(1);
  });

  it('uses the real generated-image placement with output-only transfer, unknown ACK replay and once-only independent insertion', async () => {
    const f = ready(); await restore(f, completed()); f.noIO.mockResolvedValueOnce(json(completed()));
    const insert = vi.fn<SketchInsert>(async (): Promise<void> => {});
    const transfers: Record<string, unknown>[] = []; const calls: string[] = []; let receipt: Record<string, unknown> | undefined;
    const assets: typeof fetch = async (url, init): Promise<Response> => {
      const path = String(url); calls.push(path);
      const asset = { kind: 'image', assetId: 'output-asset', assetVersionId: 'output-version', url: '/api/serve-upload/output.png' };
      if (path === '/api/poll-task') return json(completed());
      if (path === '/api/assets/transfer') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>; transfers.push(body);
        if (transfers.length === 1) throw new Error('transfer ACK lost');
        receipt = { ...asset, placementId: 'placement', placementStatus: 'active', reused: true, entityId: body.entityId };
        return new Response(JSON.stringify(receipt), { headers: { 'content-type': 'application/json' } });
      }
      if (path === '/api/assets?projectId=project&assetVersionId=output-version') return new Response(JSON.stringify(asset), { headers: { 'content-type': 'application/json' } });
      if (path === '/api/assets?projectId=project&assetVersionId=output-version&placementId=placement' && receipt) return new Response(JSON.stringify(receipt), { headers: { 'content-type': 'application/json' } });
      throw new Error(`unexpected asset request: ${path}`);
    };
    vi.stubGlobal('fetch', assets); show(f, { insert });
    fireEvent.click(screen.getByRole('button', { name: '核对任务状态' })); await waitFor(() => expect(f.imageSession.placement).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '添加生成图到画布' }));
    await waitFor(() => { expect(transfers).toHaveLength(1); expect((screen.getByRole('button', { name: '添加生成图到画布' }) as HTMLButtonElement).disabled).toBe(false); });
    expect(insert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '添加生成图到画布' })); await screen.findByText('生成图像已新增到画布，原始草图保持不变');
    expect(transfers).toHaveLength(2); expect(transfers[1]).toEqual(transfers[0]);
    expect(transfers[0]).toMatchObject({ sourceVersion: 'output-version', targetProject: 'project', targetWorkspace: 'canvas:project', entityType: 'canvas-image', entityId: expect.stringMatching(/^sketch-image-/), idempotencyKey: expect.stringMatching(/^sketch-image-placement-/) });
    expect(insert).toHaveBeenCalledTimes(1); expect(insert.mock.calls[0][0]).toMatchObject({ assetId: 'output-asset', assetVersionId: 'output-version', placementId: 'placement' });
    expect(calls.some(path => path.includes('input-version'))).toBe(false); expect(f.session.history.present.strokes).toHaveLength(1);
    const count = calls.length; fireEvent.click(screen.getByRole('button', { name: '添加生成图到画布' })); await waitFor(() => expect((screen.getByRole('button', { name: '添加生成图到画布' }) as HTMLButtonElement).disabled).toBe(false));
    expect(insert).toHaveBeenCalledTimes(1); expect(calls).toHaveLength(count); expect(f.codeFetch).not.toHaveBeenCalled();
  });

  it('document authority allows image reading but does not activate postponed collaborative placement', async () => {
    const f = ready(); f.scope.authority = 'document'; f.imageSession.client = new SketchImageClient(f.scope, f.noIO);
    await restore(f, completed()); f.noIO.mockResolvedValueOnce(json(completed()));
    show(f, { insert: async (): Promise<void> => { throw new Error('document insertion forbidden'); } });
    fireEvent.click(screen.getByRole('button', { name: '核对任务状态' })); await waitFor(() => expect(f.imageSession.placement).toBeDefined());
    expect((screen.getByRole('button', { name: '添加生成图到画布' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '下载生成图像' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(['close', 'mode', 'permission'])('late admission after %s stays unknown with the same frozen input and never publishes a result', async reason => {
    const f = ready(), late = deferred<Response>(); f.noIO.mockImplementationOnce(() => late.promise);
    const view = show(f); fireEvent.click(screen.getByRole('button', { name: '生成图像' }));
    expect(f.noIO).toHaveBeenCalledTimes(1); const original = f.imageSession.client.input;
    if (reason === 'close') fireEvent.click(screen.getByRole('button', { name: '关闭草图创作' }));
    if (reason === 'mode') fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    if (reason === 'permission') { vi.mocked(f.scope.assertCurrent).mockImplementation(() => { throw new Error('revoked'); }); view.rerender(<SketchToCodePanel session={f.session} imageSession={f.imageSession} />); }
    await act(async () => { late.resolve(json(completed())); await Promise.resolve(); });
    expect(f.imageSession.client.task).toBeUndefined(); expect(f.imageSession.client.admissionUnknown).toBe(true); expect(f.imageSession.client.input).toBe(original);
    expect(f.noIO).toHaveBeenCalledTimes(1); expect(f.codeFetch).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
    if (reason === 'mode') { fireEvent.click(screen.getByRole('button', { name: '草图生图' })); expect(screen.getByRole('button', { name: '核对原提交（相同标识）' })).toBeDefined(); }
    expect(f.session.history.present.strokes).toHaveLength(1);
  });

  it('switching during an active image poll pauses the old read without cancel/start, and rejects its late status', async () => {
    const f = ready(); await restore(f, imageTask({ status: 'processing', phase: 'generation', progress: 50 }));
    const late = deferred<Response>(); f.noIO.mockImplementationOnce(() => late.promise); show(f);
    fireEvent.click(screen.getByRole('button', { name: '核对任务状态' })); expect(f.noIO).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    await act(async () => { late.resolve(json(completed())); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    expect(screen.getByText('生图中 · 50%')).toBeDefined(); expect(screen.queryByRole('button', { name: '打开图像预览' })).toBeNull();
    expect(f.noIO.mock.calls.map(call => String(call[0]))).toEqual(['/api/poll-task']); expect(f.imageSession.client.task?.status).toBe('processing');
  });

  it('fresh image admission removes only its old delivery and preserves the code result and shared drawing', async () => {
    const f = ready(); await restore(f, completed()); f.noIO.mockImplementation(async url => String(url) === '/api/poll-task' ? json(completed()) : new Response(new Uint8Array(generated['image/png']), { headers: { 'content-type': 'image/png' } }));
    f.session.client.task = { taskId: 'code-task', projectId: 'project', providerId: 'vision-a', modelId: 'same-model', status: 'completed', progress: 100, reserveCredits: 20, actualCredits: 12, previewAssetId: 'code-input', previewAssetVersionId: 'code-v1', htmlAssetId: 'html-asset', htmlAssetVersionId: 'html-version', analysis: '保留代码结果' };
    show(f); fireEvent.click(screen.getByRole('button', { name: '打开图像预览' })); await screen.findByAltText('受权生成图像预览');
    const late = deferred<Response>(); f.noIO.mockImplementationOnce(() => late.promise);
    fireEvent.click(screen.getByRole('button', { name: '生成新图像（新提交）' }));
    expect(screen.queryByAltText('受权生成图像预览')).toBeNull(); expect(screen.queryByRole('button', { name: '下载生成图像' })).toBeNull(); expect(f.imageSession.placement).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' })); expect(screen.getByText('保留代码结果')).toBeDefined(); expect(screen.getByRole('button', { name: '下载HTML' })).toBeDefined();
    await act(async () => { late.resolve(json(imageTask({ status: 'processing' }))); await Promise.resolve(); });
    expect(f.session.client.task?.taskId).toBe('code-task'); expect(f.session.history.present.strokes).toHaveLength(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:dual-preview');
  });

  it('read-only project keeps protected task reads available but disables generation, cancellation and placement', async () => {
    const f = ready(); vi.mocked(f.scope.assertCurrent).mockImplementation(write => { if (write) throw new Error('read-only'); });
    await restore(f, imageTask({ status: 'processing', phase: 'analysis' })); show(f);
    expect((screen.getByRole('button', { name: '生成新图像（新提交）' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '取消任务（等待确认）' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '核对任务状态' }) as HTMLButtonElement).disabled).toBe(false); expect(f.noIO).not.toHaveBeenCalled();
  });

  it('shared history remains undoable/redone across modes and original PNG download never uses the generated output', () => {
    const f = ready(); const names: { filename: string; url: string }[] = [];
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement): void { names.push({ filename: this.download, url: this.getAttribute('href') ?? '' }); });
    show(f); fireEvent.click(screen.getByRole('button', { name: '撤销' })); expect(f.session.history.present.strokes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' })); fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(f.session.history.present.strokes).toHaveLength(1); fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    fireEvent.click(screen.getByRole('button', { name: '下载草图PNG' })); expect(names).toEqual([{ filename: 'input-sketch.png', url: png }]); expect(f.noIO).not.toHaveBeenCalled();
  });

  it('replacing sessions while code polling is busy releases the old local gate so a new-project code intent can start', async () => {
    const f = ready(), late = deferred<Response>();
    f.session.client.task = { taskId: 'old-code', projectId: 'project', providerId: 'vision-a', modelId: 'same-model', status: 'processing', progress: 10, reserveCredits: 20 };
    f.codeFetch.mockImplementationOnce(() => late.promise);
    const view = show(f); fireEvent.click(screen.getByRole('button', { name: '草图转代码' })); fireEvent.click(screen.getByRole('button', { name: '核对任务状态' }));
    const current = { ...f.scope, projectId: 'new-project', key: 'new-key' }, other = createSketchPanelSession(current), otherImage = createSketchImagePanelSession(current);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true, type: 'sketch-to-code', taskId: 'new-code', projectId: 'new-project', providerId: 'vision-a', modelId: 'same-model', status: 'failed', progress: 0, reserveCredits: 20 })));
    other.client = new SketchClient(current, fetcher); other.selection = binding('vision-a'); other.history = f.session.history;
    view.rerender(<SketchToCodePanel session={other} imageSession={otherImage} models={[vision(), image()]} />);
    fireEvent.click(screen.getByRole('button', { name: '生成代码' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(async () => { late.resolve(new Response(JSON.stringify({ success: true, type: 'sketch-to-code', ...f.session.client.task, status: 'completed' }))); await Promise.resolve(); });
    expect(other.client.task?.taskId).toBe('new-code'); expect(screen.queryByText(/任务：old-code/)).toBeNull(); expect(f.imageSession.client.task).toBeUndefined();
  });

  it('loss of either supplied scope disables the other mode result controls too, not only its generation button', async () => {
    const f = ready(), imageAuthority = vi.fn(); f.imageSession.client = new SketchImageClient({ ...f.scope, assertCurrent: imageAuthority }, f.noIO);
    await restore(f, completed());
    f.session.client.task = { taskId: 'code-task', projectId: 'project', providerId: 'vision-a', modelId: 'same-model', status: 'completed', progress: 100, reserveCredits: 20, actualCredits: 12, previewAssetId: 'code-input', previewAssetVersionId: 'code-v1', htmlAssetId: 'html-asset', htmlAssetVersionId: 'html-version', analysis: '代码' };
    const view = show(f); fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    imageAuthority.mockImplementation(() => { throw new Error('image scope revoked'); }); view.rerender(<SketchToCodePanel session={f.session} imageSession={f.imageSession} />);
    expect((screen.getByRole('button', { name: '打开代码预览' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '下载HTML' }) as HTMLButtonElement).disabled).toBe(true); expect(f.codeFetch).not.toHaveBeenCalled();
  });
});

const fixCodeTask = (): SketchTask => ({ taskId: 'restored-code', projectId: 'project', providerId: 'vision-b', modelId: 'same-model',
  status: 'completed', progress: 100, reserveCredits: 20, actualCredits: 12, previewAssetId: 'restored-input',
  previewAssetVersionId: 'restored-input-version', htmlAssetId: 'restored-html', htmlAssetVersionId: 'restored-html-version', analysis: '恢复的原代码布局' });
const fixTrace = (): SketchWorkspaceSourceTrace => ({ source: 'sketch-to-code', taskId: 'restored-code', projectId: 'project',
  previewAssetVersionId: 'restored-input-version', htmlAssetVersionId: 'restored-html-version', createdAt: '2026-10-13T00:00:00.000Z' });
function serveFixCode(f: ReturnType<typeof fixture>): void {
  f.codeFetch.mockImplementation(async (url, init): Promise<Response> => {
    if (url === '/api/poll-task') {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ taskId: 'restored-code', projectId: 'project' });
      expect(init?.credentials).toBe('same-origin'); expect(init?.cache).toBe('no-store');
      expect(init?.headers).toMatchObject({ 'x-wujie-expected-actor-id': 'actor' });
      return new Response(JSON.stringify({ success: true, type: 'sketch-to-code', ...fixCodeTask() }));
    }
    if (url === '/api/sketch-to-code/restored-code/document?projectId=project') {
      expect(init?.method).toBe('GET'); expect(init?.credentials).toBe('same-origin');
      return new Response('<p>恢复的原受权文档</p>', { headers: { 'content-type': 'text/html' } });
    }
    throw new Error(`unexpected source restore request: ${String(url)}`);
  });
}

describe('review fix: source restoration and explicit recovery', () => {
  it.each(['same session', 'same-project replacement'])('mounted initialTrace arrival automatically restores code with %s, without admission/cancel/history reset', async replacement => {
    const f = ready(); await restore(f, completed());
    f.session.instruction = '原页面说明'; f.session.selection = binding('vision-b');
    const history = f.session.history; const view = show(f);
    expect(screen.getByRole('button', { name: '草图生图' }).getAttribute('aria-pressed')).toBe('true');
    const current = replacement === 'same session' ? f : ready();
    current.session.history = history; current.session.instruction = '原页面说明'; current.session.selection = binding('vision-b');
    if (current !== f) await restore(current, completed());
    const retainedImage = current.imageSession.client.task; serveFixCode(current);
    const trace = fixTrace(), models = [vision(), vision('vision-b'), image(), image('image-b')];
    view.rerender(<SketchToCodePanel session={current.session} imageSession={current.imageSession} models={models} initialTrace={trace} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '草图转代码' }).getAttribute('aria-pressed')).toBe('true'));
    await screen.findByText('恢复的原代码布局');
    expect(current.codeFetch.mock.calls.map(call => String(call[0]))).toEqual(['/api/poll-task']);
    expect(current.session.client.input).toBeUndefined(); expect(current.session.history).toBe(history); expect(f.session.history).toBe(history);
    expect((screen.getByLabelText('页面说明') as HTMLTextAreaElement).value).toBe('原页面说明');
    expect((screen.getByLabelText('视觉模型') as HTMLSelectElement).value).toBe(binding('vision-b'));
    fireEvent.click(screen.getByRole('button', { name: '打开代码预览' }));
    const frame = await screen.findByTitle('安全静态代码预览'); expect(frame.getAttribute('sandbox')).toBe('');
    expect((await blobBytes(vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob)).toString('utf8')).toBe('<p>恢复的原受权文档</p>');
    fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    view.rerender(<SketchToCodePanel session={current.session} imageSession={current.imageSession} models={models} initialTrace={{ ...trace }} />);
    expect(screen.getByRole('button', { name: '草图生图' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('创作关键词') as HTMLTextAreaElement).value).toBe('原关键词');
    expect((screen.getByLabelText('视觉分析模型') as HTMLSelectElement).value).toBe(binding('vision-a'));
    expect((screen.getByLabelText('图像生成模型') as HTMLSelectElement).value).toBe(binding('image-a'));
    expect(current.imageSession.client.task).toBe(retainedImage);
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    expect(current.codeFetch.mock.calls.map(call => String(call[0]))).toEqual(['/api/poll-task', '/api/sketch-to-code/restored-code/document?projectId=project']);
    expect(current.noIO).not.toHaveBeenCalled(); expect(f.noIO).not.toHaveBeenCalled(); expect(history.present.strokes).toHaveLength(1);
  });

  it('same-project new sessions restore the unchanged trace once even after the user manually returned to image', async () => {
    const f = ready(); serveFixCode(f); const trace = fixTrace(); const view = show(f, { initialTrace: trace });
    await screen.findByText('恢复的原代码布局'); fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    const next = ready(); next.session.history = f.session.history; next.session.instruction = '同项目新说明'; next.session.selection = binding('vision-b');
    const history = next.session.history; serveFixCode(next);
    view.rerender(<SketchToCodePanel session={next.session} imageSession={next.imageSession} models={[vision(), vision('vision-b'), image()]} initialTrace={trace} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '草图转代码' }).getAttribute('aria-pressed')).toBe('true'));
    await screen.findByText('恢复的原代码布局');
    expect(next.codeFetch.mock.calls.map(call => String(call[0]))).toEqual(['/api/poll-task']); expect(f.codeFetch).toHaveBeenCalledTimes(1);
    expect(next.session.client.input).toBeUndefined(); expect(next.session.history).toBe(history); expect(f.session.history).toBe(history);
    expect((screen.getByLabelText('页面说明') as HTMLTextAreaElement).value).toBe('同项目新说明');
    fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    expect(screen.getByRole('button', { name: '草图生图' }).getAttribute('aria-pressed')).toBe('true');
    expect(next.codeFetch).toHaveBeenCalledTimes(1); expect(next.noIO).not.toHaveBeenCalled(); expect(f.noIO).not.toHaveBeenCalled();
  });

  it('mounted foreign trace forces code with an explicit denial and zero requests, not image fallback', async () => {
    const f = ready(), history = f.session.history; const view = show(f);
    view.rerender(<SketchToCodePanel session={f.session} imageSession={f.imageSession} initialTrace={{ ...fixTrace(), projectId: 'foreign-project' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '草图转代码' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('alert').textContent).toMatch(/来源提示不属于当前项目/);
    expect(screen.queryByRole('textbox', { name: '创作关键词' })).toBeNull(); expect(screen.queryByTitle('安全静态代码预览')).toBeNull();
    expect(f.codeFetch).not.toHaveBeenCalled(); expect(f.noIO).not.toHaveBeenCalled(); expect(f.session.history).toBe(history);
  });

  it.each(['size', 'quality'] as const)('an empty model %s list retains the incompatible value until the user explicitly clears to model default', field => {
    const f = ready(), history = f.session.history; show(f, { models: [vision(), image(), image('image-b', { allowedSizes: [], qualityOptions: [] })] });
    const label = field === 'size' ? '图像尺寸' : '图像质量', saved = field === 'size' ? '1024' : 'standard';
    fireEvent.change(screen.getByLabelText(label), { target: { value: saved } });
    expect((screen.getByRole('button', { name: '生成图像' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('图像生成模型'), { target: { value: binding('image-b') } });
    const control = screen.getByLabelText(label) as HTMLSelectElement;
    expect(f.imageSession[field]).toBe(saved); expect(control.value).toBe(saved);
    expect(screen.getByRole('alert').textContent).toMatch(/保留的图像参数不适用/);
    expect((screen.getByRole('button', { name: '生成图像' }) as HTMLButtonElement).disabled).toBe(true);
    expect(control.disabled).toBe(false);
    fireEvent.change(control, { target: { value: '' } });
    expect(f.imageSession[field]).toBeUndefined(); expect(control.value).toBe(''); expect(control.selectedOptions[0].textContent).toBe('模型默认');
    expect(screen.queryByRole('alert')).toBeNull(); expect((screen.getByRole('button', { name: '生成图像' }) as HTMLButtonElement).disabled).toBe(false);
    expect(f.imageSession.visionSelection).toBe(binding('vision-a')); expect(f.imageSession.imageSelection).toBe(binding('image-b'));
    expect(f.imageSession.instruction).toBe('原关键词'); expect(f.session.history).toBe(history);
    expect(f.noIO).not.toHaveBeenCalled(); expect(f.codeFetch).not.toHaveBeenCalled();
  });

  it('read-only code disables original-PNG placement while protected poll, document preview and HTML download remain available', async () => {
    const f = ready(); vi.mocked(f.scope.assertCurrent).mockImplementation(write => { if (write) throw new Error('READ_ONLY_WRITE_DENIED'); });
    f.session.client.task = fixCodeTask(); serveFixCode(f);
    const assets = vi.fn<typeof fetch>(), insert = vi.fn<SketchInsert>();
    f.session.placement = new SketchPlacement(f.session.client.task, f.scope, insert, assets);
    const names: string[] = []; vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement): void { names.push(this.download); });
    const history = f.session.history; show(f); fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    const place = screen.getByRole('button', { name: '添加到画布' }) as HTMLButtonElement;
    expect(place.disabled).toBe(true); fireEvent.click(place); expect(assets).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '核对任务状态' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '核对任务状态' })); await waitFor(() => expect(f.codeFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: '打开代码预览' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '打开代码预览' })); expect((await screen.findByTitle('安全静态代码预览')).getAttribute('sandbox')).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '下载HTML' })); await waitFor(() => expect(names).toEqual(['sketch-code.html']));
    expect((await blobBytes(vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob)).toString('utf8')).toBe('<p>恢复的原受权文档</p>');
    expect(f.codeFetch.mock.calls.map(call => String(call[0]))).toEqual(['/api/poll-task', '/api/sketch-to-code/restored-code/document?projectId=project', '/api/sketch-to-code/restored-code/document?projectId=project']);
    expect(place.disabled).toBe(true); expect(assets).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled(); expect(f.session.history).toBe(history); expect(f.noIO).not.toHaveBeenCalled();
  });

  it('read-only code retains the original owner cancellation contract instead of inheriting the image write gate', async () => {
    const f = ready(); vi.mocked(f.scope.assertCurrent).mockImplementation(write => { if (write) throw new Error('READ_ONLY_WRITE_DENIED'); });
    f.session.client.task = { ...fixCodeTask(), status: 'processing', progress: 20, phase: 'analysis' };
    f.codeFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, type: 'sketch-to-code', ...f.session.client.task, status: 'cancelled', refunded: true })));
    show(f); fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    expect((screen.getByRole('button', { name: '取消任务（等待确认）' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '取消任务（等待确认）' })); await screen.findByText('已取消（服务端确认） · 20%');
    expect(f.session.client.task?.status).toBe('cancelled'); expect(f.codeFetch).toHaveBeenCalledTimes(1);
    expect(f.codeFetch.mock.calls[0][0]).toBe('/api/cancel-task'); expect(f.codeFetch.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(f.codeFetch.mock.calls[0][1]?.body))).toEqual({ taskId: 'restored-code', projectId: 'project' });
    expect(f.noIO).not.toHaveBeenCalled(); expect(f.session.history.present.strokes).toHaveLength(1);
  });
});

describe('StrictMode source restoration lifecycle', () => {
  it('restarts the aborted unfinished original poll, rejects its late result and does not repeat a successful restoration', async () => {
    const f = ready(), first = deferred<Response>(), second = deferred<Response>();
    const history = f.session.history, trace = fixTrace(), models = [vision(), vision('vision-b'), image()];
    f.session.instruction = '保留页面说明'; f.session.selection = binding('vision-b');
    const stop = vi.spyOn(f.session.client, 'stop');
    f.codeFetch.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const response = (analysis: string): Response => new Response(JSON.stringify({ success: true, type: 'sketch-to-code', ...fixCodeTask(), analysis }));
    const view = render(<React.StrictMode><SketchToCodePanel session={f.session} imageSession={f.imageSession} models={models} initialTrace={trace} /></React.StrictMode>);
    try {
      expect(stop).toHaveBeenCalled(); expect(f.codeFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
      await waitFor(() => expect(f.codeFetch).toHaveBeenCalledTimes(2));
      expect(f.codeFetch.mock.calls[1][1]?.signal?.aborted).toBe(false);
      for (const [url, init] of f.codeFetch.mock.calls) {
        expect(url).toBe('/api/poll-task'); expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ taskId: 'restored-code', projectId: 'project' });
        expect(init?.headers).toMatchObject({ 'x-wujie-expected-actor-id': 'actor' });
        expect(init?.credentials).toBe('same-origin'); expect(init?.cache).toBe('no-store');
      }
      await act(async () => { second.resolve(response('StrictMode 恢复的原代码')); });
      await screen.findByText('StrictMode 恢复的原代码');
      await act(async () => { first.resolve(response('已中止首读的迟到代码')); });
      expect(f.session.client.task?.analysis).toBe('StrictMode 恢复的原代码');
      expect(screen.queryByText('已中止首读的迟到代码')).toBeNull();
      expect(screen.getByRole('button', { name: '草图转代码' }).getAttribute('aria-pressed')).toBe('true');
      view.rerender(<React.StrictMode><SketchToCodePanel session={f.session} imageSession={f.imageSession} models={models} initialTrace={{ ...trace }} /></React.StrictMode>);
      fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
      view.rerender(<React.StrictMode><SketchToCodePanel session={f.session} imageSession={f.imageSession} models={models} initialTrace={{ ...trace }} /></React.StrictMode>);
      expect(screen.getByRole('button', { name: '草图生图' }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: '草图转代码' })); expect(f.codeFetch).toHaveBeenCalledTimes(2);
      expect((screen.getByLabelText('页面说明') as HTMLTextAreaElement).value).toBe('保留页面说明');
      expect(f.session.history).toBe(history); expect(f.session.client.input).toBeUndefined(); expect(f.noIO).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
      const next = ready(); next.session.history = history; serveFixCode(next);
      view.rerender(<React.StrictMode><SketchToCodePanel session={next.session} imageSession={next.imageSession} models={models} initialTrace={trace} /></React.StrictMode>);
      await screen.findByText('恢复的原代码布局');
      expect(next.codeFetch).toHaveBeenCalledTimes(1); expect(next.session.client.task?.taskId).toBe('restored-code');
      fireEvent.click(screen.getByRole('button', { name: '草图生图' })); fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
      expect(next.codeFetch).toHaveBeenCalledTimes(1); expect(f.codeFetch).toHaveBeenCalledTimes(2);
      expect(next.session.history).toBe(history); expect(next.session.client.input).toBeUndefined(); expect(next.noIO).not.toHaveBeenCalled();
    } finally {
      // Settle the deliberately abort-ignoring transport even on RED; the real client still rejects obsolete bytes.
      await act(async () => { first.resolve(response('已中止首读的迟到代码')); second.resolve(response('StrictMode 恢复的原代码')); });
      view.unmount();
    }
  });
});
