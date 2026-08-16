'use client';

import type { AgentRunProjection } from '@/lib/agent-runtime/types';

interface AgentProgressTimelineProps {
  projection?: AgentRunProjection;
  stale?: boolean;
  onCancel?: () => void;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timeout']);

function statusLabel(projection: AgentRunProjection | undefined, stale: boolean): string {
  if (stale) return '正在排队';
  if (projection?.status === 'planning') return '正在规划';
  if (projection?.status === 'executing') return '正在执行';
  if (projection?.status === 'uploading') return '正在上传';
  if (projection?.status === 'completed') return '已完成';
  if (projection?.status === 'cancelled') return '已取消';
  if (projection?.status === 'failed') return '执行失败';
  if (projection?.status === 'timeout') return '执行超时';
  return '正在排队';
}

export function AgentProgressTimeline({
  projection,
  stale = false,
  onCancel,
}: AgentProgressTimelineProps): React.ReactElement | null {
  if (!projection) return null;
  const terminal = TERMINAL_STATUSES.has(projection.status);
  return (
    <div className="space-y-1 text-xs" aria-live="polite">
      <div>{statusLabel(projection, stale)}</div>
      {projection.plan.map(step => <div key={step.id}>{step.label}</div>)}
      {projection.error && (
        <div role="alert">
          <span>{projection.error.code}</span>
          <span>{projection.error.message}</span>
          <span>{projection.error.retryable ? '可重试' : '不可重试'}</span>
        </div>
      )}
      {!terminal && onCancel && (
        <button type="button" onClick={onCancel}>取消任务</button>
      )}
    </div>
  );
}
