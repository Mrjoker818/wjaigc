'use client';

import type { CollaborativeCanvasState } from '@/lib/collaboration/document-client';

export function DocumentStatus({
  authority, status, commandStatus, onExportLocalCopy, onRetryRecovered,
}: Pick<CollaborativeCanvasState, 'authority' | 'status'> & {
  onExportLocalCopy?: () => void;
  onRetryRecovered?: () => void;
  commandStatus?: 'running' | 'failed';
}) {
  if (authority === 'legacy' || status === 'disabled') return null;
  const commandUnconfirmed = !!commandStatus && (status === 'saved' || status === 'pending');
  const message = commandUnconfirmed ? commandStatus === 'failed'
    ? '画布操作未确认；请重试未完成的画布操作' : '正在确认画布操作…'
    : status === 'saved' ? '已保存'
    : status === 'pending' ? '待同步'
      : status === 'connecting' ? '正在连接协作'
        : status === 'read-only' ? '协作文档只读'
          : status === 'rejected' ? '服务器拒绝改动；请在关闭页面前下载未同步副本'
            : status === 'recovery' ? onRetryRecovered
              ? '上次改动未确认；请下载副本或手动重试同步'
              : '上次改动未确认；请下载未同步副本'
          : status === 'unavailable' ? '同步不可用，改动未确认'
            : '正在确认协作状态';
  const hasRecoveryActions = status === 'rejected' || status === 'recovery';
  return <div role="group" aria-label="协作文档状态与恢复"
    className={`flex min-w-0 max-w-full flex-wrap items-center gap-1 ${hasRecoveryActions ? 'order-last basis-full' : ''}`}>
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`min-w-0 max-w-full whitespace-normal break-words rounded-md border px-2 py-1 text-xs ${
        commandUnconfirmed || status === 'unavailable' || status === 'pending' || status === 'rejected' || status === 'recovery'
          ? 'border-amber-500/50 text-amber-300'
          : 'border-white/20 text-white/80'
      }`}
    >
      {message}
    </span>
    {(status === 'rejected' || status === 'recovery') && onExportLocalCopy && (
      <button type="button" onClick={onExportLocalCopy}
        className="min-h-11 max-w-full shrink-0 whitespace-normal rounded-md border border-amber-500/50 px-2 py-1 text-xs text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        下载未同步副本
      </button>
    )}
    {status === 'recovery' && onRetryRecovered && (
      <button type="button" onClick={onRetryRecovered}
        className="min-h-11 max-w-full shrink-0 whitespace-normal rounded-md border border-amber-500/50 px-2 py-1 text-xs text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        重试同步
      </button>
    )}
  </div>;
}
