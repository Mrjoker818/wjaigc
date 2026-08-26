'use client';

import { AlertTriangle, Check, LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';

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
    iconClassName: 'animate-spin text-muted-foreground',
  },
  syncing: {
    label: '正在同步',
    icon: RefreshCw,
    iconClassName: 'animate-spin text-primary',
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
  const canRetry = status === 'failed' || status === 'conflict';

  return (
    <div
      data-testid="simple-chat-sync-status"
      role="status"
      title={error?.message}
      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${content.iconClassName}`} />
      <span className="truncate">{content.label}</span>
      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label="重试同步"
          className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="重试同步"
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
