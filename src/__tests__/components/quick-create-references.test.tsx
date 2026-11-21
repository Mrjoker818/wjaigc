// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Scope inherited DB bindings before imports and module-level guard snapshots.
await vi.hoisted(async () => {
  const { afterAll } = await import('vitest');
  const { scopeOfflineDatabaseEnvironment } = await import('../helpers/isolated-child-database-env');
  const restore = scopeOfflineDatabaseEnvironment(process.env);
  try {
    afterAll(restore);
  } catch (error) {
    restore();
    throw error;
  }
});
import net from 'node:net';
import tls from 'node:tls';
import { QuickCreatePanel, type QuickCreateRequest } from '@/components/quick-create-panel';

vi.mock('pg', () => { throw new Error('Quick create reference tests must not import PostgreSQL'); });
const networkAttempts: string[] = [];
const imageModel = { id: 'offline::image', providerId: 'offline', modelId: 'image', name: 'Offline image' };
const chatModel = { id: 'offline::chat', providerId: 'offline', modelId: 'chat', name: 'Offline chat' };
const selectedImage = { id: 'canvas-a', url: '/references/canvas-a.png' };
const prompt = '设计一张春季茶饮海报';
const props = () => ({
  selectedImage,
  imageModels: [imageModel],
  chatModels: [chatModel],
  resolvedImageModel: { id: imageModel.id, model: imageModel, source: 'global-default' as const },
  resolvedChatModel: { id: '', model: null, source: 'none' as const },
  compileState: { phase: null, statusMessage: '', streamText: '', result: null, error: '', isCompiling: false },
  onGenerate: vi.fn<(request: QuickCreateRequest) => Promise<boolean>>().mockResolvedValue(true),
  onOpenProfessional: vi.fn(),
  onOpenChat: vi.fn(),
  onOpenVideo: vi.fn(),
});

function files(...names: string[]) {
  return names.map(name => new File(['offline image'], name, { type: 'image/png' }));
}

function upload(container: HTMLElement, ...names: string[]) {
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: files(...names) } });
}

function uploadResponse(name: string) {
  return { ok: true, json: async () => ({ url: `/references/${name}` }) } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  expect(Object.keys(process.env).filter(key => /^(PG|DATABASE|POSTGRES|TEST_POSTGRES|COZE_SUPABASE)|^WUJIE_.*DB|^WUJIE_AUTH_PERSISTENCE_MODE$/.test(key))).toEqual([]);
  networkAttempts.length = 0;
  const rejectNetwork = (): never => {
    networkAttempts.push('unexpected socket');
    throw new Error('Quick create reference tests are offline');
  };
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(rejectNetwork);
  vi.spyOn(tls, 'connect').mockImplementation(rejectNetwork);
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // The panel now reads the same exact capability catalog as other image
    // tools. Keep this original suite's four-reference model boundary explicit.
    if (input === '/api/models?type=image' && !init?.body) {
      return { ok: true, json: async () => ({ success: true, capabilityCatalogVersion: 1, providers: [], models: [{ ...imageModel, id: imageModel.modelId, type: 'image' }],
        taskModelCatalog: [{ providerId: imageModel.providerId, modelId: imageModel.modelId, kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'sync',
          allowedRatios: ['1:1', '4:5'], allowedSizes: ['1024x1024'], qualityOptions: ['standard', 'high'], maxOutputs: 4,
          supportsReferenceImages: true, maxReferenceImages: 4, supportsMask: false, outputKinds: ['image'], capabilitySources: { maxReferenceImages: 'admin' } }] }) } as Response;
    }
    if (input !== '/api/save-image' || init?.method !== 'POST' || !(init.body instanceof FormData)) {
      throw new Error(`Unexpected offline request: ${String(input)}`);
    }
    return uploadResponse((init.body.get('file') as File).name);
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(networkAttempts).toEqual([]);
});

