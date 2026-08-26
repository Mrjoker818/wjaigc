// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SimpleChatSyncStatusView } from '@/components/simple-chat/simple-chat-sync-status';

describe('SimpleChatSyncStatusView', () => {
  it.each([
    ['loading', '正在加载对话'],
    ['syncing', '正在同步'],
    ['synced', '已同步'],
    ['offline', '离线，修改将在联网后同步'],
  ] as const)('shows readable %s feedback', (status, message) => {
    render(<SimpleChatSyncStatusView status={status} error={null} onRetry={vi.fn()} />);

    expect(screen.getByTestId('simple-chat-sync-status')).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试同步' })).toBeNull();
  });

  it('shows a retryable sync failure without clearing the conversation', () => {
    const onRetry = vi.fn();
    render(
      <SimpleChatSyncStatusView
        status="failed"
        error={{ code: 'NETWORK_ERROR', message: '同步失败', retryable: true }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('同步失败，点击重试')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试同步' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers an explicit retry when synchronization conflicts', () => {
    const onRetry = vi.fn();
    render(
      <SimpleChatSyncStatusView
        status="conflict"
        error={{ code: 'SYNC_CONFLICT', message: '版本冲突', retryable: true }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('同步冲突，点击重试')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试同步' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
