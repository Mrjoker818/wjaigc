// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SimpleChatProject } from '@/components/simple-chat/simple-chat-types';
import type { User } from '@/lib/user-types';
import * as syncClient from '@/lib/simple-chat-sync-client';
import DashboardView from '@/components/dashboard/dashboard-view';

function project(name: string): SimpleChatProject {
  return { id: name, name, emoji: 'C', description: '', tasks: [], agents: [], knowledgeItems: [], createdAt: 1, updatedAt: 1 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function user(id = 'A', productType = 'chat'): User {
  return { id, name: id, productType, createdAt: 1, updatedAt: 1 };
}

const props = (current: User) => ({ user: current, onOpenProject: vi.fn(), onNewProject: vi.fn() });

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k), clear: () => values.clear(),
  });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps the newer same-account focus result when the earlier request completes last', async () => {
  const old = deferred<SimpleChatProject[]>();
  const fresh = deferred<SimpleChatProject[]>();
  const load = vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects')
    .mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  render(<DashboardView {...props(user())} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await act(async () => { fresh.resolve([project('新结果')]); await fresh.promise; });
  expect(screen.getByText('新结果')).toBeTruthy();
  await act(async () => { old.resolve([project('旧结果')]); await old.promise; });
  expect(screen.getByText('新结果')).toBeTruthy();
  expect(screen.queryByText('旧结果')).toBeNull();
});

it('does not resurrect an earlier result after the newest loader returns an empty failure result', async () => {
  const old = deferred<SimpleChatProject[]>();
  const fresh = deferred<SimpleChatProject[]>();
  const load = vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects')
    .mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  render(<DashboardView {...props(user())} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await act(async () => { fresh.resolve([]); await fresh.promise; });
  expect(screen.getByText('暂无对话项目')).toBeTruthy();
  await act(async () => { old.resolve([project('不应复活')]); await old.promise; });
  expect(screen.queryByText('不应复活')).toBeNull();
  expect(screen.getByText('暂无对话项目')).toBeTruthy();
});

it('ignores outstanding chat responses after product type changes, without removing non-chat navigation', async () => {
  const old = deferred<SimpleChatProject[]>();
  const returned = deferred<SimpleChatProject[]>();
  const load = vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects').mockReturnValueOnce(old.promise).mockReturnValueOnce(returned.promise);
  const view = render(<DashboardView {...props(user('A', 'chat'))} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  view.rerender(<DashboardView {...props(user('A', 'canvas'))} />);
  expect(screen.getByRole('button', { name: /我的项目/ })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '我的项目' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '智能对话' })).toBeNull();
  await act(async () => { old.resolve([project('类型切换旧结果')]); await old.promise; });
  expect(screen.queryByText('类型切换旧结果')).toBeNull();
  act(() => window.dispatchEvent(new Event('focus')));
  expect(load).toHaveBeenCalledTimes(1);
  view.rerender(<DashboardView {...props(user('A', 'chat'))} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('heading', { name: '智能对话' })).toBeTruthy();
  await act(async () => { returned.resolve([project('重新启用结果')]); await returned.promise; });
  expect(screen.getByText('重新启用结果')).toBeTruthy();
});

