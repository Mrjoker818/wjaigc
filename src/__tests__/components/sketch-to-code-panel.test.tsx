// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SketchToCodePanel } from '@/components/sketch-to-code-panel';
import { createSketchPanelSession, SketchClient, type SketchScope, type SketchTask } from '@/lib/sketch-to-code/client';
import { appendSketchStroke } from '@/lib/sketch-to-code/drawing';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

const png = 'data:image/png;base64,c2tldGNo';
const model = (providerId = 'provider-1', extra: Partial<TaskModelDescriptor> = {}): TaskModelDescriptor => ({ providerId, modelId: 'same-model', kind: 'chat', sourceType: 'chat', protocol: 'chat-completions', executionMode: 'sync', supportsVision: true, allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: [], capabilitySources: {}, ...extra });
const completed: SketchTask = { taskId: 't1', projectId: 'p1', providerId: 'provider-1', modelId: 'same-model', status: 'completed', progress: 100, reserveCredits: 20, actualCredits: 12, previewAssetId: 'a1', htmlAssetId: 'a2', previewAssetVersionId: 'v1', htmlAssetVersionId: 'v2', analysis: '中文布局', refunded: false };
function fixture(authority: SketchScope['authority'] = 'legacy') {
  const scope: SketchScope = { actorId: 'u1', projectId: 'p1', key: 'scope1', authority, assertCurrent: vi.fn() };
  const session = createSketchPanelSession(scope);
  const fetcher = vi.fn<typeof fetch>(); session.client = new SketchClient(scope, fetcher);
  return { scope, session, fetcher };
}
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn() }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; } });
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', { configurable: true, value: (): boolean => true });
  Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('sketch drawer behavior', () => {
  it('minimizes and restores the mounted draft without stopping reads or changing drawing settings', () => {
    const f = fixture(), onClose = vi.fn();
    f.session.instruction = '保留页面说明';
    render(<SketchToCodePanel session={f.session} onClose={onClose} />);
    const stop = vi.spyOn(f.session.client, 'stop');
    fireEvent.click(screen.getByRole('button', { name: '橡皮擦' }));
    const surface = screen.getByLabelText('绘图区');
    fireEvent.pointerDown(surface, { pointerId: 1, button: 0 }); fireEvent.pointerUp(surface, { pointerId: 1 });
    const history = f.session.history;
    fireEvent.click(screen.getByRole('button', { name: '最小化草图窗口' }));
    expect(screen.queryByRole('textbox', { name: '页面说明' })).toBeNull();
    expect(screen.getByLabelText('页面说明')).toHaveProperty('value', '保留页面说明');
    expect(screen.getByLabelText('绘图区')).toBe(surface);
    expect(f.session.history).toBe(history);
    expect(stop).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '恢复草图窗口' }));
    expect(screen.getByRole('textbox', { name: '页面说明' })).toHaveProperty('value', '保留页面说明');
    expect(screen.getByRole('button', { name: '橡皮擦' }).getAttribute('aria-pressed')).toBe('true');
    expect(f.session.history).toBe(history); expect(f.fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '最小化草图窗口' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭草图转代码' }));
    expect(onClose).toHaveBeenCalledTimes(1); expect(stop).toHaveBeenCalled();
    expect(f.session.history).toBe(history);
  });
  it('keeps floating controls in a narrow resized viewport and isolates header dragging from drawing', () => {
    vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 640);
    const f = fixture(); render(<SketchToCodePanel session={f.session} />);
    const panel = screen.getByRole('region', { name: '草图转代码' });
    const header = screen.getByRole('group', { name: '草图窗口标题栏' });
    expect(panel.style.width).toBe('304px'); expect(panel.style.maxHeight).toBe('624px');
    Object.defineProperty(header, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(header, 'hasPointerCapture', { configurable: true, value: (): boolean => true });
    const release = vi.fn(); Object.defineProperty(header, 'releasePointerCapture', { configurable: true, value: release });
    fireEvent.pointerDown(header, { pointerId: 8, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(header, { pointerId: 8, clientX: 2000, clientY: -2000 });
    fireEvent.pointerUp(header, { pointerId: 8 });
    expect(panel.style.left).toBe('8px'); expect(panel.style.top).toBe('8px');
    expect(release).toHaveBeenCalledWith(8); expect(f.session.history.present.strokes).toHaveLength(0);
    vi.stubGlobal('innerWidth', 430); vi.stubGlobal('innerHeight', 300);
    fireEvent(window, new Event('resize'));
    expect(panel.style.width).toBe('414px'); expect(panel.style.maxHeight).toBe('284px');
    expect(panel.style.left).toBe('8px'); expect(panel.style.top).toBe('8px');
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('releases a cancelled header drag and ignores drags starting on window buttons', () => {
    const f = fixture(); render(<SketchToCodePanel session={f.session} />);
    const panel = screen.getByRole('region', { name: '草图转代码' });
    const header = screen.getByRole('group', { name: '草图窗口标题栏' });
    Object.defineProperty(header, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(header, 'hasPointerCapture', { configurable: true, value: (): boolean => true });
    const release = vi.fn(); Object.defineProperty(header, 'releasePointerCapture', { configurable: true, value: release });
    const before = [panel.style.left, panel.style.top];
    fireEvent.pointerDown(screen.getByRole('button', { name: '最小化草图窗口' }), { pointerId: 9, button: 0, clientX: 30, clientY: 30 });
    fireEvent.pointerMove(header, { pointerId: 9, clientX: 200, clientY: 200 });
    expect([panel.style.left, panel.style.top]).toEqual(before);
    fireEvent.pointerDown(header, { pointerId: 10, button: 0, clientX: 30, clientY: 30 });
    fireEvent.pointerCancel(header, { pointerId: 10 });
    fireEvent.pointerMove(header, { pointerId: 10, clientX: 200, clientY: 200 });
    expect([panel.style.left, panel.style.top]).toEqual(before); expect(release).toHaveBeenCalledWith(10);
    expect(f.session.history.present.strokes).toHaveLength(0);
  });
  it('keeps the title and close control within the visible viewport when a mobile keyboard opens', () => {
    const visible = Object.assign(new EventTarget(), { width: 375, height: 700, offsetLeft: 0, offsetTop: 0 });
    vi.stubGlobal('visualViewport', visible);
    render(<SketchToCodePanel />);
    const panel = screen.getByRole('region', { name: '草图转代码' });
    visible.height = 300; visible.offsetTop = 120;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    expect(panel.style.width).toBe('359px'); expect(panel.style.maxHeight).toBe('284px');
    expect(panel.style.top).toBe('128px');
    expect(screen.getByRole('button', { name: '关闭草图转代码' })).toBeDefined();
  });
  it.each([false, true])('keeps drawing selections visible and consistent with the next stroke (monochrome=%s)', isMonochrome => {
    const f = fixture(); render(<SketchToCodePanel session={f.session} isMonochrome={isMonochrome} />);
    const settings = (): HTMLElement => screen.getByRole('status', { name: '当前绘图设置' });
    expect(settings().textContent).toBe('当前：画笔 · 黑色 · 5px');
    expect(screen.getByRole('button', { name: '画笔' }).querySelector('[data-selection-mark]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '橡皮擦' }));
    fireEvent.click(screen.getByRole('button', { name: '画笔颜色 #ef4444' }));
    fireEvent.click(screen.getByRole('button', { name: '画笔粗细 10' }));
    expect(settings().textContent).toBe('当前：橡皮擦 · 红色 · 10px');
    for (const name of ['橡皮擦', '画笔颜色 #ef4444', '画笔粗细 10']) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.querySelector('[data-selection-mark]')).not.toBeNull();
    }
    for (const name of ['画笔', '画笔颜色 #111827', '画笔粗细 5']) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.querySelector('[data-selection-mark]')).toBeNull();
    }
    const surface = screen.getByLabelText('绘图区');
    fireEvent.pointerDown(surface, { pointerId: 1, button: 0 }); fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(f.session.history.present.strokes[0]).toMatchObject({ tool: 'eraser', color: '#ef4444', width: 10 });
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(f.session.history.present.strokes).toHaveLength(0);
    expect(screen.getByRole('button', { name: '撤销' }).getAttribute('aria-pressed')).toBeNull();
    expect(settings().textContent).toBe('当前：橡皮擦 · 红色 · 10px');
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(f.session.history.present.strokes[0]).toMatchObject({ tool: 'eraser', color: '#ef4444', width: 10 });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('provides all eight data colors and three widths, empty drawing disables submission', () => {
    render(<SketchToCodePanel />);
    for (const color of ['#111827', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6']) expect(screen.getByRole('button', { name: `画笔颜色 ${color}` })).toBeDefined();
    for (const width of [2, 5, 10]) expect(screen.getByRole('button', { name: `画笔粗细 ${width}` })).toBeDefined();
    expect((screen.getByRole('button', { name: '生成代码' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('isolates textarea deletion/undo and panel wheel from the host, with touch suppression only on the drawing surface', () => {
    const host = vi.fn(); const wheel = vi.fn();
    render(<div onKeyDown={host} onWheel={wheel}><SketchToCodePanel /></div>);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '页面说明' }), { key: 'Delete' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '页面说明' }), { key: 'z', ctrlKey: true });
    fireEvent.wheel(screen.getByRole('region', { name: '草图转代码' }));
    expect(host).not.toHaveBeenCalled(); expect(wheel).not.toHaveBeenCalled();
    expect(screen.getByLabelText('绘图区').style.touchAction).toBe('none');
    expect(screen.getByRole('region', { name: '草图转代码' }).style.touchAction).not.toBe('none');
  });
  it('scales and clamps dots/lines, preserves eraser data, and discards cancelled/lost/second-pointer strokes', () => {
    const f = fixture(); render(<SketchToCodePanel session={f.session} />);
    const surface = screen.getByLabelText('绘图区');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 512, height: 384 } as DOMRect);
    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 266, clientY: 212 }); fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(f.session.history.present.strokes[0].points).toEqual([{ x: 512, y: 384 }]);
    fireEvent.click(screen.getByRole('button', { name: '橡皮擦' })); fireEvent.click(screen.getByRole('button', { name: '画笔粗细 10' }));
    fireEvent.pointerDown(surface, { pointerId: 2, button: 0, clientX: -10, clientY: -10 });
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 900, clientY: 900 }); fireEvent.pointerUp(surface, { pointerId: 2 });
    expect(f.session.history.present.strokes[1]).toMatchObject({ tool: 'eraser', width: 10, points: [{ x: 0, y: 0 }, { x: 1024, y: 768 }] });
    for (const cancel of ['pointerCancel', 'lostPointerCapture', 'secondPointer']) {
      fireEvent.pointerDown(surface, { pointerId: 3, button: 0 });
      if (cancel === 'pointerCancel') fireEvent.pointerCancel(surface, { pointerId: 3 });
      if (cancel === 'lostPointerCapture') fireEvent.lostPointerCapture(surface, { pointerId: 3 });
      if (cancel === 'secondPointer') fireEvent.pointerDown(surface, { pointerId: 4, button: 0 });
      fireEvent.pointerUp(surface, { pointerId: 3 });
      expect(f.session.history.present.strokes).toHaveLength(2);
    }
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true }); expect(f.session.history.present.strokes).toHaveLength(1);
    fireEvent.keyDown(surface, { key: 'Z', ctrlKey: true, shiftKey: true }); expect(f.session.history.present.strokes).toHaveLength(2);
  });
  it('uses exact same-named provider selection and original renderer PNG; unknown admission reconciliation ignores subsequent edits', async () => {
    const f = fixture(); f.fetcher.mockRejectedValueOnce(new Error('lost ACK')).mockResolvedValueOnce(new Response(JSON.stringify({ ...completed, success: true, type: 'sketch-to-code' })));
    f.session.history = appendSketchStroke(f.session.history, { id: 'dot', tool: 'pen', width: 2, color: '#111827', points: [{ x: 10, y: 20 }] });
    render(<SketchToCodePanel session={f.session} models={[model(), model('provider-2'), model('bad', { supportsVision: false }), model('async', { executionMode: 'async' }), model('protocol', { protocol: 'responses' })]} />);
    fireEvent.change(screen.getByLabelText('视觉模型'), { target: { value: JSON.stringify(['provider-1', 'same-model']) } });
    expect(screen.getByLabelText('视觉模型').querySelectorAll('option')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '生成代码' }));
    await screen.findByText(/受理结果未知/);
    expect(screen.getByText(/原提交可能仍在处理/)).toBeDefined();
    fireEvent.change(screen.getByLabelText('页面说明'), { target: { value: '新说明' } });
    fireEvent.change(screen.getByLabelText('视觉模型'), { target: { value: JSON.stringify(['provider-2', 'same-model']) } });
    fireEvent.click(screen.getByRole('button', { name: '核对原提交（相同标识）' }));
    await screen.findByText('中文布局');
    expect(screen.queryByText(/原提交可能仍在处理/)).toBeNull();
    const bodies = f.fetcher.mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(bodies[0]).toEqual(bodies[1]); expect(Object.keys(bodies[0]).sort()).toEqual(['projectId', 'imageDataUrl', 'instruction', 'providerId', 'modelId', 'idempotencyKey'].sort());
    expect(bodies[0]).toMatchObject({ imageDataUrl: png, providerId: 'provider-1', modelId: 'same-model' });
    expect(screen.getByText(/实际净费：12/)).toBeDefined(); expect(screen.queryByText('服务端确认已退还预留额度')).toBeNull();
  });
  it('fresh preview and download share compiled bytes with empty sandbox; denied reread removes old Blob; close releases resources', async () => {
    const f = fixture('document'); f.session.client.task = completed;
    f.fetcher.mockResolvedValueOnce(new Response('<p>中文</p>', { headers: { 'Content-Type': 'text/html' } })).mockResolvedValueOnce(new Response('<p>第二次</p>', { headers: { 'Content-Type': 'text/html' } })).mockResolvedValueOnce(new Response('denied', { status: 404 }));
    const view = render(<SketchToCodePanel session={f.session} />);
    expect((screen.getByRole('button', { name: '添加到画布' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/协作文档暂不能放置/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '打开代码预览' }));
    const frame = await screen.findByTitle('安全静态代码预览'); expect(frame.getAttribute('sandbox')).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '下载HTML' })); await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
    const blob = vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob;
    const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(text).toBe('<p>第二次</p>'); expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '打开代码预览' })); await screen.findByText(/当前代码读取未获授权/);
    expect(screen.queryByTitle('安全静态代码预览')).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    view.unmount(); expect(f.fetcher.mock.calls.every(call => call[1]?.method === 'GET')).toBe(true);
  });
  it('same-scope reopen retains known task and drawing; a fresh page starts without any admission request', async () => {
    const f = fixture(); f.session.client.task = { ...completed, status: 'processing', phase: 'analysis' };
    const first = render(<SketchToCodePanel session={f.session} />); first.unmount();
    const second = render(<SketchToCodePanel session={f.session} />); expect(screen.getByText(/分析中/)).toBeDefined();
    await act(async () => { await Promise.resolve(); }); expect(f.fetcher).not.toHaveBeenCalled(); second.unmount();
    const fresh = fixture(); render(<SketchToCodePanel session={fresh.session} />); expect(fresh.fetcher).not.toHaveBeenCalled(); expect(screen.getByText('尚未提交')).toBeDefined();
  });
  it('cancellation remains pending confirmation on 503, preserves drawing, and never asserts refund', async () => {
    const f = fixture(); f.session.client.task = { ...completed, status: 'processing', phase: 'reconstruction', actualCredits: undefined };
    f.session.history = appendSketchStroke(f.session.history, { id: 'dot', tool: 'pen', color: '#111827', width: 5, points: [{ x: 1, y: 1 }] });
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'SKETCH_TASK_UNAVAILABLE' }), { status: 503 }));
    render(<SketchToCodePanel session={f.session} />);
    expect(screen.getByText(/重建中/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消任务（等待确认）' }));
    await screen.findByText(/取消结果未确认/); expect(f.session.history.present.strokes).toHaveLength(1);
    expect(screen.queryByText('已取消（服务端确认）')).toBeNull(); expect(screen.queryByText(/服务端确认已退还预留额度/)).toBeNull();
  });
  it('releases its active polling timer on unmount and never automatically posts a cancel or admission', () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); f.session.client.task = { ...completed, status: 'processing' };
      const view = render(<SketchToCodePanel session={f.session} />); expect(vi.getTimerCount()).toBe(1);
      view.unmount(); expect(vi.getTimerCount()).toBe(0); expect(f.fetcher).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it.each([{ loading: true, error: null }, { loading: false, error: '目录错误' }])('disables generation while catalog is unavailable: %j', catalogStatus => {
    const f = fixture(); f.session.selection = JSON.stringify(['provider-1', 'same-model']);
    f.session.history = appendSketchStroke(f.session.history, { id: 'dot', tool: 'pen', color: '#111827', width: 5, points: [{ x: 1, y: 1 }] });
    render(<SketchToCodePanel session={f.session} models={[model()]} catalogStatus={catalogStatus} />);
    expect((screen.getByRole('button', { name: '生成代码' }) as HTMLButtonElement).disabled).toBe(true); expect(f.fetcher).not.toHaveBeenCalled();
  });
});

