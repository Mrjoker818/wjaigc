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

const user: User = { id: 'admin-a', name: 'Admin', password: '', role: 'admin', status: 'active', createdAt: 1, updatedAt: 1, productType: 'canvas' };
const group = { id: 'g1', name: '原分组', product_types: ['canvas'], credit_quota: 1, is_active: true, created_at: 1, updated_at: 1 };
let writes: number;
let reply: () => Promise<Response>;
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
async function mount(): Promise<void> {
  render(<DashboardView user={user} onOpenProject={() => {}} onNewProject={() => {}} />);
  navigate();
  expect(await screen.findByText('原分组')).toBeTruthy();
}
beforeEach(() => {
  writes = 0;
  reply = async () => Response.json({ success: true });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/admin/groups') {
      if (init?.method === 'POST') { writes++; return reply(); }
      return Response.json({ success: true, groups: [group] });
    }
    return Response.json({ success: false });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('administrator group write feedback', () => {
  it('keeps the edit and shows an unconfirmed result on server failure', async () => {
    reply = async () => Response.json({ success: false, outcome: 'unknown' }, { status: 503 });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '编辑分组：原分组' }));
    const draft = screen.getByRole('textbox', { name: '分组名称（编辑）' });
    fireEvent.change(draft, { target: { value: '编辑中的分组' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/分组操作结果尚未确认/)).toBeTruthy();
    expect(draft).toHaveProperty('value', '编辑中的分组');
    expect(screen.getByRole('textbox', { name: '分组名称（编辑）' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(writes).toBe(1);
  });
  it('keeps a create draft when a 200 response does not confirm success', async () => {
    reply = async () => Response.json({ success: false });
    await mount();
    const draft = screen.getByRole('textbox', { name: '分组名称' });
    fireEvent.change(draft, { target: { value: '尚未确认的分组' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText(/分组操作结果尚未确认/)).toBeTruthy();
    expect(draft).toHaveProperty('value', '尚未确认的分组');
  });
  it('admits only one request for repeated activation while the result is pending', async () => {
    const pending = deferred(); reply = () => pending.promise;
    await mount();
    const draft = screen.getByRole('textbox', { name: '分组名称' });
    fireEvent.change(draft, { target: { value: '仅提交一次' } });
    const submit = screen.getByRole('button', { name: '创建' });
    fireEvent.click(submit); fireEvent.click(submit);
    await waitFor(() => expect(writes).toBe(1));
    await act(async () => { pending.resolve(Response.json({ success: false }, { status: 503 })); await pending.promise; });
    expect(await screen.findByText(/分组操作结果尚未确认/)).toBeTruthy();
    expect(writes).toBe(1);
  });
  it('preserves later edits if an earlier create returns success', async () => {
    const pending = deferred(); reply = () => pending.promise;
    await mount();
    const draft = screen.getByRole('textbox', { name: '分组名称' });
    fireEvent.change(draft, { target: { value: '已提交名称' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(writes).toBe(1));
    fireEvent.change(draft, { target: { value: '稍后输入的新草稿' } });
    await act(async () => { pending.resolve(Response.json({ success: true })); await pending.promise; });
    expect(draft).toHaveProperty('value', '稍后输入的新草稿');
  });
  it('retains an unconfirmed write lock across account switches in the same dashboard session', async () => {
    const pending = deferred(); reply = () => pending.promise;
    const view = render(<DashboardView user={user} onOpenProject={() => {}} onNewProject={() => {}} />);
    navigate(); expect(await screen.findByText('原分组')).toBeTruthy();
    const draft = screen.getByRole('textbox', { name: '分组名称' });
    fireEvent.change(draft, { target: { value: '账号甲待核操作' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(writes).toBe(1));
    view.rerender(<DashboardView user={{ ...user, id: 'admin-b' }} onOpenProject={() => {}} onNewProject={() => {}} />);
    await act(async () => { pending.resolve(Response.json({ success: false }, { status: 503 })); await pending.promise; });
    view.rerender(<DashboardView user={user} onOpenProject={() => {}} onNewProject={() => {}} />);
    expect(await screen.findByText(/分组操作结果尚未确认/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建' })).toHaveProperty('disabled', true);
    expect(writes).toBe(1);
  });
  it('keeps the delete confirmation open when the result is unknown', async () => {
    reply = async () => Response.json({ success: false, outcome: 'unknown' }, { status: 503 });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '删除分组：原分组' }));
    const dialog = screen.getByRole('dialog', { name: '删除分组' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    expect(await screen.findByText(/分组操作结果尚未确认/)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '删除分组' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    expect(writes).toBe(1);
  });
  it('does not clear a newer edit when an earlier update completes', async () => {
    const pending = deferred(); reply = () => pending.promise;
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '编辑分组：原分组' }));
    const draft = screen.getByRole('textbox', { name: '分组名称（编辑）' });
    fireEvent.change(draft, { target: { value: '已提交的修改' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(writes).toBe(1));
    fireEvent.change(draft, { target: { value: '稍后输入的修改' } });
    await act(async () => { pending.resolve(Response.json({ success: true })); await pending.promise; });
    expect(screen.getByRole('textbox', { name: '分组名称（编辑）' })).toHaveProperty('value', '稍后输入的修改');
  });
  it('closes a prior administrator deletion dialog on account change without submitting', async () => {
    const view = render(<DashboardView user={user} onOpenProject={() => {}} onNewProject={() => {}} />);
    navigate(); expect(await screen.findByText('原分组')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除分组：原分组' }));
    expect(screen.getByRole('dialog', { name: '删除分组' })).toBeTruthy();
    view.rerender(<DashboardView user={{ ...user, id: 'admin-b' }} onOpenProject={() => {}} onNewProject={() => {}} />);
    expect(screen.queryByRole('dialog', { name: '删除分组' })).toBeNull();
    expect(writes).toBe(0);
  });
  it('keeps a create draft scoped to its administrator across account changes', async () => {
    const view = render(<DashboardView user={user} onOpenProject={() => {}} onNewProject={() => {}} />);
    navigate(); expect(await screen.findByText('原分组')).toBeTruthy();
    const draft = screen.getByRole('textbox', { name: '分组名称' });
    fireEvent.change(draft, { target: { value: '甲的未提交草稿' } });
    view.rerender(<DashboardView user={{ ...user, id: 'admin-b' }} onOpenProject={() => {}} onNewProject={() => {}} />);
    expect(screen.getByRole('textbox', { name: '分组名称' })).toHaveProperty('value', '');
    view.rerender(<DashboardView user={user} onOpenProject={() => {}} onNewProject={() => {}} />);
    expect(screen.getByRole('textbox', { name: '分组名称' })).toHaveProperty('value', '甲的未提交草稿');
    expect(writes).toBe(0);
  });
  it('keeps an edit draft scoped to its administrator across account changes', async () => {
    const view = render(<DashboardView user={user} onOpenProject={() => {}} onNewProject={() => {}} />);
    navigate(); expect(await screen.findByText('原分组')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑分组：原分组' }));
    fireEvent.change(screen.getByRole('textbox', { name: '分组名称（编辑）' }), { target: { value: '甲的编辑草稿' } });
    view.rerender(<DashboardView user={{ ...user, id: 'admin-b' }} onOpenProject={() => {}} onNewProject={() => {}} />);
    expect(screen.queryByRole('textbox', { name: '分组名称（编辑）' })).toBeNull();
    expect(await screen.findByText('原分组')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑分组：原分组' }));
    expect(screen.getByRole('textbox', { name: '分组名称（编辑）' })).toHaveProperty('value', '原分组');
    view.rerender(<DashboardView user={user} onOpenProject={() => {}} onNewProject={() => {}} />);
    expect(await screen.findByRole('textbox', { name: '分组名称（编辑）' })).toHaveProperty('value', '甲的编辑草稿');
    expect(writes).toBe(0);
  });
});
