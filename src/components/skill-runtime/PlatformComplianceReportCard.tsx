'use client';

import { useState } from 'react';
import { Download, Filter, LocateFixed, RotateCcw } from 'lucide-react';

import type { ComplianceJsonScalar, ComplianceStatus, PlatformComplianceReportV1 } from '@/lib/platform-compliance/types';

interface PlatformComplianceReportCardProps {
  report: PlatformComplianceReportV1;
  stepId: string;
  downloadUrls?: { json: string; html: string };
  busy?: boolean;
  onLocate: (sourceVersionId: string) => void;
  onRecheck?: (report: PlatformComplianceReportV1) => void;
}

const statusLabels: Record<ComplianceStatus, string> = {
  passed: '通过', warning: '警告', blocked: '阻止', unknown: '未知',
};

const statusClasses: Record<ComplianceStatus, string> = {
  passed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  blocked: 'border-red-500/30 bg-red-500/10 text-red-300',
  unknown: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
};

function scalar(value: ComplianceJsonScalar): string {
  if (value === null) return '未提供';
  return String(value);
}

export function PlatformComplianceReportCard({
  report,
  downloadUrls,
  busy = false,
  onLocate,
  onRecheck,
}: PlatformComplianceReportCardProps): React.ReactElement {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const checks = problemsOnly
    ? report.checks.filter(check => check.status !== 'passed')
    : report.checks;
  const ruleVersions = [...new Set(report.checks.map(check => check.ruleVersion))].sort((a, b) => a - b).join(', ');

  return (
    <section
      aria-label="平台素材合规报告"
      data-skill-report="platform-compliance"
      className="max-h-96 overflow-y-auto rounded-md border border-current/15 bg-black/10 p-3 text-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">平台素材合规报告</strong>
            <span className={`rounded border px-1.5 py-0.5 font-medium ${statusClasses[report.verdict]}`}>
              {statusLabels[report.verdict]}
            </span>
          </div>
          <p className="text-muted-foreground">
            {report.platform} · {report.region} · {report.assetType} · 规则版本 {ruleVersions || '未知'}
          </p>
          <time className="text-muted-foreground" dateTime={report.generatedAt}>
            {new Date(report.generatedAt).toLocaleString('zh-CN')}
          </time>
        </div>
        <div className="grid grid-cols-4 gap-1" aria-label="检查结果统计">
          {(['passed', 'warning', 'blocked', 'unknown'] as const).map(status => (
            <span key={status} className={`rounded border px-1.5 py-1 text-center ${statusClasses[status]}`}>
              <span className="block">{statusLabels[status]}</span>
              <strong>{report.summary[status]}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="my-3 flex flex-wrap gap-1.5">
        <button type="button" title="定位画布图片" className="inline-flex items-center gap-1 rounded border border-current/20 px-2 py-1 hover:bg-current/10" onClick={() => onLocate(report.sourceVersionId)}>
          <LocateFixed size={13} aria-hidden="true" />定位画布图片
        </button>
        <button type="button" aria-pressed={problemsOnly} title="筛选检查项" className="inline-flex items-center gap-1 rounded border border-current/20 px-2 py-1 hover:bg-current/10" onClick={() => setProblemsOnly(value => !value)}>
          <Filter size={13} aria-hidden="true" />{problemsOnly ? '查看全部' : '只看问题'}
        </button>
        {onRecheck && (
          <button type="button" title="按相同设置重新检查" disabled={busy} className="inline-flex items-center gap-1 rounded border border-current/20 px-2 py-1 hover:bg-current/10 disabled:opacity-50" onClick={() => onRecheck(report)}>
            <RotateCcw size={13} aria-hidden="true" />重新检查
          </button>
        )}
        {downloadUrls && <>
          <a title="下载 JSON 报告" className="inline-flex items-center gap-1 rounded border border-current/20 px-2 py-1 hover:bg-current/10" href={downloadUrls.json} download>
            <Download size={13} aria-hidden="true" />导出 JSON
          </a>
          <a title="下载 HTML 报告" className="inline-flex items-center gap-1 rounded border border-current/20 px-2 py-1 hover:bg-current/10" href={downloadUrls.html} download>
            <Download size={13} aria-hidden="true" />导出 HTML
          </a>
        </>}
      </div>

      <div className="space-y-1.5">
        {checks.map(check => (
          <details key={`${check.ruleId}:${check.ruleVersion}`} className="rounded border border-current/10 px-2 py-1.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
              <span className="min-w-0 break-words">{check.title}</span>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 ${statusClasses[check.status]}`}>{statusLabels[check.status]}</span>
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-muted-foreground">
              <dt>证据</dt><dd className="break-words">{check.evidence.join('；') || '无可验证证据'}</dd>
              <dt>实测值</dt><dd className="break-words">{scalar(check.measuredValue)}</dd>
              <dt>要求值</dt><dd className="break-words">{scalar(check.requiredValue)}</dd>
              <dt>置信度</dt><dd>{check.confidence === null ? '未知' : `${Math.round(check.confidence * 100)}%`}</dd>
              <dt>修复建议</dt><dd className="break-words">{check.remediation || '无需修复'}</dd>
            </dl>
          </details>
        ))}
        {checks.length === 0 && <p className="py-2 text-center text-muted-foreground">当前没有问题项</p>}
      </div>
    </section>
  );
}