describe('fix1 I1：新提交与当前交付身份', () => {
  async function openPreviousResult(): Promise<ReturnType<typeof fixture>> {
    const f = fixture();
    const oldTask = { ...completed, analysis: 'OLD_RESULT_ANALYSIS' };
    f.session.client.task = oldTask;
    f.session.client.input = Object.freeze({ projectId: 'p1', imageDataUrl: png, instruction: 'OLD_INTENT',
      providerId: 'provider-1', modelId: 'same-model', idempotencyKey: 'old-admission' });
    f.session.instruction = 'OLD_INTENT';
    f.session.selection = JSON.stringify(['provider-1', 'same-model']);
    f.session.history = appendSketchStroke(f.session.history, { id: 'old-dot', tool: 'pen', color: '#111827', width: 5, points: [{ x: 1, y: 1 }] });
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...oldTask, success: true, type: 'sketch-to-code' })))
      .mockResolvedValueOnce(new Response('<p>OLD_HTML</p>', { headers: { 'Content-Type': 'text/html' } }));
    render(<SketchToCodePanel session={f.session} models={[model(), model('provider-2')]}
      insert={async () => { throw new Error('旧意图不得迟到插入'); }} />);
    fireEvent.click(screen.getByRole('button', { name: '核对任务状态' }));
    await waitFor(() => expect(f.session.placement?.trace.taskId).toBe('t1'));
    fireEvent.click(screen.getByRole('button', { name: '打开代码预览' }));
    await screen.findByTitle('安全静态代码预览');
    expect(screen.getByText('OLD_RESULT_ANALYSIS')).toBeDefined();
    expect((screen.getByRole('button', { name: '添加到画布' }) as HTMLButtonElement).disabled).toBe(false);
    return f;
  }

  it('completed → 新提交等待/ACK未知时移除旧交付，重核冻结六字段并拒绝旧placement迟到读取', async () => {
    let resolveOldRead!: (response: Response) => void;
    const assets = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOldRead = resolve; }))
      .mockRejectedValue(new Error('不应继续旧素材转移'));
    vi.stubGlobal('fetch', assets);
    const f = await openPreviousResult();
    const oldPlacement = f.session.placement!;
    const stopOld = vi.spyOn(oldPlacement, 'stop');
    const oldRead = oldPlacement.add().then(() => 'unexpected insertion', (error: Error) => error.message);
    let rejectAdmission!: (error: Error) => void;
    f.fetcher.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectAdmission = reject; }));
    const newPng = 'data:image/png;base64,bmV3LXNrdGVjaA==';
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue(newPng);
    const surface = screen.getByLabelText('绘图区');
    fireEvent.pointerDown(surface, { pointerId: 11, button: 0 }); fireEvent.pointerUp(surface, { pointerId: 11 });
    fireEvent.change(screen.getByLabelText('页面说明'), { target: { value: 'NEW_INTENT' } });
    fireEvent.change(screen.getByLabelText('视觉模型'), { target: { value: JSON.stringify(['provider-2', 'same-model']) } });
    try {
      fireEvent.click(screen.getByRole('button', { name: '生成新任务代码（新提交）' }));
      expect(screen.queryByText('OLD_RESULT_ANALYSIS')).toBeNull();
      expect(screen.queryByRole('button', { name: '打开代码预览' })).toBeNull();
      expect(screen.queryByRole('button', { name: '下载HTML' })).toBeNull();
      expect(screen.queryByRole('button', { name: '添加到画布' })).toBeNull();
      expect(screen.queryByTitle('安全静态代码预览')).toBeNull();
      expect(f.session.placement).toBeUndefined(); expect(stopOld).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
      await act(async () => { rejectAdmission(new Error('lost new ACK')); });
      await screen.findByText(/受理结果未知/);
      expect(f.session.client.task).toBeUndefined(); expect(f.session.client.admissionUnknown).toBe(true);
      expect(screen.queryByText('OLD_RESULT_ANALYSIS')).toBeNull();
      expect(screen.queryByRole('button', { name: '添加到画布' })).toBeNull();
      const posts = f.fetcher.mock.calls.filter(call => call[0] === '/api/sketch-to-code');
      expect(posts).toHaveLength(1);
      const frozen = JSON.parse(String(posts[0][1]?.body));
      expect(Object.keys(frozen).sort()).toEqual(['projectId', 'imageDataUrl', 'instruction', 'providerId', 'modelId', 'idempotencyKey'].sort());
      expect(frozen).toMatchObject({ projectId: 'p1', imageDataUrl: newPng, instruction: 'NEW_INTENT', providerId: 'provider-2', modelId: 'same-model' });
      expect(frozen.idempotencyKey).not.toBe('old-admission'); expect(Object.isFrozen(f.session.client.input)).toBe(true);
      fireEvent.change(screen.getByLabelText('页面说明'), { target: { value: 'EDIT_AFTER_UNKNOWN' } });
      fireEvent.change(screen.getByLabelText('视觉模型'), { target: { value: JSON.stringify(['provider-1', 'same-model']) } });
      fireEvent.pointerDown(surface, { pointerId: 12, button: 0 }); fireEvent.pointerUp(surface, { pointerId: 12 });
      vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue('data:image/png;base64,bGF0ZXI=');
      await act(async () => { resolveOldRead(new Response(JSON.stringify({ kind: 'image', assetId: 'a1', assetVersionId: 'v1', url: '/old.png' }))); });
      expect(await oldRead).toMatch(/放置读取已停止/);
      expect((assets.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
      expect(assets).toHaveBeenCalledTimes(1); expect(f.session.placement).toBeUndefined();
      f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...completed, taskId: 't2', providerId: 'provider-2',
        previewAssetVersionId: 'new-v1', htmlAssetVersionId: 'new-v2', analysis: 'NEW_RESULT_ANALYSIS', success: true, type: 'sketch-to-code' })));
      fireEvent.click(screen.getByRole('button', { name: '核对原提交（相同标识）' }));
      await screen.findByText('NEW_RESULT_ANALYSIS');
      const reconciled = f.fetcher.mock.calls.filter(call => call[0] === '/api/sketch-to-code');
      expect(reconciled).toHaveLength(2); expect(JSON.parse(String(reconciled[1][1]?.body))).toEqual(frozen);
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(1);
      expect(f.session.placement?.trace.taskId).toBe('t2'); expect(f.session.placement).not.toBe(oldPlacement);
      expect((screen.getByRole('button', { name: '添加到画布' }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByText('OLD_RESULT_ANALYSIS')).toBeNull(); expect(f.session.history.present.strokes).toHaveLength(3);
    } finally {
      await act(async () => {
        rejectAdmission(new Error('lost new ACK'));
        resolveOldRead(new Response(JSON.stringify({ kind: 'image', assetId: 'a1', assetVersionId: 'v1', url: '/old.png' })));
        await oldRead;
      });
    }
  });

  it('completed → 新提交明确拒绝时不恢复旧结果、不虚构受理或退款并保留草图', async () => {
    const f = await openPreviousResult(); const oldPlacement = f.session.placement!;
    const stopOld = vi.spyOn(oldPlacement, 'stop');
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'MODEL_DENIED', message: '精确模型未授权', phase: 'analysis', requestId: 'req-denied' } }), { status: 403 }));
    fireEvent.change(screen.getByLabelText('页面说明'), { target: { value: 'REJECTED_NEW_INTENT' } });
    fireEvent.click(screen.getByRole('button', { name: '生成新任务代码（新提交）' }));
    await screen.findByText(/MODEL_DENIED · 精确模型未授权 · analysis · req-denied/);
    expect(screen.queryByText('OLD_RESULT_ANALYSIS')).toBeNull();
    for (const name of ['打开代码预览', '下载HTML', '添加到画布', '核对原提交（相同标识）']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByTitle('安全静态代码预览')).toBeNull(); expect(screen.getByText('尚未提交')).toBeDefined();
    expect(f.session.placement).toBeUndefined(); expect(stopOld).toHaveBeenCalledTimes(1);
    expect(f.session.client.task).toBeUndefined(); expect(f.session.client.admissionUnknown).toBe(false);
    expect(f.session.history.present.strokes).toHaveLength(1);
    expect(screen.queryByText(/服务端确认已退还预留额度/)).toBeNull(); expect(screen.queryByText(/受理结果未知/)).toBeNull();
    expect(screen.queryByText(/原提交可能仍在处理/)).toBeNull();
    expect(f.fetcher.mock.calls.filter(call => call[0] === '/api/sketch-to-code')).toHaveLength(1);
  });
});

