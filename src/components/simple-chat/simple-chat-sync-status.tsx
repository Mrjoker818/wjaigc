'use client';

import { AlertTriangle, Check, Info, LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { SimpleChatSyncError, SimpleChatSyncStatus } from '@/lib/simple-chat-sync-client';

interface SimpleChatSyncStatusViewProps {
  status: SimpleChatSyncStatus;
  error: SimpleChatSyncError | null;
  onRetry: () => void;
}

const statusContent = {
  loading: {
    label: '正在加载对话',
    icon: LoaderCircle,
    iconClassName: 'animate-spin text-muted-foreground motion-reduce:animate-none',
  },
  syncing: {
    label: '正在同步',
    icon: RefreshCw,
    iconClassName: 'animate-spin text-primary motion-reduce:animate-none',
  },
  synced: {
    label: '已同步',
    icon: Check,
    iconClassName: 'text-emerald-500',
  },
  offline: {
    label: '离线，修改将在联网后同步',
    icon: WifiOff,
    iconClassName: 'text-amber-500',
  },
  failed: {
    label: '同步失败，点击重试',
    icon: AlertTriangle,
    iconClassName: 'text-red-500',
  },
  conflict: {
    label: '同步冲突，点击重试',
    icon: AlertTriangle,
    iconClassName: 'text-amber-500',
  },
} satisfies Record<SimpleChatSyncStatus, {
  label: string;
  icon: typeof Check;
  iconClassName: string;
}>;

export function SimpleChatSyncStatusView({
  status,
  error,
  onRetry,
}: SimpleChatSyncStatusViewProps) {
  const content = statusContent[status];
  const Icon = content.icon;
  const failed = status === 'failed' || status === 'conflict';
  const canRetry = failed && error?.retryable !== false;
  const label = failed && !canRetry ? '同步失败，暂不可重试' : content.label;

  return (
    <div
      data-testid="simple-chat-sync-status"
      role="status"
      title={error?.message}
      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${content.iconClassName}`} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      {failed && error && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="同步错误详情"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-accent active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Info aria-hidden="true" className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            aria-label="同步错误详情"
            align="end"
            collisionPadding={8}
            className="max-h-[min(24rem,var(--radix-popover-content-available-height,calc(100dvh-1rem)))] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain text-base leading-relaxed [overflow-wrap:anywhere] motion-reduce:animate-none"
          >
            <h3 className="mb-2 font-medium">同步错误详情</h3>
            <p>{error.message}</p>
          </PopoverContent>
        </Popover>
      )}
      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label="重试同步"
          className="ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-accent active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="重试同步"
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
