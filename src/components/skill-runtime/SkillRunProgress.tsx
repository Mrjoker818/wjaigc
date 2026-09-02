'use client';

import type { AgentRunProjection } from '@/lib/agent-runtime/types';
import type { SkillRunCostEstimate } from '@/lib/skill-runtime/cost-estimator';

interface SkillRunProgressProps {
  estimate?: SkillRunCostEstimate;
  projection?: AgentRunProjection;
  retryableStepId?: string;
  retryabilityError?: string;
  stale?: boolean;
  busy?: boolean;
  onPause?: (stepId: string) => void;
  onResume?: () => void;
  onCancel?: () => void;
  onRetry?: (stepId: string) => void;
  onRefreshRetryability?: () => void;
}

const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'timeout']);

function phaseLabel(projection: AgentRunProjection, stale: boolean): string {
  if (stale && projection.status !== 'paused' && !terminalStatuses.has(projection.status)) {
    return '正在排队';
  }
  const labels: Record<AgentRunProjection['status'], string> = {
    created: '正在排队',
    queued: '正在排队',
    planning: '正在规划',
    'awaiting-confirmation': '等待确认',
    executing: '正在执行',
    uploading: '正在上传',
    paused: '已暂停',
    completed: '已完成',
    failed: '执行失败',
    cancelled: '已取消',
    timeout: '执行超时',
  };
  return labels[projection.status];
}

function estimateLabel(estimate: SkillRunCostEstimate): string {
  return estimate.minimum === estimate.maximum
    ? `预计 ${estimate.maximum} 积分`
    : `预计 ${estimate.minimum}-${estimate.maximum} 积分`;
}

export function SkillRunProgress({
  estimate,
  projection,
  retryableStepId,
  retryabilityError,
  stale = false,
  busy = false,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRefreshRetryability,
}: SkillRunProgressProps): React.ReactElement | null {
  if (!estimate && !projection) return null;
  const terminal = projection ? terminalStatuses.has(projection.status) : false;
  const retryablePausedStep = projection?.status === 'paused'
    && projection.resumeFromStepId === retryableStepId
    ? retryableStepId
    : undefined;

  return (
    <div className="space-y-2 text-sm" aria-live="polite">
      {estimate && <div>{estimateLabel(estimate)}</div>}
      {projection && (
        <>
          <div>{phaseLabel(projection, stale)}</div>
          {typeof projection.progress === 'number' && (
            <progress
              className="w-full"
              max={100}
              value={Math.max(0, Math.min(100, projection.progress))}
              aria-label="运行进度"
              aria-valuenow={Math.max(0, Math.min(100, projection.progress))}
            />
          )}
          <ol className="space-y-1">
            {projection.plan.map(step => <li key={step.id}>{step.label}</li>)}
          </ol>
          {projection.error && (
            <div role="alert" className="text-destructive">
              <div>{projection.error.code}</div>
              <div>{projection.error.message}</div>
            </div>
          )}
          {projection.status === 'paused' && retryabilityError && (
            <div role="alert" className="text-destructive">{retryabilityError}</div>
          )}
          <div className="flex gap-2">
            {projection.status === 'paused' && onResume && (
              <button type="button" disabled={busy} onClick={onResume}>继续</button>
            )}
            {!terminal && projection.status !== 'paused' && projection.currentStepId && onPause && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onPause(projection.currentStepId!)}
              >
                暂停
              </button>
            )}
            {!terminal && onCancel && (
              <button type="button" disabled={busy} onClick={onCancel}>取消</button>
            )}
            {projection.status === 'paused'
              && retryablePausedStep
              && onRetry && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRetry(retryablePausedStep)}
                >
                  从失败步骤重试
                </button>
              )}
            {projection.status === 'paused'
              && retryabilityError
              && onRefreshRetryability && (
                <button type="button" disabled={busy} onClick={onRefreshRetryability}>
                  重新检查
                </button>
              )}
          </div>
        </>
      )}
    </div>
  );
}