describe('admission input and pending-copy contract', () => {
  function ready(instruction: string): ReturnType<typeof fixture> {
    const f = fixture(); f.session.instruction = instruction;
    f.session.selection = JSON.stringify(['provider-1', 'same-model']);
    f.session.history = appendSketchStroke(f.session.history, { id: 'input-dot', tool: 'pen', color: '#111827', width: 5, points: [{ x: 1, y: 1 }] });
    return f;
  }

  it.each(['页'.repeat(4096), '😀'.repeat(2048), ''])('uses the server input limit and submits the complete accepted boundary (%#)', async instruction => {
    const f = ready(instruction);
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...completed, success: true, type: 'sketch-to-code' })));
    render(<SketchToCodePanel session={f.session} models={[model()]} />);
    expect((screen.getByLabelText('页面说明') as HTMLTextAreaElement).maxLength).toBe(4096);
    expect((screen.getByRole('button', { name: '生成代码' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '生成代码' }));
    await screen.findByText('中文布局');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(f.fetcher.mock.calls[0][1]?.body)).instruction).toBe(instruction);
  });

  it('retains an over-limit reopened input without posting until it is shortened to the accepted limit', async () => {
    const instruction = '页'.repeat(4097); const f = ready(instruction);
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...completed, success: true, type: 'sketch-to-code' })));
    render(<SketchToCodePanel session={f.session} models={[model()]} />);
    const field = screen.getByLabelText('页面说明') as HTMLTextAreaElement;
    expect(field.value).toBe(instruction);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const error = screen.getByRole('alert'); expect(error.textContent).toMatch(/4096/);
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
    expect((screen.getByRole('button', { name: '生成代码' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '生成代码' }));
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.session.history.present.strokes).toHaveLength(1);
    fireEvent.change(field, { target: { value: instruction.slice(0, 4096) } });
    expect(field.getAttribute('aria-invalid')).not.toBe('true'); expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: '生成代码' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '生成代码' }));
    await screen.findByText('中文布局');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(f.fetcher.mock.calls[0][1]?.body)).instruction).toBe(instruction.slice(0, 4096));
  });

  it('known input rejection preserves the frozen submission and drawing without claiming pending processing or refund', async () => {
    const f = ready('拒绝测试');
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: 'SKETCH_INPUT_INVALID', retryable: false, requestId: 'req-input' }), { status: 400 }));
    render(<SketchToCodePanel session={f.session} models={[model()]} />);
    fireEvent.click(screen.getByRole('button', { name: '生成代码' }));
    await screen.findByText(/SKETCH_INPUT_INVALID.*req-input/);
    expect(screen.getByText('尚未提交')).toBeDefined();
    expect(screen.queryByText(/原提交可能仍在处理|受理结果未知|服务端确认已退还预留额度/)).toBeNull();
    expect(screen.queryByRole('button', { name: '核对原提交（相同标识）' })).toBeNull();
    expect(f.session.client.task).toBeUndefined(); expect(f.session.client.admissionUnknown).toBe(false);
    expect(Object.isFrozen(f.session.client.input)).toBe(true);
    expect(f.session.client.input?.instruction).toBe('拒绝测试');
    expect(f.session.history.present.strokes).toHaveLength(1); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each<SketchTask['status']>(['pending', 'processing', 'submitting', 'completed', 'failed', 'cancelled', 'timeout'])(
    'pending processing copy follows the actual %s task rather than retained input', status => {
      const f = ready('已提交说明');
      f.session.client.input = Object.freeze({ projectId: 'p1', imageDataUrl: png, instruction: '已提交说明', providerId: 'provider-1', modelId: 'same-model', idempotencyKey: 'retained-input' });
      f.session.client.task = { ...completed, status };
      render(<SketchToCodePanel session={f.session} models={[model()]} />);
      expect(!!screen.queryByText(/原提交可能仍在处理/)).toBe(['pending', 'processing', 'submitting'].includes(status));
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
});

