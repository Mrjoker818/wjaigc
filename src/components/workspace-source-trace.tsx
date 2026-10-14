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
  if (trace.source === 'sketch-to-image') return ['来源：草图生图（保留原始草图）',
    `task：${trace.taskId}`, `project：${trace.projectId}`, `原始PNG版本：${trace.previewAssetVersionId}`,
    `生成图版本：${trace.imageAssetVersionId}`, `视觉模型：${trace.visionProviderId} / ${trace.visionModelId}`,
    `图像模型：${trace.imageProviderId} / ${trace.imageModelId}`].join('\n');
  if (trace.source === 'sketch-to-code') return ['来源：草图转代码（原始草图PNG，非页面截图）',
    `task：${trace.taskId}`, `project：${trace.projectId}`, `PNG版本：${trace.previewAssetVersionId}`,
    `HTML版本：${trace.htmlAssetVersionId}`, `本地接收时间：${formatSourceTime(trace.createdAt)}`].join('\n');
  if (trace.source === 'canvas-skill') {
    return [
      '来源：Canvas Skill',
      `run：${trace.runId}`,
      `skill：${trace.skillId}@${trace.skillVersion}`,
      `时间：${formatSourceTime(trace.createdAt)}`,
    ].join('\n');
  }
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
  if (trace.source === 'sketch-to-image') return (
    <section className="mx-4 mb-2 rounded border border-border/60 bg-muted/40 px-3 py-2" aria-label="节点来源">
      <div className="text-xs font-medium text-foreground">来源：草图生图（保留原始草图）</div>
      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 break-all text-[11px] text-muted-foreground">
        <dt>task</dt><dd>{trace.taskId}</dd><dt>project</dt><dd>{trace.projectId}</dd>
        <dt>原始PNG版本</dt><dd>{trace.previewAssetVersionId}</dd><dt>生成图版本</dt><dd>{trace.imageAssetVersionId}</dd>
        <dt>视觉模型</dt><dd>{trace.visionProviderId} / {trace.visionModelId}</dd>
        <dt>图像模型</dt><dd>{trace.imageProviderId} / {trace.imageModelId}</dd>
      </dl>
    </section>
  );
  if (trace.source === 'sketch-to-code') return (
    <section className="mx-4 mb-2 rounded border border-border/60 bg-muted/40 px-3 py-2" aria-label="节点来源">
      <div className="text-xs font-medium text-foreground">来源：草图转代码（原始草图PNG，非页面截图）</div>
      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 break-all text-[11px] text-muted-foreground">
        <dt>task</dt><dd>{trace.taskId}</dd><dt>project</dt><dd>{trace.projectId}</dd>
        <dt>PNG版本</dt><dd>{trace.previewAssetVersionId}</dd><dt>HTML版本</dt><dd>{trace.htmlAssetVersionId}</dd>
        <dt>本地接收时间</dt><dd>{formatSourceTime(trace.createdAt)}</dd>
      </dl>
    </section>
  );
  if (trace.source === 'canvas-skill') {
    return (
      <section className="mx-4 mb-2 rounded border border-border/60 bg-muted/40 px-3 py-2" aria-label="节点来源">
        <div className="text-xs font-medium text-foreground">来源：Canvas Skill</div>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <dt>run</dt><dd className="truncate" title={trace.runId}>{trace.runId}</dd>
          <dt>skill</dt><dd className="truncate" title={trace.skillId}>{trace.skillId}@{trace.skillVersion}</dd>
          <dt>时间</dt><dd>{formatSourceTime(trace.createdAt)}</dd>
        </dl>
      </section>
    );
  }
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
      {trace.source === 'canvas-skill' ? 'Canvas Skill' : trace.source === 'sketch-to-code' ? '草图转代码 · 原始PNG'
        : trace.source === 'sketch-to-image' ? '草图生图 · 保留原始草图' : '智能对话'}
    </span>
  );
}
