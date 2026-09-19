// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardProjectActionsMenu } from '@/components/dashboard/project-actions-menu';

describe('dashboard project actions menu', () => {
  it('provides labeled Radix menu semantics, keyboard Escape, and a persistent share return target', async () => {
    const onManageShare = vi.fn();
    render(
      <DashboardProjectActionsMenu
        projectName="项目甲"
        onRename={vi.fn()}
        onExport={vi.fn()}
        onManageShare={onManageShare}
        onDelete={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: '项目甲 项目操作菜单' });
    expect(trigger.className).toContain('size-11');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });

    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map(item => item.textContent)).toEqual([
      '重命名',
      '导出 .wujie',
      '管理分享',
      '删除',
    ]);
    expect(items.every(item => item.className.includes('min-h-11'))).toBe(true);

    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '管理分享' }));
    expect(onManageShare).toHaveBeenCalledWith(trigger);
  });
});
