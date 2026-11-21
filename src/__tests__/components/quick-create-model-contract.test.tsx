// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import { QuickCreatePanel, type QuickCreateRequest } from '@/components/quick-create-panel';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

vi.mock('pg', () => { throw new Error('Quick create contract tests forbid PostgreSQL'); });
type Props = React.ComponentProps<typeof QuickCreatePanel>;
const image = { id: 'chosen::shared', providerId: 'chosen', modelId: 'shared', name: '当前图像模型' };
const wide = { id: 'other::shared', providerId: 'other', modelId: 'shared', name: '同名其他供应商' };
const explicitImage = { id: 'explicit::image', providerId: 'explicit', modelId: 'image', name: '明确选择的图像模型' };
const chat = { id: 'default::chat', providerId: 'default', modelId: 'chat', name: '默认聊天模型' };
const explicitChat = { id: 'explicit::chat', providerId: 'explicit', modelId: 'chat', name: '明确选择的聊天模型' };
const prompt = '设计一张春季茶饮海报';
const canvas = { id: 'canvas', url: '/references/canvas.png' };
let descriptors: TaskModelDescriptor[];
let catalogStatus: number;
let heldCatalog: Promise<Response> | null;
const socketAttempts: string[] = [];

function descriptor(model = image, max = 4, supports = max > 0): TaskModelDescriptor {
  return { providerId: model.providerId, modelId: model.modelId, kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'sync',
    allowedRatios: ['1:1', '4:5'], allowedSizes: ['1024x1024'], qualityOptions: ['standard', 'high'], maxOutputs: 4,
    supportsReferenceImages: supports, maxReferenceImages: max, supportsMask: false, outputKinds: ['image'], capabilitySources: { maxReferenceImages: 'admin', supportsReferenceImages: 'admin' } };
}
function props(): Props & { onGenerate: ReturnType<typeof vi.fn<(request: QuickCreateRequest) => Promise<boolean>>> } {
  return { selectedImage: canvas, imageModels: [wide, image, explicitImage], chatModels: [chat, explicitChat],
    resolvedImageModel: { id: image.id, model: image, source: 'global-default' }, resolvedChatModel: { id: chat.id, model: chat, source: 'global-default' },
    compileState: { phase: null, statusMessage: '', streamText: '', result: null, error: '', isCompiling: false },
    onGenerate: vi.fn<(request: QuickCreateRequest) => Promise<boolean>>().mockResolvedValue(true),
    onOpenProfessional: vi.fn(), onOpenChat: vi.fn(), onOpenVideo: vi.fn() };
}
function catalogResponse(): Response {
  return { ok: catalogStatus === 200, status: catalogStatus, json: async () => ({ success: catalogStatus === 200, capabilityCatalogVersion: 1,
    providers: [], models: descriptors.map(d => ({ id: d.modelId, providerId: d.providerId, name: d.modelId, type: 'image' })), taskModelCatalog: descriptors }) } as Response;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function upload(container: HTMLElement, count: number) {
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: Array.from({ length: count }, (_, i) => new File(['offline'], `${i + 1}.png`, { type: 'image/png' })) } });
}
function enterDraft() { fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } }); }
function generate() { fireEvent.click(screen.getByRole('button', { name: '生成 1 张' })); }
async function generateReady() {
  await waitFor(() => expect((screen.getByRole('button', { name: '生成 1 张' }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => { generate(); });
}
function alerts() { return screen.queryAllByRole('alert').map(el => el.textContent).join(' '); }
async function refreshCatalog() { await act(async () => { fireEvent(document, new Event('visibilitychange')); }); }

beforeEach(() => {
  expect(Object.keys(process.env).filter(key => /^(PG|DATABASE|POSTGRES|TEST_POSTGRES|COZE_SUPABASE)|^WUJIE_.*DB|^WUJIE_AUTH_PERSISTENCE_MODE$/.test(key))).toEqual([]);
  socketAttempts.length = 0;
  const refuse = (): never => { socketAttempts.push('socket'); throw new Error('Offline contract test forbids sockets'); };
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(refuse); vi.spyOn(tls, 'connect').mockImplementation(refuse);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('React', React);
  catalogStatus = 200; heldCatalog = null;
  descriptors = [descriptor(wide, 14), descriptor(), descriptor(explicitImage)];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === '/api/models?type=image' && !init?.body) return heldCatalog ?? catalogResponse();
    if (input === '/api/save-image' && init?.method === 'POST' && init.body instanceof FormData) {
      return { ok: true, json: async () => ({ url: `/references/${(init.body as FormData).get('file') instanceof File ? ((init.body as FormData).get('file') as File).name : 'invalid'}` }) } as Response;
    }
    throw new Error(`Unexpected offline request ${String(input)}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(socketAttempts).toEqual([]); });

describe('QuickCreatePanel exact model references and explicit selections', () => {
  it.each([{ max: 0, uploads: 0, total: 1 }, { max: 1, uploads: 1, total: 2 }, { max: 3, uploads: 3, total: 4 }, { max: 14, uploads: 4, total: 5 }])(
    'enforces the exact model maximum $max and the panel maximum without discarding attachments', async ({ max, uploads, total }) => {
      descriptors = [descriptor(wide, 14), descriptor(image, max)];
      const p = props(), view = render(<QuickCreatePanel {...p} />); enterDraft();
      if (uploads) { upload(view.container, uploads); await screen.findByAltText(`参考图片 ${uploads}`); }
      fireEvent.click(screen.getByRole('button', { name: '引用画布当前选中图片' })); generate();
      expect(p.onGenerate, `exact ${image.id}: ${total} references must not leave the component`).not.toHaveBeenCalled();
      await waitFor(() => expect(alerts()).toMatch(/参考.*(上限|最多|不支持)/));
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(prompt);
      expect(screen.queryAllByRole('img')).toHaveLength(uploads);
      if (max <= 1) fireEvent.click(screen.getByRole('button', { name: '已引用画布选中图片' }));
      else fireEvent.click(screen.getByRole('button', { name: `移除参考图片 ${uploads}` }));
      await generateReady(); await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1));
      expect(p.onGenerate.mock.calls[0][0].referenceImages).toEqual(max === 0 ? [] : max === 1 ? ['/references/1.png'] : [canvas.url, ...Array.from({ length: uploads - 1 }, (_, i) => `/references/${i + 1}.png`)]);
    });

  it.each(['image', 'chat'] as const)('blocks a revoked explicit %s choice until the user selects a valid replacement', async kind => {
    const p = props(), view = render(<QuickCreatePanel {...p} />); enterDraft();
    fireEvent.click(screen.getByRole('button', { name: '高级模型设置' }));
    const label = kind === 'image' ? '本次任务图像模型' : '本次任务 LLM', oldId = kind === 'image' ? explicitImage.id : explicitChat.id;
    fireEvent.change(screen.getByLabelText(label), { target: { value: oldId } });
    upload(view.container, 1); await screen.findByAltText('参考图片 1');
    const next = { ...p, imageModels: kind === 'image' ? [wide, image] : p.imageModels, chatModels: kind === 'chat' ? [chat] : p.chatModels };
    view.rerender(<QuickCreatePanel {...next} />); generate();
    expect(p.onGenerate).not.toHaveBeenCalled(); expect(alerts()).toMatch(/(失效|不可用).*重新选择/);
    expect((screen.getByLabelText(label) as HTMLSelectElement).value).toBe(oldId);
    expect(screen.getByAltText('参考图片 1').getAttribute('src')).toBe('/references/1.png');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(prompt);
    const newId = kind === 'image' ? wide.id : chat.id;
    fireEvent.change(screen.getByLabelText(label), { target: { value: newId } }); await generateReady();
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1));
    expect(p.onGenerate.mock.calls[0][0]).toMatchObject({ prompt, referenceImages: ['/references/1.png'], [kind === 'image' ? 'imageModelOverride' : 'chatModelOverride']: newId });
  });

  it.each(['image', 'chat'] as const)('allows default matching only after the user explicitly clears the revoked %s override', async kind => {
    const p = props(), view = render(<QuickCreatePanel {...p} />); enterDraft();
    fireEvent.click(screen.getByRole('button', { name: '高级模型设置' }));
    const label = kind === 'image' ? '本次任务图像模型' : '本次任务 LLM';
    fireEvent.change(screen.getByLabelText(label), { target: { value: kind === 'image' ? explicitImage.id : explicitChat.id } });
    view.rerender(<QuickCreatePanel {...p} imageModels={kind === 'image' ? [wide, image] : p.imageModels} chatModels={kind === 'chat' ? [chat] : p.chatModels} />);
    generate(); expect(p.onGenerate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(label), { target: { value: '' } }); await generateReady();
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1));
    expect(p.onGenerate.mock.calls[0][0][kind === 'image' ? 'imageModelOverride' : 'chatModelOverride']).toBeUndefined();
    expect(p.onGenerate.mock.calls[0][0].prompt).toBe(prompt);
  });

  it('preserves an ordinary valid explicit choice and permits deliberate cancellation without rewriting the draft', async () => {
    const p = props(), view = render(<QuickCreatePanel {...p} />); enterDraft();
    fireEvent.click(screen.getByRole('button', { name: '高级模型设置' }));
    fireEvent.change(screen.getByLabelText('本次任务图像模型'), { target: { value: explicitImage.id } });
    upload(view.container, 1); await screen.findByAltText('参考图片 1'); await generateReady();
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1));
    expect(p.onGenerate.mock.calls[0][0].imageModelOverride).toBe(explicitImage.id);
    await screen.findByText('任务已提交，接下来可以');
    fireEvent.change(screen.getByLabelText('本次任务图像模型'), { target: { value: '' } }); await generateReady();
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(2));
    expect(p.onGenerate.mock.calls[1][0]).toMatchObject({ prompt, referenceImages: ['/references/1.png'] });
    expect(p.onGenerate.mock.calls[1][0].imageModelOverride).toBeUndefined();
  });

  it('waits for the exact reference contract before allowing an uploaded draft to leave', async () => {
    const gate = deferred<Response>(); heldCatalog = gate.promise;
    const p = props(), view = render(<QuickCreatePanel {...p} />); enterDraft(); upload(view.container, 1); await screen.findByAltText('参考图片 1');
    generate(); expect(p.onGenerate).not.toHaveBeenCalled();
    await act(async () => { heldCatalog = null; gate.resolve(catalogResponse()); }); await generateReady();
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1)); expect(p.onGenerate.mock.calls[0][0].referenceImages).toEqual(['/references/1.png']);
  });

  it('blocks unavailable reference metadata and preserves attachments for an explicit retry', async () => {
    catalogStatus = 503;
    const p = props(), view = render(<QuickCreatePanel {...p} />); enterDraft(); upload(view.container, 1); await screen.findByAltText('参考图片 1');
    generate(); expect(p.onGenerate).not.toHaveBeenCalled();
    expect(alerts()).toMatch(/引用能力.*(不可用|失败)/);
    catalogStatus = 200; fireEvent.click(screen.getByRole('button', { name: '重试引用能力' }));
    await generateReady();
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1)); expect(p.onGenerate.mock.calls[0][0].referenceImages).toEqual(['/references/1.png']);
  });

  it('rechecks a smaller capability on catalog refresh without clipping the existing attachments', async () => {
    const p = props(), view = render(<QuickCreatePanel {...p} />); enterDraft(); upload(view.container, 2); await screen.findByAltText('参考图片 2');
    descriptors = [descriptor(wide, 14), descriptor(image, 1)]; await refreshCatalog();
    generate(); expect(p.onGenerate).not.toHaveBeenCalled(); expect(screen.getAllByRole('img')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '移除参考图片 2' })); await generateReady();
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1)); expect(p.onGenerate.mock.calls[0][0].referenceImages).toEqual(['/references/1.png']);
  });

  it('does not mark a revoked explicit selection as accepted when its old callback resolves', async () => {
    const p = props(), pending = deferred<boolean>(); p.onGenerate.mockReturnValueOnce(pending.promise);
    const view = render(<QuickCreatePanel {...p} />); enterDraft(); fireEvent.click(screen.getByRole('button', { name: '高级模型设置' }));
    fireEvent.change(screen.getByLabelText('本次任务图像模型'), { target: { value: explicitImage.id } }); await act(async () => { generate(); });
    expect(p.onGenerate).toHaveBeenCalledTimes(1);
    view.rerender(<QuickCreatePanel {...p} imageModels={[wide, image]} />);
    await act(async () => { pending.resolve(true); });
    expect(screen.queryByText('任务已提交，接下来可以')).toBeNull(); generate(); expect(p.onGenerate).toHaveBeenCalledTimes(1);
    expect(alerts()).toMatch(/(失效|不可用).*重新选择/);
  });
});
