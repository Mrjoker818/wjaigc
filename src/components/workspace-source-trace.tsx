import type { ReactElement } from 'react';

import {
  parseWorkspaceSourceTrace,
  type WorkspaceSourceTrace,
} from '@/lib/asset-core/source-trace';

interface WorkspaceSourceTraceProps {
  sourceTrace: unknown;
}

interface CanvasSourceTraceBadgeProps extends WorkspaceSourceTraceProps {
  isSelected: boolean;
}

function formatSourceTime(createdAt: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdAt));
}

function sourceTraceTitle(trace: WorkspaceSourceTrace): string {
  return [
    '来源：智能对话',
    `chat project：${trace.chatProjectId}`,
    trace.modelId ? `model：${trace.modelId}` : '',
    trace.providerId ? `provider：${trace.providerId}` : '',
    `时间：${formatSourceTime(trace.createdAt)}`,
  ].filter(Boolean).join('\n');
}

export function WorkspaceSourceTraceDetails({ sourceTrace }: WorkspaceSourceTraceProps): ReactElement | null {
  const trace = parseWorkspaceSourceTrace(sourceTrace);
  if (!trace) return null;
  return (
    <section className="mx-4 mb-2 rounded border border-border/60 bg-muted/40 px-3 py-2" aria-label="节点来源">
      <div className="text-xs font-medium text-foreground">来源：智能对话</div>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <dt>chat project</dt><dd className="truncate" title={trace.chatProjectId}>{trace.chatProjectId}</dd>
        {trace.modelId && <><dt>model</dt><dd className="truncate" title={trace.modelId}>{trace.modelId}</dd></>}
        {trace.providerId && <><dt>provider</dt><dd className="truncate" title={trace.providerId}>{trace.providerId}</dd></>}
        <dt>时间</dt><dd>{formatSourceTime(trace.createdAt)}</dd>
      </dl>
    </section>
  );
}

export function CanvasSourceTraceBadge({
  sourceTrace,
  isSelected,
}: CanvasSourceTraceBadgeProps): ReactElement | null {
  if (!isSelected) return null;
  const trace = parseWorkspaceSourceTrace(sourceTrace);
  if (!trace) return null;
  return (
    <span
      className="pointer-events-auto px-1.5 py-0.5 rounded text-[9px] font-medium whitespace-nowrap leading-tight bg-black/70 text-amber-200"
      title={sourceTraceTitle(trace)}
    >
      智能对话
    </span>
  );
}
