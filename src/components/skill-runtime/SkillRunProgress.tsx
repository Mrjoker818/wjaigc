'use client';

import { useEffect, useState } from 'react';
import type { AgentRunProjection } from '@/lib/agent-runtime/types';
import type { SkillRunCostEstimate } from '@/lib/skill-runtime/cost-estimator';
import type { PlatformComplianceReportV1 } from '@/lib/platform-compliance/types';
import { PlatformComplianceReportCard } from './PlatformComplianceReportCard';
import { projectPlatformComplianceReports, type PlatformComplianceReportProjection } from './platform-compliance-client';

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
  projectId?: string;
  onLocateComplianceSource?: (sourceVersionId: string) => void;
  onRecheckCompliance?: (report: PlatformComplianceReportV1) => void;
}

const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'timeout']);
const stepStatusLabels: Record<string, string> = {
  pending: '待执行', processing: '执行中', paused: '已暂停',
  completed: '已完成', failed: '失败', cancelled: '已取消', timeout: '超时',
};

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
  projectId,
  onLocateComplianceSource,
  onRecheckCompliance,
}: SkillRunProgressProps): React.ReactElement | null {
  const [complianceReports, setComplianceReports] = useState<PlatformComplianceReportProjection[]>([]);
  const outputs = projection?.result?.outputs;
  useEffect(() => {
    let active = true;
    if (!projection || !projectId) {
      setComplianceReports([]);
      return () => { active = false; };
    }
    void projectPlatformComplianceReports(outputs, { runId: projection.runId, projectId })
      .then(reports => { if (active) setComplianceReports(reports); });
    return () => { active = false; };
  }, [outputs, projectId, projection]);

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
            {projection.plan.map(step => (
              <li key={step.id} className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-words">{step.label}</span>
                <span className="shrink-0 text-muted-foreground">{stepStatusLabels[step.status] || '状态未知'}</span>
              </li>
            ))}
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
            {projection.status === 'paused' && !retryablePausedStep && onResume && (
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
          {onLocateComplianceSource && complianceReports.map(item => (
            <PlatformComplianceReportCard
              key={`${item.stepId}:${item.report.reportId}`}
              report={item.report}
              stepId={item.stepId}
              downloadUrls={item.downloadUrls}
              busy={busy}
              onLocate={onLocateComplianceSource}
              onRecheck={onRecheckCompliance}
            />
          ))}
        </>
      )}
    </div>
  );
}
