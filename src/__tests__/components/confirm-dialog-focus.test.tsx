// @vitest-environment jsdom
import React, { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/components/custom-dialogs';

afterEach(cleanup);

function Example({ confirm, cancel }: { confirm: () => void; cancel: () => void }): React.ReactNode {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>批量删除</button>
    <button>背景全选</button>
    <ConfirmDialog open={open} title="删除项目" message="请核对所选项目" details={<p>隐藏项目甲</p>}
      onCancel={() => { cancel(); setOpen(false); }}
      onConfirm={() => { confirm(); setOpen(false); }} />
  </>;
}

function openDialog(confirm = vi.fn(), cancel = vi.fn()): { launcher: HTMLElement; confirm: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  render(<Example confirm={confirm} cancel={cancel} />);
  const launcher = screen.getByRole('button', { name: '批量删除' });
  launcher.focus();
  fireEvent.click(launcher);
  return { launcher, confirm, cancel };
}

describe('confirmation modal focus', () => {
  it('moves focus to the safe cancel action and keeps background controls outside the modal', async () => {
    openDialog();
    const dialog = screen.getByRole('dialog', { name: '删除项目' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' })));
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const background = screen.getByText('背景全选');
    act(() => background.focus());
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes once with Escape and restores the launcher without confirming', async () => {
    const { launcher, confirm, cancel } = openDialog();
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(launcher));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps the named target list and confirms only on the explicit confirm action', async () => {
    const { launcher, confirm, cancel } = openDialog();
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    expect(screen.getByRole('region', { name: '待删除项目' }).textContent).toContain('隐藏项目甲');
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(launcher));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('returns focus to the supplied fallback when confirming removes the launcher', async () => {
    function RemovingExample(): React.ReactNode {
      const [open, setOpen] = useState(false);
      const [removed, setRemoved] = useState(false);
      const fallback = useRef<HTMLInputElement>(null);
      return <>
        <input ref={fallback} aria-label="搜索项目" />
        {!removed && <button onClick={() => setOpen(true)}>删除选中</button>}
        <ConfirmDialog open={open} title="删除目标" message="确认" returnFocusFallback={() => fallback.current}
          onCancel={() => setOpen(false)} onConfirm={() => { setRemoved(true); setOpen(false); }} />
      </>;
    }
    render(<RemovingExample />);
    const launcher = screen.getByRole('button', {name:'删除选中'});
    launcher.focus();
    fireEvent.click(launcher);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', {name:'确定'}));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'搜索项目'})));
  });

  it('prevents duplicate confirmation and cancellation while the confirmed operation is pending', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const confirm = vi.fn(() => pending);
    const cancel = vi.fn();
    render(<ConfirmDialog open title="等待提交" message="确认" onConfirm={confirm} onCancel={cancel} />);
    const button = screen.getByRole('button', {name:'确定'});
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', {name:'取消'}));
    fireEvent.click(screen.getByRole('button', {name:'关闭等待提交'}));
    fireEvent.keyDown(document.activeElement!, {key:'Escape'});
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => { release(); await pending; });
  });
});
