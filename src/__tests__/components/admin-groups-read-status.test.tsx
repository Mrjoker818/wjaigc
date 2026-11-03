// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/user-types';

const manager = vi.hoisted(() => ({
  getProjects: vi.fn(() => []), getUsageStats: vi.fn(() => []), getCurrentUserId: vi.fn(() => 'admin-a'),
}));
vi.mock('@/lib/user-manager', () => ({ UserManager: { getInstance: () => manager } }));
import DashboardView from '@/components/dashboard/dashboard-view';

const user = (id: string): User => ({ id, name: id, password: '', role: 'admin', status: 'active', createdAt: 1, updatedAt: 1, productType: 'canvas' });
const group = (name: string) => ({ id: `id-${name}`, name, product_types: ['canvas'], credit_quota: 1, is_active: true, created_at: 1, updated_at: 1 });
let responses: Array<() => Promise<Response>>;
let groupRequests: number;
function deferred(): { promise: Promise<Response>; resolve: (value: Response) => void } {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
function navigate(): void {
  const trigger = screen.queryByRole('button', { name: '展开导航' });
  if (trigger) fireEvent.click(trigger);
  fireEvent.click(within(screen.getByRole('navigation', { hidden: true })).getByRole('button', { name: /分组管理/ }));
}
const ok = (name: string): Response => Response.json({ success: true, groups: [group(name)] });

beforeEach(() => {
  groupRequests = 0;
  responses = [async () => ok('原分组')];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/admin/groups') {
      groupRequests++;
      const response = responses.shift();
      if (!response) throw Error('UNEXPECTED_GROUP_REQUEST');
      return response();
    }
    return Response.json({ success: false });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('administrator group read status', () => {
  it('does not describe a failed initial read as an empty group list and can retry', async () => {
    responses = [async () => new Response('{}', { status: 503 }), async () => ok('恢复的分组')];
    render(<DashboardView user={user('admin-a')} onOpenProject={() => {}} onNewProject={() => {}} />);
    navigate();
    expect(await screen.findByText(/未能读取最新分组/)).toBeTruthy();
    expect(screen.queryByText('暂无分组，请创建第一个分组')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByText('恢复的分组')).toBeTruthy();
    expect(screen.queryByText(/未能读取最新分组/)).toBeNull();
  });

  it('shows the empty message only after a successful empty response', async () => {
    responses = [async () => Response.json({ success: true, groups: [] })];
    render(<DashboardView user={user('admin-a')} onOpenProject={() => {}} onNewProject={() => {}} />);
    navigate();
    expect(await screen.findByText('暂无分组，请创建第一个分组')).toBeTruthy();
    expect(screen.queryByText(/未能读取最新分组/)).toBeNull();
  });

  it('reports a failed refresh while keeping the existing list and draft', async () => {
    responses.push(async () => new Response('{}', { status: 503 }));
    render(<DashboardView user={user('admin-a')} onOpenProject={() => {}} onNewProject={() => {}} />);
    navigate();
    expect(await screen.findByText('原分组')).toBeTruthy();
    const draft = screen.getByRole('textbox', { name: '分组名称' });
    fireEvent.change(draft, { target: { value: '未保存草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByText(/未能读取最新分组/)).toBeTruthy();
    expect(screen.getByText('原分组')).toBeTruthy();
    expect(draft).toHaveProperty('value', '未保存草稿');
  });

  it('ignores an older refresh after a newer response arrives', async () => {
    const old = deferred();
    responses.push(() => old.promise, async () => ok('新分组'));
    render(<DashboardView user={user('admin-a')} onOpenProject={() => {}} onNewProject={() => {}} />);
    navigate();
    expect(await screen.findByText('原分组')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(groupRequests).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByText('新分组')).toBeTruthy();
    await act(async () => { old.resolve(ok('迟到旧分组')); await old.promise; });
    expect(screen.queryByText('迟到旧分组')).toBeNull();
    expect(screen.getByText('新分组')).toBeTruthy();
  });

  it('does not show a previous account response after switching administrators', async () => {
    const old = deferred(); responses = [() => old.promise, async () => ok('新账号分组')];
    const view = render(<DashboardView user={user('admin-a')} onOpenProject={() => {}} onNewProject={() => {}} />);
    navigate();
    await waitFor(() => expect(groupRequests).toBe(1));
    view.rerender(<DashboardView user={user('admin-b')} onOpenProject={() => {}} onNewProject={() => {}} />);
    expect(await screen.findByText('新账号分组')).toBeTruthy();
    await act(async () => { old.resolve(ok('旧账号分组')); await old.promise; });
    expect(screen.queryByText('旧账号分组')).toBeNull();
    expect(screen.getByText('新账号分组')).toBeTruthy();
  });
});
