// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentStatus } from '@/components/collaboration/document-status';
afterEach(cleanup);
describe('document recovery capability display', () => {
  it.each(['recovery', 'rejected'] as const)('does not promise a download when %s has no readable export', status => {
    render(<DocumentStatus authority="document" status={status} exportAvailable={false} onExportLocalCopy={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '下载未同步副本' })).toBeNull();
    expect(screen.getByRole('status').textContent).not.toContain('请下载');
    expect(screen.getByRole('status').textContent).not.toContain('关闭页面前下载');
    expect(screen.getByRole('status').textContent).toContain('保留');
  });
  it('keeps explicit retry independent from unavailable export', () => {
    render(<DocumentStatus authority="document" status="recovery" exportAvailable={false}
      onExportLocalCopy={vi.fn()} onRetryRecovered={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '下载未同步副本' })).toBeNull();
    expect(screen.getByRole('button', { name: '重试同步' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).not.toContain('下载');
  });
});
