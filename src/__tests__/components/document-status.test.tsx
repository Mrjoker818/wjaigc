// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentStatus } from '@/components/collaboration/document-status';

describe('DocumentStatus', () => {
  it('keeps the recovery notice and explicit actions in one accessible group across status changes', () => {
    const exportCopy = vi.fn();
    const retry = vi.fn();
    const { rerender } = render(<DocumentStatus authority="document" status="recovery"
      onExportLocalCopy={exportCopy} onRetryRecovered={retry} />);
    const recovery = within(screen.getByRole('group', { name: '协作文档状态与恢复' }));
    expect(recovery.getByRole('status').textContent).toContain('未确认');
    expect(exportCopy).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(recovery.getByRole('button', { name: '下载未同步副本' }));
    fireEvent.click(recovery.getByRole('button', { name: '重试同步' }));
    expect(exportCopy).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledOnce();
    rerender(<DocumentStatus authority="document" status="rejected" onExportLocalCopy={exportCopy} />);
    const rejected = within(screen.getByRole('group', { name: '协作文档状态与恢复' }));
    expect(rejected.getByRole('status').textContent).toContain('服务器拒绝');
    expect(rejected.queryByRole('button', { name: '重试同步' })).toBeNull();
    fireEvent.click(rejected.getByRole('button', { name: '下载未同步副本' }));
    expect(exportCopy).toHaveBeenCalledTimes(2);
    rerender(<DocumentStatus authority="document" status="saved" />);
    expect(screen.getByRole('status').textContent).toBe('已保存');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('never displays a saved claim for an unacknowledged or unavailable document', () => {
    const { rerender } = render(<DocumentStatus authority="document" status="pending" />);
    expect(screen.getByRole('status').textContent).toContain('待同步');
    expect(screen.queryByText('已保存')).toBeNull();
    rerender(<DocumentStatus authority="document" status="unavailable" />);
    expect(screen.getByRole('status').textContent).toContain('同步不可用');
    expect(screen.queryByText('已保存')).toBeNull();
    rerender(<DocumentStatus authority="document" status="saved" />);
    expect(screen.getByRole('status').textContent).toContain('已保存');
  });

  it('does not add a collaboration status to a legacy project', () => {
    render(<DocumentStatus authority="legacy" status="disabled" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('warns to download rejected local changes before closing the page', () => {
    const exportCopy = vi.fn();
    render(<DocumentStatus authority="document" status="rejected" onExportLocalCopy={exportCopy} />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('服务器拒绝');
    expect(notice.textContent).toContain('关闭页面前');
    expect(notice.textContent).toContain('下载');
    expect(notice.textContent).not.toContain('已保存');
    fireEvent.click(screen.getByRole('button', { name: '下载未同步副本' }));
    expect(exportCopy).toHaveBeenCalledOnce();
  });

  it('offers explicit retry and export for unconfirmed recovery without claiming server rejection', () => {
    const exportCopy = vi.fn();
    const retry = vi.fn();
    render(<DocumentStatus authority="document" status="recovery"
      onExportLocalCopy={exportCopy} onRetryRecovered={retry} />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('未确认');
    expect(notice.textContent).not.toContain('服务器拒绝');
    expect(notice.textContent).not.toContain('已保存');
    fireEvent.click(screen.getByRole('button', { name: '重试同步' }));
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '下载未同步副本' }));
    expect(exportCopy).toHaveBeenCalledOnce();
  });

  it('offers only export when unconfirmed recovery cannot safely retry', () => {
    render(<DocumentStatus authority="document" status="recovery" onExportLocalCopy={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('下载');
    expect(screen.getByRole('status').textContent).not.toContain('重试');
    expect(screen.queryByRole('button', { name: '重试同步' })).toBeNull();
  });
});