describe('fix1 I2：终态与真实阶段主标签', () => {
  it.each<[SketchTask['status'], NonNullable<SketchTask['phase']>, string]>([
    ['failed', 'analysis', '失败，草图已保留'], ['failed', 'reconstruction', '失败，草图已保留'],
    ['cancelled', 'analysis', '已取消（服务端确认）'], ['cancelled', 'reconstruction', '已取消（服务端确认）'],
    ['timeout', 'analysis', '任务超时，草图已保留'], ['timeout', 'reconstruction', '任务超时，草图已保留'],
    ['completed', 'analysis', '已完成'], ['completed', 'reconstruction', '已完成'],
  ])('%s 携带 %s 时终态优先且保留安全错误/请求/费用/草图', (status, phase, want) => {
    const f = fixture();
    f.session.client.task = { ...completed, status, phase, actualCredits: status === 'completed' ? 12 : undefined,
      error: 'SAFE_TERMINAL_ERROR · req-terminal', requestId: 'req-terminal' };
    f.session.history = appendSketchStroke(f.session.history, { id: 'terminal-dot', tool: 'pen', color: '#111827', width: 5, points: [{ x: 1, y: 1 }] });
    render(<SketchToCodePanel session={f.session} />);
    expect(screen.getByRole('region', { name: '草图转代码' }).querySelector('[aria-live="polite"] > p')?.textContent).toBe(`${want} · 100%`);
    expect(screen.queryByText('分析中 · 100%')).toBeNull(); expect(screen.queryByText('重建中 · 100%')).toBeNull();
    expect(screen.getByText('SAFE_TERMINAL_ERROR · req-terminal')).toBeDefined(); expect(screen.getByText('任务：t1 · 请求：req-terminal')).toBeDefined();
    expect(screen.getByText(`预留额度：20；实际净费：${status === 'completed' ? 12 : '尚未确认'}`)).toBeDefined();
    expect(screen.queryByText(/服务端确认已退还预留额度/)).toBeNull(); expect(f.session.history.present.strokes).toHaveLength(1);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each<[NonNullable<SketchTask['phase']>, string]>([['analysis', '分析中'], ['reconstruction', '重建中']])(
    '非终态仅沿真实 %s 显示阶段，不由进度猜测', (phase, want) => {
      const f = fixture(); f.session.client.task = { ...completed, status: 'processing', phase, progress: 37 };
      render(<SketchToCodePanel session={f.session} />);
      expect(screen.getByText(`${want} · 37%`)).toBeDefined(); expect(screen.queryByText('已完成 · 37%')).toBeNull();
      expect(f.fetcher).not.toHaveBeenCalled();
    });

  it.each(['needsReconcile', 'dispatchPending'] as const)('%s 仍优先要求派发核对，不能由终态/phase伪称确认', flag => {
    const f = fixture(); f.session.client.task = { ...completed, phase: 'analysis', [flag]: true };
    render(<SketchToCodePanel session={f.session} />);
    expect(screen.getByText('派发待核对 · 100%')).toBeDefined(); expect(screen.queryByText('已完成 · 100%')).toBeNull();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});

describe('fix1 M1：八色触达结构与绘图数据', () => {
  it('八个颜色按钮声明44px点击区域并仍选择精确画笔颜色，保持换行/焦点/aria与小色块', () => {
    const f = fixture(); render(<SketchToCodePanel session={f.session} />);
    const colors = ['#111827', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'];
    const surface = screen.getByLabelText('绘图区');
    for (const [index, color] of colors.entries()) {
      const button = screen.getByRole('button', { name: `画笔颜色 ${color}` });
      expect(button.classList.contains('h-11')).toBe(true); expect(button.classList.contains('w-11')).toBe(true);
      expect(button.parentElement?.classList.contains('flex-wrap')).toBe(true);
      expect(button.classList.contains('focus-visible:outline')).toBe(true);
      expect(button.querySelector('span')?.classList.contains('h-5')).toBe(true); expect(button.querySelector('span')?.classList.contains('w-5')).toBe(true);
      fireEvent.click(button); expect(button.getAttribute('aria-pressed')).toBe('true');
      fireEvent.pointerDown(surface, { pointerId: index + 1, button: 0 }); fireEvent.pointerUp(surface, { pointerId: index + 1 });
      expect(f.session.history.present.strokes[index].color).toBe(color);
    }
    expect(f.session.history.present.strokes).toHaveLength(8); expect(f.fetcher).not.toHaveBeenCalled();
  });
});
