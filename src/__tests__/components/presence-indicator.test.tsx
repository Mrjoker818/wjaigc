// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PresenceIndicator } from '@/components/collaboration/presence-indicator';
import { useProjectPresence } from '@/lib/collaboration/presence-client';

vi.mock('@/lib/collaboration/presence-client', () => ({ useProjectPresence: vi.fn() }));

describe('PresenceIndicator', () => {
  beforeEach(() => {
    vi.mocked(useProjectPresence).mockReturnValue({ status: 'connecting', participants: [] });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('连接中和服务不可用均不虚报人数，窄屏保持紧凑且状态可读', () => {
    const { rerender } = render(<PresenceIndicator projectId="project-a" isOwner={false} themeStyle="gold" />);
    expect(screen.getByRole('status', { name: '在线状态' }).textContent).toContain('连接中');
    expect(screen.queryByText(/人在线/u)).toBeNull();
    vi.mocked(useProjectPresence).mockReturnValue({ status: 'unavailable', participants: [] });
    rerender(<PresenceIndicator projectId="project-a" isOwner={false} themeStyle="gold" />);
    expect(screen.getByRole('status', { name: '在线状态' }).textContent).toContain('在线状态暂不可用');
    expect(screen.queryByRole('button', { name: '管理在线成员' })).toBeNull();
  });

  it('默认关闭时不改变既有画布标题与项目菜单', () => {
    vi.mocked(useProjectPresence).mockReturnValue({ status: 'disabled', participants: [] });
    const { container } = render(<PresenceIndicator projectId="project-a" isOwner themeStyle="gold" />);
    expect(container.querySelector('[data-presence-indicator]')).toBeNull();
    expect(screen.queryByRole('button', { name: '管理在线成员' })).toBeNull();
  });

  it('同一用户只显示一次，在线成员管理仅对项目所有者开放', async () => {
    vi.mocked(useProjectPresence).mockReturnValue({ status: 'online', participants: [
      { userId: 'u1', displayName: '一号', lastSeenAt: '2026-09-24T00:00:00Z' },
    ] });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ success: true, members: [
      { userId: 'u2', name: '二号' },
    ] }) } as Response);
    render(<PresenceIndicator projectId="project-a" isOwner themeStyle="monochrome" />);
    expect(screen.getByRole('status', { name: '在线状态' }).textContent).toContain('1 人在线');
    fireEvent.click(screen.getByRole('button', { name: '管理在线成员' }));
    await waitFor(() => expect(screen.getByText('二号')).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith('/api/collaboration/members?projectId=project-a', expect.objectContaining({ credentials: 'include' }));
    expect(screen.getByRole('button', { name: '撤销二号的在线资格' })).toBeTruthy();
  });

  it('邀请和撤销使用精确项目/用户身份，失败反馈留在面板', async () => {
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (!init || init.method === 'GET') return { ok: true, json: async () => ({ success: true, members: [] }) } as Response;
      return { ok: false, json: async () => ({ code: 'PRESENCE_FORBIDDEN' }) } as Response;
    });
    render(<PresenceIndicator projectId="project-a" isOwner themeStyle="gold" />);
    fireEvent.click(screen.getByRole('button', { name: '管理在线成员' }));
    await waitFor(() => expect(screen.getByLabelText('成员用户 ID')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('成员用户 ID'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法完成成员操作'));
    expect(fetch).toHaveBeenCalledWith('/api/collaboration/members', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ projectId: 'project-a', memberUserId: 'u2' }),
    }));
  });
});
