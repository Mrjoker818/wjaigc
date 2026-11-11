// @vitest-environment jsdom

import { Blob as BinaryBlob } from 'node:buffer';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ImageLightbox } from '@/components/simple-chat/image-lightbox';
import { MemoryPanel } from '@/components/simple-chat/memory-panel';
import { ModelCompare } from '@/components/simple-chat/model-compare';
import { PromptOptimizer } from '@/components/simple-chat/prompt-optimizer';
import { ShareDialog } from '@/components/simple-chat/share-dialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ['jpg', [0xff, 0xd8, 0xff]],
  ['webp', [...new TextEncoder().encode('RIFF0000WEBP')]],
] as const)('downloads original %s bytes with the right extension despite a generic response type', async (extension, bytes) => {
  const original = new BinaryBlob([Uint8Array.from(bytes)], { type: 'application/octet-stream' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => original })));
  const createObjectURL = vi.fn((_blob: unknown) => 'blob:download');
  const originalUrl = globalThis.URL;
  vi.stubGlobal('URL', class extends originalUrl {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = vi.fn();
  });
  const clicked = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked(this.download);
  });
  render(<ImageLightbox images={['/image']} initialIndex={0} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '下载' }));
  await waitFor(() => expect(clicked).toHaveBeenCalledWith('image-1.' + extension));
  expect(createObjectURL.mock.calls[0]?.[0]).toBe(original);
});

it('contains memory focus, ignores candidate confirmation Enter, and restores focus on Escape', async () => {
  const onAdd = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>记忆入口</button>
      <button>背景按钮</button>
      {open && <MemoryPanel memories={[]} onClose={() => setOpen(false)} onAdd={onAdd} onDelete={vi.fn()} />}
    </>;
  }
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: '记忆入口' });
  const background = screen.getByRole('button', { name: '背景按钮' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'AI 记忆' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  background.focus();
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '偏好设置' }));
  const textbox = screen.getByRole('textbox', { name: '记忆内容' });
  fireEvent.change(textbox, { target: { value: '中文偏好' } });
  fireEvent.keyDown(textbox, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(textbox, { key: 'Enter', keyCode: 229 });
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.keyDown(textbox, { key: 'Enter' });
  await waitFor(() => expect(onAdd).toHaveBeenCalledExactlyOnceWith('中文偏好', 'preference'));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['prompt', 'mode'])('invalidates an optimized result when the %s changes', async field => {
  const onApply = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, optimized: 'Old optimization' })));
  render(<PromptOptimizer isMonochrome currentPrompt="Old prompt" onApply={onApply} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '开始优化' }));
  await screen.findByRole('button', { name: '应用结果' });
  if (field === 'prompt') {
    fireEvent.change(screen.getByRole('textbox', { name: '原始提示词' }), { target: { value: 'New prompt' } });
  } else {
    fireEvent.click(screen.getByRole('button', { name: /扩展/ }));
  }
  expect(screen.queryByRole('button', { name: '应用结果' })).toBeNull();
  expect(screen.queryByText('Old optimization')).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
});

it('accepts terminal one-shot guidance and rejects an interrupted model stream', async () => {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const { providerId } = JSON.parse(String(init.body));
    const complete = providerId === 'provider-a';
    const body = complete
      ? 'data: {"type":"text","content":"请先选择目标画布项目。"}\n\ndata: {"type":"done"}\n\n'
      : 'data: {"type":"text","content":"Partial"}\n\n';
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ModelCompare isMonochrome prompt="Mock comparison" models={[
    { id: 'same-model', providerId: 'provider-a' }, { id: 'same-model', providerId: 'provider-b' },
  ]} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '对比' }));
  await screen.findByText('请先选择目标画布项目。');
  expect((await screen.findByRole('alert')).textContent).toContain('响应未完整结束');
  expect(screen.getAllByTitle('复制回答')).toHaveLength(1);
  expect(fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init.body))])).toEqual([
    ['/api/simple-chat/chat', { model: 'same-model', providerId: 'provider-a', messages: [{ role: 'user', content: 'Mock comparison' }] }],
    ['/api/simple-chat/chat', { model: 'same-model', providerId: 'provider-b', messages: [{ role: 'user', content: 'Mock comparison' }] }],
  ]);
});

it.each(['lost', 'malformed'])('reuses the original share operation after a %s receipt and reopening', async receipt => {
  const shareId = '0123456789abcdef';
  const fetchMock = vi.fn<typeof fetch>()
    .mockImplementationOnce(async () => {
      if (receipt === 'lost') throw new Error('offline');
      return Response.json({ shareId, shareUrl: 'https://other.invalid/shared/' + shareId });
    })
    .mockResolvedValueOnce(Response.json({ shareId, shareUrl: '/shared/' + shareId }));
  vi.stubGlobal('fetch', fetchMock);
  const mount = () => render(<ShareDialog userId="actor-a" conversationId="task-a" conversationTitle="Snapshot"
    messages={[{ id: 'system', role: 'system', content: 'hidden' }, { id: 'one', role: 'user', content: 'public' }]} onClose={vi.fn()} />);
  const create = () => fireEvent.click(screen.getByRole('button', { name: '创建分享链接' }));
  const first = mount();
  create();
  await screen.findByRole('alert');
  expect(screen.queryByRole('textbox', { name: '分享链接' })).toBeNull();
  first.unmount();
  mount();
  create();
  const link = await screen.findByRole<HTMLInputElement>('textbox', { name: '分享链接' });
  expect(link.value).toBe(window.location.origin + '/shared/' + shareId);
  const calls = fetchMock.mock.calls;
  const headers = calls.map(([, init]) => new Headers(init?.headers));
  expect(headers[0].get('idempotency-key')).toMatch(/^[a-f0-9-]{36}$/);
  expect(headers[1].get('idempotency-key')).toBe(headers[0].get('idempotency-key'));
  expect(headers.map(header => header.get('x-wujie-expected-actor-id'))).toEqual(['actor-a', 'actor-a']);
  expect(JSON.parse(String(calls[1][1]?.body)).messages).toEqual([{ id: 'one', role: 'user', content: 'public' }]);
});
