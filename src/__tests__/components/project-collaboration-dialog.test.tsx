// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

const manager = vi.hoisted(() => ({
  flushProjectsToServerWithConflictRecovery: vi.fn(), getProjectSyncRevision: vi.fn(),
  loadProjectsFromServer: vi.fn(), getCurrentUserId: vi.fn(),
}));
vi.mock('@/lib/user-manager', () => ({ UserManager: { getInstance: () => manager } }));
import { ProjectCollaborationDialog } from '@/components/dashboard/project-collaboration-dialog';
import { DashboardProjectActionsMenu } from '@/components/dashboard/project-actions-menu';

const props = { open: true, userId: 'owner-a', projectId: 'temp', projectName: '项目甲',
  returnFocusTarget: null, onOpenChange: vi.fn() };
let enabled: boolean;
let featureEnabled: boolean;
let editors: { userId: string; name: string }[];
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(() => {
  enabled = false; featureEnabled = true; editors = [{ userId: 'editor-a', name: 'Editor A' }];
  manager.flushProjectsToServerWithConflictRecovery.mockReset().mockResolvedValue({ projectIdMap: { temp: 'stored' } });
  manager.getProjectSyncRevision.mockReset().mockReturnValue(8);
  manager.loadProjectsFromServer.mockReset().mockResolvedValue(true);
  manager.getCurrentUserId.mockReset().mockReturnValue('owner-a');
  fetcher = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname.endsWith('document-enable')) {
      if (init.method === 'POST') {
        enabled = true;
        return Response.json({ success: true, projectId: JSON.parse(init.body as string).projectId });
      }
      return Response.json({ success: true, projectId: url.searchParams.get('projectId'),
        featureEnabled, enabled, currentRevision: 8 });
    }
    if (init.method === 'POST') editors.push({ userId: 'editor-b', name: JSON.parse(init.body as string).memberName });
    if (init.method === 'DELETE') editors = editors.filter(editor => editor.userId !== JSON.parse(init.body as string).memberUserId);
    return Response.json({ success: true, editors });
  });
  vi.stubGlobal('fetch', fetcher);
  const testNavigator = Object.create(navigator) as Navigator;
  Object.defineProperty(testNavigator, 'clipboard', { configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.stubGlobal('navigator', testNavigator);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('real collaboration management controls', () => {
  it('retries a failed status read without guessing that enable is available', async () => {
    fetcher.mockRejectedValueOnce(new Error('offline'));
    render(<ProjectCollaborationDialog {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '重试读取状态' }));
    expect(await screen.findByRole('button', { name: '启用协作' })).toBeTruthy();
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0);
  });
  it.each([[401, 'AUTHENTICATION_REQUIRED', '登录状态已失效，请重新登录'],
    [409, 'DOCUMENT_AUTHORITY_CONFLICT', '项目协作记录不一致，请刷新后重试']] as const)
    ('does not turn status failure %s into an unenabled project', async (status, code, message) => {
      fetcher.mockResolvedValueOnce(Response.json({ success: false, code }, { status }));
      render(<ProjectCollaborationDialog {...props} />);
      expect(await screen.findByText(message)).toBeTruthy();
      expect(screen.queryByRole('button', { name: '启用协作' })).toBeNull();
    });
  it('copies the persisted login link only after clipboard success', async () => {
    render(<ProjectCollaborationDialog {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '启用协作' }));
    const copy = await screen.findByRole('button', { name: '复制协作链接' });
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(copy);
    expect(await screen.findByText('链接已复制')).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/?projectId=stored`);
  });
  it('discards a delayed enable success after closing without refreshing projects', async () => {
    let complete!: (response: Response) => void;
    const defaultFetch = fetcher.getMockImplementation();
    fetcher.mockImplementation((input: string, init: RequestInit = {}) => init.method === 'POST'
      ? new Promise(resolve => { complete = resolve; }) : defaultFetch?.(input, init));
    const view = render(<ProjectCollaborationDialog {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '启用协作' }));
    await waitFor(() => expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true));
    view.rerender(<ProjectCollaborationDialog {...props} open={false} />);
    await act(async () => { complete(Response.json({ success: true, projectId: 'stored' })); });
    expect(manager.loadProjectsFromServer).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('returns keyboard focus to the invoking button on Escape', async () => {
    function FocusHarness(): React.ReactNode {
      const [open, setOpen] = useState(false);
      const [target, setTarget] = useState<HTMLButtonElement | null>(null);
      return <><button onClick={event => { setTarget(event.currentTarget); setOpen(true); }}>打开协作</button>
        <ProjectCollaborationDialog {...props} open={open} onOpenChange={setOpen} returnFocusTarget={target} /></>;
    }
    render(<FocusHarness />);
    const trigger = screen.getByRole('button', { name: '打开协作' });
    fireEvent.click(trigger);
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('opens the management dialog from the existing project menu', async () => {
    function Harness(): React.ReactNode {
      const [open, setOpen] = useState(false);
      return <><DashboardProjectActionsMenu projectName="项目甲" onRename={() => {}} onExport={() => {}}
        onDelete={() => {}} onManageShare={() => {}} {...{ onManageCollaboration: () => setOpen(true) }} />
        <ProjectCollaborationDialog {...props} open={open} onOpenChange={setOpen} /></>;
    }
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('button', { name: '项目甲 项目操作菜单' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '管理协作' }));
    expect(await screen.findByRole('dialog', { name: /管理协作/ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: '启用协作' })).toBeTruthy();
  });
  it('does not offer enable while the server feature is off', async () => {
    featureEnabled = false;
    render(<ProjectCollaborationDialog {...props} />);
    expect(await screen.findByText('协作功能暂未开放')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '启用协作' })).toBeNull();
  });
  it('enables only after save and awaits the owner project refresh', async () => {
    let finishSave!: (value: { projectIdMap: Record<string, string> }) => void;
    manager.flushProjectsToServerWithConflictRecovery.mockReturnValue(new Promise(resolve => { finishSave = resolve; }));
    render(<ProjectCollaborationDialog {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '启用协作' }));
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0);
    await act(async () => { finishSave({ projectIdMap: { temp: 'stored' } }); });
    expect(await screen.findByText('协作已启用')).toBeTruthy();
    expect(manager.loadProjectsFromServer).toHaveBeenCalledWith(0, 'owner-a');
    const mutation = fetcher.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(mutation?.[1].body as string)).toEqual({ projectId: 'stored', expectedRevision: 8 });
  });
  it('reports refresh failure after enable without enabling twice on retry', async () => {
    manager.loadProjectsFromServer.mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<ProjectCollaborationDialog {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '启用协作' }));
    expect(await screen.findByText('已启用，项目刷新失败')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试项目刷新' }));
    await waitFor(() => expect(manager.loadProjectsFromServer).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('invites by account name and revokes the chosen editor', async () => {
    enabled = true;
    render(<ProjectCollaborationDialog {...props} />);
    expect(await screen.findByText('Editor A')).toBeTruthy();
    expect(screen.queryByLabelText('用户 ID')).toBeNull();
    fireEvent.change(screen.getByLabelText('登录账号名称'), { target: { value: 'Editor B' } });
    fireEvent.click(screen.getByRole('button', { name: '邀请编辑者' }));
    expect(await screen.findByText('Editor B')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销 Editor A 的编辑权限' }));
    await waitFor(() => expect(screen.queryByText('Editor A')).toBeNull());
  });
  it('does not claim copy success when the clipboard rejects', async () => {
    enabled = true;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<ProjectCollaborationDialog {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '复制协作链接' }));
    expect(await screen.findByText('复制失败，请手动复制链接')).toBeTruthy();
    expect(screen.queryByText('链接已复制')).toBeNull();
  });
  it('discards a delayed save after switching project', async () => {
    let finishSave!: (value: { projectIdMap: Record<string, string> }) => void;
    manager.flushProjectsToServerWithConflictRecovery.mockReturnValue(new Promise(resolve => { finishSave = resolve; }));
    const view = render(<ProjectCollaborationDialog {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '启用协作' }));
    view.rerender(<ProjectCollaborationDialog {...props} projectId="project-b" projectName="项目乙" />);
    await act(async () => { finishSave({ projectIdMap: { temp: 'stored' } }); });
    await screen.findByRole('button', { name: '启用协作' });
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0);
    expect(manager.loadProjectsFromServer).not.toHaveBeenCalled();
  });
});
