'use client';

import { useEffect, useRef, useState } from 'react';

import type { AgentRunProjection } from '@/lib/agent-runtime/types';

interface AgentProgressTimelineProps {
  projection?: AgentRunProjection;
  stale?: boolean;
  onCancel?: () => void | Promise<unknown>;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timeout']);

function statusLabel(projection: AgentRunProjection | undefined, stale: boolean): string {
  if (stale && projection && !TERMINAL_STATUSES.has(projection.status)) return '正在排队';
  if (projection?.status === 'paused') return '已暂停';
  if (projection?.status === 'awaiting-confirmation') return '待确认';
  if (projection?.status === 'planning') return '正在规划';
  if (projection?.status === 'executing') return '正在执行';
  if (projection?.status === 'uploading') return '正在上传';
  if (projection?.status === 'completed') return '已完成';
  if (projection?.status === 'cancelled') return '已取消';
  if (projection?.status === 'failed') return '执行失败';
  if (projection?.status === 'timeout') return '执行超时';
  return '正在排队';
}

function AgentProgressTimelineInstance({
  projection,
  stale = false,
  onCancel,
}: AgentProgressTimelineProps): React.ReactElement | null {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string>();
  const cancellingRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const cancel = async (): Promise<void> => {
    if (!onCancel || cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true);
    setCancelError(undefined);
    try { await onCancel(); } catch (cause) {
      if (mountedRef.current) setCancelError(cause instanceof Error ? cause.message : '取消失败，请重试');
    } finally {
      cancellingRef.current = false;
      if (mountedRef.current) setCancelling(false);
    }
  };
  if (!projection) return null;
  const terminal = TERMINAL_STATUSES.has(projection.status);
  return (
    <div className="min-w-0 space-y-2 [overflow-wrap:anywhere] text-xs" aria-live="polite">
      <div>{statusLabel(projection, stale)}</div>
      {projection.plan.map(step => <div key={step.id}>{step.label}</div>)}
      {projection.error && (
        <div role="alert" className="flex min-w-0 flex-col gap-1">
          <span>{projection.error.code}</span>
          <span>{projection.error.message}</span>
          <span>{projection.error.retryable ? '可重试' : '不可重试'}</span>
        </div>
      )}
      {cancelError && <div role="alert" className="text-destructive">{cancelError}</div>}
      {!terminal && onCancel && (
        <button type="button" onClick={() => { void cancel(); }} disabled={cancelling} aria-busy={cancelling}
          className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-border px-3 font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${cancelling ? 'cursor-wait opacity-50' : ''}`}>取消任务</button>
      )}
    </div>
  );
}

export function AgentProgressTimeline(props: AgentProgressTimelineProps): React.ReactElement {
  return <AgentProgressTimelineInstance key={props.projection?.runId ?? "pending"} {...props} />;
}
