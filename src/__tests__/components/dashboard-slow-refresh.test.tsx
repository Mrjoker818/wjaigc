// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemorySimpleChatEnvelopeStore, project } from '@/__tests__/fixtures/simple-chat-sync';
import DashboardView from '@/components/dashboard/dashboard-view';

const state = vi.hoisted(() => ({ mode: 'initial', release: null as null | ((response: Response) => void), store: null as ReturnType<typeof createMemorySimpleChatEnvelopeStore> | null }));
vi.mock('@/lib/simple-chat-sync-storage', () => ({ createIndexedDbSimpleChatEnvelopeStore: () => state.store! }));
const user = (id = 'A') => ({ id, name: id, productType: 'chat', createdAt: 1, updatedAt: 1 });
const props = (id = 'A') => ({ user: user(id), onOpenProject: () => {}, onNewProject: () => {} });
const response = (name: string, userId = 'A') => Response.json({ success: true, userId, value: [{ ...project('same'), name }], syncRevision: 1 });
beforeEach(() => {
  state.mode = 'initial'; state.release = null; state.store = createMemorySimpleChatEnvelopeStore();
  const values = new Map<string,string>(); vi.stubGlobal('localStorage', { get length() { return values.size; }, key: (i:number) => [...values.keys()][i] ?? null, getItem: (k:string) => values.get(k) ?? null, setItem: (k:string,v:string) => values.set(k,v), removeItem: (k:string) => values.delete(k), clear: () => values.clear() });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (!String(input).includes('chat_simple_projects')) return Response.json({ success: false });
    if (state.mode === 'hold') return new Promise<Response>(resolve => { state.release = resolve; });
    return state.mode === 'B' ? response('B项目', 'B') : response('初始项目');
  }));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { state.release?.(new Response('{}',{status:503})); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { for (let i=0; i<10; i++) await Promise.resolve(); }); }
async function slowFocus() {
  state.mode='hold'; act(() => window.dispatchEvent(new Event('focus'))); await flush(); expect(state.release).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
}

it('keeps the loaded list during slow focus refresh, then replaces it with the eventual result', async () => {
  render(<DashboardView {...props()} />); await flush(); expect(screen.getByText('初始项目')).toBeTruthy();
  await slowFocus(); expect(screen.getByText('初始项目')).toBeTruthy(); expect(screen.getByText('正在刷新对话项目。')).toBeTruthy(); expect(screen.getByText('读取较慢，仍在进行；完成后会自动显示，也可以重试。')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); state.release!(response('刷新后新项目')); await Promise.resolve(); }); await flush();
  expect(screen.getByText('刷新后新项目')).toBeTruthy(); expect(screen.queryByText('初始项目')).toBeNull(); expect(screen.queryByText('读取较慢，仍在进行；完成后会自动显示，也可以重试。')).toBeNull();
});

it('removes the previously displayed list when the slow refresh ends with 403', async () => {
  render(<DashboardView {...props()} />); await flush(); expect(screen.getByText('初始项目')).toBeTruthy();
  await slowFocus(); expect(screen.getByText('初始项目')).toBeTruthy();
  await act(async () => { state.release!(new Response('{}',{status:403})); await Promise.resolve(); }); await flush();
  expect(screen.queryByText('初始项目')).toBeNull(); expect(screen.getByText('当前账号无法读取对话项目，请检查登录状态后重试。')).toBeTruthy();
});

it('hides the retained A list immediately on switching accounts during the slow refresh', async () => {
  const view = render(<DashboardView {...props()} />); await flush(); expect(screen.getByText('初始项目')).toBeTruthy();
  await slowFocus(); const old=state.release!; state.mode='B'; view.rerender(<DashboardView {...props('B')} />); await flush();
  expect(screen.queryByText('初始项目')).toBeNull(); expect(screen.getByText('B项目')).toBeTruthy();
  await act(async () => { old(response('A迟到项目')); await Promise.resolve(); }); await flush(); expect(screen.queryByText('A迟到项目')).toBeNull(); expect(screen.getByText('B项目')).toBeTruthy();
});

it('initial slow read remains described as in progress rather than a failure', async () => {
  state.mode='hold'; render(<DashboardView {...props()} />); await flush(); expect(state.release).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByText('读取较慢，仍在进行；完成后会自动显示，也可以重试。')).toBeTruthy();
  expect(screen.getByText('正在读取项目')).toBeTruthy();
  expect(screen.queryByText('无法读取项目')).toBeNull(); expect(screen.queryByText('读取超时或服务不可用，请重试。')).toBeNull();
  await act(async () => { state.release!(response('首次慢读取项目')); await Promise.resolve(); }); await flush(); expect(screen.getByText('首次慢读取项目')).toBeTruthy();
});

it('keeps the loaded list during an explicit retry and ignores the cancelled refresh', async () => {
  render(<DashboardView {...props()} />); await flush(); expect(screen.getByText('初始项目')).toBeTruthy();
  await slowFocus(); const old=state.release!;
  fireEvent.click(screen.getByRole('button',{name:'重试读取'})); await flush(); const retried=state.release!;
  expect(retried).not.toBe(old); expect(screen.getByText('初始项目')).toBeTruthy();
  await act(async () => { old(response('被取消的旧刷新')); await Promise.resolve(); }); await flush();
  expect(screen.queryByText('被取消的旧刷新')).toBeNull(); expect(screen.getByText('初始项目')).toBeTruthy();
  await act(async () => { retried(response('重试后的项目')); await Promise.resolve(); }); await flush(); expect(screen.getByText('重试后的项目')).toBeTruthy();
});

it('replaces a previous authorization error with a loading state when the user retries', async () => {
  render(<DashboardView {...props()} />); await flush();
  await slowFocus();
  await act(async () => { state.release!(new Response('{}', { status: 403 })); await Promise.resolve(); }); await flush();
  expect(screen.getByText('当前账号无法读取对话项目，请检查登录状态后重试。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试读取' })); await flush();
  expect(screen.queryByText('当前账号无法读取对话项目，请检查登录状态后重试。')).toBeNull();
  expect(screen.getByText('正在加载对话项目…')).toBeTruthy();
  await act(async () => { state.release!(response('恢复后项目')); await Promise.resolve(); }); await flush();
  expect(screen.getByText('恢复后项目')).toBeTruthy();
});