describe('QuickCreatePanel reference boundary (real component, offline transport)', () => {
  it('blocks five merged references and preserves the draft until the user removes one', async () => {
    const p = props();
    const { container } = render(<QuickCreatePanel {...p} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
    fireEvent.change(screen.getByLabelText('画面比例'), { target: { value: '4:5' } });
    fireEvent.change(screen.getByLabelText('输出质量'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('生成数量'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '高级模型设置' }));
    fireEvent.change(screen.getByLabelText('本次任务图像模型'), { target: { value: imageModel.id } });
    fireEvent.change(screen.getByLabelText('本次任务 LLM'), { target: { value: chatModel.id } });
    upload(container, '1.png', '2.png', '3.png', '4.png');
    await screen.findByAltText('参考图片 4');
    fireEvent.click(screen.getByRole('button', { name: '引用画布当前选中图片' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 2 张' }));
    // Captures the actual outgoing payload on RED, rather than assuming the count from source.
    console.info('merged-reference-reproduction', JSON.stringify(p.onGenerate.mock.calls.map(([request]) => request.referenceImages)));
    expect(p.onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/4.*5|5.*4/);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(prompt);
    expect(screen.getAllByRole('img')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: '移除参考图片 2' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 2 张' }));
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1));
    expect(p.onGenerate.mock.calls[0][0]).toMatchObject({
      prompt, aspectRatio: '4:5', quality: 'high', outputCount: 2,
      imageModelOverride: imageModel.id, chatModelOverride: chatModel.id, referenceImages: [
      '/references/canvas-a.png', '/references/1.png', '/references/3.png', '/references/4.png',
    ] });
  });

  it('retains every attachment in an oversized picker batch and recovers by explicit removal', async () => {
    const p = props();
    const { container } = render(<QuickCreatePanel {...p} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
    upload(container, '1.png', '2.png', '3.png', '4.png', '5.png', '6.png');
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(6));
    expect(screen.getByRole('alert').textContent).toMatch(/4.*6|6.*4/);
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    expect(p.onGenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除参考图片 5' }));
    fireEvent.click(screen.getByRole('button', { name: '移除参考图片 5' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1));
    expect(p.onGenerate.mock.calls[0][0].referenceImages).toEqual([
      '/references/1.png', '/references/2.png', '/references/3.png', '/references/4.png',
    ]);
  });

  it('keeps overlapping batches in picker order and blocks submission until every upload settles', async () => {
    const p = props();
    const pending = new Map(['1.png', '2.png', '3.png', '4.png'].map(name => [name, deferred<Response>()]));
    const strictFetch = globalThis.fetch;
    const uploadFetch = vi.fn((_input, init) => pending.get((init.body.get('file') as File).name)!.promise);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/save-image' && init?.method === 'POST' && init.body instanceof FormData) {
        return uploadFetch(input, init);
      }
      return strictFetch(input, init);
    }));
    const view = render(<QuickCreatePanel {...p} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
    upload(view.container, '1.png', '2.png');
    upload(view.container, '3.png', '4.png');
    fireEvent.click(screen.getByRole('button', { name: '引用画布当前选中图片' }));
    view.rerender(<QuickCreatePanel {...p} selectedImage={{ id: 'canvas-b', url: '/references/canvas-b.png' }} />);
    await act(async () => {
      pending.get('4.png')!.resolve(uploadResponse('4.png'));
      pending.get('3.png')!.resolve(uploadResponse('3.png'));
    });
    expect((screen.getByRole('button', { name: '生成 1 张' }) as HTMLButtonElement).disabled).toBe(true);
    expect(p.onGenerate).not.toHaveBeenCalled();
    await act(async () => {
      pending.get('2.png')!.resolve(uploadResponse('2.png'));
      pending.get('1.png')!.resolve(uploadResponse('1.png'));
    });
    expect(screen.getAllByRole('img').map(img => img.getAttribute('src'))).toEqual([
      '/references/1.png', '/references/2.png', '/references/3.png', '/references/4.png',
    ]);
    expect(screen.getByRole('alert').textContent).toMatch(/4.*5|5.*4/);
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    expect(p.onGenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除参考图片 2' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1));
    expect(p.onGenerate.mock.calls[0][0].referenceImages).toEqual([
      '/references/canvas-b.png', '/references/1.png', '/references/3.png', '/references/4.png',
    ]);
  });

  it('recounts a deduplicated canvas reference on selection changes without discarding uploads', async () => {
    const p = props();
    const view = render(<QuickCreatePanel {...p} selectedImage={{ id: 'duplicate', url: '/references/1.png' }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
    upload(view.container, '1.png', '2.png', '3.png', '4.png');
    await screen.findByAltText('参考图片 4');
    fireEvent.click(screen.getByRole('button', { name: '引用画布当前选中图片' }));
    expect((screen.getByRole('button', { name: '生成 1 张' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(<QuickCreatePanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    expect(p.onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/4.*5|5.*4/);
    fireEvent.click(screen.getByRole('button', { name: '已引用画布选中图片' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1));
    expect(p.onGenerate.mock.calls[0][0].referenceImages).toEqual([
      '/references/1.png', '/references/2.png', '/references/3.png', '/references/4.png',
    ]);
  });

  it('does not label a changed draft as submitted when an older generation resolves', async () => {
    const p = props();
    const oldGeneration = deferred<boolean>();
    p.onGenerate.mockReturnValueOnce(oldGeneration.promise);
    const view = render(<QuickCreatePanel {...p} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    expect(p.onGenerate.mock.calls[0][0].referenceImages).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '引用画布当前选中图片' }));
    view.rerender(<QuickCreatePanel {...p} selectedImage={{ id: 'new', url: '/references/new.png' }} />);
    await act(async () => { oldGeneration.resolve(true); });
    expect(screen.queryByText('任务已提交，接下来可以')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    await screen.findByText('任务已提交，接下来可以');
    expect(p.onGenerate.mock.calls[1][0].referenceImages).toEqual(['/references/new.png']);
  });

  it('does not attach a late upload to a remounted panel', async () => {
    const oldUpload = deferred<Response>();
    const strictFetch = globalThis.fetch;
    const uploadFetch = vi.fn().mockReturnValueOnce(oldUpload.promise).mockResolvedValue(uploadResponse('new.png'));
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/save-image' && init?.method === 'POST' && init.body instanceof FormData) {
        return uploadFetch(input, init);
      }
      return strictFetch(input, init);
    }));
    const old = render(<QuickCreatePanel {...props()} />);
    upload(old.container, 'old.png');
    old.unmount();
    const p = props();
    const current = render(<QuickCreatePanel {...p} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
    upload(current.container, 'new.png');
    await screen.findByAltText('参考图片 1');
    await act(async () => { oldUpload.resolve(uploadResponse('old.png')); });
    expect(screen.getAllByRole('img').map(img => img.getAttribute('src'))).toEqual(['/references/new.png']);
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalledTimes(1));
    expect(p.onGenerate.mock.calls[0][0].referenceImages).toEqual(['/references/new.png']);
  });

  it('keeps an unchanged pending draft valid across normal parent rerenders', async () => {
    const p = props();
    const generation = deferred<boolean>();
    p.onGenerate.mockReturnValueOnce(generation.promise);
    const view = render(<QuickCreatePanel {...p} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
    fireEvent.click(screen.getByRole('button', { name: '引用画布当前选中图片' }));
    // Its reference-bearing request starts only after the local exact catalog
    // boundary is ready; the original pending-draft assertions below are intact.
    await waitFor(() => expect((screen.getByRole('button', { name: '生成 1 张' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    view.rerender(<QuickCreatePanel {...p} selectedImage={{ ...selectedImage }} compileState={{ ...p.compileState, isCompiling: true }} />);
    await act(async () => { generation.resolve(true); });
    expect(screen.getByText('任务已提交，接下来可以')).toBeTruthy();
    expect(p.onGenerate.mock.calls[0][0].referenceImages).toEqual(['/references/canvas-a.png']);
  });

  it('invalidates an old submission as soon as a new attachment starts uploading', async () => {
    const p = props();
    const generation = deferred<boolean>();
    const uploading = deferred<Response>();
    p.onGenerate.mockReturnValueOnce(generation.promise);
    const strictFetch = globalThis.fetch;
    const uploadFetch = vi.fn().mockReturnValue(uploading.promise);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/save-image' && init?.method === 'POST' && init.body instanceof FormData) {
        return uploadFetch(input, init);
      }
      return strictFetch(input, init);
    }));
    const view = render(<QuickCreatePanel {...p} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    upload(view.container, 'next.png');
    await act(async () => { generation.resolve(true); });
    const staleSuccess = screen.queryByText('任务已提交，接下来可以');
    await act(async () => { uploading.resolve(uploadResponse('next.png')); });
    expect(staleSuccess).toBeNull();
    expect(screen.getByAltText('参考图片 1').getAttribute('src')).toBe('/references/next.png');
    fireEvent.click(screen.getByRole('button', { name: '生成 1 张' }));
    await screen.findByText('任务已提交，接下来可以');
    expect(p.onGenerate.mock.calls[1][0].referenceImages).toEqual(['/references/next.png']);
  });
});