it('keeps A results out of B after an account change with outstanding requests', async () => {
  const old = deferred<SimpleChatProject[]>();
  const fresh = deferred<SimpleChatProject[]>();
  const load = vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects')
    .mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const view = render(<DashboardView {...props(user('A'))} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  view.rerender(<DashboardView {...props(user('B'))} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await act(async () => { fresh.resolve([project('B项目')]); await fresh.promise; });
  await act(async () => { old.resolve([project('A项目')]); await old.promise; });
  expect(screen.getByText('B项目')).toBeTruthy();
  expect(screen.queryByText('A项目')).toBeNull();
});

it('unsubscribes focus and ignores a pending result after unmount', async () => {
  const old = deferred<SimpleChatProject[]>();
  const load = vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects').mockReturnValueOnce(old.promise);
  const view = render(<DashboardView {...props(user())} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  view.unmount();
  act(() => window.dispatchEvent(new Event('focus')));
  await act(async () => { old.resolve([project('卸载旧结果')]); await old.promise; });
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('卸载旧结果')).toBeNull();
});

it('does not redisplay old projects while chat access is restored and a fresh load is pending', async () => {
  const fresh = deferred<SimpleChatProject[]>();
  const load = vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects')
    .mockResolvedValueOnce([project('撤权前旧项目')]).mockReturnValueOnce(fresh.promise);
  const view = render(<DashboardView {...props(user('A', 'chat'))} />);
  expect(await screen.findByText('撤权前旧项目')).toBeTruthy();
  view.rerender(<DashboardView {...props(user('A', 'canvas'))} />);
  expect(screen.queryByText('撤权前旧项目')).toBeNull();
  view.rerender(<DashboardView {...props(user('A', 'chat'))} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('撤权前旧项目')).toBeNull();
  await act(async () => { fresh.resolve([project('重新加载项目')]); await fresh.promise; });
  expect(screen.getByText('重新加载项目')).toBeTruthy();
});

it('returns to an available page when administrator access is removed', async () => {
  vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects').mockResolvedValue([]);
  const privileged = { ...user('A', 'canvas,chat'), role: 'admin' as const };
  const view = render(<DashboardView {...props(privileged)} />);
  await screen.findByRole('heading', { name: '我的项目' });
  await act(async () => { await Promise.resolve(); });
  act(() => { screen.getByRole('button', { name: /API 管理/ }).click(); });
  view.rerender(<DashboardView {...props({ ...privileged, role: 'user' })} />);
  expect(screen.queryByRole('button', { name: /API 管理/ })).toBeNull();
  expect(screen.getByRole('heading', { name: '我的项目' })).toBeTruthy();
});

it('does not revive an earlier account projection while a return to that account reloads', async () => {
  const other = deferred<SimpleChatProject[]>();
  const returned = deferred<SimpleChatProject[]>();
  const load = vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects')
    .mockResolvedValueOnce([project('A旧项目')])
    .mockReturnValueOnce(other.promise)
    .mockReturnValueOnce(returned.promise);
  const view = render(<DashboardView {...props(user('A'))} />);
  expect(await screen.findByText('A旧项目')).toBeTruthy();
  view.rerender(<DashboardView {...props(user('B'))} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  view.rerender(<DashboardView {...props(user('A'))} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  expect(screen.queryByText('A旧项目')).toBeNull();
  await act(async () => { returned.resolve([project('A最新项目')]); await returned.promise; });
  expect(screen.getByText('A最新项目')).toBeTruthy();
  await act(async () => { other.resolve([project('B旧响应')]); await other.promise; });
  expect(screen.queryByText('B旧响应')).toBeNull();
});

it('keeps the loaded chat list when another product changes but chat remains available', async () => {
  const load = vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects').mockResolvedValue([project('保留的对话')]);
  const view = render(<DashboardView {...props(user('A', 'chat'))} />);
  expect(await screen.findByText('保留的对话')).toBeTruthy();
  view.rerender(<DashboardView {...props(user('A', 'canvas,chat'))} />);
  expect(screen.getByText('保留的对话')).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(1);
});

it('keeps the current result and one focus listener under StrictMode effect replay', async () => {
  const old = deferred<SimpleChatProject[]>();
  const current = deferred<SimpleChatProject[]>();
  const focused = deferred<SimpleChatProject[]>();
  const load = vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects')
    .mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise).mockReturnValueOnce(focused.promise);
  render(<React.StrictMode><DashboardView {...props(user())} /></React.StrictMode>);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await act(async () => { current.resolve([project('当前结果')]); await current.promise; });
  await act(async () => { old.resolve([project('重放前结果')]); await old.promise; });
  expect(screen.getByText('当前结果')).toBeTruthy();
  expect(screen.queryByText('重放前结果')).toBeNull();
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  await act(async () => { focused.resolve([project('焦点结果')]); await focused.promise; });
  expect(screen.getByText('焦点结果')).toBeTruthy();
});

it('shows loading rather than an empty project list until the current account has loaded', async () => {
  const current = deferred<SimpleChatProject[]>();
  vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects').mockReturnValueOnce(current.promise);
  render(<DashboardView {...props(user())} />);
  expect(screen.getByText('正在加载对话项目…')).toBeTruthy();
  expect(screen.queryByText('暂无对话项目')).toBeNull();
  await act(async () => { current.resolve([]); await current.promise; });
  expect(screen.queryByText('正在加载对话项目…')).toBeNull();
  expect(screen.getByText('暂无对话项目')).toBeTruthy();
});
