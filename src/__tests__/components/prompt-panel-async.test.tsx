// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import OhMyPrompt, { type VisionApiResultData } from '@/components/oh-my-prompt';
import { PromptEquation } from '@/components/prompt-equation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function requestFixture(endpoint: string, ...pending: ReturnType<typeof deferred<Response>>[]) {
  let next = 0;
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== endpoint || init?.method !== 'POST' || !pending[next]) throw Error(`Unexpected request: ${input}`);
    return pending[next++].promise;
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

const visionProps = { isOpen: true, defaultActiveTab: 'vision' as const,
  initialImageUrl: '/synthetic/original.png', onClose: () => {}, onInsertPrompt: () => {} };
const equationProps = { open: true, onClose: () => {}, onSendToPrompt: () => {} };
const result = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: '合成结果' });
const optimize = () => fireEvent.click(screen.getByRole('button', { name: '一键优化' }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('shows a vision failure only in the vision tab after returning to it', async () => {
  const pending = deferred<Response>();
  requestFixture('/api/vision-prompt', pending);
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  render(<OhMyPrompt {...visionProps} />);
  fireEvent.click(await screen.findByRole('button', { name: '开始识词' }));
  fireEvent.click(screen.getByRole('button', { name: 'AI增强' }));
  await act(async () => pending.resolve(Response.json({ error: '合成识词失败' }, { status: 503 })));
  expect(alert).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '识词' }));
  expect((await screen.findByRole('alert')).textContent).toBe('合成识词失败');
  expect(screen.getByRole('button', { name: '开始识词' })).toBeTruthy();
});

function fileReaders() {
  const readers: FakeReader[] = [];
  class FakeReader {
    static LOADING = 1;
    readyState = 1;
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    readAsDataURL() { readers.push(this); }
    abort() { this.onabort?.(); }
    finish(result: string) { this.result = result; this.readyState = 2; this.onload?.(); }
  }
  vi.stubGlobal('FileReader', FakeReader);
  return readers;
}

it('clears the previous preview while reading a replacement and analyzes only the replacement', async () => {
  const readers = fileReaders();
  const pending = deferred<Response>();
  const fetcher = requestFixture('/api/vision-prompt', pending);
  const { container } = render(<OhMyPrompt {...visionProps} />);
  expect(await screen.findByRole('button', { name: '开始识词' })).toBeTruthy();
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['fixture'], 'replacement.png', { type: 'image/png' })] } });
  expect(screen.queryByRole('button', { name: '开始识词' })).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('正在读取图片');
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['latest'], 'latest.png', { type: 'image/png' })] } });
  act(() => readers[0].finish('data:image/png;base64,T0xE'));
  expect(screen.queryByRole('button', { name: '开始识词' })).toBeNull();
  const replacement = 'data:image/png;base64,UkVQTEFDRU1FTlQ=';
  act(() => readers[1].finish(replacement));
  fireEvent.click(await screen.findByRole('button', { name: '开始识词' }));
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ imageUrl: replacement });
  await act(async () => pending.resolve(Response.json({ success: true, data: { keywords: ['新图片'] } })));
  expect(screen.getByText('新图片')).toBeTruthy();
});

it('ignores a vision response from a previous project visit', async () => {
  const pending = deferred<Response>();
  const fetcher = requestFixture('/api/vision-prompt', pending);
  const { rerender } = render(<OhMyPrompt {...visionProps} visionScopeKey="actor/a" />);
  fireEvent.click(await screen.findByRole('button', { name: '开始识词' }));
  rerender(<OhMyPrompt {...visionProps} visionScopeKey="actor/b" initialImageUrl="/synthetic/b.png" />);
  rerender(<OhMyPrompt {...visionProps} visionScopeKey="actor/a" />);
  await act(async () => pending.resolve(Response.json({ success: true, data: { keywords: ['上一次访问的结果'] } })));
  expect(screen.queryByText('上一次访问的结果')).toBeNull();
  expect(screen.getByRole('button', { name: '开始识词' })).toBeTruthy();
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it('hides external keywords from the previous image after a local replacement is selected', async () => {
  const readers = fileReaders();
  const visionResult: VisionApiResultData = { keywords: ['旧画布关键词'] };
  const { container } = render(<OhMyPrompt {...visionProps} visionResult={visionResult} />);
  expect(screen.getByText('旧画布关键词')).toBeTruthy();
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['fixture'], 'replacement.png', { type: 'image/png' })] } });
  expect(screen.queryByRole('button', { name: '发送关键词' })).toBeNull();
  act(() => readers[0].finish('data:image/png;base64,UkVQTEFDRU1FTlQ='));
  expect(screen.queryByText('旧画布关键词')).toBeNull();
  expect(screen.getByRole('button', { name: '开始识词' })).toBeTruthy();
});

it('invalidates the old optimization on Reset while allowing the new formula to optimize', async () => {
  const old = deferred<Response>(), fresh = deferred<Response>();
  const fetcher = requestFixture('/api/optimize-prompt', old, fresh);
  render(<PromptEquation {...equationProps} />);
  fireEvent.change(result(), { target: { value: '旧提示词' } }); optimize();
  fireEvent.click(screen.getByRole('button', { name: '重置' }));
  expect(result().value).toBe('');
  fireEvent.change(result(), { target: { value: '新提示词' } }); optimize();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => old.resolve(Response.json({ success: true, optimized: '旧优化结果' })));
  expect(screen.queryByText('旧优化结果')).toBeNull();
  expect(screen.getByRole('button', { name: '优化中...' })).toHaveProperty('disabled', true);
  await act(async () => fresh.resolve(Response.json({ success: true, optimized: '新优化结果' })));
  expect(await screen.findByText('新优化结果')).toBeTruthy();
});

it('drops a rejected optimization after closing and reopening the same equation instance', async () => {
  const pending = deferred<Response>();
  requestFixture('/api/optimize-prompt', pending);
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const { rerender } = render(<PromptEquation {...equationProps} />);
  fireEvent.change(result(), { target: { value: '保留的草稿' } }); optimize();
  rerender(<PromptEquation {...equationProps} open={false} />);
  rerender(<PromptEquation {...equationProps} />);
  await act(async () => pending.resolve(Response.json({ success: false, error: '旧错误' })));
  expect(alert).not.toHaveBeenCalled();
  expect(result().value).toBe('保留的草稿');
  await waitFor(() => expect(screen.getByRole('button', { name: '一键优化' })).toHaveProperty('disabled', false));
});
